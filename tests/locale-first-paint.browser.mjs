import test from 'node:test';
import assert from 'node:assert/strict';
import { localeFixture } from './locale-first-paint-fixture.mjs';

// Run with PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs.
// JavaScript requests are held until the parsed, styled document has been
// asserted. This distinguishes server localization from a fast client swap.
test('localized platform first paint survives Chromium refresh and navigation at 1440/390', {
  skip: !process.env.PLAYWRIGHT_MODULE, timeout: 180000,
}, async t => {
  const fixture = await localeFixture(t);
  const { chromium } = await import(process.env.PLAYWRIGHT_MODULE);
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE, args: ['--no-sandbox'] });
  t.after(() => browser.close());
  const evidence = [];

  async function firstPaint(page, navigate, language, label, { managed = false, status = 200 } = {}) {
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const hold = async route => {
      if (route.request().resourceType() === 'script') await gate;
      await route.continue();
    };
    await page.route('**/*', hold);
    try {
    const response = await navigate();
    assert.equal(response.status(), status, label);
    await page.waitForFunction(() => document.readyState !== 'loading');
    await page.waitForFunction(() => !document.querySelector('link[rel=stylesheet]') || [...document.querySelectorAll('link[rel=stylesheet]')].every(link => link.sheet));
    const initial = await page.evaluate(language => {
      const expected = (node, chinese, english) => language === 'zh' ? node.getAttribute(chinese) : node.getAttribute(english);
      const wrong = [];
      for (const node of document.querySelectorAll('[data-zh]')) {
        if (node.textContent !== expected(node, 'data-zh', 'data-en')) wrong.push({ kind: 'text', tag: node.tagName, id: node.id, actual: node.textContent, expected: expected(node, 'data-zh', 'data-en') });
      }
      for (const node of document.querySelectorAll('[data-zh-label]')) {
        if (node.getAttribute('aria-label') !== expected(node, 'data-zh-label', 'data-en-label')) wrong.push({ kind: 'label', id: node.id, actual: node.getAttribute('aria-label') });
      }
      const mutable = node => node.closest('#notice, #heading, #projects-heading, #platform-notice, #content, #attention-program, #account');
      const nodes = [...document.querySelectorAll('[data-zh], [data-zh-label]')].filter(node => !mutable(node));
      const snapshot = node => ({ text: node.hasAttribute('data-zh') ? node.textContent : null, label: node.getAttribute('aria-label') });
      const originals = new Map(nodes.map(node => [node, snapshot(node)]));
      const visibleTextSizes = new Map(nodes.filter(node => node.hasAttribute('data-zh') && node.getClientRects().length).map(node => {
        const r = node.getBoundingClientRect(); return [node, [r.width, r.height]];
      }));
      const swaps = [], shifts = [];
      const observer = new MutationObserver(() => {
        for (const [node, original] of originals) {
          if (node.isConnected && JSON.stringify(snapshot(node)) !== JSON.stringify(original)) swaps.push({ id: node.id, before: original, after: snapshot(node) });
        }
      });
      observer.observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['aria-label', 'lang'] });
      const layout = new PerformanceObserver(list => {
        for (const entry of list.getEntries()) {
          // Dynamic account/agenda loading and initially hidden navigation are
          // allowed. Only initially visible locale text is relevant here.
          if (entry.sources?.some(source => visibleTextSizes.has(source.node))) shifts.push(entry.value);
        }
      });
      layout.observe({ type: 'layout-shift' });
      window.localePaintProbe = { originals, visibleTextSizes, swaps, shifts, observer, layout };
      return { lang: document.documentElement.lang, wrong, textCount: document.querySelectorAll('[data-zh]').length, heading: document.querySelector('h1')?.textContent, selected: document.querySelector('[data-language-preference]')?.value };
    }, language);
    assert.equal(initial.lang, language === 'zh' ? 'zh-CN' : 'en', `${label}: server locale`);
    assert.deepEqual(initial.wrong, [], `${label}: initial text/accessible labels before any application script`);
    if (label.startsWith('sign-in')) assert.match(initial.heading, language === 'zh' ? /登录 Praxis/ : /Sign in to Praxis/, `${label}: initial heading`);
    if (label.startsWith('registration')) assert.match(initial.heading, language === 'zh' ? /创建 Praxis 账号/ : /Create a Praxis account/, `${label}: initial heading`);
    if (label === 'empty delegation') assert.match(initial.heading, language === 'zh' ? /智能体授权/ : /Agent access/, `${label}: initial heading`);
    if (initial.selected) assert.equal(initial.selected, language, `${label}: server-selected language`);
    release();
    await page.waitForLoadState('domcontentloaded');
    if (managed) await page.waitForFunction(() => document.querySelector('[data-language-preference]')?.offsetParent !== null && document.querySelector('#account-name')?.textContent);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const completed = await page.evaluate(() => {
      const probe = window.localePaintProbe;
      probe.observer.disconnect(); probe.layout.disconnect();
      return {
        swaps: probe.swaps, shifts: probe.shifts,
        sizeChanges: [...probe.visibleTextSizes].filter(([node, before]) => {
          if (!node.isConnected || !node.getClientRects().length) return false;
          const r = node.getBoundingClientRect(); return Math.abs(r.width - before[0]) > .1 || Math.abs(r.height - before[1]) > .1;
        }).map(([node, before]) => ({ id: node.id, before, after: [node.getBoundingClientRect().width, node.getBoundingClientRect().height] })),
        overflow: document.documentElement.scrollWidth > innerWidth,
      };
    });
    assert.deepEqual(completed.swaps, [], `${label}: no post-load locale text swap`);
    assert.deepEqual(completed.shifts, [], `${label}: no locale-related layout shift`);
    assert.deepEqual(completed.sizeChanges, [], `${label}: static localized text retains geometry`);
    assert.equal(completed.overflow, false, `${label}: no horizontal overflow`);
    evidence.push({ label, language, width: page.viewportSize().width, initialLocale: initial.lang, translatedNodes: initial.textCount, localeSwaps: 0, localeShifts: 0 });
    return initial;
    } finally {
      release();
      await page.unroute('**/*', hold);
    }
  }

  async function clickNavigation(page, selector) {
    const response = page.waitForResponse(response => response.request().isNavigationRequest() && response.request().frame() === page.mainFrame() && response.status() !== 303);
    await page.locator(selector).click({ noWaitAfter: true });
    return response;
  }

  for (const width of [1440, 390]) for (const language of ['en', 'zh']) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    await context.addCookies([{ name: 'praxis_locale', value: language, url: fixture.origin }, fixture.sessionCookie]);
    // A stale localStorage preference must not override the SSR cookie.
    await context.addInitScript(value => localStorage.setItem('praxis.locale', value === 'en' ? 'zh' : 'en'), language);
    const page = await context.newPage();
    page.setDefaultTimeout(10000);
    await firstPaint(page, () => page.goto(fixture.origin + '/', { waitUntil: 'commit' }), language, 'managed workbench');
    await firstPaint(page, () => page.reload({ waitUntil: 'commit' }), language, 'workbench refresh');
    await firstPaint(page, async () => {
      const response = page.waitForResponse(response => response.request().isNavigationRequest() && new URL(response.url()).pathname === '/admin/');
      await page.locator('a[data-admin-nav]').click({ noWaitAfter: true });
      return response;
    }, language, 'workbench → gateway Settings', { managed: true });
    await firstPaint(page, () => page.reload({ waitUntil: 'commit' }), language, 'gateway Settings refresh', { managed: true });
    const directContext = await browser.newContext({ viewport: { width, height: 900 } });
    await directContext.addCookies([{ name: 'praxis_locale', value: language, url: fixture.directCoreOrigin }, fixture.directSessionCookie]);
    const directPage = await directContext.newPage();
    await firstPaint(directPage, () => directPage.goto(fixture.directCoreOrigin + '/admin/?view=general', { waitUntil: 'commit' }), language, 'direct core Settings', { managed: true });
    await directContext.addCookies([fixture.delegateSessionCookie]);
    await firstPaint(directPage, () => directPage.goto(fixture.directCoreOrigin + '/auth/delegate', { waitUntil: 'commit' }), language, 'empty delegation');
    await directContext.close();

    const opposite = language === 'en' ? 'zh' : 'en';
    await page.locator('[data-language-preference]').selectOption(opposite);
    await page.waitForFunction(value => document.documentElement.lang === value, opposite === 'zh' ? 'zh-CN' : 'en');
    await firstPaint(page, () => page.reload({ waitUntil: 'commit' }), opposite, 'Settings language switch and refresh', { managed: true });
    await page.locator('[data-language-preference]').selectOption(language);
    await page.goto(fixture.origin + '/prds/praxis/');
    assert.equal(await page.locator('html').getAttribute('lang'), language === 'zh' ? 'zh-CN' : 'en');
    assert.match(await page.locator('main').innerText(), language === 'zh' ? /需求|工作台/ : /requirements|workbench/);
    evidence.push({ label: 'workbench PRD reader', language, width, result: 'Pass' });
    await context.close();

    const local = await browser.newContext({ viewport: { width, height: 900 } });
    await local.addCookies([{ name: 'praxis_locale', value: language, url: fixture.standaloneOrigin }]);
    const localPage = await local.newPage();
    await firstPaint(localPage, () => localPage.goto(fixture.standaloneOrigin + '/', { waitUntil: 'commit' }), language, 'standalone workbench');
    await firstPaint(localPage, () => localPage.goto(fixture.standaloneOrigin + '/admin/', { waitUntil: 'commit' }), language, 'standalone Settings');
    await local.close();

    const publicContext = await browser.newContext({ viewport: { width, height: 900 } });
    await publicContext.addCookies([{ name: 'praxis_locale', value: language, url: fixture.origin }]);
    const publicPage = await publicContext.newPage();
    const home = await firstPaint(publicPage, () => publicPage.goto(fixture.origin + '/', { waitUntil: 'commit' }), language, 'public home');
    assert.match(home.heading, language === 'zh' ? /为你的 AI 智能体/ : /A self-hosted workbench/);
    await firstPaint(publicPage, () => publicPage.reload({ waitUntil: 'commit' }), language, 'public home refresh');
    await firstPaint(publicPage, () => clickNavigation(publicPage, 'header a[hreflang]'), opposite, 'homepage language link');
    await firstPaint(publicPage, () => publicPage.reload({ waitUntil: 'commit' }), opposite, 'homepage language persistence');
    await firstPaint(publicPage, () => clickNavigation(publicPage, 'header a[hreflang]'), language, 'homepage return language link');
    assert.equal((await publicContext.cookies()).find(cookie => cookie.name === 'praxis_locale')?.value, language);
    await firstPaint(publicPage, () => clickNavigation(publicPage, 'header a.workbench'), language, 'sign-in from homepage');
    await firstPaint(publicPage, () => publicPage.reload({ waitUntil: 'commit' }), language, 'sign-in refresh');
    await firstPaint(publicPage, () => clickNavigation(publicPage, 'a[href^="/auth/register"]'), language, 'registration from sign-in');
    await firstPaint(publicPage, () => publicPage.reload({ waitUntil: 'commit' }), language, 'registration refresh');
    await firstPaint(publicPage, () => clickNavigation(publicPage, 'a[href^="/auth/login"]'), language, 'sign-in from registration');
    await publicPage.locator('input[name=username]').fill('synthetic-locale-missing-user');
    await publicPage.locator('input[name=password]').fill('synthetic-deliberately-wrong-password');
    const [error] = await Promise.all([publicPage.waitForNavigation({ waitUntil: 'domcontentloaded' }), publicPage.locator('form[method=post] button').click()]);
    assert.equal(error.status(), 401);
    assert.match(await publicPage.locator('[role=alert]').innerText(), language === 'zh' ? /账号或密码不正确/ : /Incorrect username or password/);
    assert.equal(await publicPage.locator('html').getAttribute('lang'), language === 'zh' ? 'zh-CN' : 'en');
    evidence.push({ label: 'synthetic sign-in error', language, width, result: 'Pass' });
    await publicContext.close();
  }
  const fresh = await browser.newContext({ viewport: { width: 390, height: 900 } });
  await fresh.addInitScript(() => localStorage.setItem('praxis.locale', 'zh'));
  const freshPage = await fresh.newPage();
  await firstPaint(freshPage, () => freshPage.goto(fixture.standaloneOrigin + '/', { waitUntil: 'commit' }), 'en', 'default English with stale localStorage');
  await firstPaint(freshPage, () => freshPage.goto(fixture.standaloneOrigin + '/admin/', { waitUntil: 'commit' }), 'en', 'default Settings with stale localStorage');
  await fresh.close();
  t.diagnostic(JSON.stringify({ fixture: 'temporary synthetic auth/events stores; native platform web/core; no business adapters', chromium: browser.version(), evidence }));
});
