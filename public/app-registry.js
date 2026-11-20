import { locale, t } from './i18n.js';

const identity = value => typeof value === 'string' && /^[a-z][a-z0-9-]{0,79}$/.test(value);
const facts = new Map();
export const appNames = Object.create(null);
let pending;
let generation = 0;

export function setAppFacts(apps) {
  if (!Array.isArray(apps) || apps.length > 128) throw new Error('Invalid public app registry.');
  const next = new Map();
  for (const app of apps) {
    if (!app || !identity(app.id) || next.has(app.id) || typeof app.name !== 'string' || !app.name || app.name.length > 160) throw new Error('Invalid public app identity.');
    const entry = app.entry || {};
    const nativePath = entry.nativePath;
    if (nativePath !== undefined && (typeof nativePath !== 'string' || !/^\/apps\/[a-z][a-z0-9-]{0,79}\/$/.test(nativePath))) throw new Error('Invalid public native route.');
    if (entry.legacyPaths !== undefined && (!Array.isArray(entry.legacyPaths) || entry.legacyPaths.length > 16)) throw new Error('Invalid app route prefixes.');
    if (entry.policy !== undefined && !['grant', 'platform-admin', 'document-owner'].includes(entry.policy) || entry.kind !== undefined && !['proxy', 'static', 'private-documents'].includes(entry.kind)) throw new Error('Invalid app entry policy.');
    const prefixes = [nativePath, ...(entry.legacyPaths || [])].filter(Boolean);
    if (prefixes.some(path => typeof path !== 'string' || !/^\/(?:apps|business)\/[a-z][a-z0-9-]{0,79}\/$/.test(path))) throw new Error('Invalid app route prefix.');
    if (entry.adapterId !== undefined && !identity(entry.adapterId)) throw new Error('Invalid public adapter identity.');
    next.set(app.id, { ...app, entry: { ...entry, nativePath, prefixes } });
  }
  facts.clear();
  for (const key of Object.keys(appNames)) delete appNames[key];
  for (const [id, app] of next) {
    facts.set(id, app);
    const name = locale() === 'zh' ? app.labels?.zh?.name || app.name : app.labels?.en?.name || app.name;
    appNames[id] = name;
    if (app.entry.adapterId) appNames[app.entry.adapterId] = name;
  }
  return [...facts.values()];
}

export function appFact(id) { return facts.get(id) || [...facts.values()].find(app => app.entry.adapterId === id); }
export function appFactsEpoch() { return generation; }
export function appName(id) { return appNames[id] || t('Other app', '其他应用'); }
export function entryApps() { return [...facts.values()]; }
export function grantApps() { return entryApps().filter(app => app.entry.policy === 'grant'); }
export function appRoutePrefixes(id) { return appFact(id)?.entry.prefixes || []; }
export function collectionEntries(value, app, origin) {
  if (!value || value.schemaVersion !== 1 || value.appId !== app.id || !Array.isArray(value.entries) || value.entries.length > 2000 || typeof value.partial !== 'boolean') throw new Error('Invalid app collection.');
  const seen = new Set(), safeText = (text, maximum) => typeof text === 'string' && text.length > 0 && text.length <= maximum && !/[\u0000-\u001f\u007f]/.test(text);
  const entries = value.entries.map(item => {
    if (!item || Object.keys(item).some(key => !['id', 'appId', 'resourceId', 'kind', 'name', 'description', 'href'].includes(key)) || item.appId !== app.id || !safeText(item.id, 1000) || seen.has(item.id) || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,499}$/.test(item.resourceId || '') || !safeText(item.kind, 80) || typeof item.name !== 'string' || !item.name.length || item.name.length > 160 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(item.name) || typeof item.description !== 'string' || item.description.length > 2000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(item.description) || typeof item.href !== 'string' || /[\\\u0000-\u0020\u007f]/.test(item.href) || item.href.startsWith('//')) throw new Error('Invalid app collection entry.');
    const raw = item.href.split(/[?#]/, 1)[0];
    if (/%(?:2e|2f|5c)/i.test(raw) || /(?:^|\/)\.{1,2}(?:\/|$)/.test(raw)) throw new Error('Invalid app collection entry.');
    const url = new URL(item.href, origin);
    if (url.origin !== origin || url.username || url.password || !app.entry.nativePath || !url.pathname.startsWith(app.entry.nativePath)) throw new Error('App collection crossed its native route.');
    seen.add(item.id);
    const encoded = [...JSON.stringify([app.id, item.id])].map(char => char.charCodeAt(0).toString(16).padStart(2, '0')).join('');
    return { id: 'collection-' + encoded, appId: app.id, resourceId: item.resourceId, kind: item.kind, name: item.name, description: item.description, icon: app.icon, url: url.href };
  });
  return { entries, partial: value.partial };
}
export function clearAppFacts() { generation++; pending = undefined; facts.clear(); for (const key of Object.keys(appNames)) delete appNames[key]; }

export async function loadAppFacts({ fetchImpl = globalThis.fetch, signal } = {}) {
  if (pending && !signal) return pending;
  const current = generation;
  const work = (async () => {
    const response = await fetchImpl('/api/apps', { credentials: 'same-origin', cache: 'no-store', mode: 'same-origin', redirect: 'error', signal: signal || globalThis.AbortSignal?.timeout?.(6000), headers: { Accept: 'application/json' } });
    if (current !== generation) throw new Error('App registry identity changed.');
    if (!response.ok) { if ([401, 403].includes(response.status)) clearAppFacts(); throw Object.assign(new Error('App registry is unavailable.'), { status: response.status }); }
    const value = await response.json();
    if (current !== generation) throw new Error('App registry identity changed.');
    return setAppFacts(value.apps);
  })();
  if (signal) return work;
  pending = work;
  try { return await work; } finally { if (pending === work) pending = undefined; }
}
