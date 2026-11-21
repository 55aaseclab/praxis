import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AuthStore, createAuthHandler, hashVerifier } from '../src/business/auth.mjs';

const password = 'Synthetic-space-designation-password-2026';
const reminder = spaceId => ({ appId: 'reminder', spaceId, resources: ['synthetic-record'], actions: ['read'] });

async function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'praxis-space-designation-'));
  const file = join(directory, 'auth.sqlite');
  let store, handler;
  const server = createServer(async (request, response) => {
    if (!(await handler(request, response))) response.writeHead(404).end();
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const apps = { reminder: { spaces: ['personal-operator', 'family-other'] } };
  function open() {
    store = new AuthStore({ file, issuer: origin });
    handler = createAuthHandler({ store, apps });
  }
  open();
  store.createUser({ id: 'operator', username: 'operator', password });
  store.createUser({ id: 'outsider', username: 'outsider', password });
  store.createUser({ id: 'administrator', username: 'administrator', password });
  store.setPlatformAdmin({ userId: 'administrator', enabled: true });
  store.createSpace({ id: 'personal-operator', type: 'personal', ownerId: 'operator' });
  store.createSpace({ id: 'family-other', type: 'family', ownerId: 'operator' });
  store.createClient({ id: 'synthetic-agent', name: 'Synthetic designated-space client', redirectUris: ['https://client.example/callback'] });
  const request = (path, options = {}) => fetch(origin + path, { redirect: 'manual', ...options });
  const json = (path, value, options = {}) => request(path, { method: 'POST', ...options,
    headers: { Origin: origin, 'Content-Type': 'application/json', ...options.headers }, body: JSON.stringify(value) });
  const login = async username => {
    const response = await json('/auth/login', { username, password });
    assert.equal(response.status, 200);
    const body = await response.json();
    return { body, cookie: response.headers.get('set-cookie').split(';')[0] };
  };
  const verifier = 'synthetic-designated-space-verifier-'.repeat(2);
  const oauth = (extra = {}) => '/oauth/authorize?' + new URLSearchParams({ client_id: 'synthetic-agent', redirect_uri: 'https://client.example/callback', response_type: 'code', code_challenge_method: 'S256', code_challenge: hashVerifier(verifier), resource: origin + '/mcp', scope: 'reminder:read', state: 'synthetic-designation', lang: 'en', ...extra });
  const exchange = code => json('/oauth/token', { grant_type: 'authorization_code', code, client_id: 'synthetic-agent', redirect_uri: 'https://client.example/callback', code_verifier: verifier, resource: origin + '/mcp' });
  const form = (path, actor, value, headers = {}) => request(path, { method: 'POST', headers: { Origin: origin, Cookie: actor.cookie, 'Content-Type': 'application/x-www-form-urlencoded', ...headers }, body: new URLSearchParams(value) });
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); store.close(); rmSync(directory, { recursive: true, force: true }); });
  return { get store() { return store; }, server, origin, json, request, login, oauth, exchange, form,
    reopen() { store.close(); open(); },
    enable(spaceId) { store.setSpaceAppEnrollment({ spaceId, appId: 'reminder', enabled: true }); },
  };
}

function hidden(html, name) {
  const match = html.match(new RegExp(`name="${name}" value="([^"]*)"`));
  assert.ok(match, `form contains ${name}`);
  return match[1].replaceAll('&amp;', '&');
}

test('registration creates one durable protected personal space without app/resource/admin escalation', async t => {
  const f = await fixture(t);
  const registered = await f.json('/auth/register', { username: 'new-person', password });
  assert.equal(registered.status, 201);
  assert.equal(registered.headers.get('set-cookie'), null);
  const { user } = await registered.json();
  const spaces = () => f.store.db.prepare('SELECT id,type,owner_id AS ownerId FROM auth_spaces WHERE owner_id=?').all(user.id);
  assert.equal(spaces().length, 1);
  const space = spaces()[0];
  assert.equal(space.type, 'personal');
  assert.equal(f.store.membershipRole(user.id, space.id), 'owner');
  assert.equal(f.store.isPlatformAdmin(user.id), false);
  assert.equal(f.store.getWebEntryPolicy(user.id), null);
  assert.equal(f.store.db.prepare('SELECT COUNT(*) AS n FROM auth_resources WHERE user_id=?').get(user.id).n, 0);
  assert.equal(f.store.db.prepare('SELECT COUNT(*) AS n FROM auth_space_apps WHERE space_id=?').get(space.id).n, 0);
  assert.equal(f.store.availableRules(user.id).filter(rule => rule.appId !== 'spaces').length, 0);
  assert.equal(f.store.ensurePersonalSpace(user.id).id, space.id);
  assert.equal(spaces().length, 1);
  assert.equal((await f.json('/auth/register', { username: 'new-person', password })).status, 409);
  assert.equal(spaces().length, 1);
  for (const actorId of [user.id, 'administrator']) {
    assert.equal(f.store.canDeleteSpace(actorId, space), false);
    assert.throws(() => f.store.deleteSpace({ spaceId: space.id, actorId, confirmSpaceId: space.id }), { status: 409, code: 'PERSONAL_SPACE_REQUIRED' });
  }
  f.reopen();
  assert.equal(spaces().length, 1);
  assert.equal(f.store.ensurePersonalSpace(user.id).id, space.id);
  assert.equal(f.store.canDeleteSpace('administrator', space), false);
  assert.equal((await f.login('new-person')).body.user.id, user.id);
});

test('personal deletion follows origin and existing operator personal spaces are never duplicated', async t => {
  const f = await fixture(t);
  assert.equal(f.store.ensurePersonalSpace('operator').id, 'personal-operator');
  assert.equal(f.store.ensurePersonalSpace('operator').id, 'personal-operator');
  assert.equal(f.store.db.prepare("SELECT COUNT(*) AS n FROM auth_spaces WHERE owner_id='operator' AND type='personal'").get().n, 1);
  for (const actorId of ['operator', 'administrator']) {
    const space = f.store.createSelfServiceSpace({ type: 'personal', ownerId: 'operator' });
    assert.equal(f.store.canDeleteSpace(actorId, space), true);
    assert.throws(() => f.store.deleteSpace({ spaceId: space.id, actorId, confirmSpaceId: 'wrong' }), { status: 400 });
    assert.equal(f.store.deleteSpace({ spaceId: space.id, actorId, confirmSpaceId: space.id }).deleted, true);
    assert.equal(f.store.db.prepare('SELECT 1 FROM auth_spaces WHERE id=?').get(space.id), undefined);
  }
});

test('consent defaults to personal, explicitly chooses one space, and code/refresh return its designation', async t => {
  const f = await fixture(t), actor = await f.login('operator');
  const read = path => f.request(path, { headers: { Cookie: actor.cookie } });
  const defaultHtml = await (await read(f.oauth())).text();
  assert.match(defaultHtml, /<option value="personal-operator" selected>/);
  assert.equal(hidden(defaultHtml, 'space_id'), 'personal-operator');
  const path = f.oauth({ space_id: 'family-other' });
  const html = await (await read(path)).text();
  assert.match(html, /<option value="family-other" selected>/);
  const before = f.store.db.prepare('SELECT COUNT(*) AS n FROM auth_grants').get().n;
  const failed = await f.form(path, actor, { csrf: actor.body.csrfToken, consent: hidden(html, 'consent'), space_id: 'personal-operator', rule_0: '1' });
  assert.equal(failed.status, 403);
  assert.equal(f.store.db.prepare('SELECT COUNT(*) AS n FROM auth_grants').get().n, before);
  const allowed = await f.form(path, actor, { csrf: actor.body.csrfToken, consent: hidden(html, 'consent'), space_id: 'family-other', rule_0: '1' });
  assert.equal(allowed.status, 303);
  const destination = new URL(allowed.headers.get('location'));
  assert.equal(destination.searchParams.get('state'), 'synthetic-designation');
  assert.equal(destination.searchParams.get('iss'), f.origin);
  const response = await f.exchange(destination.searchParams.get('code'));
  assert.equal(response.status, 200);
  const tokens = await response.json();
  assert.equal(tokens.space_id, 'family-other');
  assert.deepEqual(Object.keys(tokens).sort(), ['access_token', 'expires_in', 'refresh_token', 'scope', 'space_id', 'token_type']);
  assert.equal(tokens.token_type, 'Bearer');
  assert.equal(tokens.scope, 'reminder:read');
  assert.equal(f.store.authorize(tokens.access_token, { appId: 'reminder', spaceId: 'family-other', action: 'read' }).userId, 'operator');
  assert.throws(() => f.store.authorize(tokens.access_token, { appId: 'reminder', spaceId: 'personal-operator', action: 'read' }), { status: 403 });
  f.reopen();
  const refreshed = await f.json('/oauth/token', { grant_type: 'refresh_token', refresh_token: tokens.refresh_token, client_id: 'synthetic-agent', resource: f.origin + '/mcp' });
  assert.equal(refreshed.status, 200);
  assert.equal((await refreshed.json()).space_id, 'family-other');
});

test('zero-space consent offers bounded inline creation and preserves OAuth request', async t => {
  const f = await fixture(t), actor = await f.login('outsider'), path = f.oauth();
  const response = await f.request(path, { headers: { Cookie: actor.cookie } });
  const html = await response.text();
  assert.match(html, /Create a space to continue/);
  assert.match(html, /name="intent" value="create_space"/);
  assert.doesNotMatch(html, /name="rule_0"/);
  const input = { csrf: actor.body.csrfToken, intent: 'create_space', type: 'personal' };
  const count = () => f.store.db.prepare("SELECT COUNT(*) AS n FROM auth_spaces WHERE owner_id='outsider'").get().n;
  for (const [value, headers, status] of [[{ ...input, csrf: 'forged' }, {}, 403], [input, { Origin: 'https://attacker.example' }, 403], [{ ...input, ownerId: 'operator' }, {}, 400], [{ ...input, type: 'administrator' }, {}, 400]]) {
    assert.equal((await f.form(path, actor, value, headers)).status, status);
    assert.equal(count(), 0);
  }
  const created = await f.form(path, actor, input);
  assert.equal(created.status, 303);
  const next = new URL(created.headers.get('location'), f.origin);
  const original = new URL(path, f.origin);
  for (const [key, value] of original.searchParams) assert.equal(next.searchParams.get(key), value);
  const spaceId = next.searchParams.get('space_id');
  assert.ok(spaceId);
  assert.equal(count(), 1);
  assert.equal(f.store.membershipRole('outsider', spaceId), 'owner');
  assert.equal(f.store.db.prepare('SELECT 1 FROM auth_auto_personal_spaces WHERE space_id=?').get(spaceId), undefined, 'inline creation is a user-created space');
  assert.equal((await f.form(path, actor, input)).status, 409, 'retry cannot duplicate inline creation');
  assert.equal(count(), 1);
  const retry = await f.request(next.pathname + next.search, { headers: { Cookie: actor.cookie } });
  assert.match(await retry.text(), /No actions available/);
  assert.equal(f.store.db.prepare('SELECT COUNT(*) AS n FROM auth_grants').get().n, 0);
});

test('concurrent inline creation rechecks space existence after both request bodies arrive', async t => {
  const f = await fixture(t), actor = await f.login('outsider'), path = f.oauth();
  const body = new URLSearchParams({ csrf: actor.body.csrfToken, intent: 'create_space', type: 'personal' }).toString();
  let seen = 0, arrived;
  const barrier = new Promise(resolve => { arrived = resolve; });
  const observe = request => { if (request.url === path && ++seen === 2) arrived(); };
  f.server.on('request', observe);
  const pending = [0, 1].map(() => {
    let outgoing;
    const response = new Promise((resolve, reject) => {
      outgoing = httpRequest(f.origin + path, { method: 'POST', headers: { Origin: f.origin, Cookie: actor.cookie,
        'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) } }, incoming => {
        incoming.resume(); incoming.on('end', () => resolve(incoming.statusCode)); incoming.on('error', reject);
      });
      outgoing.on('error', reject);
      outgoing.write(body.slice(0, -1));
    });
    return { outgoing, response };
  });
  await barrier; // Both handlers are waiting for body completion with zero spaces.
  f.server.off('request', observe);
  for (const request of pending) request.outgoing.end(body.slice(-1));
  assert.deepEqual((await Promise.all(pending.map(request => request.response))).sort(), [303, 409]);
  assert.equal(f.store.db.prepare("SELECT COUNT(*) AS n FROM auth_spaces WHERE owner_id='outsider'").get().n, 1);
});

test('legacy JSON OAuth multi-space consent remains compatible without a guessed space field', async t => {
  const f = await fixture(t), actor = await f.login('operator');
  const response = await f.json(f.oauth(), { csrf: actor.body.csrfToken, rules: [reminder('personal-operator'), reminder('family-other')] }, { headers: { Cookie: actor.cookie } });
  assert.equal(response.status, 303);
  const tokenResponse = await f.exchange(new URL(response.headers.get('location')).searchParams.get('code'));
  assert.equal(tokenResponse.status, 200);
  const tokens = await tokenResponse.json();
  assert.equal(Object.hasOwn(tokens, 'space_id'), false);
  for (const spaceId of ['personal-operator', 'family-other']) assert.equal(f.store.authorize(tokens.access_token, { appId: 'reminder', spaceId, action: 'read', resourceId: 'synthetic-record' }).userId, 'operator');
});

test('admin arbitrary registered-user display projection never changes session or write authorization', async t => {
  const f = await fixture(t), admin = await f.login('administrator'), outsider = await f.login('outsider');
  const path = '/api/business/account/spaces/family-other';
  const projected = await f.request(path + '?contextUserId=outsider', { headers: { Cookie: admin.cookie } });
  assert.equal(projected.status, 200);
  const detail = await projected.json();
  assert.equal(detail.userContext.user.id, 'outsider');
  assert.equal(detail.userContext.space.role, null);
  assert.deepEqual(detail.userContext.permissions, []);
  assert.equal((await f.request(path + '?contextUserId=missing', { headers: { Cookie: admin.cookie } })).status, 404);
  f.store.setMembership({ spaceId: 'family-other', userId: 'outsider', role: 'member' });
  assert.equal((await f.request(path + '?contextUserId=operator', { headers: { Cookie: outsider.cookie } })).status, 403);
  const write = await f.json(path + '/members', { username: 'outsider', role: 'member' }, { headers: { Cookie: admin.cookie, 'X-CSRF-Token': admin.body.csrfToken } });
  assert.equal(write.status, 403, 'administrator still lacks owner-only write authority');
  const session = await f.request('/auth/session', { headers: { Cookie: admin.cookie } });
  assert.equal((await session.json()).user.id, 'administrator');
});

// These are real Chromium views of the isolated auth handler, not business-client acceptance.
test('Chromium chooses consent spaces and creates inline at 1440/390 without overflow', { skip: !process.env.PLAYWRIGHT_MODULE, timeout: 60000 }, async t => {
  const { chromium } = await import(process.env.PLAYWRIGHT_MODULE);
  const f = await fixture(t);
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE, args: ['--no-sandbox'] });
  t.after(() => browser.close());
  for (const width of [1440, 390]) {
    const language = width === 390 ? 'zh' : 'en';
    const context = await browser.newContext({ viewport: { width, height: 900 }, screen: { width, height: 900 } });
    const page = await context.newPage();
    const actor = await f.login('operator');
    const [name, value] = actor.cookie.split('=');
    await context.addCookies([{ name, value, url: f.origin }]);
    await page.goto(f.origin + f.oauth({ lang: language }));
    assert.equal(await page.locator('select[name=space_id]').inputValue(), 'personal-operator');
    assert.equal(await page.locator('form[method=get] button').count(), 0, 'designation is a direct native dropdown');
    const geometry = () => page.evaluate(() => {
      const rect = selector => {
        const { x, y, width, height } = document.querySelector(selector).getBoundingClientRect();
        return { x, y, width, height };
      };
      return { scrollX, scrollY, main: rect('main'), space: rect('select[name=space_id]'), consent: rect('form[method=post]') };
    });
    const beforePointer = await geometry();
    await page.locator('select[name=space_id]').click();
    assert.deepEqual(await geometry(), beforePointer, 'opening the actual native menu preserves scroll and surrounding geometry');
    assert.equal(await page.locator('select[name=space_id]').evaluate(element => document.activeElement === element), true);
    await page.keyboard.press('Escape');
    assert.deepEqual(await geometry(), beforePointer, 'dismissing the native menu preserves scroll and surrounding geometry');
    assert.equal(await page.locator('select[name=space_id]').inputValue(), 'personal-operator');
    assert.equal(await page.locator('select[name=space_id]').evaluate(element => document.activeElement === element), true);
    await Promise.all([page.waitForURL(url => url.searchParams.get('space_id') === 'family-other'), page.locator('select[name=space_id]').selectOption('family-other')]);
    assert.equal(await page.locator('input[name=rule_0]').isChecked(), false, 'switching does not consent to any action');
    await page.locator('select[name=space_id]').focus();
    await Promise.all([page.waitForURL(url => url.searchParams.get('space_id') === 'personal-operator'), page.keyboard.press('ArrowDown')]);
    assert.equal(await page.locator('input[name=space_id]').inputValue(), 'personal-operator');
    await Promise.all([page.waitForURL(url => url.searchParams.get('space_id') === 'family-other'), page.locator('select[name=space_id]').selectOption('family-other')]);
    assert.equal(await page.locator('input[name=space_id]').inputValue(), 'family-other');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await context.clearCookies();
    const username = `synthetic-inline-${width}`;
    f.store.createUser({ id: username, username, password });
    const inlineActor = await f.login(username);
    const [inlineName, inlineValue] = inlineActor.cookie.split('=');
    await context.addCookies([{ name: inlineName, value: inlineValue, url: f.origin }]);
    await page.goto(f.origin + f.oauth({ lang: language }));
    await page.locator('select[name=type]').selectOption('personal');
    await Promise.all([page.waitForURL(url => url.searchParams.has('space_id')), page.locator('form[method=post] button').click()]);
    const createdId = new URL(page.url()).searchParams.get('space_id');
    assert.equal(f.store.membershipRole(username, createdId), 'owner');
    assert.equal(await page.locator('select[name=space_id]').inputValue(), createdId);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await context.close();
  }
});
