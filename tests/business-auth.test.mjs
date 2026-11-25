import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { AuthStore, createAuthHandler, credentialFromRequest, hashVerifier, SESSION_COOKIE } from '../src/business/auth.mjs';

const password = 'Synthetic-test-password-2026';
const issuer = 'http://127.0.0.1:4326';
const defaultCsp = "default-src 'none'; img-src 'self'; manifest-src 'self'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'";
function assertConsentCsp(value, html, callbackOrigin) {
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  assert.equal(scripts.length, 1, 'only the fixed selector script is executable');
  const digest = createHash('sha256').update(scripts[0][1]).digest('base64');
  const policy = callbackOrigin ? defaultCsp.replace("form-action 'self'", `form-action 'self' ${callbackOrigin}`) : defaultCsp;
  assert.equal(value, `${policy}; script-src 'sha256-${digest}'`);
  assert.doesNotMatch(html, /onchange=|<button>Choose space|<button>选择空间/);
}
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

async function httpFixture(t, { core = false, gateway = false, apps = {}, pollMs = 60000 } = {}) {
  const f = fixture(t);
  let handler = createAuthHandler({ store: f.store, apps, webGateway: { enabled: gateway } });
  const config = { issuer, database: f.file, eventsDatabase: join(dirname(f.file), 'events.db'), observationsFile: join(dirname(f.file), 'observations.db'), allowedHosts: [], apps, ...(gateway ? { webGateway: { enabled: true } } : {}) };
  const server = core ? (await import('../src/business/server.mjs')).createBusinessServer({ config, auth: f.store, pollMs }) : createServer(async (request, response) => {
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
      const outgoing = httpRequest(new URL(path, base), { method: options.method ?? 'GET', headers: {
        ...Object.fromEntries(new Headers(options.headers)), Host: new URL(issuer).host,
        ...(options.body === undefined ? {} : { 'Content-Length': Buffer.byteLength(options.body) }),
      } }, incoming => {
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
    events: core ? server.core.events : null,
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
  assert.throws(() => f.store.consentRules(session.sessionToken, { consent }, 'browser'), { status: 400, code: 'EMPTY_CONSENT' });
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
  const consentHtml = await form.text();
  assertConsentCsp(form.headers.get('content-security-policy'), consentHtml, 'https://client.example');
  assert.match(consentHtml, /Authorize external agent/);
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

for (const language of ['en', 'zh']) test(`empty OAuth consent shows an actionable ${language} form and retries through PKCE`, async t => {
  const f = await httpFixture(t), verifier = 'empty-selection-verifier-'.repeat(3);
  assert.equal((await f.json('/auth/register', { username: 'consent-visitor', password })).status, 201);
  const userId = f.store.db.prepare('SELECT id FROM auth_users WHERE username=?').get('consent-visitor').id;
  f.store.grantResource({ userId, ...rule('family-a', ['read'], ['synthetic-record']) });
  const registration = await f.json('/oauth/register', { client_name: 'Synthetic <consent> client', redirect_uris: ['https://client.example/callback'], token_endpoint_auth_method: 'none' });
  assert.equal(registration.status, 201);
  const { client_id: clientId } = await registration.json();
  const login = await f.login('consent-visitor');
  const path = '/oauth/authorize?' + new URLSearchParams({ client_id: clientId, redirect_uri: 'https://client.example/callback', response_type: 'code', code_challenge_method: 'S256', code_challenge: hashVerifier(verifier), resource: `${issuer}/mcp`, scope: 'reminder:read', state: 'empty-selection-retry', space_id: 'family-a', lang: language });
  const form = await f.request(path, { headers: { Cookie: login.cookie } });
  assert.equal(form.status, 200);
  const html = await form.text();
  assertConsentCsp(form.headers.get('content-security-policy'), html, 'https://client.example');
  assert.match(html, /name="rule_0"/);
  assert.doesNotMatch(html, /\bchecked\b|role="alert"/);
  const consent = html.match(/name="consent" value="([^"]+)"/)[1];
  const submit = (input, headers = {}) => f.request(path, { method: 'POST', headers: { Cookie: login.cookie, Origin: issuer, 'Content-Type': 'application/x-www-form-urlencoded', ...headers }, body: new URLSearchParams(input) });
  const counts = () => ['auth_codes', 'auth_grants', 'auth_tokens'].map(table => f.store.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n);
  const before = counts();
  for (const [input, headers] of [
    [{ csrf: login.body.csrfToken, consent }, { Origin: 'https://other.example' }],
    [{ csrf: 'invalid', consent }, {}],
    [{ csrf: login.body.csrfToken, consent: `${consent}x` }, {}],
  ]) {
    const rejected = await submit(input, headers);
    assert.equal(rejected.status, 403);
    assert.equal(rejected.headers.get('content-security-policy'), defaultCsp);
    assert.equal(rejected.headers.get('location'), null);
    assert.doesNotMatch(await rejected.text(), /name="consent"/);
  }
  const empty = await submit({ csrf: login.body.csrfToken, consent });
  assert.equal(empty.status, 400);
  assert.equal(empty.headers.get('location'), null);
  assert.match(empty.headers.get('content-type'), /text\/html/);
  assert.match(empty.headers.get('cache-control'), /no-store/);
  const retry = await empty.text();
  assertConsentCsp(empty.headers.get('content-security-policy'), retry, 'https://client.example');
  assert.match(retry, language === 'en' ? /role="alert">Select at least one permission, then choose Authorize selected actions\./ : /role="alert">请至少勾选一项权限，再点击「确认授权」。/);
  assert.match(retry, /Synthetic &lt;consent&gt; client/);
  assert.match(retry, /<form method="post" action="\/oauth\/authorize\?/);
  assert.match(retry, /name="rule_0"/);
  assert.doesNotMatch(retry, /\bchecked\b/);
  assert.deepEqual(counts(), before, 'empty and invalid consent issue no codes, grants or tokens');
  const allowed = await submit({ csrf: login.body.csrfToken, consent: retry.match(/name="consent" value="([^"]+)"/)[1], rule_0: '1' });
  assert.equal(allowed.status, 303);
  assert.equal(allowed.headers.get('content-security-policy'), defaultCsp);
  const destination = new URL(allowed.headers.get('location'));
  assert.equal(destination.origin + destination.pathname, 'https://client.example/callback');
  assert.equal(destination.searchParams.get('state'), 'empty-selection-retry');
  assert.equal(destination.searchParams.get('iss'), issuer);
  assert.ok(destination.searchParams.get('code'));
  const exchange = { grant_type: 'authorization_code', code: destination.searchParams.get('code'), client_id: clientId, redirect_uri: 'https://client.example/callback', code_verifier: verifier, resource: `${issuer}/mcp` };
  const response = await f.json('/oauth/token', exchange);
  assert.equal(response.status, 200);
  const tokens = await response.json();
  assert.equal(tokens.scope, 'reminder:read');
  assert.equal(f.store.authorize(tokens.access_token, { appId: 'reminder', spaceId: 'family-a', action: 'read', resourceId: 'synthetic-record' }).userId, userId);
  assert.throws(() => f.store.authorize(tokens.access_token, { appId: 'reminder', spaceId: 'family-a', action: 'delete', resourceId: 'synthetic-record' }), { status: 403 });
  assert.equal((await f.json('/oauth/token', exchange)).status, 400);
});

test('only verified selectable OAuth documents allow a safe registered callback CSP origin', async t => {
  const f = await httpFixture(t), login = await f.login('bob');
  assert.equal((await f.json('/auth/register', { username: 'csp-unprivileged', password })).status, 201);
  const requestPath = (redirectUri, extra = {}) => '/oauth/authorize?' + new URLSearchParams({ client_id: 'agent-a', redirect_uri: redirectUri, response_type: 'code', code_challenge_method: 'S256', code_challenge: hashVerifier('csp-verifier-'.repeat(4)), resource: `${issuer}/mcp`, scope: 'reminder:read', ...extra });
  for (const path of ['/auth/login', '/auth/register', '/auth/delegate']) {
    const response = await f.request(path, { headers: { Cookie: login.cookie } });
    assert.equal(response.headers.get('content-security-policy'), defaultCsp, path);
  }
  for (const [path, cookie, status] of [
    [requestPath('https://unregistered.example/callback'), login.cookie, 400],
    [requestPath('https://client.example/other'), login.cookie, 400],
    [requestPath('https://client.example/callback', { code_challenge_method: 'plain' }), login.cookie, 400],
    [requestPath('https://client.example/callback'), '', 303],
    [requestPath('https://client.example/callback'), (await f.login('csp-unprivileged')).cookie, 200],
  ]) {
    const response = await f.request(path, { headers: { Cookie: cookie } });
    assert.equal(response.status, status);
    const html = await response.text();
    if (status === 200) assertConsentCsp(response.headers.get('content-security-policy'), html);
    else assert.equal(response.headers.get('content-security-policy'), defaultCsp);
  }
  for (const uri of ['https://client.example/callback?state=x;form-action%20*', 'http://[::1]:7890/callback', 'https://*.example/callback', 'https://client.example;script-src.example/callback', "https://client'example/callback"]) {
    const client = f.store.createClient({ name: 'Synthetic CSP client', redirectUris: [uri] });
    const response = await f.request(requestPath(uri, { client_id: client.id }), { headers: { Cookie: login.cookie } });
    const safe = ['client.example', '[::1]'].includes(new URL(uri).hostname);
    assert.equal(response.status, safe ? 200 : 400);
    if (safe) assertConsentCsp(response.headers.get('content-security-policy'), await response.text(), new URL(uri).origin);
    else assert.equal(response.headers.get('content-security-policy'), defaultCsp);
  }
});

// Run with PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs.
// HTTP fetch alone cannot exercise Chromium's form-action redirect checks.
test('Chromium follows consent POST to a cross-origin callback and completes PKCE', { skip: !process.env.PLAYWRIGHT_MODULE, timeout: 60000 }, async t => {
  const { chromium } = await import(process.env.PLAYWRIGHT_MODULE);
  const directory = mkdtempSync(join(tmpdir(), 'praxis-oauth-browser-'));
  let store, handler, browser;
  const callbacks = [];
  const callback = createServer((request, response) => {
    callbacks.push(new URL(request.url, 'http://callback.invalid'));
    response.writeHead(200, { 'Content-Type': 'text/html' });
    response.end('<!doctype html><title>Synthetic OAuth callback</title><p>Callback received.</p>');
  });
  const server = createServer(async (request, response) => {
    if (!(await handler(request, response))) response.writeHead(404).end();
  });
  t.after(async () => {
    await browser?.close();
    for (const service of [server, callback]) { service.closeAllConnections(); await new Promise(resolve => service.close(resolve)); }
    store?.close(); rmSync(directory, { recursive: true, force: true });
  });
  for (const service of [server, callback]) await new Promise(resolve => service.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const redirectUri = `http://127.0.0.1:${callback.address().port}/callback?fixed=synthetic`;
  assert.notEqual(new URL(redirectUri).origin, origin);
  store = new AuthStore({ file: join(directory, 'auth.sqlite'), issuer: origin });
  handler = createAuthHandler({ store });
  browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE, args: ['--no-sandbox'] });
  for (const [language, width] of [['en', 1440], ['zh', 390]]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    const page = await context.newPage(), violations = [], posts = [];
    page.on('console', message => { if (/form-action|Content Security Policy/i.test(message.text())) violations.push(message.text()); });
    page.on('response', response => { if (response.request().method() === 'POST' && new URL(response.url()).pathname === '/oauth/authorize') posts.push(response); });
    const registration = await context.request.post(`${origin}/oauth/register`, { data: { client_name: 'Synthetic browser client', redirect_uris: [redirectUri], token_endpoint_auth_method: 'none' } });
    assert.equal(registration.status(), 201);
    const { client_id: clientId } = await registration.json();
    const verifier = `synthetic-browser-verifier-${language}-`.repeat(3);
    const path = '/oauth/authorize?' + new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, response_type: 'code', code_challenge_method: 'S256', code_challenge: hashVerifier(verifier), resource: `${origin}/mcp`, scope: 'reminder:read', state: `synthetic-${language}`, lang: language });
    const registrationPage = await page.goto(`${origin}/auth/register?` + new URLSearchParams({ return_to: path, lang: language }));
    assert.equal(registrationPage.headers()['content-security-policy'], defaultCsp);
    await page.locator('input[name=username]').fill(`synthetic-browser-${language}`);
    await page.locator('input[name=password]').fill(password);
    await Promise.all([page.waitForURL(url => url.pathname === '/auth/login'), page.locator('form[method=post] button').click()]);
    await page.locator('input[name=username]').fill(`synthetic-browser-${language}`);
    await page.locator('input[name=password]').fill(password);
    await Promise.all([page.waitForURL(url => url.pathname === '/oauth/authorize'), page.locator('form[method=post] button').click()]);
    assert.equal(await page.locator('input[name=rule_0]').count(), 0, 'a new account has no implicit permissions');
    const userId = store.db.prepare('SELECT id FROM auth_users WHERE username=?').get(`synthetic-browser-${language}`).id;
    // Only the isolated synthetic store is bootstrapped; no business service runs.
    const spaceId = store.ensurePersonalSpace(userId).id;
    store.grantResource({ userId, ...rule(spaceId, ['read'], ['synthetic-record']) });
    const form = await page.reload();
    assertConsentCsp(form.headers()['content-security-policy'], await form.text(), new URL(redirectUri).origin);
    assert.equal(await page.locator('input[name=rule_0]').isChecked(), false);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.equal(await page.locator('select[name=space_id]').inputValue(), spaceId);
    const counts = () => ['auth_codes', 'auth_grants', 'auth_tokens'].map(table => store.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n);
    const before = counts(), callbackCount = callbacks.length;
    const [empty] = await Promise.all([page.waitForResponse(r => r.request().method() === 'POST' && new URL(r.url()).pathname === '/oauth/authorize'), page.locator('form[method=post] button').click()]);
    await page.locator('[role=alert]').waitFor();
    assert.equal(empty.status(), 400);
    assert.equal(empty.headers()['location'], undefined);
    assertConsentCsp(empty.headers()['content-security-policy'], await empty.text(), new URL(redirectUri).origin);
    assert.equal(new URL(page.url()).pathname, '/oauth/authorize');
    assert.match(await page.locator('[role=alert]').innerText(), language === 'en' ? /Select at least one permission/ : /请至少勾选一项权限/);
    assert.deepEqual(counts(), before);
    assert.equal(callbacks.length, callbackCount);
    await page.locator('input[name=rule_0]').check();
    await Promise.all([page.waitForURL(url => url.origin === new URL(redirectUri).origin), page.locator('form[method=post] button').click()]);
    assert.equal(callbacks.length, callbackCount + 1, 'the browser, not fetch, reaches the receiver');
    assert.deepEqual(posts.map(response => response.status()), [400, 303]);
    const destination = callbacks.at(-1);
    assert.equal(destination.searchParams.get('state'), `synthetic-${language}`);
    assert.equal(destination.searchParams.get('iss'), origin);
    assert.equal(destination.searchParams.get('fixed'), 'synthetic');
    assert.ok(destination.searchParams.get('code'));
    const exchange = { grant_type: 'authorization_code', code: destination.searchParams.get('code'), client_id: clientId, redirect_uri: redirectUri, code_verifier: verifier, resource: `${origin}/mcp` };
    const tokens = await context.request.post(`${origin}/oauth/token`, { data: exchange });
    assert.equal(tokens.status(), 200);
    const token = await tokens.json();
    assert.equal(token.scope, 'reminder:read');
    assert.equal(token.space_id, spaceId);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.equal(store.authorize(token.access_token, { appId: 'reminder', spaceId, action: 'read', resourceId: 'synthetic-record' }).userId, userId);
    assert.equal((await context.request.post(`${origin}/oauth/token`, { data: exchange })).status(), 400);
    assert.deepEqual(violations, []);
    await context.close();
  }
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

test('public JSON registration creates a durable ordinary identity and empty personal space without credentials', async t => {
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
  assert.deepEqual(f.store.availableRules(body.user.id).filter(rule => rule.appId !== 'spaces'), []);
  assert.equal(f.store.db.prepare('SELECT COUNT(*) AS n FROM auth_members WHERE user_id=?').get(body.user.id).n, 1);
  assert.equal(f.store.db.prepare('SELECT COUNT(*) AS n FROM auth_resources WHERE user_id=?').get(body.user.id).n, 0);
  for (const secret of [password, 'password_hash', 'sessionToken', 'access_token']) assert.ok(!JSON.stringify(body).includes(secret));
  f.restartAuth();
  const login = await f.login('new-visitor');
  assert.equal(login.body.user.id, body.user.id);
  assert.equal(login.body.delegated, false);
  assert.deepEqual(f.store.availableRules(body.user.id).filter(rule => rule.appId !== 'spaces'), []);
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
  assert.deepEqual(f.store.availableRules(user.id).filter(rule => rule.appId !== 'spaces'), [], 'registration confers no app resource rights');
  const login = await f.login('oauth-visitor');
  const verifier = 'public-registration-pkce-verifier-'.repeat(2);
  const path = '/oauth/authorize?' + new URLSearchParams({ client_id: 'agent-a', redirect_uri: 'https://client.example/callback', response_type: 'code', code_challenge_method: 'S256', code_challenge: hashVerifier(verifier), resource: `${issuer}/mcp`, scope: 'reminder:read', state: 'public-registration', space_id: 'family-a' });
  assert.match(await (await f.request(path.replace('&space_id=family-a', ''), { headers: { Cookie: login.cookie } })).text(), /No actions available/);
  // Only this isolated fixture supplies pre-existing business permission. The
  // public registration path creates no permission for this shared space.
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
  assert.deepEqual(f.store.availableRules(member.user.id).filter(rule => rule.appId !== 'spaces'), []);
  assert.equal(f.store.isPlatformAdmin(owner.user.id), false);
  assert.equal(f.store.getWebEntryPolicy(owner.user.id), null);
  const details = await (await read(owner, path)).json();
  assert.equal(details.apps.length, 13);
  assert.ok(details.apps.every(app => app.enabled === false));
  assert.ok(details.apps.every(app => !app.availableActions.length && !app.availableResources.length), 'new space has no effective business access');
  assert.equal((await call(owner, path + '/apps/reminder', { enabled: true }, 'PUT')).status, 200);
  assert.deepEqual(f.store.userPermissions(owner.user.id, space.id, 'reminder', 'read'), [], 'owner enrollment is not a resource grant');
  assert.equal((await call(owner, path + '/members', { username: member.user.username, role: 'member' })).status, 201);
  assert.deepEqual(f.store.availableRules(member.user.id).filter(rule => rule.appId !== 'spaces'), [], 'membership alone grants nothing');
  const granted = { userId: member.user.id, appId: 'reminder', actions: ['read'], resources: ['synthetic-space-record'] };
  assert.equal((await call(owner, path + '/permissions', granted)).status, 201);
  assert.deepEqual(f.store.getWebAccess(member.cookie.split('=')[1]).apps, ['reminder']);
  assert.deepEqual(f.store.getWebAccess(owner.cookie.split('=')[1]).apps, []);
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
  const { StreamableHTTPClientTransport } = await import('@modelcontextprotocol/sdk/client/streamableHttp.js');
  const { BUSINESS_TOOLS, MCP_CONTROL_TOOLS } = await import('../src/business/mcp.mjs');
  async function consent() {
    const verifier = 'synthetic-space-member-pkce-'.repeat(3);
    const oauthPath = '/oauth/authorize?' + new URLSearchParams({ client_id: 'agent-a', redirect_uri: 'https://client.example/callback', response_type: 'code', code_challenge_method: 'S256', code_challenge: hashVerifier(verifier), resource: `${issuer}/mcp`, scope: 'reminder:read tingproof:read', state: 'space-lifecycle', space_id: space.id });
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
  assert.deepEqual(f.store.availableRules(member.user.id).filter(rule => rule.appId !== 'spaces'), [], 'reenrollment cannot revive permissions or delegation');
  assert.equal((await call(owner, path + '/permissions', granted)).status, 201);
  const second = await consent();
  assert.equal((await call(owner, path + `/members/${member.user.id}`, undefined, 'DELETE')).status, 200);
  assert.throws(() => f.store.authenticate(second.token.access_token), { status: 401 });
  assert.equal((await f.request(second.oauthPath, { headers: { Cookie: member.cookie } })).status, 403);
  assert.equal((await call(owner, path + '/members', { username: member.user.username, role: 'member' })).status, 201);
  assert.deepEqual(f.store.availableRules(member.user.id).filter(rule => rule.appId !== 'spaces'), [], 'rejoining cannot revive permissions');
  assert.equal((await read(outsider, path)).status, 404);
  assert.equal((await f.request('/mcp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 401);
});

test('members leave family and company spaces through the native API with atomic scoped cleanup and immediate access loss', async t => {
  const f = await httpFixture(t, { apps: { reminder: { spaces: ['family-a', 'company-a'] } } });
  const member = await f.login('bob'), prefix = '/api/business/account/spaces';
  const headers = { Cookie: member.cookie, 'X-CSRF-Token': member.body.csrfToken };
  f.store.setMembership({ spaceId: 'company-a', userId: 'bob', role: 'member' });
  f.store.grantResource({ userId: 'bob', ...rule('company-a', ['read'], ['company-record']) });
  // An explicit guest permission predating membership remains independent.
  const independent = f.store.grantResource({ userId: 'bob', ...rule('personal-a', ['read'], ['independent-record']) });
  const only = f.grant('bob', [rule('family-a', ['read'], ['family-record'])]);
  const mixed = f.grant('bob', [rule('family-a', ['read'], ['family-record']), rule('company-a', ['read'], ['company-record'])]);
  const onlyToken = f.store.issueToken({ grantId: only.id }).accessToken, mixedToken = f.store.issueToken({ grantId: mixed.id }).accessToken;
  const preserved = f.store.db.prepare("SELECT * FROM auth_resources WHERE id=?").get(independent.id);
  const ownerMemberships = f.store.db.prepare("SELECT * FROM auth_members WHERE user_id='alice' ORDER BY space_id").all();
  let notified = 0;
  const off = f.store.onChange(change => {
    if (change.type !== 'membership') return;
    notified++;
    assert.equal(f.store.membershipRole('bob', change.spaceId), null);
    assert.equal(f.store.db.prepare('SELECT COUNT(*) AS n FROM auth_resources WHERE user_id=? AND space_id=? AND membership_required=1').get('bob', change.spaceId).n, 0);
  });
  const left = await f.json(`${prefix}/family-a/leave`, {}, { headers });
  assert.equal(left.status, 200); assert.deepEqual(await left.json(), { left: true, spaceId: 'family-a' });
  assert.equal(notified, 1);
  assert.throws(() => f.store.authenticate(onlyToken), { status: 401 });
  assert.throws(() => f.store.authorize(mixedToken, { appId: 'reminder', spaceId: 'family-a', action: 'read', resourceId: 'family-record' }), { status: 403 });
  assert.equal(f.store.authorize(mixedToken, { appId: 'reminder', spaceId: 'company-a', action: 'read', resourceId: 'company-record' }).userId, 'bob');
  assert.deepEqual(f.store.listGrants('bob').find(grant => grant.id === mixed.id).rules, [rule('company-a', ['read'], ['company-record'])]);
  assert.equal((await f.request(`${prefix}/family-a`, { headers })).status, 404);
  assert.ok(!(await (await f.request(prefix, { headers })).json()).spaces.some(space => space.id === 'family-a'));
  assert.equal((await f.json(`${prefix}/company-a/leave`, {}, { headers })).status, 200);
  assert.throws(() => f.store.authenticate(mixedToken), { status: 401 });
  assert.equal(notified, 2); off();
  assert.deepEqual(f.store.db.prepare('SELECT * FROM auth_resources WHERE id=?').get(independent.id), preserved);
  assert.deepEqual(f.store.db.prepare("SELECT * FROM auth_members WHERE user_id='alice' ORDER BY space_id").all(), ownerMemberships);
  assert.ok(f.store.db.prepare("SELECT 1 FROM auth_spaces WHERE id='family-a'").get(), 'leaving does not delete a space');
  f.store.setMembership({ spaceId: 'family-a', userId: 'bob', role: 'member' });
  assert.deepEqual(f.store.userPermissions('bob', 'family-a', 'reminder', 'read'), [], 'rejoining cannot revive removed permissions');
  assert.throws(() => f.store.authenticate(onlyToken), { status: 401 });
});

test('leave API binds identity to the native session and retains owner, personal-space and management boundaries', async t => {
  const f = await httpFixture(t), owner = await f.login('alice'), member = await f.login('bob'), outsider = await f.login('guest');
  const prefix = '/api/business/account/spaces';
  const call = (actor, id = 'family-a', input = {}, extra = {}, method = 'POST') => f.json(`${prefix}/${id}/leave`, input, { method, headers: { Cookie: actor.cookie, 'X-CSRF-Token': actor.body.csrfToken, ...extra } });
  const before = f.store.db.prepare('SELECT * FROM auth_members ORDER BY space_id,user_id').all();
  const owned = await call(owner); assert.equal(owned.status, 409); assert.equal((await owned.json()).error, 'OWNER_REQUIRED');
  f.store.createUser({ id: 'automatic-owner', username: 'synthetic-automatic-owner', password });
  const personal = f.store.ensurePersonalSpace('automatic-owner'), automaticOwner = await f.login('synthetic-automatic-owner');
  const personalLeave = await call(automaticOwner, personal.id); assert.equal(personalLeave.status, 409); assert.equal((await personalLeave.json()).error, 'OWNER_REQUIRED');
  assert.equal((await call(outsider)).status, 404);
  assert.equal((await call(member, 'family-a', { userId: 'alice' })).status, 400);
  assert.equal((await call(member, 'family-a', {}, { 'X-CSRF-Token': 'forged' })).status, 403);
  assert.equal((await call(member, 'family-a', {}, { Origin: 'https://attacker.example' })).status, 403);
  assert.equal((await call(member, 'family-a', {}, { Authorization: 'Bearer synthetic-token' })).status, 401);
  assert.equal((await f.json(`${prefix}/family-a/leave`, {})).status, 401);
  assert.equal((await f.request(`${prefix}/family-a/leave`, { headers: { Cookie: member.cookie } })).status, 405);
  assert.equal((await call(member, 'family-a', {}, {}, 'DELETE')).status, 405);
  f.store.setPlatformAdmin({ userId: 'guest', enabled: true });
  assert.equal((await call(outsider)).status, 404, 'platform visibility cannot fabricate membership to leave');
  assert.deepEqual(f.store.db.prepare('SELECT * FROM auth_members WHERE space_id<>? ORDER BY space_id,user_id').all(personal.id), before);
  assert.equal(f.store.spaceDeletionProtected(personal.id), true);
  const ownerHeaders = { Cookie: owner.cookie, 'X-CSRF-Token': owner.body.csrfToken };
  assert.equal((await f.json(`${prefix}/family-a/members/bob`, undefined, { method: 'DELETE', headers: ownerHeaders })).status, 200, 'owner removal remains available');
  f.store.setMembership({ spaceId: 'family-a', userId: 'bob', role: 'member' });
  f.store.setMembership({ spaceId: 'family-a', userId: 'guest', role: 'admin' });
  assert.equal((await f.json('/api/business/management/spaces/family-a/members/bob', undefined, { method: 'DELETE', headers: { Cookie: outsider.cookie, 'X-CSRF-Token': outsider.body.csrfToken } })).status, 200, 'existing space administrator removal remains available');
});

test('leave API rolls back membership, resource permissions, delegation pruning and notifications on cleanup failure', async t => {
  const f = await httpFixture(t), member = await f.login('bob');
  const grant = f.grant('bob', [rule('family-a', ['read'])]), token = f.store.issueToken({ grantId: grant.id }).accessToken;
  const tables = ['auth_members', 'auth_resources', 'auth_grants', 'auth_audit', 'auth_meta'];
  const snapshot = () => Object.fromEntries(tables.map(table => [table, f.store.db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]));
  const before = snapshot(); let notifications = 0;
  f.store.onChange(() => notifications++);
  f.store.db.exec("CREATE TEMP TRIGGER synthetic_leave_failure BEFORE UPDATE ON auth_grants BEGIN SELECT RAISE(ABORT,'synthetic leave rollback'); END");
  const response = await f.json('/api/business/account/spaces/family-a/leave', {}, { headers: { Cookie: member.cookie, 'X-CSRF-Token': member.body.csrfToken } });
  assert.equal(response.status, 500);
  assert.deepEqual(snapshot(), before); assert.equal(notifications, 0);
  assert.equal(f.store.authorize(token, { appId: 'reminder', spaceId: 'family-a', action: 'read' }).userId, 'bob');
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

test('administrator space lists reproduce the displayed user native spaces and platform visibility without changing the actor', async t => {
  const f = await httpFixture(t, { gateway: true });
  f.store.setPlatformAdmin({ userId: 'guest', enabled: true });
  f.store.createUser({ id: 'empty', username: 'synthetic-empty', password });
  f.store.createUser({ id: 'peer-admin', username: 'synthetic-peer-admin', password });
  f.store.setPlatformAdmin({ userId: 'peer-admin', enabled: true });
  f.store.createSpace({ id: 'personal-admin', type: 'personal', ownerId: 'guest' });
  f.store.createSpace({ id: 'family-b', type: 'family', ownerId: 'bob' });
  f.store.createSpace({ id: 'company-b', type: 'company', ownerId: 'bob' });
  // Synthetic compatibility fixture: ownership must remain visible even if its
  // separate membership row is absent.
  f.store.db.prepare("DELETE FROM auth_members WHERE space_id='company-b' AND user_id='bob'").run();
  const actors = Object.fromEntries(await Promise.all(['alice', 'bob', 'guest', 'synthetic-empty', 'synthetic-peer-admin'].map(async username => [username, await f.login(username)])));
  const prefix = '/api/business/account/spaces';
  const read = async (actor, subjectId) => {
    const response = await f.request(prefix + (subjectId === undefined ? '' : `?contextUserId=${encodeURIComponent(subjectId)}`), { headers: { Cookie: actor.cookie } });
    assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
    return response.json();
  };
  const admin = actors.guest, original = await read(admin), version = f.store.policyVersion;
  const nativeSession = f.store.requireNativeSession(admin.cookie.split('=')[1]);
  const snapshot = () => Object.fromEntries(['auth_spaces', 'auth_members', 'auth_resources', 'auth_space_apps', 'auth_grants', 'auth_tokens'].map(table => [table, f.store.db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]));
  const before = snapshot();
  for (const [subjectId, username] of [['bob', 'bob'], ['empty', 'synthetic-empty'], ['alice', 'alice'], ['peer-admin', 'synthetic-peer-admin'], ['guest', 'guest'], ['bob', 'bob']]) {
    const projected = await read(admin, subjectId);
    assert.deepEqual(projected, await read(actors[username]), 'projection equals the displayed account actual native list, including role and deletion metadata');
    assert.deepEqual(projected.catalog, original.catalog, 'display selection retains the complete app catalog');
  }
  const bob = await read(admin, 'bob');
  assert.deepEqual(bob.spaces.map(space => space.id), ['company-b', 'family-a', 'family-b', 'personal-b']);
  assert.equal(bob.spaces.find(space => space.id === 'family-a').role, 'member');
  assert.equal(bob.spaces.find(space => space.id === 'family-a').canDelete, false);
  assert.equal(bob.spaces.find(space => space.id === 'company-b').role, null);
  assert.equal(bob.spaces.find(space => space.id === 'company-b').canDelete, true);
  assert.ok(!bob.spaces.some(space => ['personal-a', 'personal-admin'].includes(space.id)), 'other users personal IDs never bleed into the displayed user list');
  assert.deepEqual((await read(admin, 'empty')).spaces, []);
  assert.deepEqual(await read(admin), original, 'omitting context keeps the administrator own all-space list');
  assert.deepEqual(snapshot(), before); assert.equal(f.store.policyVersion, version);
  assert.deepEqual(f.store.requireNativeSession(admin.cookie.split('=')[1]), nativeSession, 'projection changes neither native actor nor CSRF credential');
});

test('space list display context preserves strict query, native origin, authorization and write refusal paths', async t => {
  const f = await httpFixture(t, { gateway: true, apps: { reminder: { spaces: ['family-a'] } } });
  f.store.setPlatformAdmin({ userId: 'guest', enabled: true });
  const admin = await f.login('guest'), owner = await f.login('alice'), member = await f.login('bob');
  const prefix = '/api/business/account/spaces';
  const read = (actor, suffix = '', headers = {}) => f.request(prefix + suffix, { headers: { ...(actor ? { Cookie: actor.cookie } : {}), ...headers } });
  const snapshot = () => Object.fromEntries(['auth_spaces', 'auth_members', 'auth_resources', 'auth_space_apps', 'auth_grants', 'auth_tokens'].map(table => [table, f.store.db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]));
  const before = snapshot(), version = f.store.policyVersion;
  const baseline = await (await read(member)).json();
  for (const actor of [owner, member]) {
    for (const subjectId of ['alice', 'bob', 'guest', 'missing']) assert.equal((await read(actor, `?contextUserId=${subjectId}`)).status, 403, 'nonadministrators cannot choose even their own display context');
  }
  for (const suffix of ['?userId=alice', '?contextUserId=alice&contextUserId=bob', '?contextUserId=alice&extra=1', '?contextUserId=%2Falice', '/family-a/apps/reminder?contextUserId=alice']) {
    assert.equal((await read(admin, suffix)).status, 400, 'only one context field on the collection or detail GET is accepted');
  }
  for (const subjectId of ['', 'missing']) assert.equal((await read(admin, `?contextUserId=${subjectId}`)).status, 404, 'display subjects must exist');
  assert.equal((await read(null, '?contextUserId=alice')).status, 401);
  assert.equal((await read(admin, '?contextUserId=alice', { Authorization: `Bearer pxa_${'a'.repeat(43)}` })).status, 401);
  assert.equal((await read(admin, '?contextUserId=alice', { Origin: 'https://attacker.example' })).status, 403);
  assert.equal((await read(admin, '?contextUserId=alice', { 'Sec-Fetch-Site': 'cross-site' })).status, 403);
  assert.equal((await read(admin, '?contextUserId=alice')).status, 200);
  const write = (path, input, method = 'POST', headers = {}) => f.json(prefix + path, input, { method, headers: { Cookie: admin.cookie, 'X-CSRF-Token': admin.body.csrfToken, ...headers } });
  assert.equal((await write('?contextUserId=alice', { type: 'personal' })).status, 400, 'display context cannot assign ownership on creation');
  assert.equal((await write('', { type: 'personal', contextUserId: 'alice' })).status, 400, 'write payload allowlists stay unchanged');
  assert.equal((await write('', { type: 'personal' }, 'POST', { 'X-CSRF-Token': 'forged' })).status, 403);
  assert.equal((await write('/family-a/apps/reminder?contextUserId=alice', { enabled: false }, 'PUT')).status, 400);
  assert.equal((await write('/family-a/apps/reminder', { enabled: false }, 'PUT')).status, 403, 'viewing the owner never confers owner mutation rights');
  assert.deepEqual(await (await read(member)).json(), baseline, 'ordinary native lists remain unchanged after accepted and refused administrator reads');
  assert.deepEqual(snapshot(), before); assert.equal(f.store.policyVersion, version, 'display and rejection paths leave authorization policy untouched');
});

test('administrator space contexts reproduce member read models without changing the native actor', async t => {
  const f = await httpFixture(t, { apps: { reminder: { spaces: ['family-a'] } } });
  f.store.setPlatformAdmin({ userId: 'alice', enabled: true });
  for (const { id } of f.store.db.prepare("SELECT id FROM auth_resources WHERE user_id='bob'").all()) f.store.revokeResource(id);
  f.store.grantResource({ userId: 'bob', ...rule('family-a', ['read'], ['synthetic-member-record']) });
  f.store.grantResource({ userId: 'alice', ...rule('family-a', ['update'], ['synthetic-owner-record']) });
  const admin = await f.login('alice'), member = await f.login('bob');
  const prefix = '/api/business/account/spaces/family-a';
  const read = actor => f.request(prefix, { headers: { Cookie: actor.cookie } });
  const response = await read(admin);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const details = await response.json(), memberDetails = await (await read(member)).json();
  assert.ok(!Object.hasOwn(memberDetails, 'userContexts'), 'ordinary members receive no other user contexts');
  assert.deepEqual(details.userContexts.map(context => context.user.id).sort(), ['alice', 'bob']);
  assert.equal(new Set(details.userContexts.map(context => context.user.id)).size, details.userContexts.length, 'member administrator appears once');
  const own = details.userContexts.find(context => context.user.id === 'alice');
  assert.deepEqual(own.user, { id: 'alice', username: 'alice' });
  assert.deepEqual(Object.fromEntries(Object.entries(details).filter(([key]) => key !== 'userContexts')), Object.fromEntries(Object.entries(own).filter(([key]) => key !== 'user')), 'default own projection matches the existing top-level read model');
  const shownMember = details.userContexts.find(context => context.user.id === 'bob');
  assert.deepEqual(Object.fromEntries(Object.entries(shownMember).filter(([key]) => key !== 'user')), memberDetails, 'member display has exactly their actual read model');
  assert.ok(shownMember.permissions.every(permission => permission.userId === 'bob'));
  assert.ok(!shownMember.permissions.some(permission => permission.resources.includes('synthetic-owner-record')));
  assert.equal(shownMember.space.role, 'member'); assert.equal(shownMember.space.canDelete, false);
  assert.equal(shownMember.apps.find(app => app.id === 'reminder').enabled, true);
  assert.equal(shownMember.apps.find(app => app.id === 'intelligence').enabled, false);
  for (const secret of [password, 'password_hash', 'sessionToken', 'access_token', admin.body.csrfToken]) assert.ok(!JSON.stringify(details).includes(secret));
  const session = f.store.requireNativeSession(admin.cookie.split('=')[1]);
  assert.equal(session.user.id, 'alice'); assert.equal(session.csrfToken, admin.body.csrfToken);
  assert.ok(f.store.userPermissions('alice', 'family-a', 'reminder', 'delete').includes('*'), 'viewing a member does not reduce the administrator own business grants');
  assert.deepEqual(f.store.userPermissions('bob', 'family-a', 'reminder', 'read'), ['synthetic-member-record']);
  assert.deepEqual(f.store.userPermissions('bob', 'family-a', 'reminder', 'delete'), [], 'member retains only their own actions');
});

test('a nonmember administrator can inspect owner context but cannot act with the displayed owner grants', async t => {
  const f = await httpFixture(t, { apps: { reminder: { spaces: ['family-a'] } } });
  f.store.setPlatformAdmin({ userId: 'guest', enabled: true });
  const admin = await f.login('guest'), owner = await f.login('alice'), member = await f.login('bob');
  const prefix = '/api/business/account/spaces/family-a';
  const read = actor => f.request(prefix, { headers: { Cookie: actor.cookie } });
  const details = await (await read(admin)).json();
  assert.deepEqual(details.userContexts.map(context => context.user.id).sort(), ['alice', 'bob', 'guest']);
  const own = details.userContexts.find(context => context.user.id === 'guest');
  assert.equal(own.space.role, null); assert.equal(own.space.canDelete, true);
  assert.deepEqual(own.permissions, [], 'administrator status supplies no member resource permissions');
  const shownOwner = details.userContexts.find(context => context.user.id === 'alice');
  assert.equal(shownOwner.space.role, 'owner'); assert.equal(shownOwner.space.canDelete, true);
  assert.deepEqual(Object.fromEntries(Object.entries(shownOwner).filter(([key]) => key !== 'user')), await (await read(owner)).json());
  const before = Object.fromEntries(['auth_members', 'auth_resources', 'auth_space_apps'].map(table => [table, f.store.db.prepare(`SELECT * FROM ${table}`).all()]));
  const write = (actor, suffix, input, method = 'POST') => f.json(prefix + suffix, input, { method, headers: { Cookie: actor.cookie, 'X-CSRF-Token': actor.body.csrfToken } });
  assert.equal((await write(admin, '/apps/reminder', { enabled: false }, 'PUT')).status, 403);
  assert.equal((await write(admin, '/members', { username: 'guest', role: 'member' })).status, 403);
  assert.equal((await write(admin, '/permissions', { userId: 'guest', appId: 'reminder', resources: ['synthetic-forbidden-record'], actions: ['read'] })).status, 403);
  assert.equal((await write(admin, '/members/bob', undefined, 'DELETE')).status, 403);
  assert.deepEqual(f.store.userPermissions('guest', 'family-a', 'reminder', 'read'), [], 'owner preview confers no business authority');
  for (const actor of [admin, member]) assert.equal((await f.request(prefix + '?userId=alice', { headers: { Cookie: actor.cookie } })).status, 400, 'display identity cannot be supplied as a new query authority');
  assert.equal((await write(owner, '/apps/reminder', { enabled: false, userId: 'guest' }, 'PUT')).status, 400, 'write payloads retain their existing allowlist');
  assert.deepEqual(Object.fromEntries(['auth_members', 'auth_resources', 'auth_space_apps'].map(table => [table, f.store.db.prepare(`SELECT * FROM ${table}`).all()])), before, 'all rejected requests leave policy unchanged');
  const session = f.store.requireNativeSession(admin.cookie.split('=')[1]);
  assert.equal(session.user.id, 'guest'); assert.equal(session.csrfToken, admin.body.csrfToken);
  assert.ok(!Object.hasOwn(await (await read(member)).json(), 'userContexts'));
  f.store.setMembership({ spaceId: 'family-a', userId: 'bob', role: null });
  assert.ok(!(await (await read(admin)).json()).userContexts.some(context => context.user.id === 'bob'), 'removed members disappear on refresh');
});

test('space catalog includes every installed app and retains business adapter IDs and operation ceilings', async t => {
  const f = await httpFixture(t, { apps: { reminder: { spaces: [] }, slides: { spaces: [] } }, gateway: true });
  const owner = await f.login('alice'), prefix = '/api/business/account/spaces';
  const read = path => f.request(prefix + path, { headers: { Cookie: owner.cookie } });
  const call = (path, input, method = 'POST') => f.json(prefix + path, input, { method, headers: { Cookie: owner.cookie, 'X-CSRF-Token': owner.body.csrfToken } });
  const { catalog } = await (await read('')).json();
  assert.equal(catalog.length, 13);
  assert.deepEqual(catalog.map(app => app.webAppId), f.store.registry.apps.map(app => app.id));
  assert.equal(new Set(catalog.map(app => app.id)).size, 13);
  for (const app of catalog) {
    const declared = f.store.registry.getApp(app.webAppId), business = declared.integration.business;
    assert.equal(app.id, business?.adapterId || declared.id);
    assert.equal(app.name, declared.name);
    assert.equal(app.supportsBusinessActions, Boolean(business));
    assert.deepEqual(app.actions, business?.actions || []);
    assert.equal(app.entryPolicy, declared.integration.web.policy);
  }
  assert.deepEqual(catalog.filter(app => app.businessAvailable).map(app => app.id).sort(), ['reminder', 'slides']);
  const slide = catalog.find(app => app.id === 'slides');
  assert.equal(slide.webAppId, 'lattice-slides'); assert.equal(slide.enrollmentAllowed, true);
  assert.equal(catalog.find(app => app.id === 'knowledge').enrollmentAllowed, false, 'unconfigured business backend remains unavailable');
  for (const id of ['intelligence', 'calendar', 'matrix-reader']) assert.equal(catalog.find(app => app.id === id).enrollmentAllowed, true);
  for (const id of ['polaris', 'letters', 'profiles']) assert.equal(catalog.find(app => app.id === id).enrollmentAllowed, false);
  const space = await (await call('', { type: 'family' })).json(), path = `/${space.id}`;
  const details = await (await read(path)).json();
  assert.deepEqual(details.apps.map(({ enabled, availableActions, availableResources, ...app }) => app), catalog);
  assert.ok(details.apps.every(app => app.enabled === false));
  assert.ok(details.apps.every(app => !app.availableActions.length && !app.availableResources.length), 'new space has no effective business access');
  for (const id of ['knowledge', 'polaris', 'letters', 'profiles', 'unknown', 'lattice-slides', '__proto__']) {
    assert.equal((await call(path + `/apps/${id}`, { enabled: true }, 'PUT')).status, 403);
    assert.equal(f.store.db.prepare('SELECT COUNT(*) AS n FROM auth_space_apps WHERE space_id=?').get(space.id).n, 0, 'rejected enrollment has no side effect');
  }
});

test('non-business space enrollment grants current members web entry without resource or agent authority', async t => {
  const apps = { reminder: { spaces: [] } }, f = await httpFixture(t, { apps, gateway: true });
  const owner = await f.login('alice'), member = await f.login('bob'), outsider = await f.login('guest');
  const prefix = '/api/business/account/spaces';
  const call = (actor, path, input, method = 'POST') => f.json(prefix + path, input, { method, headers: { Cookie: actor.cookie, 'X-CSRF-Token': actor.body.csrfToken } });
  const web = async actor => {
    const response = await f.request('/api/business/web-access', { headers: { Cookie: actor.cookie } });
    assert.equal(response.status, 200); return response.json();
  };
  const space = await (await call(owner, '', { type: 'family' })).json(), path = `/${space.id}`;
  assert.deepEqual((await web(owner)).apps, []); assert.deepEqual((await web(member)).apps, []);
  for (const appId of ['intelligence', 'calendar', 'matrix-reader']) {
    assert.equal((await call(owner, path + `/apps/${appId}`, { enabled: true }, 'PUT')).status, 200);
  }
  const entries = ['calendar', 'intelligence', 'matrix-reader'];
  assert.deepEqual((await web(owner)).apps, entries);
  assert.deepEqual((await web(member)).apps, [], 'a non-member receives no entry');
  assert.equal((await call(owner, path + '/members', { username: 'bob', role: 'member' })).status, 201);
  assert.deepEqual((await web(member)).apps, entries); assert.deepEqual((await web(outsider)).apps, []);
  assert.equal((await call(member, path + '/apps/intelligence', { enabled: false }, 'PUT')).status, 403);
  const restored = new AuthStore({ file: f.file, issuer });
  try {
    restored.configureWebAccessBoundary({ enabled: true, apps });
    assert.equal(restored.appSpaceEnabled('intelligence', space.id), true);
    assert.deepEqual(restored.currentWebApps('bob'), entries, 'member entries survive policy restart');
  } finally { restored.close(); }
  const before = f.store.db.prepare('SELECT COUNT(*) AS n FROM auth_resources').get().n;
  assert.equal((await call(owner, path + '/permissions', { userId: 'bob', appId: 'intelligence', actions: ['read'], resources: ['*'] })).status, 400);
  assert.equal(f.store.db.prepare('SELECT COUNT(*) AS n FROM auth_resources').get().n, before);
  assert.deepEqual(f.store.userPermissions('bob', space.id, 'intelligence', 'read'), []);
  assert.ok(f.store.availableRules('bob').every(rule => rule.appId !== 'intelligence'));
  assert.throws(() => f.store.createGrant({ userId: 'bob', clientId: 'agent-a', rules: [rule(space.id, ['read'], ['*'], 'intelligence')] }), { status: 400 });
  assert.equal((await call(owner, path + '/apps/intelligence', { enabled: false }, 'PUT')).status, 200);
  assert.deepEqual((await web(member)).apps, entries.filter(id => id !== 'intelligence'));
  assert.equal((await call(owner, path + '/members/bob', undefined, 'DELETE')).status, 200);
  assert.deepEqual((await web(member)).apps, [], 'membership removal withdraws all membership-derived entries');
  assert.deepEqual((await web(owner)).apps, entries.filter(id => id !== 'intelligence'));
  f.store.setWebAccess({ userId: 'bob', apps: ['intelligence'], prds: false });
  assert.deepEqual((await web(member)).apps, ['intelligence'], 'administrator entry policy remains independent and backward compatible');
  const personal = await (await call(owner, '', { type: 'personal' })).json();
  assert.equal((await call(owner, `/${personal.id}/apps/calendar`, { enabled: true }, 'PUT')).status, 200);
  assert.equal((await call(owner, `/${personal.id}/members`, { username: 'bob', role: 'member' })).status, 403);
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

test('space deletion requires exact confirmation and creator or platform administration, with native request safeguards', async t => {
  const f = await httpFixture(t, { gateway: true });
  const owner = await f.login('alice'), member = await f.login('bob'), outsider = await f.login('guest');
  const prefix = '/api/business/account/spaces';
  const read = (actor, path = '') => f.request(prefix + path, { headers: { Cookie: actor.cookie } });
  const remove = (actor, id, input = { confirmSpaceId: id }, headers = {}) => f.json(`${prefix}/${id}`, input, {
    method: 'DELETE', headers: { Cookie: actor.cookie, 'X-CSRF-Token': actor.body.csrfToken, ...headers },
  });
  const autoUser = f.store.registerUser({ username: 'protected-personal-owner', password });
  const autoSpace = f.store.ensurePersonalSpace(autoUser.id);
  const autoOwner = await f.login(autoUser.username);
  const before = f.store.db.prepare('SELECT * FROM auth_spaces ORDER BY id').all();
  for (const input of [{}, { confirmSpaceId: 'company-a' }, { confirmSpaceId: true }, { confirmSpaceId: 'family-a', ownerId: 'alice' }]) {
    assert.equal((await remove(owner, 'family-a', input)).status, 400);
  }
  assert.equal((await remove(member, 'family-a')).status, 403);
  f.store.setMembership({ spaceId: 'family-a', userId: 'bob', role: 'admin' });
  assert.equal((await remove(member, 'family-a')).status, 403, 'space administrator is not the creator');
  assert.equal((await remove(outsider, 'family-a')).status, 404);
  assert.equal((await remove(owner, 'family-a', undefined, { 'X-CSRF-Token': 'forged' })).status, 403);
  assert.equal((await remove(owner, 'family-a', undefined, { Origin: 'https://attacker.example' })).status, 403);
  assert.equal((await remove(owner, 'family-a', undefined, { Authorization: `Bearer pxa_${'a'.repeat(43)}` })).status, 401);
  assert.equal((await f.json(`${prefix}/family-a`, { confirmSpaceId: 'family-a' }, { method: 'DELETE' })).status, 401);
  const personal = await remove(autoOwner, autoSpace.id);
  assert.equal(personal.status, 409); assert.equal((await personal.json()).error, 'PERSONAL_SPACE_REQUIRED');
  assert.deepEqual(f.store.db.prepare('SELECT * FROM auth_spaces ORDER BY id').all(), before, 'rejected requests leave every space intact');
  assert.equal((await (await read(owner)).json()).spaces.find(space => space.id === 'family-a').canDelete, true);
  assert.equal((await (await read(member)).json()).spaces.find(space => space.id === 'family-a').canDelete, false);
  assert.equal((await (await read(owner)).json()).spaces.find(space => space.id === 'personal-a').canDelete, true);
  // Synthetic compatibility fixture: ownership, rather than a second role gate,
  // determines who created this space.
  f.store.db.prepare("UPDATE auth_members SET role='member' WHERE space_id='family-a' AND user_id='alice'").run();
  assert.equal((await remove(owner, 'family-a')).status, 200);
  assert.equal((await read(owner, '/family-a')).status, 404);
  assert.ok(!(await (await read(owner)).json()).spaces.some(space => space.id === 'family-a'));
  f.store.setPlatformAdmin({ userId: 'guest', enabled: true });
  const listed = (await (await read(outsider)).json()).spaces;
  assert.equal(listed.find(space => space.id === 'company-a').canDelete, true);
  assert.equal(listed.find(space => space.id === 'personal-b').canDelete, true);
  assert.equal((await read(outsider, '/company-a')).status, 200);
  assert.equal((await remove(outsider, autoSpace.id)).status, 409);
  assert.equal((await remove(outsider, 'personal-b')).status, 200);
  assert.equal((await remove(outsider, 'company-a')).status, 200, 'platform administrator can delete a foreign space');
  assert.equal((await remove(outsider, 'company-a')).status, 404);
  assert.ok(f.store.db.prepare("SELECT 1 FROM auth_spaces WHERE id=?").get(autoSpace.id));
});

test('space deletion atomically removes all authorization slices and derived entries while preserving other spaces and users', t => {
  const f = fixture(t), store = f.store;
  const apps = { reminder: { spaces: ['family-a', 'company-a'] } };
  store.configureWebAccessBoundary({ enabled: true, apps });
  store.setWebAccess({ userId: 'bob', apps: ['reminder'], prds: false });
  store.setWebAccess({ userId: 'guest', apps: ['matrix-reader'], prds: true });
  const space = store.createSelfServiceSpace({ type: 'family', ownerId: 'alice' });
  store.setMembership({ spaceId: space.id, userId: 'bob', role: 'member' });
  for (const appId of ['reminder', 'intelligence', 'calendar']) store.setSpaceAppEnrollment({ spaceId: space.id, appId, enabled: true });
  store.grantResource({ userId: 'bob', ...rule(space.id, ['read'], ['synthetic-record']) });
  store.grantResource({ userId: 'guest', ...rule(space.id, ['read'], ['synthetic-shared-record']) });
  const only = f.grant('bob', [rule(space.id, ['read'], ['synthetic-record'])]);
  const mixed = f.grant('bob', [rule(space.id, ['read'], ['synthetic-record']), rule('family-a', ['read'], ['other-record'])]);
  const expired = f.grant('bob', [rule(space.id, ['read'], ['synthetic-record'])]);
  const revoked = f.grant('bob', [rule(space.id, ['read'], ['synthetic-record'])]);
  store.db.prepare('UPDATE auth_grants SET expires_at=? WHERE id=?').run(f.clock.now - 1, expired.id);
  store.revokeGrant(revoked.id);
  const onlyTokens = store.tokenPair(only.id), mixedTokens = store.tokenPair(mixed.id);
  const session = store.login({ username: 'bob', password });
  const consent = store.createConsent(session.sessionToken, [rule(space.id, ['read'], ['synthetic-record'])], 'synthetic-delete');
  const verifier = 'synthetic-delete-verifier-'.repeat(3);
  const request = { clientId: 'agent-a', redirectUri: 'https://client.example/callback', challenge: hashVerifier(verifier), resource: store.resource, requested: { reminder: ['read'] } };
  const onlyCode = store.createAuthorizationCode({ request, userId: 'bob', rules: [rule(space.id, ['read'], ['synthetic-record'])] });
  const mixedCode = store.createAuthorizationCode({ request, userId: 'bob', rules: [rule(space.id, ['read'], ['synthetic-record']), rule('family-a', ['read'], ['other-record'])] });
  const unrelated = {
    users: store.db.prepare('SELECT * FROM auth_users ORDER BY id').all(),
    web: store.db.prepare('SELECT * FROM auth_web_access ORDER BY user_id').all(),
    members: store.db.prepare('SELECT * FROM auth_members WHERE space_id<>? ORDER BY space_id,user_id').all(space.id),
    resources: store.db.prepare('SELECT * FROM auth_resources WHERE space_id<>? ORDER BY id').all(space.id),
  };
  assert.deepEqual(store.currentWebApps('bob'), ['calendar', 'intelligence', 'reminder']);
  let observedCommit = false;
  const off = store.onChange(() => {
    assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM auth_spaces WHERE id=?').get(space.id).n, 0);
    assert.ok(store.db.prepare('SELECT rules FROM auth_grants').all().every(row => JSON.parse(row.rules).every(rule => rule.spaceId !== space.id)));
    observedCommit = true;
  });
  store.deleteSpace({ spaceId: space.id, actorId: 'alice', confirmSpaceId: space.id });
  off(); assert.equal(observedCommit, true, 'observers see the committed cascade, never an intermediate policy');
  for (const table of ['auth_members', 'auth_resources', 'auth_space_apps', 'auth_self_service_spaces']) {
    assert.equal(store.db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE space_id=?`).get(space.id).n, 0, table);
  }
  for (const grant of store.db.prepare('SELECT rules FROM auth_grants').all()) assert.ok(JSON.parse(grant.rules).every(rule => rule.spaceId !== space.id));
  for (const id of [only.id, expired.id, revoked.id, onlyCode.grantId]) {
    const row = store.db.prepare('SELECT rules,revoked_at FROM auth_grants WHERE id=?').get(id);
    assert.deepEqual(JSON.parse(row.rules), []); assert.notEqual(row.revoked_at, null);
  }
  assert.deepEqual(store.currentWebApps('bob'), ['reminder'], 'only enrollment-derived entries disappear');
  assert.deepEqual(store.currentWebApps('guest'), ['matrix-reader'], 'independent administrator entry remains');
  assert.deepEqual(store.userPermissions('bob', space.id, 'reminder', 'read'), []);
  assert.throws(() => store.authenticate(onlyTokens.access_token), { status: 401 });
  assert.throws(() => store.refresh({ refreshToken: onlyTokens.refresh_token, clientId: 'agent-a', resource: store.resource }));
  assert.throws(() => store.authorize(mixedTokens.access_token, { appId: 'reminder', spaceId: space.id, action: 'read', resourceId: 'synthetic-record' }), { status: 403 });
  assert.equal(store.authorize(mixedTokens.access_token, { appId: 'reminder', spaceId: 'family-a', action: 'read', resourceId: 'other-record' }).userId, 'bob');
  assert.ok(store.listSpaces(mixedTokens.access_token).every(item => item.id !== space.id));
  assert.throws(() => store.createGrant({ userId: 'bob', clientId: 'agent-a', rules: store.consentRules(session.sessionToken, { consent, rule_0: '1' }, 'synthetic-delete') }), { status: 403 });
  const exchange = code => store.exchangeCode({ code, clientId: 'agent-a', redirectUri: request.redirectUri, verifier, resource: store.resource });
  assert.throws(() => exchange(onlyCode.code));
  const exchanged = exchange(mixedCode.code);
  assert.equal(store.authorize(exchanged.access_token, { appId: 'reminder', spaceId: 'family-a', action: 'read', resourceId: 'other-record' }).userId, 'bob');
  assert.deepEqual(store.db.prepare('SELECT * FROM auth_users ORDER BY id').all(), unrelated.users);
  assert.deepEqual(store.db.prepare('SELECT * FROM auth_web_access ORDER BY user_id').all(), unrelated.web);
  assert.deepEqual(store.db.prepare('SELECT * FROM auth_members WHERE space_id<>? ORDER BY space_id,user_id').all(space.id), unrelated.members);
  assert.deepEqual(store.db.prepare('SELECT * FROM auth_resources WHERE space_id<>? ORDER BY id').all(space.id), unrelated.resources);
  const restored = f.reopen();
  restored.configureWebAccessBoundary({ enabled: true, apps });
  assert.deepEqual(restored.currentWebApps('bob'), ['reminder']);
  assert.equal(restored.db.prepare('SELECT COUNT(*) AS n FROM auth_spaces WHERE id=?').get(space.id).n, 0);
  assert.throws(() => restored.authenticate(onlyTokens.access_token), { status: 401 });
  assert.equal(restored.authorize(mixedTokens.access_token, { appId: 'reminder', spaceId: 'family-a', action: 'read', resourceId: 'other-record' }).userId, 'bob');
});

test('a failed space cascade rolls back policy, references, audit and notifications together', t => {
  const f = fixture(t), store = f.store;
  store.setSpaceAppEnrollment({ spaceId: 'family-a', appId: 'intelligence', enabled: true });
  const grant = f.grant('bob', [rule('family-a', ['read'])]), token = store.issueToken({ grantId: grant.id }).accessToken;
  const tables = ['auth_spaces', 'auth_members', 'auth_resources', 'auth_grants', 'auth_tokens', 'auth_space_apps', 'auth_audit', 'auth_meta'];
  const snapshot = () => Object.fromEntries(tables.map(table => [table, store.db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]));
  const before = snapshot(); let notifications = 0;
  store.onChange(() => notifications++);
  store.db.exec("CREATE TEMP TRIGGER synthetic_delete_failure BEFORE DELETE ON auth_spaces BEGIN SELECT RAISE(ABORT,'synthetic rollback'); END");
  assert.throws(() => store.deleteSpace({ spaceId: 'family-a', actorId: 'alice', confirmSpaceId: 'family-a' }), /synthetic rollback/);
  assert.deepEqual(snapshot(), before);
  assert.equal(notifications, 0);
  assert.equal(store.authorize(token, { appId: 'reminder', spaceId: 'family-a', action: 'read' }).userId, 'bob');
  store.db.exec('DROP TRIGGER synthetic_delete_failure');
  store.deleteSpace({ spaceId: 'family-a', actorId: 'alice', confirmSpaceId: 'family-a' });
  assert.ok(notifications > 0);
  assert.throws(() => store.authenticate(token), { status: 401 });
});

test('space deletion serializes with an existing cross-connection business policy lease', async t => {
  const f = fixture(t), other = new AuthStore({ file: f.file, issuer, clock: () => f.clock.now, busyTimeoutMs: 1 });
  t.after(() => other.close());
  await f.store.withPolicyLease(async () => {
    assert.throws(() => other.deleteSpace({ spaceId: 'family-a', actorId: 'alice', confirmSpaceId: 'family-a' }), { status: 503, code: 'POLICY_BUSY' });
    assert.ok(f.store.db.prepare("SELECT 1 FROM auth_spaces WHERE id='family-a'").get());
  });
  other.deleteSpace({ spaceId: 'family-a', actorId: 'alice', confirmSpaceId: 'family-a' });
  assert.equal(f.store.db.prepare("SELECT COUNT(*) AS n FROM auth_spaces WHERE id='family-a'").get().n, 0);
});

test('deleted spaces remain denied despite stale static app configuration and resource identifiers', t => {
  const f = fixture(t), apps = { reminder: { spaces: ['family-a', 'company-a'] } };
  f.store.configureWebAccessBoundary({ enabled: true, apps });
  f.store.setWebAccess({ userId: 'alice', apps: ['reminder'], prds: false });
  const session = f.store.login({ username: 'alice', password });
  const token = f.token('alice', [rule('family-a', ['read']), rule('company-a', ['read'])]);
  f.store.deleteSpace({ spaceId: 'family-a', actorId: 'alice', confirmSpaceId: 'family-a' });
  assert.equal(f.store.appSpaceEnabled('reminder', 'family-a', apps), false);
  for (const credential of [token, session.sessionToken]) {
    assert.throws(() => f.store.authorize(credential, { appId: 'reminder', spaceId: 'family-a', action: 'read', resourceId: 'synthetic-old-record' }), { status: 403 });
    assert.ok(f.store.listSpaces(credential).every(space => space.id !== 'family-a'));
    assert.equal(f.store.authorize(credential, { appId: 'reminder', spaceId: 'company-a', action: 'read' }).userId, 'alice');
  }
  assert.deepEqual(f.store.availableRules('alice').filter(rule => rule.spaceId === 'family-a'), []);
});

test('authentication initial HTML honors persisted locale, explicit language and localized validation retries', async t => {
  const f = await httpFixture(t);
  for (const locale of ['en', 'zh']) for (const path of ['/auth/login', '/auth/register']) {
    const response = await f.request(path, { headers: { Cookie: `praxis_locale=${locale}` } });
    const html = await response.text();
    assert.equal(response.status, 200);
    assert.match(html, new RegExp(`<html lang="${locale === 'zh' ? 'zh-CN' : 'en'}">`));
    const choice = locale === 'zh' ? 'en' : 'zh';
    const explicit = await f.request(path + '?lang=' + choice, { headers: { Cookie: `praxis_locale=${locale}` } });
    assert.match(await explicit.text(), new RegExp(`<html lang="${choice === 'zh' ? 'zh-CN' : 'en'}">`));
    assert.match(explicit.headers.get('set-cookie'), new RegExp(`^praxis_locale=${choice};`));
  }
  const retry = await f.request('/auth/login', { method: 'POST', headers: { Origin: issuer, Cookie: 'praxis_locale=zh', 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ username: 'unknown-synthetic', password, return_to: '/' }).toString() });
  assert.equal(retry.status, 401);
  assert.match(await retry.text(), /账号或密码不正确，请重新输入。/);
});

const sseStreams = new WeakMap();
function sseStream(response) {
  let stream = sseStreams.get(response);
  if (stream) return stream;
  stream = { events: [], reader: response.body.getReader(), done: false };
  sseStreams.set(response, stream);
  (async () => {
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
      const { done, value } = await stream.reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let index;
      while ((index = buffer.indexOf('\n\n')) >= 0) {
        const frame = buffer.slice(0, index); buffer = buffer.slice(index + 2);
        const event = {};
        for (const line of frame.split('\n')) {
          if (line.startsWith(':')) continue;
          const separator = line.indexOf(': ');
          if (separator < 0) continue;
          const key = line.slice(0, separator), value = line.slice(separator + 2);
          if (key === 'event') event.type = value;
          else if (key === 'data') event.data = JSON.parse(value);
        }
        if (event.type) stream.events.push(event);
      }
    }
  })().catch(() => {}).finally(() => { stream.done = true; });
  return stream;
}
async function readSseEvents(response, { until, timeoutMs = 4000 } = {}) {
  const stream = sseStream(response);
  const deadline = Date.now() + timeoutMs, collected = [];
  const matched = () => !until || collected.some(event => event.type === until);
  while (Date.now() < deadline && !stream.done && !matched()) {
    const pending = stream.events.length;
    if (pending) collected.push(...stream.events.splice(0, pending));
    else await new Promise(resolve => setTimeout(resolve, 10));
  }
  collected.push(...stream.events.splice(0, stream.events.length));
  return collected;
}

test('session events stream relevant policy and app changes and stop on session loss', async t => {
  const f = await httpFixture(t, { core: true, pollMs: 40 });
  f.store.setWebAccess({ userId: 'alice', apps: ['reminder'], prds: true });
  const login = await f.login();
  const outsider = await f.login('guest');
  const response = await f.request('/api/business/session-events', { headers: { Cookie: login.cookie } });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /^text\/event-stream/);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const [ready] = await readSseEvents(response, { until: 'ready' });
  assert.equal(ready.type, 'ready');
  assert.equal(ready.data.policyVersion, f.store.policyVersion);
  assert.equal(ready.data.cursor, f.events.cursor());
  assert.equal(typeof ready.data.cursor, 'number');
  // Policy change in a watched space reaches the session; unrelated spaces stay private.
  f.store.grantResource({ userId: 'bob', ...rule('personal-b', ['read'], ['personal-record']) });
  f.store.grantResource({ userId: 'bob', ...rule('family-a', ['read'], ['shared-record']) });
  const policyEvents = await readSseEvents(response, { until: 'policy' });
  assert.equal(policyEvents.filter(event => event.type === 'policy').length, 1, 'unrelated space events are filtered');
  assert.equal(policyEvents.at(-1).data.type, 'resource');
  assert.equal(policyEvents.at(-1).data.version, f.store.policyVersion);
  // App data events reach readers of the app and space, and omit record-level detail.
  f.events.ingest('reminder', 'personal-b', { cursor: 3, events: [{ id: 'p1', resourceId: 'personal-record', revision: '1', operation: 'change', cursor: 3 }] });
  f.events.ingest('reminder', 'family-a', { cursor: 5, events: [{ id: 'f1', resourceId: 'shared-record', revision: '1', operation: 'change', cursor: 5 }] });
  const changeEvents = await readSseEvents(response, { until: 'change' });
  assert.deepEqual(changeEvents.filter(event => event.type === 'change').map(event => event.data), [{ appId: 'reminder', spaceId: 'family-a' }]);
  // A second session for a guest without family access receives no typed event
  // for it; the anonymous version catch-up carries no identifiers.
  const guestResponse = await f.request('/api/business/session-events', { headers: { Cookie: outsider.cookie } });
  await readSseEvents(guestResponse, { until: 'ready' });
  f.store.grantResource({ userId: 'bob', ...rule('family-a', ['update'], ['shared-record']) });
  const guestEvents = await readSseEvents(guestResponse, { timeoutMs: 400 });
  assert.deepEqual(guestEvents.filter(event => event.type === 'policy' && event.data.type !== 'policy'), []);
  assert.deepEqual(guestEvents.filter(event => event.type === 'change'), []);
  // Session loss degrades the stream to a final revoked event.
  f.store.resetPassword({ userId: 'alice', password });
  const revoked = await readSseEvents(response, { until: 'revoked', timeoutMs: 3000 });
  assert.equal(revoked.at(-1).type, 'revoked');
  assert.equal((await f.request('/api/business/session-events')).status, 401);
  assert.equal((await f.request('/api/business/session-events?after=1', { headers: { Cookie: login.cookie } })).status, 400);
});
