import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer, request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { AuthStore, createAuthHandler, SESSION_COOKIE } from '../src/business/auth.mjs';
import { createPraxisServer } from '../src/server.mjs';

const host = 'workbench.example.test';
const origin = 'https://' + host;
const apps = ['letters', 'profiles'];

async function fixture(t, { configured = true } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'private-document-access-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'config'));
  const registeredApps = apps.map(id => ({ id, kind: 'app', name: id, path: '/', icon: '/' + id + '.svg', adminOnly: true }));
  await writeFile(join(root, 'config/apps.json'), JSON.stringify(registeredApps));
  const roots = {};
  for (const app of apps) {
    roots[app] = join(root, 'private-' + app);
    await mkdir(roots[app]);
    await writeFile(join(roots[app], 'fixture.txt'), 'synthetic private ' + app);
  }

  const auth = new AuthStore({ file: join(root, 'auth.db'), issuer: origin });
  const password = 'A synthetic-only browser password';
  const cookies = {};
  for (const [id, username, admin] of [
    ['fixture-owner-id', 'owner-login', true],
    ['fixture-admin-id', 'another-admin', true],
    ['fixture-reader-id', 'ordinary-reader', false],
  ]) {
    auth.createUser({ id, username, password });
    if (admin) auth.setPlatformAdmin({ userId: id, enabled: true });
    cookies[username] = SESSION_COOKIE + '=' + auth.login({ username, password }).sessionToken;
  }

  let accesses = 0, onAccess;
  const nativeAuth = createAuthHandler({ store: auth, issuer: origin, webGateway: { enabled: true } });
  const core = createServer(async (req, res) => {
    if (req.url === '/api/business/web-access') onAccess?.(++accesses);
    if (!await nativeAuth(req, res)) res.writeHead(404).end();
  });
  core.listen(0, '127.0.0.1');
  await once(core, 'listening');
  const gateway = createPraxisServer({
    root,
    webGateway: {
      enabled: true, canonicalUrl: origin, coreUrl: 'http://127.0.0.1:' + core.address().port,
      privateDocumentRoots: roots, privateDocumentOwnerId: configured ? 'fixture-owner-id' : undefined,
    },
  });
  gateway.listen(0, '127.0.0.1');
  await once(gateway, 'listening');
  t.after(async () => {
    for (const server of [gateway, core]) {
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
    }
    auth.close();
  });

  function read(path, user = 'owner-login', headers = {}) {
    return new Promise((resolve, reject) => {
      const req = httpRequest({
        hostname: '127.0.0.1', port: gateway.address().port, path,
        headers: { Host: host, Accept: 'application/json', ...(user ? { Cookie: cookies[user] } : {}), ...headers },
      }, res => {
        const parts = [];
        res.on('data', part => parts.push(part));
        res.on('error', reject);
        res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(parts).toString(), headers: res.headers }));
      });
      req.on('error', reject);
      req.end();
    });
  }
  return {
    read, cookies, auth,
    observeAccess(callback) { accesses = 0; onAccess = callback; },
  };
}

test('the configured owner discovers both private apps and reads only the selected app source', async t => {
  const { read } = await fixture(t);
  const catalog = await read('/api/apps');
  assert.equal(catalog.status, 200);
  const entries = JSON.parse(catalog.body).apps;
  for (const app of apps) {
    assert.equal(entries.find(item => item.id === app)?.url, origin + '/apps/' + app + '/');
    const path = '/apps/' + app + '/api/documents';
    const list = await read(path);
    assert.equal(list.status, 200);
    assert.match(list.headers['cache-control'], /no-store/);
    assert.match(list.headers.vary, /Cookie/i);
    const [{ id, name, type }] = JSON.parse(list.body).items;
    assert.match(id, /^[a-f0-9]{64}$/);
    assert.equal(name, 'fixture.txt'); assert.equal(type, 'txt');
    const bytes = await read(path + '/' + id);
    assert.equal(bytes.status, 200);
    assert.match(bytes.headers['cache-control'], /no-store/);
    assert.equal(bytes.body, 'synthetic private ' + app);
    const other = app === 'letters' ? 'profiles' : 'letters';
    assert.equal((await read('/apps/' + other + '/api/documents/' + id)).status, 404);

    for (const user of ['another-admin', 'ordinary-reader', null]) {
      const expected = user ? 403 : 401;
      for (const url of [path, path + '/' + id]) {
        const denied = await read(url, user, { 'X-Praxis-User-Id': 'fixture-owner-id', 'X-Praxis-Document-Owner': 'true' });
        assert.equal(denied.status, expected);
        assert.doesNotMatch(denied.body, /fixture\.txt|synthetic private/);
        assert.match(denied.headers['cache-control'], /no-store/);
      }
    }
  }
  for (const user of ['another-admin', 'ordinary-reader']) {
    const otherRegistry = await read('/api/apps', user);
    assert.equal(otherRegistry.status, 200);
    assert.equal(JSON.parse(otherRegistry.body).apps.some(app => apps.includes(app.id)), false);
  }
  assert.equal((await read('/api/apps', null)).status, 401);
  assert.equal((await read('/apps/letters/api/documents', 'owner-login', { Host: 'different.example.test' })).status, 404);
});

test('an unconfigured owner fails closed even for an administrator with a real native browser session', async t => {
  const { read } = await fixture(t, { configured: false });
  assert.equal(JSON.parse((await read('/api/apps')).body).apps.some(app => apps.includes(app.id)), false);
  for (const app of apps) assert.equal((await read('/apps/' + app + '/api/documents')).status, 403);
});

test('revocation between the initial owner check and private metadata delivery suppresses the response', async t => {
  const { auth, read, observeAccess } = await fixture(t);
  let checks = 0;
  observeAccess(count => {
    checks = count;
    if (count === 2) auth.setPlatformAdmin({ userId: 'fixture-owner-id', enabled: false });
  });
  const result = await read('/apps/letters/api/documents');
  assert.equal(checks, 2);
  assert.equal(result.status, 401);
  assert.doesNotMatch(result.body, /fixture\.txt|synthetic private|items/);
});
