import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, mkdir, readFile, readdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { hookSettings, projectHook, safeText } from '../src/hooks.mjs';
import { HerdrTransport } from '../src/herdr.mjs';
const config = { taskId: 'task', parentId: 'parent', claudeSessionId: 'session' };

test('projection discards tool inputs/results/transcript paths and bounds reports', () => {
  const progress = projectHook({ session_id: 'session', hook_event_name: 'PostToolUse', tool_name: 'Read', tool_input: { file_path: '.env' }, tool_response: 'private-tool-output', transcript_path: '/private' }, config);
  assert(!JSON.stringify(progress).includes('private-tool-output')); assert(!JSON.stringify(progress).includes('/private'));
  const event = projectHook({ session_id: 'session', hook_event_name: 'Stop', last_assistant_message: JSON.stringify({ taskId: 'task', outcome: 'completed', summary: 'Changed code', verification: 'x'.repeat(10000), risks: 'none', extra: 'private' }) }, config);
  assert.equal(event.report.verification.length, 600); assert(!JSON.stringify(event).includes('private'));
  assert.equal(safeText('hello\x1b[31m'), 'hello[31m');
});

test('session-scoped hooks do not grant permissions or disable existing hooks', () => {
  const settings = hookSettings("/a b/it's.mjs", '/local/config.json', '/node');
  const permission = settings.hooks.PermissionRequest[0].hooks[0];
  assert.equal(permission.type, 'command'); assert.match(permission.command, /'\\''/);
  assert(!('permissions' in settings)); assert(!('disableAllHooks' in settings));
});

test('real local relay persists one bounded atomic event and emits no approval output', async t => {
  const base = join(process.cwd(), '.test-tmp'); await mkdir(base, { recursive: true });
  const root = await mkdtemp(join(base, 'relay-')); t.after(() => rm(root, { recursive: true, force: true }));
  const eventsDir = join(root, 'events'); await mkdir(eventsDir);
  const path = join(root, 'config.json'); await writeFile(path, JSON.stringify({ ...config, eventsDir }));
  const child = execFile(process.execPath, ['src/hook-relay.mjs', path]);
  const done = new Promise((res, rej) => child.on('error', rej).on('exit', code => code === 0 ? res() : rej(new Error(`exit ${code}`))));
  let output = ''; child.stdout.on('data', chunk => { output += chunk; });
  child.stdin.end(JSON.stringify({ session_id: 'session', hook_event_name: 'PermissionRequest', tool_name: 'Bash', tool_input: { command: 'private-command' } }));
  await done;
  const files = await readdir(eventsDir); assert.equal(files.length, 1); assert(files[0].endsWith('.json'));
  const event = await readFile(join(eventsDir, files[0]), 'utf8'); assert(!event.includes('private-command')); assert.equal(output, '');
});

test('native transport preserves cwd/focus and uses explicit IDs', async () => {
  const calls = [];
  const run = async (bin, args) => { calls.push([bin, args]); return { stdout: JSON.stringify({ result: { pane: { pane_id: 'w1:p9' } } }) }; };
  const transport = new HerdrTransport({ env: { HERDR_ENV: '1', HERDR_BIN_PATH: '/herdr' }, run });
  assert.equal(await transport.createPane('/trusted cwd', 'down'), 'w1:p9');
  assert.deepEqual(calls[0][1], ['pane', 'split', '--current', '--direction', 'down', '--cwd', '/trusted cwd', '--no-focus']);
  await transport.start('owned', 'w1:p9', ['--permission-mode', 'manual']);
  assert.deepEqual(calls[1][1].slice(0, 8), ['agent', 'start', 'owned', '--kind', 'claude', '--pane', 'w1:p9', '--timeout']);
  await transport.prompt('w1:p9', 'text'); assert(!calls[2][1].includes('--wait'));
});

test('refuse Herdr outside managed environment and do not expose CLI stderr', async () => {
  const outside = new HerdrTransport({ env: {}, run: () => assert.fail('must not execute') });
  await assert.rejects(outside.createPane('/', 'right'), /not_in_herdr/);
  const transport = new HerdrTransport({ env: { HERDR_ENV: '1' }, run: async () => { throw { stderr: 'private-provider-details' }; } });
  await assert.rejects(transport.command(['agent', 'get', 'owned']), error => !error.message.includes('private-provider-details') && error.code === 'transport_error');
});

test('interrupt refuses replacement occupants and sends only Escape to confirmed ownership', async () => {
  const transport = new HerdrTransport({ env: { HERDR_ENV: '1' } });
  transport.inspect = async () => ({ agent: 'pi', agent_session: { kind: 'id', value: 'session' } });
  transport.command = async () => assert.fail('must not send keys');
  await assert.rejects(transport.interrupt('owned', 'session'), /ownership_unconfirmed/);
  transport.inspect = async () => ({ agent: 'claude', agent_session: { kind: 'id', value: 'session' } });
  let args; transport.command = async value => { args = value; }; await transport.interrupt('owned', 'session');
  assert.deepEqual(args, ['agent', 'send-keys', 'owned', 'esc']);
});

test('socket subscription handles fragmented events and closes without error notices', async () => {
  const socket = new EventEmitter(); let request, destroyed = 0;
  socket.setEncoding = () => {}; socket.unref = () => {};
  socket.write = data => { request = JSON.parse(data); };
  socket.destroy = () => { destroyed++; };
  const events = [], errors = [];
  const transport = new HerdrTransport({ env: { HERDR_ENV: '1', HERDR_SOCKET_PATH: '/owned/socket' }, connect: () => socket });
  const close = transport.subscribe(['owned'], e => events.push(e), e => errors.push(e));
  socket.emit('connect'); assert.equal(request.method, 'events.subscribe');
  socket.emit('data', JSON.stringify({ id: request.id, result: {} }) + '\n');
  const event = JSON.stringify({ event: 'pane_closed', data: { pane_id: 'owned' } }) + '\n';
  socket.emit('data', event.slice(0, 10)); socket.emit('data', event.slice(10)); assert.equal(events.length, 1);
  close(); socket.emit('close'); assert.equal(errors.length, 0); assert.equal(destroyed, 1);
});
