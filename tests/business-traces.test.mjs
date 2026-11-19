import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse } from 'parse5';
import { BusinessEvents } from '../src/business/events.mjs';
import { AuthStore, SESSION_COOKIE } from '../src/business/auth.mjs';
import { createConsoleHandler } from '../src/business/console.mjs';
import { createPlatformProxy } from '../src/platform-proxy.mjs';

const context = (overrides = {}) => ({ requestId: 'request-a', appId: 'reminder', spaceId: 'team-a', resourceId: 'record-a', operation: 'update', action: 'update', source: 'mcp', userId: 'synthetic-user', clientId: 'synthetic-client', ...overrides });
function store(t) {
  const root = mkdtempSync(join(tmpdir(), 'praxis-traces-synthetic-')), file = join(root, 'events.db');
  let events = new BusinessEvents(file);
  t.after(() => { events.close(); rmSync(root, { recursive: true, force: true }); });
  return { root, file, get events() { return events; }, reopen() { events.close(); events = new BusinessEvents(file); return events; } };
}
function committed(events, overrides = {}) {
  const id = events.beginTrace(context(overrides));
  events.recordTrace(id, { stage: 'authorization', status: 'allowed' });
  events.recordTrace(id, { stage: 'dispatch', status: 'started' });
  events.recordTrace(id, { stage: 'commit', status: 'succeeded', committed: true, revision: 'revision-2', generation: 7 });
  events.recordTrace(id, { stage: 'readback', status: 'succeeded', revision: 'revision-2' });
  events.endTrace(id, { status: 'succeeded', committed: true });
  return id;
}

test('trace lifecycle, supplied versions and generation survive reopen without storing actor identities', t => {
  const f = store(t), id = committed(f.events, { sources: [{ appId: 'knowledge', spaceId: 'team-a', resourceId: 'source-a', revision: 'source-3' }], workflow: { id: 'flow-a', version: 'v2', runId: 'run-a' }, humanDecision: { id: 'decision-a', decision: 'approved', at: Date.now() } });
  f.reopen();
  const page = f.events.tracePage();
  assert.equal(page.state, 'ready'); assert.equal(page.items[0].id, id); assert.equal(page.items[0].status, 'succeeded');
  assert.equal(page.items[0].committed, true); assert.equal(page.items[0].readback, 'succeeded');
  assert.deepEqual(page.items[0].steps.map(step => step.stage), ['authorization', 'authorization', 'dispatch', 'commit', 'readback', 'result']);
  assert.equal(page.items[0].steps.find(step => step.stage === 'commit').generation, 7);
  assert.equal(page.items[0].steps.find(step => step.stage === 'commit').revision, 'revision-2');
  assert.equal(page.items[0].sources[0].revision, 'source-3'); assert.equal(page.items[0].workflow.runId, 'run-a');
  assert.equal(page.items[0].humanDecision.decision, 'approved');
  assert.match(page.items[0].actor.userRef, /^[a-f0-9]{24}$/);
  assert.doesNotMatch(JSON.stringify(page), /synthetic-user|synthetic-client/);
});

test('denials, unconfirmed writes and failures after commit remain different recorded outcomes', t => {
  const f = store(t), denied = f.events.beginTrace(context({ requestId: 'denied' }));
  f.events.recordTrace(denied, { stage: 'authorization', status: 'denied', code: 'FORBIDDEN' });
  f.events.endTrace(denied, { status: 'denied', code: 'FORBIDDEN' });
  const unknown = f.events.beginTrace(context({ requestId: 'unknown' }));
  f.events.endTrace(unknown, { status: 'succeeded' });
  const failed = f.events.beginTrace(context({ requestId: 'failed' }));
  assert.throws(() => f.events.recordTrace(failed, { stage: 'result', status: 'succeeded', committed: true }));
  f.events.recordTrace(failed, { stage: 'commit', status: 'succeeded', committed: true });
  f.events.endTrace(failed, { status: 'failed', committed: true, code: 'AUTHORIZATION_CHANGED_AFTER_COMMIT' });
  const items = new Map(f.events.tracePage().items.map(item => [item.requestId, item]));
  assert.equal(items.get('denied').status, 'denied'); assert.equal(items.get('denied').committed, false);
  assert.equal(items.get('unknown').status, 'unknown'); assert.equal(items.get('unknown').committed, false);
  assert.equal(items.get('unknown').steps.at(-1).code, 'COMMIT_UNCONFIRMED');
  assert.equal(items.get('failed').status, 'failed'); assert.equal(items.get('failed').committed, true);
  for (const item of items.values()) assert.equal(item.readback, 'not_recorded');
});

test('trace schema excludes bodies, credentials, free-form decisions and private browsing or deferral history', t => {
  const f = store(t), secret = 'SYNTHETIC_SECRET_NOT_FOR_TRACES';
  for (const key of ['body', 'input', 'password', 'token', 'browsingHistory', 'deferredUntil']) assert.throws(() => f.events.beginTrace(context({ [key]: secret })));
  assert.throws(() => f.events.beginTrace(context({ humanDecision: { id: 'view-a', decision: 'deferred' } })));
  assert.throws(() => f.events.beginTrace(context({ sources: [{ appId: 'reminder', spaceId: 'team-a', resourceId: 'record-a', token: secret }] })));
  const id = f.events.beginTrace(context({ action: 'read', operation: 'list' }));
  assert.throws(() => f.events.recordTrace(id, { stage: 'dispatch', status: 'started', body: secret }));
  assert.throws(() => f.events.recordTrace(id, { stage: 'commit', status: 'succeeded', committed: true }));
  f.events.endTrace(id, { status: 'succeeded' });
  assert.equal(f.events.tracePage().items[0].committed, false);
  assert.doesNotMatch(JSON.stringify(f.events.db.prepare('SELECT context FROM business_traces').all()) + JSON.stringify(f.events.db.prepare('SELECT metadata FROM business_trace_steps').all()), /SYNTHETIC_SECRET_NOT_FOR_TRACES|browsingHistory|deferredUntil|password/);
});

test('bounded trace pages and earlier-step cursors expose real history without inventing missing lifecycle steps', t => {
  const f = store(t);
  for (let i = 0; i < 55; i++) {
    const id = f.events.beginTrace(context({ requestId: `read-${i}`, operation: 'list', action: 'read' }));
    f.events.endTrace(id, { status: 'succeeded' });
  }
  const page = f.events.tracePage({ limit: 50 });
  assert.equal(page.items.length, 50); assert.ok(page.nextCursor);
  const older = f.events.tracePage({ before: page.nextCursor, limit: 50 });
  assert.equal(older.items.length, 5); assert.equal(older.nextCursor, null);
  assert.equal(new Set([...page.items, ...older.items].map(item => item.id)).size, 55);
  assert.throws(() => f.events.tracePage({ limit: 51 })); assert.throws(() => f.events.tracePage({ before: -1 }));
  const id = f.events.beginTrace(context({ action: 'read', operation: 'read_document' }));
  for (let i = 0; i < 10; i++) f.events.recordTrace(id, { stage: 'dispatch', status: 'started' });
  f.events.endTrace(id, { status: 'succeeded' });
  const recent = f.events.tracePage().items[0];
  assert.equal(recent.steps.length, 8); assert.equal(recent.stepCount, 12); assert.ok(recent.olderStepsCursor);
  const steps = f.events.tracePage({ traceId: id, before: recent.olderStepsCursor, limit: 3 }).items[0].steps;
  assert.equal(steps.length, 3); assert.ok(steps.every(step => step.cursor < recent.olderStepsCursor));
  f.events.audit({ requestId: 'older-audit', appId: 'reminder', spaceId: 'team-a', action: 'update', decision: 'allow' });
  f.events.ingest('reminder', 'team-a', { cursor: 1, events: [{ id: 'event-a', cursor: 1, resourceId: 'record-a', revision: '2', operation: 'update' }] });
  const audit = f.events.tracePage({ source: 'audit' }), outbox = f.events.tracePage({ source: 'outbox' });
  assert.equal(audit.items[0].status, 'allowed'); assert.equal(audit.items[0].committed, null); assert.equal(audit.items[0].readback, 'not_recorded');
  assert.equal(outbox.items[0].committed, true); assert.equal(outbox.items[0].steps, undefined);
  assert.equal(outbox.coverage.audit.kind, 'decision-only'); assert.equal(outbox.coverage.outbox.kind, 'application-outbox');
});

test('historical native browsing reads stay outside the admin trace timeline and coverage', t => {
  const f = store(t);
  f.events.audit({ requestId: 'private-browser-read', appId: 'reminder', action: 'read', clientId: 'praxis-browser', decision: 'allow' });
  f.events.audit({ requestId: 'delegated-business-read', appId: 'reminder', action: 'read', clientId: 'authorized-agent', decision: 'allow' });
  f.events.audit({ requestId: 'native-business-write', appId: 'reminder', action: 'update', clientId: 'praxis-browser', decision: 'allow' });
  const report = f.events.tracePage({ source: 'audit' });
  assert.equal(report.coverage.audit.count, 2);
  assert.deepEqual(report.items.map(item => item.requestId), ['native-business-write', 'delegated-business-read']);
  assert.doesNotMatch(JSON.stringify(report), /private-browser-read/);
});

async function consoleFixture(t) {
  const f = store(t), issuer = 'http://127.0.0.1:4326';
  const auth = new AuthStore({ file: join(f.root, 'auth.db'), issuer });
  for (const id of ['administrator', 'member', 'owner']) auth.createUser({ id, username: id, password: 'Synthetic-password-2026' });
  auth.setPlatformAdmin({ userId: 'administrator', enabled: true });
  auth.createSpace({ id: 'team-a', type: 'company', ownerId: 'owner' });
  const admin = auth.login({ username: 'administrator', password: 'Synthetic-password-2026' }), member = auth.login({ username: 'member', password: 'Synthetic-password-2026' });
  const config = { issuer, apps: { reminder: { spaces: ['team-a'] } } };
  const handler = createConsoleHandler({ auth, config, events: f.events, observations: { report: () => ({}) }, fetchImpl: async () => new Response('', { status: 200 }) });
  const server = createServer(async (request, response) => { if (!await handler(request, response)) { response.writeHead(404); response.end(); } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); auth.close(); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  return { ...f, auth, config, admin, member, origin, request: (suffix = '', token = admin.sessionToken, headers = {}) => fetch(`${origin}/api/business/console/traces${suffix}`, { headers: { ...(token && { Cookie: `${SESSION_COOKIE}=${token}` }), ...headers } }) };
}

test('Trace API is native-admin gated, rejects invalid cursors, and returns an honest empty page', async t => {
  const f = await consoleFixture(t);
  assert.equal((await f.request('', null)).status, 401);
  assert.equal((await f.request('', f.member.sessionToken)).status, 403);
  assert.equal((await f.request('', f.admin.sessionToken, { Authorization: 'Bearer synthetic-not-a-browser' })).status, 401);
  assert.equal((await f.request('', f.admin.sessionToken, { Origin: 'https://untrusted.example' })).status, 403);
  for (const query of ['?limit=51', '?limit=0', '?before=-1', '?before=9007199254740992', '?source=private-browser-history', '?limit=1&limit=2', '?traceId=one&source=audit', '?window=all', '?source=runtime&window=day', '?window=day&window=week']) assert.equal((await f.request(query)).status, 400, query);
  const response = await f.request(); assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
  const page = await response.json(); assert.equal(page.source, 'mcp'); assert.equal(page.state, 'empty'); assert.deepEqual(page.items, []); assert.equal(page.coverage.mcp.count, 0);
});

test('Trace source refs and revisions require current business-read permission even for platform admins', async t => {
  const f = await consoleFixture(t);
  committed(f.events, { workflow: { id: 'workflow-private', version: '2' }, humanDecision: { id: 'decision-private', decision: 'approved' } });
  let page = await (await f.request('?source=lifecycle')).json();
  assert.equal(page.items[0].reference, null); assert.equal(page.items[0].workflow, null); assert.equal(page.items[0].humanDecision, null);
  assert.doesNotMatch(JSON.stringify(page), /"team-a"|"record-a"|revision-2|workflow-private|decision-private/);
  assert.equal(page.items[0].committed, true);
  const grant = f.auth.grantResource({ userId: 'administrator', appId: 'reminder', spaceId: 'team-a', resources: ['record-a'], actions: ['read'] });
  page = await (await f.request('?source=lifecycle')).json();
  assert.equal(page.items[0].reference.resourceId, 'record-a'); assert.equal(page.items[0].reference.href, '/apps/reminder/');
  assert.equal(page.items[0].steps.find(step => step.stage === 'commit').reference.revision, 'revision-2');
  assert.equal(page.items[0].workflow.id, 'workflow-private');
  f.auth.revokeResource(grant.id);
  page = await (await f.request('?source=lifecycle')).json();
  assert.equal(page.items[0].reference, null); assert.doesNotMatch(JSON.stringify(page), /revision-2|workflow-private/);
});

test('default MCP overview totals use the full window and exclude legacy inferred transport and HTTP calls', async t => {
  const f = await consoleFixture(t);
  committed(f.events, { requestId: 'legacy-inferred-mcp' });
  committed(f.events, { requestId: 'explicit-http', source: 'http' });
  for (const [index, status, durationMs] of [[1, 'succeeded', 20], [2, 'denied', 5], [3, 'failed', 40]]) {
    const id = f.events.beginTrace(context({ requestId: `real-call-${index}`, operation: 'list', action: 'read', mcp: { endpoint: '/mcp', transport: 'streamable-http', method: 'tools/call', category: 'business', toolName: 'reminder_list' } }));
    f.events.endTrace(id, { status, durationMs });
  }
  const page = await (await f.request('?limit=1&window=day')).json();
  assert.equal(page.source, 'mcp'); assert.equal(page.items.length, 1);
  assert.deepEqual([page.summary.total, page.summary.success, page.summary.denied, page.summary.errors], [3, 1, 1, 1]);
  assert.equal(page.summary.p50Ms, 20); assert.equal(page.summary.p95Ms, 40);
  assert.equal(page.byTool.length, 1); assert.equal(page.byTool[0].total, 3);
  assert.equal(page.items[0].endpoint, '/mcp'); assert.equal(page.items[0].toolName, 'reminder_list');
  assert.match(page.items[0].actor.clientRef, /^[a-f0-9]{24}$/);
  assert.ok(Number.isFinite(Date.parse(page.coverage.mcp.recordingStartedAt)));
  assert.doesNotMatch(JSON.stringify(page), /legacy-inferred-mcp|explicit-http|synthetic-client|"team-a"|"record-a"/);
  const older = await (await f.request(`?source=mcp&limit=1&before=${page.nextCursor}`)).json();
  assert.equal(older.summary.total, 3); assert.notEqual(older.items[0].id, page.items[0].id);
});

test('Trace proxy forwards only validated bounded queries and native session cookies', async t => {
  const f = await consoleFixture(t);
  const proxy = createPlatformProxy({ upstream: f.origin, host: new URL(f.origin).host, origin: f.config.issuer });
  const server = createServer((request, response) => proxy(request, response, new URL(request.url, f.config.issuer)));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const base = `http://127.0.0.1:${server.address().port}/api/platform/traces`;
  const headers = { Cookie: `${SESSION_COOKIE}=${f.admin.sessionToken}` };
  assert.equal((await fetch(base)).status, 401);
  assert.equal((await fetch(base + '?source=audit&limit=5', { headers })).status, 200);
  const mcp = await fetch(base + '?source=mcp&window=week&limit=5', { headers }); assert.equal(mcp.status, 200); assert.equal((await mcp.json()).source, 'mcp');
  for (const query of ['?body=private', '?limit=51', '?before=0', '?source=unknown', '?limit=1&limit=2', '?window=all', '?source=runtime&window=day']) assert.equal((await fetch(base + query, { headers })).status, 400, query);
  assert.equal((await fetch(base, { headers: { ...headers, Authorization: 'Bearer synthetic' } })).status, 403);
});

test('Overview has independent Trace and always-expanded usage sections with no folding DOM', () => {
  const document = parse(readFileSync(new URL('../public/admin.html', import.meta.url), 'utf8'));
  const descendants = node => [node, ...(node.childNodes || []).flatMap(descendants)];
  const nodes = descendants(document), attr = (node, key) => node.attrs?.find(attribute => attribute.name === key)?.value;
  const overview = nodes.find(node => attr(node, 'id') === 'overview-view');
  assert.ok(overview);
  assert.equal(descendants(overview).filter(node => ['details', 'summary'].includes(node.tagName)).length, 0);
  for (const id of ['platform-experience', 'platform-trace']) assert.equal(nodes.find(node => attr(node, 'id') === id)?.tagName, 'section');
  assert.ok(nodes.find(node => attr(node, 'id') === 'platform-trace-source'));
});
