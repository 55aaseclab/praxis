import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AuthStore, createAuthHandler, SESSION_COOKIE } from '../src/business/auth.mjs';
import { createPraxisServer, WORKSPACE_ROOT } from '../src/server.mjs';
import { DEFAULT_APP_REGISTRY } from '../src/default-app-registry.mjs';

test('anonymous visitors get the public product homepage and signed-in users keep the workbench', async t => {
  const root = await mkdtemp(join(tmpdir(), 'praxis-public-home-')); t.after(() => rm(root, { recursive: true, force: true }));
  const host = 'public-home.synthetic.test', canonical = 'https://' + host;
  const auth = new AuthStore({ file: join(root, 'auth.sqlite'), issuer: canonical, registry: DEFAULT_APP_REGISTRY });
  auth.createUser({ id: 'owner', username: 'owner', password: 'Synthetic public home password' });
  auth.setWebAccess({ userId: 'owner', apps: [], workbench: true, prds: false });
  const cookie = SESSION_COOKIE + '=' + auth.login({ username: 'owner', password: 'Synthetic public home password' }).sessionToken;
  const core = createServer(async (request, response) => {
    if (!await createAuthHandler({ store: auth, webGateway: { enabled: true } })(request, response)) response.writeHead(404).end();
  });
  let web;
  t.after(async () => { for (const server of [web, core]) if (server) { server.webGateway?.close?.(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } auth.close(); });
  core.listen(0, '127.0.0.1'); await once(core, 'listening');
  web = createPraxisServer({ root: WORKSPACE_ROOT, publicUrlsFile: null, observationsFile: null, businessUrl: null, consoleUpstream: null, webGateway: { enabled: true, canonicalUrl: canonical, coreUrl: `http://127.0.0.1:${core.address().port}`, appTargets: {} } });
  web.listen(0, '127.0.0.1'); await once(web, 'listening');
  const request = (path, session) => new Promise((resolve, reject) => {
    const outgoing = httpRequest({ hostname: '127.0.0.1', port: web.address().port, path, headers: { Host: host, ...(session ? { Cookie: session } : {}) } }, incoming => {
      const parts = []; incoming.on('data', part => parts.push(part)); incoming.on('error', reject); incoming.on('end', () => { const body = Buffer.concat(parts).toString(); resolve({ status: incoming.statusCode, headers: { get: key => incoming.headers[key.toLowerCase()] }, text: async () => body, json: async () => JSON.parse(body) }); });
    }); outgoing.on('error', reject); outgoing.end();
  });

  const home = await request('/', null);
  assert.equal(home.status, 200);
  assert.match(home.headers.get('content-type'), /text\/html/);
  assert.equal(home.headers.get('x-robots-tag'), undefined);
  const html = await home.text();
  assert.match(html, /<html lang="en">/);
  assert.match(html, new RegExp(`<link rel="canonical" href="${canonical}/">`));
  assert.match(html, new RegExp(`hreflang="zh-Hans" href="${canonical}/zh-cn/"`));
  assert.match(html, /property="og:image" content="https:\/\/public-home\.synthetic\.test\/home-images\/workbench-en\.png"/);
  assert.doesNotMatch(html, /noindex/);
  assert.doesNotMatch(html, /About Praxis/);
  assert.doesNotMatch(html, /Ask for an outcome\. Choose what your agent can access\./);
  assert.match(html, /<header class="site-header"><div class="header-inner wrap"/);
  assert.match(html, /<div class="hero-intro"><h1[^>]*>[\s\S]*?<\/h1><div class="hero-actions">[\s\S]*?<\/div><\/div><figure class="product-example hero-demo">/);
  assert.match(html, /class="card-stage"><article class="result-card"/);
  assert.match(html, /<\/header><p class="card-reason">/);
  assert.match(html, /Authorize\. Ask\. Review\./);
  assert.match(html, /id="cards" class="cards-section wrap"/);
  assert.match(html, /class="result-card"/);
  assert.match(html, /data-animation="\/home-images\/workbench-en\.gif"/);
  assert.match(html, /<noscript><a class="demo-toggle demo-fallback" href="\/home-images\/workbench-en\.gif"/);
  for (const id of ['reminder', 'knowledge', 'lattice-slides', 'travel', 'tingproof', 'memo', 'finance', 'intelligence', 'polaris', 'letters', 'profiles', 'projects', 'calendar', 'matrix-reader']) {
    assert.match(html, new RegExp(`github\\.com/55aaseclab/${id === 'lattice-slides' ? 'lattice' : id}"`));
  }
  assert.match(html, /img src="data:image\/svg\+xml;base64,/);
  assert.match(html, new RegExp(`Connect to Praxis at ${canonical}/mcp using OAuth\\.`));
  assert.match(home.headers.get('content-security-policy'), /script-src 'self' 'sha256-/);

  const chinese = await request('/zh-cn/', null);
  assert.equal(chinese.status, 200);
  const zhHtml = await chinese.text();
  assert.match(zhHtml, /<html lang="zh-CN">/);
  assert.match(zhHtml, new RegExp(`<link rel="canonical" href="${canonical}/zh-cn/">`));
  assert.match(zhHtml, /为你的 AI 智能体，<br>准备一个自己的工作台。/);
  assert.match(zhHtml, /授权。提问。查看结果。/);
  assert.match(zhHtml, /class="result-card"/);
  assert.match(zhHtml, /\/home-images\/workbench-zh\.png/);
  assert.equal((await request('/zh-cn', null)).status, 308);

  const workbench = await request('/', cookie);
  assert.equal(workbench.status, 200);
  assert.equal(workbench.headers.get('x-robots-tag'), 'noindex, nofollow');
  assert.match(await workbench.text(), /app\.js/);

  const stylesheet = await request('/home.css', null);
  assert.equal(stylesheet.status, 200);
  assert.match(stylesheet.headers.get('content-type'), /text\/css/);
  assert.equal((await request('/home.js', null)).status, 200);
  const poster = await request('/home-images/workbench-en.png', null);
  assert.equal(poster.status, 200);
  assert.match(poster.headers.get('content-type'), /image\/png/);
  assert.equal((await request('/home-images/workbench-zh.gif', null)).status, 200);
  assert.equal((await request('/home-images/../../src/server.mjs', null)).status, 404);

  const sitemap = await request('/sitemap.xml', null);
  assert.equal(sitemap.status, 200);
  const sitemapText = await sitemap.text();
  assert.match(sitemapText, new RegExp(`<loc>${canonical}/</loc>`));
  assert.match(sitemapText, new RegExp(`<loc>${canonical}/zh-cn/</loc>`));
  assert.match(sitemapText, /hreflang="x-default"/);
  assert.doesNotMatch(sitemapText, /about/);

  const robots = await request('/robots.txt', null);
  assert.equal(robots.status, 200);
  const robotsText = await robots.text();
  assert.match(robotsText, new RegExp(`Sitemap: ${canonical}/sitemap.xml`));
  assert.match(robotsText, /Allow: \/\$/);
  assert.doesNotMatch(robotsText, /about/);

  assert.equal((await request('/about/', null)).status, 401);
  assert.equal((await request('/apps/travel/', null)).status, 401);
});
