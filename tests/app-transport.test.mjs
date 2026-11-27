import test from 'node:test';
import assert from 'node:assert/strict';
import { populateContexts } from '../public/app-transport.js';

test('the common transport uses generic scope labels and accepts app-owned labels without changing authored names', t => {
  const previous = globalThis.document, options = [], picker = { hidden: false }, select = { replaceChildren() { options.length = 0; }, append(value) { options.push(value); } };
  globalThis.document = { querySelector: id => id === '#space' ? select : picker, createElement: () => ({}) }; t.after(() => { globalThis.document = previous; });
  populateContexts([{ id: 'personal', type: 'personal' }, { id: 'unknown', type: 'other' }]);
  assert.deepEqual(options.map(value => value.textContent), ['Personal tasks', 'Task scope']);
  for (const labels of [{ types: { personal: 'Personal projects' }, fallback: 'Project lists' }, { types: { personal: '个人项目' }, fallback: '项目列表' }]) {
    populateContexts([{ id: 'personal', type: 'personal' }, { id: 'named', type: 'family', name: 'Source-authored title' }, { id: 'other', type: 'other' }], labels);
    assert.deepEqual(options.map(value => value.textContent), [labels.types.personal, 'Source-authored title', labels.fallback]); assert.equal(picker.hidden, false);
  }
  populateContexts([], { types: {} }); assert.equal(picker.hidden, true); assert.deepEqual(options, []);
});


// These fixtures use isolated authorization state and a stub adapter. They never
// contact an installed app or inspect business records.
async function enrollmentFixture(t) {
  const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { AuthStore, SESSION_COOKIE } = await import('../src/business/auth.mjs');
  const { BusinessBridge } = await import('../src/business/bridge.mjs');
  const { DEFAULT_APP_REGISTRY: registry } = await import('../src/default-app-registry.mjs');
  const directory = mkdtempSync(join(tmpdir(), 'praxis-enrollment-transport-'));
  const keyFile = join(directory, 'synthetic.key'), key = Buffer.alloc(32, 67);
  writeFileSync(keyFile, key, { mode: 0o600 });
  const auth = new AuthStore({ file: join(directory, 'auth.db'), issuer: 'http://127.0.0.1:4326' });
  t.after(() => { auth.close(); rmSync(directory, { recursive: true, force: true }); });
  const apps = Object.fromEntries(['projects', 'slides'].map(appId => [appId, { spaces: ['legacy-space'], url: 'http://127.0.0.1:1/api/business', keyFile }]));
  auth.configureWebAccessBoundary({ enabled: true, apps });
  auth.createUser({ id: 'synthetic-owner', username: 'synthetic-owner', password: 'Synthetic-password-2026' });
  const login = auth.login({ username: 'synthetic-owner', password: 'Synthetic-password-2026' });
  let dispatches = 0;
  const bridge = new BusinessBridge({ auth, apps, fetchImpl: async (url, request) => {
    dispatches++;
    const input = JSON.parse(request.body);
    return new Response(JSON.stringify({ spaceId: input.spaceId, items: [] }), { headers: { 'Content-Type': 'application/json' } });
  } });
  return { auth, bridge, registry, apps, key, keyFile, login, get dispatches() { return dispatches; }, request: { headers: { cookie: `${SESSION_COOKIE}=${login.sessionToken}` } } };
}

test('runtime enrollment controls adapter execution, catalog, native HTTP and signed jobs consistently', async t => {
  const f = await enrollmentFixture(t);
  const { appHttpContext } = await import('../src/business/app-http.mjs');
  const { createAppJobAuthorizationHandler } = await import('../src/business/app-job-authorization.mjs');
  const { signAssertion } = await import('../src/business/bridge.mjs');
  const { createHash } = await import('node:crypto');
  const { Readable } = await import('node:stream');
  const space = f.auth.createSelfServiceSpace({ type: 'family', ownerId: 'synthetic-owner' });
  const input = { appId: 'projects', spaceId: space.id, operation: 'list_projects' };
  const query = { spaceId: space.id, resourceId: 'synthetic-record', action: 'read' };
  const http = appHttpContext(f.request, { ...f, config: { apps: f.apps }, appId: 'projects' });
  const jobs = createAppJobAuthorizationHandler({ ...f, config: { apps: f.apps } });
  async function jobAuthorized() {
    const job = { ...query, userId: 'synthetic-owner', clientId: 'praxis-browser', grantId: 'first-party-synthetic', actions: ['read'], expiresAt: Date.now() + 10000, firstPartyNative: true };
    delete job.action;
    const raw = Buffer.from(JSON.stringify(job)), path = '/api/business/slides/authorize-job';
    const request = Readable.from([raw]);
    Object.assign(request, { url: path, method: 'POST', headers: { 'x-praxis-business-assertion': signAssertion({ v: 1, appId: 'slides', method: 'POST', path, expiresAt: Date.now() + 20000, bodyHash: createHash('sha256').update(raw).digest('hex') }, f.key) } });
    let result;
    assert.equal(await jobs(request, { writeHead(status) { assert.equal(status, 200); }, end(body) { result = JSON.parse(body); } }), true);
    return result.authorized;
  }
  assert.deepEqual(f.bridge.catalog(f.login.sessionToken), []);
  await assert.rejects(f.bridge.invoke(f.login.sessionToken, input), { status: 403 });
  assert.throws(() => http.authorize(query), { status: 403 });
  assert.equal(await jobAuthorized(), false);
  assert.equal(f.dispatches, 0);

  for (const appId of ['projects', 'slides']) {
    f.auth.setSpaceAppEnrollment({ spaceId: space.id, appId, enabled: true }, f.apps);
    // Enrollment grants no resource authority, even to its owner.
    assert.deepEqual(f.auth.userPermissions('synthetic-owner', space.id, appId, 'read'), []);
    f.auth.grantResource({ userId: 'synthetic-owner', spaceId: space.id, appId, actions: ['read'], resources: ['synthetic-record'] });
  }
  assert.deepEqual(f.bridge.catalog(f.login.sessionToken).map(value => value.apps.map(app => app.id)), [['projects', 'slides']]);
  assert.deepEqual((await f.bridge.invoke(f.login.sessionToken, input)).items, []);
  assert.deepEqual(http.authorize(query).resources, ['synthetic-record']);
  assert.equal(await jobAuthorized(), true);
  assert.equal(f.dispatches, 1);

  // The installed deployment catalog is an independent ceiling. A persisted
  // enrollment cannot reach an adapter removed from that catalog.
  const removed = f.apps.projects;
  delete f.apps.projects;
  assert.equal(f.auth.appSpaceEnabled('projects', space.id, f.apps), false);
  assert.equal(f.bridge.catalog(f.login.sessionToken).some(value => value.apps.some(app => app.id === 'projects')), false);
  await assert.rejects(f.bridge.invoke(f.login.sessionToken, input), { status: 403 });
  assert.throws(() => http.authorize(query), { status: 403 });
  f.apps.projects = removed;

  const priorDispatches = f.dispatches;
  for (const appId of ['projects', 'slides']) f.auth.setSpaceAppEnrollment({ spaceId: space.id, appId, enabled: false }, f.apps);
  assert.deepEqual(f.bridge.catalog(f.login.sessionToken), []);
  await assert.rejects(f.bridge.invoke(f.login.sessionToken, input), { status: 403 });
  assert.throws(() => http.authorize(query), { status: 403 });
  assert.equal(await jobAuthorized(), false);
  assert.equal(f.dispatches, priorDispatches);
});

test('legacy configured space coverage survives and an explicit enrollment denial takes precedence', async t => {
  const f = await enrollmentFixture(t);
  f.auth.createSpace({ id: 'legacy-space', type: 'family', ownerId: 'synthetic-owner' });
  f.auth.setWebAccess({ userId: 'synthetic-owner', apps: ['projects'], prds: false });
  assert.deepEqual(f.bridge.catalog(f.login.sessionToken).map(value => value.apps.map(app => app.id)), [['projects']]);
  const input = { appId: 'projects', spaceId: 'legacy-space', operation: 'list_projects' };
  await f.bridge.invoke(f.login.sessionToken, input);
  f.auth.setSpaceAppEnrollment({ spaceId: 'legacy-space', appId: 'projects', enabled: false }, f.apps);
  assert.equal(f.auth.appSpaceEnabled('projects', 'legacy-space', f.apps), false);
  assert.deepEqual(f.bridge.catalog(f.login.sessionToken), []);
  await assert.rejects(f.bridge.invoke(f.login.sessionToken, input), { status: 403 });
  assert.equal(f.dispatches, 1);
});
