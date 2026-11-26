import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AuthStore, createAuthHandler, hashVerifier, SESSION_COOKIE } from '../src/business/auth.mjs';
import { createAdminHandler, createAccountHandler } from '../src/business/admin.mjs';

const password = 'Synthetic-user-delete-password-2026';
const rule = (spaceId, resources = ['*']) => ({ appId: 'slides', spaceId, actions: ['read'], resources });

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'praxis-delete-user-'));
  const file = join(directory, 'auth.sqlite'), issuer = 'http://127.0.0.1:4326';
  let store = new AuthStore({ file, issuer });
  for (const id of ['admin', 'target', 'member', 'other']) store.createUser({ id, username: `synthetic-${id}`, password });
  store.setPlatformAdmin({ userId: 'admin', enabled: true });
  store.createSpace({ id: 'synthetic-shared', type: 'family', ownerId: 'admin' });
  store.setMembership({ spaceId: 'synthetic-shared', userId: 'target', role: 'member' });
  store.setMembership({ spaceId: 'synthetic-shared', userId: 'member', role: 'member' });
  for (const userId of ['target', 'member']) store.grantResource({ userId, ...rule('synthetic-shared') });
  store.createClient({ id: 'synthetic-agent', name: 'Synthetic client', redirectUris: ['https://synthetic.example/callback'] });
  t.after(() => { store.close(); rmSync(directory, { recursive: true, force: true }); });
  return {
    directory, file, issuer, get store() { return store; },
    remove(overrides = {}) { return store.deleteUser({ userId: 'target', actorId: 'admin', confirmUsername: 'synthetic-target', ...overrides }); },
    reopen() { store.close(); store = new AuthStore({ file, issuer }); return store; },
  };
}

async function httpFixture(t) {
  const f = fixture(t);
  const authHandler = createAuthHandler({ store: f.store, webGateway: { enabled: true } });
  const accountHandler = createAccountHandler({ auth: f.store }), adminHandler = createAdminHandler({ auth: f.store });
  const server = createServer(async (request, response) => {
    if (await authHandler(request, response) || await accountHandler(request, response) || await adminHandler(request, response)) return;
    response.writeHead(404).end();
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const actors = Object.fromEntries(['admin', 'target', 'member'].map(id => [id, f.store.login({ username: `synthetic-${id}`, password })]));
  const request = (actor, path, { method = 'GET', body, headers = {} } = {}) => fetch(origin + path, {
    method, headers: { Cookie: `${SESSION_COOKIE}=${actor.sessionToken}`, Origin: f.issuer, 'X-CSRF-Token': actor.csrfToken, 'Content-Type': 'application/json', ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { ...f, actors, request };
}

test('user lifecycle API enforces native administration, exact confirmation, self refusal and owned-space policy', async t => {
  const f = await httpFixture(t), { admin, target, member } = f.actors;
  const path = '/api/business/admin/users/target';
  const remove = (actor = admin, body = { confirmUsername: 'synthetic-target' }, headers = {}) => f.request(actor, path, { method: 'DELETE', body, headers });
  const detail = await f.request(admin, path);
  assert.equal(detail.status, 200);
  assert.deepEqual(await detail.json(), { user: { id: 'target', username: 'synthetic-target', enabled: true, platformAdmin: false } });
  for (const actor of [target, member]) {
    assert.equal((await f.request(actor, path)).status, 403);
    assert.equal((await remove(actor)).status, 403);
  }
  const self = await f.request(admin, '/api/business/admin/users/admin', { method: 'DELETE', body: { confirmUsername: 'synthetic-admin' } });
  assert.equal(self.status, 403); assert.equal((await self.json()).code, 'SELF_DELETION_FORBIDDEN');
  assert.throws(() => f.remove({ actorId: 'target' }), { status: 403, code: 'SELF_DELETION_FORBIDDEN' });
  assert.throws(() => f.remove({ actorId: 'member' }), { status: 403, code: 'FORBIDDEN' });
  for (const body of [{}, [], { confirmUsername: true }, { confirmUsername: 'SYNTHETIC-TARGET' }, { confirmUsername: 'synthetic-target ' }, { confirmUsername: 'synthetic-target', actorId: 'admin' }]) assert.equal((await remove(admin, body)).status, 400);
  assert.equal((await remove(admin, undefined, { 'X-CSRF-Token': 'forged' })).status, 403);
  assert.equal((await remove(admin, undefined, { Origin: 'https://attacker.example' })).status, 403);
  assert.equal((await remove(admin, undefined, { 'Sec-Fetch-Site': 'cross-site' })).status, 403);
  assert.equal((await remove(admin, undefined, { Authorization: `Bearer pxa_${'a'.repeat(43)}` })).status, 401);
  assert.equal((await remove(admin, undefined, { Cookie: '' })).status, 401);
  assert.equal((await remove(admin, undefined, { 'Content-Type': 'text/plain' })).status, 415);
  for (const suffix of ['?actor=admin', '?confirmUsername=synthetic-target', '%2fpassword', '%252fpassword', '%5cpassword']) assert.equal((await f.request(admin, path + suffix)).status, 400);
  f.store.createSpace({ id: 'synthetic-owned-family', type: 'family', ownerId: 'target' });
  f.store.createSpace({ id: 'synthetic-owned-extra-personal', type: 'personal', ownerId: 'target' });
  const blocked = await remove();
  assert.equal(blocked.status, 409);
  assert.deepEqual(await blocked.json(), { code: 'OWNED_SPACES_REQUIRED', ownedSpaces: [{ id: 'synthetic-owned-extra-personal', type: 'personal' }, { id: 'synthetic-owned-family', type: 'family' }] });
  assert.equal((await f.request(target, '/auth/session')).status, 200, 'rejection preserves target sessions');
  for (const spaceId of ['synthetic-owned-family', 'synthetic-owned-extra-personal']) f.store.deleteSpace({ spaceId, actorId: 'admin', confirmSpaceId: spaceId });
  f.store.ensurePersonalSpace('target');
  f.store.setPlatformAdmin({ userId: 'target', enabled: true });
  f.store.setUserEnabled('target', false);
  assert.equal((await remove()).status, 200, 'another administrator, including a disabled one, is deletable');
  assert.equal((await f.request(admin, path)).status, 404);
  assert.equal((await remove()).status, 404);
  assert.equal((await f.request(target, '/auth/session')).status, 401);
  const users = await (await f.request(admin, '/api/business/admin/users?limit=100')).json();
  assert.ok(users.users.every(user => user.id !== 'target'), 'shared picker source excludes deleted accounts');
  const members = await (await f.request(admin, '/api/business/account/spaces/synthetic-shared')).json();
  assert.ok(members.members.every(user => user.userId !== 'target'));
  assert.ok(members.permissions.every(permission => permission.userId !== 'target'));
  assert.equal((await f.request(admin, '/api/business/account/spaces/synthetic-shared?contextUserId=target')).status, 404);
});

test('user deletion atomically removes account authorization and automatic space, retaining files and unrelated identities', t => {
  const f = fixture(t), store = f.store;
  const personal = store.ensurePersonalSpace('target');
  store.configureWebAccessBoundary({ apps: { slides: { spaces: ['synthetic-shared'] } } });
  store.setSpaceAppEnrollment({ spaceId: personal.id, appId: 'slides', enabled: true });
  store.setSpaceAppEnrollment({ spaceId: personal.id, appId: 'intelligence', enabled: true });
  store.grantResource({ userId: 'target', ...rule(personal.id) });
  store.setWebAccess({ userId: 'target', apps: ['lattice-slides'], prds: true });
  store.setPlatformAdmin({ userId: 'target', enabled: true });
  const session = store.login({ username: 'synthetic-target', password });
  const consent = store.createConsent(session.sessionToken, [rule(personal.id)], 'synthetic-user-deletion');
  const grant = store.createGrant({ userId: 'target', clientId: 'synthetic-agent', rules: [rule(personal.id), rule('synthetic-shared')] });
  const tokens = store.tokenPair(grant.id);
  const revoked = store.createGrant({ userId: 'target', clientId: 'synthetic-agent', rules: [rule(personal.id)] });
  store.revokeGrant(revoked.id);
  const expired = store.createGrant({ userId: 'target', clientId: 'synthetic-agent', rules: [rule('synthetic-shared')] });
  store.db.prepare('UPDATE auth_grants SET expires_at=? WHERE id=?').run(Date.now() - 1, expired.id);
  const verifier = 'synthetic-user-deletion-verifier-'.repeat(2);
  const request = { clientId: 'synthetic-agent', redirectUri: 'https://synthetic.example/callback', challenge: hashVerifier(verifier), resource: store.resource, requested: { slides: ['read'] } };
  const code = store.createAuthorizationCode({ request, userId: 'target', rules: [rule(personal.id)], spaceId: personal.id });
  const delegatedSession = store.login({ username: 'synthetic-target', password, clientId: 'synthetic-agent' });
  const unrelatedGrant = store.createGrant({ userId: 'member', clientId: 'synthetic-agent', rules: [rule('synthetic-shared')] });
  const unrelatedTokens = store.tokenPair(unrelatedGrant.id);
  const untouched = {
    users: store.db.prepare("SELECT * FROM auth_users WHERE id<>'target' ORDER BY id").all(),
    spaces: store.db.prepare('SELECT * FROM auth_spaces WHERE id<>? ORDER BY id').all(personal.id),
    members: store.db.prepare("SELECT * FROM auth_members WHERE user_id<>'target' ORDER BY space_id,user_id").all(),
    permissions: store.db.prepare("SELECT * FROM auth_resources WHERE user_id<>'target' ORDER BY id").all(),
    grants: store.db.prepare("SELECT * FROM auth_grants WHERE user_id<>'target' ORDER BY id").all(),
  };
  const adapterFile = join(f.directory, 'synthetic-adapter-data.json');
  writeFileSync(adapterFile, '{"synthetic":"retained for operator cleanup"}');
  const observed = [];
  store.onChange(event => {
    assert.equal(store.db.prepare("SELECT COUNT(*) AS n FROM auth_users WHERE id='target'").get().n, 0);
    assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM auth_spaces WHERE id=?').get(personal.id).n, 0);
    assert.deepEqual(store.db.prepare('PRAGMA foreign_key_check').all(), []);
    observed.push(event.type);
  });
  assert.deepEqual(f.remove(), { deleted: true, userId: 'target' });
  assert.ok(observed.includes('user_deleted'));
  for (const table of ['auth_users', 'auth_platform_admins', 'auth_web_access', 'auth_members', 'auth_resources', 'auth_grants', 'auth_sessions']) {
    const field = table === 'auth_users' ? 'id' : 'user_id';
    assert.equal(store.db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${field}=?`).get('target').n, 0, table);
  }
  for (const table of ['auth_spaces', 'auth_auto_personal_spaces', 'auth_self_service_spaces', 'auth_space_apps', 'auth_grant_spaces']) {
    const field = table === 'auth_spaces' ? 'id' : 'space_id';
    assert.equal(store.db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${field}=?`).get(personal.id).n, 0, table);
  }
  for (const table of ['auth_tokens', 'auth_codes', 'auth_grant_spaces']) for (const grantId of [grant.id, revoked.id, expired.id, code.grantId]) assert.equal(store.db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE grant_id=?`).get(grantId).n, 0);
  assert.ok(store.db.prepare('SELECT rules FROM auth_grants').all().every(row => JSON.parse(row.rules).every(item => item.spaceId !== personal.id)));
  for (const value of [session.sessionToken, delegatedSession.sessionToken]) assert.throws(() => store.getSession(value), { status: 401 });
  assert.throws(() => store.authenticate(tokens.access_token), { status: 401 });
  assert.throws(() => store.refresh({ refreshToken: tokens.refresh_token, clientId: 'synthetic-agent', resource: store.resource }));
  assert.throws(() => store.exchangeCode({ code: code.code, clientId: request.clientId, redirectUri: request.redirectUri, verifier, resource: store.resource }));
  assert.throws(() => store.verifyCsrf(session.sessionToken, session.csrfToken), { status: 401 }, 'pending signed consent cannot pass its deleted session boundary');
  assert.throws(() => store.createGrant({ userId: 'target', clientId: 'synthetic-agent', rules: store.consentRules(session.sessionToken, { consent, rule_0: '1' }, 'synthetic-user-deletion') }), { status: 403 });
  assert.throws(() => store.login({ username: 'synthetic-target', password }), { status: 401 });
  assert.equal(store.authorize(unrelatedTokens.access_token, { appId: 'slides', spaceId: 'synthetic-shared', action: 'read' }).userId, 'member');
  assert.deepEqual(store.db.prepare("SELECT * FROM auth_users WHERE id<>'target' ORDER BY id").all(), untouched.users);
  assert.deepEqual(store.db.prepare('SELECT * FROM auth_spaces ORDER BY id').all(), untouched.spaces);
  assert.deepEqual(store.db.prepare('SELECT * FROM auth_members ORDER BY space_id,user_id').all(), untouched.members);
  assert.deepEqual(store.db.prepare('SELECT * FROM auth_resources ORDER BY id').all(), untouched.permissions);
  assert.deepEqual(store.db.prepare('SELECT * FROM auth_grants ORDER BY id').all(), untouched.grants);
  assert.equal(readFileSync(adapterFile, 'utf8'), '{"synthetic":"retained for operator cleanup"}');
  const reopened = f.reopen();
  assert.deepEqual(reopened.db.prepare('PRAGMA foreign_key_check').all(), []);
  assert.equal(reopened.db.prepare("SELECT COUNT(*) AS n FROM auth_users WHERE id='target'").get().n, 0);
  assert.throws(() => reopened.authenticate(tokens.access_token), { status: 401 });
  assert.equal(reopened.authorize(unrelatedTokens.access_token, { appId: 'slides', spaceId: 'synthetic-shared', action: 'read' }).userId, 'member');
  reopened.createUser({ id: 'replacement-target', username: 'synthetic-target', password });
  assert.deepEqual(reopened.listGrants('replacement-target'), [], 'reusing a username revives no deleted authorization');
});

test('failed account cascade rolls back automatic-space protection, credentials, policy, audit and notifications', t => {
  const f = fixture(t), store = f.store;
  const personal = store.ensurePersonalSpace('target');
  const session = store.login({ username: 'synthetic-target', password });
  const grant = store.createGrant({ userId: 'target', clientId: 'synthetic-agent', rules: [rule('synthetic-shared')] });
  const token = store.issueToken({ grantId: grant.id }).accessToken;
  const tables = store.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'auth_%' ORDER BY name").all().map(row => row.name);
  const snapshot = () => Object.fromEntries(tables.map(table => [table, store.db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]));
  const before = snapshot(); let changes = 0;
  store.onChange(() => changes++);
  store.db.exec("CREATE TEMP TRIGGER synthetic_user_failure BEFORE DELETE ON auth_users BEGIN SELECT RAISE(ABORT,'synthetic account rollback'); END");
  assert.throws(() => f.remove(), /synthetic account rollback/);
  assert.deepEqual(snapshot(), before);
  assert.equal(changes, 0);
  assert.equal(store.spaceDeletionProtected(personal.id), true);
  assert.equal(store.getSession(session.sessionToken).user.id, 'target');
  assert.equal(store.authenticate(token).userId, 'target');
  store.db.exec('DROP TRIGGER synthetic_user_failure');
  f.remove();
  assert.ok(changes > 0);
});

test('account deletion rechecks the native administrator after receiving an asynchronous body', async t => {
  const f = fixture(t), store = f.store;
  store.setPlatformAdmin({ userId: 'other', enabled: true });
  const session = store.login({ username: 'synthetic-admin', password });
  const handler = createAuthHandler({ store });
  const request = Readable.from((async function* () {
    store.setPlatformAdmin({ userId: 'admin', enabled: false });
    yield Buffer.from(JSON.stringify({ confirmUsername: 'synthetic-target' }));
  })());
  request.url = '/api/business/admin/users/target'; request.method = 'DELETE';
  request.headers = { cookie: `${SESSION_COOKIE}=${session.sessionToken}`, origin: f.issuer, 'content-type': 'application/json', 'x-csrf-token': session.csrfToken };
  const response = { writeHead(status) { this.status = status; }, end(body) { this.body = JSON.parse(body); } };
  assert.equal(await handler(request, response), true);
  assert.equal(response.status, 401);
  assert.ok(store.db.prepare("SELECT 1 FROM auth_users WHERE id='target'").get());
});

test('account deletion serializes against an active business authorization lease', async t => {
  const f = fixture(t), other = new AuthStore({ file: f.file, issuer: f.issuer, busyTimeoutMs: 1 });
  t.after(() => other.close());
  await f.store.withPolicyLease(async () => {
    assert.throws(() => other.deleteUser({ userId: 'target', actorId: 'admin', confirmUsername: 'synthetic-target' }), { status: 503, code: 'POLICY_BUSY' });
    assert.ok(f.store.db.prepare("SELECT 1 FROM auth_users WHERE id='target'").get());
  });
  assert.equal(other.deleteUser({ userId: 'target', actorId: 'admin', confirmUsername: 'synthetic-target' }).deleted, true);
});
