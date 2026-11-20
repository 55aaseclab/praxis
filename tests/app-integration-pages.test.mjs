import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AuthStore, SESSION_COOKIE } from '../src/business/auth.mjs';
import { BusinessEvents } from '../src/business/events.mjs';
import { createBusinessServer } from '../src/business/server.mjs';
import { DEFAULT_APP_REGISTRY } from '../src/default-app-registry.mjs';

test('app-owned Core pages and assets retain native session, entry grant and revocation checks', async t => {
  const root = await mkdtemp(join(tmpdir(), 'praxis-owned-pages-'));
  const issuer = 'https://pages.example.test', auth = new AuthStore({ file: join(root, 'auth.db'), issuer }), events = new BusinessEvents(join(root, 'events.db'));
  auth.createUser({ id: 'member', username: 'member', password: 'Synthetic owned page password' });
  auth.setWebAccess({ userId: 'member', apps: [], workbench: true, prds: false });
  const cookie = SESSION_COOKIE + '=' + auth.login({ username: 'member', password: 'Synthetic owned page password' }).sessionToken;
  const config = { issuer, database: auth.file, eventsDatabase: events.file, allowedHosts: [], apps: {} };
  const core = createBusinessServer({ auth, events, config });
  core.listen(0, '127.0.0.1'); await once(core, 'listening'); config.allowedHosts.push('127.0.0.1:' + core.address().port);
  t.after(async () => { await core.core.shutdown(); core.closeAllConnections(); await new Promise(done => core.close(done)); auth.close(); events.close(); await rm(root, { recursive: true, force: true }); });
  const owner = DEFAULT_APP_REGISTRY.apps.find(app => app.integration.web.corePages?.length && app.integration.web.coreAssets?.length);
  assert.ok(owner);
  const paths = [owner.integration.web.corePages[0].path, owner.integration.web.coreAssets[0].path];
  const get = (path, session = cookie) => fetch('http://127.0.0.1:' + core.address().port + path, { headers: { Host: new URL(issuer).host, ...(session ? { Cookie: session } : {}) } });
  for (const path of paths) { const anonymous = await get(path, ''); assert.equal(anonymous.status, 401, await anonymous.text()); const denied = await get(path); assert.equal(denied.status, 403); await denied.body.cancel(); }
  auth.setWebAccess({ userId: 'member', apps: [owner.id], workbench: true, prds: false });
  for (const path of paths) { const response = await get(path); assert.equal(response.status, 200); assert.ok((await response.text()).length); }
  auth.setWebAccess({ userId: 'member', apps: [], workbench: true, prds: false });
  for (const path of paths) { const response = await get(path); assert.equal(response.status, 403); await response.body.cancel(); }
});
