import { request as httpRequest } from 'node:http';
import { DEFAULT_APP_REGISTRY } from './default-app-registry.mjs';
import { collectNavigationBody, injectSystemNavigation, isNavigationHtml, navigationContext, navigationHeaders } from './system-navigation.mjs';
import { fileURLToPath } from 'node:url';
import { resolve, isAbsolute } from 'node:path';
import { readApps, appIconEntry } from './apps.mjs';
import { parse, serialize } from 'parse5';

export function requestLocale(request, choice) {
  return choice === 'en' || choice === 'zh' ? choice
    : /(?:^|;\s*)praxis_locale=(en|zh)(?:;|$)/.exec(request.headers.cookie || '')?.[1] || 'en';
}

// Only platform-owned templates call this renderer. User content is never translated.
export function renderPlatformLocale(html, locale) {
  const document = parse(String(html));
  const attribute = (node, name) => node.attrs?.find(attr => attr.name === name)?.value;
  const set = (node, name, value) => {
    const attr = node.attrs.find(attr => attr.name === name);
    if (attr) attr.value = value;
    else node.attrs.push({ name, value });
  };
  const textContent = node => node.nodeName === '#text' ? node.value : (node.childNodes || []).map(textContent).join('');
  const visit = node => {
    if (node.tagName === 'html') {
      set(node, 'lang', locale === 'zh' ? 'zh-CN' : 'en');
      set(node, 'data-praxis-locale', locale);
    }
    const chinese = attribute(node, 'data-zh');
    if (chinese !== undefined) {
      const english = attribute(node, 'data-en') ?? textContent(node);
      set(node, 'data-en', english);
      node.childNodes = [{ nodeName: '#text', value: locale === 'zh' ? chinese : english, parentNode: node }];
    }
    const chineseLabel = attribute(node, 'data-zh-label');
    if (chineseLabel !== undefined) {
      const english = attribute(node, 'data-en-label') ?? attribute(node, 'aria-label') ?? '';
      set(node, 'data-en-label', english);
      set(node, 'aria-label', locale === 'zh' ? chineseLabel : english);
    }
    if (node.tagName === 'select' && attribute(node, 'data-language-preference') !== undefined) {
      for (const option of node.childNodes.filter(child => child.tagName === 'option')) {
        option.attrs = option.attrs.filter(attr => attr.name !== 'selected');
        if (attribute(option, 'value') === locale) set(option, 'selected', '');
      }
    }
    for (const child of node.childNodes || []) visit(child);
  };
  visit(document);
  return serialize(document);
}

export const WEB_APPS = Object.freeze(Object.fromEntries(DEFAULT_APP_REGISTRY.webApps.filter(app => app.kind === 'proxy').map(app => [app.id, { slug: app.slug, port: app.nativePort }])));
const safeMethods = new Set(['GET', 'HEAD', 'OPTIONS']);
const hopHeaders = new Set(['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade']);
const blockedParts = new Set(['node_modules', '@fs', '@id', '@vite', 'src', 'server']);
const sessionPattern = /^praxis_business_session=[a-zA-Z0-9_-]{16,512}$/;
const installAssets = new Set(['/manifest.webmanifest', '/praxis-180.png', '/praxis-192.png', '/praxis-512.png']);
const desktopPaths = new Set(['/', '/index.html', '/api/apps', '/api/observations', '/app.js', '/identity.js', '/experience.js', '/install.js', '/styles.css', '/praxis.svg', '/praxis-nav.js', '/praxis-nav.css', '/i18n.js', '/app-registry.js']);
const platformPaths = new Set(['/api/platform/status', '/api/platform/observations', '/api/platform/traces']);

function fail(status, code) { return Object.assign(new Error('Gateway request rejected.'), { status, code }); }
export function gatewayPath(raw) {
  if (typeof raw !== 'string' || raw.length > 16384 || !raw.startsWith('/') || raw.startsWith('//') || /[\\#\x00-\x20\x7f]/.test(raw)) throw fail(404, 'NOT_FOUND');
  const index = raw.indexOf('?');
  const pathname = index === -1 ? raw : raw.slice(0, index);
  let decoded;
  try { decoded = decodeURIComponent(pathname); } catch { throw fail(404, 'NOT_FOUND'); }
  if (/%(?:2f|5c|25)/i.test(pathname) || /[\\\x00-\x20\x7f]/.test(decoded) || decoded.includes('//') || decoded.split('/').some(part => part.startsWith('.') || blockedParts.has(part.toLowerCase()))) {
    if (!['/.well-known/oauth-authorization-server', '/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/mcp'].includes(pathname)) throw fail(404, 'NOT_FOUND');
  }
  // Routing prefixes are literal; encoded app names must not select another target.
  if (/^\/(?:apps|auth|oauth|api|business|admin|mcp|share)(?:\/|$)/.test(decoded) && pathname.split('/').slice(0, 3).some(part => part.includes('%'))) throw fail(404, 'NOT_FOUND');
  return { pathname, search: index === -1 ? '' : raw.slice(index) };
}
function localOrigin(value) {
  const url = new URL(value);
  if (url.protocol !== 'http:' || !['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('Gateway targets must be fixed loopback HTTP origins.');
  return url;
}
function canonicalOrigin(value) {
  const url = new URL(value);
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash || !['https:', 'http:'].includes(url.protocol) || url.protocol === 'http:' && !['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname)) throw new Error('Canonical origin must be HTTPS or loopback HTTP.');
  return url;
}
function cookie(request) {
  const parts = (request.headers.cookie || '').split(';').map(value => value.trim()).filter(value => value.startsWith('praxis_business_session='));
  return parts.length === 1 && sessionPattern.test(parts[0]) ? parts[0] : undefined;
}
function cleanHeaders(input, { credentials = false, upgrade = false } = {}) {
  const dynamic = new Set(String(input.connection || '').toLowerCase().split(',').map(value => value.trim()));
  return Object.fromEntries(Object.entries(input).filter(([name]) => {
    name = name.toLowerCase();
    if (hopHeaders.has(name) || dynamic.has(name) || name.startsWith('x-forwarded-') || name === 'forwarded' || name.startsWith('x-praxis-') || name === 'host') return upgrade && ['connection', 'upgrade'].includes(name);
    return credentials || !['authorization', 'cookie', 'referer'].includes(name);
  }));
}
function writeJson(response, status, value, extra = {}) {
  if (response.destroyed) return;
  const body = JSON.stringify(value);
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body), 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', Vary: 'Cookie', ...extra });
  response.end(body);
}
function coreRoute(pathname, registry = DEFAULT_APP_REGISTRY) {
  return registry.apps.some(app=>[...(app.integration.web.coreAssets||[]),...(app.integration.web.corePages||[])].some(entry=>entry.path===pathname)) || ['/business.html', '/app-transport.js', '/app-registry.js', '/admin.js', '/admin.css', '/admin-mcp.js', '/admin-data.js', '/admin-mcp.css', '/platform.js', '/platform.css', '/platform-charts.js', '/vendor/chartjs-4.6.1.umd.min.js', '/admin', '/admin/'].includes(pathname) || pathname === '/mcp' || pathname === '/business' || pathname.startsWith('/business/') || pathname === '/api/business' || pathname.startsWith('/api/business/') || pathname === '/auth' || pathname.startsWith('/auth/') || pathname === '/oauth' || pathname.startsWith('/oauth/') || ['/.well-known/oauth-authorization-server', '/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/mcp'].includes(pathname);
}
function appRoute(pathname, registry = DEFAULT_APP_REGISTRY) {
  const match = /^\/apps\/([a-z][a-z0-9-]{0,79})(\/.*)?$/.exec(pathname);
  const id = match && registry.webApps.find(app => app.slug === match[1])?.id;
  if (!id) return null;
  return { id, prefix: `/apps/${match[1]}`, pathname: match[2] || '/' };
}
export function canOpenApp(identity, id, registry = DEFAULT_APP_REGISTRY) {
  const web = registry.getWeb(id);
  if (!web) return false;
  if (web.policy === 'document-owner') return identity.platformAdmin === true && (identity.documentOwners?.includes(id) || identity.documentOwner === true && !identity.documentOwners);
  return web.policy === 'platform-admin' ? identity.platformAdmin === true : identity.apps.includes(id);
}
export function gatewayApps(apps, access, origin, registry = DEFAULT_APP_REGISTRY) {
  return apps.filter(app => canOpenApp(access, app.id, registry)).map(app => {
    const { id: appId, kind, name, description, icon, version } = app;
    const web = registry.getWeb(appId), slug = web.slug;
    const url = new URL(`/apps/${slug}${app.path}`, origin);
    return { ...registry.publicFacts().find(fact => fact.id === appId), id: appId, kind, name, description, icon, ...(version && { version }), ...(app.labels && { labels: app.labels }), ...(app.adminOnly === true ? { adminOnly: true } : {}), ...(app.launcher !== undefined ? { launcher: app.launcher } : {}), url: url.href, entry: publicEntry(registry, appId) };
  });
}

function publicEntry(registry, id) {
  const web=registry.getWeb(id);if(!web)return undefined;
  const directory=web.workbenchDirectory;
  return {nativePath:`/apps/${web.slug}/`,policy:web.policy,kind:web.kind,legacyPaths:web.legacyPaths||[],
    ...(registry.getApp(id)?.integration.business?{adapterId:registry.businessId(id)}:{}),
    ...(directory?{workbenchDirectory:{path:directory.path,title:directory.title}}:{})};
}
export { publicEntry };
function relativeProxyPath(value) {
  return typeof value==='string'&&value.startsWith('/')&&!value.startsWith('//')&&!/[\\\x00-\x20]/.test(value)&&!value.split(/[?#]/,1)[0].split('/').some(part=>part==='.'||part==='..');
}

export function createWebGateway({ canonicalUrl, coreUrl = 'http://127.0.0.1:4326', originHost = 'localhost', appTargets = {}, staticApps = {}, privateDocumentOwnerId, privateDocumentOwnerIds = {}, registry = DEFAULT_APP_REGISTRY, readAppCatalog = () => readApps(fileURLToPath(new URL('../', import.meta.url)), { publicUrlsFile: null }), timeoutMs = 3000, revalidateMs = 5000, clock = Date.now, ...installationOptions } = {}) {
  const canonical = canonicalOrigin(canonicalUrl);
  const core = localOrigin(coreUrl);
  if (!/^[a-zA-Z0-9.-]+$/.test(originHost)) throw new Error('Legacy origin Host must be a fixed hostname.');
  if (!Number.isFinite(revalidateMs) || revalidateMs < 20 || revalidateMs > 10000) throw new Error('Gateway revalidation interval is invalid.');
  const targets = Object.fromEntries(registry.webApps.filter(app => app.kind === 'proxy' && (appTargets[app.id] || app.nativePort)).map(app => [app.id, localOrigin(appTargets[app.id] || `http://127.0.0.1:${app.nativePort}`)]));
  const webAppIds = new Set(registry.webAppIds);
  const active = new Set();

  async function access(request) {
    // Ignore cached Basic credentials during browser migration; Bearer is never a website identity.
    if (request.headers.authorization && !/^Basic\s/i.test(request.headers.authorization)) throw fail(403, 'FORBIDDEN');
    const sessionCookie = cookie(request);
    if (!sessionCookie) throw fail(401, 'UNAUTHENTICATED');
    const headers = { Host: canonical.host, Accept: 'application/json', Cookie: sessionCookie };
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), timeoutMs);
    try {
      const result = await new Promise((resolve, reject) => {
        const outgoing = httpRequest(new URL('/api/business/web-access', core), { headers, signal: abort.signal }, resolve);
        outgoing.on('error', reject); outgoing.end();
      });
      if ([401, 403].includes(result.statusCode)) { result.resume(); throw fail(result.statusCode, result.statusCode === 401 ? 'UNAUTHENTICATED' : 'FORBIDDEN'); }
      if (result.statusCode !== 200 || !result.headers['content-type']?.startsWith('application/json')) { result.destroy(); throw fail(503, 'UNAVAILABLE'); }
      const chunks = []; let length = 0;
      for await (const chunk of result) { length += chunk.length; if (length > 16384) { result.destroy(); throw fail(503, 'UNAVAILABLE'); } chunks.push(chunk); }
      const value = JSON.parse(Buffer.concat(chunks));
      if (!value || typeof value.username !== 'string' || !value.username || value.username.length > 200 || !Array.isArray(value.apps) || value.apps.length > webAppIds.size || value.apps.some(id => !webAppIds.has(id)) || new Set(value.apps).size !== value.apps.length || typeof value.workbench !== 'boolean' || typeof value.prds !== 'boolean' || !Number.isSafeInteger(value.expiresAt) || value.expiresAt <= clock() || typeof value.csrfToken !== 'string' || !/^[A-Za-z0-9_-]{16,512}$/.test(value.csrfToken)) throw fail(503, 'UNAVAILABLE');
      if (value.platformAdmin !== undefined && typeof value.platformAdmin !== 'boolean') throw fail(503, 'UNAVAILABLE');
      if (value.canViewPlatform !== undefined && typeof value.canViewPlatform !== 'boolean' || value.permissionsExpireAt !== undefined && value.permissionsExpireAt !== null && (!Number.isSafeInteger(value.permissionsExpireAt) || value.permissionsExpireAt <= clock())) throw fail(503, 'UNAVAILABLE');
      return { ...value, documentOwner: value.platformAdmin === true && Boolean(privateDocumentOwnerId) && privateDocumentOwnerId === value.userId, documentOwners: registry.webApps.filter(app => app.policy === 'document-owner' && value.platformAdmin === true && Boolean(privateDocumentOwnerIds[app.id] || privateDocumentOwnerId) && (privateDocumentOwnerIds[app.id] || privateDocumentOwnerId) === value.userId).map(app => app.id), platformAdmin: value.platformAdmin === true, canViewPlatform: value.canViewPlatform === true, permissionsExpireAt: value.permissionsExpireAt ?? null };
    } catch (error) { if (error.status) throw error; throw fail(503, 'UNAVAILABLE'); }
    finally { clearTimeout(timer); }
  }
  function sameOrigin(request, unsafe = false) {
    return (!request.headers.origin || request.headers.origin === canonical.origin) && (!request.headers['sec-fetch-site'] || ['same-origin', 'none'].includes(request.headers['sec-fetch-site'])) && (!unsafe || request.headers.origin === canonical.origin);
  }
  async function nativeAccess(request, appId, policyId) {
    const definition=registry.getWeb(appId)?.nativePolicies?.[policyId];
    if(!definition)throw fail(403,'FORBIDDEN');
    const endpoint=definition.legacyEndpoint||`/api/business/web-resource-access/${registry.businessId(appId)}/${policyId}`;
    const abort = new AbortController(), timer = setTimeout(() => abort.abort(), timeoutMs);
    try {
      const result = await new Promise((resolve, reject) => {
        const outgoing = httpRequest(new URL(endpoint, core), { headers: { Host: canonical.host, Accept: 'application/json', Cookie: cookie(request) }, signal: abort.signal }, resolve);
        outgoing.on('error', reject); outgoing.end();
      });
      if ([401, 403].includes(result.statusCode)) { result.resume(); throw fail(result.statusCode, result.statusCode === 401 ? 'UNAUTHENTICATED' : 'FORBIDDEN'); }
      if (result.statusCode !== 200 || !result.headers['content-type']?.startsWith('application/json')) { result.destroy(); throw fail(503, 'UNAVAILABLE'); }
      const chunks = []; let size = 0;
      for await (const chunk of result) { size += chunk.length; if (size > 16384) { result.destroy(); throw fail(503, 'UNAVAILABLE'); } chunks.push(chunk); }
      const value = JSON.parse(Buffer.concat(chunks));
      if (value.allowed !== true || !Number.isSafeInteger(value.expiresAt) || value.expiresAt <= clock()) throw fail(503, 'UNAVAILABLE');
      return value;
    } catch (error) { if (error.status) throw error; throw fail(503, 'UNAVAILABLE'); }
    finally { clearTimeout(timer); }
  }
  function denied(request, response, error) {
    const status = [401, 403, 404, 405, 503].includes(error.status) ? error.status : 503;
    const loginUrl = `${canonical.origin}/auth/login?return_to=${encodeURIComponent(request.url)}`;
    if (status === 401 && ['GET', 'HEAD'].includes(request.method) && (request.headers['sec-fetch-dest'] === 'document' || request.headers.accept?.includes('text/html'))) {
      response.writeHead(303, { Location: loginUrl, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' }); return response.end();
    }
    const browserPage = ['GET', 'HEAD'].includes(request.method) &&
      (request.headers['sec-fetch-dest'] === 'document' || request.headers.accept?.includes('text/html')) &&
      /^\/(?:apps|prds)(?:\/|$)/.test(request.url) && !request.url.split('?')[0].includes('/api/');
    if (browserPage && [403, 404, 503].includes(status)) {
      const zh = /(?:^|;\s*)praxis_locale=zh(?:;|$)/.test(request.headers.cookie || '');
      const localize = (english, chinese) => zh ? chinese : english;
      const title = status === 503 ? localize('Page temporarily unavailable', '页面暂时无法读取') : localize('Page unavailable', '页面不可用');
      const detail = status === 503 ? localize('The connection could not be completed. Try again later.', '连接未完成，可以稍后重试。') : localize('This page is unavailable or your account does not have access.', '这个页面不存在或当前账号没有访问权限。');
      const retry = status === 503 ? `<a href="">${localize('Retry', '重新读取')}</a> · ` : '';
      response.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'" });
      response.end(request.method === 'HEAD' ? undefined : `<!doctype html><html lang="${zh ? 'zh-CN' : 'en'}"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} · Praxis</title><style>body{font:1rem/1.6 system-ui,sans-serif;margin:3rem auto;padding:0 1rem;max-width:36rem}h1{font-size:1.5rem}a{display:inline-block;padding:.65rem 0;color:#075db4}</style><main><h1>${title}</h1><p>${detail}</p>${retry}<a href="/">${localize('Back to workbench', '回到工作台')}</a></main></html>`);
      return;
    }
    writeJson(response, status, { code: error.code || 'UNAVAILABLE', ...(status === 401 ? { loginUrl } : {}) });
  }
  function watch(request, response, initial, permitted, destroy) {
    let checking = false;
    const tick = async () => {
      if (checking) return;
      if (Math.min(initial.expiresAt, initial.permissionsExpireAt ?? Infinity) <= clock()) return destroy();
      checking = true;
      try { if (!await permitted(await access(request))) destroy(); } catch { destroy(); }
      finally { checking = false; }
    };
    const interval = setInterval(tick, revalidateMs); interval.unref();
    const expiry = setTimeout(destroy, Math.max(1, Math.min(Math.min(initial.expiresAt, initial.permissionsExpireAt ?? Infinity) - clock(), 2147483647))); expiry.unref();
    const stop = () => { clearInterval(interval); clearTimeout(expiry); active.delete(destroy); };
    response.once('close', stop); active.add(destroy);
    return stop;
  }
  function locationHeader(value, target, prefix, allowCoreRoutes) {
    if (typeof value !== 'string') return undefined;
    let destination;
    try { destination = new URL(value, target); } catch { return undefined; }
    if (![target.host, `${originHost}:${target.port}`, canonical.host].includes(destination.host)) return undefined;
    if (destination.pathname.startsWith(`${prefix}/`) || destination.pathname === prefix) return `${destination.pathname}${destination.search}${destination.hash}`;
    if (allowCoreRoutes && coreRoute(destination.pathname)) return `${destination.pathname}${destination.search}${destination.hash}`;
    try { gatewayPath(`${destination.pathname}${destination.search}`); } catch { return undefined; }
    return `${prefix}${destination.pathname}${destination.search}${destination.hash}`;
  }
  async function proxy(request, response, { target, id, pathname, search = '', prefix = '', credentials = false, share = false, initial, permitted, navigation }) {
    const web = registry.getWeb(id);
    const isolated = Array.isArray(web?.forwardHeaders);
    const headers = cleanHeaders(request.headers, { credentials });
    headers.host = credentials ? canonical.host : `${originHost}:${target.port}`;
    if (isolated) {
      for (const name of Object.keys(headers)) {
        if (!web.forwardHeaders.includes(name)) delete headers[name];
      }
      if(web.hostMode==='target')headers.host = target.host;
      if (web.rewriteOrigin && headers.origin) headers.origin = target.origin;
      headers['x-forwarded-prefix'] = prefix;
    }
    const admin = ['/admin', '/admin/', '/admin.js', '/admin.css', '/admin-mcp.js', '/admin-data.js', '/admin-mcp.css', '/platform.js', '/platform.css', '/platform-charts.js', '/vendor/chartjs-4.6.1.umd.min.js'].includes(pathname) || pathname === '/api/business/admin' || pathname.startsWith('/api/business/admin/') || pathname === '/api/business/account' || pathname.startsWith('/api/business/account/') || pathname.startsWith('/api/business/console/');
    if (credentials && !admin && /^Basic\s/i.test(headers.authorization || '')) delete headers.authorization;
    if (navigation) {
      headers['accept-encoding'] = 'identity';
      delete headers['if-none-match']; delete headers['if-modified-since'];
    }
    const destination = new URL(`${pathname}${search}`, target);
    await new Promise(resolve => {
      let stop = () => {};
      const outgoing = httpRequest(destination, { method: request.method, headers }, async incoming => {
        outgoing.setTimeout(0);
        const resultHeaders = cleanHeaders(incoming.headers, { credentials: true });
        delete resultHeaders['set-cookie'];
        if (isolated && resultHeaders['access-control-allow-origin']) {
          resultHeaders['access-control-allow-origin'] = canonical.origin;
        }
        if (credentials && incoming.headers['set-cookie']) resultHeaders['set-cookie'] = incoming.headers['set-cookie'];
        if (resultHeaders.location && !credentials) {
          const rewritten = locationHeader(resultHeaders.location, target, prefix, !share && !isolated);
          if (!rewritten) { incoming.destroy(); outgoing.destroy(); writeJson(response, 502, { code: 'INVALID_UPSTREAM' }); return resolve(); }
          resultHeaders.location = rewritten;
        }
        const isImage = /^image\//i.test(incoming.headers['content-type'] || '') || incoming.statusCode === 304 && /^private,/.test(incoming.headers['cache-control'] || '') && incoming.headers['x-praxis-image-cache'] === 'image';
        resultHeaders['cache-control'] = isImage && [200, 206, 304].includes(incoming.statusCode) ? 'private, no-cache, must-revalidate' : 'no-store';
        resultHeaders.vary = [...new Set((String(resultHeaders.vary || '') + ', Cookie').split(',').map(value => value.trim()).filter(Boolean))].join(', ');
        resultHeaders['referrer-policy'] = share ? 'no-referrer' : credentials ? incoming.headers['referrer-policy'] || 'same-origin' : 'same-origin';
        resultHeaders['x-content-type-options'] = 'nosniff';
        if (isolated && resultHeaders['content-disposition']) {
          // Workflow files can contain author-supplied HTML and SVG.
          resultHeaders['content-security-policy'] = "sandbox; default-src 'none'; img-src data:; style-src 'unsafe-inline'";
        }
        if (navigation && isNavigationHtml(incoming)) {
          try {
            const raw = await collectNavigationBody(incoming);
            const body = await injectSystemNavigation(raw, { headers: incoming.headers, canonicalOrigin: canonical.origin, ...navigation });
            const current = await access(request);
            if (!await permitted(current)) throw fail(403, 'FORBIDDEN');
            if (response.destroyed || response.headersSent) return resolve();
            response.writeHead(incoming.statusCode, navigationHeaders(resultHeaders, body)); response.end(body); resolve();
          } catch (error) {
            if (!response.destroyed && !response.headersSent) {
              if ([401, 403].includes(error.status)) denied(request, response, error);
              else {
                const text = '此页面暂时无法加载统一导航，请刷新重试。';
                response.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8', 'Content-Length': Buffer.byteLength(text), 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin' }); response.end(text);
              }
            } else if (!response.destroyed && !response.writableEnded) response.destroy();
            resolve();
          }
          return;
        }
        response.writeHead(incoming.statusCode, resultHeaders);
        incoming.pipe(response);
        incoming.once('error', () => response.destroy());
        incoming.once('end', resolve);
      });
      outgoing.once('error', () => { if (!response.headersSent) writeJson(response, 503, { code: 'UNAVAILABLE' }); else response.destroy(); resolve(); });
      outgoing.setTimeout(120000, () => outgoing.destroy());
      const destroy = () => { outgoing.destroy(); response.destroy(); };
      if (initial) stop = watch(request, response, initial, permitted, destroy);
      response.once('close', () => { stop(); if (!response.writableEnded) outgoing.destroy(); resolve(); });
      request.pipe(outgoing);
    });
  }
  async function handle(request, response) {
    try {
      const { pathname, search } = gatewayPath(request.url);
      if (pathname === '/health' && ['GET', 'HEAD'].includes(request.method) && !search) { writeJson(response, 200, { status: 'ok' }); return true; }
      if (request.headers.host !== canonical.host) throw fail(404, 'NOT_FOUND');
      if (installAssets.has(pathname)) {
        if (!['GET', 'HEAD'].includes(request.method)) throw fail(405, 'METHOD_NOT_ALLOWED');
        return false;
      }
      if (pathname.startsWith('/share/')) {
        const app=registry.apps.find(app=>app.integration.web.share&&pathname.startsWith(app.integration.web.share.prefix));
        if(!app)throw fail(404,'NOT_FOUND');
        const definition=app.integration.web.share;
        const instance=installationOptions;
        const file=instance[definition.configurationKey],sourceRoots=[registry.root,fileURLToPath(new URL('../',import.meta.url))].filter(Boolean).map(root=>resolve(root));
        if(typeof file!=='string'||!isAbsolute(file)||resolve(file)!==file||sourceRoots.some(root=>file===root||file.startsWith(root+'/')))throw fail(404,'NOT_FOUND');
        const scope=await definition.authorize({url:request.url,method:request.method,headers:{origin:request.headers.origin,upgrade:request.headers.upgrade}}, {file,clock,origin:canonical.origin});
        if(!relativeProxyPath(scope.pathname)||typeof scope.prefix!=='string'||!scope.prefix.startsWith(definition.prefix))throw fail(404,'NOT_FOUND');
        await proxy(request,response,{target:targets[app.id],id:app.id,...scope,share:true});return true;
      }
      if (coreRoute(pathname,registry)) {
        const navigation = navigationContext(request, pathname, undefined, { registry });
        let identity;
        if (navigation) {
          if (navigation.mode === 'admin' && request.headers.authorization) throw fail(401, 'UNAUTHENTICATED');
          try { identity = await access(request); }
          catch (error) {
            if (navigation.mode !== 'admin' || error.status !== 401) throw error;
            response.writeHead(303, { Location: `/auth/login?return_to=${encodeURIComponent(request.url)}`, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' }); response.end(); return true;
          }
        }
        if (navigation && !sameOrigin(request)) throw fail(403, 'FORBIDDEN');
        await proxy(request, response, { target: core, pathname, search, credentials: true, initial: identity && { ...identity, permissionsExpireAt: null }, permitted: () => true, navigation }); return true;
      }
      const route = appRoute(pathname, registry);
      if (pathname.startsWith('/apps/') && !route) throw fail(404, 'NOT_FOUND');
      const identity = await access(request);
      if (!sameOrigin(request, !safeMethods.has(request.method))) throw fail(403, 'FORBIDDEN');
      if (route) {
        if (!canOpenApp(identity, route.id, registry)) throw fail(403, 'FORBIDDEN');
        const web=registry.getWeb(route.id);
        if(web.readOnly&&!['GET','HEAD'].includes(request.method)||web.internalPaths?.some(path=>route.pathname===path||route.pathname.startsWith(path+'/')))throw fail(404,'NOT_FOUND');
        if (pathname === route.prefix) { response.writeHead(308, { Location: `${route.prefix}/${search}`, 'Cache-Control': 'no-store' }); response.end(); return true; }
        if (!targets[route.id]) {
          const serve = staticApps[route.id];
          if (!serve) throw fail(404, 'NOT_FOUND');
          const nav = navigationContext(request, route.pathname, route.id, { registry });
          const permitted = fresh => fresh.username === identity.username && canOpenApp(fresh, route.id, registry);
          const isPrivateRead = web.kind === 'private-documents' && route.pathname.startsWith('/api/');
          const stop = isPrivateRead && watch(request, response, identity, permitted, () => response.destroy());
          try {
            await serve(request, response, route.pathname, nav && { ...nav, canonicalOrigin: canonical.origin }, async () => {
              if (!permitted(await access(request))) throw fail(403, 'FORBIDDEN');
            });
          } finally {
            if (stop) stop();
          }
          return true;
        }
        const rule=web.route?web.route({method:request.method,pathname:route.pathname,search}):{binding:'native',checks:[]};
        if(rule.deny)throw fail(rule.deny,'NOT_FOUND');
        if(rule.pathname!==undefined){if(!relativeProxyPath(rule.pathname))throw fail(503,'UNAVAILABLE');route.pathname=rule.pathname;}
        const checks=rule.checks||[];
        for(const id of checks){const scope=await nativeAccess(request,route.id,id);identity.permissionsExpireAt=Math.min(identity.permissionsExpireAt??Infinity,scope.expiresAt);}
        const permitted=async next=>canOpenApp(next,route.id,registry)&&!(await Promise.all(checks.map(id=>nativeAccess(request,route.id,id)))).some(scope=>!scope.allowed);
        if(rule.binding==='core'){
          if(!web.corePrefixes?.some(prefix=>route.pathname.startsWith(prefix)))throw fail(503,'UNAVAILABLE');
          await proxy(request,response,{target:core,pathname:route.pathname,search,credentials:true,initial:identity,permitted});return true;
        }
        await proxy(request,response,{target:targets[route.id],...route,search,initial:identity,permitted,navigation:navigationContext(request,route.pathname,route.id,{registry})});return true;
      }
      const iconPath = /^\/app-icons\/[a-z][a-z0-9-]*\.svg$/.test(pathname) || /^\/[a-z][a-z0-9-]*-icon\.svg$/.test(pathname);
      if (iconPath) {
        const app = appIconEntry(await readAppCatalog(), pathname);
        if (!app) throw fail(404, 'NOT_FOUND');
        if (!canOpenApp(identity, app.id, registry)) throw fail(403, 'FORBIDDEN');
      }
      const prd = pathname === '/prds' || pathname.startsWith('/prds/');
      if (prd && !identity.prds || platformPaths.has(pathname) && !identity.canViewPlatform) throw fail(403, 'FORBIDDEN');
      const providerModule=/^\/app-providers\/([a-z][a-z0-9-]*)\.mjs$/.exec(pathname);
      if(providerModule&&!canOpenApp(identity,providerModule[1]))throw fail(403,'FORBIDDEN');
      if (!prd && !desktopPaths.has(pathname) && !platformPaths.has(pathname) && !providerModule && !iconPath) throw fail(404, 'NOT_FOUND');
      if (/^Basic\s/i.test(request.headers.authorization || '')) delete request.headers.authorization;
      request.webAccess = identity;
      return false;
    } catch (error) { denied(request, response, error); return true; }
  }
  async function upgrade(request, socket, head) {
    try {
      const { pathname, search } = gatewayPath(request.url), route = appRoute(pathname, registry);
      if (!route || request.headers.host !== canonical.host || request.headers.upgrade?.toLowerCase() !== 'websocket' || !sameOrigin(request, true)) throw fail(403, 'FORBIDDEN');
      const web=registry.getWeb(route.id);
      if(web.allowUpgrade===false||!targets[route.id])throw fail(403,'FORBIDDEN');
      const identity=await access(request);
      if(!canOpenApp(identity,route.id,registry))throw fail(403,'FORBIDDEN');
      const checks=web.upgradePolicies||[];
      for(const id of checks){const scope=await nativeAccess(request,route.id,id);identity.permissionsExpireAt=Math.min(identity.permissionsExpireAt??Infinity,scope.expiresAt);}
      const target = targets[route.id];
      const headers = cleanHeaders(request.headers, { upgrade: true });
      headers.host = `${originHost}:${target.port}`; headers.connection = 'Upgrade'; headers.upgrade = 'websocket';
      const outgoing = httpRequest(new URL(`${route.pathname}${search}`, target), { headers });
      let stop = () => {};
      const destroy = () => { outgoing.destroy(); socket.destroy(); };
      stop = watch(request, socket, identity, async next => canOpenApp(next, route.id, registry) &&
        !(await Promise.all(checks.map(id=>nativeAccess(request,route.id,id)))).some(scope=>!scope.allowed), destroy);
      outgoing.setTimeout(timeoutMs, destroy);
      outgoing.once('upgrade', (incoming, upstream, upstreamHead) => {
        outgoing.setTimeout(0); upstream.setTimeout(0);
        const responseHeaders = cleanHeaders(incoming.headers, { upgrade: true });
        delete responseHeaders['set-cookie'];
        socket.write(`HTTP/1.1 101 Switching Protocols\r\n${Object.entries(responseHeaders).map(([name, value]) => `${name}: ${value}\r\n`).join('')}\r\n`);
        if (head.length) upstream.write(head);
        if (upstreamHead.length) socket.write(upstreamHead);
        socket.pipe(upstream).pipe(socket);
        socket.once('close', () => { stop(); upstream.destroy(); }); upstream.once('close', () => { stop(); socket.destroy(); });
        upstream.once('error', destroy); socket.once('error', destroy);
      });
      outgoing.once('response', incoming => { incoming.resume(); stop(); socket.end('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\nCache-Control: no-store\r\n\r\n'); });
      outgoing.once('error', () => { stop(); socket.destroy(); }); outgoing.end();
    } catch (error) { socket.end(`HTTP/1.1 ${error.status || 403} Forbidden\r\nConnection: close\r\nCache-Control: no-store\r\n\r\n`); }
  }
  return { handle, upgrade, origin: canonical.origin, close() { for (const destroy of active) destroy(); active.clear(); } };
}

export function canonicalRedirect(request, response, canonicalUrl) {
  const canonical = canonicalOrigin(canonicalUrl);
  try {
    const { pathname, search } = gatewayPath(request.url);
    if (pathname === '/health' && ['GET', 'HEAD'].includes(request.method)) { writeJson(response, 200, { status: 'ok' }); return; }
    if (!['GET', 'HEAD'].includes(request.method)) return writeJson(response, 405, { code: 'METHOD_NOT_ALLOWED' }, { Allow: 'GET, HEAD' });
    response.writeHead(308, { Location: `${canonical.origin}${pathname}${search}`, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' }); response.end();
  } catch { writeJson(response, 404, { code: 'NOT_FOUND' }); }
}
