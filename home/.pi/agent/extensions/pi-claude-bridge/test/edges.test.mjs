import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import { ClaudeAdapter } from '../src/adapter.mjs';
import { projectHook } from '../src/hooks.mjs';
import { HerdrTransport } from '../src/herdr.mjs';

async function setup(t, extra = {}) {
  await mkdir('.test-tmp', { recursive: true });
  const root = await mkdtemp(join(process.cwd(), '.test-tmp', 'edges-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const reports = [], starts = [], interrupts = [], watcherList = [];
  const transport = {
    createPane: async () => 'owned:pane',
    start: async (...args) => starts.push(args),
    subscribe: () => () => {}, inspect: async () => null,
    interrupt: async id => interrupts.push(id), prompt: async () => {}, ...extra,
  };
  const adapter = new ClaudeAdapter({ root, parentId: 'parent', transport, host: { isCurrent: () => true, hasReport: () => false, send: r => reports.push(r), alert() {}, status() {} }, watchDirectory: () => { const w = new EventEmitter(); w.unref = () => {}; w.close = () => { w.closed = true; }; watcherList.push(w); return w; } });
  await adapter.open(); t.after(() => adapter.close());
  const request = { name: 'build', model: 'claude-opus-5', effort: 'high', direction: 'right', task: 'bounded task', cwd: process.cwd() };
  return { root, adapter, reports, starts, transport, request, watcherList };
}

test('shutdown during pane creation prevents subsequent Claude launch or prompt submission', async t => {
  let release, signalCreated;
  const created = new Promise(resolve => { signalCreated = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  const f = await setup(t, { createPane: async () => { signalCreated(); await gate; return 'owned:pane'; } });
  const launching = f.adapter.start(f.request); await created;
  const closing = f.adapter.close(); release(); await Promise.all([launching, closing]);
  assert.equal(f.starts.length, 0); assert.equal(f.reports.length, 0);
  assert.equal(f.adapter.tasks[0].paneId, 'owned:pane');
});

test('pane creation failure produces one sanitized launch failure without executing Claude', async t => {
  const f = await setup(t, { createPane: async () => { throw new Error('private details'); } });
  await f.adapter.start(f.request);
  assert.equal(f.starts.length, 0); assert.equal(f.reports.length, 1); assert.equal(f.adapter.tasks[0].state, 'failed');
  assert(!JSON.stringify(f.reports).includes('private details'));
});

test('a moved owned pane follows the returned ID, not the old pane or label', async t => {
  const f = await setup(t); await f.adapter.start(f.request); const task = f.adapter.tasks[0];
  await f.adapter.observe({ event: 'pane_moved', data: { previous_pane_id: 'owned:pane', pane: { pane_id: 'moved:pane' } } });
  assert.equal(task.paneId, 'moved:pane');
  await f.adapter.observe({ event: 'pane_closed', data: { pane_id: 'owned:pane' } }); assert.equal(f.reports.length, 0);
  await f.adapter.observe({ event: 'pane_closed', data: { pane_id: 'moved:pane' } }); assert.equal(f.reports.length, 1);
});

test('recovery replaces hook watcher instead of falsely claiming a broken watcher recovered', async t => {
  const f = await setup(t); f.watcherList[0].emit('error', new Error('failure'));
  await f.adapter.recover(); assert(f.watcherList[0].closed); assert.equal(f.watcherList.length, 2);
  await f.adapter.close(); assert(f.watcherList[1].closed);
});

test('relay session handshake allows an explicit first submission after human startup intervention', async t => {
  const f = await setup(t); await f.adapter.start(f.request); const task = f.adapter.tasks[0];
  const event = projectHook({ session_id: task.id, hook_event_name: 'SessionStart' }, { taskId: task.id, parentId: 'parent', claudeSessionId: task.id });
  await writeFile(join(f.root, 'events', `${event.at}-${event.id}.json`), JSON.stringify(event));
  f.transport.inspect = async () => ({ agent: 'claude', agent_status: 'idle', agent_session: { kind: 'id', value: task.id } });
  let prompts = 0; f.transport.prompt = async () => { prompts++; };
  await f.adapter.submit(task.id, 'first prompt'); assert.equal(prompts, 1);
  await assert.rejects(f.adapter.submit(task.id, 'second prompt'), /Submission refused/);
});

test('malformed or oversized socket input surfaces monitoring failure once', () => {
  const socket = new EventEmitter(); let errors = 0;
  socket.setEncoding = () => {}; socket.write = () => {}; socket.unref = () => {}; socket.destroy = () => {};
  const transport = new HerdrTransport({ env: { HERDR_ENV: '1', HERDR_SOCKET_PATH: '/mock/socket' }, connect: () => socket });
  const close = transport.subscribe([], () => assert.fail('no event'), () => { errors++; });
  socket.emit('data', 'x'.repeat(1048577)); socket.emit('error', new Error('failure'));
  assert.equal(errors, 1); close();
});
