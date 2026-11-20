import { homedir } from 'node:os';
import { lstat, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { DEFAULT_APP_REGISTRY } from '../default-app-registry.mjs';

const inside = (a, b) => { const rel = relative(a, b); return rel === '' || rel !== '..' && !rel.startsWith('../') && !isAbsolute(rel); };
const overlap = (a, b) => inside(a, b) || inside(b, a);
const fail = () => { throw Object.assign(new Error('Working data requires independent canonical directories outside source, secrets and backups.'), { code: 'INVALID_APP_DATA_PATH' }); };
const safeId = value => typeof value === 'string' && /^[a-z][a-z0-9-]{0,79}$/.test(value);
const safeSuffix = value => typeof value === 'string' && (value === '' || !isAbsolute(value) && !/[\\\x00-\x1f\x7f$?#]/.test(value) && !value.split('/').some(part => !part || part === '.' || part === '..'));
export function storageEntries(registry = DEFAULT_APP_REGISTRY) {
  return registry.apps.map(app => ({ app, storage: app.integration?.storage || {}, adapterId: app.integration?.business?.adapterId || app.integration?.storage?.sourceId || app.id })).filter(entry => entry.storage.rootId || entry.storage.sources?.length || entry.storage.omissions?.length || entry.storage.validators || entry.storage.registrations?.length);
}
const rootIds = registry => {
  const values = storageEntries(registry).map(({ storage }) => storage.rootId).filter(Boolean);
  if (values.some(id => !safeId(id) || id === 'praxis') || new Set(values).size !== values.length) fail();
  return [...values, 'praxis'];
};
export const APP_DATA_IDS = Object.freeze(rootIds(DEFAULT_APP_REGISTRY));
export function appPathAlias(paths, alias, rootId) {
  const value = alias === '$root' ? paths.roots[rootId] : paths[alias];
  if (typeof value !== 'string' || !isAbsolute(value)) fail(); return value;
}

/** App declarations supply aliases; the platform guards physical separation. */
export function resolveAppPaths(config, { sourceRoot = resolve(new URL('../../', import.meta.url).pathname), configRoot = join(homedir(), '.config/praxis'), registry = DEFAULT_APP_REGISTRY } = {}) {
  const input = config.workingData || { version: 1, roots: {} }, ids = rootIds(registry);
  if (!input || input.version !== 1 || Object.keys(input).some(key => !['version', 'roots'].includes(key)) || !input.roots || typeof input.roots !== 'object' || Array.isArray(input.roots) || Object.keys(input.roots).some(id => !ids.includes(id))) fail();
  const base = join(config.dataRoot, 'workspaces', config.workspaceId, 'apps');
  const roots = Object.fromEntries(ids.map(id => [id, input.roots[id] ?? join(base, id)]));
  const protectedPaths = [sourceRoot, configRoot, config.stateRoot, ...(config.sourceRepos || []).map(repo => repo.path), ...(config.repositories || []).flatMap(repo => [repo.path, repo.passwordFile && dirname(repo.passwordFile), repo.credentialsFile && dirname(repo.credentialsFile), repo.rcloneConfigFile && dirname(repo.rcloneConfigFile)])].filter(Boolean).map(path => resolve(path));
  for (const [id, path] of Object.entries(roots)) {
    if (typeof path !== 'string' || !isAbsolute(path) || resolve(path) !== path || /[\\\x00-\x1f\x7f$?#]/.test(path) || path.split('/').filter(Boolean).length < 3 || protectedPaths.some(other => overlap(path, other)) || Object.entries(roots).some(([other, value]) => other !== id && typeof value === 'string' && overlap(path, value))) fail();
  }
  const paths = { roots, platform: join(roots.praxis, 'business'), observations: join(roots.praxis, 'observations') };
  for (const { storage } of storageEntries(registry)) {
    if (!storage.rootId) continue;
    for (const [alias, suffix] of Object.entries(storage.paths || {})) {
      if (!/^[a-z][A-Za-z0-9]{0,99}$/.test(alias) || Object.hasOwn(paths, alias) || !safeSuffix(suffix)) fail();
      paths[alias] = join(roots[storage.rootId], suffix);
    }
  }
  return paths;
}
export async function validateAppPathParents(paths) {
  for (const path of Object.values(paths.roots)) {
    let ancestor = path;
    while (!await lstat(ancestor).catch(error => { if (error.code === 'ENOENT') return null; throw error; })) ancestor = dirname(ancestor);
    const info = await lstat(ancestor);
    if (!info.isDirectory() || info.isSymbolicLink() || await realpath(ancestor) !== ancestor || info.mode & 0o022) fail();
  }
}
export function appStorageSources(paths, spaceMaps = {}, { registry = DEFAULT_APP_REGISTRY, registeredSources = [] } = {}) {
  const entries = storageEntries(registry), mapped = entries.filter(({ storage }) => storage.sources?.some(source => source.spaceMap));
  if (Object.values(spaceMaps).every(value => typeof value === 'string') && mapped.length === 1) spaceMaps = { [mapped[0].storage.sources.find(source => source.spaceMap).spaceMap]: spaceMaps };
  const result = [];
  for (const { app, storage } of entries) for (const source of storage.sources || []) {
    const id = storage.sourceId || storage.rootId || app.id;
    if (source.optional && !registeredSources.some(item => item.id === id && item.target === source.target)) continue;
    if (source.spaceMap) {
      const map = spaceMaps[source.spaceMap]?.spaces || spaceMaps[source.spaceMap] || {};
      for (const [index, [space, file]] of Object.entries(map).entries()) {
        if (!/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,199}$/.test(space) || typeof file !== 'string' || !isAbsolute(file) || !safeSuffix(source.filename)) fail();
        if(source.kind==='sqlite'&&result.some(item=>item.id===id&&item.source===file))continue;
        result.push({ id, kind: source.kind, ...(source.schema ? { schema: source.schema } : {}), source: file, target: index ? `spaces/${space}/${source.filename}` : source.primaryTarget || source.filename });
      }
    } else {
      if (source.relative !== undefined && !safeSuffix(source.relative) || !safeSuffix(source.target)) fail();
      result.push({ id, kind: source.kind, ...(source.schema ? { schema: source.schema } : {}), source: join(appPathAlias(paths, source.path, storage.rootId), source.relative || ''), target: source.target });
    }
  }
  return result;
}

/** App-owned declarations select bindings; all physical guards stay generic. */
export function assertAppBindings(config, business, options = {}) {
  if (!config.workingData) return;
  const registry = options.registry || DEFAULT_APP_REGISTRY, paths = resolveAppPaths(config, { registry }), maps = {};
  for (const { storage, adapterId } of storageEntries(registry)) {
    const relocation = storage.relocation || {};
    for (const [field, declaration] of Object.entries(relocation.businessBindings || {})) {
      const spec = typeof declaration === 'string' ? { path: declaration, required: true } : declaration, app = business.apps?.[adapterId];
      if (app && (spec.required !== false || Object.hasOwn(app, field)) && app[field] !== appPathAlias(paths, spec.path, storage.rootId)) fail();
    }
    const map = relocation.spaceMap, input = map && options[map.assertionInput];
    if (input) {
      maps[adapterId] = input;
      for (const [space, file] of Object.entries(input)) {
        const parent = appPathAlias(paths, map.path, storage.rootId);
        if (map.mode === 'space' ? file !== join(parent, space, map.filename) : dirname(file) !== parent) fail();
      }
    }
    const legacy = relocation.legacyConfiguration, value = legacy && options[legacy.input];
    if (value?.[legacy.enabledKey]) for (const [field, alias] of Object.entries(legacy.bindings)) if (value[field] !== appPathAlias(paths, alias, storage.rootId)) fail();
  }
  if (business.observationsFile !== join(paths.observations, 'observations.db') || dirname(business.database) !== paths.platform || dirname(business.eventsDatabase) !== paths.platform) fail();
  for (const item of appStorageSources(paths, maps, { registry, registeredSources: config.appSources })) if (!config.appSources?.some(current => current.id === item.id && current.target === item.target && current.source === item.source)) fail();
  return paths;
}
