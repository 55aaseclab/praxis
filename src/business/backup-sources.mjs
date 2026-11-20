import { DEFAULT_APP_REGISTRY } from '../default-app-registry.mjs';
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

async function activeBusinessSpaces(eventsFile, appId) {
  let database;
  try {
    database = new DatabaseSync(eventsFile, { readOnly: true });
    const active = new Set();
    const tables = new Set(database.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name IN ('source_cursors','business_events')").all().map(row => row.name));
    if (tables.has('source_cursors')) for (const row of database.prepare("SELECT space FROM source_cursors WHERE app=? AND cursor>0").all(appId)) active.add(row.space);
    if (tables.has('business_events')) for (const row of database.prepare("SELECT DISTINCT space FROM business_events WHERE app=?").all(appId)) active.add(row.space);
    return active;
  } catch { fail('INVALID_BUSINESS_METADATA', 'Business event coverage metadata cannot be read safely'); }
  finally { database?.close(); }
}

/** Register app-owned sources for one backup run without reading business payloads. */
export async function withBusinessBackupSources(storageConfig, businessConfig, { knownActiveSources = [], registry = DEFAULT_APP_REGISTRY, onDeclaredSource } = {}) {
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
    if (onDeclaredSource) await onDeclaredSource(Object.freeze({ ...source, source: checked.path }));
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
  const recoveries = registry.apps.filter(app => typeof app.integration?.storage?.recovery?.collect === 'function');
  const prefixes = recoveries.map(app => app.integration.storage.recovery.omissionPrefix || `business/${app.integration.storage.sourceId || app.integration.storage.rootId || app.id}/`);
  const omitted = (config.coverage?.omitted || []).filter(value => typeof value !== 'string' || !prefixes.some(prefix => value.startsWith(prefix)));
  for (const app of recoveries) {
    const owned = app.integration.storage, declaration = owned.recovery, adapterId = app.integration.business?.adapterId || app.id, configured = businessConfig.apps[adapterId];
    if (!configured) continue;
    const id = owned.sourceId || owned.rootId || app.id, fields = declaration.configFields || [];
    if (!Array.isArray(fields) || fields.some(field => !/^[a-z][A-Za-z0-9]{0,79}$/.test(field))) fail('INVALID_CONFIG', 'App recovery configuration fields are invalid');
    const selected = Object.freeze(Object.fromEntries(fields.map(field => [field, configured[field]])));
    const prefix = declaration.omissionPrefix || `business/${id}/`;
    const field = name => { if (!fields.includes(name) || typeof selected[name] !== 'string') fail('INVALID_CONFIG', 'A declared app recovery path is missing'); return selected[name]; };
    const context = Object.freeze({ config: selected,
      fail, inspect: inspectPath,
      path(name, child) { const base = field(name); if (!isAbsolute(base) || resolve(base) !== base || /[\\\0\r\n]/.test(base)) fail('UNSAFE_PATH', 'An app recovery directory must be canonical and absolute'); try { safeRelative(child); } catch { fail('UNSAFE_PATH', 'An app recovery filename is unsafe'); } return resolve(base, child); },
      async readConfiguration(name) {
        const file = await inspectPath(field(name), { privateFile: true });
        if (!file.exists) fail('MISSING_ACTIVE_DATA', 'Application space configuration is missing');
        if (file.info.size > 256 * 1024) fail('INVALID_CONFIG', 'Application space configuration is too large');
        try { return JSON.parse(await readFile(file.path, 'utf8')); } catch { fail('INVALID_CONFIG', 'Application space configuration contains invalid JSON'); }
      },
      activeSpaces: () => activeBusinessSpaces(businessConfig.eventsDatabase, adapterId),
      opaqueSpaceId(spaceId) { if (!identifier(spaceId)) fail('INVALID_CONFIG', 'Application space identifier is invalid'); return createHash('sha256').update(JSON.stringify([config.workspaceId, spaceId])).digest('hex').slice(0, 32); },
      register(source, options) {
        if (!object(source) || Object.keys(source).some(key => !['kind', 'source', 'target', 'schema', 'exportedAt'].includes(key)) || source.schema && typeof owned.validators?.[source.schema] !== 'function') fail('INVALID_BACKUP_SOURCE', 'An app recovery source must use its owned schema and identity');
        return register({ ...source, id }, options);
      },
      omit(value) { if (typeof value !== 'string' || !/^[a-zA-Z0-9_.:-]{1,100}$/.test(value)) fail('INVALID_CONFIG', 'An app recovery omission is invalid'); omitted.push(prefix + value); },
    });
    await declaration.collect(context);
  }
  return validateConfig({ ...config, appSources, coverage: { ...config.coverage, omitted: [...new Set(omitted)] } });
}
