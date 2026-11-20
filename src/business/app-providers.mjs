import { lstat, realpath } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readApps } from '../apps.mjs';

export const PROVIDER_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const kinds = new Set(['reminder', 'result', 'decision']);
const statuses = new Set(['ready', 'empty', 'unsupported', 'unavailable', 'partial']);
const dataKinds = new Set(['json', 'sqlite', 'directory', 'browser', 'docker-volume', 'source', 'cache', 'unknown', 'browser-file', 'derived', 'external']);
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value, max = 1024) => typeof value === 'string' && value.length > 0 && value.length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value);
const invalid = () => Object.assign(new Error('Invalid app provider response.'), { code: 'INVALID_APP_PROVIDER' });
function copyText(value, maximum = 1024) {
  if (text(value, maximum)) return value;
  if (plain(value) && text(value.en, maximum) && text(value.zh, maximum)) return { en: value.en, zh: value.zh };
  throw invalid();
}
export function providerHref(appId, raw) {
  if (!text(raw, 4096) || !raw.startsWith('/') || raw.startsWith('//') || /[\\\r\n]/.test(raw)) throw invalid();
  const rawPath=raw.split(/[?#]/,1)[0];
  if(/%(?:2e|2f|5c)/i.test(rawPath)||/(?:^|\/)\.{1,2}(?:\/|$)/.test(rawPath))throw invalid();
  const url = new URL(raw, 'http://praxis.invalid');
  const slug = appId === 'lattice-slides' ? 'slides' : appId;
  const prefixes = [`/apps/${slug}/`, `/business/${slug}/`];
  if (url.origin !== 'http://praxis.invalid' || /%(?:2e|2f|5c)/i.test(url.pathname) || !prefixes.some(prefix => url.pathname.startsWith(prefix))) throw invalid();
  return url.pathname + url.search + url.hash;
}
export function providerEvidenceHref(raw) {
  if (!text(raw,4096) || /[\\\r\n]/.test(raw) || raw.startsWith('//')) throw invalid();
  const rawPath=raw.split(/[?#]/,1)[0];
  if(/%(?:2e|2f|5c)/i.test(rawPath)||/(?:^|\/)\.{1,2}(?:\/|$)/.test(rawPath))throw invalid();
  const url=new URL(raw,'http://praxis.invalid');
  if(url.username||url.password)throw invalid();
  if(url.origin==='http://praxis.invalid') {
    if(!/^\/(?:apps|business)\/[a-z][a-z0-9-]*\//.test(url.pathname)||/%(?:2e|2f|5c)/i.test(url.pathname))throw invalid();
    return url.pathname+url.search+url.hash;
  }
  if(url.protocol!=='https:')throw invalid();
  return url.href;
}
export function normalizeProviderCard(appId, value) {
  if (!plain(value) || !text(value.id) || !text(value.revision, 256) || !kinds.has(value.kind) || !text(value.title, 1000) || !text(value.resourceId || value.source?.resourceId, 512) || value.reason === undefined || !plain(value.primaryAction)) throw invalid();
  if (value.appId && value.appId !== appId) throw invalid();
  if (!value.resourceId && value.source?.resourceId) value={...value,resourceId:value.source.resourceId};
  if (!value.spaceId && value.source?.spaceId) value={...value,spaceId:value.source.spaceId};
  const id = value.id.startsWith(`${appId}:`) ? value.id : `${appId}:${value.id}`;
  const card = { id, appId, revision: value.revision, kind: value.kind, title: value.title,
    primaryAction: { href: providerHref(appId, value.primaryAction.href), label: copyText(value.primaryAction.label, 160) },
    evidence: [], source: { name: text(value.source?.name, 160) ? value.source.name : appId } };
  if (text(value.primaryAction.labels?.zh, 160) && typeof card.primaryAction.label === 'string') card.primaryAction.label = { en: card.primaryAction.label, zh: value.primaryAction.labels.zh };
  if (value.reason !== undefined) card.reason = copyText(value.reason, 1000);
  if (text(value.labels?.zh?.reason, 1000) && typeof card.reason === 'string') card.reason = { en: card.reason, zh: value.labels.zh.reason };
  for (const key of ['spaceId', 'resourceId', 'itemId', 'domain']) if (value[key] !== undefined) { if (!text(value[key], 512)) throw invalid(); card[key] = value[key]; }
  if (value.preview !== undefined) { if (!text(value.preview, 8000)) throw invalid(); card.preview = value.preview; }
  if (value.date === undefined && value.dueDate !== undefined) value={...value,date:value.dueDate};
  if (value.date !== undefined && value.date !== null) { if (!text(value.date, 80) || Number.isNaN(Date.parse(value.date))) throw invalid(); card.date = value.date; }
  if (value.updatedAt !== undefined) { if (!text(value.updatedAt, 80) || Number.isNaN(Date.parse(value.updatedAt))) throw invalid(); card.updatedAt = value.updatedAt; }
  if (value.evidence !== undefined) {
    if (!Array.isArray(value.evidence) || value.evidence.length > 24) throw invalid();
    card.evidence = value.evidence.map(entry => {
      if (!plain(entry)) throw invalid();
      const evidence = { label: copyText(entry.label, 400) };
      if(text(entry.labels?.zh,400)&&typeof evidence.label==='string')evidence.label={en:evidence.label,zh:entry.labels.zh};
      for (const [key, maximum] of [['excerpt', 8000], ['revision', 256]]) if (entry[key] !== undefined) { if (!text(entry[key], maximum)) throw invalid(); evidence[key] = entry[key]; }
      if (entry.href !== undefined) evidence.href = providerEvidenceHref(entry.href);
      return evidence;
    });
  }
  return card;
}
export function validateProviderResult(value) {
  if (!plain(value) || !statuses.has(value.status) || !Array.isArray(value.items) || value.items.length > 1000) throw invalid();
  return value;
}
export function normalizeProviderLocation(value) {
  if (!plain(value) || !text(value.label, 300) || !dataKinds.has(value.kind)) throw invalid();
  const output = { label: value.label, kind: value.kind };
  for (const [key, maximum] of [['id',160],['status',80],['applicationPath',2048],['hostPath',2048],['containerPath',2048],['volumeName',256],['storageKey',256],['description',2000]]) {
    if (value[key] !== undefined) { if (!text(value[key], maximum)) throw invalid(); output[key] = value[key]; }
  }
  if (value.labels?.zh && text(value.labels.zh,300)) output.labels = { zh: value.labels.zh };
  if (value.kind === 'browser' && ['hostPath','containerPath','volumeName'].some(key => output[key])) throw invalid();
  return output;
}

export class AppProviderRegistry {
  constructor({ root = PROVIDER_ROOT, catalog } = {}) { this.root = resolve(root); this.fixedCatalog = catalog; this.cache = new Map(); }
  async catalog() {
    const value = this.fixedCatalog ?? await readApps(this.root, { publicUrlsFile: null });
    if (!Array.isArray(value) || value.length > 128) throw invalid();
    return value.filter(app => app?.builtin && app.kind === 'app');
  }
  async load(app) {
    if (!text(app.id,80) || !/^third_party\/[a-z][a-z0-9-]*$/.test(app.source || '')) throw invalid();
    const file = resolve(this.root, app.source, 'praxis-provider.mjs');
    const info = await lstat(file);
    if (!info.isFile() || info.isSymbolicLink() || info.size > 256 * 1024 || !(await realpath(file)).startsWith(this.root + sep)) throw invalid();
    const cached = this.cache.get(app.id);
    if (cached?.stamp === `${file}:${info.mtimeMs}:${info.size}`) return { ...cached.value, app };
    const module = await import(pathToFileURL(file).href + `?v=${info.mtimeMs}-${info.size}`);
    const descriptor = module.describe?.();
    if (!plain(descriptor) || descriptor.version !== 1 || descriptor.appId !== app.id || !plain(descriptor.cards) || typeof descriptor.cards.supported !== 'boolean' || !Array.isArray(descriptor.dataSources) || descriptor.dataSources.length > 64 || typeof module.getDataInventory !== 'function' || descriptor.cards.supported && typeof module.getCards !== 'function') throw invalid();
    if (descriptor.nativeReads !== undefined && (!Array.isArray(descriptor.nativeReads) || descriptor.nativeReads.some(path => !text(path,200) || !path.startsWith('/api/') || /[?#\\]/.test(path)))) throw invalid();
    const ids = new Set();
    for (const source of descriptor.dataSources) { if (!plain(source) || !text(source.id,160) || ids.has(source.id) || !dataKinds.has(source.kind) || !text(source.label,300)) throw invalid(); ids.add(source.id); }
    const value = { app, module, descriptor };
    this.cache.set(app.id, { stamp: `${file}:${info.mtimeMs}:${info.size}`, value });
    return value;
  }
  async providers() {
    return await Promise.all((await this.catalog()).map(async app => {
      try { return await this.load(app); }
      catch { return { app, error: 'PROVIDER_UNAVAILABLE' }; }
    }));
  }
  async inventory({ resolveDataSource, bindings, workspaceRoot, clock = Date.now } = {}) {
    const providers = await this.providers(), apps = [], sources = [];
    for (const provider of providers) {
      const { app, module, descriptor } = provider;
      if (provider.error) { apps.push({ id:app.id, name:app.name, locations:[] }); sources.push({appId:app.id,status:'unavailable',code:provider.error}); continue; }
      try {
        const declared = new Map(descriptor.dataSources.map(item => [item.id, item]));
        const value = validateProviderResult(await module.getDataInventory({
          resolveDataSource: async item => {
            if (!declared.has(item?.id) || JSON.stringify(item) !== JSON.stringify(declared.get(item.id))) throw invalid();
            return await resolveDataSource(item, { app, descriptor, bindings });
          }
        }));
        apps.push({ id:app.id, name:app.name, locations:value.items.map(normalizeProviderLocation) });
        sources.push({appId:app.id,status:value.status});
      } catch { apps.push({id:app.id,name:app.name,locations:[]}); sources.push({appId:app.id,status:'unavailable',code:'PROVIDER_UNAVAILABLE'}); }
    }
    return { schemaVersion:1, generatedAt:new Date(clock()).toISOString(), ...(workspaceRoot?{workspaceRoot}:{}), apps, sources, partial:sources.some(source=>['partial','unavailable'].includes(source.status)) };
  }
}
