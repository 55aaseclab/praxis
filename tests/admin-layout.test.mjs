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

test('Chromium MCP cleanup and owned-space refusals share the persistent Settings error overlay', { skip: !browserEnabled, timeout: 90000 }, async t => {
  const { chromium } = await import(process.env.PLAYWRIGHT_MODULE);
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE, args: ['--no-sandbox'] });
  t.after(() => browser.close());
  const { origin, auth } = await fixture(t), evidence = [];
  const artifacts = process.env.ADMIN_LAYOUT_ARTIFACTS;
  if (artifacts) mkdirSync(artifacts, { recursive: true });
  for (const width of [1440, 390]) for (const language of ['en', 'zh']) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    t.after(() => context.close());
    await context.addCookies([{ name: 'praxis_locale', value: language, url: origin }]);
    assert.equal((await context.request.post(`${origin}/auth/login`, { headers: { Origin: origin }, data: { username: 'synthetic-owner', password } })).status(), 200);
    const page = await context.newPage(), errors = [], dialogs = [];
    page.setDefaultTimeout(10000);
    page.on('pageerror', error => errors.push(error.message));
    page.on('dialog', async dialog => { dialogs.push(dialog.message()); await dialog.accept(); });
    await page.goto(`${origin}/admin/?view=mcp`); await ready(page);
    const checkMcp = async () => {
      const text = await page.locator('#content').innerText();
      assert.doesNotMatch(text, /App configuration and successful calls in the past seven days|应用配置与近七天成功调用/);
      assert.doesNotMatch(text, /Tools are available according to|This registry lists configured tools|业务工具按使用者的当前权限|这里的注册清单/);
      assert.doesNotMatch(text, /Updated |更新于|Business adapter configured|业务适配器已配置|No successful calls observed|未观测到成功调用/);
      assert.equal(await page.locator('.mcp-table').count(), 2, 'only protocol endpoints and capabilities remain');
      assert.match(text, /synthetic_reminder_list/);
      assert.match(text, /spaceId/);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    };
    await checkMcp();
    if (artifacts) await page.screenshot({ path: join(artifacts, `${width}-${language}-mcp-cleanup.png`), fullPage: true });
    const ownedUser = `synthetic-overlay-owner-${width}-${language}`;
    const ownedIds = ['family', 'team'].map(type => `synthetic-${type}-owned-space-${width}-${language}-complete-id`);
    auth.createUser({ id: ownedUser, username: ownedUser, password });
    for (const [index, id] of ownedIds.entries()) auth.createSpace({ id, type: index ? 'company' : 'family', ownerId: ownedUser });
    await page.goto(`${origin}/admin/?view=users&user=${ownedUser}`); await ready(page);
    await page.evaluate(() => { window.sharedErrorOverlay = document.querySelector('#notice'); });
    const detailUrl = `${origin}/api/business/admin/users/${ownedUser}`;
    await page.route(detailUrl, route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ code: 'UNAVAILABLE' }) }));
    await page.locator('#refresh').click(); await ready(page, { allowError: true });
    assert.match(await page.locator('#notice.error').innerText(), /Service unavailable|服务暂时不可用/);
    assert.equal(await page.locator('#notice').evaluate(node => node === window.sharedErrorOverlay && getComputedStyle(node).position === 'fixed'), true, 'ordinary read error uses the shared fixed overlay');
    await page.unroute(detailUrl);
    await page.locator('#refresh').click(); await ready(page);
    assert.equal(await page.locator('#notice').innerText(), '', 'explicit successful refresh clears the ordinary error');
    const trigger = page.getByRole('button', { name: language === 'en' ? 'Delete user' : '删除用户', exact: true });
    await trigger.scrollIntoViewIfNeeded();
    await trigger.click();
    await page.locator('.confirm-dialog input[name=confirmUsername]').fill(ownedUser);
    const before = await layoutGeometry(page);
    const refusal = page.waitForResponse(response => response.request().method() === 'DELETE' && response.url() === detailUrl);
    await page.locator('.confirm-dialog button[type=submit]').click();
    const response = await refusal;
    assert.equal(response.status(), 409);
    assert.equal((await response.json()).code, 'OWNED_SPACES_REQUIRED');
    await ready(page, { allowError: true });
    const refusalText = await page.locator('#notice.error').innerText();
    for (const id of ownedIds) assert.ok(refusalText.includes(id), 'each complete owned-space ID remains visible');
    assert.match(refusalText, /Delete the owned spaces first|请先删除以下自有空间/);
    const overlay = await page.locator('#notice.error').evaluate(node => {
      const rect = node.getBoundingClientRect(), style = getComputedStyle(node);
      return { sameNode: node === window.sharedErrorOverlay, position: style.position, fits: rect.left >= 0 && rect.right <= innerWidth && rect.top >= 0 && rect.bottom <= innerHeight, bottom: innerHeight - rect.bottom };
    });
    assert.equal(overlay.sameNode, true, 'owned-space refusal reuses the exact ordinary-error overlay node');
    assert.equal(overlay.position, 'fixed'); assert.equal(overlay.fits, true);
    assert.ok(overlay.bottom >= (width === 390 ? 72 : 24), 'overlay retains the standard desktop/phone placement');
    assert.equal(await page.locator('dialog').count(), 0, 'confirmation closes before the refusal and no error popup is added');
    assert.deepEqual(dialogs, [], 'refusal creates no browser popup');
    assert.deepEqual(await layoutGeometry(page), before, 'refusal overlay leaves content geometry and scroll unchanged');
    if (artifacts) await page.screenshot({ path: join(artifacts, `${width}-${language}-owned-space-error-overlay.png`) });
    await page.locator('#navigation [data-view=mcp]').click(); await ready(page, { allowError: true });
    await checkMcp();
    assert.equal(await page.locator('#notice.error').innerText(), refusalText, 'owned-space error persists across views');
    assert.equal(await page.locator('#notice').evaluate(node => node === window.sharedErrorOverlay), true);
    const mcpGeometry = await layoutGeometry(page);
    await page.locator('#refresh').click(); await ready(page);
    assert.equal(await page.locator('#notice').innerText(), '');
    assert.deepEqual(await layoutGeometry(page), mcpGeometry, 'clearing the overlay leaves MCP content geometry unchanged');
    assert.ok(auth.db.prepare('SELECT 1 FROM auth_users WHERE id=?').get(ownedUser), 'refused deletion preserves the account');
    for (const id of ownedIds) assert.ok(auth.db.prepare('SELECT 1 FROM auth_spaces WHERE id=?').get(id), 'refused deletion preserves each owned space');
    assert.deepEqual(errors, []);
    evidence.push({ width, language, mcp: 'protocol and capabilities only', ordinaryAndOwnedSpaceError: 'same fixed #notice node', fullOwnedIds: ownedIds.length, popups: 0, geometryChange: 0, persistsAcrossViews: true, explicitRefreshClears: true, overflow: 0, result: 'Pass' });
    await context.close();
  }
  t.diagnostic(JSON.stringify({ fixture: 'isolated synthetic auth HTTP; synthetic MCP projection; ordinary read failure injected at HTTP boundary', browser: browser.version(), evidence }));
});

async function inspectConfirmation(page, trigger, label) {
  const evidence = [];
  for (const dismissal of ['Escape', 'backdrop', 'Cancel']) {
    await trigger.scrollIntoViewIfNeeded();
    await trigger.evaluate(node => node.focus({ preventScroll: true }));
    const baseline = await page.evaluate(() => {
      const snapshot = () => ({ scroll: [scrollX, scrollY], rects: [...document.querySelectorAll('main, #heading, #content, #content *')].filter(node => node.getClientRects().length).map(node => { const r = node.getBoundingClientRect(); return [r.x, r.y, r.width, r.height]; }) });
      const original = snapshot(), changes = [], shifts = [];
      let active = true;
      const observer = new PerformanceObserver(list => { for (const entry of list.getEntries()) if (entry.value) shifts.push(entry.value); });
      observer.observe({ type: 'layout-shift' });
      const probe = () => { if (!active) return; const current = snapshot(); if (JSON.stringify(current) !== JSON.stringify(original)) changes.push(current); requestAnimationFrame(probe); };
      requestAnimationFrame(probe);
      window.confirmationProbe = { snapshot, changes, shifts, stop: () => { active = false; observer.disconnect(); } };
      return original;
    });
    await trigger.click();
    const dialog = page.locator('.confirm-dialog');
    await dialog.waitFor();
    const modal = await dialog.evaluate(node => {
      const r = node.getBoundingClientRect(), backdrop = getComputedStyle(node, '::backdrop');
      return { modal: node.matches(':modal'), center: [r.x + r.width / 2, r.y + r.height / 2], viewport: [innerWidth, innerHeight], fits: r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight, backdrop: backdrop.backgroundColor, named: Boolean(node.getAttribute('aria-label') || node.getAttribute('aria-labelledby')) };
    });
    assert.equal(modal.modal, true, `${label}: confirmation is modal`);
    assert.equal(modal.named, true, `${label}: dialog has an accessible name`);
    assert.equal(modal.fits, true, `${label}: modal fits viewport`);
    for (let axis = 0; axis < 2; axis++) assert.ok(Math.abs(modal.center[axis] - modal.viewport[axis] / 2) <= 1, `${label}: modal is centered`);
    assert.doesNotMatch(modal.backdrop, /^(transparent|rgba\(0, 0, 0, 0\))$/, `${label}: visible backdrop`);
    assert.deepEqual(await page.evaluate(() => window.confirmationProbe.snapshot()), baseline, `${label}: opening does not shift page geometry or scroll`);
    if (dismissal === 'Escape' && process.env.ADMIN_LAYOUT_ARTIFACTS) await page.screenshot({ path: join(process.env.ADMIN_LAYOUT_ARTIFACTS, `${page.viewportSize().width}-${label.replace(/[^a-z0-9]+/gi, '-')}-modal.png`) });
    const controls = dialog.locator('button:enabled, input:enabled, select:enabled, a[href]');
    await controls.last().focus(); await page.keyboard.press('Tab');
    assert.equal(await controls.first().evaluate(node => document.activeElement === node), true, `${label}: Tab wraps inside modal`);
    await page.keyboard.press('Shift+Tab');
    assert.equal(await controls.last().evaluate(node => document.activeElement === node), true, `${label}: reverse Tab wraps inside modal`);
    if (dismissal === 'backdrop') await page.mouse.click(2, 2);
    else if (dismissal === 'Cancel') await dialog.getByRole('button', { name: /^(Cancel|取消)$/, exact: true }).click();
    else await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'detached' });
    assert.equal(await trigger.evaluate(node => document.activeElement === node), true, `${label}: ${dismissal} restores trigger focus`);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const probe = await page.evaluate(() => { const value = window.confirmationProbe; value.stop(); return { current: value.snapshot(), changes: value.changes, shifts: value.shifts }; });
    assert.deepEqual(probe.current, baseline, `${label}: ${dismissal} preserves geometry and scroll`);
    assert.deepEqual(probe.changes, [], `${label}: no transient geometry changes`);
    assert.deepEqual(probe.shifts, [], `${label}: zero layout-shift entries`);
    evidence.push({ dismissal, layoutShift: 0, scrollDelta: 0, focusReturned: true });
  }
  return { label, evidence, status: 'Pass' };
}

async function inspectDelegations(page, expected) {
  const rows = await page.locator('.grant-row').evaluateAll(nodes => nodes.map(node => {
    const rect = node.getBoundingClientRect(), status = node.querySelector('.grant-status'), statusRect = status.getBoundingClientRect();
    const identifiers = [...node.querySelectorAll('.grant-identifiers code')].map(code => { const r = code.getBoundingClientRect(), style = getComputedStyle(code); return { text: code.textContent, font: style.fontFamily, visible: Boolean(code.getClientRects().length), fits: r.left >= rect.left && r.right <= rect.right + 1, unclipped: code.scrollWidth <= code.clientWidth + 1, overflow: style.textOverflow }; });
    return { id: node.dataset.grant, grantId: node.querySelector('code.grant-id')?.textContent, spaceIds: [...node.querySelectorAll('code.grant-space-id')].map(code => code.textContent), identifiers, rightDelta: rect.right - statusRect.right, statusAlign: getComputedStyle(status).textAlign };
  }));
  for (const row of rows) {
    assert.equal(row.grantId, row.id, 'every row displays its complete delegation ID');
    assert.deepEqual([...row.spaceIds].sort(), expected.get(row.id), 'every row displays the actual complete space IDs');
    assert.ok(Math.abs(row.rightDelta) <= 1, 'status ends at the delegation row right edge');
    assert.equal(row.statusAlign, 'right', 'status text is right aligned');
    for (const identity of row.identifiers) {
      assert.match(identity.font, /mono|Consolas/i, 'identifiers use monospace');
      assert.equal(identity.visible && identity.fits && identity.unclipped, true, `${identity.text}: identifier is visible within the row without clipping`);
      assert.notEqual(identity.overflow, 'ellipsis', 'the full identifier remains readable');
    }
  }
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth <= 1), true, 'delegations have no horizontal overflow');
  return { rows: rows.length, identifiers: 'complete monospace delegation/space IDs', statusRightDelta: 0 };
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
    lifecycleEvidence.push(await inspectConfirmation(page, page.getByRole('button', { name: text('Revoke permission', '撤销权限'), exact: true }), `${width}/permission revoke`));
    await page.getByRole('button', { name: text('Revoke permission', '撤销权限'), exact: true }).click();
    await write('DELETE', `/permissions/${saved.id}`, confirm);
    assert.equal(auth.db.prepare('SELECT count(*) AS n FROM auth_resources WHERE space_id=? AND app_id=?').get(spaceId, 'reminder').n, 0);
    permission = page.locator('form').filter({ has: page.locator('input[name=resources]') });
    await permission.locator('select[name=userId]').selectOption('a-member');
    await permission.locator('input[name=resources]').fill('synthetic-layout-record');
    await permission.locator('input[type=checkbox][name=read]').check();
    await write('POST', '/permissions', () => permission.locator('button[type=submit]').click());
    lifecycleEvidence.push(await inspectConfirmation(page, page.getByRole('button', { name: text('Disable', '停用'), exact: true }), `${width}/app disable`));
    await page.getByRole('button', { name: text('Disable', '停用'), exact: true }).click();
    assert.equal(await page.locator('.confirm-box').count(), 1, 'disable retains explicit confirmation');
    await write('PUT', '/apps/reminder', confirm);
    assert.equal(await page.locator('input[name=resources]').count(), 0);
    assert.equal(auth.db.prepare('SELECT count(*) AS n FROM auth_resources WHERE space_id=? AND app_id=?').get(spaceId, 'reminder').n, 0, 'disable deletes resource grants');
    await write('PUT', '/apps/reminder', () => page.getByRole('button', { name: text('Enable', '启用'), exact: true }).click());
    assert.equal(await page.getByRole('button', { name: text('Revoke permission', '撤销权限'), exact: true }).count(), 0, 'reenabling does not revive grants');
    await back(); await manage('intelligence');
    assert.match(await page.locator('#content').innerText(), /web entry|网页入口/i);
    assert.equal(await page.locator('input[name=resources]').count(), 0, 'web-only app has no business-grant controls');
    await write('PUT', '/apps/intelligence', () => page.getByRole('button', { name: text('Enable', '启用'), exact: true }).click());
    if (artifacts) await page.screenshot({ path: join(artifacts, `${width}-space-intelligence-enabled.png`), fullPage: true });
    const memberContext = await browser.newContext();
    assert.equal((await memberContext.request.post(`${origin}/auth/login`, { headers: { Origin: origin }, data: { username: 'synthetic-member', password } })).status(), 200);
    let memberAccess = await (await memberContext.request.get(`${origin}/api/business/web-access`)).json();
    assert.ok(memberAccess.apps.includes('intelligence'), 'non-business enrollment gives members web entry');
    assert.equal(auth.availableRules('a-member').filter(rule => rule.appId === 'intelligence').length, 0, 'web entry grants no agent actions');
    await page.getByRole('button', { name: text('Disable', '停用'), exact: true }).click();
    await write('PUT', '/apps/intelligence', confirm);
    memberAccess = await (await memberContext.request.get(`${origin}/api/business/web-access`)).json();
    assert.ok(!memberAccess.apps.includes('intelligence'), 'disabling non-business enrollment withdraws web entry');
    await write('PUT', '/apps/intelligence', () => page.getByRole('button', { name: text('Enable', '启用'), exact: true }).click());
    await back();
    const memberRow = page.locator('.user-row').filter({ hasText: 'synthetic-member' });
    lifecycleEvidence.push(await inspectConfirmation(page, memberRow.getByRole('button', { name: text('Remove', '移除'), exact: true }), `${width}/member remove`));
    await memberRow.getByRole('button', { name: text('Remove', '移除'), exact: true }).click();
    await write('DELETE', '/members/a-member', confirm);
    memberAccess = await (await memberContext.request.get(`${origin}/api/business/web-access`)).json();
    assert.ok(!memberAccess.apps.includes('intelligence'), 'membership removal withdraws enrolled web entry');
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
    const personal = auth.ensurePersonalSpace(creator);
    const extraPersonal = auth.createSelfServiceSpace({ type: 'personal', ownerId: creator });
    auth.setMembership({ spaceId: space.id, userId: 'a-member', role: 'member' });
    auth.setMembership({ spaceId: other.id, userId: 'a-member', role: 'member' });
    for (const appId of ['intelligence', 'reminder']) auth.setSpaceAppEnrollment({ spaceId: space.id, appId, enabled: true });
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
    assert.ok(memberAccess.apps.includes('intelligence'));
    assert.equal((await member.request.delete(`${origin}/api/business/account/spaces/${space.id}`, { headers: { Origin: origin, 'X-CSRF-Token': memberAccess.csrfToken }, data: { confirmSpaceId: space.id } })).status(), 403, 'joined member direct delete is refused');
    await login(context, creator); await open(page, personal.id);
    assert.equal(await page.locator('.space-delete').count(), 0, 'automatically created personal spaces have no delete action');
    assert.match(await page.locator('.space-overview').innerText(), /Automatically created personal spaces cannot be deleted|自动创建的个人空间不能删除/);
    const deleteProtected = async () => {
      const access = await (await context.request.get(`${origin}/api/business/account/session`)).json();
      assert.equal((await context.request.delete(`${origin}/api/business/account/spaces/${personal.id}`, { headers: { Origin: origin, 'X-CSRF-Token': access.csrfToken }, data: { confirmSpaceId: personal.id } })).status(), 409, 'automatic personal protection is enforced at the service boundary');
    };
    await deleteProtected();
    await open(page, extraPersonal.id);
    assert.equal(await page.locator('.space-delete').count(), 1, 'user-created personal spaces offer deletion');
    assert.doesNotMatch(await page.locator('.space-overview').innerText(), /cannot be deleted|不能删除/);
    await page.locator('.space-delete').click(); await page.locator('.space-delete-confirm input').fill(extraPersonal.id);
    await Promise.all([page.waitForResponse(response => response.request().method() === 'DELETE' && response.url().endsWith(`/spaces/${extraPersonal.id}`)), page.locator('.space-delete-confirm button[type=submit]').click()]); await ready(page);
    assert.equal(auth.db.prepare('SELECT 1 FROM auth_spaces WHERE id=?').get(extraPersonal.id), undefined, 'creator deletes an extra personal space');
    await open(page, space.id);
    const trigger = page.locator('.space-delete');
    evidence.push(await inspectConfirmation(page, trigger, `${width}/typed space deletion`));
    await trigger.click();
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
    assert.ok(!memberAccess.apps.includes('intelligence'), 'derived web entry is immediately withdrawn');
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
    await open(page, personal.id);
    assert.equal(await page.locator('.space-delete').count(), 0, 'administrator has no automatic-personal deletion action');
    await deleteProtected();
    assert.ok(auth.db.prepare('SELECT 1 FROM auth_spaces WHERE id=?').get(personal.id));
    assert.ok(auth.db.prepare('SELECT 1 FROM auth_spaces WHERE id=?').get('synthetic-family'), 'unrelated space remains');
    assert.ok(auth.db.prepare('SELECT 1 FROM auth_users WHERE id=?').get(creator), 'creator account remains');
    assert.deepEqual(errors, []);
    evidence.push({ width, language, creatorDeletion: 'Pass', typedWarningAndCancellation: 'Pass', cascadeAndImmediateRevocation: 'Pass', joinedMemberDenied: 'Pass', automaticPersonalProtectedForOwnerAndAdmin: 'Pass', extraPersonalCreatorDeletion: 'Pass', administratorForeignDeletion: 'Pass', unrelatedSpaceAndUsersPreserved: 'Pass', stalePickerAndRouteCleared: 'Pass' });
    await context.close(); await member.close();
  }
  t.diagnostic(JSON.stringify({ fixture: 'isolated synthetic AuthStore and real HTTP handlers', browser: browser.version(), evidence }));
});

test('Chromium same-name delegations show full IDs and account/delegation confirmations stay modal', { skip: !browserEnabled, timeout: 120000 }, async t => {
  const { chromium } = await import(process.env.PLAYWRIGHT_MODULE);
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE, args: ['--no-sandbox'] });
  t.after(() => browser.close());
  const { origin, auth } = await fixture(t), evidence = [];
  const longSpaceId = `synthetic-secondary-${'long-space-'.repeat(12)}end`;
  const originalId = auth.listGrants('a-member')[0].id;
  auth.setSpaceAppEnrollment({ spaceId: 'synthetic-family', appId: 'reminder', enabled: true });
  auth.createSpace({ id: longSpaceId, type: 'company', ownerId: 'z-owner' });
  auth.setSpaceAppEnrollment({ spaceId: longSpaceId, appId: 'reminder', enabled: true });
  auth.setMembership({ spaceId: longSpaceId, userId: 'a-member', role: 'member' });
  auth.grantResource({ userId: 'a-member', appId: 'reminder', spaceId: longSpaceId, actions: ['read'], resources: ['synthetic-secondary-record'] });
  const rules = [
    { appId: 'reminder', spaceId: 'synthetic-family', actions: ['read'], resources: ['synthetic-record'] },
    { appId: 'reminder', spaceId: longSpaceId, actions: ['read'], resources: ['synthetic-secondary-record'] },
  ];
  const multi = auth.createGrant({ userId: 'a-member', clientId: 'synthetic-client', rules });
  const historical = auth.createGrant({ userId: 'a-member', clientId: 'synthetic-client', rules });
  auth.revokeGrant(historical.id);
  const restrictedSpace = auth.createSelfServiceSpace({ type: 'family', ownerId: 'z-owner' });
  auth.setSpaceAppEnrollment({ spaceId: restrictedSpace.id, appId: 'reminder', enabled: true });
  auth.setMembership({ spaceId: restrictedSpace.id, userId: 'a-member', role: 'member' });
  const temporary = auth.grantResource({ userId: 'a-member', appId: 'reminder', spaceId: restrictedSpace.id, actions: ['read'], resources: ['synthetic-restricted-record'] });
  const restricted = auth.createGrant({ userId: 'a-member', clientId: 'synthetic-client', rules: [{ appId: 'reminder', spaceId: restrictedSpace.id, actions: ['read'], resources: ['synthetic-restricted-record'] }] });
  auth.revokeResource(temporary.id);
  const expected = new Map(auth.listGrants('a-member').map(grant => [grant.id, [...new Set(grant.rules.map(rule => rule.spaceId))].sort()]));
  const artifacts = process.env.ADMIN_LAYOUT_ARTIFACTS;
  if (artifacts) mkdirSync(artifacts, { recursive: true });
  for (const [width, language] of [[1440, 'en'], [390, 'zh']]) {
    const text = (en, zh) => language === 'en' ? en : zh;
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    t.after(() => context.close());
    await context.addCookies([{ name: 'praxis_locale', value: language, url: origin }]);
    assert.equal((await context.request.post(`${origin}/auth/login`, { headers: { Origin: origin }, data: { username: 'synthetic-owner', password } })).status(), 200);
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const open = async view => { await page.goto(`${origin}/admin/?view=${view}`); await ready(page); };
    await open('users');
    await page.locator('[data-user="z-owner"] a').click(); await ready(page);
    for (const name of [text('Disable account', '停用账号'), text('Remove administrator role', '移除管理员')]) {
      evidence.push({ width, ...await inspectConfirmation(page, page.getByRole('button', { name, exact: true }), name) });
    }
    assert.equal(auth.isPlatformAdmin('z-owner'), true, 'cancellation keeps administrator role');
    assert.equal(auth.db.prepare('SELECT enabled FROM auth_users WHERE id=?').get('z-owner').enabled, 1, 'cancellation keeps account enabled');
    await open('grants'); await page.locator('#selected-user').selectOption('a-member'); await ready(page);
    assert.equal(await page.getByRole('searchbox').count(), 0, 'delegations selector has no search input');
    assert.equal(await page.locator('.grant-row').count(), 4);
    assert.deepEqual(await page.locator('.grant-heading strong').allTextContents(), Array(4).fill('Synthetic agent'));
    evidence.push({ width, context: 'administrator', ...await inspectDelegations(page, expected) });
    evidence.push({ width, ...await inspectConfirmation(page, page.locator('.grant-row button').first(), 'administrator delegation revoke') });
    if (artifacts) await page.screenshot({ path: join(artifacts, `${width}-delegation-identifiers.png`), fullPage: true });
    const member = await browser.newContext({ viewport: { width, height: 900 } });
    t.after(() => member.close());
    await member.addCookies([{ name: 'praxis_locale', value: language, url: origin }]);
    assert.equal((await member.request.post(`${origin}/auth/login`, { headers: { Origin: origin }, data: { username: 'synthetic-member', password } })).status(), 200);
    const memberPage = await member.newPage();
    await memberPage.goto(`${origin}/admin/?view=grants`); await ready(memberPage);
    assert.equal(await memberPage.locator(`[data-grant="${restricted.id}"]`).getAttribute('data-status'), 'restricted');
    assert.match(await memberPage.locator(`[data-grant="${restricted.id}"]`).innerText(), /No actions currently available|当前暂无可用操作/);
    evidence.push({ width, context: 'own account', ...await inspectDelegations(memberPage, expected) });
    evidence.push({ width, ...await inspectConfirmation(memberPage, memberPage.locator('.grant-row button').first(), 'own delegation revoke') });
    const actor = width === 1440 ? memberPage : page, revokedId = width === 1440 ? multi.id : originalId;
    actor.on('dialog', dialog => dialog.accept());
    await actor.locator(`[data-grant="${revokedId}"] button`).click();
    const revoked = actor.waitForResponse(response => response.request().method() === 'DELETE' && response.url().endsWith(`/grants/${revokedId}`));
    await actor.locator('.confirm-dialog').getByRole('button', { name: text('Confirm', '确认'), exact: true }).click();
    assert.equal((await revoked).status(), 200, 'modal confirmation retains the existing revoke request');
    await ready(actor);
    assert.equal(await actor.locator('.confirm-dialog').count(), 0, 'confirmed modal is removed');
    assert.equal(await actor.locator(`[data-grant="${revokedId}"] button`).count(), 0, 'revoked delegation loses its action');
    assert.equal(await actor.locator(`[data-grant="${revokedId}"] code.grant-id`).textContent(), revokedId, 'revoked row retains its identity');
    assert.deepEqual(errors, []);
    await member.close(); await context.close();
  }
  t.diagnostic(JSON.stringify({ fixture: 'isolated synthetic AuthStore, real HTTP handlers, repeated client names and long multi-space IDs', browser: browser.version(), evidence }));
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
  const artifacts = process.env.ADMIN_LAYOUT_ARTIFACTS;
  if (artifacts) mkdirSync(artifacts, { recursive: true });
  for (const [width, language] of [[1440, 'en'], [390, 'zh']]) {
    auth.setMembership({ spaceId: 'synthetic-family', userId: 'b-context-50', role: null });
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
    const firstSpaceUsers = await (await context.request.get(`${origin}/api/business/admin/users?limit=50`)).json();
    assert.deepEqual(await page.locator('#selected-user option').evaluateAll(nodes => nodes.map(node => node.value)), ['z-owner', ...firstSpaceUsers.users.filter(user => user.id !== 'z-owner').map(user => user.id)], 'Spaces offers the same all-user catalog as delegations');
    assert.equal(await page.locator('#selected-user option[value="b-context-50"]').count(), 0, 'later catalog users require pagination');
    await page.getByRole('button', { name: text('Load more users', '加载更多用户'), exact: true }).click(); await ready(page);
    assert.equal(await page.locator('#selected-user option[value="b-context-50"]').count(), 1, 'pagination includes registered nonmembers');
    await switchUser('b-context-50');
    assert.equal(await page.locator('select[name=space], input[name=username], .space-delete').count(), 0, 'nonmember without spaces sees no actor spaces or controls');
    assert.match(await page.locator('#content').innerText(), /No spaces yet|暂无空间/);
    assert.equal(await sessionId(), 'z-owner');
    await page.locator('#refresh').click(); await ready(page);
    assert.equal(await page.locator('#selected-user').inputValue(), 'b-context-50', 'refresh retains selected users outside the first catalog page');
    await switchUser('z-owner');
    await page.locator('select[name=space]').selectOption('synthetic-family'); await ready(page);
    assert.equal(await page.getByRole('searchbox').count(), 0, 'Spaces current user is a plain dropdown without search');
    assert.equal(await page.locator('.user-context form').count(), 0, 'Spaces has no search interaction');
    assert.equal(await page.locator('input[name=username]').count(), 1, 'administrator owner sees member actions in own context');
    if (artifacts) await page.screenshot({ path: join(artifacts, `${width}-spaces-own-overview.png`), fullPage: true });
    // Exercise the actual native select with the keyboard.
    await page.locator('#selected-user').focus(); await page.locator('#selected-user').press('ArrowDown'); await page.locator('#selected-user').press('Enter'); await ready(page);
    assert.equal(await page.locator('#selected-user').inputValue(), 'a-member');
    await page.locator('select[name=space]').selectOption('synthetic-family'); await ready(page);
    assert.equal(await page.locator('input[name=username]').count(), 1, 'member display context preserves the acting owner controls');
    assert.equal(await page.locator('.space-delete').count(), 1, 'member display context preserves administrator deletion');
    assert.equal(await sessionId(), 'z-owner', 'the acting session remains the administrator');
    await open(memberPage, 'view=spaces&space=synthetic-family');
    assert.equal(await memberPage.locator('#selected-user').count(), 0, 'ordinary members have no switcher');
    assert.equal(await memberPage.locator('.space-delete, input[name=username], .user-row button').count(), 0, 'ordinary members retain no owner or delete controls');
    for (const selector of ['.user-row .user-summary', '.space-app-row>div']) assert.deepEqual(await page.locator(selector).allTextContents(), await memberPage.locator(selector).allTextContents(), 'displayed member and app data matches the real member browser');
    if (artifacts) await page.screenshot({ path: join(artifacts, `${width}-spaces-member-overview.png`), fullPage: true });
    await manage(page); await manage(memberPage);
    assert.equal(await page.locator('#selected-user').inputValue(), 'a-member', 'Manage retains display context');
    assert.equal(await page.locator('[data-permission] .control-summary').innerText(), await memberPage.locator('[data-permission] .control-summary').innerText());
    assert.match(await page.locator('[data-permission]').innerText(), /synthetic-record/);
    assert.equal(await page.locator(`[data-permission="${ownerPermission.id}"]`).count(), 0, 'member projection excludes another user resource grant');
    assert.equal(await page.locator('input[name=resources]').count(), 1, 'acting owner retains the grant form in member display context');
    assert.equal(await page.locator('[data-permission] button').count(), 1, 'acting owner retains revoke in member display context');
    assert.equal(await memberPage.locator('input[name=resources], [data-permission] button, .account-setting button').count(), 0, 'ordinary member controls remain unchanged');
    if (artifacts) await page.screenshot({ path: join(artifacts, `${width}-space-member-context.png`), fullPage: true });
    const alerts = [];
    const acknowledge = async dialog => { alerts.push(dialog.message()); await dialog.accept(); };
    page.on('dialog', acknowledge);
    await page.locator('select[name=userId]').selectOption('a-member');
    await page.locator('input[name=resources]').fill('synthetic-context-resource');
    await page.locator('input[name=update]').check();
    const granted = page.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith('/spaces/synthetic-family/permissions'));
    await page.getByRole('button', { name: text('Grant resource permission', '授予资源权限'), exact: true }).click();
    const grantResponse = await granted;
    assert.equal(grantResponse.status(), 201); const permission = await grantResponse.json(); await ready(page);
    await page.locator(`[data-permission="${permission.id}"] button`).click();
    const revoked = page.waitForResponse(response => response.request().method() === 'DELETE' && response.url().endsWith(`/permissions/${permission.id}`));
    await page.locator('.confirm-dialog').getByRole('button', { name: text('Confirm', '确认'), exact: true }).click();
    assert.equal((await revoked).status(), 200); await ready(page);
    assert.equal(await page.locator(`[data-permission="${permission.id}"]`).count(), 0, 'owner grant/revoke succeeds while displaying a member');
    await page.locator('.space-back').click(); await ready(page);
    assert.equal(await page.locator('#selected-user').inputValue(), 'a-member', 'Back retains display context');
    await page.locator('input[name=username]').fill('synthetic-context-50');
    await page.getByRole('button', { name: text('Add member', '添加成员'), exact: true }).click(); await ready(page);
    assert.equal(auth.membershipRole('b-context-50', 'synthetic-family'), 'member');
    await page.locator('[data-member="b-context-50"] button').click();
    await page.locator('.confirm-dialog').getByRole('button', { name: text('Confirm', '确认'), exact: true }).click(); await ready(page);
    assert.equal(auth.membershipRole('b-context-50', 'synthetic-family'), null, 'owner member add/remove succeeds while displaying a member');
    await page.getByRole('button', { name: text('Load more users', '加载更多用户'), exact: true }).click(); await ready(page);
    auth.setMembership({ spaceId: 'synthetic-family', userId: 'b-context-50', role: 'member' });
    await switchUser('b-context-50');
    await page.locator('.space-app-row[data-app=intelligence] a').click(); await ready(page);
    await page.getByRole('button', { name: text('Enable', '启用'), exact: true }).click(); await ready(page);
    assert.equal(auth.appSpaceEnabled('intelligence', 'synthetic-family'), true);
    await page.getByRole('button', { name: text('Disable', '停用'), exact: true }).click();
    const disabledAlert = page.waitForEvent('dialog');
    await page.locator('.confirm-dialog').getByRole('button', { name: text('Confirm', '确认'), exact: true }).click(); await disabledAlert; await ready(page);
    assert.equal(auth.appSpaceEnabled('intelligence', 'synthetic-family'), false, 'owner enable/disable succeeds while displaying a nonmember');
    assert.equal(alerts.length, 6, 'existing actions retain acknowledged success alerts');
    page.off('dialog', acknowledge);
    // Displaying a foreign owner must not lend that owner's write authority.
    const foreign = auth.createSelfServiceSpace({ type: 'family', ownerId: 'a-member' });
    auth.setMembership({ spaceId: foreign.id, userId: 'b-context-50', role: 'member' });
    await open(page, `view=spaces&space=${foreign.id}`); await switchUser('a-member');
    await page.locator('select[name=space]').selectOption(foreign.id); await ready(page); await manage(page);
    assert.equal(await page.getByRole('button', { name: text('Enable', '启用'), exact: true }).count(), 0, 'foreign-owner display context cannot expose owner-only actions');
    const access = await (await context.request.get(`${origin}/api/business/web-access`)).json();
    assert.equal((await context.request.put(`${origin}/api/business/account/spaces/${foreign.id}/apps/reminder`, { headers: { Origin: origin, 'X-CSRF-Token': access.csrfToken }, data: { enabled: true } })).status(), 403, 'the unchanged server refuses a non-owner administrator write');
    assert.equal(auth.appSpaceEnabled('reminder', foreign.id), false, 'rejected action has no enrollment effect');
    await page.locator('.space-back').click(); await ready(page);
    assert.equal(await page.locator('.space-delete').count(), 1, 'administrator retains foreign-space deletion while displaying its creator');
    await page.getByRole('button', { name: text('Load more users', '加载更多用户'), exact: true }).click(); await ready(page);
    await switchUser('b-context-50');
    await page.locator('select[name=space]').selectOption(foreign.id); await ready(page);
    assert.equal(await page.locator('.space-delete').count(), 1, 'non-creator member projection does not mask administrator deletion');
    evidence.push({ width, ...await inspectConfirmation(page, page.locator('.space-delete'), 'administrator deletion in non-creator member context') });
    const deleted = page.waitForResponse(response => response.request().method() === 'DELETE' && response.url().endsWith(`/spaces/${foreign.id}`));
    const success = page.waitForEvent('dialog');
    await page.locator('.space-delete').click();
    await page.locator('.space-delete-confirm input').fill(foreign.id);
    await page.locator('.space-delete-confirm button[type=submit]').click();
    const deletionResponse = await deleted;
    assert.equal(deletionResponse.status(), 200);
    assert.deepEqual(deletionResponse.request().postDataJSON(), { confirmSpaceId: foreign.id }, 'existing deletion payload has no display identity');
    assert.equal(new URL(deletionResponse.url()).search, '', 'display context is never sent on writes');
    await (await success).accept(); await ready(page);
    assert.equal(await sessionId(), 'z-owner', 'confirmed deletion uses the administrator session');
    assert.equal(auth.db.prepare('SELECT 1 FROM auth_spaces WHERE id=?').get(foreign.id), undefined);
    assert.equal(auth.db.prepare('SELECT 1 FROM auth_members WHERE space_id=?').get(foreign.id), undefined, 'existing membership cascade runs');
    assert.equal(await page.locator(`select[name=space] option[value="${foreign.id}"]`).count(), 0, 'deleted selection is refreshed');
    assert.equal(await page.locator('#selected-user').inputValue(), 'b-context-50', 'deletion retains display context');
    const protectedSpace = auth.ensurePersonalSpace('a-member');
    await open(page, `view=spaces&space=${protectedSpace.id}`); await switchUser('z-owner');
    await page.locator('select[name=space]').selectOption(protectedSpace.id); await ready(page);
    assert.equal(await page.locator('.space-delete').count(), 0, 'actor capability retains automatic-personal protection even when the display user is an administrator');
    await page.locator('#refresh').click(); await ready(page);
    await page.locator('#navigation [data-view=access]').click(); await ready(page);
    assert.equal(await page.locator('#selected-user').inputValue(), 'a-member', 'App access keeps its established selection behavior');
    await page.locator('#navigation [data-view=grants]').click(); await ready(page);
    const firstUsers = await (await context.request.get(`${origin}/api/business/admin/users?limit=50`)).json();
    assert.ok(!firstUsers.users.some(user => user.id === 'z-owner'), 'administrator really is beyond first user page');
    assert.equal(await page.locator('#selected-user').inputValue(), 'z-owner', 'delegations defaults to signed-in administrator outside catalog page');
    assert.equal(await page.locator('.grant-row').count(), 0, 'administrator empty grants are not mislabeled member grants');
    assert.equal(await page.getByRole('searchbox').count(), 0, 'Agent delegations current user is a plain dropdown without search');
    await switchUser('a-member'); assert.equal(await page.locator('.grant-row').count(), 50);
    await page.getByRole('button', { name: text('Load more delegations', '加载更多委托'), exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll('.grant-row').length === 51);
    assert.equal(await page.locator('#selected-user').inputValue(), 'a-member');
    const expectedIds = auth.listGrants('a-member').map(grant => grant.id).sort();
    const expectedSpaces = new Map(auth.listGrants('a-member').map(grant => [grant.id, [...new Set(grant.rules.map(rule => rule.spaceId))].sort()]));
    evidence.push({ width, paginatedIdentifiers: await inspectDelegations(page, expectedSpaces) });
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
    evidence.push({ width, language, spaceUserCatalog: 'plain dropdown; all registered users; pagination and selection beyond first page survive refresh', spaceDefault: 'administrator', memberProjection: 'data matches actual member browser; actor controls retained', administratorContextDeletion: 'confirmed 200 with unchanged payload and membership cascade', foreignOwnerWrite: 403, nativeSession: 'unchanged', delegations: 'own default outside first catalog page; selection, pagination, refresh, stale read', ordinaryUser: 'own only, no switcher', overflow: 0, status: 'Pass' });
    await context.close(); await memberContext.close();
  }
  t.diagnostic(JSON.stringify({ fixture: 'isolated synthetic AuthStore and real HTTP handlers', browser: browser.version(), evidence }));
});

test('Chromium user sections, dedicated account pages and confirmed deletion work at desktop and phone widths', { skip: !browserEnabled, timeout: 150000 }, async t => {
  const { chromium } = await import(process.env.PLAYWRIGHT_MODULE);
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE, args: ['--no-sandbox'] });
  t.after(() => browser.close());
  const { origin, auth } = await fixture(t), evidence = [];
  const artifacts = process.env.ADMIN_LAYOUT_ARTIFACTS;
  if (artifacts) mkdirSync(artifacts, { recursive: true });
  for (const [width, language] of [[1440, 'en'], [390, 'zh']]) {
    const text = (en, zh) => language === 'en' ? en : zh;
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    const member = await browser.newContext({ viewport: { width, height: 900 } });
    t.after(() => context.close()); t.after(() => member.close());
    await context.addCookies([{ name: 'praxis_locale', value: language, url: origin }]);
    await member.addCookies([{ name: 'praxis_locale', value: language, url: origin }]);
    const login = async (client, username, pass = password) => assert.equal((await client.request.post(`${origin}/auth/login`, { headers: { Origin: origin }, data: { username, password: pass } })).status(), 200);
    await login(context, 'synthetic-owner'); await login(member, 'synthetic-member');
    const page = await context.newPage(), memberPage = await member.newPage(), errors = [], alerts = [];
    page.setDefaultTimeout(10000); memberPage.setDefaultTimeout(10000);
    page.on('pageerror', error => errors.push(error.message));
    page.on('dialog', async dialog => { alerts.push(dialog.message()); await dialog.accept(); });
    const open = async route => { await page.goto(`${origin}/admin/?${route}`); await ready(page); };
    const write = async (method, suffix, action) => {
      const response = page.waitForResponse(response => response.request().method() === method && response.url().endsWith(suffix));
      await action(); assert.equal((await response).ok(), true); await ready(page);
    };
    const confirm = () => page.locator('.confirm-dialog').getByRole('button', { name: text('Confirm', '确认'), exact: true }).click();
    await open('view=users');
    assert.equal(await page.locator('.pane-heading #create-user:visible').count(), 0, 'creation is not a pane-heading action');
    const creation = page.locator('section').filter({ has: page.getByRole('heading', { name: text('New user', '新用户'), exact: true }) });
    assert.equal(await creation.count(), 1, 'list has a New user section');
    assert.equal(await page.locator('.account-setting').count(), 0, 'list contains no inline account editor');
    evidence.push(await inspectLayout(page, width, 'users/list'));
    const username = `synthetic-new-user-${width}`;
    await creation.locator('input[name=username]').fill(username);
    await creation.locator('input[name=password]').fill(password);
    await write('POST', '/admin/users', () => creation.locator('button[type=submit]').click());
    const created = auth.db.prepare('SELECT id FROM auth_users WHERE username=?').get(username).id;
    assert.equal(new URL(page.url()).searchParams.get('user'), created, 'creation opens dedicated account page');
    assert.equal(await page.locator('#content .user-list').count(), 0, 'detail does not append to the list');
    assert.equal(await page.getByRole('heading', { name: text('New user', '新用户'), exact: true }).count(), 0, 'detail contains no creation section');
    assert.equal(await page.locator('input[name=username]').count(), 0);
    assert.equal(await page.locator('#heading').innerText(), username);
    evidence.push(await inspectLayout(page, width, 'users/detail'));
    if (artifacts) await page.screenshot({ path: join(artifacts, `${width}-users-detail.png`), fullPage: true });
    await page.reload(); await ready(page);
    assert.equal(new URL(page.url()).searchParams.get('user'), created, 'detail reload preserves account');
    await page.getByRole('link', { name: text('Back to users', '返回用户列表'), exact: true }).click(); await ready(page);
    assert.equal(new URL(page.url()).searchParams.has('user'), false);
    assert.equal(await page.locator('.account-setting').count(), 0);
    await page.goBack(); await ready(page); assert.equal(new URL(page.url()).searchParams.get('user'), created, 'browser Back restores dedicated detail');
    await page.getByRole('button', { name: text('Disable account', '停用账号'), exact: true }).click();
    await write('PATCH', `/users/${created}`, confirm);
    assert.equal(auth.db.prepare('SELECT enabled FROM auth_users WHERE id=?').get(created).enabled, 0);
    await page.getByRole('button', { name: text('Enable account', '启用账号'), exact: true }).click();
    await write('PATCH', `/users/${created}`, confirm);
    assert.equal(auth.db.prepare('SELECT enabled FROM auth_users WHERE id=?').get(created).enabled, 1);
    const replacementPassword = `${password}-reset`;
    await page.locator('input[name=password]').fill(replacementPassword);
    await write('POST', `/users/${created}/password`, () => page.locator('.password-form button[type=submit]').click());
    await page.getByRole('button', { name: text('Grant administrator role', '设为管理员'), exact: true }).click();
    await write('PUT', `/users/${created}/platform-admin`, confirm);
    assert.equal(auth.isPlatformAdmin(created), true);
    await page.getByRole('button', { name: text('Remove administrator role', '移除管理员'), exact: true }).click();
    await write('PUT', `/users/${created}/platform-admin`, confirm);
    assert.equal(auth.isPlatformAdmin(created), false);
    const personal = auth.ensurePersonalSpace(created);
    auth.setMembership({ spaceId: 'synthetic-family', userId: created, role: 'member' });
    auth.setSpaceAppEnrollment({ spaceId: 'synthetic-family', appId: 'reminder', enabled: true });
    auth.grantResource({ userId: created, appId: 'reminder', spaceId: 'synthetic-family', actions: ['read'], resources: ['synthetic-user-deletion'] });
    auth.setWebAccess({ userId: created, apps: ['intelligence'], prds: false });
    const grant = auth.createGrant({ userId: created, clientId: 'synthetic-client', rules: [{ appId: 'reminder', spaceId: 'synthetic-family', actions: ['read'], resources: ['synthetic-user-deletion'] }] });
    const token = auth.issueToken({ grantId: grant.id }).accessToken;
    const victim = await browser.newContext(); t.after(() => victim.close());
    await login(victim, username, replacementPassword);
    // Populate each administrator view with the soon-to-be-deleted selected user.
    for (const view of ['spaces', 'grants', 'access']) {
      await page.locator(`#navigation [data-view=${view}]`).click(); await ready(page);
      await page.locator('#selected-user').selectOption(created); await ready(page);
      assert.equal(await page.locator('#selected-user').inputValue(), created);
    }
    await page.locator('#navigation [data-view=users]').click(); await ready(page);
    await page.locator(`[data-user="${created}"] a`).click(); await ready(page);
    const trigger = page.getByRole('button', { name: text('Delete user', '删除用户'), exact: true });
    evidence.push({ width, ...await inspectConfirmation(page, trigger, `${width}/typed user deletion`) });
    await trigger.click();
    const dialog = page.locator('.confirm-dialog'), typed = dialog.locator('input[name=confirmUsername]'), submit = dialog.locator('button[type=submit]');
    assert.match(await dialog.innerText(), /sessions|会话/);
    assert.match(await dialog.innerText(), /remain|retained|保留/);
    assert.equal(await submit.isDisabled(), true);
    await typed.fill(`${username} `); assert.equal(await submit.isDisabled(), true, 'typed username must match exactly');
    await typed.fill(username.toUpperCase()); assert.equal(await submit.isDisabled(), true, 'username confirmation is case-sensitive');
    await typed.fill(username); assert.equal(await submit.isEnabled(), true);
    if (artifacts) await page.screenshot({ path: join(artifacts, `${width}-user-delete-confirmation.png`), fullPage: true });
    const removed = page.waitForResponse(response => response.request().method() === 'DELETE' && response.url().endsWith(`/users/${created}`));
    await submit.click();
    const removal = await removed; assert.equal(removal.status(), 200);
    assert.deepEqual(removal.request().postDataJSON(), { confirmUsername: username }); await ready(page);
    assert.equal(new URL(page.url()).searchParams.has('user'), false, 'deletion returns to list');
    assert.equal(await page.locator(`[data-user="${created}"]`).count(), 0, 'deleted user leaves list');
    assert.match(alerts.at(-1), /User deleted|用户已删除/);
    assert.equal(auth.db.prepare('SELECT 1 FROM auth_spaces WHERE id=?').get(personal.id), undefined, 'automatic personal space removed with account');
    for (const table of ['auth_users', 'auth_sessions', 'auth_members', 'auth_resources', 'auth_web_access', 'auth_platform_admins', 'auth_grants']) {
      const column = table === 'auth_users' ? 'id' : 'user_id';
      assert.equal(auth.db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${column}=?`).get(created).n, 0, `${table} has no deleted user`);
    }
    assert.equal((await victim.request.get(`${origin}/api/business/account/session`)).status(), 401, 'deleted native session is rejected immediately');
    assert.throws(() => auth.authorize(token, { appId: 'reminder', spaceId: 'synthetic-family', action: 'read', resourceId: 'synthetic-user-deletion' }), 'deleted bearer credential cannot authorize');
    for (const view of ['spaces', 'grants', 'access']) {
      await page.locator(`#navigation [data-view=${view}]`).click(); await ready(page);
      assert.equal(await page.locator(`#selected-user option[value="${created}"]`).count(), 0, `${view} has no cached deleted user`);
      assert.notEqual(await page.locator('#selected-user').inputValue(), created, `${view} clears deleted selection`);
    }
    await open('view=spaces&space=synthetic-family&app=reminder');
    assert.equal(await page.locator(`select[name=userId] option[value="${created}"]`).count(), 0, 'member/resource selector has no deleted account');
    for (const activeView of ['spaces', 'grants']) {
      const concurrent = `synthetic-concurrent-${width}-${activeView}`;
      auth.createUser({ id: concurrent, username: concurrent, password });
      await page.locator('#refresh').click(); await ready(page);
      for (const view of [...['spaces', 'grants', 'access'].filter(view => view !== activeView), activeView]) {
        await page.locator(`#navigation [data-view=${view}]`).click(); await ready(page);
        await page.locator('#selected-user').selectOption(concurrent); await ready(page);
      }
      auth.deleteUser({ userId: concurrent, actorId: 'z-owner', confirmUsername: concurrent });
      await page.locator('#refresh').click(); await ready(page);
      for (const view of ['spaces', 'grants', 'access']) {
        await page.locator(`#navigation [data-view=${view}]`).click(); await ready(page);
        assert.equal(await page.locator(`#selected-user option[value="${concurrent}"]`).count(), 0, `${view}: Refresh removes a concurrently deleted cached account`);
        assert.notEqual(await page.locator('#selected-user').inputValue(), concurrent, `${view}: concurrent deletion clears selected context`);
      }
    }
    await open('view=users&user=z-owner');
    assert.equal(await page.getByRole('button', { name: text('Delete user', '删除用户'), exact: true }).count(), 0, 'current administrator has no delete action');
    const metadata = await (await context.request.get(`${origin}/api/business/account/session`)).json();
    assert.equal((await context.request.delete(`${origin}/api/business/admin/users/z-owner`, { headers: { Origin: origin, 'X-CSRF-Token': metadata.csrfToken }, data: { confirmUsername: 'synthetic-owner' } })).status(), 403, 'administrator self-delete refused at API');
    const memberSession = await (await member.request.get(`${origin}/api/business/account/session`)).json();
    for (const id of ['a-member', 'z-owner']) assert.equal((await member.request.delete(`${origin}/api/business/admin/users/${id}`, { headers: { Origin: origin, 'X-CSRF-Token': memberSession.csrfToken }, data: { confirmUsername: id === 'a-member' ? 'synthetic-member' : 'synthetic-owner' } })).status(), 403, 'ordinary users cannot delete themselves or others');
    await memberPage.goto(`${origin}/admin/?view=users&user=z-owner`); await ready(memberPage);
    assert.equal(await memberPage.locator('#navigation [data-view=users]:visible').count(), 0);
    assert.equal(await memberPage.locator('.account-setting, input[name=username], input[name=confirmUsername]').count(), 0, 'ordinary-user deep link reveals no management controls');
    const ownedUser = `synthetic-space-owner-${width}`, ownedId = `synthetic-user-owned-space-${width}`;
    auth.createUser({ id: ownedUser, username: ownedUser, password });
    auth.createSpace({ id: ownedId, type: 'family', ownerId: ownedUser });
    await open(`view=users&user=${ownedUser}`);
    await page.getByRole('button', { name: text('Delete user', '删除用户'), exact: true }).click();
    await page.locator('.confirm-dialog input[name=confirmUsername]').fill(ownedUser);
    const refused = page.waitForResponse(response => response.request().method() === 'DELETE' && response.url().endsWith(`/users/${ownedUser}`));
    await page.locator('.confirm-dialog button[type=submit]').click(); assert.equal((await refused).status(), 409); await ready(page, { allowError: true });
    assert.match(await page.locator('#notice.error').innerText(), new RegExp(ownedId), 'owned-space refusal names the spaces to resolve');
    assert.ok(auth.db.prepare('SELECT 1 FROM auth_users WHERE id=?').get(ownedUser));
    assert.ok(auth.db.prepare('SELECT 1 FROM auth_spaces WHERE id=?').get(ownedId));
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth <= 1));
    assert.deepEqual(errors, []);
    evidence.push({ width, language, sectionCreation: 'Pass', dedicatedDetailHistoryAndReload: 'Pass', enableDisablePasswordAndRole: 'Pass', modalExactUsernameAndCancellation: 'Pass', deletionCascadeAndImmediateRevocation: 'Pass', pickerInvalidation: 'Pass', concurrentDeletionRefresh: 'Pass', selfAndMemberRefusal: 'Pass', ownedSpacesRefusal: ownedId, overflow: 0, status: 'Pass' });
    await victim.close(); await context.close(); await member.close();
  }
  // A direct account URL must not depend on the first page of the user catalog.
  for (let index = 0; index < 51; index++) auth.createUser({ id: `b-pagination-${String(index).padStart(2, '0')}`, username: `synthetic-pagination-${index}`, password });
  const late = 'zz-synthetic-beyond-first-page'; auth.createUser({ id: late, username: late, password });
  const context = await browser.newContext(); t.after(() => context.close());
  await context.addCookies([{ name: 'praxis_locale', value: 'en', url: origin }]);
  assert.equal((await context.request.post(`${origin}/auth/login`, { headers: { Origin: origin }, data: { username: 'synthetic-owner', password } })).status(), 200);
  const catalog = await (await context.request.get(`${origin}/api/business/admin/users?limit=50`)).json();
  assert.equal(catalog.users.some(user => user.id === late), false);
  const page = await context.newPage(); await page.goto(`${origin}/admin/?view=users&user=${late}`); await ready(page);
  assert.equal(await page.locator('#heading').innerText(), late);
  assert.equal(await page.locator('.account-setting').count(), 2, 'deep-link detail loads a user beyond first catalog page');
  evidence.push({ deepLinkBeyondFirstPage: 'Pass' });
  t.diagnostic(JSON.stringify({ fixture: 'isolated synthetic AuthStore and real authorization/administration HTTP handlers; synthetic identities only', browser: browser.version(), evidence }));
});

test('Chromium Spaces switches effective user access in place and manages app-scoped delegations', { skip: !browserEnabled, timeout: 120000 }, async t => {
  const { chromium } = await import(process.env.PLAYWRIGHT_MODULE);
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE, args: ['--no-sandbox'] });
  t.after(() => browser.close());
  const { origin, auth } = await fixture(t), evidence = [];
  const space = auth.createSelfServiceSpace({ type: 'family', ownerId: 'z-owner' });
  auth.setMembership({ spaceId: space.id, userId: 'a-member', role: 'member' });
  auth.setSpaceAppEnrollment({ spaceId: space.id, appId: 'reminder', enabled: true });
  auth.grantResource({ userId: 'z-owner', spaceId: space.id, appId: 'reminder', resources: ['synthetic-owner-resource'], actions: ['update'] });
  auth.grantResource({ userId: 'a-member', spaceId: space.id, appId: 'reminder', resources: ['synthetic-member-resource'], actions: ['read'] });
  const artifacts = process.env.ADMIN_LAYOUT_ARTIFACTS;
  if (artifacts) mkdirSync(artifacts, { recursive: true });
  for (const [width, language] of [[1440, 'en'], [390, 'zh']]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    const memberContext = await browser.newContext({ viewport: { width, height: 900 } });
    t.after(() => context.close()); t.after(() => memberContext.close());
    for (const [target, username] of [[context, 'synthetic-owner'], [memberContext, 'synthetic-member']]) {
      await target.addCookies([{ name: 'praxis_locale', value: language, url: origin }]);
      assert.equal((await target.request.post(`${origin}/auth/login`, { headers: { Origin: origin }, data: { username, password } })).status(), 200);
    }
    const page = await context.newPage(), memberPage = await memberContext.newPage(), errors = [];
    for (const target of [page, memberPage]) { target.setDefaultTimeout(10000); target.on('pageerror', error => errors.push(error.message)); target.on('dialog', dialog => dialog.accept()); }
    const open = async (target, app = '') => { await target.goto(`${origin}/admin/?view=spaces&space=${space.id}${app ? `&app=${app}` : ''}`); await ready(target); };
    const switchUser = async id => {
      const wasApp = new URL(page.url()).searchParams.get('app');
      await page.locator('#selected-user').selectOption(id); await ready(page);
      assert.equal(await page.locator('#selected-user').inputValue(), id);
      if (new URL(page.url()).searchParams.get('view') === 'spaces') {
        assert.equal(new URL(page.url()).searchParams.has('app'), false, 'user switch resets the app selection');
        await page.locator('select[name=space]').selectOption(space.id); await ready(page);
        if (wasApp) { await page.locator(`.space-app-row[data-app="${wasApp}"] a`).click(); await ready(page); }
      }
    };
    await open(page); await open(memberPage);
    const summary = '.space-app-row[data-app=reminder] .app-user-access';
    const ownerSummary = await page.locator(summary).innerText();
    assert.match(ownerSummary, /synthetic-owner-resource/);
    await switchUser('a-member');
    assert.notEqual(await page.locator(summary).innerText(), ownerSummary, 'overview changes immediately without navigating');
    assert.equal(await page.locator(summary).innerText(), await memberPage.locator(summary).innerText(), 'overview matches the selected user real session');
    assert.doesNotMatch(await page.locator(summary).innerText(), /synthetic-owner-resource/);
    assert.equal(await page.locator('.space-delete, input[name=username]').count(), 2, 'acting owner capabilities survive user switch');
    await page.locator('.space-app-row[data-app=reminder] a').click(); await ready(page);
    await memberPage.locator('.space-app-row[data-app=reminder] a').click(); await ready(memberPage);
    assert.equal(await page.locator('.app-user-access').innerText(), await memberPage.locator('.app-user-access').innerText());
    await switchUser('z-owner');
    assert.match(await page.locator('.app-user-access').innerText(), /synthetic-owner-resource/);
    await switchUser('a-member');
    assert.match(await page.locator('.app-user-access').innerText(), /synthetic-member-resource/);
    assert.equal(await page.locator('input[name=resources]').count(), 1, 'administrator grant form remains available');
    await switchUser('z-owner');
    let release, seen, finish;
    const held = new Promise(resolve => { release = resolve; }), requested = new Promise(resolve => { seen = resolve; }), finished = new Promise(resolve => { finish = resolve; });
    const contextUrl = `${origin}/api/business/account/spaces?contextUserId=a-member`;
    const delayed = async route => { const response = await route.fetch(); seen(); await held; await route.fulfill({ response }); finish(); };
    await page.route(contextUrl, delayed);
    await page.locator('#selected-user').selectOption('a-member'); await requested;
    assert.equal(await page.locator('.app-user-access').count(), 0, 'old user data is cleared while loading');
    await page.locator('#selected-user').selectOption('z-owner'); await ready(page);
    release(); await finished; await page.unroute(contextUrl, delayed);
    assert.equal(await page.locator('#selected-user').inputValue(), 'z-owner');
    await page.locator('select[name=space]').selectOption(space.id); await ready(page);
    assert.match(await page.locator('.space-app-row[data-app=reminder] .app-user-access').innerText(), /synthetic-owner-resource/, 'delayed member response cannot replace current context');
    await page.locator('.space-app-row[data-app=reminder] a').click(); await ready(page);
    await switchUser('a-member');

    const rule = { appId: 'reminder', spaceId: space.id, actions: ['read'], resources: ['synthetic-member-resource'] };
    const active = auth.createGrant({ userId: 'a-member', clientId: 'synthetic-client', rules: [rule] });
    const token = auth.issueToken({ grantId: active.id }).accessToken;
    const expired = auth.createGrant({ userId: 'a-member', clientId: 'synthetic-client', rules: [rule] });
    auth.db.prepare('UPDATE auth_grants SET expires_at=? WHERE id=?').run(Date.now() - 1000, expired.id);
    await page.locator('#refresh').click(); await ready(page);
    const row = page.locator(`.space-delegations [data-grant="${active.id}"]`);
    assert.equal(await row.count(), 1, 'matching app and space delegation visible');
    assert.equal(await page.locator(`.space-delegations [data-grant="${expired.id}"] button`).count(), 1, 'expired delegation is manageable');
    evidence.push({ width, ...await inspectConfirmation(page, row.locator('button'), 'app delegation revoke') });
    const deleted = page.waitForResponse(response => response.request().method() === 'DELETE' && response.url().endsWith(`/grants/${active.id}`));
    await row.locator('button').click();
    assert.match(await page.locator('.confirm-dialog').innerText(), /all apps and spaces|全部应用与空间/);
    await page.locator('.confirm-dialog').getByRole('button', { name: /^(Confirm|确认)$/ }).click();
    assert.equal((await deleted).status(), 200); await ready(page);
    await page.waitForFunction(id => document.querySelector(`[data-grant="${id}"]`)?.dataset.status === 'revoked', active.id);
    assert.equal(await page.locator(`[data-grant="${active.id}"]`).getAttribute('data-status'), 'revoked');
    assert.equal(await page.locator(`[data-grant="${active.id}"] button`).count(), 0);
    assert.throws(() => auth.authenticate(token), error => error.status === 401, 'token immediately refused');
    await page.goto(`${origin}/admin/?view=grants`); await ready(page); await switchUser('a-member');
    assert.equal(await page.locator(`[data-grant="${active.id}"]`).getAttribute('data-status'), 'revoked', 'grant view reflects per-app revocation');
    const expiredRow = page.locator(`[data-grant="${expired.id}"]`);
    assert.equal(await expiredRow.locator('button').count(), 1, 'grant management includes expired records');
    await expiredRow.locator('button').click();
    await page.locator('.confirm-dialog').getByRole('button', { name: /^(Confirm|确认)$/ }).click(); await ready(page);
    await page.waitForFunction(id => document.querySelector(`[data-grant="${id}"]`)?.dataset.status === 'revoked', expired.id);
    assert.equal(await page.locator(`[data-grant="${expired.id}"]`).getAttribute('data-status'), 'revoked');
    // Self-service uses the unchanged own-grant API even on a Space page.
    const self = auth.createGrant({ userId: 'a-member', clientId: 'synthetic-client', rules: [rule] });
    await open(memberPage, 'reminder');
    const selfDeleted = memberPage.waitForResponse(response => response.request().method() === 'DELETE' && response.url().endsWith(`/account/grants/${self.id}`));
    await memberPage.locator(`[data-grant="${self.id}"] button`).click();
    await memberPage.locator('.confirm-dialog').getByRole('button', { name: /^(Confirm|确认)$/ }).click();
    assert.equal((await selfDeleted).status(), 200); await ready(memberPage);
    await memberPage.waitForFunction(id => document.querySelector(`[data-grant="${id}"]`)?.dataset.status === 'revoked', self.id);
    assert.equal(await memberPage.locator(`[data-grant="${self.id}"]`).getAttribute('data-status'), 'revoked');
    for (const target of [page, memberPage]) assert.ok(await target.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    if (artifacts) await memberPage.screenshot({ path: join(artifacts, `${width}-space-delegation-management.png`), fullPage: true });
    assert.deepEqual(errors, []);
    evidence.push({ width, language, context: 'overview and app effective actions/resources equal real member session; actor controls preserved', revocation: 'admin and own app page; expired in grants view; modal cancellation/focus/geometry; immediate token 401', overflow: 0, status: 'Pass' });
  }
  t.diagnostic(JSON.stringify({ fixture: 'isolated synthetic HTTP AuthStore', browser: browser.version(), evidence }));
});

test('Chromium Spaces removes filler hints for owners and members across all space types', { skip: !browserEnabled, timeout: 90000 }, async t => {
  const { chromium } = await import(process.env.PLAYWRIGHT_MODULE);
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE, args: ['--no-sandbox'] });
  t.after(() => browser.close());
  const { origin, auth } = await fixture(t), evidence = [];
  auth.createUser({ id: 'synthetic-view-member', username: 'synthetic-view-member', password });
  const automatic = auth.ensurePersonalSpace('a-member');
  const spaces = ['personal', 'family', 'company'].map(type => auth.createSelfServiceSpace({ type, ownerId: 'a-member' }));
  spaces.push({ ...automatic, deletionProtected: auth.spaceDeletionProtected(automatic.id) });
  assert.equal(spaces.at(-1).deletionProtected, true, 'fixture includes a genuinely protected automatic personal space');
  for (const space of spaces) {
    if (space.type !== 'personal') auth.setMembership({ spaceId: space.id, userId: 'synthetic-view-member', role: 'member' });
    auth.setSpaceAppEnrollment({ spaceId: space.id, appId: 'reminder', enabled: true });
    auth.grantResource({ userId: 'a-member', appId: 'reminder', spaceId: space.id, actions: ['read'], resources: ['synthetic-owner-framing-resource'] });
  }
  const ownerHint = /You own this space|你是此空间的所有者|Ask the space owner to enable apps|需要启用应用或变更资源权限时|^App enrollment and resource permissions are separate\.$|^应用启用状态与资源权限分开展示。$/m;
  const overviewInstruction = /Manage each app’s enrollment|分别设置应用的启用状态与权限/;
  const appInstruction = /grant only the required actions below|请在下方仅授予所需操作/;
  const artifacts = process.env.ADMIN_LAYOUT_ARTIFACTS;
  if (artifacts) mkdirSync(artifacts, { recursive: true });
  for (const width of [1440, 390]) for (const language of ['en', 'zh']) {
    const contexts = await Promise.all([0, 1, 2].map(() => browser.newContext({ viewport: { width, height: 900 } })));
    const [admin, owner, member] = contexts, pages = [];
    for (const [index, context] of contexts.entries()) {
      t.after(() => context.close());
      await context.addCookies([{ name: 'praxis_locale', value: language, url: origin }]);
      assert.equal((await context.request.post(`${origin}/auth/login`, { headers: { Origin: origin }, data: { username: ['synthetic-owner', 'synthetic-member', 'synthetic-view-member'][index], password } })).status(), 200);
      pages.push(await context.newPage());
    }
    const [page, ownerPage, memberPage] = pages, errors = [], writes = [];
    for (const target of pages) target.on('pageerror', error => errors.push(error.message));
    page.on('request', request => { if (!['GET', 'HEAD'].includes(request.method())) writes.push(request.method()); });
    const open = async (target, space) => { await target.goto(`${origin}/admin/?view=spaces&space=${space.id}`); await ready(target); };
    const manage = async target => { await target.locator('.space-app-row[data-app=reminder] a').click(); await ready(target); };
    const stableRefresh = async () => {
      await page.evaluate(() => {
        window.framingShifts = [];
        window.framingObserver = new PerformanceObserver(list => { window.framingShifts.push(...list.getEntries().map(entry => entry.value)); });
        window.framingObserver.observe({ type: 'layout-shift' });
      });
      const before = await layoutGeometry(page);
      await page.locator('#refresh').click(); await ready(page);
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      assert.deepEqual(await layoutGeometry(page), before, 'refresh preserves geometry and scroll');
      const shifts = await page.evaluate(() => { window.framingObserver.disconnect(); return window.framingShifts; });
      assert.equal(shifts.reduce((total, value) => total + value, 0), 0, 'refresh produces zero layout shift');
    };
    for (const space of spaces) {
      await open(page, space);
      await page.locator('#selected-user').selectOption('a-member'); await ready(page);
      await page.locator('select[name=space]').selectOption(space.id); await ready(page);
      assert.match(await page.locator('#content>.section-note').innerText(), /Viewing synthetic-member|正在查看 synthetic-member/);
      assert.doesNotMatch(await page.locator('#content').innerText(), ownerHint);
      assert.doesNotMatch(await page.locator('#content').innerText(), overviewInstruction);
      assert.equal(await page.locator('input[name=username], .user-row button').count(), 0, 'foreign owner context has no member-management affordance');
      assert.equal(await page.locator('.space-delete').count(), space.deletionProtected ? 0 : 1, 'actor Delete is independent of displayed ownership and respects automatic protection');
      await open(ownerPage, space);
      assert.doesNotMatch(await ownerPage.locator('#content').innerText(), ownerHint, 'ordinary owner has no filler hints');
      assert.match(await ownerPage.locator('#content').innerText(), overviewInstruction, 'ordinary owner keeps onboarding');
      assert.equal(await ownerPage.locator('input[name=username]').count(), space.type === 'personal' ? 0 : 1);
      assert.equal(await ownerPage.locator('#selected-user').count(), 0, 'ordinary owner has no context switcher');
      for (const selector of ['.user-row .user-summary', '.space-app-row>div']) assert.deepEqual(await page.locator(selector).allTextContents(), await ownerPage.locator(selector).allTextContents(), 'foreign owner read-model matches their native browser session');
      await stableRefresh();
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      if (artifacts) await page.screenshot({ path: join(artifacts, `${width}-${language}-${space.type}-${space.deletionProtected ? 'automatic' : 'created'}-neutral-overview.png`), fullPage: true });
      await manage(page); await manage(ownerPage);
      assert.doesNotMatch(await page.locator('#content').innerText(), appInstruction, 'foreign owner app context has no owner-onboarding imperative');
      assert.match(await ownerPage.locator('#content').innerText(), appInstruction, 'owner app onboarding unchanged');
      assert.equal(await page.locator('input[name=resources], [data-permission] button, .account-setting button').count(), 0, 'foreign context cannot expose enrollment or permission controls');
      assert.equal(await ownerPage.locator('input[name=resources]').count(), 1, 'owner keeps resource grant form');
      for (const selector of ['.app-user-access', '[data-permission] .control-summary']) assert.deepEqual(await page.locator(selector).allTextContents(), await ownerPage.locator(selector).allTextContents(), 'foreign owner app/resource read-model matches their native browser session');
      await stableRefresh();
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      if (space.type !== 'personal') {
        await page.locator('#selected-user').selectOption('synthetic-view-member'); await ready(page);
        await page.locator('select[name=space]').selectOption(space.id); await ready(page); await manage(page);
        await open(memberPage, space); await manage(memberPage);
        assert.equal(await memberPage.locator('#selected-user, input[name=resources], [data-permission] button, .account-setting button').count(), 0);
        assert.match(await memberPage.locator('#content').innerText(), appInstruction, 'existing ordinary-member app copy is unchanged');
        for (const selector of ['.app-user-access', '[data-permission] .control-summary']) assert.deepEqual(await page.locator(selector).allTextContents(), await memberPage.locator(selector).allTextContents(), 'member projection matches native session');
        await memberPage.locator('.space-back').click(); await ready(memberPage);
        assert.doesNotMatch(await memberPage.locator('#content').innerText(), ownerHint);
        assert.doesNotMatch(await memberPage.locator('#content').innerText(), ownerHint, 'member overview has no filler hints');
      }
      evidence.push({ width, language, type: space.type, automaticPersonal: Boolean(space.deletionProtected), fillerHints: 'absent for owner/member/administrator', foreignContext: 'neutral overview/app; no owner controls', projection: 'equals native owner/member session', delete: space.deletionProtected ? 'protected' : 'actor retained', refreshLayoutShift: 0, overflow: 0, result: 'Pass' });
    }
    // Acting ownership controls remain when the display user is a member.
    await open(page, { id: 'synthetic-family' });
    await page.locator('#selected-user').selectOption('a-member'); await ready(page);
    await page.locator('select[name=space]').selectOption('synthetic-family'); await ready(page);
    assert.doesNotMatch(await page.locator('#content').innerText(), ownerHint);
    assert.equal(await page.locator('input[name=username]').count(), 1);
    assert.equal((await (await admin.request.get(`${origin}/api/business/account/session`)).json()).user.id, 'z-owner');
    assert.deepEqual(writes, [], 'all context/read-model checks are mutation-free');
    assert.deepEqual(errors, []);
    for (const context of contexts) await context.close();
  }
  t.diagnostic(JSON.stringify({ fixture: 'isolated synthetic AuthStore and real HTTP handlers; no business service contacted', browser: browser.version(), evidence }));
});

test('Chromium Spaces picker follows the displayed user with distinct personal IDs, reset and stale-read isolation', { skip: !browserEnabled, timeout: 120000 }, async t => {
  const { chromium } = await import(process.env.PLAYWRIGHT_MODULE);
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE, args: ['--no-sandbox'] });
  t.after(() => browser.close());
  const { origin, auth } = await fixture(t), evidence = [];
  auth.createUser({ id: 'b-second', username: 'synthetic-second', password });
  auth.createUser({ id: 'c-empty', username: 'synthetic-empty', password });
  const memberPersonal = auth.createSpace({ id: 'a-context-member-personal', type: 'personal', ownerId: 'a-member' });
  const secondPersonal = auth.createSpace({ id: 'a-context-second-personal', type: 'personal', ownerId: 'b-second' });
  const shared = auth.createSpace({ id: 'b-context-shared-family', type: 'family', ownerId: 'z-owner' });
  const company = auth.createSpace({ id: 'c-context-member-company', type: 'company', ownerId: 'a-member' });
  const adminPersonal = auth.createSpace({ id: 'z-context-admin-personal', type: 'personal', ownerId: 'z-owner' });
  for (const userId of ['a-member', 'b-second']) auth.setMembership({ spaceId: shared.id, userId, role: 'member' });
  const artifacts = process.env.ADMIN_LAYOUT_ARTIFACTS;
  if (artifacts) mkdirSync(artifacts, { recursive: true });
  const filler = /You own this space|你是此空间的所有者|Ask the space owner to enable apps|需要启用应用或变更资源权限时|^App enrollment and resource permissions are separate\.$|^应用启用状态与资源权限分开展示。$/m;
  for (const width of [1440, 390]) for (const language of ['en', 'zh']) {
    const contexts = await Promise.all([0, 1, 2].map(() => browser.newContext({ viewport: { width, height: 900 } })));
    const [admin, member, second] = contexts;
    for (const [index, context] of contexts.entries()) {
      t.after(() => context.close());
      await context.addCookies([{ name: 'praxis_locale', value: language, url: origin }]);
      assert.equal((await context.request.post(`${origin}/auth/login`, { headers: { Origin: origin }, data: { username: ['synthetic-owner', 'synthetic-member', 'synthetic-second'][index], password } })).status(), 200);
    }
    const nativeIds = async context => (await (await context.request.get(`${origin}/api/business/account/spaces`)).json()).spaces.map(space => space.id);
    const memberIds = await nativeIds(member), secondIds = await nativeIds(second);
    const page = await admin.newPage(), errors = [], writes = [];
    page.setDefaultTimeout(10000);
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => { if (!['GET', 'HEAD'].includes(request.method())) writes.push(request.method()); });
    const ids = () => page.locator('select[name=space] option').evaluateAll(nodes => nodes.map(node => node.value));
    const switchUser = async id => { await page.locator('#selected-user').selectOption(id); await ready(page); };
    const selectSpace = async id => { await page.locator('select[name=space]').selectOption(id); await ready(page); };
    const check = async expected => {
      assert.deepEqual(await ids(), expected, 'picker IDs equal the displayed user native API list');
      assert.doesNotMatch(await page.locator('#content').innerText(), filler);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    };
    await page.goto(`${origin}/admin/?view=spaces&space=${adminPersonal.id}`); await ready(page);
    assert.equal(await page.locator('select[name=space]').inputValue(), adminPersonal.id);
    assert.doesNotMatch(await page.locator('#content').innerText(), filler, 'acting administrator owner has no filler hint');
    await switchUser('a-member'); await check(memberIds);
    assert.equal(await page.locator('select[name=space]').inputValue(), memberPersonal.id, 'member actual personal ID replaces the administrator personal ID');
    assert.equal(await page.locator(`select[name=space] option[value="${adminPersonal.id}"]`).count(), 0, 'administrator personal space never bleeds into member context');
    assert.ok(memberIds.includes(shared.id) && memberIds.includes(company.id), 'owned company and joined family both appear');
    await selectSpace(shared.id);
    await page.locator('.space-app-row[data-app=reminder] a').click(); await ready(page);
    await switchUser('b-second'); await check(secondIds);
    assert.equal(await page.locator('select[name=space]').inputValue(), secondPersonal.id, 'shared-space overlap does not preserve the old selected space');
    assert.equal(new URL(page.url()).searchParams.has('app'), false, 'context switch clears app selection');
    assert.equal(await page.locator('.space-back').count(), 0, 'new context returns to overview');
    await switchUser('c-empty');
    assert.equal(await page.locator('select[name=space], .space-app-row, .space-delete, .space-back').count(), 0, 'empty displayed account has no former context controls');
    assert.match(await page.locator('#content').innerText(), /No spaces yet|暂无空间/);
    assert.equal(new URL(page.url()).searchParams.has('space'), false, 'empty context clears the space URL');
    await switchUser('a-member'); await check(memberIds);
    await selectSpace(company.id);
    await page.locator('#refresh').click(); await ready(page);
    assert.equal(await page.locator('select[name=space]').inputValue(), company.id, 'refresh preserves a valid current-user selection');
    await page.locator('.space-app-row[data-app=reminder] a').click(); await ready(page);
    assert.equal(await page.locator('.account-setting button, input[name=resources]').count(), 0, 'viewing another owner lends no owner write controls');
    await page.locator('.space-back').click(); await ready(page);
    assert.equal(await page.locator('select[name=space]').inputValue(), company.id, 'Manage/Back preserves the selected current-user space');
    let release, seen, finished;
    const hold = new Promise(resolve => { release = resolve; });
    const requested = new Promise(resolve => { seen = resolve; });
    const completed = new Promise(resolve => { finished = resolve; });
    const contextUrl = `${origin}/api/business/account/spaces?contextUserId=b-second`;
    const delayed = async route => { const response = await route.fetch(); seen(); await hold; await route.fulfill({ response }); finished(); };
    await page.route(contextUrl, delayed);
    await page.locator('#selected-user').selectOption('b-second'); await requested;
    assert.equal(await page.locator('select[name=space], .space-app-row').count(), 0, 'old spaces disappear while the next list is loading');
    await switchUser('a-member'); await check(memberIds);
    release(); await completed; await page.unroute(contextUrl, delayed);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await check(memberIds);
    assert.equal(await page.locator('#selected-user').inputValue(), 'a-member', 'delayed collection cannot restore the prior context');
    assert.equal(await page.locator('select[name=space]').inputValue(), memberPersonal.id);
    assert.equal((await (await admin.request.get(`${origin}/api/business/account/session`)).json()).user.id, 'z-owner', 'display projection never changes the acting session');
    assert.deepEqual(writes, [], 'context and picker verification makes no mutation requests');
    assert.deepEqual(errors, []);
    if (artifacts) await page.screenshot({ path: join(artifacts, `${width}-${language}-spaces-displayed-user-list.png`), fullPage: true });
    evidence.push({ width, language, personalIds: 'distinct; displayed native list equality', types: 'personal, owned company, joined family', selection: 'reset across shared overlap and empty account; refresh/Back retain current', delayedCollection: 'discarded', mutations: 0, overflow: 0, status: 'Pass' });
    for (const context of contexts) await context.close();
  }
  t.diagnostic(JSON.stringify({ fixture: 'isolated synthetic AuthStore and real HTTP handlers; no business service contacted', browser: browser.version(), evidence }));
});

test('Chromium members leave spaces through the centered modal without stale access or borrowed display authority', { skip: !browserEnabled, timeout: 150000 }, async t => {
  const { chromium } = await import(process.env.PLAYWRIGHT_MODULE);
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE, args: ['--no-sandbox'] });
  t.after(() => browser.close());
  const { origin, auth } = await fixture(t), evidence = [];
  const artifacts = process.env.ADMIN_LAYOUT_ARTIFACTS;
  if (artifacts) mkdirSync(artifacts, { recursive: true });
  for (const width of [1440, 390]) for (const language of ['en', 'zh']) {
    const suffix = `${width}-${language}`, memberId = `leave-member-${suffix}`, ownerId = `leave-owner-${suffix}`;
    for (const id of [memberId, ownerId]) auth.createUser({ id, username: id, password });
    const personal = auth.ensurePersonalSpace(memberId), retained = auth.createSelfServiceSpace({ type: 'family', ownerId });
    auth.setMembership({ spaceId: retained.id, userId: memberId, role: 'member' });
    auth.setSpaceAppEnrollment({ spaceId: retained.id, appId: 'reminder', enabled: true });
    auth.grantResource({ userId: memberId, appId: 'reminder', spaceId: retained.id, actions: ['read'], resources: ['synthetic-leave-record'] });
    const member = await browser.newContext({ viewport: { width, height: 900 } }), owner = await browser.newContext({ viewport: { width, height: 900 } }), admin = await browser.newContext({ viewport: { width, height: 900 } });
    t.after(() => member.close()); t.after(() => owner.close()); t.after(() => admin.close());
    for (const context of [member, owner, admin]) await context.addCookies([{ name: 'praxis_locale', value: language, url: origin }]);
    const login = async (context, username) => assert.equal((await context.request.post(`${origin}/auth/login`, { headers: { Origin: origin }, data: { username, password } })).status(), 200);
    await login(member, memberId); await login(owner, ownerId); await login(admin, 'synthetic-owner');
    const page = await member.newPage(), ownerPage = await owner.newPage(), adminPage = await admin.newPage(), errors = [], dialogs = [];
    for (const target of [page, ownerPage, adminPage]) { target.on('pageerror', error => errors.push(error.message)); target.on('dialog', async dialog => { if (target === page) dialogs.push(dialog.message()); await dialog.accept(); }); }
    const open = async (target, spaceId, app = '') => { await target.goto(`${origin}/admin/?view=spaces&space=${spaceId}${app ? `&app=${app}` : ''}`); await ready(target); };
    await open(page, personal.id);
    assert.equal(await page.locator('.space-leave').count(), 0, 'automatic personal space has no leave concept');
    for (const type of ['family', 'company']) {
      const space = auth.createSelfServiceSpace({ type, ownerId });
      auth.setMembership({ spaceId: space.id, userId: memberId, role: 'member' });
      for (const appId of ['reminder', 'intelligence']) auth.setSpaceAppEnrollment({ spaceId: space.id, appId, enabled: true });
      auth.grantResource({ userId: memberId, appId: 'reminder', spaceId: space.id, actions: ['read'], resources: ['synthetic-leave-record'] });
      const rule = spaceId => ({ appId: 'reminder', spaceId, actions: ['read'], resources: ['synthetic-leave-record'] });
      const multi = auth.createGrant({ userId: memberId, clientId: 'synthetic-client', rules: [rule(space.id), rule(retained.id)] });
      const single = auth.createGrant({ userId: memberId, clientId: 'synthetic-client', rules: [rule(space.id)] });
      const token = auth.issueToken({ grantId: multi.id }).accessToken;
      await open(ownerPage, space.id);
      assert.equal(await ownerPage.locator('.space-leave').count(), 0, 'owner has deletion instead of leave');
      assert.equal(await ownerPage.locator('.space-delete').count(), 1);
      await open(adminPage, space.id);
      await adminPage.locator('#selected-user').selectOption(memberId); await ready(adminPage);
      await adminPage.locator('select[name=space]').selectOption(space.id); await ready(adminPage);
      assert.equal(auth.membershipRole('z-owner', space.id), null);
      assert.equal(await adminPage.locator('.space-leave').count(), 0, 'viewing another member never lends their leave authority');
      await open(page, space.id);
      const trigger = page.locator('.space-leave');
      assert.equal(await trigger.count(), 1);
      if (type === 'family') evidence.push({ width, language, ...await inspectConfirmation(page, trigger, `${suffix}-leave-space`) });
      assert.equal(auth.membershipRole(memberId, space.id), 'member', 'all dismissals preserve membership');
      await trigger.click();
      const confirmation = page.locator('.space-leave-confirm');
      assert.equal(await confirmation.locator('li').count(), 3, 'warning identifies membership, permissions and delegation cleanup');
      assert.match(await confirmation.innerText(), /resource permissions that require membership|依赖成员身份的资源权限/);
      assert.match(await confirmation.innerText(), /no remaining rules will be revoked|无剩余规则的委托将被撤销/);
      assert.equal(await confirmation.getByRole('button', { name: language === 'en' ? 'Cancel' : '取消', exact: true }).evaluate(node => node === document.activeElement), true, 'cancel receives initial focus');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth <= 1), true, 'leave dialog has no horizontal overflow');
      if (width === 390) assert.ok((await confirmation.locator('button').evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().height))).every(height => height >= 44), 'phone controls retain touch targets');
      if (artifacts) await page.screenshot({ path: join(artifacts, `${suffix}-${type}-leave-confirmation.png`), fullPage: true });
      const response = page.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith(`/spaces/${space.id}/leave`));
      await confirmation.getByRole('button', { name: language === 'en' ? 'Leave space' : '退出空间', exact: true }).click();
      const left = await response; assert.equal(left.status(), 200); assert.deepEqual(left.request().postDataJSON(), {}, 'session supplies the departing user without body parameters');
      await ready(page);
      assert.equal(auth.membershipRole(memberId, space.id), null);
      assert.equal(auth.db.prepare('SELECT count(*) AS n FROM auth_resources WHERE user_id=? AND space_id=? AND membership_required=1').get(memberId, space.id).n, 0);
      assert.equal(auth.getGrant(multi.id).rules.some(rule => rule.spaceId === space.id), false, 'multi-space delegation is pruned');
      assert.ok(auth.db.prepare('SELECT revoked_at FROM auth_grants WHERE id=?').get(single.id).revoked_at, 'empty delegation is revoked');
      assert.throws(() => auth.authorize(token, { appId: 'reminder', spaceId: space.id, action: 'read', resourceId: 'synthetic-leave-record' }));
      assert.equal(auth.authorize(token, { appId: 'reminder', spaceId: retained.id, action: 'read', resourceId: 'synthetic-leave-record' }).spaceId, retained.id, 'unrelated delegation rules remain usable');
      assert.equal((await member.request.get(`${origin}/api/business/account/spaces/${space.id}`)).status(), 404, 'departed space is immediately inaccessible');
      const access = await (await member.request.get(`${origin}/api/business/web-access`)).json();
      assert.equal(access.apps.includes('intelligence'), false, 'membership-only app entry is immediately lost');
      assert.equal(access.apps.includes('reminder'), true, 'another space retains its entry');
      assert.equal(await page.locator(`select[name=space] option[value="${space.id}"]`).count(), 0);
      assert.notEqual(new URL(page.url()).searchParams.get('space'), space.id);
      assert.equal(new URL(page.url()).searchParams.has('app'), false);
      assert.equal(await page.locator('select[name=space]').evaluate(node => node === document.activeElement), true, 'focus moves to the refreshed picker');
      assert.match(dialogs.at(-1), /You left the space|你已退出空间/);
      await open(page, space.id, 'reminder');
      assert.notEqual(new URL(page.url()).searchParams.get('space'), space.id, 'stale app deep link falls back to a current space');
      assert.equal(new URL(page.url()).searchParams.has('app'), false);
      await page.reload(); await ready(page);
      assert.equal(await page.locator(`select[name=space] option[value="${space.id}"]`).count(), 0, 'refresh cannot restore departed references');
      // The owner can still remove a member through the established confirmed action.
      auth.setMembership({ spaceId: space.id, userId: memberId, role: 'member' });
      await open(ownerPage, space.id);
      const row = ownerPage.locator(`.user-row[data-member="${memberId}"]`);
      await row.getByRole('button', { name: language === 'en' ? 'Remove' : '移除', exact: true }).click();
      const removed = ownerPage.waitForResponse(response => response.request().method() === 'DELETE' && response.url().endsWith(`/members/${memberId}`));
      await ownerPage.locator('.confirm-dialog').getByRole('button', { name: language === 'en' ? 'Confirm' : '确认', exact: true }).click();
      assert.equal((await removed).status(), 200); await ready(ownerPage);
      assert.equal(auth.membershipRole(memberId, space.id), null, 'owner removal stays unchanged');
      evidence.push({ width, language, type, warningAndConfirmation: 'Pass', membershipPermissionAndDelegationCleanup: 'Pass', immediateAccessLoss: 'Pass', unrelatedScopePreserved: 'Pass', pickerRouteAndReload: 'Pass', ownerRemoval: 'Pass', administratorDisplayDoesNotBorrowAuthority: 'Pass' });
    }
    assert.deepEqual(errors, []);
    await member.close(); await owner.close(); await admin.close();
  }
  t.diagnostic(JSON.stringify({ fixture: 'isolated synthetic AuthStore and real HTTP handlers; no business services', browser: browser.version(), evidence }));
});
