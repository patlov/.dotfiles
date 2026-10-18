import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { ClaudeAdapter } from '../src/adapter.mjs';
import { projectHook } from '../src/hooks.mjs';

async function fixture(t, overrides = {}) {
  const tmpRoot = join(process.cwd(), '.test-tmp'); await mkdir(tmpRoot, { recursive: true });
  const root = await mkdtemp(join(tmpRoot, 'adapter-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  let current = true;
  const reports = [], alerts = [], calls = [], watchers = [];
  const host = {
    isCurrent: () => current, hasReport: id => reports.some(r => r.reportId === id),
    send: report => reports.push(report), alert: message => alerts.push(message), status() {},
    ...overrides.host,
  };
  const writeEvent = async event => {
    await writeFile(join(root, 'events', `${event.at}-${event.id}.json`), JSON.stringify(event));
  };
  let sessionId;
  const transport = {
    createPane: async (...args) => { calls.push(['create', ...args]); return 'w1:p2'; },
    start: async (...args) => {
      calls.push(['start', ...args]); sessionId = args[2][args[2].indexOf('--session-id') + 1];
      await writeEvent(projectHook({ session_id: sessionId, hook_event_name: 'SessionStart', model: 'claude-opus-5' }, { taskId: sessionId, parentId: 'parent', claudeSessionId: sessionId }));
    },
    inspect: async paneId => ({ pane_id: paneId, agent: 'claude', agent_status: 'idle', agent_session: { kind: 'id', value: sessionId } }),
    prompt: async (...args) => calls.push(['prompt', ...args]),
    interrupt: async (...args) => calls.push(['interrupt', ...args]),
    subscribe: (panes, event, error) => { transport.event = event; transport.error = error; calls.push(['subscribe', panes]); return () => calls.push(['unsubscribe']); },
    ...overrides.transport,
  };
  const watchDirectory = () => {
    const watcher = new EventEmitter(); watcher.closed = false; watcher.unref = () => {};
    watcher.close = () => { watcher.closed = true; }; watchers.push(watcher); return watcher;
  };
  const create = () => new ClaudeAdapter({ root, parentId: 'parent', transport, host, watchDirectory });
  const adapter = create(); await adapter.open(); t.after(() => adapter.close());
  const start = async () => {
    await adapter.start({ name: 'build-api', model: 'claude-opus-5', effort: 'high', direction: 'right', cwd: process.cwd(), task: 'A bounded task' });
    return adapter.tasks[0];
  };
  let sequence = 0;
  const hook = async (task, type, extra = {}) => {
    const event = projectHook({ session_id: task.id, hook_event_name: type, ...extra }, { taskId: task.id, parentId: 'parent', claudeSessionId: task.id });
    event.at = Date.now() + ++sequence;
    await writeEvent(event); await adapter.serial(() => adapter.drain()); return event;
  };
  const activate = task => hook(task, 'UserPromptSubmit', { prompt: `[bridge-task:${task.id}] work` });
  const complete = task => hook(task, 'Stop', { last_assistant_message: JSON.stringify({ taskId: task.id, outcome: 'completed', summary: 'Changed code', verification: 'tests passed', risks: 'none' }) });
  return { root, adapter, create, reports, alerts, calls, transport, watchers, start, hook, activate, complete, writeEvent, setCurrent: value => { current = value; } };
}

test('construction is resource-free and launch uses an owned visible pane/manual permissions', async t => {
  const f = await fixture(t); assert.equal(f.calls.length, 0);
  const task = await f.start();
  assert.equal(task.state, 'submitted'); assert.equal(task.submission, 'submitted');
  const args = f.calls.find(c => c[0] === 'start')[3];
  assert.equal(args[args.indexOf('--permission-mode') + 1], 'manual');
  assert(!args.includes('--dangerously-skip-permissions')); assert(!args.includes('--print'));
  assert.equal(f.calls.filter(c => c[0] === 'prompt').length, 1);
  const state = await readFile(join(f.root, 'state.json'), 'utf8');
  assert(!state.includes('A bounded task')); // Prompt is not persisted by bridge.
  assert.equal((await readdir(f.root)).filter(n => n.endsWith('.tmp')).length, 0);
});

test('structured report delivers once despite duplicate hooks, repeated drains and reload', async t => {
  const f = await fixture(t); const task = await f.start(); await f.activate(task);
  const event = await f.complete(task);
  await f.writeEvent({ ...event, id: randomUUID(), at: event.at + 1 });
  await f.adapter.serial(() => f.adapter.drain());
  assert.equal(f.reports.length, 1); assert.equal(task.delivery, 'delivered');
  await f.adapter.close(); const resumed = f.create(); await resumed.open();
  assert.equal(f.reports.length, 1); assert.equal(resumed.tasks[0].state, 'completed'); await resumed.close();
});

test('greeting plus JSON report is projected and delivered to the parent as completed', async t => {
  const f = await fixture(t); const task = await f.start(); await f.activate(task);
  await f.hook(task, 'Stop', { last_assistant_message: `Hello! Hope your day is going well.\n\n${JSON.stringify({ taskId: task.id, outcome: 'completed', summary: 'Returned greeting: "Hello! Hope your day is going well."', verification: 'No tools used', risks: 'None' })}` });
  assert.equal(task.state, 'completed'); assert.equal(f.reports.length, 1);
  assert.equal(f.reports[0].report.outcome, 'completed');
  assert.match(f.reports[0].report.summary, /Hello!/);
});

test('permission blocks and human recovery do not auto-answer or create parent turns', async t => {
  const f = await fixture(t); const task = await f.start(); await f.activate(task);
  await f.hook(task, 'PermissionRequest', { tool_name: 'Bash', tool_input: { command: 'SECRET' } });
  assert.equal(task.state, 'blocked'); assert.equal(f.reports.length, 0); assert.equal(f.alerts.length, 1);
  await f.hook(task, 'PostToolUse', { tool_name: 'Bash' }); assert.equal(task.state, 'working');
  assert(!f.calls.some(c => c[0] === 'interrupt')); assert(!JSON.stringify(task).includes('SECRET'));
});

test('non-JSON Stop is response_finished, not successful completion; background work stays pending', async t => {
  const f = await fixture(t); const task = await f.start(); await f.activate(task);
  await f.hook(task, 'Stop', { last_assistant_message: 'not done', background_tasks: [{}] });
  assert.equal(task.state, 'background_pending'); assert.equal(f.reports.length, 0);
  await f.hook(task, 'Stop', { last_assistant_message: 'secret arbitrary prose' });
  assert.equal(task.state, 'response_finished'); assert.equal(f.reports[0].report.outcome, 'unknown');
  assert(!JSON.stringify(f.reports).includes('secret arbitrary prose'));
});

test('wrong session, wrong parent and a Stop before task activation cannot complete a task', async t => {
  const f = await fixture(t); const task = await f.start();
  assert.equal(projectHook({ session_id: randomUUID(), hook_event_name: 'Stop' }, { claudeSessionId: task.id }), null);
  assert.equal(projectHook({ session_id: task.id, agent_id: 'nested', hook_event_name: 'Stop' }, { claudeSessionId: task.id }), null);
  await f.complete(task); assert.equal(f.reports.length, 0);
  await f.activate(task);
  await f.writeEvent({ version: 1, id: randomUUID(), at: Date.now() + 10, parentId: 'other', taskId: task.id, claudeSessionId: task.id, type: 'Stop' });
  await f.adapter.serial(() => f.adapter.drain()); assert.equal(f.reports.length, 0);
});

test('needs_input is not completion and StopFailure is a bounded failure without raw provider details', async t => {
  const f = await fixture(t); const task = await f.start(); await f.activate(task);
  await f.hook(task, 'Stop', { last_assistant_message: JSON.stringify({ taskId: task.id, outcome: 'needs_input', summary: 'question' }) });
  assert.equal(task.state, 'blocked'); assert.equal(f.reports.length, 0);
  await f.hook(task, 'StopFailure', { error: 'rate_limit', error_details: 'a password' });
  assert.equal(task.state, 'failed'); assert.equal(f.reports.length, 1); assert(!JSON.stringify(f.reports).includes('a password'));
});

test('cancel retires task only, retains pane and ignores late completion', async t => {
  const f = await fixture(t); const task = await f.start(); await f.activate(task);
  await f.adapter.cancel(task.id); await f.complete(task);
  assert.equal(task.state, 'cancelled'); assert.equal(f.reports.length, 1);
  assert.match(f.reports[0].report.summary, /NOT confirmed/);
  assert.equal(f.calls.filter(c => c[0] === 'interrupt').length, 1);
  assert(!f.calls.some(c => c[0] === 'close'));
});

test('pane crash produces a facts-only report; other panes and idle/done never imply task success', async t => {
  const f = await fixture(t); const task = await f.start(); await f.activate(task);
  await f.adapter.serial(() => f.adapter.observe({ event: 'pane_closed', data: { pane_id: 'user:pane' } }));
  await f.adapter.serial(() => f.adapter.observe({ event: 'pane.agent_status_changed', data: { pane_id: task.paneId, agent_status: 'done' } }));
  assert.equal(f.reports.length, 0);
  await f.adapter.serial(() => f.adapter.observe({ event: 'pane_closed', data: { pane_id: task.paneId } }));
  assert.equal(task.state, 'crashed'); assert.equal(f.reports[0].report.outcome, 'unknown');
});

test('shutdown is idempotent; hooks recorded offline recover only to the original parent', async t => {
  const f = await fixture(t); const task = await f.start(); await f.activate(task);
  await f.adapter.close(); await f.adapter.close(); assert(f.watchers.every(w => w.closed));
  await f.complete(task); assert.equal(f.reports.length, 0);
  const resumed = f.create(); await resumed.open(); assert.equal(f.reports.length, 1); await resumed.close();
});

test('replacement parent suppresses delivery instead of leaking child report', async t => {
  const f = await fixture(t); const task = await f.start(); await f.activate(task); f.setCurrent(false);
  await f.complete(task); assert.equal(f.reports.length, 0); assert.equal(task.delivery, 'none');
  f.setCurrent(true); await f.adapter.serial(() => f.adapter.drain()); assert.equal(f.reports.length, 1);
});

test('void sendMessage has an explicit ambiguous crash window and no automatic replay', async t => {
  const f = await fixture(t, { host: { hasReport: () => false } });
  const task = await f.start(); await f.activate(task); await f.complete(task);
  assert.equal(task.delivery, 'sent'); await f.adapter.close();
  const resumed = f.create(); await resumed.open();
  assert.equal(resumed.tasks[0].delivery, 'delivery_unknown'); assert.equal(f.reports.length, 1); await resumed.close();
});

test('send failure remains delivery_unknown and duplicate events never retry', async t => {
  let attempts = 0;
  const f = await fixture(t, { host: { send: () => { attempts++; throw new Error('SECRET'); } } });
  const task = await f.start(); await f.activate(task); await f.complete(task);
  await f.adapter.serial(() => f.adapter.drain());
  assert.equal(task.delivery, 'delivery_unknown'); assert.equal(attempts, 1); assert(!JSON.stringify(f.alerts).includes('SECRET'));
});

test('startup uncertainty retains pane; submit never retries ambiguous delivery', async t => {
  const f = await fixture(t, { transport: { prompt: async () => { throw new Error('transport'); } } });
  const task = await f.start(); assert.equal(task.submission, 'submission_unknown');
  await assert.rejects(f.adapter.submit(task.id, 'retry'), /Submission refused/);
  assert.equal(f.calls.filter(c => c[0] === 'start').length, 1); assert.equal(f.reports.length, 0);
});

test('missing hook handshake fails closed before first prompt', async t => {
  const f = await fixture(t, { transport: { start: async () => {} } }); const task = await f.start();
  assert.equal(task.state, 'startup_unknown'); assert.equal(task.submission, 'not_submitted');
  assert(!f.calls.some(c => c[0] === 'prompt'));
});

test('watch and subscription failures surface degraded monitoring without fake crash reports', async t => {
  const f = await fixture(t); const task = await f.start();
  f.transport.error(); f.watchers[0].emit('error', new Error('secret'));
  assert.equal(f.adapter.monitoring, 'degraded'); assert.equal(f.reports.length, 0);
  await f.adapter.recover(); assert.equal(task.state, 'ready'); assert.equal(f.adapter.monitoring, 'subscribed');
});

test('invalid native options are rejected before pane creation', async t => {
  const f = await fixture(t);
  await assert.rejects(f.adapter.start({ name: 'build', model: '--dangerously-skip-permissions', effort: 'high', direction: 'right', task: 'task', cwd: process.cwd() }), /Invalid/);
  assert.equal(f.calls.length, 0);
});
