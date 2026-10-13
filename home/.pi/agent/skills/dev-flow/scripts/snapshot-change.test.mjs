import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { checkSnapshot, collectSnapshot, writeSnapshot } from './snapshot-change.mjs';

const script = join(dirname(fileURLToPath(import.meta.url)), 'snapshot-change.mjs');
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'pi-change-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const repo = join(root, 'repo');
  mkdirSync(repo);
  const git = (...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' } });
  git('init', '-q');
  git('config', 'user.name', 'Fixture');
  git('config', 'user.email', 'fixture@example.invalid');
  git('config', 'commit.gpgsign', 'false');
  writeFileSync(join(repo, 'kept.txt'), 'before\n');
  writeFileSync(join(repo, 'deleted.txt'), 'old contract\n');
  writeFileSync(join(repo, '.gitignore'), 'ignored.txt\n');
  git('add', 'kept.txt', 'deleted.txt', '.gitignore');
  git('commit', '-qm', 'Baseline');
  const base = git('rev-parse', 'HEAD').trim();
  return { root, repo, git, base, out: join(root, 'evidence') };
}

test('combined evidence retains branch deletion, separate dirty layers and selected new content without changing Git', t => {
  const f = fixture(t);
  rmSync(join(f.repo, 'deleted.txt'));
  writeFileSync(join(f.repo, 'kept.txt'), 'committed\n');
  f.git('add', 'kept.txt', 'deleted.txt');
  f.git('commit', '-qm', 'Change contract');
  writeFileSync(join(f.repo, 'kept.txt'), 'staged\n');
  f.git('add', 'kept.txt');
  writeFileSync(join(f.repo, 'kept.txt'), 'unstaged\n');
  writeFileSync(join(f.repo, 'new file.txt'), 'new consumer\n');
  writeFileSync(join(f.repo, 'ignored.txt'), 'not evidence\n');
  const status = f.git('status', '--porcelain=v1');
  const index = readFileSync(join(f.repo, '.git', 'index'));
  const result = writeSnapshot({ ...f, scope: 'combined', includeUntracked: ['new file.txt'] });
  const manifest = JSON.parse(readFileSync(result.path));
  assert.match(readFileSync(join(f.out, 'branch.patch'), 'utf8'), /-old contract/);
  assert.match(readFileSync(join(f.out, 'staged.patch'), 'utf8'), /\+staged/);
  assert.match(readFileSync(join(f.out, 'unstaged.patch'), 'utf8'), /\+unstaged/);
  assert.deepEqual(manifest.changes.branch.map(change => change.path), ['deleted.txt', 'kept.txt']);
  assert.deepEqual(manifest.untracked.map(file => file.path), ['new file.txt']);
  assert.equal(readFileSync(join(f.out, manifest.untracked[0].artifact), 'utf8'), 'new consumer\n');
  assert.equal(checkSnapshot(result.path).unchanged, true);
  assert.equal(f.git('status', '--porcelain=v1'), status);
  assert.deepEqual(readFileSync(join(f.repo, '.git', 'index')), index);
  assert.equal(statSync(f.out).mode & 0o777, 0o700);
  assert.equal(statSync(result.path).mode & 0o777, 0o600);
});

test('untracked edits invalidate evidence even when Git status is unchanged and content was not copied', t => {
  const f = fixture(t);
  writeFileSync(join(f.repo, 'new.txt'), 'first');
  const result = writeSnapshot({ ...f, base: 'HEAD', scope: 'working' });
  const before = f.git('status', '--porcelain=v1');
  const manifest = JSON.parse(readFileSync(result.path));
  assert.equal(manifest.untracked[0].captured, false);
  assert.equal(manifest.untracked[0].artifact, null);
  writeFileSync(join(f.repo, 'new.txt'), 'second');
  assert.equal(f.git('status', '--porcelain=v1'), before);
  assert.equal(checkSnapshot(result.path).unchanged, false);
  const cli = spawnSync(process.execPath, [script, '--check', result.path]);
  assert.equal(cli.status, 1);
});

test('stored evidence tampering is an error, not a successful freshness check', t => {
  const f = fixture(t);
  writeFileSync(join(f.repo, 'kept.txt'), 'changed\n');
  const result = writeSnapshot({ ...f, scope: 'working' });
  writeFileSync(join(f.out, 'unstaged.patch'), 'replacement');
  assert.throws(() => checkSnapshot(result.path), /Stored evidence has been modified/);
  const cli = spawnSync(process.execPath, [script, '--check', result.path]);
  assert.equal(cli.status, 2);
});

test('literal path scoping excludes unrelated edits and detects scoped changes', t => {
  const f = fixture(t);
  writeFileSync(join(f.repo, 'kept.txt'), 'owned\n');
  writeFileSync(join(f.repo, 'deleted.txt'), 'unrelated\n');
  const result = writeSnapshot({ ...f, scope: 'working', paths: ['kept.txt'] });
  writeFileSync(join(f.repo, 'deleted.txt'), 'another unrelated edit\n');
  assert.equal(checkSnapshot(result.path).unchanged, true);
  writeFileSync(join(f.repo, 'kept.txt'), 'new owned edit\n');
  assert.equal(checkSnapshot(result.path).unchanged, false);
});

test('rejects invalid refs, output inside checkout, overwrites and escaping selections', t => {
  const f = fixture(t);
  assert.throws(() => writeSnapshot({ ...f, base: 'missing-ref', scope: 'working' }), /Git inspection failed/);
  assert.equal(existsSync(f.out), false);
  assert.throws(() => writeSnapshot({ ...f, scope: 'working', out: join(f.repo, 'evidence') }), /outside the checkout/);
  assert.throws(() => writeSnapshot({ ...f, scope: 'working', paths: ['../elsewhere'] }), /inside the checkout/);
  assert.throws(() => writeSnapshot({ ...f, scope: 'working', includeUntracked: ['ignored.txt'] }), /absent, ignored, tracked or outside scope/);
  writeSnapshot({ ...f, scope: 'working' });
  assert.throws(() => writeSnapshot({ ...f, scope: 'working' }), /already exists/);
});

test('symlink payloads capture the link target, never the external file contents', t => {
  const f = fixture(t);
  const outside = join(f.root, 'private.txt');
  writeFileSync(outside, 'PRIVATE CONTENT');
  symlinkSync(outside, join(f.repo, 'pointer'));
  const result = writeSnapshot({ ...f, scope: 'working', includeUntracked: ['pointer'] });
  const manifest = JSON.parse(readFileSync(result.path));
  assert.equal(manifest.untracked[0].kind, 'symlink');
  assert.equal(readFileSync(join(f.out, manifest.untracked[0].artifact), 'utf8'), outside);
  assert.equal(checkSnapshot(result.path).unchanged, true);
});

test('branch-only evidence excludes dirty state but invalidates on a moved comparison ref', t => {
  const f = fixture(t);
  f.git('branch', 'comparison');
  writeFileSync(join(f.repo, 'kept.txt'), 'committed\n');
  f.git('add', 'kept.txt');
  f.git('commit', '-qm', 'Committed change');
  const result = writeSnapshot({ ...f, base: 'comparison', scope: 'branch' });
  writeFileSync(join(f.repo, 'kept.txt'), 'uncommitted\n');
  assert.equal(checkSnapshot(result.path).unchanged, true);
  f.git('branch', '-f', 'comparison', 'HEAD');
  assert.equal(checkSnapshot(result.path).unchanged, false);
});

test('full binary evidence is retained and a binary working edit changes the fingerprint', t => {
  const f = fixture(t);
  writeFileSync(join(f.repo, 'data.bin'), Buffer.from([0, 1, 2, 3]));
  f.git('add', 'data.bin');
  f.git('commit', '-qm', 'Binary baseline');
  writeFileSync(join(f.repo, 'data.bin'), Buffer.from([0, 9, 2, 3]));
  const result = writeSnapshot({ ...f, base: 'HEAD', scope: 'working' });
  assert.match(readFileSync(join(f.out, 'unstaged.patch'), 'utf8'), /GIT binary patch/);
  writeFileSync(join(f.repo, 'data.bin'), Buffer.from([0, 8, 2, 3]));
  assert.equal(checkSnapshot(result.path).unchanged, false);
});

test('does not run an external diff driver configured by a repository', t => {
  const f = fixture(t);
  const sentinel = join(f.root, 'diff-ran');
  const driver = join(f.root, 'driver.sh');
  writeFileSync(driver, `#!/bin/sh\ntouch '${sentinel}'\n`);
  chmodSync(driver, 0o700);
  writeFileSync(join(f.repo, '.gitattributes'), 'kept.txt diff=unsafe\n');
  f.git('config', 'diff.unsafe.command', driver);
  writeFileSync(join(f.repo, 'kept.txt'), 'changed\n');
  collectSnapshot({ ...f, scope: 'working' });
  assert.equal(existsSync(sentinel), false);
});

test('working overlay rejects a historical head and conflicts', t => {
  const f = fixture(t);
  writeFileSync(join(f.repo, 'kept.txt'), 'later\n');
  f.git('add', 'kept.txt');
  f.git('commit', '-qm', 'Later');
  assert.throws(() => collectSnapshot({ ...f, head: f.base, scope: 'combined' }), /current checkout HEAD/);
  assert.throws(() => collectSnapshot({ ...f, scope: 'working' }), /base = current HEAD/);
  const blob = f.git('rev-parse', 'HEAD:kept.txt').trim();
  execFileSync('git', ['-C', f.repo, 'update-index', '--index-info'], { input: `0 0000000000000000000000000000000000000000\tkept.txt\n100644 ${blob} 1\tkept.txt\n100644 ${blob} 2\tkept.txt\n` });
  assert.throws(() => collectSnapshot({ ...f, base: 'HEAD', scope: 'working' }), /conflicts/);
});

test('linked worktrees are fingerprinted using their own checkout and index', t => {
  const f = fixture(t);
  const worktree = join(f.root, 'linked');
  f.git('worktree', 'add', '--detach', worktree, 'HEAD');
  writeFileSync(join(worktree, 'kept.txt'), 'linked change\n');
  const result = writeSnapshot({ ...f, repo: worktree, scope: 'working' });
  const manifest = JSON.parse(readFileSync(result.path));
  assert.equal(manifest.repo, realpathSync(worktree));
  assert.equal(readFileSync(join(f.repo, 'kept.txt'), 'utf8'), 'before\n');
  assert.equal(checkSnapshot(result.path).unchanged, true);
  writeFileSync(join(worktree, 'kept.txt'), 'later linked change\n');
  assert.equal(checkSnapshot(result.path).unchanged, false);
});

test('working scope fails closed for submodule contents instead of missing nested drift', t => {
  const f = fixture(t);
  f.git('update-index', '--add', '--cacheinfo', `160000,${f.base},nested`);
  assert.throws(() => collectSnapshot({ ...f, scope: 'working' }), /submodule/);
  assert.doesNotThrow(() => collectSnapshot({ ...f, scope: 'working', paths: ['kept.txt'] }));
});

for (const action of ['delete', 'stage']) {
  test(`captured untracked file ${action} reports checkout drift, not invalid evidence`, t => {
    const f = fixture(t);
    writeFileSync(join(f.repo, 'new.txt'), 'captured content');
    const result = writeSnapshot({ ...f, scope: 'working', includeUntracked: ['new.txt'] });
    if (action === 'delete') rmSync(join(f.repo, 'new.txt'));
    else f.git('add', 'new.txt');
    const cli = spawnSync(process.execPath, [script, '--check', result.path]);
    assert.equal(cli.status, 1);
    assert.equal(JSON.parse(cli.stdout).unchanged, false);
  });
}

test('new conflicts invalidate a previously valid snapshot as drift', t => {
  const f = fixture(t);
  const result = writeSnapshot({ ...f, scope: 'working' });
  const blob = f.git('rev-parse', 'HEAD:kept.txt').trim();
  execFileSync('git', ['-C', f.repo, 'update-index', '--index-info'], { input: `0 0000000000000000000000000000000000000000\tkept.txt\n100644 ${blob} 1\tkept.txt\n100644 ${blob} 2\tkept.txt\n` });
  const cli = spawnSync(process.execPath, [script, '--check', result.path]);
  assert.equal(cli.status, 1);
  assert.equal(JSON.parse(cli.stdout).unchanged, false);
});

test('new submodule scope and moved checkout HEAD report drift', t => {
  const f = fixture(t);
  const result = writeSnapshot({ ...f, scope: 'working' });
  f.git('update-index', '--add', '--cacheinfo', `160000,${f.base},nested`);
  assert.equal(spawnSync(process.execPath, [script, '--check', result.path]).status, 1);
  f.git('update-index', '--force-remove', 'nested');
  f.git('commit', '--allow-empty', '-qm', 'New checkout head');
  assert.equal(spawnSync(process.execPath, [script, '--check', result.path]).status, 1);
});
