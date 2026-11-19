import { homedir } from 'node:os';
import { lstat, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';

export const APP_DATA_IDS = Object.freeze(['reminder', 'tingproof', 'knowledge', 'travel', 'lattice', 'memo', 'finance', 'projects', 'polaris', 'intelligence', 'praxis']);
const inside = (a, b) => { const rel = relative(a, b); return rel === '' || rel !== '..' && !rel.startsWith('../') && !isAbsolute(rel); };
const overlap = (a, b) => inside(a, b) || inside(b, a);
const fail = () => { throw Object.assign(new Error('Working data requires independent canonical directories outside source, secrets and backups.'), { code: 'INVALID_APP_DATA_PATH' }); };

/** One deployment input determines every app's working root, including overrides. */
export function resolveAppPaths(config, { sourceRoot = resolve(new URL('../../', import.meta.url).pathname), configRoot = join(homedir(), '.config/praxis') } = {}) {
  const input = config.workingData || { version: 1, roots: {} };
  if (!input || input.version !== 1 || Object.keys(input).some(key => !['version', 'roots'].includes(key)) || !input.roots || typeof input.roots !== 'object' || Array.isArray(input.roots) || Object.keys(input.roots).some(id => !APP_DATA_IDS.includes(id))) fail();
  const base = join(config.dataRoot, 'workspaces', config.workspaceId, 'apps');
  const roots = Object.fromEntries(APP_DATA_IDS.map(id => [id, input.roots[id] ?? join(base, id)]));
  const protectedPaths = [sourceRoot, configRoot, config.stateRoot, ...(config.sourceRepos || []).map(repo => repo.path), ...(config.repositories || []).flatMap(repo => [repo.path, repo.passwordFile && dirname(repo.passwordFile), repo.credentialsFile && dirname(repo.credentialsFile), repo.rcloneConfigFile && dirname(repo.rcloneConfigFile)])].filter(Boolean).map(path => resolve(path));
  for (const [id, path] of Object.entries(roots)) {
    if (typeof path !== 'string' || !isAbsolute(path) || resolve(path) !== path || /[\\\x00-\x1f\x7f$?#]/.test(path) || path.split('/').filter(Boolean).length < 3 || protectedPaths.some(other => overlap(path, other)) || Object.entries(roots).some(([other, value]) => other !== id && typeof value === 'string' && overlap(path, value))) fail();
  }
  return { roots, reminder: join(roots.reminder, 'spaces'), tingproof: join(roots.tingproof, 'tingproof.db'), knowledge: roots.knowledge, knowledgeContent: join(roots.knowledge, 'content'), travel: join(roots.travel, 'itineraries'), travelContent: join(roots.travel, 'content'), slidesDecks: join(roots.lattice, 'native/decks'), slidesState: join(roots.lattice, 'native/.lattice'), slidesBusiness: join(roots.lattice, 'business'), memo: roots.memo, intelligence: roots.intelligence, finance: join(roots.finance, 'finance.json'), projects: roots.projects, polaris: join(roots.polaris, 'data'), polarisBrowser: join(roots.polaris, 'browser'), polarisCache: join(roots.polaris, 'cache'), polarisCodex: join(roots.polaris, 'codex'), platform: join(roots.praxis, 'business'), observations: join(roots.praxis, 'observations') };
}

export async function validateAppPathParents(paths) {
  for (const path of Object.values(paths.roots)) {
    let ancestor = path;
    while (!await lstat(ancestor).catch(error => { if (error.code === 'ENOENT') return null; throw error; })) ancestor = dirname(ancestor);
    const info = await lstat(ancestor);
    if (!info.isDirectory() || info.isSymbolicLink() || await realpath(ancestor) !== ancestor || info.mode & 0o022) fail();
  }
}

export function appStorageSources(paths, reminderSpaces = {}) {
  return [
    ...Object.entries(reminderSpaces).map(([space, file], index) => ({ id: 'reminder', kind: 'json', schema: 'reminder-v2', source: file, target: index ? `spaces/${space}/checklist.json` : 'checklist.json' })),
    { id: 'tingproof', kind: 'sqlite', source: paths.tingproof, target: 'tingproof.db' },
    { id: 'slides', kind: 'directory', source: paths.slidesDecks, target: 'decks' },
    { id: 'slides', kind: 'directory', source: paths.slidesState, target: '.lattice' },
    { id: 'slides', kind: 'directory', source: paths.slidesBusiness, target: 'business' },
    ...['knowledge', 'projects', 'memo'].map(id => ({ id, kind: 'sqlite', source: join(paths[id], `${id}.db`), target: `${id}.db` })),
    { id: 'travel', kind: 'directory', source: paths.travel, target: 'itineraries' },
    { id: 'travel', kind: 'directory', source: paths.travelContent, target: 'content' },
    { id: 'knowledge', kind: 'directory', source: paths.knowledgeContent, target: 'content' },
    { id: 'finance', kind: 'json', source: paths.finance, target: 'finance.json' },
  ];
}

/** Reject stale generated bindings; changing a root requires a stopped-writer handover. */
export function assertAppBindings(config, business, { reminderSpaces, slidesSpaces, polaris } = {}) {
  if (!config.workingData) return;
  const p = resolveAppPaths(config);
  for (const id of ['knowledge', 'memo', 'projects']) if (business.apps?.[id] && business.apps[id].dataDir !== p[id]) fail();
  if (business.apps?.travel && business.apps.travel.dataDir !== p.travel || business.apps?.slides && business.apps.slides.dataDir !== p.slidesBusiness || business.observationsFile !== join(p.observations, 'observations.db') || dirname(business.database) !== p.platform || dirname(business.eventsDatabase) !== p.platform) fail();
  if (reminderSpaces && Object.entries(reminderSpaces).some(([id, file]) => file !== join(p.reminder, id, 'checklist.json'))) fail();
  if (slidesSpaces && Object.values(slidesSpaces).some(file => dirname(file) !== p.slidesBusiness)) fail();
  if (polaris?.enabled && (polaris.dataRoot !== p.polaris || polaris.browserProfiles !== p.polarisBrowser || polaris.browserCache !== p.polarisCache || polaris.codexHome !== p.polarisCodex)) fail();
  const expected = appStorageSources(p, reminderSpaces);
  for (const item of expected.filter(item => item.id !== 'polaris')) {
    if (!config.appSources?.some(current => current.id === item.id && current.target === item.target && current.source === item.source)) fail();
  }
  return p;
}
