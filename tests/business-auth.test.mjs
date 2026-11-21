import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
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

async function httpFixture(t, { core = false, gateway = false, apps = {} } = {}) {
  const f = fixture(t);
  let handler = createAuthHandler({ store: f.store, apps, webGateway: { enabled: gateway } });
  const config = { issuer, database: f.file, eventsDatabase: join(dirname(f.file), 'events.db'), observationsFile: join(dirname(f.file), 'observations.db'), allowedHosts: [], apps, ...(gateway ? { webGateway: { enabled: true } } : {}) };
  const server = core ? (await import('../src/business/server.mjs')).createBusinessServer({ config, auth: f.store, pollMs: 60000 }) : createServer(async (request, response) => {
    if (!(await handler(request, response))) { response.writeHead(404); response.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    if (core) await server.core.shutdown();
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    if (core) server.core.events.close();
  });
  let base = `http://127.0.0.1:${server.address().port}`;
  config.allowedHosts.push(new URL(base).host);
  if (gateway) {
    const { createPraxisServer } = await import('../src/server.mjs');
    const web = createPraxisServer({ publicUrlsFile: null, observationsFile: null, businessUrl: null, consoleUpstream: null,
      webGateway: { enabled: true, canonicalUrl: issuer, coreUrl: base, appTargets: {} } });
    await new Promise(resolve => web.listen(0, '127.0.0.1', resolve));
    t.after(async () => { web.closeAllConnections(); await new Promise(resolve => web.close(resolve)); });
    base = `http://127.0.0.1:${web.address().port}`;
  }
  const request = (path, options = {}) => {
    if (!gateway) return fetch(`${base}${path}`, { redirect: 'manual', ...options });
    // Node fetch does not preserve a custom Host. Exercise the real gateway's
    // canonical Host guard using the HTTP transport, without binding its port.
    return new Promise((resolve, reject) => {
      const outgoing = httpRequest(new URL(path, base), { method: options.method ?? 'GET', headers: { ...Object.fromEntries(new Headers(options.headers)), Host: new URL(issuer).host } }, incoming => {
        const parts = [];
        incoming.on('error', reject);
        incoming.on('data', part => parts.push(part));
        incoming.on('end', () => resolve(new Response([204, 304].includes(incoming.statusCode) ? null : Buffer.concat(parts), { status: incoming.statusCode,
          headers: Object.entries(incoming.headers).flatMap(([key, value]) => Array.isArray(value) ? value.map(item => [key, item]) : [[key, value]]) })));
      });
      outgoing.on('error', reject); outgoing.end(options.body);
    });
  };
  const json = (path, data, options = {}) => request(path, { method: 'POST', ...options, headers: { 'Content-Type': 'application/json', Origin: issuer, ...(options.headers ?? {}) }, body: JSON.stringify(data) });
  async function login(username = 'alice') {
    const response = await json('/auth/login', { username, password });
    assert.equal(response.status, 200);
    return { cookie: response.headers.get('set-cookie').split(';')[0], body: await response.json(), response };
  }
  return { ...f, get store() { return f.store; }, request, json, login, base,
    restartAuth() { assert.equal(core, false); f.reopen(); handler = createAuthHandler({ store: f.store }); },
  };
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

test('public registration is reachable in both languages and preserves a validated OAuth return path', async t => {
  const f = await httpFixture(t);
  const target = '/oauth/authorize?client_id=agent-a&state=synthetic-register';
  for (const [language, title] of [['en', /Create.*account|Register/i], ['zh', /创建.*账号|注册/]]) {
    const login = await f.request(`/auth/login?${new URLSearchParams({ return_to: target, lang: language })}`);
    const loginHtml = await login.text();
    const link = loginHtml.match(/href="(\/auth\/register[^\"]*)"/);
    assert.ok(link, 'sign-in offers public account registration');
    const registrationUrl = new URL(link[1].replaceAll('&amp;', '&'), issuer);
    assert.equal(registrationUrl.searchParams.get('return_to'), target);
    const registration = await f.request(registrationUrl.pathname + registrationUrl.search);
    assert.equal(registration.status, 200);
    assert.match(registration.headers.get('cache-control'), /no-store/);
    const html = await registration.text();
    assert.match(html, title);
    assert.match(html, /autocomplete="new-password"/);
    assert.match(html, /name="username"/);
    assert.match(html, /name="return_to"/);
    assert.ok(!html.includes(password));
  }
  const unsafe = await f.json('/auth/register', { username: 'safe-return', password, return_to: '//evil.example/callback' });
  assert.equal(unsafe.status, 201);
  const loginUrl = new URL((await unsafe.json()).loginUrl, issuer);
  assert.equal(loginUrl.origin, issuer);
  assert.ok(!loginUrl.href.includes('evil.example'));
});

test('public JSON registration creates only a durable ordinary identity and never returns credentials', async t => {
  const f = await httpFixture(t);
  const response = await f.json('/auth/register', { username: ' new-visitor ', password, return_to: '/oauth/authorize?state=synthetic' });
  assert.equal(response.status, 201);
  assert.equal(response.headers.get('set-cookie'), null, 'registration requires a separate sign-in');
  const body = await response.json();
  assert.deepEqual(Object.keys(body).sort(), ['loginUrl', 'user']);
  assert.equal(body.user.username, 'new-visitor');
  assert.ok(body.user.id);
  assert.deepEqual(Object.keys(body.user).sort(), ['id', 'username']);
  assert.equal(new URL(body.loginUrl, issuer).searchParams.get('return_to'), '/oauth/authorize?state=synthetic');
  assert.equal(f.store.isPlatformAdmin(body.user.id), false);
  assert.equal(f.store.getWebEntryPolicy(body.user.id), null);
  assert.deepEqual(f.store.availableRules(body.user.id), []);
  assert.equal(f.store.db.prepare('SELECT COUNT(*) AS n FROM auth_members WHERE user_id=?').get(body.user.id).n, 0);
  assert.equal(f.store.db.prepare('SELECT COUNT(*) AS n FROM auth_resources WHERE user_id=?').get(body.user.id).n, 0);
  for (const secret of [password, 'password_hash', 'sessionToken', 'access_token']) assert.ok(!JSON.stringify(body).includes(secret));
  f.restartAuth();
  const login = await f.login('new-visitor');
  assert.equal(login.body.user.id, body.user.id);
  assert.equal(login.body.delegated, false);
  assert.deepEqual(f.store.availableRules(body.user.id), []);
});

test('public registration rejects invalid input, duplicate identities and origin attacks without side effects', async t => {
  const f = await httpFixture(t);
  const count = () => f.store.db.prepare('SELECT COUNT(*) AS n FROM auth_users').get().n;
  const before = count();
  for (const [patch, expected] of [
    [{ username: 'ab' }, 400], [{ username: 'invalid user' }, 400], [{ username: '<script>evil</script>' }, 400],
    [{ username: 'x'.repeat(65) }, 400], [{ password: 'short' }, 400], [{ password: 'x'.repeat(1025) }, 400],
    [{ platformAdmin: true }, 400], [{ id: 'alice' }, 400], [{ apps: ['reminder'] }, 400],
  ]) {
    f.clock.now += 3600001;
    const response = await f.json('/auth/register', { username: 'invalid-visitor', password, ...patch });
    assert.equal(response.status, expected);
    assert.equal((await response.json()).error, 'INVALID_INPUT');
    assert.equal(count(), before);
  }
  const duplicate = await f.json('/auth/register', { username: 'ALICE', password });
  assert.equal(duplicate.status, 409);
  assert.equal((await duplicate.json()).error, 'CONFLICT');
  for (const Origin of ['https://evil.example', 'null', '']) {
    const response = await f.json('/auth/register', { username: 'cross-site', password }, { headers: { Origin } });
    assert.equal(response.status, 403);
  }
  assert.equal(count(), before);
  assert.equal((await f.login('alice')).body.user.id, 'alice', 'duplicate attempts leave the existing password unchanged');
});

test('registration form returns localized validation and returns to sign-in after success', async t => {
  const f = await httpFixture(t);
  const form = data => f.request('/auth/register?lang=zh', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: issuer }, body: new URLSearchParams(data) });
  const invalid = await form({ username: 'form-visitor', password: 'short', return_to: '/oauth/authorize?state=form' });
  assert.equal(invalid.status, 400);
  assert.match(invalid.headers.get('content-type'), /text\/html/);
  const html = await invalid.text();
  assert.match(html, /role="alert"/);
  assert.match(html, /value="form-visitor"/);
  assert.ok(!html.includes('value="short"'));
  const response = await form({ username: 'form-visitor', password, return_to: '/oauth/authorize?state=form' });
  assert.equal(response.status, 303);
  const destination = new URL(response.headers.get('location'), issuer);
  assert.equal(destination.pathname, '/auth/login');
  assert.equal(destination.searchParams.get('return_to'), '/oauth/authorize?state=form');
  assert.equal(destination.searchParams.get('lang'), 'zh');
  assert.equal(destination.searchParams.get('registered'), '1');
  assert.match(await (await f.request(destination.pathname + destination.search)).text(), /注册成功|账号已创建/);
  assert.equal((await f.login('form-visitor')).body.user.username, 'form-visitor');
});

test('registration abuse protection survives restart, ignores spoofed forwarding and expires', async t => {
  const f = await httpFixture(t);
  for (let index = 0; index < 5; index++) {
    const response = await f.json('/auth/register', { username: `rate-visitor-${index}`, password: 'short' });
    assert.equal(response.status, 400);
  }
  f.restartAuth();
  const response = await f.json('/auth/register', { username: 'rate-visitor-valid', password }, { headers: { 'X-Forwarded-For': '203.0.113.75' } });
  assert.equal(response.status, 429);
  assert.equal((await response.json()).error, 'RATE_LIMITED');
  assert.equal(response.headers.get('retry-after'), '3600');
  assert.equal(f.store.db.prepare('SELECT COUNT(*) AS n FROM auth_users WHERE username=?').get('rate-visitor-valid').n, 0);
  f.clock.now += 3600001;
  assert.equal((await f.json('/auth/register', { username: 'rate-visitor-valid', password })).status, 201);
});

test('a publicly registered identity can sign in, consent with PKCE and authenticate the protected MCP resource', async t => {
  const f = await httpFixture(t, { core: true, gateway: true });
  for (const [path, note] of [['/', /Create a Praxis account/], ['/zh-cn/', /创建 Praxis 账号/]]) {
    const home = await f.request(path);
    assert.equal(home.status, 200);
    const html = await home.text();
    assert.match(html, note);
    assert.match(html, /\/auth\/register\?lang=/);
    assert.doesNotMatch(html, /Self-service registration is planned|开放自助注册仍在计划中/);
  }
  assert.equal((await f.request('/auth/register')).status, 200);
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
  const { StreamableHTTPClientTransport } = await import('@modelcontextprotocol/sdk/client/streamableHttp.js');
  const registered = await f.json('/auth/register', { username: 'oauth-visitor', password });
  assert.equal(registered.status, 201);
  const { user } = await registered.json();
  assert.deepEqual(f.store.availableRules(user.id), [], 'registration confers no business rights');
  const login = await f.login('oauth-visitor');
  const verifier = 'public-registration-pkce-verifier-'.repeat(2);
  const path = '/oauth/authorize?' + new URLSearchParams({ client_id: 'agent-a', redirect_uri: 'https://client.example/callback', response_type: 'code', code_challenge_method: 'S256', code_challenge: hashVerifier(verifier), resource: `${issuer}/mcp`, scope: 'reminder:read', state: 'public-registration' });
  assert.match(await (await f.request(path, { headers: { Cookie: login.cookie } })).text(), /No actions available/);
  // Only this isolated fixture supplies pre-existing business permission. The
  // public registration path creates neither this permission nor a membership.
  f.store.configureWebAccessBoundary({ enabled: true, apps: { reminder: { spaces: ['family-a'] } } });
  f.store.setWebAccess({ userId: user.id, apps: ['reminder'], prds: false });
  f.store.grantResource({ userId: user.id, ...rule('family-a', ['read'], ['synthetic-register-record']) });
  const page = await f.request(path, { headers: { Cookie: login.cookie } });
  const html = await page.text();
  assert.match(html, /Authorize external agent/);
  const consent = html.match(/name="consent" value="([^\"]+)"/)[1];
  const allowed = await f.json(path, { csrf: login.body.csrfToken, consent, rule_0: '1' }, { headers: { Cookie: login.cookie } });
  assert.equal(allowed.status, 303);
  const destination = new URL(allowed.headers.get('location'));
  assert.equal(destination.searchParams.get('state'), 'public-registration');
  const exchange = { grant_type: 'authorization_code', code: destination.searchParams.get('code'), client_id: 'agent-a', redirect_uri: 'https://client.example/callback', code_verifier: verifier, resource: `${issuer}/mcp` };
  assert.equal((await f.json('/oauth/token', { ...exchange, code_verifier: 'wrong-verifier'.repeat(4) })).status, 400);
  const response = await f.json('/oauth/token', exchange);
  assert.equal(response.status, 200);
  const tokens = await response.json();
  const actor = f.store.authorize(tokens.access_token, { appId: 'reminder', spaceId: 'family-a', action: 'read', resourceId: 'synthetic-register-record' });
  assert.equal(actor.userId, user.id);
  assert.throws(() => f.store.authorize(tokens.access_token, { appId: 'reminder', spaceId: 'family-a', action: 'read', resourceId: 'other-record' }), { status: 403 });
  const client = new Client({ name: 'synthetic-public-registration', version: '1.0.0' });
  t.after(() => client.close());
  await client.connect(new StreamableHTTPClientTransport(new URL('/mcp', f.base), { fetch: (url, options) => f.request(new URL(url).pathname, options), requestInit: { headers: { Authorization: `Bearer ${tokens.access_token}` } } }));
  assert.ok((await client.listTools()).tools.some(tool => tool.name === 'praxis_refresh_capabilities'));
  assert.equal((await f.json('/oauth/token', exchange)).status, 400, 'authorization codes remain single-use');
  assert.equal((await f.request('/mcp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 401);
});


test('global registration limit bounds distinct transport peers and malformed bodies create no accounts', async t => {
  const f = await httpFixture(t);
  const before = f.store.db.prepare('SELECT COUNT(*) AS n FROM auth_users').get().n;
  for (const body of ['null', '[]', '"invalid"', '{']) {
    const response = await f.request('/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: issuer }, body });
    assert.equal(response.status, 400);
  }
  f.clock.now += 3600001;
  for (let index = 0; index < 100; index++) f.store.limitUserRegistration(`synthetic-peer-${index}`);
  const rejected = await f.json('/auth/register', { username: 'global-limit-visitor', password });
  assert.equal(rejected.status, 429);
  assert.equal(rejected.headers.get('retry-after'), '3600');
  assert.equal(f.store.db.prepare('SELECT COUNT(*) AS n FROM auth_users').get().n, before);
});

// All lifecycle setup below goes through the public product API. Installation
// and identity-store restart are maintenance fixtures, never live app data.
test('self-service spaces enable public member PKCE consent and exactly scoped MCP discovery with durable revocation', async t => {
  const apps = Object.fromEntries(['reminder', 'tingproof'].map(id => [id, { spaces: [], url: 'http://127.0.0.1:1/api/business' }]));
  const f = await httpFixture(t, { core: true, gateway: true, apps });
  async function register(username) {
    const response = await f.json('/auth/register', { username, password });
    assert.equal(response.status, 201); const { user } = await response.json();
    return { ...await f.login(username), user };
  }
  const owner = await register('synthetic-space-owner'), member = await register('synthetic-space-member'), outsider = await register('synthetic-space-outsider');
  const prefix = '/api/business/account/spaces';
  const call = (actor, path, data, method = 'POST') => f.json(prefix + path, data, { method, headers: { Cookie: actor.cookie, 'X-CSRF-Token': actor.body.csrfToken } });
  const read = (actor, path = '') => f.request(prefix + path, { headers: { Cookie: actor.cookie } });
  const created = await call(owner, '', { type: 'family' }); assert.equal(created.status, 201);
  const space = await created.json(), path = `/${space.id}`;
  assert.deepEqual(f.store.availableRules(member.user.id), []);
  assert.equal(f.store.isPlatformAdmin(owner.user.id), false);
  assert.equal(f.store.getWebEntryPolicy(owner.user.id), null);
  const details = await (await read(owner, path)).json();
  assert.deepEqual(details.apps.map(app => app.enabled), [false, false]);
  assert.equal((await call(owner, path + '/apps/reminder', { enabled: true }, 'PUT')).status, 200);
  assert.deepEqual(f.store.userPermissions(owner.user.id, space.id, 'reminder', 'read'), [], 'owner enrollment is not a resource grant');
  assert.equal((await call(owner, path + '/members', { username: member.user.username, role: 'member' })).status, 201);
  assert.deepEqual(f.store.availableRules(member.user.id), [], 'membership alone grants nothing');
  const granted = { userId: member.user.id, appId: 'reminder', actions: ['read'], resources: ['synthetic-space-record'] };
  assert.equal((await call(owner, path + '/permissions', granted)).status, 201);
  assert.deepEqual(f.store.getWebAccess(member.cookie.split('=')[1]).apps, ['reminder']);
  assert.deepEqual(f.store.getWebAccess(owner.cookie.split('=')[1]).apps, []);
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
  const { StreamableHTTPClientTransport } = await import('@modelcontextprotocol/sdk/client/streamableHttp.js');
  const { BUSINESS_TOOLS, MCP_CONTROL_TOOLS } = await import('../src/business/mcp.mjs');
  async function consent() {
    const verifier = 'synthetic-space-member-pkce-'.repeat(3);
    const oauthPath = '/oauth/authorize?' + new URLSearchParams({ client_id: 'agent-a', redirect_uri: 'https://client.example/callback', response_type: 'code', code_challenge_method: 'S256', code_challenge: hashVerifier(verifier), resource: `${issuer}/mcp`, scope: 'reminder:read tingproof:read', state: 'space-lifecycle' });
    const html = await (await f.request(oauthPath, { headers: { Cookie: member.cookie } })).text();
    assert.match(html, /Authorize external agent/); assert.doesNotMatch(html, /TingProof/);
    const snapshot = html.match(/name="consent" value="([^"]+)"/)[1];
    const allowed = await f.json(oauthPath, { csrf: member.body.csrfToken, consent: snapshot, rule_0: '1' }, { headers: { Cookie: member.cookie } });
    assert.equal(allowed.status, 303);
    const destination = new URL(allowed.headers.get('location'));
    assert.equal(destination.searchParams.get('state'), 'space-lifecycle');
    const exchange = { grant_type: 'authorization_code', code: destination.searchParams.get('code'), client_id: 'agent-a', redirect_uri: 'https://client.example/callback', code_verifier: verifier, resource: `${issuer}/mcp` };
    assert.equal((await f.json('/oauth/token', { ...exchange, code_verifier: 'wrong'.repeat(12) })).status, 400);
    const token = await (await f.json('/oauth/token', exchange)).json();
    assert.ok(token.access_token);
    const client = new Client({ name: 'synthetic-space-client', version: '1.0.0' });
    t.after(() => client.close());
    await client.connect(new StreamableHTTPClientTransport(new URL('/mcp', f.base), { fetch: (url, options) => f.request(new URL(url).pathname, options), requestInit: { headers: { Authorization: `Bearer ${token.access_token}` } } }));
    const actual = (await client.listTools()).tools.map(tool => tool.name).sort();
    const expected = [...MCP_CONTROL_TOOLS, ...BUSINESS_TOOLS.filter(tool => tool.appId === 'reminder' && tool.action === 'read' && !(tool.requiredActions || []).some(action => action !== 'read'))].map(tool => tool.name).sort();
    assert.deepEqual(actual, expected); assert.ok(actual.length > MCP_CONTROL_TOOLS.length);
    return { token, oauthPath };
  }
  const first = await consent();
  // Second connection proves runtime policy survives SQLite restart; no running
  // server store or business database is replaced or modified by this check.
  const restored = new AuthStore({ file: f.file, issuer });
  try { restored.configureWebAccessBoundary({ enabled: true, apps }); assert.equal(restored.appSpaceEnabled('reminder', space.id), true); assert.deepEqual(restored.userPermissions(member.user.id, space.id, 'reminder', 'read'), granted.resources); }
  finally { restored.close(); }
  assert.equal((await call(owner, path + '/apps/reminder', { enabled: false }, 'PUT')).status, 200);
  assert.match(await (await f.request(first.oauthPath, { headers: { Cookie: member.cookie } })).text(), /No actions available/);
  assert.throws(() => f.store.authenticate(first.token.access_token), { status: 401 });
  assert.equal((await f.request('/mcp', { method: 'POST', headers: { Authorization: `Bearer ${first.token.access_token}`, 'Content-Type': 'application/json' }, body: '{}' })).status, 401);
  assert.equal((await call(owner, path + '/apps/reminder', { enabled: true }, 'PUT')).status, 200);
  assert.deepEqual(f.store.availableRules(member.user.id), [], 'reenrollment cannot revive permissions or delegation');
  assert.equal((await call(owner, path + '/permissions', granted)).status, 201);
  const second = await consent();
  assert.equal((await call(owner, path + `/members/${member.user.id}`, undefined, 'DELETE')).status, 200);
  assert.throws(() => f.store.authenticate(second.token.access_token), { status: 401 });
  assert.match(await (await f.request(second.oauthPath, { headers: { Cookie: member.cookie } })).text(), /No actions available/);
  assert.equal((await call(owner, path + '/members', { username: member.user.username, role: 'member' })).status, 201);
  assert.deepEqual(f.store.availableRules(member.user.id), [], 'rejoining cannot revive permissions');
  assert.equal((await read(outsider, path)).status, 404);
  assert.equal((await f.request('/mcp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 401);
});

test('public space lifecycle refuses personal membership, elevation, cross-space edits and non-native or forged requests', async t => {
  const apps = { reminder: { spaces: [] } };
  const f = await httpFixture(t, { apps, gateway: true });
  const owner = await f.login('alice'), member = await f.login('bob');
  const prefix = '/api/business/account/spaces';
  const call = (actor, path, input, method = 'POST', extra = {}) => f.json(prefix + path, input, { method, headers: { Cookie: actor.cookie, 'X-CSRF-Token': actor.body.csrfToken, ...extra } });
  assert.equal((await call(owner, '', { type: 'family', ownerId: 'bob' })).status, 400);
  assert.equal((await call(owner, '', { type: 'platform' })).status, 400);
  assert.equal((await call(owner, '', { type: 'family' }, 'POST', { 'X-CSRF-Token': 'forged' })).status, 403);
  assert.equal((await call(owner, '', { type: 'family' }, 'POST', { Origin: 'https://attacker.example' })).status, 403);
  assert.equal((await f.json(prefix, { type: 'personal' })).status, 401);
  assert.equal((await call(owner, '', { type: 'family' }, 'POST', { Authorization: `Bearer pxa_${'a'.repeat(43)}` })).status, 401);
  const space = await (await call(owner, '', { type: 'personal' })).json(), path = `/${space.id}`;
  assert.equal((await call(owner, path + '/members', { username: 'bob', role: 'member' })).status, 403);
  assert.equal((await call(owner, path + '/members', { username: 'bob', role: 'admin' })).status, 400);
  for (const appId of ['unknown', '__proto__', 'tingproof', 'spaces']) assert.equal((await call(owner, path + `/apps/${appId}`, { enabled: true }, 'PUT')).status, 403);
  assert.equal((await call(owner, path + '/apps/reminder', { enabled: 'true' }, 'PUT')).status, 403);
  assert.equal((await call(member, path + '/apps/reminder', { enabled: true }, 'PUT')).status, 404);
  assert.equal((await call(owner, path + '/apps/reminder', { enabled: true }, 'PUT')).status, 200);
  assert.equal((await call(owner, path + '/permissions', { userId: 'bob', appId: 'reminder', resources: ['*'], actions: ['read'] })).status, 403);
  assert.equal((await call(owner, path + '/permissions', { userId: 'alice', appId: 'spaces', resources: ['*'], actions: ['manage_members'] })).status, 403);
  assert.equal((await call(owner, path + '/permissions', { userId: 'alice', appId: 'reminder', resources: ['*'], actions: ['platform_admin'] })).status, 400);
  assert.equal(f.store.isPlatformAdmin('alice'), false);
  const family = await (await call(owner, '', { type: 'family' })).json();
  assert.equal((await call(owner, `/${family.id}/members`, { username: 'bob', role: 'member' })).status, 201);
  assert.equal((await call(member, `/${family.id}/apps/reminder`, { enabled: true }, 'PUT')).status, 403);
  assert.equal((await call(member, `/${family.id}/permissions`, { userId: 'bob', appId: 'reminder', resources: ['*'], actions: ['read'] })).status, 403);
  assert.equal((await call(owner, path + '/members/alice', undefined, 'DELETE')).status, 409);
});

test('explicit self-service owner permissions constrain dispatch and subject expiry', t => {
  const f = fixture(t), apps = { reminder: { spaces: [] } };
  f.store.configureWebAccessBoundary({ enabled: true, apps });
  const space = f.store.createSelfServiceSpace({ type: 'personal', ownerId: 'alice' });
  f.store.setSpaceAppEnrollment({ spaceId: space.id, appId: 'reminder', enabled: true });
  const expiresAt = f.clock.now + 5000;
  f.store.grantResource({ userId: 'alice', spaceId: space.id, appId: 'reminder', resources: ['synthetic-expiring'], actions: ['read'], expiresAt });
  const login = f.store.login({ username: 'alice', password });
  const query = { appId: 'reminder', spaceId: space.id, resourceId: 'synthetic-expiring', action: 'read' };
  assert.equal(f.store.authorize(login.sessionToken, query).expiresAt, expiresAt);
  assert.equal(f.store.subjectReadScope('alice', query).expiresAt, expiresAt);
  f.clock.now = expiresAt;
  assert.throws(() => f.store.authorize(login.sessionToken, query), { status: 403 });
  assert.equal(f.store.subjectReadScope('alice', query), null);
});
