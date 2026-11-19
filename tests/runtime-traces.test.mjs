import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRuntimeTraceReader } from '../src/business/runtime-traces.mjs';
import { createConsoleHandler } from '../src/business/console.mjs';
import { SESSION_COOKIE } from '../src/business/auth.mjs';
import { describe, getTraces, projectRuntimeTraces } from '../third_party/polaris/praxis-provider.mjs';

const now = Date.parse('2026-11-19T12:00:00Z');
const run = id => ({ id, flowId: 'fieldwork-research', packId: 'research', packVersion: '1.2.3', status: 'failed', createdAt: '2026-11-18T10:00:00Z', updatedAt: '2026-11-19T10:00:00Z', command: 'PRIVATE_COMMAND', error: { message: 'PRIVATE_ERROR' },
  steps: [{ stepId: 'collect', status: 'failed', version: 'v2', createdAt: '2026-11-18T10:00:00Z', completedAt: '2026-11-18T10:01:00Z', input: { token: 'PRIVATE_TOKEN' }, output: { body: 'PRIVATE_BODY' } }], artifacts: [{ id: 'private-artifact-name', content: 'PRIVATE_ARTIFACT' }] });
function fixture({ configured = true, runs = [run('run-one')] } = {}) {
  let allowed = true, calls = 0;
  const auth = { requirePlatformAdminSession: token => {
    if (token !== 'synthetic-native') throw Object.assign(Error('Native session required'), { status: 401 });
    if (!allowed) throw Object.assign(Error('Forbidden'), { status: 403 });
    return { user: { id: 'synthetic-owner' } };
  } };
  const config = { issuer: 'https://praxis.example', apps: {}, ...(configured ? { appProviders: { polaris: { url: 'http://127.0.0.1:19999' } } } : {}) };
  const registry = { providers: async () => [{ app: { id: 'polaris' }, descriptor: describe(), module: { getTraces } }] };
  const fetchImpl = async (url, options) => {
    calls++; assert.equal(url.origin, 'http://127.0.0.1:19999'); assert.equal(url.pathname, '/api/praxis/traces'); assert.equal(options.method, 'GET'); assert.equal(options.redirect, 'error'); assert.deepEqual(options.headers, { Accept: 'application/json' });
    const body = projectRuntimeTraces({ runs }, { limit: Number(url.searchParams.get('limit')), ...(url.searchParams.has('before') ? { before: Number(url.searchParams.get('before')) } : {}), now });
    body.rawLog = 'PRIVATE_LOG'; if (body.runs[0]) body.runs[0].credentials = 'PRIVATE_CREDENTIAL';
    return new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
  };
  return { auth, config, registry, fetchImpl, calls: () => calls, withdraw: () => { allowed = false; }, reader: options => createRuntimeTraceReader({ auth, config, registry, fetchImpl, clock: () => now, ...options }) };
}
test('runtime reader never probes a default host when its source is unconfigured', async () => {
  const f = fixture({ configured: false }), report = await f.reader()({ token: 'synthetic-native' });
  assert.equal(f.calls(), 0); assert.equal(report.state, 'not_configured'); assert.equal(report.coverage.runtime.count, null); assert.deepEqual(report.items, []);
});
test('runtime observation metadata keeps failed run/step context without manufacturing lifecycle commits', async () => {
  const f = fixture(), report = await f.reader()({ token: 'synthetic-native', limit: 5 });
  assert.equal(f.calls(), 1); assert.equal(report.source, 'runtime'); assert.equal(report.coverage.runtime.kind, 'runtime-observation'); assert.equal(report.coverage.runtime.count, 1);
  const item = report.items[0]; assert.equal(item.status, 'failed'); assert.equal(item.workflow.id, 'fieldwork-research'); assert.equal(item.workflow.runId, 'run-one'); assert.equal(item.workflow.version, undefined); assert.equal(item.runtime.packVersion, '1.2.3');
  assert.equal(item.committed, null); assert.equal(item.readback, 'not_recorded'); assert.equal(item.steps[0].stage, 'runtime'); assert.equal(item.steps[0].stepId, 'collect'); assert.equal(item.steps[0].revision, 'v2');
  assert.equal(item.reference.href, '/apps/polaris/work/runs/run-one'); assert.ok(!JSON.stringify(report).includes('PRIVATE_')); assert.ok(!JSON.stringify(report).includes('private-artifact-name'));
});
test('configured empty and unavailable runtime sources remain different from missing configuration', async () => {
  const empty = fixture({ runs: [] }); assert.equal((await empty.reader()({ token: 'synthetic-native' })).state, 'empty');
  const failed = fixture(), report = await failed.reader({ fetchImpl: async () => { throw Error('PRIVATE_NETWORK_ERROR'); } })({ token: 'synthetic-native' });
  assert.equal(report.state, 'unavailable'); assert.equal(report.coverage.runtime.count, null); assert.ok(!JSON.stringify(report).includes('PRIVATE_NETWORK_ERROR'));
});
test('runtime pagination retains all ninety observed history IDs', async () => {
  const f = fixture({ runs: Array.from({ length: 90 }, (_, index) => run(`run-${index}`)) }), read = f.reader(), ids = new Set(); let before;
  do { const page = await read({ token: 'synthetic-native', limit: 25, ...(before ? { before } : {}) }); for (const item of page.items) ids.add(item.runtime.runId); before = page.nextCursor; } while (before);
  assert.equal(ids.size, 90); assert.equal(f.calls(), 4);
});
test('native runtime entry authorization is checked before and after an asynchronous read', async () => {
  const f = fixture(); await assert.rejects(f.reader()({ token: 'external-bearer' }), { status: 401 }); assert.equal(f.calls(), 0);
  const read = f.reader({ fetchImpl: async (...args) => { const response = await f.fetchImpl(...args); f.withdraw(); return response; } });
  await assert.rejects(read({ token: 'synthetic-native' }), { status: 403 });
});
test('explicit runtime origins reject credentials, redirects, non-loopback HTTP and invalid queries', async () => {
  for (const url of ['http://user:password@127.0.0.1:19999', 'http://outside.example', 'file:///private/snapshot', 'http://127.0.0.1:19999/other']) {
    const f = fixture(); f.config.appProviders.polaris.url = url; assert.equal((await f.reader()({ token: 'synthetic-native' })).state, 'unavailable'); assert.equal(f.calls(), 0);
  }
  const f = fixture(); for (const query of [{ before: 0 }, { before: 1.5 }, { limit: 51 }, { limit: 0 }]) await assert.rejects(f.reader()({ token: 'synthetic-native', ...query }), { status: 400 });
  assert.equal(f.calls(), 0);
});
test('runtime provider callback cannot request a raw workflow or mutate the observer', async () => {
  const f = fixture(); f.registry.providers = async () => [{ app: { id: 'polaris' }, descriptor: describe(), module: { getTraces: context => context.readNative({ path: '/api/workflow-runs', query: context.query }) } }];
  await assert.rejects(f.reader()({ token: 'synthetic-native' }), { status: 403 }); assert.equal(f.calls(), 0);
});
test('console runtime source uses the same administrator gate and keeps existing trace coverage', async t => {
  const f = fixture(), events = { traceCoverage: () => ({ lifecycle: { count: 2, kind: 'structured-lifecycle' } }), tracePage: () => { throw Error('Runtime must not read or create lifecycle events'); } };
  const handler = createConsoleHandler({ auth: f.auth, config: f.config, events, getRuntimeTraces: f.reader(), clock: () => now });
  const server = createServer((request, response) => { void handler(request, response); }); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  const base = `http://127.0.0.1:${server.address().port}/api/business/console/traces?source=runtime`;
  assert.equal((await fetch(base)).status, 401);
  const headers = { Cookie: `${SESSION_COOKIE}=synthetic-native` };
  const response = await fetch(base, { headers }), value = await response.json(); assert.equal(response.status, 200); assert.equal(value.coverage.lifecycle.count, 2); assert.equal(value.coverage.runtime.count, 1); assert.equal(value.items[0].kind, 'runtime');
  assert.equal((await fetch(base, { headers: { ...headers, Authorization: 'Bearer synthetic' } })).status, 401);
  assert.equal((await fetch(base + '&traceId=run-one', { headers })).status, 400);
  assert.equal((await fetch(base + '&source=outbox', { headers })).status, 400);
});
