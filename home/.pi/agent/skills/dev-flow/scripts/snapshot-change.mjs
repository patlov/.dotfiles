#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const help = `Usage:
  node snapshot-change.mjs --repo <checkout> --base <ref> --scope <working|branch|combined> --out <new-directory>
      [--head <ref>] [--path <relative-path> ...] [--include-untracked <relative-file> ...]
  node snapshot-change.mjs --check <snapshot.json>

Base is required and compared exactly; no fetch or implicit merge-base.
Working/combined scope overlays the current checkout HEAD, not a historical head.
Working-only scope requires base = current HEAD. --path selects literal files/directories.
Untracked names and hashes are inventoried; only explicitly selected contents are copied.
Output must be a new directory outside the checkout, with an existing parent.
Raw evidence is private, not secret-scanned, and must not be published without review.
Working snapshots reject conflicts and submodules in scope; snapshot submodules separately.
Ignored files, nested submodule contents, Git metadata and external state are not fingerprinted.
Check exits 0 when unchanged, 1 on drift, and 2 on an invalid or unreadable snapshot.
`;

class CheckoutDriftError extends Error {}

function digest(value) {
  return createHash('sha256').update(value).digest('hex');
}

function git(repo, args) {
  const result = spawnSync('git', ['-C', repo, ...args], {
    env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
    maxBuffer: 128 * 1024 * 1024,
    timeout: 30_000,
  });
  if (result.error || result.status !== 0) {
    throw new Error(`Git inspection failed (${args[0]}); check the repository, refs and scope. No partial snapshot is valid.`);
  }
  return result.stdout;
}

function inside(root, path) {
  const rel = relative(root, path);
  return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`));
}

function relativePath(path) {
  if (typeof path !== 'string' || !path || isAbsolute(path) || path.includes('\0')) {
    throw new Error('Paths must be non-empty repository-relative paths.');
  }
  const normalised = relative('/', resolve('/', path));
  if (path.split(/[\\/]/).includes('..') || normalised === '' || normalised.startsWith('.git/') || normalised === '.git') {
    throw new Error('Paths must stay inside the checkout and outside .git; omit --path to select the whole scope.');
  }
  return normalised;
}

function names(buffer) {
  return buffer.toString('utf8').split('\0').filter(Boolean);
}

function inventory(buffer) {
  const cells = names(buffer);
  const result = [];
  for (let i = 0; i < cells.length; i += 2) {
    if (!cells[i + 1]) throw new Error('Malformed Git change inventory.');
    result.push({ status: cells[i], path: cells[i + 1] });
  }
  return result;
}

function commit(repo, ref) {
  const sha = git(repo, ['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`]).toString().trim();
  if (!/^[0-9a-f]{40,64}$/.test(sha)) throw new Error('Expected an exact Git commit.');
  return sha;
}

export function collectSnapshot(options) {
  if (!['working', 'branch', 'combined'].includes(options.scope) || typeof options.base !== 'string' || !options.base) {
    throw new Error('An explicit base and working, branch or combined scope are required.');
  }
  const requestedRepo = realpathSync(resolve(options.repo));
  const repo = realpathSync(git(requestedRepo, ['rev-parse', '--show-toplevel']).toString().trim());
  const paths = [...new Set((options.paths ?? []).map(relativePath))].sort();
  const includes = [...new Set((options.includeUntracked ?? []).map(relativePath))].sort();
  const working = options.scope !== 'branch';
  if (!working && includes.length) throw new Error('Untracked content requires working or combined scope.');
  const checkoutHead = commit(repo, 'HEAD');
  const base = commit(repo, options.base);
  const head = commit(repo, options.head ?? 'HEAD');
  if (working && head !== checkoutHead) throw new CheckoutDriftError('Working evidence must use the current checkout HEAD.');
  if (options.scope === 'working' && base !== checkoutHead) throw new CheckoutDriftError('Working-only evidence requires base = current HEAD.');
  const pathspec = ['--', ...paths.map(path => `:(literal)${path}`)];
  const tracked = names(git(repo, ['ls-files', '--stage', '-z', ...pathspec]));
  if (working && tracked.some(entry => entry.startsWith('160000 '))) {
    throw new CheckoutDriftError('Working snapshots do not fingerprint nested submodule contents; narrow the scope or snapshot that repository separately.');
  }
  if (working && git(repo, ['ls-files', '--unmerged', '-z', ...pathspec]).length) {
    throw new CheckoutDriftError('Resolve or separately inspect conflicts before taking a working snapshot.');
  }
  const common = ['--no-ext-diff', '--no-textconv', '--no-renames', '--ignore-submodules=none'];
  const layers = {};
  const changes = {};
  function layer(name, range) {
    layers[name] = git(repo, ['diff', ...common, '--binary', '--full-index', ...range, ...pathspec]);
    changes[name] = inventory(git(repo, ['diff', ...common, '--name-status', '-z', ...range, ...pathspec]));
  }
  if (options.scope !== 'working') layer('branch', [base, head]);
  if (working) {
    layer('staged', ['--cached', checkoutHead]);
    layer('unstaged', []);
  }
  const untracked = [];
  const payloads = new Map();
  const untrackedNames = working ? names(git(repo, ['ls-files', '--others', '--exclude-standard', '-z', ...pathspec])).sort() : [];
  for (const path of untrackedNames) {
    relativePath(path);
    const file = join(repo, path);
    if (!inside(repo, realpathSync(dirname(file)))) throw new Error('An untracked parent escapes the checkout.');
    const stat = lstatSync(file);
    const kind = stat.isSymbolicLink() ? 'symlink' : stat.isFile() ? 'file' : 'unsupported';
    if (kind === 'unsupported') throw new Error('Untracked directories or special files need separate inspection.');
    const content = kind === 'symlink' ? Buffer.from(readlinkSync(file)) : readFileSync(file);
    const captured = includes.includes(path);
    const artifact = captured ? `untracked-${String(untracked.length + 1).padStart(4, '0')}.bin` : null;
    untracked.push({ path, kind, mode: stat.mode & 0o777, sha256: digest(content), captured, artifact });
    if (captured) payloads.set(artifact, content);
  }
  for (const path of includes) {
    if (!untrackedNames.includes(path)) throw new CheckoutDriftError(`Selected untracked file is absent, ignored, tracked or outside scope: ${path}`);
  }
  const metadata = {
    version: 1,
    repo,
    requested: { base: options.base, head: options.head ?? 'HEAD', scope: options.scope, paths, includeUntracked: includes },
    base,
    head,
    checkoutHead,
    changes,
    diffs: Object.fromEntries(Object.entries(layers).map(([name, content]) => [name, { artifact: `${name}.patch`, sha256: digest(content) }])),
    untracked,
  };
  return { metadata, fingerprint: digest(JSON.stringify(metadata)), layers, payloads };
}

export function writeSnapshot(options) {
  const snapshot = collectSnapshot(options);
  const again = collectSnapshot(options);
  if (again.fingerprint !== snapshot.fingerprint) throw new Error('Checkout changed during capture; retry after writers settle.');
  const requested = resolve(options.out);
  const parent = realpathSync(dirname(requested));
  const out = join(parent, relative(dirname(requested), requested));
  if (inside(snapshot.metadata.repo, out)) throw new Error('Evidence output must be outside the checkout.');
  if (existsSync(out)) throw new Error('Evidence output already exists; use a new directory.');
  mkdirSync(out, { mode: 0o700 });
  for (const [name, content] of Object.entries(snapshot.layers)) {
    writeFileSync(join(out, `${name}.patch`), content, { mode: 0o600, flag: 'wx' });
  }
  for (const [name, content] of snapshot.payloads) {
    writeFileSync(join(out, name), content, { mode: 0o600, flag: 'wx' });
  }
  const manifest = { ...snapshot.metadata, fingerprint: snapshot.fingerprint };
  writeFileSync(join(out, 'snapshot.json'), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
  return { path: join(out, 'snapshot.json'), fingerprint: snapshot.fingerprint };
}

export function checkSnapshot(path) {
  const saved = JSON.parse(readFileSync(path, 'utf8'));
  if (saved.version !== 1 || !saved.requested || typeof saved.repo !== 'string' || typeof saved.fingerprint !== 'string') {
    throw new Error('Unsupported or malformed snapshot.');
  }
  const { fingerprint, ...metadata } = saved;
  if (digest(JSON.stringify(metadata)) !== fingerprint) throw new Error('Snapshot manifest has been modified.');
  for (const entry of [...Object.values(saved.diffs), ...saved.untracked.filter(file => file.captured)]) {
    if (typeof entry.artifact !== 'string' || entry.artifact.includes('/') || entry.artifact.includes('\\') || entry.artifact === '..') {
      throw new Error('Invalid evidence artifact path.');
    }
    if (digest(readFileSync(join(dirname(path), entry.artifact))) !== entry.sha256) {
      throw new Error('Stored evidence has been modified.');
    }
  }
  try {
    const current = collectSnapshot({ repo: saved.repo, ...saved.requested });
    return { unchanged: current.fingerprint === fingerprint, expected: fingerprint, current: current.fingerprint };
  } catch (error) {
    if (!(error instanceof CheckoutDriftError)) throw error;
    return { unchanged: false, expected: fingerprint, current: null, reason: error.message };
  }
}

export function main(args) {
  try {
    if (args.length === 1 && args[0] === '--help') {
      console.log(help);
      return 0;
    }
    if (args[0] === '--check') {
      if (args.length !== 2) throw new Error('--check takes only a snapshot.json path.');
      const result = checkSnapshot(resolve(args[1]));
      console.log(JSON.stringify(result));
      return result.unchanged ? 0 : 1;
    }
    const options = { paths: [], includeUntracked: [] };
    const flags = { '--repo': 'repo', '--base': 'base', '--head': 'head', '--scope': 'scope', '--out': 'out' };
    for (let i = 0; i < args.length; i += 2) {
      const flag = args[i];
      const value = args[i + 1];
      if (!value || value.startsWith('--')) throw new Error('Each option needs a value; use --help.');
      if (flag === '--path') options.paths.push(value);
      else if (flag === '--include-untracked') options.includeUntracked.push(value);
      else if (flags[flag] && options[flags[flag]] === undefined) options[flags[flag]] = value;
      else throw new Error('Unknown or repeated option; use --help.');
    }
    if (!options.repo || !options.base || !options.scope || !options.out) throw new Error('Required options are missing; use --help.');
    console.log(JSON.stringify(writeSnapshot(options)));
    return 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Snapshot failed.');
    return 2;
  }
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
