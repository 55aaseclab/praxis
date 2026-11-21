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
