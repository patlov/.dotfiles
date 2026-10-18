import { readFile, writeFile, rename, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { MAX_INPUT_BYTES, projectHook } from './hooks.mjs';

// This hook only observes. It emits no permission decisions or hook feedback.
try {
  const config = JSON.parse(await readFile(process.argv[2], 'utf8'));
  const chunks = [];
  let length = 0;
  for await (const chunk of process.stdin) {
    length += chunk.length;
    if (length > MAX_INPUT_BYTES) throw new Error('input too large');
    chunks.push(chunk);
  }
  const event = projectHook(JSON.parse(Buffer.concat(chunks).toString('utf8')), config);
  if (event) {
    const files = await readdir(config.eventsDir);
    const critical = ['UserPromptSubmit', 'PermissionRequest', 'Stop', 'StopFailure', 'SessionEnd'].includes(event.type);
    // Backpressure drops redundant progress, not task settlement evidence.
    if (files.length < 512 || critical) {
      const path = join(config.eventsDir, `${event.at}-${event.id}.json`);
      const temp = `${path}.tmp`;
      await writeFile(temp, JSON.stringify(event), { mode: 0o600, flag: 'wx' });
      await rename(temp, path);
    }
  }
} catch {
  // A fixed message only; never echo hook input, prompts, paths, or CLI stderr.
  process.stderr.write('Claude bridge observation failed; native permissions remain unchanged.\n');
  process.exitCode = 1;
}
