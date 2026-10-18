import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { join, resolve } from 'node:path';

// Optional host-contract test; only registers the factory, never starts a session.
// PI_PACKAGE_ROOT points to the installed Pi package, not an agent directory.
test('real Pi loader accepts the extension and registers five tools without lifecycle resources', { skip: !process.env.PI_PACKAGE_ROOT }, async () => {
  process.env.JITI_FS_CACHE = 'false';
  const { loadExtensions } = await import(pathToFileURL(join(process.env.PI_PACKAGE_ROOT, 'dist/core/extensions/loader.js')).href);
  const loaded = await loadExtensions([resolve('src/extension.ts')], process.cwd());
  assert.deepEqual(loaded.errors, []);
  assert.equal(loaded.extensions.length, 1);
  const extension = loaded.extensions[0];
  assert.equal(extension.tools.size, 5);
  assert(extension.handlers.has('session_start'));
  assert(extension.handlers.has('session_shutdown'));
  assert(!extension.tools.has('subagent'));
});
