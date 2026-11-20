import { createHash } from 'node:crypto';
import { AppProviderRegistry } from './business/app-providers.mjs';
import { createServer } from 'node:http';
import { readFile, realpath, stat } from 'node:fs/promises';
import { resolve, relative, sep, extname } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { imageCacheHeaders, imageNotModified } from './image-cache.mjs';
import { readApps, resolveAppIcon } from './apps.mjs';
import { listPrds, loadPrd } from './prd-catalog.mjs';
import { renderPrdMarkdown } from './prd-renderer.mjs';
import { catalogPage, documentPage } from './pages.mjs';
import { ObservationStore, createBrowserIngress, observeResponse } from './observability.mjs';
import { createPlatformProxy } from './platform-proxy.mjs';
import { createWebGateway, canonicalRedirect, gatewayApps, canOpenApp } from './web-gateway.mjs';
import { createPublicMcpHandler } from './public-mcp.mjs';
import { injectSystemNavigation, navigationContext } from './system-navigation.mjs';
import { createPrivateDocumentHandler } from './private-documents.mjs';
import { createManagedStaticHandler } from './managed-static-app.mjs';
import { createPublicProjectHandler } from './public-project.mjs';

export const WORKSPACE_ROOT = fileURLToPath(new URL('../', import.meta.url));
const mimeTypes = { '.webmanifest': 'application/manifest+json; charset=utf-8', '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.avif': 'image/avif', '.ico': 'image/x-icon' };

function send(request, response, status, body, type = 'text/html; charset=utf-8', headers = {}) {
  const bytes = Buffer.from(body);
  response.writeHead(status, { 'Content-Type': type, 'Content-Length': bytes.length, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers });
  response.end(request.method === 'HEAD' ? undefined : bytes);
}

export function createPraxisServer({ root = WORKSPACE_ROOT, publicDir = resolve(root, 'public'), publicUrlsFile, businessUrl = process.env.PRAXIS_BUSINESS_URL, observationsFile = process.env.PRAXIS_OBSERVATIONS_FILE, observationsOrigin = process.env.PRAXIS_OBSERVATIONS_ORIGIN, consoleUpstream = process.env.PRAXIS_CONSOLE_UPSTREAM, consoleHost = process.env.PRAXIS_CONSOLE_HOST, consoleOrigin = process.env.PRAXIS_CONSOLE_ORIGIN, webGateway, canonicalUrl, demoApp, developmentApps = [] } = {}) {
  const appProviders = new AppProviderRegistry({ root });
  const privateApps = Object.fromEntries(['letters', 'profiles'].map(id => {
    const serve = createManagedStaticHandler(resolve(root, 'third_party', id, 'public'), ['/app.css', '/app.js']);
    const documents = createPrivateDocumentHandler(webGateway?.privateDocumentRoots?.[id]);
    return [id, (request, response, pathname, navigation, reauthorize) => pathname.startsWith('/api/')
      ? documents(request, response, pathname, reauthorize)
      : serve(request, response, pathname, navigation, reauthorize)];
  }));
  const localStatic = {
    calendar: { directory: resolve(root, 'third_party/calendar/public'), assets: ['/calendar.js', '/calendar.css', '/calendar-events.js'] },
    'matrix-reader': { directory: resolve(root, 'third_party/matrix-reader/dist'), assets: [] },
  };
  const staticReaders = Object.fromEntries(Object.entries(localStatic).map(([id, app]) =>
    [id, async (request,response,pathname,navigation,reauthorize) => {
      if(id==='calendar'&&pathname==='/api/agenda'&&webGateway?.enabled){
        if(!['GET','HEAD'].includes(request.method))return send(request,response,405,'Method not allowed.','text/plain',{Allow:'GET, HEAD'});
        await reauthorize();
        const upstream=new URL('/api/business/workbench/agenda',webGateway.coreUrl||'http://127.0.0.1:4326');
        const reply=await fetch(upstream,{method:'GET',headers:{host:new URL(webGateway.canonicalUrl).host,cookie:request.headers.cookie||'',Accept:'application/json'},redirect:'error',signal:AbortSignal.timeout(7000)});
        const bytes=await reply.arrayBuffer();if(bytes.byteLength>2*1024*1024)throw new Error('Calendar source too large.');
        await reauthorize();
        return send(request,response,reply.status,Buffer.from(bytes),'application/json; charset=utf-8',{Vary:'Cookie'});
      }
      return createManagedStaticHandler(app.directory,app.assets)(request,response,pathname,navigation,reauthorize);
    }]));
  async function localEntry(app) {
    const { id, kind, name, description, labels, icon, version } = app;
    const entry = { id, kind, name, description, labels, icon, version, ...(app.launcher === false && { launcher: false }) };
    if (app.url) return { ...entry, url: app.url };
    if (!app.builtin) return { ...entry, path: app.path, ...(app.port !== undefined && { port: app.port }) };
    if (!app.adminOnly && demoApp?.id === app.id) return { ...entry, launcher: true, url: `http://127.0.0.1:${demoApp.port}/` };
    if (Object.hasOwn(localStatic, id)) {
      const index = await stat(resolve(localStatic[id].directory, 'index.html')).catch(() => null);
      if (index?.isFile() && index.size) return { ...entry, path: `/apps/${id}/` };
      return { ...entry, unavailable: 'install' };
    }
    return { ...entry, unavailable: 'managed' };
  }
  const gateway = webGateway?.enabled ? createWebGateway({
    readAppCatalog: () => readApps(root, { publicUrlsFile: null }),
    ...webGateway,
    staticApps: {
      ...privateApps,
      ...staticReaders,
    },
  }) : null;
  const projectInfo = gateway && createPublicProjectHandler(gateway.origin);
  const publicGuide = webGateway?.enabled ? createPublicMcpHandler({ origin: webGateway.canonicalUrl }) : null;
  const observations = new ObservationStore({ file: observationsFile });
  const browserIngress = createBrowserIngress({ store: observations, origin: observationsOrigin });
  const platformProxy = createPlatformProxy({ upstream: consoleUpstream, host: consoleHost, origin: consoleOrigin });
  const server = createServer(async (request, response) => {
    observeResponse(observations, request, response);
    try {
      if (canonicalUrl) return canonicalRedirect(request, response, canonicalUrl);
      if (projectInfo?.(request, response)) return;
      if (gateway) response.setHeader('X-Robots-Tag', 'noindex, nofollow');
      if (publicGuide && await publicGuide(request, response)) return;
      if (gateway && await gateway.handle(request, response)) return;
      const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
      if (!gateway && ['/about/', '/about/zh-cn/', '/sitemap.xml', '/robots.txt'].includes(url.pathname)) {
        const overview = createPublicProjectHandler(url.origin);
        if (overview(request, response)) return;
      }
      if (url.pathname.startsWith('/api/platform/')) return await platformProxy(request, response, url);
      if (url.pathname === '/api/observations') return await browserIngress(request, response);
      if (!['GET', 'HEAD'].includes(request.method)) return send(request, response, 405, 'Method not allowed.', 'text/plain; charset=utf-8', { Allow: 'GET, HEAD' });
      let path;
      try { path = decodeURIComponent(url.pathname); } catch { return send(request, response, 400, 'Invalid URL.', 'text/plain; charset=utf-8'); }
      const reader = !gateway && /^\/apps\/(calendar|matrix-reader)(\/.*)$/.exec(path);
      if (reader) {
        const context = navigationContext(request, reader[2], reader[1]);
        return await staticReaders[reader[1]](request, response, reader[2], context && { ...context, canonicalOrigin: url.origin }, async () => {});
      }
      if (path.includes('\0') || path.includes('\\') || path.split('/').some(part => part.startsWith('.'))) return send(request, response, 404, 'Not found.', 'text/plain; charset=utf-8');
      if (path === '/health') return send(request, response, 200, '{"status":"ok"}', 'application/json');
      if (/^\/app-icons\/[a-z][a-z0-9-]*\.svg$/.test(path) || /^\/[a-z][a-z0-9-]*-icon\.svg$/.test(path)) {
        const apps = [...await readApps(root, { publicUrlsFile: null }), ...developmentApps];
        const icon = await resolveAppIcon(root, path, { apps });
        if (!icon || !gateway && icon.app.adminOnly) return send(request, response, 404, 'Not found.', 'text/plain; charset=utf-8');
        const headers = imageCacheHeaders('image/svg+xml', icon.info);
        headers['Content-Security-Policy'] = "default-src 'none'; style-src 'unsafe-inline'; sandbox";
        headers['Referrer-Policy'] = 'no-referrer';
        if (gateway) { headers['Cache-Control'] = 'private, no-cache, must-revalidate'; headers.Vary = 'Cookie'; }
        if (imageNotModified(request, headers)) { response.writeHead(304, { ...headers, 'X-Content-Type-Options': 'nosniff' }); return response.end(); }
        return send(request, response, 200, icon.content, 'image/svg+xml', headers);
      }
      if (path === '/api/workbench/providers' || /^\/app-providers\/[a-z][a-z0-9-]*\.mjs$/.test(path)) {
        if(!['GET','HEAD'].includes(request.method))return send(request,response,405,'Method not allowed.','text/plain',{Allow:'GET, HEAD'});
        const available=(await appProviders.providers()).filter(value=>!value.error&&value.descriptor.cards.supported&&value.descriptor.cards.execution==='browser'&&(gateway?canOpenApp(request.webAccess,value.app.id):!value.app.adminOnly));
        if(path==='/api/workbench/providers'){
          const providers=await Promise.all(available.map(async value=>{
            const bytes=await readFile(resolve(root,value.app.source,'praxis-provider.mjs'));
            const version=createHash('sha256').update(bytes).digest('hex').slice(0,20);
            return{appId:value.app.id,moduleUrl:`/app-providers/${value.app.id}.mjs?v=${version}`,dataExecution:'server'};
          }));
          return send(request,response,200,JSON.stringify({schemaVersion:1,providers}),'application/json; charset=utf-8',{Vary:'Cookie'});
        }
        const appId=path.slice('/app-providers/'.length,-4),provider=available.find(value=>value.app.id===appId);
        if(!provider)return send(request,response,404,'Not found.','text/plain');
        return send(request,response,200,await readFile(resolve(root,provider.app.source,'praxis-provider.mjs')),'application/javascript; charset=utf-8',{Vary:'Cookie'});
      }
      if (path === '/api/apps') {
        const apps = await readApps(root, { publicUrlsFile: gateway ? null : publicUrlsFile });
        const visibleApps = gateway ? gatewayApps(apps, request.webAccess, gateway.origin) : [...await Promise.all(apps.filter(app => !app.adminOnly).map(localEntry)), ...developmentApps];
        return send(request, response, 200, JSON.stringify({ apps: visibleApps }), 'application/json; charset=utf-8');
      }
      if (path === '/business' || path === '/business/') {
        const destination = businessUrl ? new URL(businessUrl) : new URL('/business/', url.origin);
        if (!businessUrl) destination.port = '4326';
        if (!['http:', 'https:'].includes(destination.protocol) || destination.username || destination.password || destination.search || destination.hash) throw new Error('Invalid business entry URL.');
        return send(request, response, 302, '', 'text/plain', { Location: destination.href });
      }
      if (path === '/prds') return send(request, response, 302, '', 'text/plain', { Location: '/prds/' });
      if (path.startsWith('/prds/')) {
        const navigation = gateway && navigationContext(request, path);
        const choice = url.searchParams.get('lang');
        const locale = choice === 'en' || choice === 'zh' ? choice
          : /(?:^|;\s*)praxis_locale=zh(?:;|$)/.test(request.headers.cookie || '') ? 'zh' : 'en';
        const options = { systemNavigation: Boolean(navigation), locale };
        const sendPrd = async (status, html) => send(request, response, status, navigation ? await injectSystemNavigation(Buffer.from(html), { headers: { 'content-type': 'text/html; charset=utf-8' }, canonicalOrigin: gateway.origin, ...navigation }) : html);
        if (path === '/prds/') return await sendPrd(200, catalogPage(await listPrds({ root, locale }), options));
        const match = path.match(/^\/prds\/([a-z\d-]+)\/$/);
        const document = match && await loadPrd(match[1], { root, locale });
        if (!document) return await sendPrd(404, documentPage({ title: locale === 'zh' ? '文档不存在' : 'Document not found', status: 'missing' }, null, await listPrds({ root, locale }), options));
        let rendered;
        if (document.status === 'ready') {
          try { rendered = await renderPrdMarkdown(document, { root }); } catch { /* Render errors affect only this document. */ }
        }
        return await sendPrd(200, documentPage(document, rendered, await listPrds({ root, locale }), options));
      }
      const localSettings = !gateway && ['/admin', '/admin/'].includes(path);
      const file = localSettings ? 'settings.html' : path === '/' ? 'index.html' : path.slice(1);
      const allowedRoot = await realpath(publicDir);
      let actual;
      try { actual = await realpath(resolve(allowedRoot, file)); } catch { return send(request, response, 404, 'Not found.', 'text/plain; charset=utf-8'); }
      const within = relative(allowedRoot, actual);
      if (within.startsWith(`..${sep}`) || within === '..' || within.startsWith(sep) || !(await stat(actual)).isFile()) return send(request, response, 404, 'Not found.', 'text/plain; charset=utf-8');
      const info = await stat(actual);
      const type = mimeTypes[extname(actual).toLowerCase()] || 'application/octet-stream';
      const headers = imageCacheHeaders(type, info);
      if (gateway && headers) { headers['Cache-Control'] = 'private, no-cache, must-revalidate'; headers.Vary = 'Cookie'; }
      if (imageNotModified(request, headers)) {
        response.writeHead(304, { ...headers, 'X-Content-Type-Options': 'nosniff' });
        return response.end();
      }
      let content = await readFile(actual);
      if (file === 'index.html' && !gateway) content = content.toString().replace('data-website-auth="managed"', 'data-website-auth="unmanaged"').replace(/<div id="account"[^>]*><\/div>/, '').replace('data-private-nav data-admin-nav hidden', 'data-private-nav data-admin-nav').replace('data-private-nav data-prd-nav hidden', 'data-private-nav data-prd-nav');
      return send(request, response, 200, content, type, headers || {});
    } catch (error) {
      console.error('Praxis request failed.');
      if (!response.headersSent) send(request, response, 500, 'Request failed.', 'text/plain; charset=utf-8');
      else response.end();
    }
  });
  server.observations = observations;
  const close = server.close.bind(server);
  server.close = (...args) => { publicGuide?.close(); gateway?.close(); return close(...args); };
  server.on('upgrade', (request, socket, head) => {
    if (gateway) gateway.upgrade(request, socket, head).catch(() => socket.destroy());
    else socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
  });
  server.on('close', () => { publicGuide?.close(); gateway?.close(); observations.close(); });
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { values } = parseArgs({ options: { host: { type: 'string', default: '127.0.0.1' }, port: { type: 'string', default: '4321' } } });
  const port = Number(values.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Port must be between 1 and 65535.');
  const server = createPraxisServer({ canonicalUrl: process.env.PRAXIS_CANONICAL_URL });
  server.on('error', error => { console.error(`Praxis failed to start: ${error.message}`); process.exitCode = 1; });
  server.listen(port, values.host, () => console.log(`Praxis listening on http://${values.host}:${port}`));
}
