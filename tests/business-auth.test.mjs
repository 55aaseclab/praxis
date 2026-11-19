import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AuthStore, createAuthHandler, credentialFromRequest, hashVerifier, SESSION_COOKIE } from '../src/business/auth.mjs';

const password = 'Synthetic-test-password-2026';
const issuer = 'http://127.0.0.1:4326';
const allReminderActions = ['read', 'create', 'update', 'complete', 'delete'];
const rule = (spaceId = 'family-a', actions = allReminderActions, resources = ['*'], appId = 'reminder') => ({ appId, spaceId, actions, resources });

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'praxis-auth-synthetic-'));
  const clock = { now: Date.parse('2026-11-12T12:00:00Z') };
  const file = join(directory, 'auth.sqlite');
  let store = new AuthStore({ file, issuer, clock: () => clock.now });
  t.after(() => { store.close(); rmSync(directory, { recursive: true, force: true }); });
  store.createUser({ id: 'alice', username: 'alice', password });
  store.createUser({ id: 'bob', username: 'bob', password });
  store.createUser({ id: 'guest', username: 'guest', password });
  store.createSpace({ id: 'personal-a', type: 'personal', ownerId: 'alice' });
  store.createSpace({ id: 'personal-b', type: 'personal', ownerId: 'bob' });
  store.createSpace({ id: 'family-a', type: 'family', ownerId: 'alice' });
  store.createSpace({ id: 'company-a', type: 'company', ownerId: 'alice' });
  store.setMembership({ spaceId: 'family-a', userId: 'bob', role: 'member' });
  store.grantResource({ userId: 'bob', ...rule('family-a') });
  store.grantResource({ userId: 'guest', ...rule('company-a', ['read', 'submit'], ['assignment-a'], 'tingproof') });
  store.createClient({ id: 'agent-a', name: 'Synthetic external client', redirectUris: ['https://client.example/callback'] });
  return {
    get store() { return store; }, clock, file,
    grant(userId = 'alice', rules = [rule()], options = {}) { return store.createGrant({ userId, clientId: 'agent-a', rules, ...options }); },
    token(userId = 'alice', rules = [rule()], options = {}) { return store.issueToken({ grantId: this.grant(userId, rules).id, ...options }).accessToken; },
    reopen() { store.close(); store = new AuthStore({ file, issuer, clock: () => clock.now }); return store; },
  };
}

async function httpFixture(t) {
  const f = fixture(t);
  const handler = createAuthHandler({ store: f.store });
  const server = createServer(async (request, response) => {
    if (!(await handler(request, response))) { response.writeHead(404); response.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = (path, options = {}) => fetch(`${base}${path}`, { redirect: 'manual', ...options });
  const json = (path, data, options = {}) => request(path, { method: 'POST', ...options, headers: { 'Content-Type': 'application/json', Origin: issuer, ...(options.headers ?? {}) }, body: JSON.stringify(data) });
  async function login(username = 'alice') {
    const response = await json('/auth/login', { username, password });
    assert.equal(response.status, 200);
    return { cookie: response.headers.get('set-cookie').split(';')[0], body: await response.json(), response };
  }
  return { ...f, request, json, login, base };
}

test('business tokens are bound to current user, client, space, resource and action', t => {
  const f = fixture(t), token = f.token('bob', [rule('family-a', ['read', 'update'], ['record-a'])]);
  const actor = f.store.authorize(token, { appId: 'reminder', spaceId: 'family-a', action: 'read', resourceId: 'record-a', userId: 'alice' });
  assert.equal(actor.userId, 'bob');
  assert.equal(actor.clientId, 'agent-a');
  assert.deepEqual(actor.resources, ['record-a']);
  assert.throws(() => f.store.authorize(token, { appId: 'reminder', spaceId: 'family-a', action: 'read', resourceId: 'record-b' }), { status: 403, code: 'FORBIDDEN' });
  assert.throws(() => f.store.authorize(token, { appId: 'reminder', spaceId: 'personal-a', action: 'read' }), { status: 403 });
  assert.throws(() => f.store.authorize(token, { appId: 'reminder', spaceId: 'family-a', action: 'delete', resourceId: 'record-a' }), { status: 403 });
  assert.throws(() => f.store.authorize(token, { appId: '__proto__', spaceId: 'family-a', action: 'read' }), { status: 403 });
});

test('guest permissions require explicit resources and cannot bootstrap broader delegation', t => {
  const f = fixture(t);
  assert.throws(() => f.store.grantResource({ userId: 'guest', ...rule('company-a', ['read'], ['*'], 'tingproof') }), { status: 403 });
  assert.throws(() => f.grant('guest', [rule('company-a', ['read'], ['*'], 'tingproof')]), { status: 403 });
  assert.throws(() => f.grant('guest', [rule('company-a', ['assign'], ['assignment-a'], 'tingproof')]), { status: 403 });
  const token = f.token('guest', [rule('company-a', ['read', 'submit'], ['assignment-a'], 'tingproof')]);
  assert.deepEqual(f.store.authorize(token, { appId: 'tingproof', spaceId: 'company-a', action: 'read' }).resources, ['assignment-a']);
  assert.deepEqual(f.store.listSpaces(token), [{ id: 'company-a', type: 'company', role: 'guest' }]);
  assert.throws(() => f.store.authorize(token, { appId: 'tingproof', spaceId: 'company-a', action: 'read', resourceId: 'assignment-b' }), { status: 403 });
});

test('finite future Reminder grants permit discovery and the exact creation target without personal membership', t => {
  const f = fixture(t), resourceId = 'r_synthetic_future_reminder';
  const granted = rule('personal-a', ['read', 'create'], [resourceId]);
  f.store.grantResource({ userId: 'guest', ...granted });
  const token = f.token('guest', [granted]);
  assert.deepEqual(f.store.authorize(token, { appId: 'reminder', spaceId: 'personal-a', action: 'create' }).resources, [resourceId]);
  assert.deepEqual(f.store.authorize(token, { appId: 'reminder', spaceId: 'personal-a', action: 'create', resourceId }).resources, [resourceId]);
  assert.throws(() => f.store.authorize(token, { appId: 'reminder', spaceId: 'personal-a', action: 'create', resourceId: 'r_other_synthetic_reminder' }), { status: 403 });
  assert.throws(() => f.store.authorize(token, { appId: 'reminder', spaceId: 'personal-a', action: 'update', resourceId }), { status: 403 });
  assert.throws(() => f.store.authorize(token, { appId: 'reminder', spaceId: 'personal-b', action: 'create', resourceId }), { status: 403 });
  assert.deepEqual(f.store.listSpaces(token), [{ id: 'personal-a', type: 'personal', role: 'guest' }]);
  assert.throws(() => f.grant('guest', [rule('personal-a', ['create'], ['*'])]), { status: 403 });
});

test('family membership never grants access to member personal spaces', t => {
  const f = fixture(t);
  assert.throws(() => f.grant('bob', [rule('personal-a', ['read'])]), { status: 403 });
  const token = f.token('bob', [rule('family-a', ['read'])]);
  assert.deepEqual(f.store.listSpaces(token), [{ id: 'family-a', type: 'family', role: 'member' }]);
  assert.throws(() => f.store.setMembership({ userId: 'bob', spaceId: 'personal-a', role: 'member' }), { status: 403 });
});

test('membership removal revokes existing delegation and does not revive after rejoining', t => {
  const f = fixture(t), token = f.token('bob');
  f.store.authorize(token, { appId: 'reminder', spaceId: 'family-a', action: 'read' });
  const changes = [];
  const stop = f.store.onChange(event => changes.push(event));
  const previous = f.store.policyVersion;
  f.store.setMembership({ userId: 'bob', spaceId: 'family-a', role: null });
  assert.throws(() => f.store.authenticate(token), { status: 401 });
  f.store.setMembership({ userId: 'bob', spaceId: 'family-a', role: 'member' });
  assert.throws(() => f.store.authenticate(token), { status: 401 });
  assert.deepEqual(f.store.userPermissions('bob', 'family-a', 'reminder', 'read'), []);
  assert.equal(f.store.policyVersion, previous + 2);
  assert.equal(changes.length, 2);
  stop();
});

test('resource permission revocation immediately reduces a still-valid client grant', t => {
  const f = fixture(t);
  const permission = f.store.grantResource({ userId: 'guest', ...rule('company-a', ['read'], ['assignment-c'], 'tingproof') });
  const token = f.token('guest', [rule('company-a', ['read'], ['assignment-a', 'assignment-c'], 'tingproof')]);
  f.store.revokeResource(permission.id);
  assert.deepEqual(f.store.authorize(token, { appId: 'tingproof', spaceId: 'company-a', action: 'read' }).resources, ['assignment-a']);
  assert.throws(() => f.store.authorize(token, { appId: 'tingproof', spaceId: 'company-a', action: 'read', resourceId: 'assignment-c' }), { status: 403 });
});

test('credentials, permissions, expiry and revocation survive auth store restart', t => {
  const f = fixture(t), grant = f.grant(), token = f.store.issueToken({ grantId: grant.id, ttlSeconds: 60 }).accessToken;
  assert.equal(statSync(f.file).mode & 0o777, 0o600);
  f.reopen();
  assert.equal(f.store.authenticate(token).userId, 'alice');
  f.store.revokeGrant(grant.id);
  f.reopen();
  assert.throws(() => f.store.authenticate(token), { status: 401 });
  const expiring = f.token('alice', [rule()], { ttlSeconds: 60 });
  f.clock.now += 60000;
  assert.throws(() => f.store.authenticate(expiring), { status: 401 });
});

test('passwords, bearer tokens and arbitrary private payload never enter audit rows', t => {
  const f = fixture(t), token = f.token();
  const auditId = f.store.audit({ event: 'business.invoke', userId: 'alice', clientId: 'agent-a', spaceId: 'family-a', resourceId: 'private-record-name', outcome: 'allowed', body: 'PRIVATE SYNTHETIC BODY', token, password });
  const audit = JSON.stringify(f.store.listAudit());
  for (const secret of [password, token, 'PRIVATE SYNTHETIC BODY', 'private-record-name', 'alice', 'family-a']) assert.ok(!audit.includes(secret));
  assert.ok(audit.includes(auditId));
  assert.ok(!JSON.stringify(f.store.db.prepare('SELECT * FROM auth_tokens').all()).includes(token));
  assert.ok(!JSON.stringify(f.store.db.prepare('SELECT * FROM auth_users').all()).includes(password));
});

test('browser login requires explicit delegation and CSRF binds writes to the current session', t => {
  const f = fixture(t), login = f.store.login({ username: 'alice', password });
  assert.throws(() => f.store.authenticate(login.sessionToken), { status: 403, code: 'DELEGATION_REQUIRED' });
  const grant = f.store.delegateSession(login.sessionToken, { rules: [rule('personal-a', ['read'])] });
  assert.equal(f.store.authenticate(login.sessionToken).grantId, grant.id);
  f.store.requireRequestCsrf({ headers: { cookie: `${SESSION_COOKIE}=${login.sessionToken}`, origin: issuer, 'x-csrf-token': login.csrfToken } });
  assert.throws(() => f.store.requireRequestCsrf({ headers: { cookie: `${SESSION_COOKIE}=${login.sessionToken}`, origin: 'https://evil.example', 'x-csrf-token': login.csrfToken } }), { status: 403 });
  assert.throws(() => f.store.requireRequestCsrf({ headers: { cookie: `${SESSION_COOKIE}=${login.sessionToken}`, origin: issuer, 'x-csrf-token': 'invalid' } }), { status: 403 });
  f.store.logout(login.sessionToken);
  assert.throws(() => f.store.authenticate(login.sessionToken), { status: 401 });
});

test('credential parsing rejects ambiguous cookies and never falls back from malformed authorization', () => {
  assert.equal(credentialFromRequest({ headers: { cookie: `${SESSION_COOKIE}=pxs_valid` } }), 'pxs_valid');
  assert.equal(credentialFromRequest({ headers: { cookie: `${SESSION_COOKIE}=first; ${SESSION_COOKIE}=second` } }), null);
  assert.throws(() => credentialFromRequest({ headers: { authorization: 'Basic invalid', cookie: `${SESSION_COOKIE}=pxs_valid` } }), { status: 401 });
});

test('authorization codes require exact audience, client, redirect, PKCE and single use', t => {
  const f = fixture(t), verifier = 'v'.repeat(48);
  const parameters = new URLSearchParams({ client_id: 'agent-a', redirect_uri: 'https://client.example/callback', response_type: 'code', code_challenge_method: 'S256', code_challenge: hashVerifier(verifier), resource: f.store.resource, scope: 'reminder:read reminder:write' });
  const request = f.store.authorizationRequest(parameters);
  const { code } = f.store.createAuthorizationCode({ request, userId: 'alice', rules: [rule()] });
  const args = { code, clientId: 'agent-a', redirectUri: 'https://client.example/callback', verifier, resource: f.store.resource };
  for (const patch of [{ verifier: 'x'.repeat(48) }, { clientId: 'other' }, { redirectUri: 'https://client.example/other' }, { resource: 'https://other.example/mcp' }]) assert.throws(() => f.store.exchangeCode({ ...args, ...patch }), { status: 400, code: 'INVALID_GRANT' });
  const tokens = f.store.exchangeCode(args);
  assert.equal(f.store.authenticate(tokens.access_token).clientId, 'agent-a');
  assert.throws(() => f.store.exchangeCode(args), { status: 400, code: 'INVALID_GRANT' });
  assert.ok(!JSON.stringify(f.store.db.prepare('SELECT * FROM auth_codes').all()).includes(code));
});

test('refresh rotation persists and refresh token reuse revokes the complete delegation', t => {
  const f = fixture(t), original = f.store.tokenPair(f.grant().id);
  const args = { refreshToken: original.refresh_token, clientId: 'agent-a', resource: f.store.resource };
  const rotated = f.store.refresh(args);
  assert.notEqual(rotated.refresh_token, original.refresh_token);
  f.reopen();
  assert.equal(f.store.authenticate(rotated.access_token).userId, 'alice');
  assert.throws(() => f.store.refresh(args), { status: 400, code: 'INVALID_GRANT' });
  assert.throws(() => f.store.authenticate(rotated.access_token), { status: 401 });
  assert.throws(() => f.store.refresh({ ...args, refreshToken: rotated.refresh_token }), { status: 400, code: 'INVALID_GRANT' });
});

test('consent snapshots cannot change scope, session, expiry or selected rule indices', t => {
  const f = fixture(t), session = f.store.login({ username: 'alice', password });
  const rules = [rule('personal-a', ['read']), rule('family-a', ['update'])];
  const consent = f.store.createConsent(session.sessionToken, rules, 'browser');
  assert.deepEqual(f.store.consentRules(session.sessionToken, { consent, rule_1: '1' }, 'browser'), [rules[1]]);
  const other = f.store.login({ username: 'alice', password });
  assert.throws(() => f.store.consentRules(other.sessionToken, { consent, rule_1: '1' }, 'browser'), { status: 403 });
  assert.throws(() => f.store.consentRules(session.sessionToken, { consent, rule_1: '1' }, 'different-context'), { status: 403 });
  assert.throws(() => f.store.consentRules(session.sessionToken, { consent: `${consent}x`, rule_1: '1' }, 'browser'), { status: 403 });
  f.clock.now += 600001;
  assert.throws(() => f.store.consentRules(session.sessionToken, { consent, rule_1: '1' }, 'browser'), { status: 403 });
});

test('public OAuth metadata and client registration expose no private state or insecure redirects', async t => {
  const f = await httpFixture(t);
  const metadataResponse = await f.request('/.well-known/oauth-authorization-server');
  const metadata = await metadataResponse.json();
  assert.equal(metadata.issuer, issuer);
  assert.deepEqual(metadata.code_challenge_methods_supported, ['S256']);
  assert.equal(metadataResponse.headers.get('access-control-allow-origin'), '*');
  const protectedResource = await (await f.request('/.well-known/oauth-protected-resource/mcp')).json();
  assert.equal(protectedResource.resource, `${issuer}/mcp`);
  assert.ok(!JSON.stringify(metadata).includes('alice'));
  for (const redirect of ['http://evil.example/callback', 'https://a:b@example.com/callback', 'https://client.example/callback#fragment', 'file:///tmp/callback']) {
    const response = await f.json('/oauth/register', { client_name: 'Synthetic client', redirect_uris: [redirect] });
    assert.equal(response.status, 400);
  }
  const response = await f.json('/oauth/register', { client_name: 'Synthetic client', redirect_uris: ['http://127.0.0.1:43219/callback'] });
  assert.equal(response.status, 201);
  assert.equal((await response.json()).token_endpoint_auth_method, 'none');
});

test('browser HTTP login and consent require origin and CSRF without returning credentials', async t => {
  const f = await httpFixture(t);
  const rejected = await f.json('/auth/login', { username: 'alice', password }, { headers: { Origin: 'https://evil.example' } });
  assert.equal(rejected.status, 403);
  const login = await f.login();
  assert.equal(login.body.delegated, false);
  assert.match(login.response.headers.get('set-cookie'), /HttpOnly; SameSite=Lax/);
  for (const key of ['token', 'accessToken', 'password', 'sessionToken']) assert.ok(!Object.hasOwn(login.body, key));
  const badConsent = await f.json('/auth/delegate', { rules: [rule()] }, { headers: { Cookie: login.cookie, 'X-CSRF-Token': 'invalid' } });
  assert.equal(badConsent.status, 403);
  const consent = await f.json('/auth/delegate', { rules: [rule('family-a', ['read'])] }, { headers: { Cookie: login.cookie, 'X-CSRF-Token': login.body.csrfToken } });
  assert.equal(consent.status, 201);
  const session = await (await f.request('/auth/session', { headers: { Cookie: login.cookie } })).json();
  assert.equal(session.delegated, true);
  assert.deepEqual(session.spaces, [{ id: 'family-a', type: 'family', role: 'owner' }]);
  assert.ok(!JSON.stringify(session).includes('pxs_'));
});

test('OAuth HTTP login, consent, token exchange and revocation complete with synthetic identities', async t => {
  const f = await httpFixture(t), verifier = 'z'.repeat(64);
  const query = new URLSearchParams({ client_id: 'agent-a', redirect_uri: 'https://client.example/callback', response_type: 'code', code_challenge_method: 'S256', code_challenge: hashVerifier(verifier), resource: `${issuer}/mcp`, scope: 'reminder:read', state: 'synthetic-state' });
  const path = `/oauth/authorize?${query}`;
  const needsLogin = await f.request(path);
  assert.equal(needsLogin.status, 303);
  assert.ok(needsLogin.headers.get('location').startsWith('/auth/login?'));
  const login = await f.login('bob');
  const form = await f.request(path, { headers: { Cookie: login.cookie } });
  assert.equal(form.status, 200);
  assert.match(await form.text(), /Authorize external agent/);
  const escalation = await f.json(path, { rules: [rule('family-a', ['delete'])] }, { headers: { Cookie: login.cookie, 'X-CSRF-Token': login.body.csrfToken } });
  assert.equal(escalation.status, 403);
  const consent = await f.json(path, { rules: [rule('family-a', ['read'])] }, { headers: { Cookie: login.cookie, 'X-CSRF-Token': login.body.csrfToken } });
  assert.equal(consent.status, 303);
  const destination = new URL(consent.headers.get('location'));
  assert.equal(destination.searchParams.get('state'), 'synthetic-state');
  assert.equal(destination.searchParams.get('iss'), issuer);
  const tokensResponse = await f.json('/oauth/token', { grant_type: 'authorization_code', code: destination.searchParams.get('code'), client_id: 'agent-a', redirect_uri: 'https://client.example/callback', code_verifier: verifier, resource: `${issuer}/mcp` });
  assert.equal(tokensResponse.status, 200);
  const tokens = await tokensResponse.json();
  assert.equal(f.store.authorize(tokens.access_token, { appId: 'reminder', spaceId: 'family-a', action: 'read' }).userId, 'bob');
  assert.throws(() => f.store.authorize(tokens.access_token, { appId: 'reminder', spaceId: 'family-a', action: 'delete' }), { status: 403 });
  assert.equal((await f.json('/oauth/revoke', { token: tokens.refresh_token, client_id: 'agent-a' })).status, 200);
  assert.throws(() => f.store.authenticate(tokens.access_token), { status: 401 });
});
