import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { appStorageSources, resolveAppPaths } from './app-paths.mjs';

/** Plan infrastructure relocation only. Application record bodies remain untouched. */
export function planAppData({ storage, business, reminderMapping, slidesMapping, polaris, financeFile, configRoot }) {
  const nextStorage = structuredClone(storage);
  nextStorage.workingData ??= { version: 1, roots: {} };
  const paths = resolveAppPaths(nextStorage, { configRoot });
  const nextBusiness = structuredClone(business), nextReminder = structuredClone(reminderMapping), nextSlides = structuredClone(slidesMapping), nextPolaris = structuredClone(polaris);
  const moves = [];
  const add = (id, from, to) => { if (from && from !== to) moves.push({ id, from, to }); };
  for (const [space, file] of Object.entries(nextReminder.spaces)) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,199}$/.test(space)) throw new Error('Invalid Reminder space.');
    nextReminder.spaces[space] = join(paths.reminder, space, 'checklist.json');
    add('reminder', file, nextReminder.spaces[space]);
  }
  const source = (id, target) => storage.appSources.find(item => item.id === id && item.target === target)?.source;
  add('tingproof', dirname(source('tingproof', 'tingproof.db')), paths.roots.tingproof);
  add('lattice', source('slides', 'decks'), paths.slidesDecks);
  add('lattice', source('slides', '.lattice'), paths.slidesState);
  for (const id of ['knowledge', 'memo', 'projects', 'travel', 'slides']) {
    const app = nextBusiness.apps[id]; if (!app) continue;
    const target = id === 'travel' ? paths.travel : id === 'slides' ? paths.slidesBusiness : paths[id];
    add(id, app.dataDir, target); app.dataDir = target;
  }
  const slideFiles = Object.values(nextSlides.spaces);
  if (new Set(slideFiles.map(file => basename(file))).size !== slideFiles.length || slideFiles.some(file => dirname(file) !== business.apps.slides.dataDir)) throw new Error('Slides files must be distinct direct children of its configured business directory.');
  for (const [space, file] of Object.entries(nextSlides.spaces)) nextSlides.spaces[space] = join(paths.slidesBusiness, basename(file));
  if (nextBusiness.apps.tingproof) nextBusiness.apps.tingproof.dataFile = paths.tingproof;
  if (nextPolaris?.enabled) {
    for (const [key, target] of Object.entries({ dataRoot: paths.polaris, browserProfiles: paths.polarisBrowser, browserCache: paths.polarisCache, codexHome: paths.polarisCodex })) { add('polaris', nextPolaris[key], target); nextPolaris[key] = target; }
  }
  if (dirname(business.database) !== dirname(business.eventsDatabase)) throw new Error('Identity/event relocation requires one existing shared state directory.');
  add('praxis', dirname(business.database), paths.platform);
  nextBusiness.database = join(paths.platform, basename(business.database));
  nextBusiness.eventsDatabase = join(paths.platform, basename(business.eventsDatabase));
  add('praxis', dirname(business.observationsFile), paths.observations);
  nextBusiness.observationsFile = join(paths.observations, basename(business.observationsFile));
  const financeSource = financeFile || source('finance', 'finance.json');
  if (financeSource) add('finance', financeSource, paths.finance);
  add('travel', source('travel', 'content'), paths.travelContent);
  const intelligence = source('intelligence', 'data.json');
  if (intelligence) add('intelligence', dirname(intelligence), paths.intelligence);
  const managed = { tingproof: ['tingproof.db'], slides: ['decks', '.lattice', 'business'], knowledge: ['knowledge.db', 'content'], projects: ['projects.db'], memo: ['memo.db'], travel: ['itineraries', 'content'], finance: ['finance.json'], intelligence: ['data.json'] };
  nextStorage.appSources = [...storage.appSources.filter(item => !(item.id === 'reminder' && item.schema === 'reminder-v2') && !managed[item.id]?.includes(item.target)), ...appStorageSources(paths, nextReminder.spaces), ...(intelligence ? [{ id: 'intelligence', kind: 'json', target: 'data.json', source: join(paths.intelligence, 'data.json') }] : [])];
  nextStorage.coverage = { ...nextStorage.coverage, omitted: [
    ...(nextStorage.coverage?.omitted || []).filter(value => !/Memo browser|Travel legacy/.test(value)),
    'Memo browser records not yet imported from a user device remain on that device; server backup cannot prove the import.',
    'Polaris multi-database tree, browser state and tool cache require an app-owned stopped-writer export; live directory backup is not registered.',
    'TingProof original user-selected audio remains external unless explicitly registered.',
  ] };
  return { version: 1, paths, moves, storage: nextStorage, business: nextBusiness, reminderMapping: nextReminder, slidesMapping: nextSlides, polaris: nextPolaris };
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

export function rebasePolarisEnvironment(text, from, to) {
  const lines = text.split('\n'), matches = lines.map((line, index) => /^(?:export\s+)?POLARIS_DATA_ROOT\s*=/.test(line) ? index : -1).filter(index => index >= 0);
  if (matches.length > 1) throw new Error('Polaris environment defines multiple data roots.');
  if (!matches.length) return text;
  const index = matches[0], prefix = lines[index].slice(0, lines[index].indexOf('=') + 1), current = lines[index].slice(prefix.length).trim().replace(/^(['"])(.*)\1$/, '$2');
  if (!isAbsolute(current) || ![from, to].includes(resolve(current))) throw new Error('Polaris environment data root differs from its registered source.');
  lines[index] = prefix + to;
  return lines.join('\n');
}
