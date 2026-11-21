import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AuthStore } from '../src/business/auth.mjs';
import { BusinessEvents } from '../src/business/events.mjs';
import { createBusinessServer } from '../src/business/server.mjs';
import { createPraxisServer } from '../src/server.mjs';
import { DEFAULT_APP_REGISTRY as registry } from '../src/default-app-registry.mjs';

// Live workbench/admin updates: run with an installed Playwright module and Chromium.
// PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs node --test tests/workbench-live.test.mjs
const browserEnabled = Boolean(process.env.PLAYWRIGHT_MODULE);
const password = 'Synthetic-live-password-2026';

async function reservedPort() {
  const probe = createServer();
  await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  return port;
}

async function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'praxis-live-'));
  const webPort = await reservedPort(), webOrigin = `http://127.0.0.1:${webPort}`;
  const auth = new AuthStore({ file: join(directory, 'auth.sqlite'), issuer: webOrigin });
  const events = new BusinessEvents(join(directory, 'events.db'));
  const config = { issuer: webOrigin, database: auth.file, eventsDatabase: events.file, observationsFile: null, allowedHosts: [], allowedOrigins: [], apps: {}, webGateway: { enabled: true } };
  let core = createBusinessServer({ config, auth, events, pollMs: 40 });
  await new Promise(resolve => core.listen(0, '127.0.0.1', resolve));
  const coreOrigin = `http://127.0.0.1:${core.address().port}`;
  const web = createPraxisServer({ publicUrlsFile: null, observationsFile: null, webGateway: { enabled: true, canonicalUrl: webOrigin, coreUrl: coreOrigin, appTargets: {} } });
  await new Promise(resolve => web.listen(webPort, '127.0.0.1', resolve));
  const corePort = Number(new URL(coreOrigin).port);
  const startCore = async () => {
    core = createBusinessServer({ config, auth, events, pollMs: 40 });
    await new Promise(resolve => core.listen(corePort, '127.0.0.1', resolve));
  };
  const restartCore = async () => {
    core.closeAllConnections();
    await new Promise(resolve => core.close(resolve));
    await core.core.shutdown().catch(() => {});
    await startCore();
  };
  t.after(async () => {
    core.closeAllConnections(); await new Promise(resolve => core.close(resolve)); await core.core.shutdown().catch(() => {});
    web.closeAllConnections(); await new Promise(resolve => web.close(resolve));
    events.close(); auth.close(); rmSync(directory, { recursive: true, force: true });
  });
  return { auth, events, origin: webOrigin, restartCore };
}

async function login(page, origin, username) {
  await page.goto(`${origin}/auth/login?return_to=%2F`);
  await page.fill('input[name="username"]', username);
  await page.fill('input[name="password"]', password);
  await page.click('form button');
  await page.waitForURL(`${origin}/`);
}

test('Chromium workbench updates app tiles and receives change events without a manual reload', { skip: !browserEnabled, timeout: 120000 }, async t => {
  const { chromium } = await import(process.env.PLAYWRIGHT_MODULE);
  const f = await fixture(t);
  f.auth.createUser({ id: 'worker', username: 'worker', password });
  f.auth.createSpace({ id: 'live-family', type: 'family', ownerId: 'worker' });
  f.auth.grantResource({ userId: 'worker', appId: 'reminder', spaceId: 'live-family', actions: ['read'], resources: ['live-record'] });
  f.auth.setWebAccess({ userId: 'worker', apps: ['reminder'], prds: true });
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE, args: ['--no-sandbox'] });
  t.after(async () => browser.close());
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addInitScript(() => {
    window.__liveEvents = [];
    const native = window.EventSource;
    window.EventSource = function (url) {
      const source = new native(url);
      for (const name of ['ready', 'policy', 'change', 'revoked']) {
        source.addEventListener(name, event => {
          let data = null; try { data = JSON.parse(event.data); } catch {}
          window.__liveEvents.push({ type: name, data });
        });
      }
      return source;
    };
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await login(page, f.origin, 'worker');
  await page.waitForFunction(() => document.querySelector('#apps-section')?.hidden === false && document.querySelector('#apps')?.childElementCount > 0, null, { timeout: 15000 });
  assert.equal(await page.locator('#apps .workbench-app[data-app="reminder"]').count(), 1);
  assert.equal(await page.locator('#apps .workbench-app[data-app="knowledge"]').count(), 0);
  await page.evaluate(() => { window.__pageToken = 'original'; });
  const reminderTile = () => page.locator('#apps .workbench-app[data-app="reminder"]').evaluate(node => { const rect = node.getBoundingClientRect(); return [rect.x, rect.y, rect.width, rect.height]; });
  const before = await reminderTile(), scrollBefore = await page.evaluate(() => [scrollX, scrollY]);
  // An authorization change made by another session reaches the open workbench.
  f.auth.setWebAccess({ userId: 'worker', apps: ['reminder', 'knowledge'], prds: true });
  await page.waitForFunction(() => document.querySelector('#apps .workbench-app[data-app="knowledge"]'), null, { timeout: 8000 });
  assert.equal(await page.evaluate(() => window.__pageToken), 'original', 'no full-page reload');
  assert.equal(await page.locator('#apps .workbench-app[data-app="reminder"]').count(), 1, 'no duplicated renders');
  assert.deepEqual(await reminderTile(), before, 'existing tile keeps its geometry');
  assert.deepEqual(await page.evaluate(() => [scrollX, scrollY]), scrollBefore);
  // App data changes stream to the subscribed session.
  f.events.ingest('reminder', 'live-family', { cursor: 2, events: [{ id: 'e1', resourceId: 'live-record', revision: '1', operation: 'change', cursor: 2 }] });
  await page.waitForFunction(() => window.__liveEvents.some(event => event.type === 'change' && event.data?.appId === 'reminder'), null, { timeout: 8000 });
  // Reconnection after a core restart still delivers updates.
  await f.restartCore();
  await page.waitForFunction(() => window.__liveEvents.filter(event => event.type === 'ready').length >= 2, null, { timeout: 30000 });
  f.auth.setWebAccess({ userId: 'worker', apps: ['knowledge'], prds: true });
  await page.waitForFunction(() => !document.querySelector('#apps .workbench-app[data-app="reminder"]'), null, { timeout: 15000 });
  assert.equal(await page.evaluate(() => window.__pageToken), 'original');
  // Phone width: the same live update path with no horizontal overflow.
  const phone = await context.newPage();
  await phone.setViewportSize({ width: 390, height: 844 });
  await login(phone, f.origin, 'worker');
  await phone.waitForFunction(() => document.querySelector('#apps-section')?.hidden === false && document.querySelector('#apps')?.childElementCount > 0, null, { timeout: 15000 });
  f.auth.setWebAccess({ userId: 'worker', apps: ['reminder', 'knowledge'], prds: true });
  await phone.waitForFunction(() => document.querySelector('#apps .workbench-app[data-app="knowledge"]'), null, { timeout: 8000 });
  assert.equal(await phone.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true, 'no horizontal overflow at 390 px');
  await phone.close();
  assert.deepEqual(errors, []);
});

test('Chromium admin console refreshes Spaces from policy events and reconnects after restart', { skip: !browserEnabled, timeout: 120000 }, async t => {
  const { chromium } = await import(process.env.PLAYWRIGHT_MODULE);
  const f = await fixture(t);
  f.auth.createUser({ id: 'z-admin', username: 'synthetic-admin', password });
  f.auth.setPlatformAdmin({ userId: 'z-admin', enabled: true });
  f.auth.createSpace({ id: 'live-family', type: 'family', ownerId: 'z-admin' });
  f.auth.createUser({ id: 'worker', username: 'worker', password });
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE, args: ['--no-sandbox'] });
  t.after(async () => browser.close());
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${f.origin}/auth/login?return_to=${encodeURIComponent('/admin/?view=spaces&space=live-family')}`);
  await page.fill('input[name="username"]', 'synthetic-admin');
  await page.fill('input[name="password"]', password);
  await page.click('form button');
  await page.waitForSelector('#content[aria-busy="false"]');
  await page.waitForSelector('li.user-row[data-member="z-admin"]');
  assert.equal(await page.locator('li.user-row[data-member="worker"]').count(), 0);
  await page.evaluate(() => { window.__pageToken = 'original'; });
  const scrollBefore = await page.evaluate(() => [scrollX, scrollY]);
  const membersHeading = () => page.locator('main h2', { hasText: 'Members' }).first().evaluate(node => { const rect = node.getBoundingClientRect(); return [rect.x, rect.y]; });
  const headingBefore = await membersHeading();
  f.auth.setMembership({ spaceId: 'live-family', userId: 'worker', role: 'member' });
  await page.waitForFunction(() => document.querySelector('li.user-row[data-member="worker"]'), null, { timeout: 8000 });
  assert.equal(await page.evaluate(() => window.__pageToken), 'original', 'no full-page reload');
  assert.equal(await page.locator('li.user-row[data-member="worker"]').count(), 1, 'no duplicated renders');
  assert.deepEqual(await page.evaluate(() => [scrollX, scrollY]), scrollBefore);
  assert.deepEqual(await membersHeading(), headingBefore, 'surrounding layout keeps its position');
  await f.restartCore();
  await page.waitForFunction(() => !document.querySelector('li.user-row[data-member="worker"]'), null, { timeout: 30000 }).catch(() => {});
  f.auth.setMembership({ spaceId: 'live-family', userId: 'worker', role: null });
  await page.waitForFunction(() => !document.querySelector('li.user-row[data-member="worker"]'), null, { timeout: 15000 });
  assert.equal(await page.evaluate(() => window.__pageToken), 'original');
  assert.deepEqual(errors, []);
});
