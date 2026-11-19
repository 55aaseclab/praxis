import { AppProviderRegistry } from './app-providers.mjs';

const endpoint = '/api/praxis/traces';
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
function itemFromRun(run) {
  if (!safeId(run?.runId) || !Number.isSafeInteger(run.cursor) || run.cursor < 1 || !Array.isArray(run.steps) || run.steps.length > 8 || !Array.isArray(run.artifactRefs)) throw Error('Invalid runtime metadata.');
  const href = run.nativeHref;
  if (typeof href !== 'string' || !href.startsWith('/apps/polaris/') || /[\\\s]|%(?:2e|2f|5c)|(?:^|\/)\.{1,2}(?:\/|$)/i.test(href.split(/[?#]/, 1)[0])) throw Error('Invalid native runtime reference.');
  const reference = { appId: 'polaris', resourceId: run.runId, href };
  const workflow = safeId(run.flowId) ? { id: run.flowId, runId: run.runId, ...(version(run.flowVersion) ? { version: run.flowVersion } : {}) } : null;
  const steps = run.steps.map(step => {
    if (!safeId(step?.stepId)) throw Error('Invalid runtime step.');
    return { stage: 'runtime', stepId: step.stepId, status: step.status === 'completed' ? 'succeeded' : status(step.status), at: timestamp(step.completedAt) || timestamp(step.createdAt), reference,
      ...(version(step.version) ? { revision: step.version, revisionRecorded: true } : {}) };
  });
  const artifactRefs = run.artifactRefs.filter(value => typeof value === 'string' && /^artifact:[a-f0-9]{64}$/.test(value)).slice(0, 8);
  const count = (value, minimum) => Number.isSafeInteger(value) && value >= minimum ? value : minimum;
  return { id: `runtime:${run.runId}`, cursor: run.cursor, kind: 'runtime', appId: 'polaris', operation: workflow?.id || 'workflow_run', at: timestamp(run.startedAt) || timestamp(run.createdAt) || timestamp(run.updatedAt), updatedAt: timestamp(run.updatedAt), status: status(run.status),
    committed: null, readback: 'not_recorded', reference, workflowRecorded: Boolean(workflow), ...(workflow ? { workflow } : {}), steps,
    runtime: { runId: run.runId, ...(safeId(run.packId) ? { packId: run.packId } : {}), ...(version(run.packVersion) ? { packVersion: run.packVersion } : {}),
      createdAt: timestamp(run.createdAt), startedAt: timestamp(run.startedAt), updatedAt: timestamp(run.updatedAt), stepCount: count(run.stepCount, steps.length), artifactCount: count(run.artifactCount, artifactRefs.length), artifactRefs } };
}

export function createRuntimeTraceReader({ auth, config, registry = new AppProviderRegistry({ root: config.providerRoot }), fetchImpl = fetch, clock = Date.now }) {
  return async ({ token, before, limit = 25 } = {}) => {
    // Polaris's existing native gateway entry is platform-administrator-only.
    // Use that same predicate rather than the separate eleven-app entry list.
    const authorize = () => auth.requirePlatformAdminSession(token);
    authorize();
    if (before !== undefined && (!Number.isSafeInteger(before) || before < 1) || !Number.isSafeInteger(limit) || limit < 1 || limit > 50) throw failure(400, 'INVALID_TRACE_QUERY');
    const configured = config.appProviders?.polaris?.url;
    if (!configured) return runtimeTraceReport('not_configured', clock());
    try {
      const origin = new URL(configured);
      if (!['http:', 'https:'].includes(origin.protocol) || origin.username || origin.password || origin.search || origin.hash || origin.pathname !== '/' || origin.protocol === 'http:' && !['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname)) throw Error('Invalid runtime origin.');
      const provider = (await registry.providers()).find(value => value.app.id === 'polaris');
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
      const items = page.runs.map(itemFromRun), coverage = page.coverage;
      if (!coverage || coverage.kind !== 'runtime-observation' || !Number.isSafeInteger(coverage.count) || coverage.count < 0 || page.nextCursor !== null && (!Number.isSafeInteger(page.nextCursor) || page.nextCursor < 1)) throw Error('Invalid runtime coverage.');
      return { schemaVersion: 1, state: items.length ? 'ready' : 'empty', source: 'runtime', generatedAt: new Date(clock()).toISOString(),
        coverage: { runtime: { kind: 'runtime-observation', count: coverage.count, firstRecordedAt: timestamp(coverage.firstRecordedAt), lastRecordedAt: timestamp(coverage.lastRecordedAt) } }, items, nextCursor: page.nextCursor };
    } catch (error) { if ([401, 403].includes(error.status)) throw error; return runtimeTraceReport('unavailable', clock()); }
  };
}
