import { constants } from 'node:fs';
import { open, lstat, realpath, readdir, mkdir } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { assertOutsideWorkspace, isWithin, validateConfig, writePrivateJson } from './config.mjs';

const unknown = now => ({ schemaVersion: 1, generatedAt: new Date(now).toISOString(), freshUntil: new Date(now + 90000).toISOString(), writer: 'unknown', working: { mode: 'unknown', configuredSources: { json: null, sqlite: null, directory: null } }, local: { state: 'unknown', lastSuccessAt: null, lastVerifiedAt: null }, targets: [], worker: { state: 'unknown', heartbeatAt: null, lastResultAt: null, lastResult: 'unknown', configCurrent: null }, coverage: { state: 'unknown', browserData: 'requires-export', omissions: ['browser-export', 'original-audio', 'key-materials'] } });
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const oneOf = (value, values, fallback = 'unknown') => values.includes(value) ? value : fallback;
const time = (value, now) => typeof value === 'string' && Number.isFinite(Date.parse(value)) && Date.parse(value) >= 0 && Date.parse(value) <= now + 5000 ? new Date(value).toISOString() : null;
const privateOwner = info => info.uid === (process.getuid?.() ?? 1000) && (info.mode & 0o077) === 0;

export function validateStorageProjection(value, now = Date.now()) {
  const keys = (item, expected) => object(item) && Object.keys(item).sort().join(',') === [...expected].sort().join(',');
  const stamp = (item, nullable = true) => nullable && item === null || typeof item === 'string' && Number.isFinite(Date.parse(item)) && Date.parse(item) >= 0 && Date.parse(item) <= now + 5000 && new Date(item).toISOString() === item;
  const member = (item, allowed) => allowed.includes(item);
  if (!keys(value, ['schemaVersion', 'generatedAt', 'freshUntil', 'writer', 'working', 'local', 'targets', 'worker', 'coverage']) || value.schemaVersion !== 1 || !stamp(value.generatedAt, false) || typeof value.freshUntil !== 'string' || !Number.isFinite(Date.parse(value.freshUntil)) || new Date(value.freshUntil).toISOString() !== value.freshUntil || Date.parse(value.freshUntil) <= Date.parse(value.generatedAt) || Date.parse(value.freshUntil) > Date.parse(value.generatedAt) + 90000 || !member(value.writer, ['active', 'standby', 'unknown'])) return false;
  if (!keys(value.working, ['mode', 'configuredSources']) || !member(value.working.mode, ['local', 'unknown']) || !keys(value.working.configuredSources, ['json', 'sqlite', 'directory']) || !Object.values(value.working.configuredSources).every(item => value.working.mode === 'unknown' ? item === null : Number.isSafeInteger(item) && item >= 0 && item <= 10000)) return false;
  if (!keys(value.local, ['state', 'lastSuccessAt', 'lastVerifiedAt']) || !member(value.local.state, ['available', 'none', 'unknown']) || !stamp(value.local.lastSuccessAt) || !stamp(value.local.lastVerifiedAt)) return false;
  if (!Array.isArray(value.targets) || value.targets.length > 16 || value.targets.some(target => !keys(target, ['kind', 'provider', 'configured', 'state', 'lastRecordedState', 'recordedAt', 'lastSuccessAt', 'lastVerifiedAt', 'lastCheckAt', 'lastCheckState', 'matchesLocalSnapshot']) || !member(target.kind, ['local', 'cloud', 'other']) || !member(target.provider, ['local', 'jianguoyun', 'other']) || target.configured !== true || !member(target.state, ['synced', 'pending', 'failed', 'unknown']) || !member(target.lastRecordedState, ['success', 'pending', 'failed', 'unconfigured', 'unknown']) || !member(target.lastCheckState, ['success', 'failed', 'unknown']) || ![target.recordedAt, target.lastSuccessAt, target.lastVerifiedAt, target.lastCheckAt].every(item => stamp(item)) || !member(target.matchesLocalSnapshot, [true, false, null]))) return false;
  if (!keys(value.worker, ['state', 'heartbeatAt', 'lastResultAt', 'lastResult', 'configCurrent']) || !member(value.worker.state, ['fresh', 'stale', 'stopped', 'unknown']) || !stamp(value.worker.heartbeatAt) || !stamp(value.worker.lastResultAt) || !member(value.worker.lastResult, ['starting', 'idle', 'success', 'partial', 'error', 'unknown']) || !member(value.worker.configCurrent, [true, false, null])) return false;
  return keys(value.coverage, ['state', 'browserData', 'omissions']) && value.coverage.state === 'unknown' && value.coverage.browserData === 'requires-export' && Array.isArray(value.coverage.omissions) && JSON.stringify(value.coverage.omissions) === JSON.stringify(['browser-export', 'original-audio', 'key-materials']);
}

export async function readPrivateMetadata(file, maximum = 1024 * 1024) {
  if (typeof file !== 'string' || !isAbsolute(file) || resolve(file) !== file || await realpath(dirname(file)) !== dirname(file)) throw new Error('Unsafe metadata path.');
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.nlink !== 1 || !privateOwner(info) || info.size > maximum) throw new Error('Unsafe metadata file.');
    const buffer = Buffer.alloc(maximum + 1);
    let size = 0;
    while (size < buffer.length) { const result = await handle.read(buffer, size, buffer.length - size, null); if (!result.bytesRead) break; size += result.bytesRead; }
    if (size > maximum) throw new Error('Metadata exceeds its bounded size.');
    const raw = buffer.subarray(0, size);
    return { raw, value: JSON.parse(raw.toString('utf8')) };
  } finally { await handle.close(); }
}

export async function collectStorageStatus({ configFile, metadataDirectory, now = Date.now() }) {
  const result = unknown(now);
  let config, digest;
  try {
    const source = await readPrivateMetadata(configFile, 256 * 1024);
    config = validateConfig(source.value);
    if (config.repositories.length > 16) return result;
    digest = createHash('sha256').update(source.raw).digest('hex');
  } catch { return result; }
  result.writer = config.deviceId === config.activeWriterDeviceId ? 'active' : 'standby';
  result.working = { mode: 'local', configuredSources: Object.fromEntries(['json', 'sqlite', 'directory'].map(kind => [kind, config.appSources.filter(source => source.kind === kind).length])) };
  const root = metadataDirectory ?? config.stateRoot;
  let state;
  try {
    const value = (await readPrivateMetadata(join(root, 'repositories.json'))).value;
    if (value.schemaVersion === 1 && value.workspaceId === config.workspaceId && object(value.targets) && (value.headSnapshotId === null || typeof value.headSnapshotId === 'string')) state = value;
  } catch { /* Missing or unsafe metadata remains unknown. */ }
  result.targets = config.repositories.map(repository => {
    const record = object(state?.targets[repository.id]) ? state.targets[repository.id] : {};
    const recorded = oneOf(record.status, ['success', 'pending', 'failed', 'unconfigured']);
    const matches = typeof state?.headSnapshotId === 'string' && typeof record.lastSnapshotId === 'string' ? state.headSnapshotId === record.lastSnapshotId : null;
    const target = {
      kind: repository.type === 'local' ? 'local' : 'cloud', provider: oneOf(repository.type, ['local', 'jianguoyun'], 'other'), configured: true,
      state: recorded === 'success' && matches === true ? 'synced' : recorded === 'pending' || recorded === 'success' && matches === false ? 'pending' : recorded === 'failed' ? 'failed' : 'unknown',
      lastRecordedState: recorded, recordedAt: time(record.updatedAt, now), lastSuccessAt: time(record.lastSuccessAt, now), lastVerifiedAt: time(record.lastVerifiedAt, now), lastCheckAt: time(record.lastCheckAt, now), lastCheckState: oneOf(record.lastCheckStatus, ['success', 'failed']), matchesLocalSnapshot: matches,
    };
    if (repository.id === config.primaryRepositoryId) result.local = { state: target.state === 'synced' ? 'available' : state?.headSnapshotId === null ? 'none' : 'unknown', lastSuccessAt: target.lastSuccessAt, lastVerifiedAt: target.lastVerifiedAt };
    return target;
  });
  try {
    const worker = (await readPrivateMetadata(join(root, 'worker-heartbeat.json'))).value;
    if (worker.schemaVersion === 1 && worker.workspaceId === config.workspaceId) {
      const heartbeatAt = time(worker.heartbeatAt, now);
      const configCurrent = /^[a-f0-9]{64}$/.test(worker.configDigest ?? '') ? worker.configDigest === digest : null;
      result.worker = { state: worker.watcherRunning === false ? 'stopped' : worker.watcherRunning === true && heartbeatAt ? configCurrent === true && now - Date.parse(heartbeatAt) <= 90000 ? 'fresh' : 'stale' : 'unknown', heartbeatAt, lastResultAt: time(worker.lastResultAt, now), lastResult: oneOf(worker.lastResultStatus, ['starting', 'idle', 'success', 'partial', 'error']), configCurrent };
    }
  } catch { /* Worker liveness is independent from replica success. */ }
  return result;
}

export async function validateStorageStatusDestination(file, { create = false, protectedPaths = [] } = {}) {
  if (typeof file !== 'string' || !isAbsolute(file) || resolve(file) !== file || !/^[a-z][a-z0-9-]{0,63}\.json$/.test(basename(file)) || /[\0\r\n$]/.test(file)) throw new Error('Storage status requires a canonical private JSON path.');
  assertOutsideWorkspace(file);
  const directory = dirname(file), broad = ['/', '/tmp', '/var', '/var/lib', '/run', '/etc', '/home', '/opt', '/mnt', '/media', homedir()];
  if (broad.includes(directory) || directory.split('/').filter(Boolean).length < 3 || directory.split('/').some(part => ['.git', '.ssh', '.gnupg', '.aws', '.kube', '.docker'].includes(part))) throw new Error('Storage status requires a dedicated private directory.');
  for (const path of protectedPaths.filter(value => typeof value === 'string')) if (isWithin(path, directory) || isWithin(directory, path)) throw new Error('Storage status must remain separate from private inputs and controls.');
  let ancestor = directory, info;
  while (!(info = await lstat(ancestor).catch(error => { if (error.code === 'ENOENT') return null; throw error; }))) ancestor = dirname(ancestor);
  if (!info.isDirectory() || info.isSymbolicLink() || await realpath(ancestor) !== ancestor) throw new Error('Storage status directories cannot use aliases.');
  if (ancestor === directory) {
    if (!privateOwner(info) || (info.mode & 0o777) !== 0o700) throw new Error('Storage status directories require owner-only mode700.');
    for (const name of await readdir(directory)) {
      if (name !== basename(file) && !(name.startsWith(`${basename(file)}.`) && /^[a-f0-9-]{36}\.tmp$/.test(name.slice(basename(file).length + 1)))) throw new Error('Storage status directories may contain only sanitized projections.');
      const item = await lstat(join(directory, name)).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
      if (item && (!item.isFile() || item.isSymbolicLink() || item.nlink !== 1 || !privateOwner(item) || (item.mode & 0o777) !== 0o600)) throw new Error('Storage status files require private regular mode600 files.');
    }
  } else if (create) { await mkdir(directory, { recursive: true, mode: 0o700 }); return validateStorageStatusDestination(file, { protectedPaths }); }
  return directory;
}

export async function publishStorageStatus(options) {
  await validateStorageStatusDestination(options.outputFile);
  const projection = await collectStorageStatus(options);
  await writePrivateJson(options.outputFile, projection);
  return projection;
}
