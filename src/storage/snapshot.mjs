import { DEFAULT_APP_REGISTRY } from '../default-app-registry.mjs';
import { constants, createReadStream } from 'node:fs';
import { open, mkdir, readFile, writeFile, readdir, lstat, rename, rm, realpath } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { join, resolve, dirname, isAbsolute, posix } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { DatabaseSync, backup } from 'node:sqlite';

const execute = promisify(execFile);
const ID = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,100}$/;
const SHA = /^[a-f0-9]{64}$/;
const ignored = name => ['.git', 'node_modules', '__pycache__'].includes(name) || /(?:\.lock|\.tmp)$/.test(name);
const safeId = id => { if (typeof id !== 'string' || !ID.test(id)) throw new Error('Invalid storage identity'); return id; };
export function safeRelative(value) {
  if (typeof value !== 'string' || !value || value.includes('\\') || value.includes('\0') || isAbsolute(value) || value.split('/').some(p => !p || p === '.' || p === '..') || posix.normalize(value) !== value) throw new Error('Unsafe snapshot path');
  return value;
}
const fingerprint = s => [s.dev, s.ino, s.size, s.mtimeNs, s.ctimeNs].join(':');
async function hash(file) {
  const h = createHash('sha256');
  for await (const chunk of createReadStream(file)) h.update(chunk);
  return h.digest('hex');
}
async function walk(directory, { filter = false } = {}, prefix = '') {
  const result = [];
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a,b) => a.name.localeCompare(b.name))) {
    if (filter && ignored(entry.name)) continue;
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    safeRelative(path);
    const file = join(directory, entry.name), stat = await lstat(file, { bigint: true });
    if (stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory())) throw new Error('Snapshot sources must contain only regular files and directories');
    if (stat.isDirectory()) result.push(...await walk(file, { filter }, path));
    else result.push({ path, fingerprint: fingerprint(stat), size: Number(stat.size) });
  }
  return result;
}
async function assertRegular(file) {
  const stat = await lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Snapshot source must be a regular file');
}
async function assertDirectory(directory) {
  const stat = await lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Snapshot source must be a regular directory');
}
async function copyStable(source, target) {
  await assertRegular(source);
  await mkdir(dirname(target), { recursive: true, mode: 0o700 });
  const input = await open(source, constants.O_RDONLY | constants.O_NOFOLLOW);
  let output;
  try {
    const before = await input.stat({ bigint: true });
    output = await open(target, 'wx', 0o600);
    const buffer = Buffer.alloc(1024 * 1024);
    for (;;) {
      const { bytesRead } = await input.read(buffer, 0, buffer.length, null);
      if (!bytesRead) break;
      let offset = 0;
      while (offset < bytesRead) offset += (await output.write(buffer, offset, bytesRead - offset)).bytesWritten;
    }
    if (fingerprint(before) !== fingerprint(await input.stat({ bigint: true }))) throw new Error('Source changed during snapshot; retry after writers settle');
    await output.sync();
  } finally { await input.close(); await output?.close(); }
}
async function copyDirectory(source, target) {
  await assertDirectory(source);
  const before = await walk(source, { filter: true });
  await mkdir(target, { recursive: true, mode: 0o700 });
  for (const file of before) await copyStable(join(source, file.path), join(target, file.path));
  const after = await walk(source, { filter: true });
  if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error('Directory changed during snapshot; retry after writers settle');
  return before.length;
}
function validateJson(document, schema, registry = DEFAULT_APP_REGISTRY) {
  if (schema === undefined || schema === null) return;
  const validators = registry.apps.flatMap(app => Object.entries(app.integration?.storage?.validators || {})).filter(([id]) => id === schema);
  if (validators.length !== 1 || typeof validators[0][1] !== 'function') throw new Error('The application snapshot schema has no unique installed validator.');
  const before = JSON.stringify(document);
  try { validators[0][1](document); if (JSON.stringify(document) !== before) throw new Error('mutated'); }
  catch { throw new Error('Application schema version or document validation failed.'); }
}

function checkDatabase(file) {
  const database = new DatabaseSync(file, { readOnly: true });
  try {
    const rows = database.prepare('PRAGMA quick_check').all();
    if (rows.length !== 1 || Object.values(rows[0])[0] !== 'ok') throw new Error('SQLite integrity check failed');
    return Number(database.prepare('PRAGMA user_version').get().user_version);
  } finally { database.close(); }
}
async function exportDatabase(source, output) {
  await assertRegular(source);
  await mkdir(dirname(output), { recursive: true, mode: 0o700 });
  let database;
  try {
    database = new DatabaseSync(source, { readOnly: true });
    await backup(database, output);
  } catch {
    database?.close(); database = undefined;
    const hasSidecar = async suffix => {
      const stat = await lstat(`${source}${suffix}`).catch(failure => { if (failure.code === 'ENOENT') return null; throw failure; });
      if (stat && (!stat.isFile() || stat.isSymbolicLink())) throw new Error('SQLite sidecars must be regular files');
      return Boolean(stat?.size);
    };
    if (await hasSidecar('-wal')) throw new Error('A nonempty SQLite WAL requires readable shared-memory state; no lossy main-file copy was attempted');
    if (await hasSidecar('-journal')) throw new Error('A nonempty SQLite rollback journal prevents a safe main-file copy');
    const before = await lstat(source, { bigint: true });
    for (const suffix of ['', '-wal', '-shm']) await rm(`${output}${suffix}`, { force: true });
    await copyStable(source, output);
    if (await hasSidecar('-wal') || await hasSidecar('-journal') || fingerprint(before) !== fingerprint(await lstat(source, { bigint: true }))) throw new Error('SQLite changed during the read-only fallback; retry after writers settle');
    // A closed WAL-mode database may need a new SHM file even for a read-only
    // connection. Docker can report CANTOPEN instead of READONLY, so fallback
    // safety depends on sidecars, stable source metadata and staged integrity.
    const staged = new DatabaseSync(output);
    try { staged.exec('PRAGMA journal_mode=DELETE'); }
    finally { staged.close(); }
  } finally { database?.close(); }
  return checkDatabase(output);
}
async function exportSource(repository, destination) {
  const id = safeId(repository.id), source = resolve(repository.path);
  const args = { cwd: source, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 };
  const git = async (...command) => (await execute('git', command, args)).stdout;
  const head = (await git('rev-parse', 'HEAD')).trim();
  const top = (await git('rev-parse', '--show-toplevel')).trim();
  if (await realpath(top) !== await realpath(source)) throw new Error('Source repository must be its own Git root');
  const paths = repository.paths ?? [];
  paths.forEach(safeRelative);
  const output = join(destination, 'source', id);
  await mkdir(output, { recursive: true, mode: 0o700 });
  await git('bundle', 'create', join(output, 'repository.bundle'), '--all');
  await git('bundle', 'verify', join(output, 'repository.bundle'));
  const diff = await git('diff', '--binary', '--ignore-submodules=all', 'HEAD', '--', ...paths);
  await writeFile(join(output, 'working.patch'), diff, { mode: 0o600 });
  const untrackedState = async () => {
    const names = (await git('ls-files', '-z', '--others', '--exclude-standard', '--', ...paths)).split('\0').filter(Boolean);
    const state = [];
    for (const name of names) {
      safeRelative(name);
      if (name.split('/').some(ignored)) continue;
      const stat = await lstat(join(source, name), { bigint: true });
      if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Untracked sources must be regular files');
      state.push({ name, fingerprint: fingerprint(stat) });
    }
    return state;
  };
  const beforeUntracked = await untrackedState();
  for (const { name } of beforeUntracked) {
    await copyStable(join(source, name), join(output, 'untracked', name));
  }
  const endHead = (await git('rev-parse', 'HEAD')).trim();
  const endDiff = await git('diff', '--binary', '--ignore-submodules=all', 'HEAD', '--', ...paths);
  const afterUntracked = await untrackedState();
  if (head !== endHead || diff !== endDiff || JSON.stringify(beforeUntracked) !== JSON.stringify(afterUntracked)) throw new Error('Source changed during export; retry after code edits settle');
  return { id, commit: head, workingPatch: Boolean(diff), untrackedFiles: beforeUntracked.length };
}
export async function createSnapshot(config, { registry = DEFAULT_APP_REGISTRY } = {}) {
  safeId(config.workspaceId); safeId(config.deviceId);
  if (config.activeWriterDeviceId !== config.deviceId) throw new Error('This device is not the active writer');
  if (!Array.isArray(config.appSources) || !config.appSources.length) throw new Error('No application sources registered; refusing an empty backup');
  const root = resolve(config.stateRoot ?? join(config.dataRoot, 'workspaces', config.workspaceId, '.praxis-storage'));
  const snapshotId = randomUUID(), directory = join(root, 'snapshots', snapshotId), pending = `${directory}.pending`;
  await mkdir(pending, { recursive: true, mode: 0o700 });
  const apps = [], targets = [];
  try {
    for (const item of config.appSources) {
      const id = safeId(item.id), target = safeRelative(item.target ?? (item.kind === 'directory' ? 'files' : 'data'));
      const destination = `apps/${id}/${target}`;
      if (targets.some(path => path === destination || path.startsWith(`${destination}/`) || destination.startsWith(`${path}/`))) throw new Error('Overlapping application snapshot targets');
      targets.push(destination);
      const source = resolve(item.source);
      if (root === source || root.startsWith(`${source}/`) || source.startsWith(`${root}/`)) throw new Error('Storage state must not overlap application sources');
      const output = join(pending, destination);
      let schemaVersion = null;
      if (item.kind === 'directory') await copyDirectory(source, output);
      else if (item.kind === 'json') {
        await copyStable(source, output);
        const value = JSON.parse(await readFile(output, 'utf8'));
        validateJson(value, item.schema, registry);
        schemaVersion = value?.version ?? value?.schemaVersion ?? null;
      } else if (item.kind === 'sqlite') {
        schemaVersion = await exportDatabase(source, output);
      } else throw new Error('Unknown application source kind');
      apps.push({ id, kind: item.kind, target, schema: item.schema ?? null, schemaVersion, ...(item.exportedAt ? { exportedAt: item.exportedAt } : {}) });
    }
    const sourceVersion = [];
    for (const repository of config.sourceRepos ?? []) sourceVersion.push(await exportSource(repository, pending));
    const files = [];
    for (const file of await walk(pending)) files.push({ path: file.path, size: file.size, sha256: await hash(join(pending, file.path)) });
    const manifest = { schemaVersion: 1, workspaceId: config.workspaceId, snapshotId, parentSnapshotId: config.parentSnapshotId ?? null, writerDeviceId: config.deviceId, createdAt: new Date().toISOString(), apps, files, sourceVersion, coverage: { included: apps.map(a => `${a.id}/${a.target}`), omitted: config.coverage?.omitted ?? [], browserDataRequiresExport: true } };
    await writeFile(join(pending, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
    await verifySnapshot(pending, { registry });
    await rename(pending, directory);
    return { directory, manifest };
  } catch (error) { await rm(pending, { recursive: true, force: true }); throw error; }
}
export async function verifySnapshot(directory, { registry = DEFAULT_APP_REGISTRY } = {}) {
  await assertDirectory(directory);
  await assertRegular(join(directory, 'manifest.json'));
  const manifest = JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8'));
  if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.files) || !Array.isArray(manifest.apps) || !manifest.apps.length) throw new Error('Invalid snapshot manifest');
  safeId(manifest.workspaceId); safeId(manifest.snapshotId); safeId(manifest.writerDeviceId);
  if (manifest.parentSnapshotId !== null) safeId(manifest.parentSnapshotId);
  const actual = await walk(directory), expected = new Set(['manifest.json']);
  for (const file of manifest.files) {
    safeRelative(file.path);
    if (!/^(?:apps|source)\//.test(file.path) || expected.has(file.path) || !Number.isSafeInteger(file.size) || file.size < 0 || !SHA.test(file.sha256)) throw new Error('Invalid snapshot file entry');
    expected.add(file.path);
    const target = join(directory, file.path);
    await assertRegular(target);
    if ((await lstat(target)).size !== file.size || await hash(target) !== file.sha256) throw new Error('Snapshot content verification failed');
  }
  if (actual.length !== expected.size || actual.some(file => !expected.has(file.path))) throw new Error('Snapshot has missing or unlisted files');
  const appTargets = [];
  for (const app of manifest.apps) {
    safeId(app.id); safeRelative(app.target);
    const target = `${app.id}/${app.target}`;
    if (appTargets.some(existing => existing === target || existing.startsWith(`${target}/`) || target.startsWith(`${existing}/`))) throw new Error('Overlapping application snapshot targets');
    appTargets.push(target);
    const file = join(directory, 'apps', app.id, app.target);
    if (app.kind === 'json') {
      const value = JSON.parse(await readFile(file, 'utf8'));
      validateJson(value, app.schema, registry);
      if ((value?.version ?? value?.schemaVersion ?? null) !== app.schemaVersion) throw new Error('JSON schema version does not match its snapshot manifest');
    } else if (app.kind === 'sqlite') {
      if (checkDatabase(file) !== app.schemaVersion) throw new Error('SQLite schema version does not match its snapshot manifest');
    } else if (app.kind === 'directory') await assertDirectory(file);
    else throw new Error('Invalid snapshot application kind');
  }
  return manifest;
}

export async function verifyApplicationCopy(directory, manifest) {
  const expected = manifest.files.filter(file => file.path.startsWith('apps/')).map(file => ({ ...file, path: file.path.slice(5) }));
  const actual = await walk(directory);
  if (actual.length !== expected.length) throw new Error('Application copy file count mismatch');
  const names = new Set(expected.map(file => file.path));
  if (actual.some(file => !names.has(file.path))) throw new Error('Application copy has unlisted files');
  for (const file of expected) {
    safeRelative(file.path);
    const target = join(directory, file.path);
    if ((await lstat(target)).size !== file.size || await hash(target) !== file.sha256) throw new Error('Application copy verification failed');
  }
}
