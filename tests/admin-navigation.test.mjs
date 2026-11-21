import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AuthStore, createAuthHandler } from '../src/business/auth.mjs';
import { createAccountHandler } from '../src/business/admin.mjs';
import { createPraxisServer } from '../src/server.mjs';

const password = 'Synthetic-navigation-password-2026';

test('enrolled Calendar opens from the workbench and returns Home at desktop and phone widths', { skip: !process.env.PLAYWRIGHT_MODULE, timeout: 60000 }, async t => {
  const directory = mkdtempSync(join(tmpdir(), 'praxis-admin-navigation-'));
  let gateway, auth, handleAuth, handleAccount;
  const front = createServer((request, response) => gateway.emit('request', request, response));
  await new Promise(resolve => front.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${front.address().port}`;
  auth = new AuthStore({ file: join(directory, 'auth.sqlite'), issuer: origin });
  auth.createUser({ id: 'synthetic-owner', username: 'synthetic-owner', password });
  auth.createUser({ id: 'synthetic-member', username: 'synthetic-member', password });
  auth.createSpace({ id: 'synthetic-navigation', type: 'family', ownerId: 'synthetic-owner' });
  auth.setMembership({ spaceId: 'synthetic-navigation', userId: 'synthetic-member', role: 'member' });
  handleAuth = createAuthHandler({ store: auth, webGateway: { enabled: true } });
  handleAccount = createAccountHandler({ auth });
  const assets = new Set(['admin.html', 'admin.js', 'admin.css', 'app-registry.js']);
  const core = createServer(async (request, response) => {
    try {
      if (await handleAuth(request, response) || await handleAccount(request, response)) return;
      const path = new URL(request.url, origin).pathname;
      if (path === '/api/business/workbench/agenda') return response.writeHead(200, { 'Content-Type': 'application/json' }).end('{"items":[],"partial":false}');
      const asset = path === '/admin/' ? 'admin.html' : path.slice(1);
      if (!assets.has(asset)) return response.writeHead(404).end();
      response.writeHead(200, { 'Content-Type': asset.endsWith('.js') ? 'application/javascript' : asset.endsWith('.css') ? 'text/css' : 'text/html' }).end(readFileSync(new URL('../public/' + asset, import.meta.url)));
    } catch { response.writeHead(500).end(); }
  });
  await new Promise(resolve => core.listen(0, '127.0.0.1', resolve));
  gateway = createPraxisServer({ publicUrlsFile: null, observationsFile: null, businessUrl: null, consoleUpstream: null,
    webGateway: { enabled: true, canonicalUrl: origin, coreUrl: `http://127.0.0.1:${core.address().port}` } });
  t.after(async () => {
    for (const server of [front, core]) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
    auth.close(); rmSync(directory, { recursive: true, force: true });
  });
  const { chromium } = await import(process.env.PLAYWRIGHT_MODULE);
  const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE, args: ['--no-sandbox'] });
  t.after(() => browser.close());
  const evidence = [];
  for (const width of [1440, 390]) {
    const owner = await browser.newContext({ viewport: { width, height: 900 } });
    await owner.addCookies([{ name: 'praxis_locale', value: 'en', url: origin }]);
    assert.equal((await owner.request.post(origin + '/auth/login', { headers: { Origin: origin }, data: { username: 'synthetic-owner', password } })).status(), 200);
    const settings = await owner.newPage();
    await settings.goto(origin + '/admin/?view=spaces&space=synthetic-navigation');
    await settings.locator('.space-app-row[data-app=calendar] a').click();
    await settings.getByRole('button', { name: 'Enable', exact: true }).click();
    await settings.getByRole('button', { name: 'Disable', exact: true }).waitFor();
    const member = await browser.newContext({ viewport: { width, height: 900 } });
    await member.addCookies([{ name: 'praxis_locale', value: 'en', url: origin }]);
    assert.equal((await member.request.post(origin + '/auth/login', { headers: { Origin: origin }, data: { username: 'synthetic-member', password } })).status(), 200);
    const page = await member.newPage(), errors = [];
    page.setDefaultTimeout(10000);
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(origin + '/');
    const tile = page.locator('#apps a[data-app=calendar]');
    await tile.waitFor({ state: 'attached' });
    if (!await tile.isVisible()) await page.locator('#workbench-view-switch').click();
    await tile.waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await tile.click();
    await page.waitForURL(origin + '/apps/calendar/');
    await page.locator('#grid button').first().waitFor();
    await page.locator('#praxis-system-navigation .praxis-home').waitFor({ state: 'visible' });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.locator('#praxis-system-navigation .praxis-home').click();
    await page.waitForURL(origin + '/'); await page.locator('#apps a[data-app=calendar]').waitFor({ state: 'attached' });
    assert.deepEqual(errors, []);
    evidence.push({ width, account: 'synthetic space member', enrollment: 'owner UI', app: 'native Calendar', home: 'injected system navigation', overflow: 0, result: 'Pass' });
    await settings.getByRole('button', { name: 'Disable', exact: true }).click();
    await settings.locator('.confirm-box').getByRole('button', { name: 'Confirm', exact: true }).click();
    await settings.getByRole('button', { name: 'Enable', exact: true }).waitFor();
    await member.close(); await owner.close();
  }
  t.diagnostic(JSON.stringify({ fixture: 'isolated synthetic identity store, real managed web gateway and native Calendar; empty synthetic agenda', browser: browser.version(), evidence }));
});

test('updated platform requirements open in both workbench reader languages', { skip: !process.env.PLAYWRIGHT_MODULE, timeout: 60000 }, async t => {
  const server = createPraxisServer({ observationsFile: null, consoleUpstream: null, businessUrl: null, publicUrlsFile: null });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const { chromium } = await import(process.env.PLAYWRIGHT_MODULE);
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE, args: ['--no-sandbox'] });
  t.after(() => browser.close());
  for (const width of [1440, 390]) for (const [cookie, lang] of [['en', 'en'], ['zh', 'zh-CN']]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    await context.addCookies([{ name: 'praxis_locale', value: cookie, url: origin }]);
    const page = await context.newPage();
    await page.goto(`${origin}/prds/`);
    await page.locator('a.prd-entry[href="/prds/praxis/"]').click();
    await page.waitForURL(`${origin}/prds/praxis/`);
    assert.equal(await page.locator('html').getAttribute('lang'), lang);
    assert.match(await page.locator('body').innerText(), /BUC06/);
    assert.match(await page.locator('body').innerText(), /0\.1\.153/);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    t.diagnostic(JSON.stringify({ width, language: lang, reader: '/prds/praxis/', acceptance: 'BUC06', status: 'Pass' }));
    await context.close();
  }
});
