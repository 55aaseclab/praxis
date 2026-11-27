import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { AuthStore, createAuthHandler, SESSION_COOKIE } from '../src/business/auth.mjs';
import { createPraxisServer } from '../src/server.mjs';
import { loadAppIntegrations } from '../src/app-integrations.mjs';
import { writeInstalledAppsFixture } from './helpers/app-manifest-fixture.mjs';
import { appFact, setAppFacts } from '../public/app-registry.js';

test('an additional app owns its native slug and authenticated gateway/Home routes without changing a platform table', async t => {
  const root = await mkdtemp(join(tmpdir(), 'praxis-extra-native-')); t.after(() => rm(root, { recursive: true, force: true }));
  await writeInstalledAppsFixture(root, [{ id: 'field-notes', name: 'Field notes' }]);
  await writeFile(join(root, 'third_party/field-notes/praxis-integration.mjs'), `export function createIntegration(){return {schemaVersion:1,appId:'field-notes',web:{slug:'field-journal',policy:'grant',kind:'proxy',nativePort:45125,noNavigationPrefixes:['/api']}}}`);
  const registry = await loadAppIntegrations(root), host = 'native-app.synthetic.test', canonical = 'https://' + host;
  const published = registry.publicFacts();
  assert.equal(published[0].kind, 'app'); assert.equal(published[0].entry.nativePath, '/apps/field-journal/'); assert.equal(published[0].icon, '/app-icons/field-notes.svg');
  setAppFacts(published); assert.equal(appFact('field-notes').entry.nativePath, '/apps/field-journal/'); assert.equal(appFact('field-notes').icon, published[0].icon);
  const auth = new AuthStore({ file: join(root, 'auth.sqlite'), issuer: canonical, registry });
  for (const id of ['owner', 'denied']) auth.createUser({ id, username: id, password: 'Synthetic source-owned app password' });
  auth.setWebAccess({ userId: 'owner', apps: ['field-notes'], workbench: true, prds: false });
  auth.setWebAccess({ userId: 'denied', apps: [], workbench: true, prds: false });
  const cookie = id => SESSION_COOKIE + '=' + auth.login({ username: id, password: 'Synthetic source-owned app password' }).sessionToken;
  const owner = cookie('owner'), denied = cookie('denied'), handler = createAuthHandler({ store: auth, webGateway: { enabled: true } });
  const core = createServer(async (request, response) => {
    if (request.url === '/app-registry.js') { response.writeHead(200, { 'Content-Type': 'text/javascript' }); response.end(await readFile(resolve('public/app-registry.js'))); return; }
    if (!await handler(request, response)) response.writeHead(404).end();
  });
  const nativeCalls = [], native = createServer((request, response) => {
    nativeCalls.push(request.url);
    if (request.url === '/api/items') { response.writeHead(200, { 'Content-Type': 'application/json' }); response.end('{"items":[]}'); }
    else { response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); response.end('<!doctype html><html><head><title>Synthetic field app</title></head><body><h1>Source-owned native app</h1></body></html>'); }
  });
  let web;
  t.after(async () => { for (const server of [web, native, core]) if (server) { server.webGateway?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } auth.close(); });
  core.listen(0, '127.0.0.1'); native.listen(0, '127.0.0.1'); await Promise.all([once(core, 'listening'), once(native, 'listening')]);
  web = createPraxisServer({ root, publicDir: resolve('public'), registry, publicUrlsFile: null, observationsFile: null, businessUrl: null, consoleUpstream: null, webGateway: { enabled: true, canonicalUrl: canonical, coreUrl: `http://127.0.0.1:${core.address().port}`, appTargets: { 'field-notes': `http://127.0.0.1:${native.address().port}` } } });
  web.listen(0, '127.0.0.1'); await once(web, 'listening');
  const request = (path, session) => new Promise((resolve, reject) => {
    const outgoing = httpRequest({ hostname: '127.0.0.1', port: web.address().port, path, headers: { Host: host, ...(session ? { Cookie: session } : {}) } }, incoming => {
      const parts = []; incoming.on('data', part => parts.push(part)); incoming.on('error', reject); incoming.on('end', () => { const body = Buffer.concat(parts).toString(); resolve({ status: incoming.statusCode, headers: { get: key => incoming.headers[key.toLowerCase()] }, text: async () => body, json: async () => JSON.parse(body) }); });
    }); outgoing.on('error', reject); outgoing.end();
  });
  assert.equal((await request('/apps/field-journal/', null)).status, 401);
  assert.equal((await request('/apps/field-journal/', denied)).status, 403); assert.equal(nativeCalls.length, 0);
  const page = await request('/apps/field-journal/', owner); assert.equal(page.status, 200); const html = await page.text(); assert.match(html, /Source-owned native app/); assert.match(html, /data-app-id="field-notes"/); assert.match(html, /praxis-nav\.js/);
  const api = await request('/apps/field-journal/api/items', owner); assert.equal(api.status, 200); assert.deepEqual(await api.json(), { items: [] });
  const facts = await (await request('/api/apps', owner)).json(); assert.equal(facts.apps[0].entry.nativePath, '/apps/field-journal/'); assert.equal(facts.apps[0].entry.policy, 'grant'); assert.equal(facts.apps[0].source, undefined);
  const asset = await request('/app-registry.js', owner); assert.equal(asset.status, 200); assert.match(asset.headers.get('Content-Type'), /javascript/); assert.match(await asset.text(), /setAppFacts/);
  const before = nativeCalls.length; auth.setWebAccess({ userId: 'owner', apps: [], workbench: true, prds: false });
  assert.equal((await request('/apps/field-journal/api/items', owner)).status, 403); assert.equal(nativeCalls.length, before);
});
