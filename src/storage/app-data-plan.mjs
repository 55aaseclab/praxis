import { DEFAULT_APP_REGISTRY } from '../default-app-registry.mjs';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { appStorageSources, resolveAppPaths, storageEntries, appPathAlias } from './app-paths.mjs';

/** Plan infrastructure relocation only. Application record bodies remain untouched. */
export function planAppData(input) {
  const { storage, business, configRoot, registry = DEFAULT_APP_REGISTRY } = input;
  const nextStorage = structuredClone(storage); nextStorage.workingData ??= { version: 1, roots: {} };
  const paths = resolveAppPaths(nextStorage, { configRoot, registry }), nextBusiness = structuredClone(business), rewritten = {}, moves = [], maps = {}, unavailable = [];
  const add = (id, from, to) => { if (from && from !== to && !moves.some(move => move.from === from && move.to === to)) moves.push({ id, from, to }); };
  const entries = storageEntries(registry);
  for (const { app, storage: declaration, adapterId } of entries) {
    const id = declaration.sourceId || declaration.rootId || app.id, relocation = declaration.relocation || {}, binding = nextBusiness.apps?.[adapterId];
    for (const [field, raw] of Object.entries(relocation.businessBindings || {})) {
      if (!binding) continue;
      const spec = typeof raw === 'string' ? { path: raw } : raw, target = appPathAlias(paths, spec.path, declaration.rootId);
      add(id, binding[field], target); binding[field] = target;
    }
    for (const root of relocation.registeredRoots || []) {
      const registered = storage.appSources.find(source => source.id === id && source.target === root.target);
      const source = (root.argument && input[root.argument]) || registered?.source;
      if (source) add(id, root.parent ? dirname(source) : source, root.root ? paths.roots[declaration.rootId] : appPathAlias(paths, root.path, declaration.rootId));
    }
    const map = relocation.spaceMap;
    if (map && input[map.input]) {
      const value = structuredClone(input[map.input]), files = Object.values(value.spaces || {}), parent = appPathAlias(paths, map.path, declaration.rootId);
      if (map.mode === 'basename' && (new Set(files.map(file => basename(file))).size !== files.length || files.some(file => dirname(file) !== business.apps?.[adapterId]?.[map.businessDirectoryField]))) throw new Error('Mapped files must be distinct direct children of the configured business directory.');
      for (const [space, file] of Object.entries(value.spaces || {})) {
        if (!/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,199}$/.test(space)) throw new Error('Invalid application space.');
        const target = map.mode === 'space' ? join(parent, space, map.filename) : join(parent, basename(file));
        add(id, file, target); value.spaces[space] = target;
      }
      rewritten[map.input] = value; maps[adapterId] = value;
    }
    const legacy = relocation.legacyConfiguration;
    if (legacy && input[legacy.input]) {
      const value = structuredClone(input[legacy.input]);
      if (value[legacy.enabledKey] && legacy.relocationPolicy === 'unavailable' && Object.entries(legacy.bindings).some(([field, alias]) => value[field] !== appPathAlias(paths, alias, declaration.rootId))) unavailable.push({ appId: app.id, code: 'LEGACY_RELOCATION_UNAVAILABLE', reason: 'Legacy execution-tree relocation requires a separate reviewed stopped-writer export; no execution tool or content transform is available.' });
      if (value[legacy.enabledKey]) for (const [field, alias] of Object.entries(legacy.bindings)) { const target = appPathAlias(paths, alias, declaration.rootId); add(id, value[field], target); value[field] = target; }
      rewritten[legacy.input] = value;
    }
  }
  if (dirname(business.database) !== dirname(business.eventsDatabase)) throw new Error('Identity/event relocation requires one existing shared state directory.');
  add('praxis', dirname(business.database), paths.platform); nextBusiness.database = join(paths.platform, basename(business.database)); nextBusiness.eventsDatabase = join(paths.platform, basename(business.eventsDatabase));
  add('praxis', dirname(business.observationsFile), paths.observations); nextBusiness.observationsFile = join(paths.observations, basename(business.observationsFile));
  const managedTargets = new Set(entries.flatMap(({ app, storage: declaration }) => (declaration.sources || []).map(source => `${declaration.sourceId || declaration.rootId || app.id}:${source.primaryTarget || source.target || source.filename}`)));
  nextStorage.appSources = [...storage.appSources.filter(item => !managedTargets.has(`${item.id}:${item.target}`) && !entries.some(({ storage: declaration }) => declaration.sources?.some(source => source.spaceMap && item.id === (declaration.sourceId || declaration.rootId) && item.schema === source.schema))), ...appStorageSources(paths, maps, { registry, registeredSources: storage.appSources })];
  nextStorage.coverage = { ...nextStorage.coverage, omitted: [...new Set([...(nextStorage.coverage?.omitted || []), ...entries.flatMap(({ storage: declaration }) => declaration.omissions || [])])] };
  // Parent directory relocation already covers a child mapped to the same suffix.
  const compact = moves.filter(move => !moves.some(parent => parent !== move && move.from.startsWith(parent.from + '/') && move.to === parent.to + move.from.slice(parent.from.length)));
  return { version: 1, paths, moves: compact, unavailable, storage: nextStorage, business: nextBusiness, ...rewritten };
}

/** Deployment prototypes contain typed mount/environment metadata, never record bodies. */
export function rebaseDeploymentPrototype(prototype, moves) {
  const next = structuredClone(prototype);
  const path = value => {
    if (typeof value !== 'string') return value;
    const match = [...moves].sort((a, b) => b.from.length - a.from.length).find(item => value === item.from || value.startsWith(item.from + '/'));
    return match ? match.to + value.slice(match.from.length) : value;
  };
  for (const mount of next.Mounts || []) if (mount.Type === 'bind') { mount.Source = path(mount.Source); mount.Destination = path(mount.Destination); }
  if (next.Config?.Env) next.Config.Env = next.Config.Env.map(value => {
    const equal = value.indexOf('=');
    return value.slice(0, equal) === 'PRAXIS_OBSERVATIONS_FILE' ? value.slice(0, equal + 1) + path(value.slice(equal + 1)) : value;
  });
  return next;
}

export function rebasePolarisEnvironment(text, from, to, { registry = DEFAULT_APP_REGISTRY } = {}) {
  const declarations = storageEntries(registry).flatMap(({ storage }) => storage.relocation?.legacyEnvironment ? [storage.relocation.legacyEnvironment] : []);
  if (declarations.length !== 1 || !/^[A-Z][A-Z0-9_]{0,119}$/.test(declarations[0].variable)) throw new Error('A unique app-owned legacy environment binding is required.');
  const variable = declarations[0].variable, pattern = new RegExp('^(?:export\\s+)?' + variable + '\\s*='), lines = text.split('\n'), matches = lines.map((line, index) => pattern.test(line) ? index : -1).filter(index => index >= 0);
  if (matches.length > 1) throw new Error('Application environment defines multiple data roots.');
  if (!matches.length) return text;
  const index = matches[0], prefix = lines[index].slice(0, lines[index].indexOf('=') + 1), current = lines[index].slice(prefix.length).trim().replace(/^(['"])(.*)\1$/, '$2');
  if (!isAbsolute(current) || ![from, to].includes(resolve(current))) throw new Error('Application environment data root differs from its registered source.');
  lines[index] = prefix + to;
  return lines.join('\n');
}
