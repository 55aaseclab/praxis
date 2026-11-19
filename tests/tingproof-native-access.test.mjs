import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';
import { once } from 'node:events';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { AuthStore, createAuthHandler, SESSION_COOKIE } from '../src/business/auth.mjs';
import { createWebGateway } from '../src/web-gateway.mjs';

const host = 'tingproof.synthetic.test';
const origin = 'https://' + host;
const accessPath = '/api/business/web-resource-access/tingproof/native-projects';
const password = 'TingProof synthetic native-authoring password';

async function fixture(t, configuredSpaces = ['space-a', 'space-b']) {
  const directory = await mkdtemp(join(tmpdir(), 'tingproof-native-access-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(join(directory, 'state'));
  const auth = new AuthStore({ file: join(directory, 'state/auth.sqlite'), issuer: origin });
  const cookies = {};
  for (const id of ['owner', 'app-only', 'assignment-only', 'one-space', 'reader', 'operator', 'platform-admin']) {
    auth.createUser({ id, username: id, password });
    auth.setWebAccess({ userId: id, apps: ['tingproof'], workbench: true, prds: false });
    cookies[id] = SESSION_COOKIE + '=' + auth.login({ username: id, password }).sessionToken;
  }
  auth.setPlatformAdmin({ userId: 'platform-admin', enabled: true });
  for (const id of ['space-a', 'space-b']) auth.createSpace({ id, type: 'family', ownerId: 'owner' });
  auth.setMembership({ userId: 'one-space', spaceId: 'space-a', role: 'admin' });
  const expiresAt = Date.now() + 120000;
  const grants = {};
  for (const spaceId of ['space-a', 'space-b']) {
    for (const userId of ['assignment-only', 'reader', 'operator']) auth.setMembership({ userId, spaceId, role: 'member' });
    auth.grantResource({ userId: 'assignment-only', spaceId, appId: 'tingproof', actions: ['read', 'assign'], resources: ['assignment-a'] });
    auth.grantResource({ userId: 'reader', spaceId, appId: 'tingproof', actions: ['read'], resources: ['*'] });
    grants[spaceId] = auth.grantResource({
      userId: 'operator', spaceId, appId: 'tingproof', actions: ['read', 'assign'],
      resources: ['*'], expiresAt: expiresAt + (spaceId === 'space-a' ? 20000 : 0),
    }).id;
  }
  const handler = createAuthHandler({
    store: auth, webGateway: { enabled: true },
    apps: { tingproof: { spaces: configuredSpaces } },
  });
  const servers = [], sockets = new Set();
  const requests = [], upgrades = [];
  const core = createServer(async (request, response) => {
    if (!await handler(request, response)) response.writeHead(404).end();
  });
  servers.push(core);
  core.listen(0, '127.0.0.1');
  await once(core, 'listening');
  const upstream = createServer((request, response) => {
    requests.push({ method: request.method, path: request.url });
    if (request.url === '/api/stream') {
      response.writeHead(200, { 'Content-Type': 'text/plain' });
      response.write('started\n');
      const timer = setInterval(() => response.write('tick\n'), 10);
      response.on('close', () => clearInterval(timer));
    } else if (['/', '/index.html'].includes(new URL(request.url, origin).pathname)) {
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      response.end('<!doctype html><html><head><title>TingProof</title></head><body><h1>Native TingProof editor</h1></body></html>');
    } else if (new URL(request.url, origin).pathname.startsWith('/assets/')) {
      response.writeHead(200, { 'Content-Type': request.url.includes('.css') ? 'text/css' : 'text/javascript' }); response.end('/* Synthetic public build asset */');
    } else {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end('{"projects":[]}');
    }
  });
  upstream.on('upgrade', (request, socket) => {
    upgrades.push(request.url);
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.write('HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n');
  });
  servers.push(upstream);
  upstream.listen(0, '127.0.0.1');
  await once(upstream, 'listening');
  const gateway = createWebGateway({
    requireTingproofNativeScope: true, canonicalUrl: origin, coreUrl: 'http://127.0.0.1:' + core.address().port,
    appTargets: { tingproof: 'http://127.0.0.1:' + upstream.address().port, polaris: 'http://127.0.0.1:' + upstream.address().port }, revalidateMs: 20,
  });
  const web = createServer(async (request, response) => {
    if (!await gateway.handle(request, response)) response.writeHead(404).end();
  });
  web.on('upgrade', (request, socket, head) => void gateway.upgrade(request, socket, head));
  servers.push(web);
  web.listen(0, '127.0.0.1');
  await once(web, 'listening');
  t.after(async () => {
    gateway.close();
    for (const socket of sockets) socket.destroy();
    for (const server of servers.reverse()) {
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
    }
    auth.close();
  });
  function request(path, user = 'owner', { method = 'GET', headers = {} } = {}) {
    return new Promise((resolve, reject) => {
      const outgoing = httpRequest({
        hostname: '127.0.0.1', port: web.address().port, path, method,
        headers: { Host: host, Accept: 'application/json', ...(user ? { Cookie: cookies[user] } : {}), ...headers },
      }, response => {
        const chunks = [];
        response.on('data', chunk => chunks.push(chunk));
        response.on('error', reject);
        response.on('end', () => resolve({ status: response.statusCode, body: Buffer.concat(chunks).toString() }));
      });
      outgoing.on('error', reject);
      outgoing.end();
    });
  }
  function direct(path, user = 'operator') {
    return new Promise((resolve, reject) => {
      const outgoing = httpRequest({
        hostname: '127.0.0.1', port: core.address().port, path,
        headers: { Host: host, Cookie: cookies[user] },
      }, response => {
        const chunks = [];
        response.on('data', chunk => chunks.push(chunk));
        response.on('error', reject);
        response.on('end', () => resolve({ status: response.statusCode, value: JSON.parse(Buffer.concat(chunks)) }));
      });
      outgoing.on('error', reject);
      outgoing.end();
    });
  }
  return { auth, cookies, grants, expiresAt, requests, upgrades, port: web.address().port, request, direct };
}

test('native TingProof requires wildcard read and assignment authority in every configured space', async t => {
  const f = await fixture(t);
  for (const user of ['app-only', 'assignment-only', 'one-space', 'reader', 'platform-admin', null]) {
    const result = await f.request('/apps/tingproof/api/projects', user);
    assert.equal(result.status, user ? 403 : 401, String(user));
  }
  assert.equal(f.requests.length, 0);
  for (const user of ['owner', 'operator']) {
    const result = await f.request('/apps/tingproof/', user);
    assert.equal(result.status, 200);
    assert.match(result.body, /Native TingProof editor/);
    assert.match(result.body, /data-app-id="tingproof"/);
    assert.equal((await f.request('/apps/tingproof/api/projects', user, { method: 'POST', headers: { Origin: origin } })).status, 200);
  }
  assert.equal((await f.request('/apps/tingproof/api/projects', 'assignment-only', { method: 'POST', headers: { Origin: origin } })).status, 403);
  const single = await fixture(t, ['space-a']);
  assert.equal((await single.request('/apps/tingproof/api/projects', 'one-space')).status, 200);
});

test('native TingProof uses the earliest scope expiry and refuses a revoked grant on the next request', async t => {
  const f = await fixture(t);
  const result = await f.direct(accessPath);
  assert.equal(result.status, 200);
  assert.equal(result.value.expiresAt, f.expiresAt);
  assert.equal((await f.request('/apps/tingproof/api/projects', 'operator')).status, 200);
  f.auth.revokeResource(f.grants['space-b']);
  assert.equal((await f.request('/apps/tingproof/api/projects', 'operator')).status, 403);
  assert.equal((await f.direct(accessPath)).status, 403);
});

test('revocation closes an active native TingProof HTTP response', async t => {
  const f = await fixture(t);
  let outgoing, response;
  const closed = new Promise((resolve, reject) => {
    outgoing = httpRequest({
      hostname: '127.0.0.1', port: f.port, path: '/apps/tingproof/api/stream',
      headers: { Host: host, Cookie: f.cookies.operator },
    }, incoming => {
      response = incoming;
      assert.equal(incoming.statusCode, 200);
      incoming.once('data', () => f.auth.revokeResource(f.grants['space-b']));
      incoming.once('aborted', resolve);
      incoming.once('error', error => error.code === 'ECONNRESET' ? resolve() : reject(error));
      incoming.resume();
    });
    outgoing.once('error', error => error.code === 'ECONNRESET' ? resolve() : reject(error));
    outgoing.end();
  });
  await Promise.race([closed, new Promise((_, reject) => setTimeout(() => reject(Error('Native HTTP stream stayed open after revocation.')), 2000))]);
  response?.destroy();
  outgoing.destroy();
  assert.equal((await f.request('/apps/tingproof/api/projects', 'operator')).status, 403);
});

test('native TingProof upgrades require full authority and recheck it while connected', async t => {
  const f = await fixture(t);
  function upgrade(user) {
    return new Promise((resolve, reject) => {
      const outgoing = httpRequest({
        hostname: '127.0.0.1', port: f.port, path: '/apps/tingproof/socket',
        headers: { Host: host, Cookie: f.cookies[user], Origin: origin, Connection: 'Upgrade', Upgrade: 'websocket' },
      });
      outgoing.once('response', response => { response.resume(); resolve({ status: response.statusCode }); });
      outgoing.once('upgrade', (response, socket) => resolve({ status: response.statusCode, socket }));
      outgoing.once('error', reject);
      outgoing.end();
    });
  }
  assert.equal((await upgrade('app-only')).status, 403);
  assert.equal(f.upgrades.length, 0);
  const allowed = await upgrade('operator');
  assert.equal(allowed.status, 101);
  assert.equal(f.upgrades.length, 1);
  const disconnected = once(allowed.socket, 'close');
  f.auth.revokeResource(f.grants['space-b']);
  await Promise.race([disconnected, new Promise((_, reject) => setTimeout(() => reject(Error('Native upgrade stayed connected after revocation.')), 2000))]);
  allowed.socket.destroy();
});


test('scoped assignment shell and pure public assets require only app entry, never grant whole-project access', async t => {
  const f = await fixture(t);
  for (const user of ['assignment-only', 'app-only', 'reader']) {
    for (const path of ['/apps/tingproof/?space=space-a&assignment=assignment-a', '/apps/tingproof/index.html?assignment=assignment-a&space=space-a', '/apps/tingproof/assets/index-test.js', '/apps/tingproof/assets/index-test.css']) {
      const opened = await f.request(path, user); assert.equal(opened.status, 200, user + ' ' + path);
      if (path.includes('assignment=')) { assert.match(opened.body, /Native TingProof editor/); assert.doesNotMatch(opened.body, /projects/); }
      assert.equal((await f.request(path, user, { method: 'HEAD' })).status, 200, user + ' HEAD ' + path);
    }
    for (const path of ['/apps/tingproof/', '/apps/tingproof/api/projects', '/apps/tingproof/api/projects/private-project/segments', '/apps/tingproof/api/projects?space=space-a&assignment=assignment-a', '/apps/tingproof/?space=space-a&assignment=assignment-a&project=private-project', '/apps/tingproof/?space=space-a&assignment=assignment-a&assignment=other']) assert.equal((await f.request(path, user)).status, 403, user + ' ' + path);
    assert.equal((await f.request('/apps/tingproof/?space=space-a&assignment=assignment-a', user, { method: 'POST', headers: { Origin: origin } })).status, 403);
  }
  assert.equal((await f.request('/apps/tingproof/?space=space-a&assignment=guessed', null)).status, 401);
  assert.equal((await f.request('/apps/tingproof/assets/index-test.js', null)).status, 401);
  assert.ok(f.requests.every(request => !request.path.startsWith('/api/projects')));
  assert.equal((await f.request('/api/business/invoke?assignment=guessed', 'app-only')).status, 404);
  f.auth.setWebAccess({ userId: 'assignment-only', apps: [], workbench: true, prds: false });
  assert.equal((await f.request('/apps/tingproof/?space=space-a&assignment=assignment-a', 'assignment-only')).status, 403);
  assert.equal((await f.request('/apps/tingproof/assets/index-test.js', 'assignment-only')).status, 403);
});

test('the native Polaris proxy never exposes its internal Core trace endpoint', async t => {
  const f = await fixture(t);
  for (const path of ['/apps/polaris/api/praxis/traces', '/apps/polaris/api/praxis/traces?limit=10', '/apps/polaris/api/praxis/traces/child', '/apps/polaris/%61pi/praxis/traces', '/apps/polaris/api/praxis/tra%63es']) assert.equal((await f.request(path, 'platform-admin')).status, 404);
  assert.equal(f.requests.length, 0);
});
