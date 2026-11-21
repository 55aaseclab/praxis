import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AuthStore, createAuthHandler } from '../src/business/auth.mjs';
import { createAccountHandler, createAdminHandler } from '../src/business/admin.mjs';
import { DEFAULT_APP_REGISTRY as registry } from '../src/default-app-registry.mjs';

// Use a separately provisioned browser dependency, as in business-auth.test.mjs:
// PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs node --test tests/admin-layout.test.mjs
// ADMIN_LAYOUT_ARTIFACTS optionally retains screenshots of synthetic pages only.
// ADMIN_LAYOUT_HEADED=1 uses a real display (or Xvfb) for native-popup review.
const browserEnabled = Boolean(process.env.PLAYWRIGHT_MODULE);
const password = 'Synthetic-layout-password-2026';
const publicRoot = new URL('../public/', import.meta.url);
const apps = registry.publicFacts();

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
      if (path === '/api/platform/status') return json(response, { schemaVersion: 1, generatedAt: new Date().toISOString(), sections: { permissions: { state: 'ready', platformAdmin: true, spaces: 0, resourcePermissions: 0, activeGrants: 0, revokedGrants: 0, managedApps: 1, unmanagedApps: 0 }, connections: { state: 'ready', apps: [] }, storage: { state: 'unknown' } } });
      if (path === '/api/platform/observations') return json(response, { status: 'empty', generated_at: new Date().toISOString(), window: 'day', truncated: false });
      if (path === '/api/platform/traces') return json(response, { schemaVersion: 1, state: 'empty', source: 'mcp', items: [], nextCursor: null });
      if (path === '/api/business/console/data') return json(response, { schemaVersion: 1, generatedAt: new Date().toISOString(), workspaceRoot: '/synthetic/workspace', apps: [{ id: 'reminder', name: 'Reminder', locations: [{ label: 'Synthetic tasks', kind: 'json', hostPath: '/synthetic/workspace/data/tasks.json' }] }] });
      if (path === '/api/business/admin/mcp') return json(response, { schemaVersion: 1, generatedAt: new Date().toISOString(), endpoints: [{ id: 'business', url: `${auth.issuer}/mcp`, registration: 'registered', authentication: 'oauth2-bearer', discovery: 'authorized-subset', toolCount: 1, apps: [{ name: 'Reminder', adapter: 'configured', activity: 'not_observed' }], tools: [{ name: 'synthetic_reminder_list', description: 'Synthetic read-only capability', action: 'read', readOnly: true, inputFields: ['spaceId'] }] }] });
      if (await handleAuth(request, response) || await handleAccount(request, response) || await handleAdmin(request, response)) return;
      if (path === '/vendor/chartjs-4.6.1.umd.min.js') return response.writeHead(200, { 'Content-Type': 'text/javascript' }).end(readFileSync(new URL('../node_modules/chart.js/dist/chart.umd.min.js', import.meta.url)));
      const asset = path === '/admin/' ? 'admin.html' : path.slice(1);
      if (!['admin.html', 'admin.js', 'admin.css', 'i18n.js', 'app-registry.js', 'app-providers.js', 'admin-data.js', 'admin-mcp.js', 'admin-mcp.css', 'platform.js', 'platform.css', 'platform-charts.js', 'vendor/chartjs-4.6.1.umd.min.js'].includes(asset)) return response.writeHead(404).end();
      const type = asset.endsWith('.js') ? 'text/javascript' : asset.endsWith('.css') ? 'text/css' : 'text/html';
      response.writeHead(200, { 'Content-Type': type }).end(readFileSync(new URL(asset, publicRoot)));
    } catch (error) { if (!response.headersSent) response.writeHead(500); response.end(error.message); }
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
  handleAuth = createAuthHandler({ store: auth, apps: Object.fromEntries(Object.keys(registry.businessActions).map(id => [id, { spaces: ['synthetic-family'] }])), webGateway: { enabled: true } });
  handleAccount = createAccountHandler({ auth }); handleAdmin = createAdminHandler({ auth });
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); auth.close(); rmSync(directory, { recursive: true, force: true }); });
  return { origin, auth };
}

async function ready(page, { allowError = false } = {}) {
  await page.waitForFunction(() => document.querySelector('#content')?.getAttribute('aria-busy') === 'false');
  if (!allowError) assert.equal(await page.locator('#notice.error').count(), 0, await page.locator('#notice').textContent());
}

async function layoutGeometry(page) {
  return page.evaluate(() => ({
    scroll: [scrollX, scrollY],
    rects: [...document.querySelectorAll('main, #heading, main form')].map(node => {
      const rect = node.getBoundingClientRect(); return [rect.x, rect.y, rect.width, rect.height];
    }),
  }));
}

async function inspectSeparators(page, width, view) {
  const result = await page.evaluate(() => {
    const visible = node => node.getClientRects().length > 0;
    const borders = node => ({ top: parseFloat(getComputedStyle(node).borderTopWidth), bottom: parseFloat(getComputedStyle(node).borderBottomWidth) });
    const rows = [...document.querySelectorAll('main .account-setting, main .user-row, main .grant-row')].filter(visible).map(node => ({
      ...borders(node), adjacent: node.previousElementSibling?.matches('.account-setting, .user-row, .grant-row') || false,
    }));
    const sections = [...document.querySelectorAll('#content > .editor, .space-section, .editor > .editor')].filter(visible).map(node => ({
      ...borders(node), first: !node.previousElementSibling,
    }));
    return { rows, sections };
  });
  for (const row of result.rows) {
    assert.equal(row.bottom, 0, `${width}/${view}: rows do not add a second trailing separator`);
    assert.equal(row.top, row.adjacent ? 1 : 0, `${width}/${view}: one separator between adjacent rows`);
  }
  for (const section of result.sections) {
    assert.equal(section.bottom, 0, `${width}/${view}: sections own no trailing separator`);
    if (section.first) assert.equal(section.top, 0, `${width}/${view}: first section does not repeat its parent's separator`);
    else assert.equal(section.top, 1, `${width}/${view}: one leading section separator`);
  }
  return { width, view, rows: result.rows.length, sections: result.sections.length, status: 'Pass' };
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
      controls: [...document.querySelectorAll('main input:not([type=checkbox]),main select,main button.primary,main button.quiet-button,main a.quiet-button')].filter(visible).map(node => ({ tag: node.tagName, rect: rect(node) })),
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

async function inspectSelectStability(page, width, view, artifacts) {
  const selects = page.locator('main select:visible'), evidence = [];
  for (let index = 0; index < await selects.count(); index++) {
    const select = selects.nth(index), original = await select.inputValue();
    for (const placement of ['normal', 'low']) for (const method of ['pointer', 'keyboard']) {
      // Prepare the viewport before taking the baseline. Use real mouse input,
      // rather than locator.click(), which can hide a regression by scrolling.
      await select.evaluate((node, placement) => {
        document.activeElement?.blur();
        node.scrollIntoView({ block: 'center', behavior: 'instant' });
        if (placement === 'low') window.scrollBy({ top: node.getBoundingClientRect().bottom - innerHeight + 16, behavior: 'instant' });
      }, placement);
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const baseline = await select.evaluate(node => {
        const rect = node.getBoundingClientRect();
        const snapshot = () => ({
          scroll: [scrollX, scrollY],
          layout: [...document.querySelectorAll('main, .sidebar, main select, main input, main button, main .field, main .section-note')]
            .filter(element => element.getClientRects().length).map(element => {
              const r = element.getBoundingClientRect(); return [r.x, r.y, r.width, r.height];
            }),
        });
        const initial = snapshot();
        window.selectProbe = { initial, snapshot, changes: [], shifts: [] };
        const probe = window.selectProbe;
        probe.observer = new PerformanceObserver(list => probe.shifts.push(...list.getEntries().map(entry => entry.value)));
        probe.observer.observe({ type: 'layout-shift' });
        const tick = () => {
          const current = snapshot();
          if (JSON.stringify(current) !== JSON.stringify(initial)) probe.changes.push(current);
          probe.frame = requestAnimationFrame(tick);
        };
        probe.frame = requestAnimationFrame(tick);
        return { ...initial, point: { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }, bottom: rect.bottom };
      });
      const label = `${width}/${view}/${index}/${placement}/${method}`;
      assert.ok(baseline.point.y > 0 && baseline.bottom <= 900, `${label}: control fully visible before opening`);
      const unchanged = async phase => {
        const current = await page.evaluate(() => window.selectProbe.snapshot());
        assert.deepEqual(current.scroll, baseline.scroll, `${label}/${phase}: zero scroll delta`);
        assert.deepEqual(current.layout, baseline.layout, `${label}/${phase}: zero layout movement`);
      };
      if (method === 'pointer') await page.mouse.click(baseline.point.x, baseline.point.y);
      else {
        await select.focus();
        await unchanged('focus');
        await page.keyboard.press('Space');
      }
      await page.waitForTimeout(80);
      assert.equal(await select.evaluate(node => node.matches(':open')), true, `${label}: native popup is open`);
      await unchanged('open');
      if (artifacts) await page.screenshot({ path: join(artifacts, `${width}-${view}-select-${index}-${placement}-${method}.png`) });
      await page.keyboard.press('Escape');
      await page.waitForTimeout(80);
      assert.equal(await select.evaluate(node => node.matches(':open')), false, `${label}: native popup is closed`);
      await unchanged('closed');
      const probe = await page.evaluate(() => {
        const probe = window.selectProbe;
        cancelAnimationFrame(probe.frame); probe.observer.disconnect(); delete window.selectProbe;
        return { changes: probe.changes, shifts: probe.shifts };
      });
      assert.deepEqual(probe.changes, [], `${label}: no transient scroll/layout movement`);
      assert.deepEqual(probe.shifts, [], `${label}: no layout-shift entries, including recent input`);
      assert.equal(await select.inputValue(), original, `${label}: Escape preserves selection`);
      assert.equal(await select.evaluate(node => document.activeElement === node), true, `${label}: retains focus`);
      if (method === 'keyboard') assert.ok(parseFloat(await select.evaluate(node => getComputedStyle(node).outlineWidth)) >= 2, `${label}: visible focus`);
      evidence.push({ index, placement, method, scrollY: baseline.scroll[1], scrollDelta: 0, layoutShift: 0 });
    }
  }
  return { width, view, selects: await selects.count(), interactions: evidence,
    ...(await selects.count() === 0 ? { status: 'N/A', reason: 'No native selects in this view' } : { status: 'Pass' }) };
}

test('Chromium admin control rows and space actions remain usable at desktop and phone widths', { skip: !browserEnabled, timeout: 240000 }, async t => {
  const { chromium } = await import(process.env.PLAYWRIGHT_MODULE);
  // Native popups use the underlying screen, not Playwright's page viewport.
  // Chromium's default 800px headless screen otherwise clips wide menus.
  const browser = await chromium.launch({ headless: !process.env.ADMIN_LAYOUT_HEADED, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE, args: ['--no-sandbox', '--ozone-override-screen-size=1440,1000'] });
  t.after(() => browser.close());
  const { origin, auth } = await fixture(t), evidence = [], selectEvidence = [], separatorEvidence = [], lifecycleEvidence = [];
  const artifacts = process.env.ADMIN_LAYOUT_ARTIFACTS;
  if (artifacts) mkdirSync(artifacts, { recursive: true });
  for (const [width, language] of [[1440, 'en'], [391, 'en'], [390, 'zh']]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    const page = await context.newPage(), errors = [], dialogs = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('dialog', async dialog => { dialogs.push({ type: dialog.type(), message: dialog.message() }); await dialog.accept(); });
    await context.addCookies([{ name: 'praxis_locale', value: language, url: origin }]);
    const login = await context.request.post(`${origin}/auth/login`, { headers: { Origin: origin }, data: { username: 'synthetic-owner', password } });
    assert.equal(login.status(), 200);
    await page.goto(`${origin}/admin/`); await ready(page);
    for (const view of ['general', 'spaces', 'access', 'grants', 'users', 'data', 'mcp', 'overview']) {
      await page.locator(`#navigation [data-view=${view}]`).click(); await ready(page);
      await page.reload(); await ready(page);
      assert.equal(await page.locator(`#navigation [data-view=${view}]`).getAttribute('aria-current'), 'page', `${view} sidebar route survives reload`);
      if (view === 'data') await page.locator('.data-table').waitFor();
      if (view === 'mcp') await page.locator('.mcp-table').first().waitFor();
      if (view === 'overview') { await page.locator('#platform-traces [data-scope=mcp-summary]').waitFor(); await page.locator('#platform-observations [data-scope=methodology]').waitFor(); }
      if (view === 'users') { await page.locator('[data-user="a-member"] button').click(); await page.locator('#create-user').click(); }
      evidence.push(await inspectLayout(page, width, view));
      separatorEvidence.push(await inspectSeparators(page, width, view));
      selectEvidence.push(await inspectSelectStability(page, width, view, artifacts));
      if (artifacts) await page.screenshot({ path: join(artifacts, `${width}-${view}.png`), fullPage: true });
      if (view === 'access') {
        const save = page.locator('form button[type=submit]');
        await Promise.all([page.waitForResponse(r => r.request().method() === 'PUT' && r.url().endsWith('/web-access')), save.click()]); await ready(page);
        assert.equal(await page.locator('#notice').textContent(), '', 'saving app access shows no success notice');
      }
    }
    await page.locator('#navigation [data-view=spaces]').click(); await ready(page);
    const create = page.locator('form').filter({ has: page.locator('select[name=type]') });
    assert.equal(await create.evaluate(node => Boolean(node.compareDocumentPosition(document.querySelector('.space-overview')) & Node.DOCUMENT_POSITION_FOLLOWING)), true, 'New space remains above the space overview');
    await create.locator('select').selectOption('company');
    await Promise.all([page.waitForResponse(r => r.request().method() === 'POST' && r.url().endsWith('/account/spaces')), create.locator('button[type=submit]').click()]); await ready(page);
    assert.equal(await page.locator('#notice').textContent(), '', 'space creation shows no success notice');
    assert.equal(dialogs.at(-1)?.type, 'alert', 'success appears in a browser alert');
    assert.match(dialogs.at(-1)?.message || '', /Space created|空间已创建/, 'success alert names the completed operation');
    await page.waitForFunction(() => Boolean(document.querySelector('input[name=username]')));
    const spaceId = await page.locator('select[name=space]').inputValue();
    assert.equal(auth.db.prepare('SELECT type FROM auth_spaces WHERE id=?').get(spaceId).type, 'company');
    const text = (english, chinese) => language === 'en' ? english : chinese;
    const manage = async id => {
      await page.locator(`.space-app-row[data-app="${id}"]`).getByRole('link', { name: language === 'en' ? /^Manage / : /^管理 / }).click();
      await ready(page);
      assert.equal(new URL(page.url()).searchParams.get('app'), id);
      assert.equal(await page.locator('select[name=appId]').count(), 0, 'grant form is scoped to the current app');
      assert.equal(await page.locator('.space-app-row').count(), 0, 'app management is a separate screen');
    };
    const back = async () => { await page.locator('.space-back').click(); await ready(page); };
    const write = async (method, suffix, action) => {
      await Promise.all([page.waitForResponse(r => r.request().method() === method && r.url().endsWith(suffix)), action()]);
      await ready(page);
      assert.equal(await page.locator('#notice.success').count(), 0, 'successful operations show no success notice');
      assert.equal(await page.locator('#notice').textContent(), '', 'successful operations leave the notice empty');
    };
    const confirm = () => page.locator('.confirm-box').getByRole('button', { name: text('Confirm', '确认'), exact: true }).click();
    assert.equal(await page.locator('.space-app-row').count(), 14, 'overview lists every installed app');
    assert.equal(await page.locator('input[name=resources]').count(), 0, 'overview has no resource grant controls');
    assert.equal(await page.locator('select[name=appId]').count(), 0, 'overview has no app grant selector');
    if (artifacts) await page.screenshot({ path: join(artifacts, `${width}-spaces-overview.png`), fullPage: true });
    for (const app of apps) {
      const id = app.entry.adapterId || app.id;
      const row = page.locator(`.space-app-row[data-app="${id}"]`);
      assert.equal(await row.count(), 1, `${app.name} is listed once`);
      assert.match(await row.innerText(), app.entry.adapterId ? /Agent business actions supported|支持智能体业务操作/ : /No agent business actions|不支持智能体业务操作/);
      assert.equal(await row.getByRole('link', { name: language === 'en' ? /^Manage / : /^管理 / }).count(), 1);
      await manage(id);
      assert.match(await page.locator('main').innerText(), new RegExp(app.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
      assert.equal(await page.locator('input[name=resources]').count(), 0, 'disabled or non-business apps have no grant form');
      separatorEvidence.push(await inspectSeparators(page, width, `space-app-${id}`));
      await back();
    }
    const member = page.locator('form').filter({ has: page.locator('input[name=username]') });
    await member.locator('input').fill('synthetic-member');
    await write('POST', '/members', () => member.locator('button[type=submit]').click());
    // Navigation preserves the selected space without introducing a success notice.
    assert.equal(await page.locator('#notice').textContent(), '');
    await manage('reminder');
    assert.equal(await page.locator('#notice').textContent(), '');
    await write('PUT', '/apps/reminder', () => page.getByRole('button', { name: text('Enable', '启用'), exact: true }).click());
    let permission = page.locator('form').filter({ has: page.locator('input[name=resources]') });
    await permission.locator('select[name=userId]').selectOption('a-member');
    await permission.locator('input[name=resources]').fill('synthetic-layout-record');
    await permission.locator('input[type=checkbox][name=read]').check();
    evidence.push(await inspectLayout(page, width, 'space-reminder-enabled'));
    separatorEvidence.push(await inspectSeparators(page, width, 'space-reminder-enabled'));
    // Re-enter the app to measure native popup stability without edited form state.
    await back(); await manage('reminder');
    permission = page.locator('form').filter({ has: page.locator('input[name=resources]') });
    selectEvidence.push(await inspectSelectStability(page, width, 'space-reminder-enabled', artifacts));
    await permission.locator('select[name=userId]').selectOption('a-member');
    await permission.locator('input[name=resources]').fill('synthetic-layout-record');
    if (width === 1440) {
      const grant = permission.locator('button[type=submit]');
      await grant.scrollIntoViewIfNeeded();
      const beforeError = await layoutGeometry(page);
      await permission.locator('button[type=submit]').click();
      assert.match(await page.locator('#notice.error').textContent(), /Choose at least one action/);
      assert.equal(await page.locator('#notice').evaluate(node => getComputedStyle(node).position), 'fixed', 'errors do not insert a text row');
      assert.deepEqual(await layoutGeometry(page), beforeError, 'showing an error preserves main, heading, form and scroll geometry');
      await page.waitForTimeout(5200);
      assert.equal(await page.locator('#notice.error').count(), 1, 'errors persist until addressed');
      await page.locator('#navigation [data-view=general]').click(); await ready(page, { allowError: true });
      assert.equal(await page.locator('#notice.error').count(), 1, 'view changes preserve unresolved errors');
      await page.locator('#navigation [data-view=spaces]').click(); await ready(page, { allowError: true });
      await page.locator('.space-app-row[data-app="reminder"]').getByRole('link', { name: /^Manage / }).click(); await ready(page, { allowError: true });
      permission = page.locator('form').filter({ has: page.locator('input[name=resources]') });
      await permission.locator('select[name=userId]').selectOption('a-member');
      await permission.locator('input[name=resources]').fill('synthetic-layout-record');
    }
    await permission.locator('input[type=checkbox][name=read]').check();
    if (width === 1440) {
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      const beforeSave = await layoutGeometry(page), originalForm = await permission.elementHandle();
      const detailUrl = `${origin}/api/business/account/spaces/${spaceId}`;
      let releaseRead, sawRefresh, finishedRead;
      const blocked = new Promise(resolve => { releaseRead = resolve; });
      const refreshing = new Promise(resolve => { sawRefresh = resolve; });
      const handled = new Promise(resolve => { finishedRead = resolve; });
      const delayedRead = async route => { sawRefresh(); await blocked; try { await route.continue(); } finally { finishedRead(); } };
      await page.route(detailUrl, delayedRead);
      try {
        await Promise.all([page.waitForResponse(r => r.request().method() === 'POST' && r.url().endsWith('/permissions')), permission.locator('button[type=submit]').click()]);
        await refreshing;
        assert.equal(await originalForm.evaluate(node => node.isConnected && node.getClientRects().length > 0), true, 'pending refresh retains the actual form');
        for (let frame = 0; frame < 3; frame++) {
          await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
          assert.deepEqual(await layoutGeometry(page), beforeSave, 'pending save refresh preserves content and bottom scroll position');
        }
      } finally { releaseRead(); await handled; await page.unroute(detailUrl, delayedRead); }
      await ready(page);
      assert.equal(await page.locator('#notice').textContent(), '', 'completed save shows no success notice');
    } else await write('POST', '/permissions', () => permission.locator('button[type=submit]').click());
    let saved = auth.db.prepare('SELECT id,app_id,actions,resources FROM auth_resources WHERE space_id=? AND user_id=?').get(spaceId, 'a-member');
    assert.equal(saved.app_id, 'reminder');
    assert.deepEqual(JSON.parse(saved.actions), ['read']); assert.deepEqual(JSON.parse(saved.resources), ['synthetic-layout-record']);
    if (artifacts) await page.screenshot({ path: join(artifacts, `${width}-space-reminder-permissions.png`), fullPage: true });
    // Reload keeps the route scoped to the app, and a different app cannot show its grants.
    await page.reload(); await ready(page);
    assert.equal(new URL(page.url()).searchParams.get('app'), 'reminder');
    assert.equal(await page.locator('input[name=resources]').count(), 1);
    await back(); await manage('knowledge');
    assert.doesNotMatch(await page.locator('#content').innerText(), /synthetic-layout-record/);
    await page.goBack(); await ready(page);
    assert.equal(await page.locator('.space-app-row').count(), 14, 'browser Back returns to overview');
    await manage('reminder');
    await page.getByRole('button', { name: text('Revoke permission', '撤销权限'), exact: true }).click();
    await write('DELETE', `/permissions/${saved.id}`, confirm);
    assert.equal(auth.db.prepare('SELECT count(*) AS n FROM auth_resources WHERE space_id=? AND app_id=?').get(spaceId, 'reminder').n, 0);
    permission = page.locator('form').filter({ has: page.locator('input[name=resources]') });
    await permission.locator('select[name=userId]').selectOption('a-member');
    await permission.locator('input[name=resources]').fill('synthetic-layout-record');
    await permission.locator('input[type=checkbox][name=read]').check();
    await write('POST', '/permissions', () => permission.locator('button[type=submit]').click());
    await page.getByRole('button', { name: text('Disable', '停用'), exact: true }).click();
    assert.equal(await page.locator('.confirm-box').count(), 1, 'disable retains explicit confirmation');
    await write('PUT', '/apps/reminder', confirm);
    assert.equal(await page.locator('input[name=resources]').count(), 0);
    assert.equal(auth.db.prepare('SELECT count(*) AS n FROM auth_resources WHERE space_id=? AND app_id=?').get(spaceId, 'reminder').n, 0, 'disable deletes resource grants');
    await write('PUT', '/apps/reminder', () => page.getByRole('button', { name: text('Enable', '启用'), exact: true }).click());
    assert.equal(await page.getByRole('button', { name: text('Revoke permission', '撤销权限'), exact: true }).count(), 0, 'reenabling does not revive grants');
    await back(); await manage('finance');
    assert.match(await page.locator('#content').innerText(), /web entry|网页入口/i);
    assert.equal(await page.locator('input[name=resources]').count(), 0, 'web-only app has no business-grant controls');
    await write('PUT', '/apps/finance', () => page.getByRole('button', { name: text('Enable', '启用'), exact: true }).click());
    if (artifacts) await page.screenshot({ path: join(artifacts, `${width}-space-finance-enabled.png`), fullPage: true });
    const memberContext = await browser.newContext();
    assert.equal((await memberContext.request.post(`${origin}/auth/login`, { headers: { Origin: origin }, data: { username: 'synthetic-member', password } })).status(), 200);
    let memberAccess = await (await memberContext.request.get(`${origin}/api/business/web-access`)).json();
    assert.ok(memberAccess.apps.includes('finance'), 'non-business enrollment gives members web entry');
    assert.equal(auth.availableRules('a-member').filter(rule => rule.appId === 'finance').length, 0, 'web entry grants no agent actions');
    await page.getByRole('button', { name: text('Disable', '停用'), exact: true }).click();
    await write('PUT', '/apps/finance', confirm);
    memberAccess = await (await memberContext.request.get(`${origin}/api/business/web-access`)).json();
    assert.ok(!memberAccess.apps.includes('finance'), 'disabling non-business enrollment withdraws web entry');
    await write('PUT', '/apps/finance', () => page.getByRole('button', { name: text('Enable', '启用'), exact: true }).click());
    await back();
    const memberRow = page.locator('.user-row').filter({ hasText: 'synthetic-member' });
    await memberRow.getByRole('button', { name: text('Remove', '移除'), exact: true }).click();
    await write('DELETE', '/members/a-member', confirm);
    memberAccess = await (await memberContext.request.get(`${origin}/api/business/web-access`)).json();
    assert.ok(!memberAccess.apps.includes('finance'), 'membership removal withdraws enrolled web entry');
    await memberContext.close();
    assert.ok(dialogs.length >= 10, 'successful operations display browser alerts');
    assert.ok(dialogs.every(dialog => dialog.type === 'alert' && dialog.message.length > 0), 'success alerts have explicit messages');
    lifecycleEvidence.push({ width, language, installedApps: 14, appScopedPages: 14, members: 'add/remove', businessPermissions: 'grant/revoke/disable/reenable', nonBusinessEntry: 'enabled/withdrawn', notices: width === 1440 ? 'success alerts, no inline success notices, unresolved error persistence' : 'success alerts, no inline success notices', alertCount: dialogs.length, history: 'reload and browser Back', status: 'Pass' });
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    const clearance = await page.evaluate(() => innerHeight - Math.max(...[...document.querySelectorAll('main button, main select, main input')].filter(node => node.getClientRects().length).map(node => node.getBoundingClientRect().bottom)));
    assert.ok(clearance >= 64, `bottom control clearance: ${clearance}`);
    if (width === 1440) {
      await manage('reminder');
      const detailUrl = `${origin}/api/business/account/spaces/${spaceId}`;
      const unavailable = route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ code: 'UNAVAILABLE' }) });
      await page.route(detailUrl, unavailable);
      const dialogsBeforeFailure = dialogs.length;
      await page.getByRole('button', { name: 'Disable', exact: true }).click();
      await Promise.all([page.waitForResponse(r => r.request().method() === 'PUT' && r.url().endsWith('/apps/reminder')), confirm()]);
      await ready(page, { allowError: true });
      assert.equal(await page.locator('#notice.error').count(), 1, 'successful write followed by failed read preserves its error');
      assert.equal(await page.locator('#notice.success').count(), 0, 'failed refresh is not reported as success');
      assert.equal(dialogs.length, dialogsBeforeFailure, 'failed refresh never opens a success alert');
      await page.unroute(detailUrl, unavailable);
      await page.locator('#refresh').click(); await ready(page);
      const expired = route => route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ code: 'UNAUTHENTICATED' }) });
      await page.route(detailUrl, expired);
      await Promise.all([page.waitForResponse(r => r.request().method() === 'PUT' && r.url().endsWith('/apps/reminder')), page.getByRole('button', { name: 'Enable', exact: true }).click()]);
      await ready(page, { allowError: true });
      assert.equal(await page.locator('#notice.error').count(), 1);
      assert.equal(await page.locator('#notice.success').count(), 0, 'terminal rejection is never overwritten by success');
      assert.equal(dialogs.length, dialogsBeforeFailure, 'terminal rejection never opens a success alert');
      assert.equal(await page.locator('#notice').getByRole('link', { name: 'Sign in', exact: true }).count(), 1);
      assert.equal(await page.locator('#content').innerText(), '', 'terminal rejection clears protected content');
      await page.unroute(detailUrl, expired);
      lifecycleEvidence.push({ width, writeRefreshErrors: '503 error and terminal 401 survive successful writes', status: 'Pass' });
    }
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
  t.diagnostic(JSON.stringify({ fixture: 'isolated synthetic auth HTTP; synthetic read-only data/MCP projections', browser: browser.version(), evidence, selectEvidence, separatorEvidence, lifecycleEvidence }));
});

test('Chromium space deletion requires typed confirmation and clears revoked spaces at desktop and phone widths', { skip: !browserEnabled, timeout: 90000 }, async t => {
  const { chromium } = await import(process.env.PLAYWRIGHT_MODULE);
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE, args: ['--no-sandbox'] });
  t.after(() => browser.close());
  const { origin, auth } = await fixture(t), evidence = [];
  const artifacts = process.env.ADMIN_LAYOUT_ARTIFACTS;
  if (artifacts) mkdirSync(artifacts, { recursive: true });
  for (const [width, language] of [[1440, 'en'], [390, 'zh']]) {
    const creator = `synthetic-creator-${width}`;
    auth.createUser({ id: creator, username: creator, password });
    const space = auth.createSelfServiceSpace({ type: 'company', ownerId: creator });
    const other = auth.createSelfServiceSpace({ type: 'family', ownerId: creator });
    const personal = auth.createSelfServiceSpace({ type: 'personal', ownerId: creator });
    auth.setMembership({ spaceId: space.id, userId: 'a-member', role: 'member' });
    auth.setMembership({ spaceId: other.id, userId: 'a-member', role: 'member' });
    for (const appId of ['finance', 'reminder']) auth.setSpaceAppEnrollment({ spaceId: space.id, appId, enabled: true });
    auth.setSpaceAppEnrollment({ spaceId: other.id, appId: 'reminder', enabled: true });
    for (const spaceId of [space.id, other.id]) auth.grantResource({ userId: 'a-member', appId: 'reminder', spaceId, actions: ['read'], resources: ['synthetic-deletion-record'] });
    const grant = auth.createGrant({ userId: 'a-member', clientId: 'synthetic-client', rules: [space.id, other.id].map(spaceId => ({ appId: 'reminder', spaceId, actions: ['read'], resources: ['synthetic-deletion-record'] })) });
    const token = auth.issueToken({ grantId: grant.id }).accessToken;
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    await context.addCookies([{ name: 'praxis_locale', value: language, url: origin }]);
    const page = await context.newPage(), errors = [], dialogs = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('dialog', async dialog => { dialogs.push(dialog.message()); await dialog.accept(); });
    const login = async (target, username) => assert.equal((await target.request.post(`${origin}/auth/login`, { headers: { Origin: origin }, data: { username, password } })).status(), 200);
    const open = async (target, id, app = '') => { await target.goto(`${origin}/admin/?view=spaces&space=${id}${app ? `&app=${app}` : ''}`); await ready(target); };
    const member = await browser.newContext({ viewport: { width, height: 900 } });
    await login(member, 'synthetic-member');
    const memberPage = await member.newPage(); await open(memberPage, space.id);
    assert.equal(await memberPage.locator('.space-delete').count(), 0, 'joined members have no delete action');
    let memberAccess = await (await member.request.get(`${origin}/api/business/web-access`)).json();
    assert.ok(memberAccess.apps.includes('finance'));
    assert.equal((await member.request.delete(`${origin}/api/business/account/spaces/${space.id}`, { headers: { Origin: origin, 'X-CSRF-Token': memberAccess.csrfToken }, data: { confirmSpaceId: space.id } })).status(), 403, 'joined member direct delete is refused');
    await login(context, creator); await open(page, personal.id);
    assert.equal(await page.locator('.space-delete').count(), 0, 'personal spaces have no delete action');
    assert.match(await page.locator('.space-overview').innerText(), /Personal spaces cannot be deleted|个人空间不能删除/);
    await open(page, space.id);
    const trigger = page.locator('.space-delete'); await trigger.click();
    const confirmation = page.locator('.space-delete-confirm'), input = confirmation.locator('input[name=confirmSpaceId]'), submit = confirmation.locator('button[type=submit]');
    assert.equal(await confirmation.locator('li').count(), 3, 'warning lists membership, delegation and enrollment removal');
    assert.match(await confirmation.innerText(), /retained for operator cleanup|保留，由运维另行清理/);
    assert.equal(await submit.isDisabled(), true);
    await input.fill('incorrect-space'); assert.equal(await submit.isDisabled(), true);
    await input.press('Escape'); assert.equal(await confirmation.count(), 0);
    assert.equal(await trigger.evaluate(node => node === document.activeElement), true, 'Escape restores deletion trigger focus');
    await trigger.click(); await confirmation.getByRole('button', { name: language === 'en' ? 'Cancel' : '取消', exact: true }).click();
    assert.equal(await trigger.evaluate(node => node === document.activeElement), true, 'Cancel restores deletion trigger focus');
    assert.ok(auth.db.prepare('SELECT 1 FROM auth_spaces WHERE id=?').get(space.id), 'cancelling never deletes');
    await trigger.click(); await input.fill(space.id); assert.equal(await submit.isEnabled(), true);
    const confirmationLayout = await confirmation.evaluate(node => ({ overflow: document.documentElement.scrollWidth - innerWidth, width: node.getBoundingClientRect().width, targets: [...node.querySelectorAll('input,button')].map(control => control.getBoundingClientRect().height) }));
    assert.ok(confirmationLayout.overflow <= 1, 'typed deletion has no horizontal overflow');
    assert.ok(confirmationLayout.width <= width, 'confirmation fits the viewport');
    assert.ok(confirmationLayout.targets.every(height => height >= (width === 390 ? 44 : 36)), 'confirmation keeps usable control targets');
    evidence.push({ width, confirmationLayout });
    if (artifacts) await page.screenshot({ path: join(artifacts, `${width}-space-delete-confirmation.png`), fullPage: true });
    const response = page.waitForResponse(response => response.request().method() === 'DELETE' && response.url().endsWith(`/spaces/${space.id}`));
    await submit.click(); const deleted = await response;
    assert.equal(deleted.status(), 200); assert.deepEqual(deleted.request().postDataJSON(), { confirmSpaceId: space.id }); await ready(page);
    assert.equal(await page.locator(`select[name=space] option[value="${space.id}"]`).count(), 0, 'deleted space leaves picker');
    assert.notEqual(new URL(page.url()).searchParams.get('space'), space.id, 'deleted space leaves current URL');
    assert.equal(new URL(page.url()).searchParams.has('app'), false, 'stale app route is removed');
    assert.equal(await page.locator('.space-delete-confirm').count(), 0);
    assert.match(dialogs.at(-1), /Space deleted|空间已删除/);
    for (const table of ['auth_members', 'auth_resources', 'auth_space_apps', 'auth_self_service_spaces']) assert.equal(auth.db.prepare(`SELECT count(*) AS n FROM ${table} WHERE space_id=?`).get(space.id).n, 0, `${table} is cleared`);
    assert.equal(auth.getGrant(grant.id).rules.some(rule => rule.spaceId === space.id), false);
    assert.throws(() => auth.authorize(token, { appId: 'reminder', spaceId: space.id, action: 'read', resourceId: 'synthetic-deletion-record' }));
    assert.equal(auth.authorize(token, { appId: 'reminder', spaceId: other.id, action: 'read', resourceId: 'synthetic-deletion-record' }).spaceId, other.id, 'other-space grant remains usable');
    memberAccess = await (await member.request.get(`${origin}/api/business/web-access`)).json();
    assert.ok(!memberAccess.apps.includes('finance'), 'derived web entry is immediately withdrawn');
    assert.ok(memberAccess.apps.includes('reminder'), 'other space retains its web entry');
    assert.equal((await member.request.get(`${origin}/api/business/account/spaces/${space.id}`)).status(), 404, 'immediate re-access is refused');
    await open(page, space.id, 'reminder');
    assert.notEqual(new URL(page.url()).searchParams.get('space'), space.id, 'opening stale deep link selects a current space');
    assert.equal(new URL(page.url()).searchParams.has('app'), false);
    const listed = await (await member.request.get(`${origin}/api/business/account/spaces`)).json();
    assert.ok(!listed.spaces.some(item => item.id === space.id), 'member list has no stale space');
    await login(context, 'synthetic-owner'); await open(page, other.id);
    assert.equal(auth.membershipRole('z-owner', other.id), null, 'administrator deletion does not depend on membership');
    await page.locator('.space-delete').click(); await page.locator('.space-delete-confirm input').fill(other.id);
    await Promise.all([page.waitForResponse(response => response.request().method() === 'DELETE' && response.url().endsWith(`/spaces/${other.id}`)), page.locator('.space-delete-confirm button[type=submit]').click()]); await ready(page);
    assert.equal(auth.db.prepare('SELECT 1 FROM auth_spaces WHERE id=?').get(other.id), undefined, 'administrator deletes another creator space');
    assert.ok(auth.db.prepare('SELECT 1 FROM auth_spaces WHERE id=?').get(personal.id));
    assert.ok(auth.db.prepare('SELECT 1 FROM auth_spaces WHERE id=?').get('synthetic-family'), 'unrelated space remains');
    assert.ok(auth.db.prepare('SELECT 1 FROM auth_users WHERE id=?').get(creator), 'creator account remains');
    assert.deepEqual(errors, []);
    evidence.push({ width, language, creatorDeletion: 'Pass', typedWarningAndCancellation: 'Pass', cascadeAndImmediateRevocation: 'Pass', joinedMemberDenied: 'Pass', personalProtected: 'Pass', administratorForeignDeletion: 'Pass', unrelatedSpaceAndUsersPreserved: 'Pass', stalePickerAndRouteCleared: 'Pass' });
    await context.close(); await member.close();
  }
  t.diagnostic(JSON.stringify({ fixture: 'isolated synthetic AuthStore and real HTTP handlers', browser: browser.version(), evidence }));
});

test('Chromium administrator display contexts keep Spaces and delegations aligned without changing the acting session', { skip: !browserEnabled, timeout: 90000 }, async t => {
  const { chromium } = await import(process.env.PLAYWRIGHT_MODULE);
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE, args: ['--no-sandbox'] });
  t.after(() => browser.close());
  const { origin, auth } = await fixture(t), evidence = [];
  // Put the signed-in administrator beyond the first page of the user catalog.
  auth.setSpaceAppEnrollment({ spaceId: 'synthetic-family', appId: 'reminder', enabled: true });
  for (let index = 0; index < 51; index++) auth.createUser({ id: `b-context-${index.toString().padStart(2, '0')}`, username: `synthetic-context-${index}`, password });
  const memberRule = { appId: 'reminder', spaceId: 'synthetic-family', actions: ['read'], resources: ['synthetic-record'] };
  for (let index = 0; index < 50; index++) auth.createGrant({ userId: 'a-member', clientId: 'synthetic-client', rules: [memberRule] });
  const ownerPermission = auth.grantResource({ userId: 'z-owner', appId: 'reminder', spaceId: 'synthetic-family', actions: ['update'], resources: ['synthetic-owner-only-record'] });
  const foreign = auth.createSelfServiceSpace({ type: 'family', ownerId: 'a-member' });
  const artifacts = process.env.ADMIN_LAYOUT_ARTIFACTS;
  if (artifacts) mkdirSync(artifacts, { recursive: true });
  for (const [width, language] of [[1440, 'en'], [390, 'zh']]) {
    const text = (en, zh) => language === 'en' ? en : zh;
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    const memberContext = await browser.newContext({ viewport: { width, height: 900 } });
    t.after(() => context.close()); t.after(() => memberContext.close());
    for (const target of [context, memberContext]) await target.addCookies([{ name: 'praxis_locale', value: language, url: origin }]);
    const login = async (target, username) => assert.equal((await target.request.post(`${origin}/auth/login`, { headers: { Origin: origin }, data: { username, password } })).status(), 200);
    await login(context, 'synthetic-owner'); await login(memberContext, 'synthetic-member');
    const page = await context.newPage(), memberPage = await memberContext.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message)); memberPage.on('pageerror', error => errors.push(error.message));
    const open = async (target, query) => { await target.goto(`${origin}/admin/?${query}`); await ready(target); };
    const switchUser = async (id, options) => { await page.locator('#selected-user').selectOption(id); await ready(page, options); assert.equal(await page.locator('#selected-user').inputValue(), id); };
    const manage = async target => { await target.locator('.space-app-row[data-app=reminder] a').click(); await ready(target); };
    const sessionId = async () => (await (await context.request.get(`${origin}/api/business/account/session`)).json()).user.id;
    await open(page, 'view=spaces&space=synthetic-family');
    assert.equal(await page.locator('#content>:first-child #selected-user').count(), 1, 'Current user is the first row');
    assert.equal(await page.locator('#selected-user').inputValue(), 'z-owner', 'space context defaults to signed-in administrator');
    assert.deepEqual(await page.locator('#selected-user option').evaluateAll(nodes => nodes.map(node => node.value)), ['z-owner', 'a-member'], 'only the administrator and selected space members are offered');
    assert.equal(await page.locator('input[name=username]').count(), 1, 'administrator owner sees member actions in own context');
    if (artifacts) await page.screenshot({ path: join(artifacts, `${width}-spaces-own-overview.png`), fullPage: true });
    // Exercise the actual native select with the keyboard.
    await page.locator('#selected-user').focus(); await page.locator('#selected-user').press('ArrowDown'); await page.locator('#selected-user').press('Enter'); await ready(page);
    assert.equal(await page.locator('#selected-user').inputValue(), 'a-member');
    assert.equal(await page.locator('input[name=username]').count(), 0, 'member perspective removes owner actions');
    assert.equal(await page.locator('.space-delete').count(), 0);
    assert.equal(await sessionId(), 'z-owner', 'the acting session remains the administrator');
    await open(memberPage, 'view=spaces&space=synthetic-family');
    assert.equal(await memberPage.locator('#selected-user').count(), 0, 'ordinary members have no switcher');
    assert.equal(await page.locator('.space-overview').innerText(), await memberPage.locator('.space-overview').innerText(), 'member overview projection matches the real member browser');
    if (artifacts) await page.screenshot({ path: join(artifacts, `${width}-spaces-member-overview.png`), fullPage: true });
    await manage(page); await manage(memberPage);
    assert.equal(await page.locator('#selected-user').inputValue(), 'a-member', 'Manage retains display context');
    assert.equal(await page.locator('[data-permission]').innerText(), await memberPage.locator('[data-permission]').innerText());
    assert.match(await page.locator('[data-permission]').innerText(), /synthetic-record/);
    assert.equal(await page.locator(`[data-permission="${ownerPermission.id}"]`).count(), 0, 'member projection excludes another user resource grant');
    assert.equal(await page.locator('input[name=resources]').count(), 0, 'member has no grant form');
    if (artifacts) await page.screenshot({ path: join(artifacts, `${width}-space-member-context.png`), fullPage: true });
    await page.locator('.space-back').click(); await ready(page);
    assert.equal(await page.locator('#selected-user').inputValue(), 'a-member', 'Back retains display context');
    // Displaying a foreign owner must not lend that owner's write authority.
    await page.locator('select[name=space]').selectOption(foreign.id); await ready(page); await manage(page);
    assert.equal(await page.locator('#selected-user').inputValue(), 'a-member');
    const enable = page.getByRole('button', { name: text('Enable', '启用'), exact: true });
    assert.equal(await enable.count(), 1, 'foreign owner perspective presents its owner action');
    const rejected = page.waitForResponse(response => response.request().method() === 'PUT' && response.url().endsWith(`/spaces/${foreign.id}/apps/reminder`));
    await enable.click(); assert.equal((await rejected).status(), 403); await ready(page, { allowError: true });
    assert.equal(await page.locator('#notice.error').count(), 1);
    assert.equal(auth.appSpaceEnabled('reminder', foreign.id), false, 'rejected action has no enrollment effect');
    assert.equal(await sessionId(), 'z-owner');
    await switchUser('z-owner', { allowError: true });
    assert.equal(await page.getByRole('button', { name: text('Enable', '启用'), exact: true }).count(), 0, 'returning to administrator context removes foreign-owner action');
    await page.locator('#refresh').click(); await ready(page);
    await page.locator('#navigation [data-view=access]').click(); await ready(page);
    assert.equal(await page.locator('#selected-user').inputValue(), 'a-member', 'App access keeps its established selection behavior');
    await page.locator('#navigation [data-view=grants]').click(); await ready(page);
    const firstUsers = await (await context.request.get(`${origin}/api/business/admin/users?limit=50`)).json();
    assert.ok(!firstUsers.users.some(user => user.id === 'z-owner'), 'administrator really is beyond first user page');
    assert.equal(await page.locator('#selected-user').inputValue(), 'z-owner', 'delegations defaults to signed-in administrator outside catalog page');
    assert.equal(await page.locator('.grant-row').count(), 0, 'administrator empty grants are not mislabeled member grants');
    await switchUser('a-member'); assert.equal(await page.locator('.grant-row').count(), 50);
    await page.getByRole('button', { name: text('Load more delegations', '加载更多委托'), exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll('.grant-row').length === 51);
    assert.equal(await page.locator('#selected-user').inputValue(), 'a-member');
    const expectedIds = auth.listGrants('a-member').map(grant => grant.id).sort();
    assert.deepEqual(await page.locator('.grant-row').evaluateAll(nodes => nodes.map(node => node.dataset.grant).sort()), expectedIds, 'displayed rows belong to the selected user through pagination');
    await page.locator('#refresh').click(); await ready(page);
    assert.equal(await page.locator('#selected-user').inputValue(), 'a-member'); assert.equal(await page.locator('.grant-row').count(), 50);
    // A delayed real read from the previous user must not overwrite the new context.
    await switchUser('z-owner');
    let release, seen, finish;
    const held = new Promise(resolve => { release = resolve; }), requested = new Promise(resolve => { seen = resolve; });
    const fulfilled = new Promise(resolve => { finish = resolve; });
    const delayed = async route => { const response = await route.fetch(); seen(); await held; await route.fulfill({ response }); finish(); };
    const memberUrl = `${origin}/api/business/admin/users/a-member/grants?limit=50`;
    await page.route(memberUrl, delayed);
    await page.locator('#selected-user').selectOption('a-member'); await requested;
    await page.locator('#selected-user').selectOption('z-owner'); await ready(page);
    release(); await fulfilled; await page.unroute(memberUrl, delayed);
    await page.waitForTimeout(50);
    assert.equal(await page.locator('#selected-user').inputValue(), 'z-owner'); assert.equal(await page.locator('.grant-row').count(), 0, 'stale member result cannot overwrite own grants');
    await open(memberPage, 'view=grants');
    assert.equal(await memberPage.locator('#selected-user').count(), 0); assert.equal(await memberPage.locator('.grant-row').count(), 50);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth <= 1));
    assert.ok(await memberPage.evaluate(() => document.documentElement.scrollWidth - innerWidth <= 1));
    if (artifacts) await page.screenshot({ path: join(artifacts, `${width}-delegations-own-context.png`), fullPage: true });
    assert.deepEqual(errors, []);
    evidence.push({ width, language, spaceDefault: 'administrator', memberProjection: 'matches actual member browser', foreignOwnerWrite: 403, nativeSession: 'unchanged', delegations: 'own default outside first catalog page; selection, pagination, refresh, stale read', ordinaryUser: 'own only, no switcher', overflow: 0, status: 'Pass' });
    await context.close(); await memberContext.close();
  }
  t.diagnostic(JSON.stringify({ fixture: 'isolated synthetic AuthStore and real HTTP handlers', browser: browser.version(), evidence }));
});
