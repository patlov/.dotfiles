import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createConnection } from 'node:net';
import { randomUUID } from 'node:crypto';
const exec = promisify(execFile);

export class HerdrError extends Error {
  constructor(code) { super(`Herdr operation failed (${code}); inspect the owned pane, not raw logs.`); this.code = code; }
}

export class HerdrTransport {
  constructor({ env = process.env, run = exec, connect = createConnection } = {}) {
    this.env = env; this.run = run; this.connect = connect;
  }
  async command(args) {
    if (this.env.HERDR_ENV !== '1') throw new HerdrError('not_in_herdr');
    try {
      const { stdout } = await this.run(this.env.HERDR_BIN_PATH || 'herdr', args, { env: this.env, timeout: 40000, maxBuffer: 1048576 });
      const result = JSON.parse(stdout);
      if (result.error) throw new HerdrError(result.error.code || 'server_error');
      return result.result;
    } catch (e) {
      if (e instanceof HerdrError) throw e;
      let code = 'transport_error';
      try { code = JSON.parse(e.stderr).error?.code || code; } catch { /* Do not expose stderr. */ }
      throw new HerdrError(/^[a-z_]{1,80}$/.test(code) ? code : 'transport_error');
    }
  }
  async createPane(cwd, direction) {
    const result = await this.command(['pane', 'split', '--current', '--direction', direction, '--cwd', cwd, '--no-focus']);
    const id = result?.pane?.pane_id;
    if (typeof id !== 'string' || !id) throw new HerdrError('invalid_pane_response');
    return id;
  }
  start(name, paneId, args) {
    return this.command(['agent', 'start', name, '--kind', 'claude', '--pane', paneId, '--timeout', '30000', '--', ...args]);
  }
  prompt(paneId, text) { return this.command(['agent', 'prompt', paneId, text]); }
  async interrupt(paneId, sessionId) {
    const pane = await this.inspect(paneId);
    // Refuse keys if a user has replaced the pane occupant or session.
    if (pane?.agent !== 'claude' || pane.agent_session?.kind !== 'id' || pane.agent_session.value !== sessionId) throw new HerdrError('ownership_unconfirmed');
    return this.command(['agent', 'send-keys', paneId, 'esc']);
  }
  async inspect(paneId) {
    const result = await this.command(['pane', 'get', paneId]);
    return result?.pane;
  }
  subscribe(paneIds, onEvent, onError) {
    if (!this.env.HERDR_SOCKET_PATH || this.env.HERDR_ENV !== '1') throw new HerdrError('socket_unavailable');
    const socket = this.connect(this.env.HERDR_SOCKET_PATH);
    const id = randomUUID();
    let buffer = ''; let closed = false; let acknowledged = false;
    const fail = () => { if (!closed) { closed = true; socket.destroy(); onError('Herdr event monitoring disconnected; recover explicitly.'); } };
    const timer = setTimeout(fail, 5000); timer.unref();
    socket.on('connect', () => socket.write(JSON.stringify({ id, method: 'events.subscribe', params: { subscriptions: [
      { type: 'pane.closed' }, { type: 'pane.exited' }, { type: 'pane.agent_detected' }, { type: 'pane.moved' },
      ...paneIds.map(pane_id => ({ type: 'pane.agent_status_changed', pane_id })),
    ] } }) + '\n'));
    socket.setEncoding('utf8');
    socket.on('data', chunk => {
      buffer += chunk;
      if (buffer.length > 1048576) return fail();
      let pos;
      while ((pos = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, pos); buffer = buffer.slice(pos + 1);
        try {
          const message = JSON.parse(line);
          if (message.id === id) {
            if (message.error) return fail();
            acknowledged = true; clearTimeout(timer);
          } else if (acknowledged && message.event && message.data) onEvent(message);
        } catch { return fail(); }
      }
    });
    socket.on('error', fail); socket.on('close', fail); socket.unref();
    return () => { closed = true; clearTimeout(timer); socket.destroy(); };
  }
}
