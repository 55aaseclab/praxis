// Reviewed app providers expose read-only projections in the current browser.
export const APP_ROUTES = Object.freeze({ reminder: 'reminder', knowledge: 'knowledge', 'lattice-slides': 'slides', travel: 'travel', tingproof: 'tingproof', memo: 'memo', finance: 'finance', intelligence: 'intelligence', calendar: 'calendar', 'matrix-reader': 'matrix-reader', projects: 'projects', letters: 'letters', profiles: 'profiles' });
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value, maximum = 10000) => typeof value === 'string' && value.length > 0 && value.length <= maximum && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value);
export function localizedText(value, language = 'en') {
  if (typeof value === 'string') return value;
  if (!object(value)) return '';
  return typeof value[language] === 'string' ? value[language] : typeof value.en === 'string' ? value.en : typeof value.zh === 'string' ? value.zh : '';
}
const label = value => text(value, 2000) || object(value) && text(value.en, 2000) && text(value.zh, 2000);
export function nativeHref(value, appId, origin) {
  if (!Object.hasOwn(APP_ROUTES, appId) || !text(value, 4096) || /[\\\u0000-\u0020\u007f]/u.test(value)) throw new Error('Invalid app entry.');
  const rawPath=value.split(/[?#]/,1)[0];
  if(/%(?:2e|2f|5c)/i.test(rawPath)||/(?:^|\/)\.{1,2}(?:\/|$)/.test(rawPath))throw new Error('Invalid app entry.');
  const url = new URL(value, origin);
  if (url.origin !== origin || url.username || url.password) throw new Error('App entries must stay on their registered origin.');
  const prefix = `/apps/${APP_ROUTES[appId]}/`;
  const reminder = appId === 'reminder' && url.pathname === '/business/reminder/';
  if (!url.pathname.startsWith(prefix) && !reminder) throw new Error('App entry is outside its registered route.');
  return url.pathname + url.search + url.hash;
}
export function evidenceHref(value, origin) {
  if(!text(value,4096)||/[\\\u0000-\u0020\u007f]/u.test(value)||value.startsWith('//'))throw new Error('Invalid evidence entry.');
  const rawPath=value.split(/[?#]/,1)[0];
  if(/%(?:2e|2f|5c)/i.test(rawPath)||/(?:^|\/)\.{1,2}(?:\/|$)/.test(rawPath))throw new Error('Invalid evidence entry.');
  const url=new URL(value,origin);
  if(url.username||url.password)throw new Error('Invalid evidence entry.');
  if(url.origin===origin){if(!/^\/(?:apps|business)\/[a-z][a-z0-9-]*\//.test(url.pathname)||/%(?:2e|2f|5c)/i.test(url.pathname))throw new Error('Invalid evidence entry.');return url.pathname+url.search+url.hash;}
  if(url.protocol!=='https:')throw new Error('Invalid evidence entry.');
  return url.href;
}
export function validateCard(value, origin) {
  if (!object(value) || !Object.hasOwn(APP_ROUTES, value.appId) || !text(value.id, 1000) || !text(value.resourceId, 500) || !text(value.revision, 500) || !['reminder', 'result', 'decision'].includes(value.kind) || !text(value.title, 20000) || !label(value.reason) || !object(value.source) || !text(value.source.name, 200) || !object(value.primaryAction) || !label(value.primaryAction.label) || !Array.isArray(value.evidence) || value.evidence.length > 64) throw new Error('Invalid app card.');
  if (value.spaceId !== undefined && !text(value.spaceId, 500) || value.preview !== undefined && !text(value.preview, 20000) || value.date !== undefined && value.date !== null && !text(value.date, 100) || value.updatedAt !== undefined && !Number.isFinite(Date.parse(value.updatedAt))) throw new Error('Invalid app card metadata.');
  const primaryAction = { ...value.primaryAction, href: nativeHref(value.primaryAction.href, value.appId, origin) };
  const evidence = value.evidence.map(entry => {
    if (!object(entry) || !label(entry.label) || entry.excerpt !== undefined && !text(entry.excerpt, 20000) || entry.revision !== undefined && !text(entry.revision, 500)) throw new Error('Invalid card evidence.');
    return { ...entry, ...(entry.href !== undefined && { href: evidenceHref(entry.href, origin) }) };
  });
  return { ...value, primaryAction, evidence };
}
export function validateCardEnvelope(value, origin) {
  if (!object(value) || value.schemaVersion !== 1 || !Array.isArray(value.items) || value.items.length > 2000 || !Array.isArray(value.sources) || typeof value.partial !== 'boolean' || !Number.isFinite(Date.parse(value.generatedAt))) throw new Error('Invalid workbench card projection.');
  const seen = new Set();
  const items = value.items.map(item => {
    const checked = validateCard(item, origin);
    if (seen.has(checked.id)) throw new Error('Duplicate card identity.');
    seen.add(checked.id); return checked;
  });
  const sources = value.sources.map(source => {
    if (!object(source) || !text(source.appId, 100) || !['ready', 'empty', 'unavailable', 'browser', 'denied', 'unsupported', 'partial'].includes(source.status) || source.message !== undefined && !label(source.message)) throw new Error('Invalid card source.');
    return { ...source };
  });
  return { ...value, items, sources };
}
export function validatePreferences(value) {
  if (!object(value) || (!Number.isSafeInteger(value.revision) || value.revision < 0) || !Array.isArray(value.items) || value.items.length > 10000) throw new Error('Invalid personal card preferences.');
  const seen = new Set();
  const items = value.items.map(item => {
    if (!object(item) || !text(item.cardId, 1000) || !text(item.cardRevision, 500) || !['later', 'hidden'].includes(item.state) || item.state === 'later' && !Number.isFinite(Date.parse(item.until))) throw new Error('Invalid personal card state.');
    if (seen.has(item.cardId)) throw new Error('Duplicate personal card identity.');
    seen.add(item.cardId); return { ...item };
  });
  return { revision: value.revision, items };
}
export function personalCardState(card, preferences, now = Date.now()) {
  const record = preferences.items.find(item => item.cardId === card.id);
  if (!record) return 'visible';
  if (record.state === 'later' && Date.parse(record.until) > now) return 'later';
  if (record.state === 'hidden' && record.cardRevision === card.revision) return 'hidden';
  return 'visible';
}
export function laterTime(choice, now = new Date()) {
  const date = new Date(now);
  if (choice === 'tomorrow') { date.setDate(date.getDate() + 1); date.setHours(9, 0, 0, 0); }
  else if (choice === 'today') {
    date.setHours(18, 0, 0, 0);
    if (date <= now) date.setHours(23, 59, 59, 999);
  } else throw new Error('Unknown personal review time.');
  return date.toISOString();
}
export function providerReadHref(path, appId, origin) {
  if (!text(path, 4096)) throw new Error('Invalid provider read.');
  const prefix = `/apps/${APP_ROUTES[appId]}/`;
  const absolute = /^[a-z][a-z\d+.-]*:/i.test(path) || path.startsWith('/apps/') || path.startsWith('//');
  const href = absolute ? path : prefix + path.replace(/^\/+/, '');
  const checked = nativeHref(href, appId, origin);
  const url = new URL(checked, origin);
  if (!url.pathname.startsWith(prefix) || url.hash) throw new Error('Provider reads must stay inside their native app.');
  return url.href;
}
function reviewedModuleUrl(value,appId,origin){
  if(typeof value!=='string'||!value.startsWith('/app-providers/'))return false;
  const url=new URL(value,origin);
  return url.origin===origin&&url.pathname===`/app-providers/${appId}.mjs`&&!url.hash&&[...url.searchParams.keys()].every(key=>key==='v')&&url.searchParams.getAll('v').length<=1&&(!url.searchParams.has('v')||/^[a-f0-9]{12,64}$/.test(url.searchParams.get('v')));
}
export async function readBrowserProviders({ kind, identity, signal, fetchImpl = fetch, importModule = value => import(value), origin = globalThis.location?.origin } = {}) {
  if (!['cards', 'data'].includes(kind) || !origin) throw new Error('Invalid browser provider request.');
  const response = await fetchImpl('/api/workbench/providers', { credentials: 'same-origin', mode: 'same-origin', redirect: 'error', cache: 'no-store', signal });
  if (!response.ok) throw new Error('Browser providers are unavailable.');
  const manifest = await response.json();
  if (!object(manifest) || manifest.schemaVersion !== 1 || !Array.isArray(manifest.providers) || manifest.providers.length > 32) throw new Error('Invalid browser provider manifest.');
  const seen = new Set();
  for (const provider of manifest.providers) {
    if (!object(provider) || !Object.hasOwn(APP_ROUTES, provider.appId) || !reviewedModuleUrl(provider.moduleUrl, provider.appId, origin) || seen.has(provider.appId)) throw new Error('Unreviewed browser provider.');
    seen.add(provider.appId);
  }
  const results = await Promise.all(manifest.providers.filter(provider => kind === 'cards' || provider.dataExecution !== 'server').map(async provider => {
    try {
      const module = await importModule(new URL(provider.moduleUrl, origin).href);
      if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
      const description = await module.describe();
      if (!object(description) || description.version !== 1 || description.appId !== provider.appId) throw new Error('Invalid browser provider description.');
      if (kind === 'cards' && (!object(description.cards) || typeof description.cards.supported !== 'boolean')) throw new Error('Missing browser card declaration.');
      if (kind === 'cards' && !description.cards.supported) return { appId: provider.appId, description, status: 'unsupported', items: [], ...(description.cards.reason && { message: description.cards.reason }) };
      if (kind === 'cards' && description.cards.execution !== 'browser') throw new Error('Browser card execution is not declared.');
      const method = kind === 'cards' ? module.getCards : module.getDataInventory;
      if (typeof method !== 'function') throw new Error('Missing read-only provider operation.');
      const context = Object.freeze({
        identity: Object.freeze({ username: identity?.username ?? '', ...(identity?.userId ? { userId: identity.userId } : {}) }),
        read: async path => {
          const target = providerReadHref(path, provider.appId, origin);
          const result = await fetchImpl(target, { method: 'GET', credentials: 'same-origin', mode: 'same-origin', redirect: 'error', cache: 'no-store', signal });
          if (!result.ok) throw new Error('The app source could not be read.');
          return result.headers.get('content-type')?.includes('json') ? result.json() : result.text();
        },
      });
      const value = await method(context);
      if (!object(value) || !['ready', 'empty', 'unsupported', 'unavailable', 'partial'].includes(value.status) || !Array.isArray(value.items) || value.items.length > 2000 || value.message !== undefined && !label(value.message)) throw new Error('Invalid browser provider projection.');
      const items = kind === 'cards' ? value.items.map(item => {
        const checked = validateCard(item, origin);
        if (checked.appId !== provider.appId) throw new Error('Browser provider crossed its app boundary.');
        return checked;
      }) : value.items.map(item => {
        if (!object(item) || !label(item.label) || !['json', 'sqlite', 'directory', 'browser', 'docker-volume', 'source', 'cache', 'derived', 'external', 'browser-file', 'unknown'].includes(item.kind) || item.appId !== undefined && item.appId !== provider.appId || ['hostPath', 'containerPath', 'volumeName', 'storageKey'].some(key => item[key] !== undefined && !text(item[key], 2048)) || item.description !== undefined && !label(item.description)) throw new Error('Invalid browser data location.');
        const { appId: ignored, ...location } = item; return location;
      });
      return { appId: provider.appId, description, status: value.status, items, ...(value.message !== undefined && { message: value.message }) };
    } catch (error) {
      if (signal?.aborted) throw error;
      return { appId: provider.appId, status: 'unavailable', items: [], message: { en: 'This browser source could not be refreshed.', zh: '此浏览器来源暂时无法刷新。' } };
    }
  }));
  return results;
}
