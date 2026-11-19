import { lstat, readFile, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { isAbsolute, parse, resolve, sep } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { isWithin, storageError, validateConfig } from '../storage/config.mjs';
import { safeRelative } from '../storage/snapshot.mjs';

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const identifier = value => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,199}$/.test(value);
const sourceId = value => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,100}$/.test(value);
const fail = (code, message) => { throw storageError(code, message); };

async function inspectPath(file, { privateFile = false } = {}) {
  if (typeof file !== 'string' || !isAbsolute(file) || resolve(file) !== file || /[\\\0\r\n]/.test(file)) fail('UNSAFE_PATH', 'Business backup sources require normalized absolute paths');
  const root = parse(file).root;
  const parts = file.slice(root.length).split(sep).filter(Boolean);
  let current = root;
  let info;
  for (const part of parts) {
    current = resolve(current, part);
    try { info = await lstat(current); }
    catch (error) {
      if (error.code === 'ENOENT') return { path: file, exists: false };
      throw error;
    }
    if (info.isSymbolicLink()) fail('UNSAFE_PATH', 'Business backup paths must not traverse symbolic links');
    if (current !== file && !info.isDirectory()) fail('UNSAFE_PATH', 'Business backup parent paths must be directories');
  }
  if (privateFile && (!info?.isFile() || info.mode & 0o077 || typeof process.getuid === 'function' && info.uid !== process.getuid())) fail('UNSAFE_CONFIG', 'Business space configuration must be an owner-only regular file');
  if (await realpath(file) !== file) fail('UNSAFE_PATH', 'Business backup path changed during validation');
  return { path: file, exists: true, info };
}

function outsideBackupRoots(path, config) {
  for (const root of [config.stateRoot, ...config.repositories.filter(repository => repository.type === 'local').map(repository => repository.path)]) {
    if (isWithin(root, path) || isWithin(path, root)) fail('UNSAFE_PATH', 'Business backup sources must not overlap backup repositories or staging');
  }
}

function targetIdentity(source) {
  if (!object(source) || !sourceId(source.id) || !['json', 'sqlite', 'directory'].includes(source.kind)) fail('INVALID_BACKUP_SOURCE', 'Application backup source is invalid');
  try { safeRelative(source.target); } catch { fail('UNSAFE_PATH', 'Application backup target is unsafe'); }
  return `${source.id}/${source.target}`;
}

async function activeReminderSpaces(eventsFile) {
  let database;
  try {
    database = new DatabaseSync(eventsFile, { readOnly: true });
    const active = new Set();
    const tables = new Set(database.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name IN ('source_cursors','business_events')").all().map(row => row.name));
    if (tables.has('source_cursors')) for (const row of database.prepare("SELECT space FROM source_cursors WHERE app='reminder' AND cursor>0").all()) active.add(row.space);
    if (tables.has('business_events')) for (const row of database.prepare("SELECT DISTINCT space FROM business_events WHERE app='reminder'").all()) active.add(row.space);
    return active;
  } catch { fail('INVALID_BUSINESS_METADATA', 'Business event coverage metadata cannot be read safely'); }
  finally { database?.close(); }
}

/** Register app-owned sources for one backup run without reading business payloads. */
export async function withBusinessBackupSources(storageConfig, businessConfig, { knownActiveSources = [] } = {}) {
  const config = validateConfig(storageConfig);
  if (!object(businessConfig) || !object(businessConfig.apps) || !Array.isArray(knownActiveSources)) fail('INVALID_CONFIG', 'Business backup configuration is invalid');
  const known = new Set();
  for (const source of knownActiveSources) {
    const checked = await inspectPath(source);
    outsideBackupRoots(checked.path, config);
    known.add(checked.path);
  }
  const byPath = new Map();
  const targets = [];
  const appSources = [];
  function reserveTarget(source) {
    const target = targetIdentity(source);
    if (targets.some(existing => existing === target || existing.startsWith(`${target}/`) || target.startsWith(`${existing}/`))) fail('INVALID_BACKUP_SOURCE', 'Application backup targets overlap');
    targets.push(target);
  }
  for (const source of config.appSources) {
    const checked = await inspectPath(source.source);
    outsideBackupRoots(checked.path, config);
    if (!checked.exists) fail('MISSING_ACTIVE_DATA', 'An already registered application source is missing');
    if (source.kind === 'directory' ? !checked.info.isDirectory() : !checked.info.isFile()) fail('INVALID_BACKUP_SOURCE', 'Application backup source type does not match its path');
    const prior = byPath.get(checked.path);
    if (prior) {
      if (prior.kind !== source.kind || prior.schema !== source.schema) fail('INVALID_BACKUP_SOURCE', 'One source has incompatible backup declarations');
      continue;
    }
    const registered = { ...source, source: checked.path };
    reserveTarget(registered);
    appSources.push(registered);
    byPath.set(checked.path, registered);
  }
  async function register(source, { optional = false } = {}) {
    const checked = await inspectPath(source.source);
    outsideBackupRoots(checked.path, config);
    if (!checked.exists) {
      if (!optional || known.has(checked.path) || byPath.has(checked.path)) fail('MISSING_ACTIVE_DATA', 'An active business backup source is missing');
      return false;
    }
    if (!checked.info.isFile()) fail('INVALID_BACKUP_SOURCE', 'Business backup sources must be regular files');
    const prior = byPath.get(checked.path);
    if (prior) {
      if (prior.kind !== source.kind || source.schema && prior.schema && prior.schema !== source.schema) fail('INVALID_BACKUP_SOURCE', 'Business source is registered with an incompatible backup kind or schema');
      if (source.schema) prior.schema = source.schema;
      return true;
    }
    const registered = { ...source, source: checked.path };
    reserveTarget(registered);
    byPath.set(checked.path, registered);
    appSources.push(registered);
    return true;
  }
  await register({ id: 'praxis-business', kind: 'sqlite', source: businessConfig.database, target: 'auth.db' });
  await register({ id: 'praxis-business', kind: 'sqlite', source: businessConfig.eventsDatabase, target: 'events.db' });
  const omitted = (config.coverage?.omitted || []).filter(value => typeof value !== 'string' || !value.startsWith('business/reminder/'));
  if (businessConfig.apps.reminder) {
    const configFile = await inspectPath(businessConfig.apps.reminder.spacesFile, { privateFile: true });
    if (!configFile.exists) fail('MISSING_ACTIVE_DATA', 'Reminder space configuration is missing');
    if (configFile.info.size > 256 * 1024) fail('INVALID_CONFIG', 'Reminder space configuration is too large');
    let mapping;
    try { mapping = JSON.parse(await readFile(configFile.path, 'utf8')); } catch { fail('INVALID_CONFIG', 'Reminder space configuration contains invalid JSON'); }
    if (!object(mapping) || Object.keys(mapping).some(key => key !== 'spaces') || !object(mapping.spaces) || !Object.keys(mapping.spaces).length) fail('INVALID_CONFIG', 'Reminder space configuration requires an explicit spaces mapping');
    const active = await activeReminderSpaces(businessConfig.eventsDatabase);
    const mapped = new Set();
    for (const [spaceId, source] of Object.entries(mapping.spaces)) {
      if (!identifier(spaceId)) fail('INVALID_CONFIG', 'Reminder space identifier is invalid');
      const checked = await inspectPath(source);
      if (mapped.has(checked.path)) fail('INVALID_BACKUP_SOURCE', 'Reminder spaces must not share the same data file');
      mapped.add(checked.path);
      const opaqueId = createHash('sha256').update(JSON.stringify([config.workspaceId, spaceId])).digest('hex').slice(0, 32);
      const included = await register({ id: 'reminder', kind: 'json', source: checked.path, target: `spaces/${opaqueId}.json`, schema: 'reminder-v2' }, { optional: !active.has(spaceId) });
      if (!included) omitted.push(`business/reminder/${opaqueId}:uninitialized`);
    }
  }
  if (businessConfig.apps.tingproof) await register({ id: 'tingproof', kind: 'sqlite', source: businessConfig.apps.tingproof.dataFile, target: 'tingproof.db' });
  if (businessConfig.apps.projects) await register({ id: 'projects', kind: 'sqlite', source: resolve(businessConfig.apps.projects.dataDir, 'projects.db'), target: 'projects.db' });
  if (businessConfig.apps.knowledge) await register({ id: 'knowledge', kind: 'sqlite', source: resolve(businessConfig.apps.knowledge.dataDir, 'knowledge.db'), target: 'knowledge.db' });
  if (businessConfig.apps.memo) await register({ id: 'memo', kind: 'sqlite', source: resolve(businessConfig.apps.memo.dataDir, 'memo.db'), target: 'memo.db' });
  return validateConfig({ ...config, appSources, coverage: { ...config.coverage, omitted: [...new Set(omitted)] } });
}
