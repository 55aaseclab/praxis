import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AuthStore, createAuthHandler } from '../src/business/auth.mjs';
import { createAccountHandler, createAdminHandler } from '../src/business/admin.mjs';

const password = 'Synthetic-space-context-password-2026';
const rule = (spaceId, appId, actions, resources) => ({ spaceId, appId, actions, resources });

async function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'praxis-space-context-'));
  let auth, handlers;
  const server = createServer(async (request, response) => {
    for (const handler of handlers) if (await handler(request, response)) return;
    response.writeHead(404).end();
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  auth = new AuthStore({ file: join(directory, 'auth.sqlite'), issuer: origin });
  t.after(async () => {
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    auth.close(); rmSync(directory, { recursive: true, force: true });
  });
  for (const id of ['owner', 'reader', 'editor', 'outsider']) auth.createUser({ id, username: `synthetic-${id}`, password });
  auth.setPlatformAdmin({ userId: 'owner', enabled: true });
  const space = auth.createSelfServiceSpace({ type: 'family', ownerId: 'owner' });
  const other = auth.createSelfServiceSpace({ type: 'family', ownerId: 'owner' });
  const apps = { slides: { spaces: [space.id, other.id] }, tingproof: { spaces: [space.id, other.id] } };
  handlers = [createAuthHandler({ store: auth, apps, webGateway: { enabled: true } }), createAccountHandler({ auth }), createAdminHandler({ auth })];
  for (const target of [space, other]) {
    for (const userId of ['reader', 'editor']) auth.setMembership({ spaceId: target.id, userId, role: 'member' });
    for (const appId of ['slides', 'tingproof']) auth.setSpaceAppEnrollment({ spaceId: target.id, appId, enabled: true }, apps);
  }
  auth.grantResource({ userId: 'reader', ...rule(space.id, 'slides', ['read'], ['synthetic-read-record']) });
  auth.grantResource({ userId: 'editor', ...rule(space.id, 'slides', ['read', 'update'], ['synthetic-edit-record']) });
  auth.grantResource({ userId: 'reader', ...rule(space.id, 'tingproof', ['read'], ['synthetic-proof']) });
  auth.grantResource({ userId: 'reader', ...rule(other.id, 'slides', ['read'], ['synthetic-other-record']) });
  auth.createClient({ id: 'synthetic-context-agent', name: 'Synthetic context agent', redirectUris: ['https://synthetic.example/callback'] });
  const grant = (userId, rules, options = {}) => auth.createGrant({ userId, clientId: 'synthetic-context-agent', rules, ...options });
  const login = async userId => {
    const response = await fetch(`${origin}/auth/login`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ username: `synthetic-${userId}`, password }) });
    assert.equal(response.status, 200);
    const body = await response.json();
    return { cookie: response.headers.get('set-cookie').split(';')[0], csrfToken: body.csrfToken };
  };
  const request = (actor, path, { method = 'GET', headers = {}, ...options } = {}) => fetch(`${origin}${path}`, { method, headers: { Cookie: actor.cookie, Origin: origin, ...(method === 'GET' ? {} : { 'X-CSRF-Token': actor.csrfToken }), ...headers }, ...options });
  const detail = async (actor, context) => {
    const response = await request(actor, `/api/business/account/spaces/${space.id}${context ? `?contextUserId=${context}` : ''}`);
    assert.equal(response.status, 200); return response.json();
  };
  return { auth, space, other, grant, login, request, detail, origin };
}

test('Spaces display projections match actual member data while delegation capabilities use the acting session', async t => {
  const f = await fixture(t);
  const readerRule = rule(f.space.id, 'slides', ['read'], ['synthetic-read-record']);
  const readerGrant = f.grant('reader', [readerRule]);
  const editorGrant = f.grant('editor', [rule(f.space.id, 'slides', ['update'], ['synthetic-edit-record'])]);
  // The app and space occur in different rules: this must never appear as a
  // Slides delegation for the current space.
  const crossed = f.grant('reader', [rule(f.space.id, 'tingproof', ['read'], ['synthetic-proof']), rule(f.other.id, 'slides', ['read'], ['synthetic-other-record'])]);
  const owner = await f.login('owner'), reader = await f.login('reader'), editor = await f.login('editor');
  const projected = (await f.detail(owner, 'reader')).userContext, actual = await f.detail(reader);
  for (const field of ['apps', 'permissions', 'members']) assert.deepEqual(projected[field], actual[field], `${field} matches the selected user's actual session`);
  const readerApp = projected.apps.find(app => app.id === 'slides');
  assert.deepEqual(readerApp.availableActions, ['read']);
  assert.deepEqual(readerApp.availableResources, ['synthetic-read-record']);
  const editorContext = (await f.detail(owner, 'editor')).userContext;
  assert.deepEqual(editorContext.apps, (await f.detail(editor)).apps);
  const editorApp = editorContext.apps.find(app => app.id === 'slides');
  assert.deepEqual([...editorApp.availableActions].sort(), ['read', 'update']);
  assert.deepEqual(editorApp.availableResources, ['synthetic-edit-record']);
  assert.notDeepEqual(readerApp, editorApp, 'switching users yields distinct action/resource summaries');
  const readerRows = projected.delegations.filter(grant => grant.scopes.some(scope => scope.appId === 'slides'));
  assert.deepEqual(readerRows.map(row => row.id), [readerGrant.id], 'matching requires the same raw app/space rule');
  assert.equal(projected.delegations.some(row => row.id === editorGrant.id), false, 'member projection excludes another member grants');
  const crossRow = projected.delegations.find(row => row.id === crossed.id);
  assert.deepEqual(crossRow.spaceIds, [f.space.id], 'a space projection does not reveal unrelated grant spaces');
  assert.deepEqual(crossRow.scopes.map(scope => scope.appId), ['tingproof']);
  assert.equal(readerRows[0].canRevoke, true, 'acting administrator can revoke the selected member grant');
  assert.equal(actual.delegations.find(row => row.id === readerGrant.id).canRevoke, true, 'ordinary member may revoke their own grant');
  const own = await f.detail(owner);
  assert.equal(own.delegations.find(row => row.id === editorGrant.id).canRevoke, true, 'owner administrator can manage visible member grants');
  const serialized = JSON.stringify(projected.delegations);
  assert.doesNotMatch(serialized, /accessToken|refreshToken|sessionToken|csrfToken|password|synthetic-other-record/);
  const outsider = (await f.detail(owner, 'outsider')).userContext;
  assert.deepEqual(outsider.apps.find(app => app.id === 'slides').availableActions, []);
  assert.deepEqual(outsider.permissions, []); assert.deepEqual(outsider.delegations, []);
  assert.equal((await f.request(reader, `/api/business/account/spaces/${f.space.id}?contextUserId=editor`)).status, 403, 'ordinary session cannot borrow display context');
  assert.equal((await f.request(owner, `/api/business/account/spaces/${f.space.id}?contextUserId=reader`, { headers: { Authorization: 'Bearer synthetic-invalid' } })).status, 401, 'display reads retain native-cookie requirement');
  f.auth.setPlatformAdmin({ userId: 'outsider', enabled: true });
  f.auth.setPlatformAdmin({ userId: 'owner', enabled: false });
  const ordinaryOwner = await f.login('owner');
  const ownerView = await f.detail(ordinaryOwner);
  assert.equal(ownerView.delegations.find(row => row.id === readerGrant.id).canRevoke, false, 'space ownership does not lend platform or other users revocation rights');
  assert.equal((await f.request(ordinaryOwner, `/api/business/account/grants/${readerGrant.id}`, { method: 'DELETE' })).status, 404);
  assert.equal((await f.request(ordinaryOwner, `/api/business/admin/grants/${readerGrant.id}`, { method: 'DELETE' })).status, 403);
  assert.equal(f.auth.getGrant(readerGrant.id).id, readerGrant.id, 'owner refusals leave the foreign delegation intact');
});

test('existing delegation deletion keeps CSRF, whole-grant immediate revocation, audit and history semantics', async t => {
  const f = await fixture(t), owner = await f.login('owner'), reader = await f.login('reader'), editor = await f.login('editor');
  const rules = [rule(f.space.id, 'slides', ['read'], ['synthetic-read-record']), rule(f.other.id, 'slides', ['read'], ['synthetic-other-record'])];
  const active = f.grant('reader', rules), token = f.auth.issueToken({ grantId: active.id }).accessToken;
  f.auth.authorize(token, { appId: 'slides', spaceId: f.space.id, action: 'read', resourceId: 'synthetic-read-record' });
  const path = `/api/business/admin/grants/${active.id}`;
  for (const headers of [{ 'X-CSRF-Token': 'invalid' }, { Origin: 'https://foreign.example' }]) {
    assert.equal((await f.request(owner, path, { method: 'DELETE', headers })).status, 403);
    assert.equal(f.auth.getGrant(active.id).id, active.id, 'denial does not change the grant');
  }
  assert.equal((await f.request(editor, `/api/business/account/grants/${active.id}`, { method: 'DELETE' })).status, 404, 'another ordinary member cannot revoke the grant');
  assert.equal((await f.request(reader, `/api/business/account/grants/${active.id}`, { method: 'DELETE', headers: { 'X-CSRF-Token': 'invalid' } })).status, 403);
  const auditsBefore = f.auth.listAudit().filter(row => row.event === 'platform.grant.revoked').length;
  assert.equal((await f.request(owner, path, { method: 'DELETE' })).status, 200);
  for (const spaceId of [f.space.id, f.other.id]) assert.throws(() => f.auth.authorize(token, { appId: 'slides', spaceId, action: 'read' }), { status: 401 }, 'all grant spaces lose access immediately');
  const audit = f.auth.listAudit().filter(row => row.event === 'platform.grant.revoked');
  assert.equal(audit.length, auditsBefore + 1); assert.equal(audit[0].outcome, 'allowed');
  assert.doesNotMatch(JSON.stringify(audit), new RegExp(`${active.id}|${token}|${password}`), 'audit remains pseudonymous');
  for (const value of [await f.detail(reader), (await f.detail(owner, 'reader')).userContext]) {
    const historical = value.delegations.find(row => row.id === active.id);
    assert.ok(historical.revokedAt != null, 'space management retains labeled revoked history');
  }
  const allGrants = await (await f.request(owner, '/api/business/admin/users/reader/grants')).json();
  assert.ok(allGrants.grants.find(row => row.id === active.id).revokedAt != null, 'global management reflects the same revocation');
  const ownGrant = f.grant('reader', [rules[0]]);
  assert.equal((await f.request(reader, `/api/business/account/grants/${ownGrant.id}`, { method: 'DELETE' })).status, 200);
  assert.equal(f.auth.listAudit().filter(row => row.event === 'account.grant.revoked' && row.outcome === 'allowed').length, 1, 'own revocation keeps its existing audit event');
  const expired = f.grant('reader', [rules[0]]);
  f.auth.db.prepare('UPDATE auth_grants SET expires_at=? WHERE id=?').run(Date.now() - 1000, expired.id);
  const expiredRow = (await f.detail(reader)).delegations.find(row => row.id === expired.id);
  assert.ok(expiredRow.expiresAt < Date.now(), 'expired grants remain available for management');
  assert.equal((await f.request(reader, `/api/business/account/grants/${expired.id}`, { method: 'DELETE' })).status, 200, 'existing endpoint can revoke an expired grant');
});
