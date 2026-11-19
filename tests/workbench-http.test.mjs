import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createPraxisServer } from '../src/server.mjs';

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
  assert.deepEqual((await registry.json()).apps, []);
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
