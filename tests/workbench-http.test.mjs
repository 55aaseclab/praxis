import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createPraxisServer, WORKSPACE_ROOT } from '../src/server.mjs';
import { readApps } from '../src/apps.mjs';
import { gatewayApps } from '../src/web-gateway.mjs';

async function start(t, options = {}) {
  const server = createPraxisServer({
    observationsFile: null, consoleUpstream: null, businessUrl: null,
    publicUrlsFile: null, ...options,
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  });
  const base = 'http://127.0.0.1:' + server.address().port;
  return (pathname, options) => fetch(base + pathname, { redirect: 'manual', ...options });
}

test('fresh checkout serves the workbench without revealing an owner collection', async t => {
  const request = await start(t);
  const page = await request('/');
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-type'), /text\/html/);
  assert.match(await page.text(), /Praxis/);
  const registry = await request('/api/apps');
  assert.equal(registry.status, 200);
  const { apps } = await registry.json();
  assert.deepEqual(apps.map(app => app.id).sort(), [
    'calendar', 'finance', 'intelligence', 'knowledge', 'lattice-slides', 'matrix-reader',
    'memo', 'projects', 'reminder', 'tingproof', 'travel',
  ]);
  for (const app of apps.filter(app => !['calendar', 'matrix-reader'].includes(app.id))) {
    assert.equal(app.unavailable, 'managed');
    assert.equal(app.url ?? app.path ?? app.port, undefined);
  }
  for (const id of ['letters', 'profiles', 'polaris']) assert.equal((await request('/apps/' + id + '/')).status, 404);
  const health = await request('/health');
  assert.equal((await health.json()).status, 'ok');
});

test('a standalone workbench discovers a local app while keeping an owner-only app private', async t => {
  const root = await mkdtemp(join(tmpdir(), 'praxis-launcher-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'config'));
  const sample = { id: 'sample', kind: 'app', name: 'Sample app', icon: '/sample.svg', path: '/', port: 5567 };
  const hidden = { ...sample, id: 'private-app', adminOnly: true };
  await writeFile(join(root, 'config/apps.json'), JSON.stringify([sample, hidden]));

  const request = await start(t, { root });
  const result = await request('/api/apps');
  assert.equal(result.status, 200);
  const { apps } = await result.json();
  assert.equal(apps.length, 1);
  assert.equal(apps[0].id, 'sample');
  assert.equal(apps[0].port, 5567);
  assert.equal((await request('/api/apps', { method: 'POST' })).status, 405);
});

test('installed Calendar serves its page, navigation and named assets only', async t => {
  const root = await mkdtemp(join(tmpdir(), 'praxis-calendar-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const directory = join(root, 'third_party/calendar/public');
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, 'index.html'), '<html><head><title>Calendar</title></head><body></body></html>');
  await writeFile(join(directory, 'calendar.js'), '// synthetic');
  const request = await start(t, { root, publicDir: new URL('../public/', import.meta.url).pathname });
  const page = await request('/apps/calendar/');
  assert.equal(page.status, 200);
  assert.match(await page.text(), /data-app-id="calendar"/);
  assert.equal((await request('/apps/calendar/calendar.js')).status, 200);
  assert.equal((await request('/apps/calendar/api/records')).status, 404);
  assert.equal((await request('/praxis-nav.js')).status, 200);
  assert.equal((await request('/')).status, 200);
});

test('the shipped directory preserves managed grants, owner readers and the Projects directory', async () => {
  const registered = await readApps(WORKSPACE_ROOT, { publicUrlsFile: null });
  const origin = 'https://workbench.example.test';
  const list = identity => gatewayApps(registered, identity, origin);
  const grants = { apps: ['calendar', 'projects', 'letters', 'polaris'] };
  const ordinary = list(grants);
  assert.deepEqual(ordinary.map(app => app.id).sort(), ['calendar', 'projects']);
  assert.equal(ordinary.find(app => app.id === 'projects').launcher, false);
  assert.deepEqual(list({ ...grants, platformAdmin: true }).map(app => app.id).sort(), ['calendar', 'polaris', 'projects']);
  const owner = list({ apps: registered.map(app => app.id), platformAdmin: true, documentOwner: true });
  assert.equal(owner.length, 14);
  assert.equal(owner.find(app => app.id === 'lattice-slides').url, origin + '/apps/slides/');
});
