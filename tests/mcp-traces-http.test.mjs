import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { LATEST_PROTOCOL_VERSION } from '@modelcontextprotocol/sdk/types.js';
import { AuthStore, SESSION_COOKIE } from '../src/business/auth.mjs';
import { BusinessEvents } from '../src/business/events.mjs';
import { createBusinessServer } from '../src/business/server.mjs';
import { createPraxisServer } from '../src/server.mjs';
import { BusinessService } from '../third_party/reminder/src/business.js';
import { createServer as createReminderServer } from '../third_party/reminder/src/server.js';
import { Store } from '../third_party/reminder/src/store.js';

const password = 'Synthetic-MCP-trace-password-2026';
const secret = 'PRIVATE_SYNTHETIC_MCP_ARGUMENT_NOT_FOR_TRACE';
const actions = ['read', 'create', 'update', 'complete', 'delete'];
const rule = (allowed = actions, resources = ['*']) => ({ appId: 'reminder', spaceId: 'space-a', resources, actions: allowed });
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
async function until(read, predicate, message) {
  const deadline = Date.now() + 6000; let value;
  do { value = await read(); if (predicate(value)) return value; await delay(15); } while (Date.now() < deadline);
  assert.fail(message + ': ' + JSON.stringify(value));
}

// Same real SDK/auth/signed-native setup used by the existing public-MCP and
// isolated business-stack checks, without Docker or any production configuration.
async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'praxis-mcp-traces-http-'));
  const dataFile = join(directory, 'checklist.json'), keyFile = join(directory, 'adapter.key'), key = randomBytes(48);
  await writeFile(dataFile, JSON.stringify({ version: 2, updated: '', recurring: [], plans: [], pool: [], history: [] }), { mode: 0o600 });
  await writeFile(keyFile, key, { mode: 0o600 });
  const nativeStore = new Store(dataFile), service = new BusinessService({ key, spaces: { 'space-a': dataFile } }), invokeNative = service.handle.bind(service);
  const adapterOperations = [], clients = [], rpcRequests = [], barriers = [];
  let pendingBarrier = null;
  service.handle = async (raw, assertion) => {
    const operation = JSON.parse(raw.toString('utf8')).operation; adapterOperations.push(operation);
    if (pendingBarrier?.operation === operation) {
      const barrier = pendingBarrier; pendingBarrier = null; barrier.entered.resolve(); await barrier.release.promise;
    }
    return invokeNative(raw, assertion);
  };
  const native = createReminderServer({ store: nativeStore, businessService: service });
  await new Promise(resolve => native.listen(0, '127.0.0.1', resolve));
  let backend, web;
  const server = createServer((request, response) => backend.emit('request', request, response));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const auth = new AuthStore({ file: join(directory, 'auth.db'), issuer: origin });
  auth.createUser({ id: 'synthetic-owner', username: 'synthetic-owner', password });
  auth.setPlatformAdmin({ userId: 'synthetic-owner', enabled: true });
  auth.setWebAccess({ userId: 'synthetic-owner', apps: ['reminder'], prds: false });
  auth.createSpace({ id: 'space-a', type: 'personal', ownerId: 'synthetic-owner' });
  auth.createClient({ id: 'synthetic-sdk', name: 'Synthetic SDK fixture', redirectUris: ['https://client.example/callback'] });
  const token = (allowed = actions, resources = ['*']) => auth.issueToken({ grantId: auth.createGrant({ userId: 'synthetic-owner', clientId: 'synthetic-sdk', rules: [rule(allowed, resources)] }).id }).accessToken;
  const bearer = token(), session = auth.login({ username: 'synthetic-owner', password });
  const events = new BusinessEvents(join(directory, 'events.db'));
  const config = { issuer: origin, database: auth.file, eventsDatabase: events.file, observationsFile: join(directory, 'observations.db'), allowedHosts: [new URL(origin).host], allowedOrigins: [origin], webGateway: { enabled: true, originHost: 'localhost' }, apps: { reminder: { managed: true, keyFile, spaces: ['space-a'], url: `http://127.0.0.1:${native.address().port}/api/business` } } };
  backend = createBusinessServer({ config, auth, events, pollMs: 60000 });
  t.after(async () => {
    for (const barrier of barriers) barrier.release.resolve();
    await Promise.allSettled(clients.map(client => client.close()));
    if (web) { web.closeAllConnections(); await new Promise(resolve => web.close(resolve)); }
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    await backend.core.shutdown(); backend.close(() => {});
    native.closeAllConnections(); await new Promise(resolve => native.close(resolve));
    auth.close(); events.close(); await rm(directory, { recursive: true, force: true });
  });
  async function sdk(credential = bearer) {
    const client = new Client({ name: 'synthetic-http-trace-client', version: '1.0.0' }); clients.push(client);
    const transport = new StreamableHTTPClientTransport(new URL('/mcp', origin), { requestInit: { headers: { Authorization: `Bearer ${credential}` } }, fetch: async (url, init) => {
      if (typeof init?.body === 'string') {
        const body = JSON.parse(init.body);
        if (body.method === 'tools/call') rpcRequests.push({ id: body.id, toolName: body.params?.name });
      }
      return fetch(url, init);
    } });
    await client.connect(transport); return client;
  }
  async function report(parameters = {}, { signal } = {}) {
    const response = await fetch(origin + '/api/business/console/traces?' + new URLSearchParams({ source: 'mcp', ...parameters }), { signal, headers: { Cookie: `${SESSION_COOKIE}=${session.sessionToken}` } });
    assert.equal(response.status, 200, 'native-admin Trace endpoint'); return response.json();
  }
  async function openWeb() {
    web = createPraxisServer({ observationsFile: null, businessUrl: null, consoleUpstream: origin, consoleHost: new URL(origin).host, webGateway: { enabled: true, canonicalUrl: origin, coreUrl: origin } });
    await new Promise(resolve => web.listen(0, '127.0.0.1', resolve));
  }
  // node:http preserves the trusted proxy's canonical Host; Node fetch replaces
  // a caller-supplied Host with the separate network-listener port.
  const webGet = (path, { signal } = {}) => new Promise((resolve, reject) => {
    const outgoing = httpRequest(`http://127.0.0.1:${web.address().port}${path}`, { signal, headers: { Host: new URL(origin).host, Origin: origin, Cookie: `${SESSION_COOKIE}=${session.sessionToken}` } }, async incoming => {
      try { const chunks = []; for await (const chunk of incoming) chunks.push(chunk); resolve(new Response(Buffer.concat(chunks), { status: incoming.statusCode, headers: incoming.headers })); }
      catch (error) { reject(error); }
    });
    outgoing.on('error', reject); outgoing.end();
  });
  async function webReport(parameters = {}, options = {}) {
    const response = await webGet('/api/platform/traces?' + new URLSearchParams({ source: 'mcp', ...parameters }), options);
    assert.equal(response.status, 200, 'public gateway native-admin Trace endpoint'); return response.json();
  }
  async function httpInvoke(request, nativeBrowser = false) {
    const headers = { 'Content-Type': 'application/json', ...(nativeBrowser ? { Cookie: `${SESSION_COOKIE}=${session.sessionToken}`, Origin: origin, 'X-CSRF-Token': session.csrfToken } : { Authorization: `Bearer ${bearer}` }) };
    const response = await fetch(origin + '/api/business/invoke', { method: 'POST', headers, body: JSON.stringify({ appId: 'reminder', spaceId: 'space-a', ...request }) });
    assert.equal(response.status, 200); return response.json();
  }
  const raw = (body, credential = bearer, extra = {}, options = {}) => fetch(origin + '/mcp', { ...options, method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'MCP-Protocol-Version': LATEST_PROTOCOL_VERSION, ...(credential ? { Authorization: `Bearer ${credential}` } : {}), ...extra }, body: typeof body === 'string' ? body : JSON.stringify(body) });
  function hold(operation = 'add') { const value = { operation, entered: deferred(), release: deferred() }; barriers.push(value); pendingBarrier = value; return value; }
  return { auth, events, bearer, session, origin, nativeStore, token, sdk, report, openWeb, webGet, webReport, httpInvoke, raw, hold, rpcRequests, adapterOperations };
}
async function failedTool(promise) {
  try { const value = await promise; assert.equal(value.isError, true); return value; }
  catch (error) { assert.ok(typeof error.code === 'number' || error.name === 'McpError'); return error; }
}
function safe(report, f) {
  const serialized = JSON.stringify(report);
  for (const value of [secret, f.bearer, f.session.sessionToken, password, 'Basic c3ludGhldGljOnNlY3JldA==', 'PRIVATE_UNKNOWN_TOOL_NAME', 'PRIVATE_CANCEL_REASON', 'PRIVATE_UNPARSEABLE_JSON', 'invalid-synthetic-token']) assert.ok(!serialized.includes(value), 'Trace excludes caller bodies and credentials');
}

test('real SDK calls are counted once by registered tool, excluding HTTP, native and protocol requests', async t => {
  const f = await fixture(t), client = await f.sdk(); await client.listTools(); await client.ping();
  await f.httpInvoke({ operation: 'list', input: {} }); await f.httpInvoke({ operation: 'list', input: {} }, true);
  assert.equal((await f.report()).summary.total, 0);
  const added = await client.callTool({ name: 'reminder_add', arguments: { spaceId: 'space-a', item: { text: secret, tags: ['synthetic'] }, idempotencyKey: 'mcp-real-create' } });
  assert.notEqual(added.isError, true); const created = added.structuredContent;
  const first = await until(() => f.report(), value => value.summary.total === 1 && value.items[0]?.status === 'succeeded', 'successful MCP create is recorded');
  const write = first.items[0]; assert.equal(write.toolName, 'reminder_add'); assert.equal(write.category, 'business'); assert.equal(write.endpoint, '/mcp'); assert.equal(write.transport, 'streamable-http');
  assert.ok(Number.isSafeInteger(write.durationMs) && write.durationMs >= 0); assert.equal(first.summary.p50Ms, write.durationMs); assert.equal(first.summary.p95Ms, write.durationMs);
  assert.equal(first.byTool.find(row => row.toolName === 'reminder_add').total, 1); assert.ok(f.adapterOperations.length >= 2, 'one tool call may have several native HTTP operations');
  assert.match(write.actor.userRef, /^[a-f0-9]{24}$/); assert.ok(write.lifecycleTraceId);
  assert.equal(created.traceId, write.lifecycleTraceId, 'the actual adapter invocation reuses the captured MCP lifecycle');
  const lifecycle = (await f.report({ source: 'lifecycle', traceId: write.lifecycleTraceId })).items[0];
  assert.equal(lifecycle.id, write.lifecycleTraceId); assert.equal(lifecycle.committed, true); assert.equal(lifecycle.readback, 'not_recorded'); assert.ok(lifecycle.steps.some(step => step.stage === 'commit' && step.status === 'succeeded'));
  const read = await client.callTool({ name: 'reminder_list', arguments: { spaceId: 'space-a' } }); assert.equal(read.structuredContent.items[0].resourceId, created.resourceId); assert.equal(read.structuredContent.items[0].revision, created.revision);
  const final = await until(() => f.report(), value => value.summary.total === 2 && value.items.every(row => row.status !== 'started'), 'read MCP call completes');
  const reading = final.items.find(row => row.toolName === 'reminder_list'); assert.equal(final.summary.success, 2); assert.equal(final.summary.errors, 0);
  const readLifecycle = (await f.report({ source: 'lifecycle', traceId: reading.lifecycleTraceId })).items[0]; assert.equal(readLifecycle.readback, 'succeeded'); assert.equal(readLifecycle.committed, false);
  const page = await f.report({ limit: '1' }); assert.equal(page.items.length, 1); assert.equal(page.summary.total, 2); assert.equal(page.summary.success, 2); assert.ok(page.nextCursor);
  const older = await f.report({ limit: '1', before: String(page.nextCursor) }); assert.equal(older.items.length, 1); assert.equal(older.summary.total, 2); assert.notEqual(older.items[0].id, page.items[0].id);
  assert.equal((await f.report({ window: 'week' })).summary.total, 2); safe(final, f); safe(lifecycle, f);
});

test('SDK validation, unknown tools and grant denials have distinct safe outcomes without app writes', async t => {
  const f = await fixture(t), client = await f.sdk();
  const first = await f.httpInvoke({ operation: 'add', input: { item: { text: 'Synthetic allowed record' } }, idempotencyKey: 'http-seed-one' });
  const second = await f.httpInvoke({ operation: 'add', input: { item: { text: secret } }, idempotencyKey: 'http-seed-two' });
  const before = await f.nativeStore.read();
  await failedTool(client.callTool({ name: 'reminder_add', arguments: { spaceId: 'space-a', item: { text: secret, tags: 'invalid-array' }, idempotencyKey: 'invalid-shape' } }));
  await failedTool(client.callTool({ name: 'PRIVATE_UNKNOWN_TOOL_NAME', arguments: { body: secret } }));
  const readonly = await f.sdk(f.token(['read'])); assert.ok(!(await readonly.listTools()).tools.some(tool => tool.name === 'reminder_add'));
  await failedTool(readonly.callTool({ name: 'reminder_add', arguments: { spaceId: 'space-a', item: { text: secret }, idempotencyKey: 'ungranted-create' } }));
  const limited = await f.sdk(f.token(['read', 'update'], [first.resourceId])); assert.ok((await limited.listTools()).tools.some(tool => tool.name === 'reminder_update'));
  await failedTool(limited.callTool({ name: 'reminder_update', arguments: { spaceId: 'space-a', resourceId: second.resourceId, expectedRevision: second.revision, idempotencyKey: 'ungranted-target', patch: { text: secret } } }));
  const value = await until(() => f.report(), report => report.summary.total === 4 && report.items.every(row => row.status !== 'started'), 'all failed attempts are terminal');
  const unknown = value.items.find(row => row.category === 'unknown'); assert.equal(unknown.toolName, null); assert.equal(unknown.lifecycleTraceId, null); assert.equal(unknown.code, 'UNKNOWN_TOOL');
  const schema = value.items.find(row => row.toolName === 'reminder_add' && row.status === 'failed'); assert.equal(schema.lifecycleTraceId, null);
  const notAvailable = value.items.find(row => row.toolName === 'reminder_add' && row.status === 'denied'); assert.equal(notAvailable.lifecycleTraceId, null);
  const resourceDenied = value.items.find(row => row.toolName === 'reminder_update'); assert.equal(resourceDenied.status, 'denied'); assert.ok(resourceDenied.lifecycleTraceId);
  assert.equal(value.summary.denied, 2); assert.equal(value.summary.errors, 2); assert.equal(value.summary.success, 0); assert.deepEqual(await f.nativeStore.read(), before); safe(value, f);
});

test('actual control-tool calls remain separate from initialize, tool discovery and ping', async t => {
  const f = await fixture(t), client = await f.sdk(); await client.listTools(); await client.ping(); const before = await f.report(); assert.equal(before.summary.total, 0);
  const result = await client.callTool({ name: 'praxis_refresh_capabilities', arguments: {} }); assert.notEqual(result.isError, true);
  const value = await until(() => f.report(), report => report.summary.total === 1 && report.items[0]?.status === 'succeeded', 'control tool call is recorded');
  assert.equal(value.items[0].toolName, 'praxis_refresh_capabilities'); assert.equal(value.items[0].category, 'control'); assert.equal(value.items[0].lifecycleTraceId, null); assert.equal(value.summary.ingressFailures, before.summary.ingressFailures); safe(value, f);
});

test('native-browser MCP rejection, bad credentials and invalid JSON are ingress failures rather than invented tool calls', async t => {
  const f = await fixture(t), body = { jsonrpc: '2.0', id: 10, method: 'tools/call', params: { name: 'reminder_add', arguments: { item: { text: secret } } } };
  const native = await f.raw(body, null, { Cookie: `${SESSION_COOKIE}=${f.session.sessionToken}` }); assert.ok([401, 403].includes(native.status)); const nativeError = await native.json();
  const basic = await f.raw(body, null, { Authorization: 'Basic c3ludGhldGljOnNlY3JldA==', Cookie: `${SESSION_COOKIE}=${f.session.sessionToken}` }); assert.equal(basic.status, 401); assert.equal((await basic.json()).code, 'BEARER_REQUIRED');
  const bad = await f.raw(body, 'invalid-synthetic-token'); assert.equal(bad.status, 401); const badError = await bad.json();
  assert.ok(['BEARER_REQUIRED', 'DELEGATION_REQUIRED', 'UNAUTHENTICATED'].includes(nativeError.code)); assert.equal(typeof badError.code, 'string');
  const malformed = await f.raw('PRIVATE_UNPARSEABLE_JSON'); assert.equal(malformed.status, 400); await malformed.body?.cancel();
  const value = await until(() => f.report(), report => report.summary.ingressFailures === 4, 'four actual ingress rejections are counted');
  assert.equal(value.summary.total, 0); assert.deepEqual(value.items, []);
  const history = await f.report({ source: 'lifecycle' }); const ingress = history.items.filter(row => row.category === 'ingress' || row.mcp?.category === 'ingress'); assert.equal(ingress.length, 4); safe(history, f); safe(value, f);
});

test('SDK cancellation after dispatch preserves the late real commit and an independent readback without duplicate calls', async t => {
  const f = await fixture(t), client = await f.sdk(), barrier = f.hold(), controller = new AbortController();
  await f.openWeb();
  const pending = client.callTool({ name: 'reminder_add', arguments: { spaceId: 'space-a', item: { text: secret }, idempotencyKey: 'cancel-after-dispatch' } }, undefined, { signal: controller.signal });
  await barrier.entered.promise; assert.equal((await f.nativeStore.read()).data.pool.length, 0);
  // Exercise the real public gateway, including its Core web-access bootstrap,
  // while a native app write deliberately holds the business serialization gate.
  let inFlight;
  try {
    [inFlight] = await Promise.all([
      f.webReport({}, { signal: AbortSignal.timeout(1500) }),
      ...['/admin/', '/api/business/account/session'].map(async path => {
        const response = await f.webGet(path, { signal: AbortSignal.timeout(1500) }); assert.equal(response.status, 200, `public gateway ${path} stays responsive during a write`);
        if (path === '/admin/') assert.match(await response.text(), /<html/i);
        else assert.equal(typeof await response.json(), 'object');
      }),
    ]);
  }
  catch (error) { controller.abort(); barrier.release.resolve(); await pending.catch(() => {}); throw error; }
  assert.equal(inFlight.summary.total, 1); assert.equal(inFlight.summary.inProgress, 1); assert.equal(inFlight.items[0].durationMs, null);
  controller.abort(); await assert.rejects(pending);
  try {
    const cancelled = await until(() => f.webReport({ source: 'lifecycle', traceId: inFlight.items[0].lifecycleTraceId }, { signal: AbortSignal.timeout(1500) }), report => report.items[0]?.steps.some(step => step.stage === 'transport' && step.status === 'cancelled'), 'actual SDK cancellation notification reaches the running call');
    assert.equal(cancelled.items[0].status, 'started', 'client cancellation cannot finalize an app operation still running'); assert.equal(cancelled.items[0].committed, false);
  } finally { barrier.release.resolve(); }
  const value = await until(() => f.report(), report => report.summary.total === 1 && report.items[0]?.status === 'cancelled' && report.items[0]?.lifecycleTraceId, 'cancelled call finishes without losing its lifecycle');
  assert.equal(value.items.length, 1); assert.equal(value.summary.cancelled, 1); const call = value.items[0];
  const lifecycle = await until(() => f.report({ source: 'lifecycle', traceId: call.lifecycleTraceId }), report => report.items[0]?.committed === true, 'native late commit is retained');
  assert.equal(lifecycle.items[0].readback, 'not_recorded'); assert.ok(lifecycle.items[0].steps.some(step => step.stage === 'commit' && step.status === 'succeeded'));
  const stored = await f.nativeStore.read(); assert.equal(stored.data.pool.length, 1); assert.equal(stored.data.pool[0].text, secret);
  const readback = await client.callTool({ name: 'reminder_list', arguments: { spaceId: 'space-a' } }); assert.equal(readback.structuredContent.items[0].item.text, secret);
  const final = await until(() => f.report(), report => report.summary.total === 2 && report.summary.success === 1, 'the independent SDK read is recorded separately');
  assert.equal(final.items.filter(row => row.toolName === 'reminder_add').length, 1); assert.equal(final.items.find(row => row.toolName === 'reminder_add').status, 'cancelled');
  const reading = final.items.find(row => row.toolName === 'reminder_list'); assert.equal((await f.report({ source: 'lifecycle', traceId: reading.lifecycleTraceId })).items[0].readback, 'succeeded'); safe(final, f);
});

test('a cancellation notification from another grant cannot mark an owner call cancelled', async t => {
  const f = await fixture(t), client = await f.sdk(), otherGrant = f.token(['read']), barrier = f.hold();
  const pending = client.callTool({ name: 'reminder_add', arguments: { spaceId: 'space-a', item: { text: 'Synthetic grant-isolation record' }, idempotencyKey: 'grant-isolation' } });
  await barrier.entered.promise; const requestId = f.rpcRequests.at(-1).id;
  try {
    const response = await f.raw({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId, reason: 'PRIVATE_CANCEL_REASON' } }, otherGrant, {}, { signal: AbortSignal.timeout(5000) }); const body = await response.text(); assert.ok([200, 202].includes(response.status), `cancellation notification status ${response.status}: ${body}`);
    assert.ok(!f.events.tracePage({ source: 'lifecycle', traceId: f.events.tracePage({ source: 'mcp' }).items[0].lifecycleTraceId }).items[0].steps.some(step => step.stage === 'transport' && step.status === 'cancelled'));
  } finally { barrier.release.resolve(); }
  assert.notEqual((await pending).isError, true);
  const value = await until(() => f.report(), report => report.summary.total === 1 && report.items[0]?.status !== 'started', 'the original caller receives its actual outcome');
  assert.equal(value.items[0].status, 'succeeded'); assert.equal(value.summary.cancelled, 0); safe(value, f);
});
