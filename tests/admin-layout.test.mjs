import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AuthStore, createAuthHandler } from '../src/business/auth.mjs';
import { createAccountHandler, createAdminHandler } from '../src/business/admin.mjs';

// Use a separately provisioned browser dependency, as in business-auth.test.mjs:
// PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs node --test tests/admin-layout.test.mjs
// ADMIN_LAYOUT_ARTIFACTS optionally retains screenshots of synthetic pages only.
const browserEnabled = Boolean(process.env.PLAYWRIGHT_MODULE);
const password = 'Synthetic-layout-password-2026';
const publicRoot = new URL('../public/', import.meta.url);
const apps = [{ id: 'reminder', name: 'Reminder', entry: { policy: 'grant', nativePath: '/apps/reminder/' } }];

async function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'praxis-admin-layout-'));
  let auth, handleAuth, handleAccount, handleAdmin;
  const json = (response, value) => response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(value));
  const server = createServer(async (request, response) => {
    try {
      const path = new URL(request.url, 'http://synthetic.invalid').pathname;
      if (path === '/api/apps') return json(response, { apps });
      if (path === '/api/workbench/providers') return json(response, { schemaVersion: 1, providers: [] });
      // Read-only management DTOs are synthetic: no app or live store is contacted.
      if (path === '/api/business/console/data') return json(response, { schemaVersion: 1, generatedAt: new Date().toISOString(), workspaceRoot: '/synthetic/workspace', apps: [{ id: 'reminder', name: 'Reminder', locations: [{ label: 'Synthetic tasks', kind: 'json', hostPath: '/synthetic/workspace/data/tasks.json' }] }] });
      if (path === '/api/business/admin/mcp') return json(response, { schemaVersion: 1, generatedAt: new Date().toISOString(), endpoints: [{ id: 'business', url: `${auth.issuer}/mcp`, registration: 'registered', authentication: 'oauth2-bearer', discovery: 'authorized-subset', toolCount: 1, apps: [{ name: 'Reminder', adapter: 'configured', activity: 'not_observed' }], tools: [{ name: 'synthetic_reminder_list', description: 'Synthetic read-only capability', action: 'read', readOnly: true, inputFields: ['spaceId'] }] }] });
      if (await handleAuth(request, response) || await handleAccount(request, response) || await handleAdmin(request, response)) return;
      const asset = path === '/admin/' ? 'admin.html' : path.slice(1);
      if (!['admin.html', 'admin.js', 'admin.css', 'i18n.js', 'app-registry.js', 'app-providers.js', 'admin-data.js', 'admin-mcp.js', 'admin-mcp.css'].includes(asset)) return response.writeHead(404).end();
      const type = asset.endsWith('.js') ? 'text/javascript' : asset.endsWith('.css') ? 'text/css' : 'text/html';
      response.writeHead(200, { 'Content-Type': type }).end(readFileSync(new URL(asset, publicRoot)));
    } catch (error) { response.writeHead(500).end(error.message); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  auth = new AuthStore({ file: join(directory, 'auth.sqlite'), issuer: origin });
  auth.createUser({ id: 'a-member', username: 'synthetic-member', password });
  auth.createUser({ id: 'z-owner', username: 'synthetic-owner', password });
  auth.setPlatformAdmin({ userId: 'z-owner', enabled: true });
  auth.createSpace({ id: 'synthetic-family', type: 'family', ownerId: 'z-owner' });
  auth.setMembership({ spaceId: 'synthetic-family', userId: 'a-member', role: 'member' });
  auth.grantResource({ userId: 'a-member', appId: 'reminder', spaceId: 'synthetic-family', actions: ['read'], resources: ['synthetic-record'] });
  auth.createClient({ id: 'synthetic-client', name: 'Synthetic agent', redirectUris: ['https://synthetic.example/callback'] });
  auth.createGrant({ userId: 'a-member', clientId: 'synthetic-client', rules: [{ appId: 'reminder', spaceId: 'synthetic-family', actions: ['read'], resources: ['synthetic-record'] }] });
  handleAuth = createAuthHandler({ store: auth, apps: { reminder: { spaces: ['synthetic-family'] } }, webGateway: { enabled: true } });
  handleAccount = createAccountHandler({ auth }); handleAdmin = createAdminHandler({ auth });
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); auth.close(); rmSync(directory, { recursive: true, force: true }); });
  return { origin, auth };
}

async function ready(page) {
  await page.waitForFunction(() => document.querySelector('#content')?.getAttribute('aria-busy') === 'false');
  assert.equal(await page.locator('#notice.error').count(), 0, await page.locator('#notice').textContent());
}

async function inspectLayout(page, width, view) {
  const result = await page.evaluate(() => {
    const visible = node => node.getClientRects().length > 0;
    const rect = node => { const r = node.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height }; };
    return {
      overflow: document.documentElement.scrollWidth - innerWidth,
      main: rect(document.querySelector('main')),
      forms: [...document.querySelectorAll('main form, main .form-panel')].filter(visible).map(rect),
      notes: [...document.querySelectorAll('.section-note')].filter(visible).map(node => ({ top: parseFloat(getComputedStyle(node).marginTop), bottom: parseFloat(getComputedStyle(node).marginBottom) })),
      rows: [...document.querySelectorAll('.control-row')].filter(visible).map(node => ({ rect: rect(node), display: getComputedStyle(node).display, gap: parseFloat(getComputedStyle(node).gap), children: [...node.children].filter(visible).map(rect) })),
      accountRows: [...document.querySelectorAll('main .account-setting, main .user-row')].filter(visible).map(node => ({ rect: rect(node), children: [...node.children].filter(visible).map(rect) })),
      controls: [...document.querySelectorAll('main input:not([type=checkbox]),main select,main button.primary,main button.quiet-button')].filter(visible).map(node => ({ tag: node.tagName, rect: rect(node) })),
    };
  });
  assert.ok(result.overflow <= 1, `${width}/${view}: horizontal overflow ${result.overflow}`);
  const aligned = (rect, label) => {
    assert.ok(Math.abs(rect.left - result.main.left) <= 1, `${width}/${view}: ${label} starts at the main content edge`);
    assert.ok(Math.abs(rect.right - result.main.right) <= 1, `${width}/${view}: ${label} ends at the main content edge`);
  };
  for (const form of result.forms) aligned(form, 'form');
  for (const note of result.notes) {
    assert.ok(note.top >= 12 && note.bottom >= 12, `${width}/${view}: note lacks spacing ${JSON.stringify(note)}`);
    assert.deepEqual(note, result.notes[0], `${width}/${view}: uniform note rhythm`);
  }
  for (const row of result.rows) {
    aligned(row.rect, 'control row');
    assert.ok(Math.abs(row.children[0].left - result.main.left) <= 1, `${width}/${view}: first control aligns left`);
    assert.ok(Math.abs(row.children.at(-1).right - result.main.right) <= 1, `${width}/${view}: action aligns right`);
    assert.equal(row.display, 'flex', `${width}/${view}: shared flex row`);
    assert.ok(row.gap >= 10, `${width}/${view}: defined control gap`);
    if (row.children.length < 2) continue;
    for (let i = 1; i < row.children.length; i++) {
      const previous = row.children[i - 1], current = row.children[i];
      if (width > 390) assert.ok(current.left >= previous.right + 9, `${width}/${view}: controls and actions share a horizontal row`);
      else assert.ok(current.top >= previous.bottom + 9, `${width}/${view}: stacked phone row has spacing`);
    }
  }
  if (width > 390) for (const row of result.accountRows) {
    aligned(row.rect, 'account/user row');
    assert.ok(Math.abs(row.children[0].left - result.main.left) <= 1, `${width}/${view}: account/user summary aligns left`);
    if (row.children.length > 1) assert.ok(Math.abs(row.children.at(-1).right - result.main.right) <= 1, `${width}/${view}: account/user action aligns right`);
  }
  for (const { rect } of result.controls) assert.ok(rect.height >= (width === 390 ? 44 : 36), `${width}/${view}: control target ${rect.height}`);
  return { view, width, rows: result.rows.length, forms: result.forms.length, accountRows: result.accountRows.length, edgesAligned: true, notes: result.notes.length, controls: result.controls.length, overflow: result.overflow };
}

test('Chromium admin control rows and space actions remain usable at desktop and phone widths', { skip: !browserEnabled, timeout: 120000 }, async t => {
  const { chromium } = await import(process.env.PLAYWRIGHT_MODULE);
  const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE, args: ['--no-sandbox'] });
  t.after(() => browser.close());
  const { origin, auth } = await fixture(t), evidence = [];
  const artifacts = process.env.ADMIN_LAYOUT_ARTIFACTS;
  if (artifacts) mkdirSync(artifacts, { recursive: true });
  for (const [width, language] of [[1440, 'en'], [391, 'en'], [390, 'zh']]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await context.addCookies([{ name: 'praxis_locale', value: language, url: origin }]);
    const login = await context.request.post(`${origin}/auth/login`, { headers: { Origin: origin }, data: { username: 'synthetic-owner', password } });
    assert.equal(login.status(), 200);
    await page.goto(`${origin}/admin/`); await ready(page);
    for (const view of ['general', 'spaces', 'access', 'grants', 'users', 'data', 'mcp']) {
      await page.locator(`#navigation [data-view=${view}]`).click(); await ready(page);
      if (view === 'data') await page.locator('.data-table').waitFor();
      if (view === 'mcp') await page.locator('.mcp-table').first().waitFor();
      if (view === 'users') { await page.locator('[data-user="a-member"] button').click(); await page.locator('#create-user').click(); }
      evidence.push(await inspectLayout(page, width, view));
      if (artifacts) await page.screenshot({ path: join(artifacts, `${width}-${view}.png`), fullPage: true });
      if (view === 'access') {
        const save = page.locator('form button[type=submit]');
        await Promise.all([page.waitForResponse(r => r.request().method() === 'PUT' && r.url().endsWith('/web-access')), save.click()]); await ready(page);
      }
    }
    await page.locator('#navigation [data-view=spaces]').click(); await ready(page);
    const create = page.locator('form').filter({ has: page.locator('select[name=type]') });
    await create.locator('select').selectOption('company');
    await Promise.all([page.waitForResponse(r => r.request().method() === 'POST' && r.url().endsWith('/account/spaces')), create.locator('button[type=submit]').click()]); await ready(page);
    await page.waitForFunction(() => Boolean(document.querySelector('input[name=username]')));
    const spaceId = await page.locator('select[name=space]').inputValue();
    assert.equal(auth.db.prepare('SELECT type FROM auth_spaces WHERE id=?').get(spaceId).type, 'company');
    const enable = page.locator('.account-setting').filter({ hasText: 'Reminder' }).locator('button');
    await Promise.all([page.waitForResponse(r => r.request().method() === 'PUT' && r.url().endsWith('/apps/reminder')), enable.click()]); await ready(page);
    const member = page.locator('form').filter({ has: page.locator('input[name=username]') });
    await member.locator('input').fill('synthetic-member');
    await Promise.all([page.waitForResponse(r => r.request().method() === 'POST' && r.url().endsWith('/members')), member.locator('button[type=submit]').click()]); await ready(page);
    const permission = page.locator('form').filter({ has: page.locator('input[name=resources]') });
    await permission.locator('select[name=userId]').selectOption('a-member');
    await permission.locator('input[name=resources]').fill('synthetic-layout-record');
    await permission.locator('input[type=checkbox][name=read]').check();
    evidence.push(await inspectLayout(page, width, 'spaces-populated'));
    // Native selects retain keyboard focus and values; menu placement itself is
    // browser/OS owned and is not inferred from a DOM bounding box.
    const selects = page.locator('main select');
    for (let index = 0; index < await selects.count(); index++) {
      const select = selects.nth(index), original = await select.inputValue();
      await select.focus(); await select.press('Space');
      if (width > 390) assert.ok(await select.evaluate(node => node.getBoundingClientRect().bottom <= innerHeight - Math.min(320, innerHeight * 0.4) + 1), 'native menu has desktop clearance');
      if (artifacts) await page.screenshot({ path: join(artifacts, `${width}-native-select-${index}.png`) });
      await select.press('Escape');
      assert.equal(await select.inputValue(), original);
      assert.equal(await select.evaluate(node => node.tagName), 'SELECT');
      const outline = await select.evaluate(node => getComputedStyle(node).outlineWidth);
      assert.ok(parseFloat(outline) >= 2, 'keyboard focus remains visible');
    }
    if (width > 390) {
      const lowSelect = permission.locator('select[name=appId]');
      await lowSelect.evaluate(node => { node.blur(); window.scrollBy({ top: node.getBoundingClientRect().bottom - innerHeight + 12, behavior: 'instant' }); });
      await lowSelect.click();
      assert.ok(await lowSelect.evaluate(node => node.getBoundingClientRect().bottom <= innerHeight - 319), 'pointer opening reserves space below a low select');
      if (artifacts) await page.screenshot({ path: join(artifacts, `${width}-low-select-pointer.png`) });
      await lowSelect.press('Escape');
    }
    await Promise.all([page.waitForResponse(r => r.request().method() === 'POST' && r.url().endsWith('/permissions')), permission.locator('button[type=submit]').click()]); await ready(page);
    const saved = auth.db.prepare('SELECT actions,resources FROM auth_resources WHERE space_id=? AND user_id=?').get(spaceId, 'a-member');
    assert.deepEqual(JSON.parse(saved.actions), ['read']); assert.deepEqual(JSON.parse(saved.resources), ['synthetic-layout-record']);
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    const clearance = await page.evaluate(() => innerHeight - Math.max(...[...document.querySelectorAll('main button, main select, main input')].filter(node => node.getClientRects().length).map(node => node.getBoundingClientRect().bottom)));
    assert.ok(clearance >= 64, `bottom control clearance: ${clearance}`);
    assert.deepEqual(errors, []);
    await context.close();
  }
  // The reader runs locally without a business upstream or private deployment
  // configuration. Open the actual changed source documents in both languages.
  const { createPraxisServer } = await import('../src/server.mjs');
  const reader = createPraxisServer({ publicUrlsFile: null, observationsFile: null, businessUrl: null, consoleUpstream: null });
  await new Promise(resolve => reader.listen(0, '127.0.0.1', resolve));
  t.after(async () => { reader.closeAllConnections(); await new Promise(resolve => reader.close(resolve)); });
  const readerContext = await browser.newContext();
  const readerPage = await readerContext.newPage();
  for (const language of ['en', 'zh']) {
    const response = await readerPage.goto(`http://127.0.0.1:${reader.address().port}/prds/praxis/?lang=${language}`);
    assert.equal(response.status(), 200);
    await readerPage.locator('.prd-document').waitFor();
    assert.equal(await readerPage.locator('html').getAttribute('lang'), language === 'en' ? 'en' : 'zh-CN');
    assert.match(await readerPage.locator('.prd-document').innerText(), language === 'en' ? /control.row|control and|management.*layout/i : /控件.*行|管理.*布局/);
    if (artifacts) await readerPage.screenshot({ path: join(artifacts, `prd-${language}.png`) });
  }
  await readerContext.close();
  t.diagnostic(JSON.stringify({ fixture: 'isolated synthetic auth HTTP; synthetic read-only data/MCP projections', browser: browser.version(), evidence }));
});
