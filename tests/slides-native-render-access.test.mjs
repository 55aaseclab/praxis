import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { AuthStore, createAuthHandler, SESSION_COOKIE } from '../src/business/auth.mjs';
import { createWebGateway } from '../src/web-gateway.mjs';

const host = 'slides.synthetic.test', origin = 'https://' + host;
const renderPath = '/apps/slides/workbench/api/render';

async function fixture(t, { holdRender = false } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'slides-native-render-'));
  const auth = new AuthStore({ file: join(directory, 'auth.db'), issuer: origin });
  const cookies = {}, requests = [];
  for (const id of ['owner', 'reader', 'split', 'renderer', 'entry-only']) {
    auth.createUser({ id, username: id, password: 'Synthetic Slides native-render password' });
    auth.setWebAccess({ userId: id, apps: ['lattice-slides'], workbench: true, prds: false });
    cookies[id] = SESSION_COOKIE + '=' + auth.login({ username: id, password: 'Synthetic Slides native-render password' }).sessionToken;
  }
  for (const id of ['space-a', 'space-b']) auth.createSpace({ id, type: 'family', ownerId: 'owner' });
  for (const userId of ['reader', 'split', 'renderer']) {
    for (const spaceId of ['space-a', 'space-b']) auth.setMembership({ userId, spaceId, role: 'member' });
  }
  const readExpiry = Date.now() + 120000, renderExpiry = readExpiry - 30000;
  auth.grantResource({ userId: 'reader', spaceId: 'space-a', appId: 'slides', resources: ['legacy-decks'], actions: ['read'] });
  auth.grantResource({ userId: 'split', spaceId: 'space-a', appId: 'slides', resources: ['legacy-decks'], actions: ['read'] });
  auth.grantResource({ userId: 'split', spaceId: 'space-b', appId: 'slides', resources: ['legacy-decks'], actions: ['render'] });
  auth.grantResource({ userId: 'renderer', spaceId: 'space-a', appId: 'slides', resources: ['legacy-decks'], actions: ['read'], expiresAt: readExpiry });
  const renderGrant = auth.grantResource({ userId: 'renderer', spaceId: 'space-a', appId: 'slides', resources: ['legacy-decks'], actions: ['render'], expiresAt: renderExpiry }).id;
  const handleAuth = createAuthHandler({
    store: auth, webGateway: { enabled: true },
    apps: { slides: { spaces: ['space-a', 'space-b'] } },
  });
  const core = createServer(async (request, response) => {
    if (!await handleAuth(request, response)) response.writeHead(404).end();
  });
  core.listen(0, '127.0.0.1'); await once(core, 'listening');
  const upstream = createServer((request, response) => {
    requests.push({ method: request.method, path: request.url });
    if (holdRender && request.method === 'POST' && request.url === '/workbench/api/render') {
      response.writeHead(200, { 'Content-Type': 'text/plain' }); response.write('started\n');
      const timer = setInterval(() => response.write('tick\n'), 10);
      response.once('close', () => clearInterval(timer));
    } else {
      response.writeHead(200, { 'Content-Type': 'application/json' }); response.end('{"native":true}');
    }
  });
  upstream.listen(0, '127.0.0.1'); await once(upstream, 'listening');
  const gateway = createWebGateway({
    canonicalUrl: origin, coreUrl: 'http://127.0.0.1:' + core.address().port,
    appTargets: { 'lattice-slides': 'http://127.0.0.1:' + upstream.address().port }, revalidateMs: 20,
  });
  const web = createServer(async (request, response) => {
    if (!await gateway.handle(request, response)) response.writeHead(404).end();
  });
  web.listen(0, '127.0.0.1'); await once(web, 'listening');
  t.after(async () => {
    gateway.close();
    for (const server of [web, upstream, core]) {
      server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    }
    auth.close(); await rm(directory, { recursive: true, force: true });
  });
  function request(path, user, method = 'GET', port = web.address().port) {
    return new Promise((resolve, reject) => {
      const outgoing = httpRequest({
        hostname: '127.0.0.1', port, path, method,
        headers: { Host: host, Accept: 'application/json', Origin: origin, Cookie: cookies[user] },
      }, response => {
        const data = []; response.on('data', chunk => data.push(chunk)); response.on('error', reject);
        response.on('end', () => resolve({ status: response.statusCode, body: Buffer.concat(data).toString() }));
      });
      outgoing.on('error', reject); outgoing.end();
    });
  }
  return { auth, cookies, requests, renderGrant, renderExpiry, port: web.address().port, corePort: core.address().port, request };
}

test('native Slides rendering requires read and render authority in the same configured space', async t => {
  const f = await fixture(t);
  for (const path of ['/apps/slides/workbench/api/decks', '/apps/slides/workbench/api/files/example.mp4']) {
    assert.equal((await f.request(path, 'reader')).status, 200, 'Legacy reading and file access retain read semantics.');
  }
  for (const user of ['reader', 'split', 'entry-only']) {
    assert.equal((await f.request(renderPath, user, 'POST')).status, 403, user);
  }
  assert.equal(f.requests.filter(request => request.method === 'POST').length, 0);
  assert.equal((await f.request(renderPath, 'renderer', 'POST')).status, 200);
  assert.equal((await f.request(renderPath, 'owner', 'POST')).status, 200);
});

test('native Slides rendering uses the shortest required permission expiry and rechecks revocation', async t => {
  const f = await fixture(t);
  const access = await f.request('/api/business/web-resource-access/slides/native-render', 'renderer', 'GET', f.corePort);
  assert.equal(access.status, 200);
  assert.equal(JSON.parse(access.body).expiresAt, f.renderExpiry);
  assert.equal((await f.request(renderPath, 'renderer', 'POST')).status, 200);
  f.auth.revokeResource(f.renderGrant);
  assert.equal((await f.request(renderPath, 'renderer', 'POST')).status, 403);
  assert.equal((await f.request('/apps/slides/workbench/api/decks', 'renderer')).status, 200);
});

test('revoking render authority closes an active native Slides render response', async t => {
  const f = await fixture(t, { holdRender: true });
  let response, outgoing;
  const disconnected = new Promise((resolve, reject) => {
    outgoing = httpRequest({
      hostname: '127.0.0.1', port: f.port, path: renderPath, method: 'POST',
      headers: { Host: host, Origin: origin, Cookie: f.cookies.renderer },
    }, incoming => {
      response = incoming; assert.equal(incoming.statusCode, 200);
      incoming.once('data', () => f.auth.revokeResource(f.renderGrant));
      incoming.once('aborted', resolve);
      incoming.once('error', error => error.code === 'ECONNRESET' ? resolve() : reject(error));
      incoming.resume();
    });
    outgoing.once('error', error => error.code === 'ECONNRESET' ? resolve() : reject(error));
    outgoing.end();
  });
  let timer;
  try {
    await Promise.race([disconnected, new Promise((_, reject) => {
      timer = setTimeout(() => reject(Error('Native render response stayed open after revocation.')), 2000);
    })]);
  } finally { clearTimeout(timer); response?.destroy(); outgoing.destroy(); }
  assert.equal((await f.request(renderPath, 'renderer', 'POST')).status, 403);
});
