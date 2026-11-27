// Reviewed app providers expose read-only projections in the current browser.
import { appFact, appFactsEpoch, appRoutePrefixes, setAppFacts } from './app-registry.js';
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value, maximum = 10000) => typeof value === 'string' && value.length > 0 && value.length <= maximum && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value);
export function localizedText(value, language = 'en') {
  if (typeof value === 'string') return value;
  if (!object(value)) return '';
  return typeof value[language] === 'string' ? value[language] : typeof value.en === 'string' ? value.en : typeof value.zh === 'string' ? value.zh : '';
}
const label = value => text(value, 2000) || object(value) && text(value.en, 2000) && text(value.zh, 2000);
export function providerReadHref(path, appId, origin) {
  if (!text(path, 4096)) throw new Error('Invalid provider read.');
  const prefix = appFact(appId)?.entry.nativePath;
  if (!prefix) throw new Error('Provider app has no registered native route.');
  const absolute = /^[a-z][a-z\d+.-]*:/i.test(path) || path.startsWith('/apps/') || path.startsWith('/business/') || path.startsWith('//');
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
  const currentEpoch = appFactsEpoch();
  const response = await fetchImpl('/api/workbench/providers', { credentials: 'same-origin', mode: 'same-origin', redirect: 'error', cache: 'no-store', signal });
  if (!response.ok) throw new Error('Browser providers are unavailable.');
  const manifest = await response.json();
  if (signal?.aborted || currentEpoch !== appFactsEpoch()) throw new Error('Browser provider identity changed.');
  if (!object(manifest) || manifest.schemaVersion !== 1 || !Array.isArray(manifest.providers) || manifest.providers.length > 32) throw new Error('Invalid browser provider manifest.');
  if (manifest.apps !== undefined) setAppFacts(manifest.apps);
  const seen = new Set();
  for (const provider of manifest.providers) {
    if (!object(provider) || !appFact(provider.appId) || !appFact(provider.appId).entry.nativePath || !reviewedModuleUrl(provider.moduleUrl, provider.appId, origin) || seen.has(provider.appId)) throw new Error('Unreviewed browser provider.');
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
      const items = value.items.map(item => {
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
