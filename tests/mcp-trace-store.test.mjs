import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { BusinessEvents } from '../src/business/events.mjs';

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'mcp-trace-store-synthetic-'));
  const clock = { now: Date.parse('2026-11-19T12:00:00Z') - 3 * 86400000 };
  let events = new BusinessEvents(join(directory, 'events.db'), { clock: () => clock.now });
  t.after(() => { events.close(); rmSync(directory, { recursive: true, force: true }); });
  return { clock, get events() { return events; }, reopen() { events.close(); events = new BusinessEvents(join(directory, 'events.db'), { clock: () => clock.now }); } };
}
function capture(events, { category = 'business', toolName = 'reminder_list', action = 'read', clientId = 'synthetic-client' } = {}) {
  return events.beginTrace({ requestId: 'synthetic-mcp-request', ...(category === 'business' && { appId: 'reminder' }), operation: category === 'control' ? 'refresh_capabilities' : 'list', action, source: 'mcp', userId: 'synthetic-user', clientId,
    mcp: { endpoint: '/mcp', transport: 'streamable-http', method: 'tools/call', category, ...(toolName ? { toolName } : { toolRef: events.tracePseudonym('SYNTHETIC_UNKNOWN_PRIVATE_NAME') }) } });
}

test('MCP window totals and tool percentiles cover the full window independently of the current page', t => {
  const f = fixture(t), now = Date.parse('2026-11-19T12:00:00Z');
  f.clock.now = now - 2 * 86400000; f.events.endTrace(capture(f.events), { status: 'succeeded', durationMs: 777 });
  f.clock.now = now - 3600000;
  const durations = [];
  for (let i = 0; i < 30; i++) {
    const id = capture(f.events), status = i < 25 ? 'succeeded' : ['failed', 'denied', 'unknown', 'cancelled', 'started'][i - 25];
    if (status !== 'started') { const durationMs = i < 25 ? i : 100 + i - 25; durations.push(durationMs); f.events.endTrace(id, { status, durationMs }); }
  }
  f.events.endTrace(capture(f.events, { category: 'control', toolName: 'praxis_refresh_capabilities' }), { status: 'succeeded', durationMs: 5 }); durations.push(5);
  f.events.endTrace(capture(f.events, { category: 'unknown', toolName: null }), { status: 'failed', code: 'UNKNOWN_TOOL', durationMs: 10 }); durations.push(10);
  f.clock.now = now;
  const first = f.events.tracePage({ source: 'mcp', limit: 1 }), sorted = durations.sort((a, b) => a - b);
  assert.equal(first.items.length, 1); assert.equal(first.summary.total, 32); assert.equal(first.summary.success, 26); assert.equal(first.summary.errors, 2);
  assert.equal(first.summary.denied, 1); assert.equal(first.summary.unknown, 1); assert.equal(first.summary.cancelled, 1); assert.equal(first.summary.inProgress, 1);
  assert.equal(first.summary.p50Ms, sorted[Math.ceil(sorted.length * .5) - 1]); assert.equal(first.summary.p95Ms, sorted[Math.ceil(sorted.length * .95) - 1]);
  assert.equal(first.byTool.find(row => row.toolName === 'reminder_list').total, 30);
  assert.equal(first.byTool.find(row => row.toolName === 'praxis_refresh_capabilities').category, 'control');
  assert.equal(first.byTool.find(row => row.category === 'unknown').toolName, null);
  assert.equal(first.coverage.mcp.count, 33); assert.equal(f.events.tracePage({ source: 'mcp', window: 'week' }).summary.total, 33);
  const second = f.events.tracePage({ source: 'mcp', before: first.nextCursor, limit: 1 }); assert.deepEqual(second.summary, first.summary);
  assert.doesNotMatch(JSON.stringify(first), /SYNTHETIC_UNKNOWN_PRIVATE_NAME|synthetic-user|synthetic-client/);
});

test('capture initialization is stable across reopen and absence of tool calls does not rewrite old inference', t => {
  const f = fixture(t), start = f.events.traceCoverage().mcp.recordingStartedAt;
  const context = { requestId: 'old-inferred', appId: 'reminder', spaceId: 'synthetic-space', operation: 'list', action: 'read', source: 'mcp' };
  f.events.endTrace(f.events.beginTrace({ ...context, clientId: 'old-external-client' }), { status: 'succeeded' });
  const privateId = f.events.beginTrace({ ...context, requestId: 'old-private-read', clientId: 'praxis-browser' }); f.events.endTrace(privateId, { status: 'succeeded' });
  f.clock.now += 86400000; f.reopen();
  assert.equal(f.events.traceCoverage().mcp.recordingStartedAt, start); assert.equal(f.events.tracePage({ source: 'mcp' }).summary.total, 0);
  assert.equal(f.events.traceCoverage().lifecycle.count, 1); assert.equal(f.events.tracePage({ traceId: privateId }).items.length, 0);
  const id = capture(f.events, { clientId: 'praxis-browser' }); f.events.endTrace(id, { status: 'succeeded', durationMs: 0 });
  assert.equal(f.events.tracePage({ source: 'mcp' }).summary.total, 1); assert.equal(f.events.tracePage({ source: 'mcp' }).summary.p50Ms, 0); assert.equal(f.events.traceCoverage().lifecycle.count, 2);
  assert.equal(f.events.db.prepare('SELECT COUNT(*) AS count FROM business_traces').get().count, 3);
});

test('a caller cancellation never closes the shared lifecycle before a real late commit', t => {
  const f = fixture(t), id = capture(f.events, { toolName: 'reminder_add', action: 'create' });
  f.events.linkTrace(id, { bridgeLinked: true, requestId: 'actual-signed-app-request', appId: 'reminder', spaceId: 'synthetic-space' });
  f.events.recordTrace(id, { stage: 'transport', status: 'cancelled', code: 'CLIENT_CANCELLED' });
  f.events.recordTrace(id, { stage: 'commit', status: 'succeeded', committed: true, revision: 'real-revision' });
  f.events.endTrace(id, { status: 'cancelled', code: 'CLIENT_CANCELLED', durationMs: 15 });
  const row = f.events.tracePage({ source: 'mcp' }).items[0], life = f.events.tracePage({ traceId: id }).items[0];
  assert.equal(row.outcome, 'cancelled'); assert.equal(row.lifecycleTraceId, id); assert.equal(row.appId, 'reminder');
  assert.equal(life.committed, true); assert.equal(life.readback, 'not_recorded'); assert.equal(life.requestId, 'actual-signed-app-request');
  assert.equal(f.events.db.prepare('SELECT request_id FROM business_traces WHERE id=?').get(id).request_id, 'actual-signed-app-request');
});

test('ingress diagnostics and secret-bearing metadata stay separate from actual tool-call accounting', t => {
  const f = fixture(t);
  const ingress = f.events.beginTrace({ requestId: 'ingress', operation: 'mcp_ingress', action: 'read', source: 'mcp', mcp: { endpoint: '/mcp', transport: 'streamable-http', method: 'not_available', category: 'ingress' } });
  f.events.endTrace(ingress, { status: 'denied', code: 'UNAUTHENTICATED', durationMs: 2 });
  const page = f.events.tracePage({ source: 'mcp' }); assert.equal(page.summary.total, 0); assert.equal(page.summary.ingressFailures, 1); assert.equal(page.coverage.mcp.ingressFailures, 1); assert.equal(page.summary.p50Ms, null);
  const basic = { requestId: 'invalid', operation: 'call_tool', action: 'read', source: 'mcp', mcp: { endpoint: '/mcp', transport: 'streamable-http', method: 'tools/call', category: 'unknown' } };
  assert.throws(() => f.events.beginTrace({ ...basic, mcp: { ...basic.mcp, toolName: 'PRIVATE_ARBITRARY_NAME' } }));
  assert.throws(() => f.events.beginTrace({ ...basic, mcp: { ...basic.mcp, arguments: { token: 'PRIVATE_ARGUMENT' } } }));
  assert.throws(() => f.events.beginTrace({ ...basic, source: 'http' }));
  assert.doesNotMatch(JSON.stringify(f.events.db.prepare('SELECT context FROM business_traces').all()), /PRIVATE_ARBITRARY_NAME|PRIVATE_ARGUMENT/);
});
