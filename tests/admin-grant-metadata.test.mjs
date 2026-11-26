import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AuthStore, createAuthHandler } from '../src/business/auth.mjs';
import { createAccountHandler, createAdminHandler } from '../src/business/admin.mjs';

const password = 'Synthetic-grant-metadata-password-2026';
const spaces = ['synthetic-space-a', 'synthetic-space-z'];
const rule = (spaceId, actions = ['read']) => ({ appId: 'slides', spaceId, actions, resources: [`private-resource-${spaceId}`] });

async function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'praxis-grant-metadata-'));
  const clock = { now: Date.parse('2026-11-21T12:00:00Z') };
  let auth, handleAuth, handleAccount, handleAdmin;
  const server = createServer(async (request, response) => {
    if (await handleAuth(request, response) || await handleAccount(request, response) || await handleAdmin(request, response)) return;
    response.writeHead(404).end();
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  auth = new AuthStore({ file: join(directory, 'auth.sqlite'), issuer: origin, clock: () => clock.now });
  t.after(async () => {
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    auth.close(); rmSync(directory, { recursive: true, force: true });
  });
  handleAuth = createAuthHandler({ store: auth, apps: { slides: { spaces } }, webGateway: { enabled: true } });
  handleAccount = createAccountHandler({ auth }); handleAdmin = createAdminHandler({ auth });
  for (const id of ['administrator', 'member', 'other']) auth.createUser({ id, username: id, password });
  auth.setPlatformAdmin({ userId: 'administrator', enabled: true });
  for (const spaceId of spaces) {
    auth.createSpace({ id: spaceId, type: 'family', ownerId: 'administrator' });
    auth.setMembership({ spaceId, userId: 'member', role: 'member' });
  }
  auth.setWebAccess({ userId: 'member', apps: ['lattice-slides'], prds: false });
  const permissions = spaces.map(spaceId => auth.grantResource({ userId: 'member', ...rule(spaceId, ['read', 'update']) }));
  auth.createClient({ id: 'synthetic-agent', name: 'Same synthetic client name', redirectUris: ['https://client.example/callback'] });
  const rules = [rule(spaces[1]), rule(spaces[0]), rule(spaces[1], ['update'])];
  const grant = (options = {}) => auth.createGrant({ userId: 'member', clientId: 'synthetic-agent', rules, ...options });
  const request = (path, options = {}) => fetch(origin + path, { redirect: 'manual', ...options });
  const login = async username => {
    const response = await request('/auth/login', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) });
    assert.equal(response.status, 200);
    await response.json();
    return { Cookie: response.headers.get('set-cookie').split(';')[0] };
  };
  const read = async (path, headers) => {
    const response = await request(path, { headers }); assert.equal(response.status, 200);
    const value = await response.json();
    assert.doesNotMatch(JSON.stringify(value), /private-resource-|"rules"|"resources"/, 'display metadata never exposes rule bodies or resource identifiers');
    return value;
  };
  return { auth, clock, permissions, grant, request, login, read };
}

function assertScope(grant, expectedSpaces, expectedActions = ['read', 'update']) {
  assert.deepEqual(grant.spaceIds, spaces, 'delegation identity retains every original space ID, unique and deterministically sorted');
  assert.equal(grant.scopes.length, 1);
  assert.deepEqual(grant.scopes[0], { appId: 'slides', actions: expectedActions, spaceCount: expectedSpaces.length, resourceCount: expectedSpaces.length, allResources: false }, 'existing scope fields retain their meaning independently of original identity metadata');
}

test('grant display metadata identifies all spaces while preserving current and historical scope semantics', async t => {
  const f = await fixture(t);
  const current = f.grant(), expired = f.grant({ expiresAt: f.clock.now + 1 }), revoked = f.grant();
  f.auth.revokeGrant(revoked.id); f.clock.now += 2;
  const member = await f.login('member'), administrator = await f.login('administrator');
  const ownPath = '/api/business/account/grants', adminPath = '/api/business/admin/users/member/grants';
  const initial = await f.read(ownPath, member);
  assert.deepEqual(initial.grants.map(grant => grant.id).sort(), [current.id, expired.id, revoked.id].sort());
  for (const grant of initial.grants) assertScope(grant, spaces);
  assert.equal(initial.grants.find(grant => grant.id === current.id).status, 'current');
  assert.equal(initial.grants.find(grant => grant.id === expired.id).status, 'expired');
  assert.equal(initial.grants.find(grant => grant.id === revoked.id).status, 'revoked');
  f.auth.revokeResource(f.permissions[0].id);
  const own = await f.read(ownPath, member);
  assert.equal(own.grants.find(grant => grant.id === current.id).status, 'restricted');
  assertScope(own.grants.find(grant => grant.id === current.id), [spaces[1]]);
  for (const id of [expired.id, revoked.id]) assertScope(own.grants.find(grant => grant.id === id), spaces);
  f.auth.revokeResource(f.permissions[1].id);
  const noEffectiveScope = (await f.read(ownPath, member)).grants.find(grant => grant.id === current.id);
  assert.equal(noEffectiveScope.status, 'restricted');
  assert.deepEqual(noEffectiveScope.scopes, [], 'a fully restricted delegation still exposes no effective operations');
  assert.deepEqual(noEffectiveScope.spaceIds, spaces, 'original space identity remains visible even when no effective operations remain');
  const managed = await f.read(adminPath, administrator);
  for (const grant of managed.grants) assertScope(grant, spaces);
  for (const grant of managed.grants) {
    assert.equal(grant.client.name, 'Same synthetic client name');
    const original = [current, expired, revoked].find(value => value.id === grant.id);
    assert.equal(grant.expiresAt, original.expiresAt);
    assert.equal(grant.revokedAt !== null, grant.id === revoked.id);
  }
  const paginated = [];
  let cursor = '';
  do {
    const page = await f.read(`${adminPath}?limit=1${cursor ? `&after=${encodeURIComponent(cursor)}` : ''}`, administrator);
    assert.equal(page.grants.length, 1); assertScope(page.grants[0], spaces);
    paginated.push(page.grants[0].id); cursor = page.nextCursor;
  } while (cursor);
  assert.deepEqual(paginated, [current.id, expired.id, revoked.id].sort(), 'each paginated entry preserves its actual space identifiers');
});

test('space metadata retains native-session, user-isolation and administrator boundaries', async t => {
  const f = await fixture(t), grant = f.grant();
  const member = await f.login('member'), other = await f.login('other'), administrator = await f.login('administrator');
  const ownPath = '/api/business/account/grants', adminPath = '/api/business/admin/users/member/grants';
  assert.equal((await f.request(ownPath)).status, 401);
  assert.equal((await f.request(adminPath)).status, 401);
  assert.equal((await f.request(adminPath, { headers: member })).status, 403);
  assert.equal((await f.request(adminPath, { headers: other })).status, 403);
  assert.deepEqual((await f.read(ownPath, other)).grants, [], 'another user cannot read the member grant metadata');
  assert.equal((await f.read(ownPath, member)).grants[0].id, grant.id);
  assert.equal((await f.read(adminPath, administrator)).grants[0].id, grant.id);
  const bearer = { Authorization: `Bearer ${f.auth.issueToken({ grantId: grant.id }).accessToken}` };
  for (const path of [ownPath, adminPath]) {
    assert.equal((await f.request(path, { headers: bearer })).status, 401, 'business bearer tokens cannot read console metadata');
    assert.equal((await f.request(path, { headers: { ...administrator, Origin: 'https://untrusted.example' } })).status, 403);
  }
  assert.equal((await f.request(ownPath + '?userId=member', { headers: other })).status, 400, 'query input cannot select another account');
  assert.deepEqual(f.auth.listGrants('member').map(value => value.id), [grant.id], 'metadata reads and rejected requests leave grants unchanged');
});
