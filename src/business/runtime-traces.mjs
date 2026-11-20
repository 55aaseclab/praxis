import { AppProviderRegistry } from './app-providers.mjs';
import { DEFAULT_APP_REGISTRY } from '../default-app-registry.mjs';
import { canReadAppCards } from './app-cards.mjs';

const safeId = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/.test(value);
const version = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:+-]{0,127}$/.test(value);
const timestamp = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
const status = value => ['queued', 'running', 'waiting', 'succeeded', 'failed', 'cancelled', 'unknown'].includes(value) ? value : 'unknown';
const failure = (status, code) => Object.assign(new Error(code), { status, code });
export function runtimeTraceReport(state, now = Date.now()) {
  return { schemaVersion: 1, state, source: 'runtime', generatedAt: new Date(now).toISOString(), coverage: { runtime: { kind: 'runtime-observation', count: state === 'empty' ? 0 : null, firstRecordedAt: null, lastRecordedAt: null } }, items: [], nextCursor: null };
}
async function readJson(response) {
  if (!response.ok) throw Error('Runtime source unavailable.');
  let size = 0; const chunks = [];
  for await (const chunk of response.body) { size += chunk.length; if (size > 128 * 1024) throw Error('Runtime metadata exceeds the limit.'); chunks.push(chunk); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

export function createRuntimeTraceReader({ auth, config, registry = new AppProviderRegistry({ root: config.providerRoot }), integrations = auth.registry || DEFAULT_APP_REGISTRY, fetchImpl = fetch, clock = Date.now }) {
  return async ({ token, before, limit = 25 } = {}) => {
    const candidates=integrations.apps.filter(app=>app.integration.web.runtimeTrace);
    const app=config.runtimeTraceAppId?candidates.find(app=>app.id===config.runtimeTraceAppId):candidates.length===1?candidates[0]:null;
    if(!app)return runtimeTraceReport(candidates.length?'unavailable':'not_configured',clock());
    const definition=app.integration.web.runtimeTrace,endpoint=definition.path;
    const authorize=()=>{auth.requirePlatformAdminSession(token);if(auth.getWebAccess&&!canReadAppCards(auth.getWebAccess(token),app.id,config,integrations))throw failure(403,'FORBIDDEN');};
    authorize();
    if (before !== undefined && (!Number.isSafeInteger(before) || before < 1) || !Number.isSafeInteger(limit) || limit < 1 || limit > 50) throw failure(400, 'INVALID_TRACE_QUERY');
    const configured = config.appProviders?.[app.id]?.url;
    if (!configured) return runtimeTraceReport('not_configured', clock());
    try {
      const origin = new URL(configured);
      if (!['http:', 'https:'].includes(origin.protocol) || origin.username || origin.password || origin.search || origin.hash || origin.pathname !== '/' || origin.protocol === 'http:' && !['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname)) throw Error('Invalid runtime origin.');
      const provider = (await registry.providers()).find(value => value.app.id === app.id);
      if (provider?.error || !provider?.descriptor?.traces?.supported || !provider.descriptor.nativeReads?.includes(endpoint) || typeof provider.module.getTraces !== 'function') throw Error('Runtime provider unavailable.');
      authorize();
      const page = await provider.module.getTraces({ now: clock(), query: { ...(before !== undefined ? { before } : {}), limit }, readNative: async request => {
        authorize();
        if (request?.path !== endpoint || Object.keys(request).some(key => !['path', 'query'].includes(key)) || !request.query || Object.keys(request.query).some(key => !['before', 'limit'].includes(key)) || request.query.limit !== limit || request.query.before !== before) throw failure(403, 'FORBIDDEN');
        const url = new URL(endpoint, origin); for (const [key, value] of Object.entries(request.query)) url.searchParams.set(key, String(value));
        const value = await readJson(await fetchImpl(url, { method: 'GET', headers: { Accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(5000) })); authorize(); return value;
      } });
      authorize();
      if (page?.schemaVersion !== 1 || page.source !== 'runtime-observation' || !['ready', 'empty', 'not_configured', 'unavailable'].includes(page.state) || !Array.isArray(page.runs) || page.runs.length > 50) throw Error('Invalid runtime source.');
      if (!['ready', 'empty'].includes(page.state)) return runtimeTraceReport(page.state, clock());
      const items = page.runs.map(run=>definition.normalizeRun(run)), coverage = page.coverage;
      const prefix='/apps/'+app.integration.web.slug+'/';
      if(items.some(item=>item.appId!==app.id||typeof item.reference?.href!=='string'||!item.reference.href.startsWith(prefix)||/[\\\s]|%(?:2e|2f|5c)|(?:^|\/)\.{1,2}(?:\/|$)/i.test(item.reference.href.split(/[?#]/,1)[0])))throw Error('Invalid runtime reference.');
      if (!coverage || coverage.kind !== 'runtime-observation' || !Number.isSafeInteger(coverage.count) || coverage.count < 0 || page.nextCursor !== null && (!Number.isSafeInteger(page.nextCursor) || page.nextCursor < 1)) throw Error('Invalid runtime coverage.');
      return { schemaVersion: 1, state: items.length ? 'ready' : 'empty', source: 'runtime', generatedAt: new Date(clock()).toISOString(),
        coverage: { runtime: { kind: 'runtime-observation', count: coverage.count, firstRecordedAt: timestamp(coverage.firstRecordedAt), lastRecordedAt: timestamp(coverage.lastRecordedAt) } }, items, nextCursor: page.nextCursor };
    } catch (error) { if ([401, 403].includes(error.status)) throw error; return runtimeTraceReport('unavailable', clock()); }
  };
}
