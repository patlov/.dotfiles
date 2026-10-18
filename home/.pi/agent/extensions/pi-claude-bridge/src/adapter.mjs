import { mkdir, readFile, writeFile, rename, readdir, stat } from 'node:fs/promises';
import { watch } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { HOOKS, MAX_EVENT_BYTES, hookSettings, taskPrompt, safeText } from './hooks.mjs';

const TERMINAL = new Set(['completed', 'failed', 'response_finished', 'crashed', 'cancelled']);
export const isTerminal = task => TERMINAL.has(task.state);
const RELAY = fileURLToPath(new URL('./hook-relay.mjs', import.meta.url));
const writeJson = async (path, value) => {
  const temp = `${path}.${randomUUID()}.tmp`;
  await writeFile(temp, JSON.stringify(value), { mode: 0o600, flag: 'wx' });
  await rename(temp, path);
};

/** Runtime-neutral leaf adapter. Construction never starts watchers/processes. */
export class ClaudeAdapter {
  constructor({ root, parentId, transport, host, watchDirectory = watch }) {
    this.root = root; this.parentId = parentId; this.transport = transport;
    this.host = host; this.watchDirectory = watchDirectory;
    this.tasks = []; this.tail = Promise.resolve(); this.closed = false;
    this.watcher = null; this.unsubscribe = null; this.monitoring = 'not_started';
  }
  serial(fn) {
    const result = this.tail.then(fn);
    this.tail = result.catch(() => {});
    return result;
  }
  save() { return writeJson(join(this.root, 'state.json'), { version: 1, parentId: this.parentId, tasks: this.tasks }); }
  async open() {
    return this.serial(async () => {
      await mkdir(this.root, { recursive: true, mode: 0o700 });
      await mkdir(join(this.root, 'events'), { mode: 0o700 }).catch(e => { if (e.code !== 'EEXIST') throw e; });
      try {
        const state = JSON.parse(await readFile(join(this.root, 'state.json'), 'utf8'));
        if (state.version !== 1 || state.parentId !== this.parentId || !Array.isArray(state.tasks) || state.tasks.length > 32) throw new Error('Invalid bridge state; refusing adoption');
        this.tasks = state.tasks;
        for (const task of this.tasks) {
          if (!/^[0-9a-f-]{36}$/.test(task.id) || task.parentId !== this.parentId || task.claudeSessionId !== task.id) throw new Error('Invalid task ownership');
          if (['dispatching', 'sent'].includes(task.delivery)) {
            task.delivery = this.host.hasReport(task.reportId) ? 'delivered' : 'delivery_unknown';
          }
          if (task.state === 'launching') task.state = 'startup_unknown';
          if (task.submission === 'submitting') task.submission = 'submission_unknown';
        }
      } catch (e) { if (e.code !== 'ENOENT') throw e; }
      this.startWatcher();
      await this.drain();
      this.subscribe();
      await this.save();
      this.update();
    });
  }
  assertCurrent() {
    if (this.closed || !this.host.isCurrent(this.parentId)) throw new Error('Parent session is inactive');
  }
  startWatcher() {
    this.watcher?.close();
    this.watcher = this.watchDirectory(join(this.root, 'events'), () => {
      this.serial(() => this.drain()).catch(() => this.alert('Hook reconciliation failed; recover explicitly.'));
    });
    this.watcher.unref?.();
    this.watcher.on('error', () => { this.monitoring = 'degraded'; this.update(); this.alert('Hook watcher failed; recover explicitly.'); });
  }
  alert(text) { if (!this.closed && this.host.isCurrent(this.parentId)) this.host.alert(text); }
  update() { if (!this.closed && this.host.isCurrent(this.parentId)) this.host.status(this.snapshot()); }
  snapshot() {
    return { monitoring: this.monitoring, tasks: this.tasks.map(({ id, name, state, paneId, submission, delivery, tool, reportId, report, observedModel }) => ({ id, name, state, paneId, submission, delivery, tool, reportId, report, observedModel })) };
  }
  subscribe() {
    this.unsubscribe?.(); this.unsubscribe = null;
    const panes = this.tasks.filter(t => t.paneId && !isTerminal(t)).map(t => t.paneId);
    if (!panes.length) { this.monitoring = 'hooks_only'; return; }
    try {
      this.unsubscribe = this.transport.subscribe(panes, event => {
        this.serial(async () => { await this.drain(); await this.observe(event); }).catch(() => this.alert('Pane observation failed; recover explicitly.'));
      }, () => { this.monitoring = 'degraded'; this.update(); this.alert('Pane event monitoring disconnected; hooks still record events. Recover explicitly.'); });
      this.monitoring = 'subscribed';
    } catch { this.monitoring = 'degraded'; this.alert('Pane event monitoring unavailable; hooks still record events.'); }
  }
  start(request) {
    return this.serial(async () => {
      this.assertCurrent();
      if (!/^[a-z][a-z0-9_-]{0,31}$/.test(request.name) || !/^claude-[a-z0-9.-]{1,100}$/.test(request.model) || !['low', 'medium', 'high', 'xhigh', 'max'].includes(request.effort) || !['right', 'down'].includes(request.direction)) throw new Error('Invalid name, exact Claude model, effort, or direction');
      if (typeof request.task !== 'string' || !request.task.trim() || request.task.length > 16000) throw new Error('Task must be 1–16000 characters');
      if (this.tasks.length >= 32) throw new Error('MVP session task limit reached (32)');
      if (this.tasks.some(t => t.name === request.name && !isTerminal(t))) throw new Error('Task name already active');
      const cwdStat = await stat(request.cwd);
      if (!cwdStat.isDirectory()) throw new Error('cwd must be a directory');
      const id = randomUUID();
      const task = { id, claudeSessionId: id, parentId: this.parentId, name: request.name, model: request.model, effort: request.effort, cwd: request.cwd, state: 'launching', submission: 'not_submitted', delivery: 'none', reportId: `${id}:completion`, lastAt: 0, hookStarted: false, seen: [] };
      this.tasks.push(task);
      const dir = join(this.root, id);
      await mkdir(dir, { mode: 0o700 });
      const configPath = join(dir, 'relay.json');
      const settingsPath = join(dir, 'settings.json');
      await writeJson(configPath, { taskId: id, claudeSessionId: id, parentId: this.parentId, eventsDir: join(this.root, 'events') });
      await writeJson(settingsPath, hookSettings(RELAY, configPath, process.execPath));
      await this.save();
      try {
        this.assertCurrent();
        task.paneId = await this.transport.createPane(request.cwd, request.direction);
        await this.save();
        this.assertCurrent();
        this.subscribe();
        await this.transport.start(`clb-${id.slice(0, 8)}`, task.paneId, ['--model', request.model, '--effort', request.effort, '--permission-mode', 'manual', '--session-id', id, '--settings', settingsPath]);
        await this.drain();
        task.state = task.hookStarted ? 'ready' : 'startup_unknown';
        await this.save();
        // Fail closed if the relay did not handshake; no blind submission.
        if (task.hookStarted) await this.submitTask(task, request.task);
        else this.alert(`Claude ${task.name}: no hook handshake; inspect its pane and recover.`);
      } catch {
        // agent_not_ready/timeout may still have launched Claude. Never retry launch.
        await this.drain();
        task.state = task.paneId ? 'startup_unknown' : 'failed';
        if (!task.paneId) task.report = { outcome: 'failed', summary: 'Pane creation failed; no Claude launch confirmed.' };
        await this.save();
        this.alert(`Claude ${task.name}: launch or submission unconfirmed; owned pane retained.`);
      }
      this.update();
      await this.deliver();
      return this.snapshot();
    });
  }
  async submitTask(task, text) {
    this.assertCurrent();
    if (typeof text !== 'string' || !text.trim() || text.length > 16000) throw new Error('Task must be 1–16000 characters');
    if (task.submission !== 'not_submitted' || !task.hookStarted || isTerminal(task)) throw new Error('Submission refused: task is not ready or may already have been submitted');
    const pane = await this.transport.inspect(task.paneId);
    if (pane?.agent !== 'claude' || pane.agent_session?.kind !== 'id' || pane.agent_session.value !== task.claudeSessionId || !['idle', 'done'].includes(pane.agent_status)) throw new Error('Owned Claude session is not confirmed ready; resolve startup or permissions in its pane');
    task.submission = 'submitting'; await this.save();
    try {
      this.assertCurrent();
      await this.transport.prompt(task.paneId, taskPrompt(task.id, text));
      task.submission = 'submitted'; task.state = 'submitted';
    } catch {
      task.submission = 'submission_unknown'; task.state = 'submission_unknown';
      throw new Error('Prompt may have been delivered; automatic resubmission is forbidden');
    } finally { await this.save(); }
  }
  submit(id, text) { return this.serial(async () => { await this.drain(); const task = this.find(id); await this.submitTask(task, text); this.update(); return this.snapshot(); }); }
  find(id) { const task = this.tasks.find(t => t.id === id); if (!task) throw new Error('Unknown task ID in this parent session'); return task; }
  async drain() {
    if (this.closed) return;
    const files = (await readdir(join(this.root, 'events'))).filter(f => /^\d+-[0-9a-f-]{36}\.json$/.test(f)).sort();
    for (const file of files) {
      const path = join(this.root, 'events', file);
      if ((await stat(path)).size > MAX_EVENT_BYTES) continue;
      let event; try { event = JSON.parse(await readFile(path, 'utf8')); } catch { continue; }
      const task = this.tasks.find(t => t.id === event.taskId);
      if (!task || event.version !== 1 || event.parentId !== this.parentId || event.claudeSessionId !== task.claudeSessionId || !HOOKS.includes(event.type) || !Number.isSafeInteger(event.at) || typeof event.id !== 'string' || task.seen.includes(event.id)) continue;
      if (task.seen.length >= 4096) { this.alert('Task hook-event limit reached; inspection required.'); continue; }
      task.seen.push(event.id);
      this.apply(task, event);
      await this.save();
    }
    await this.deliver(); this.update();
  }
  apply(task, event) {
    if (isTerminal(task)) return;
    if (event.type === 'SessionStart') {
      task.hookStarted = true; task.observedModel = safeText(event.model, 120) || 'unknown'; return;
    }
    if (event.at < task.lastAt) return;
    task.lastAt = event.at;
    if (event.type === 'UserPromptSubmit') {
      if (event.matchesTask || task.active) { task.active = true; task.state = 'working'; task.submission = 'submitted'; }
      return;
    }
    if (!task.active) return;
    if (event.type === 'PermissionRequest' || (event.type === 'Notification' && event.permission) || event.needsInput) {
      if (task.state !== 'blocked') this.alert(`Claude ${task.name} needs a human decision in ${task.paneId}.`);
      task.state = 'blocked';
    } else if (['PreToolUse', 'PostToolUse', 'PostToolUseFailure'].includes(event.type)) {
      task.state = 'working'; task.tool = safeText(event.tool, 120);
    } else if (event.type === 'Stop') {
      if (event.backgroundPending) { task.state = 'background_pending'; return; }
      if (event.report?.outcome === 'needs_input') { task.state = 'blocked'; this.alert(`Claude ${task.name} needs input in ${task.paneId}.`); return; }
      task.state = event.report?.outcome === 'completed' ? 'completed' : event.report?.outcome === 'failed' ? 'failed' : 'response_finished';
      task.report = ['completed', 'failed'].includes(event.report?.outcome) ? { outcome: event.report.outcome, summary: safeText(event.report.summary), verification: safeText(event.report.verification, 600), risks: safeText(event.report.risks, 600) } : { outcome: 'unknown', summary: 'Claude finished a response without a valid structured task report; task success is unknown.' };
    } else if (event.type === 'StopFailure') {
      task.state = 'failed'; task.report = { outcome: 'failed', summary: `Claude reported a model/API failure (${event.error || 'unknown'}). No automatic retry.` };
    } else if (event.type === 'SessionEnd') {
      task.state = 'crashed'; task.report = { outcome: 'unknown', summary: 'Claude session ended before a task report. Exit reason and success are unknown.' };
    }
  }
  async observe(event) {
    if (this.closed) return;
    const data = event.data;
    const task = this.tasks.find(t => t.paneId === data?.pane_id && !isTerminal(t));
    if (event.event === 'pane_moved') {
      const moved = this.tasks.find(t => t.paneId === data?.previous_pane_id && !isTerminal(t));
      if (moved && data.pane?.pane_id) { moved.paneId = data.pane.pane_id; await this.save(); this.subscribe(); }
      return;
    }
    if (!task) return;
    if (['pane_closed', 'pane_exited'].includes(event.event) || (event.event === 'pane_agent_detected' && data.agent === null && task.hookStarted)) {
      task.state = 'crashed'; task.report = { outcome: 'unknown', summary: 'Owned pane or Claude occupant disappeared before completion; task success is unknown.' };
    } else if (event.event === 'pane.agent_status_changed' && data.agent_status === 'blocked') {
      task.state = 'blocked'; this.alert(`Claude ${task.name} is blocked in ${task.paneId}; a human must inspect it.`);
    }
    await this.save(); await this.deliver(); this.update();
  }
  async deliver() {
    if (this.closed || !this.host.isCurrent(this.parentId)) return;
    for (const task of this.tasks.filter(t => isTerminal(t) && t.delivery === 'none')) {
      if (this.host.hasReport(task.reportId)) { task.delivery = 'delivered'; await this.save(); continue; }
      task.delivery = 'dispatching'; await this.save();
      if (this.closed || !this.host.isCurrent(this.parentId)) { task.delivery = 'none'; await this.save(); return; }
      try {
        // Synchronous enqueue, not durable acknowledgement. Persist ambiguity first.
        this.host.send({ reportId: task.reportId, parentId: this.parentId, taskId: task.id, name: task.name, paneId: task.paneId, state: task.state, requestedModel: task.model, observedModel: task.observedModel || 'unknown', report: task.report, selfReported: true });
        task.delivery = this.host.hasReport(task.reportId) ? 'delivered' : 'sent';
      } catch { task.delivery = 'delivery_unknown'; this.alert(`Claude ${task.name}: parent report delivery is ambiguous. Inspect the transcript; no automatic resend.`); }
      await this.save();
    }
  }
  cancel(id) {
    return this.serial(async () => {
      this.assertCurrent();
      await this.drain(); const task = this.find(id);
      if (isTerminal(task)) return this.snapshot();
      if (!task.paneId) throw new Error('No owned pane is known');
      // Sending Escape cancels a turn, not the CLI process. No destructive cleanup.
      this.assertCurrent();
      await this.transport.interrupt(task.paneId, task.claudeSessionId);
      task.state = 'cancelled'; task.report = { outcome: 'cancelled', summary: 'Bridge task retired after Escape was sent. Claude turn/process termination is NOT confirmed; pane and session are retained.' };
      await this.save(); await this.deliver(); this.subscribe(); this.update(); return this.snapshot();
    });
  }
  recover() {
    return this.serial(async () => {
      this.assertCurrent();
      this.startWatcher();
      await this.drain();
      for (const task of this.tasks.filter(t => !isTerminal(t) && t.paneId)) {
        try {
          const pane = await this.transport.inspect(task.paneId);
          if (pane?.agent === 'claude' && pane.agent_session?.kind === 'id' && pane.agent_session.value === task.claudeSessionId) {
            task.state = pane.agent_status === 'blocked' ? 'blocked' : task.active ? 'observation_unknown' : 'ready';
          } else task.state = 'ownership_unknown';
        } catch { task.state = 'observation_unknown'; }
      }
      this.subscribe(); await this.save(); this.update(); return this.snapshot();
    });
  }
  async close() {
    // Set before waiting so queued events cannot route to a replacement session.
    this.closed = true;
    this.watcher?.close(); this.watcher = null;
    this.unsubscribe?.(); this.unsubscribe = null;
    await this.tail;
    // Child panes remain human-owned interactive terminals. No keys or closes.
  }
}
