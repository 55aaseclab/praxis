import { DEFAULT_APP_REGISTRY } from './default-app-registry.mjs';
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
import { createWebGateway, canonicalRedirect, gatewayApps, canOpenApp, publicEntry, requestLocale, renderPlatformLocale } from './web-gateway.mjs';
import { createPublicMcpHandler } from './public-mcp.mjs';
import { injectSystemNavigation, navigationContext } from './system-navigation.mjs';
import { createPrivateDocumentHandler } from './private-documents.mjs';
import { createManagedStaticHandler } from './managed-static-app.mjs';
import { createPublicHomeHandler } from './public-home.mjs';

export const WORKSPACE_ROOT = fileURLToPath(new URL('../', import.meta.url));
const mimeTypes = { '.webmanifest': 'application/manifest+json; charset=utf-8', '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.avif': 'image/avif', '.ico': 'image/x-icon' };

function send(request, response, status, body, type = 'text/html; charset=utf-8', headers = {}) {
  const bytes = Buffer.from(body);
  response.writeHead(status, { 'Content-Type': type, 'Content-Length': bytes.length, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers });
  response.end(request.method === 'HEAD' ? undefined : bytes);
}

export function createPraxisServer({ root = WORKSPACE_ROOT, publicDir = resolve(root, 'public'), publicUrlsFile, businessUrl = process.env.PRAXIS_BUSINESS_URL, observationsFile = process.env.PRAXIS_OBSERVATIONS_FILE, observationsOrigin = process.env.PRAXIS_OBSERVATIONS_ORIGIN, consoleUpstream = process.env.PRAXIS_CONSOLE_UPSTREAM, consoleHost = process.env.PRAXIS_CONSOLE_HOST, consoleOrigin = process.env.PRAXIS_CONSOLE_ORIGIN, webGateway, canonicalUrl, demoApp, developmentApps = [], registry = DEFAULT_APP_REGISTRY } = {}) {
  const appProviders = new AppProviderRegistry({ root });
  const privateApps = Object.fromEntries(registry.apps.filter(app=>app.integration.web.kind==='private-documents').map(app=>{
    const web=app.integration.web,serve=createManagedStaticHandler(resolve(root,app.source,web.directory),web.assets||[]);
    const documents=createPrivateDocumentHandler(webGateway?.privateDocumentRoots?.[app.id]);
    return [app.id,(request,response,pathname,navigation,reauthorize)=>pathname.startsWith('/api/')?documents(request,response,pathname,reauthorize):serve(request,response,pathname,navigation,reauthorize)];
  }));
  const localStatic = Object.fromEntries(registry.apps.filter(app=>app.integration.web.kind==='static').map(app=>[app.id,{directory:resolve(root,app.source,app.integration.web.directory),assets:app.integration.web.assets||[]}]));
  const staticReaders=Object.fromEntries(Object.entries(localStatic).map(([id,app])=>[id,async(request,response,pathname,navigation,reauthorize)=>{
    const read=registry.getWeb(id).coreReads?.find(read=>read.path===pathname);
    if(read&&webGateway?.enabled){
      if(!['GET','HEAD'].includes(request.method))return send(request,response,405,'Method not allowed.','text/plain',{Allow:'GET, HEAD'});
      await reauthorize();
      const upstream=new URL(read.upstream,webGateway.coreUrl||'http://127.0.0.1:4326');
      const reply=await fetch(upstream,{method:'GET',headers:{host:new URL(webGateway.canonicalUrl).host,cookie:request.headers.cookie||'',Accept:'application/json'},redirect:'error',signal:AbortSignal.timeout(7000)});
      const chunks=[];let size=0;for await(const chunk of reply.body){size+=chunk.length;if(size>Math.min(read.maximumBytes||2*1024*1024,8*1024*1024))throw Error('App source exceeds its size limit.');chunks.push(chunk);}
      await reauthorize();return send(request,response,reply.status,Buffer.concat(chunks),'application/json; charset=utf-8',{Vary:'Cookie'});
    }
    return createManagedStaticHandler(app.directory,app.assets)(request,response,pathname,navigation,reauthorize);
  }]));
  async function localEntry(app) {
    const { id, kind, name, description, labels, icon, version } = app;
    const entry = { ...registry.publicFacts().find(fact => fact.id === id), id, kind, name, description, labels, icon, version, entry: publicEntry(registry,id), ...(app.launcher === false && { launcher: false }) };
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
    registry,
    readAppCatalog: () => readApps(root, { publicUrlsFile: null }),
    ...webGateway,
    staticApps: {
      ...privateApps,
      ...staticReaders,
    },
  }) : null;
  const publicHome = gateway ? createPublicHomeHandler({ canonicalUrl: webGateway.canonicalUrl, root }) : null;
  const publicGuide = webGateway?.enabled ? createPublicMcpHandler({ origin: webGateway.canonicalUrl }) : null;
  const observations = new ObservationStore({ file: observationsFile, registry });
  const browserIngress = createBrowserIngress({ store: observations, origin: observationsOrigin });
  const platformProxy = createPlatformProxy({ upstream: consoleUpstream, host: consoleHost, origin: consoleOrigin });
  const server = createServer(async (request, response) => {
    observeResponse(observations, request, response);
    try {
      if (canonicalUrl) return canonicalRedirect(request, response, canonicalUrl);
      if (publicHome && await publicHome(request, response)) return;
      if (gateway) response.setHeader('X-Robots-Tag', 'noindex, nofollow');
      if (publicGuide && await publicGuide(request, response)) return;
      if (gateway && await gateway.handle(request, response)) return;
      const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
      if (url.pathname.startsWith('/api/platform/')) return await platformProxy(request, response, url);
      if (url.pathname === '/api/observations') return await browserIngress(request, response);
      if (!['GET', 'HEAD'].includes(request.method)) return send(request, response, 405, 'Method not allowed.', 'text/plain; charset=utf-8', { Allow: 'GET, HEAD' });
      let path;
      try { path = decodeURIComponent(url.pathname); } catch { return send(request, response, 400, 'Invalid URL.', 'text/plain; charset=utf-8'); }
      const readerMatch = !gateway && /^\/apps\/([a-z][a-z0-9-]{0,79})(\/.*)$/.exec(path);
      const readerApp=readerMatch&&registry.webApps.find(app=>app.kind==='static'&&app.slug===readerMatch[1]);
      const reader=readerApp&&[readerMatch[0],readerApp.id,readerMatch[2]];
      if (reader) {
        const context = navigationContext(request, reader[2], reader[1], {registry});
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
      if (path === '/api/apps') {
        const apps = await readApps(root, { publicUrlsFile: gateway ? null : publicUrlsFile });
        const visibleApps = gateway ? gatewayApps(apps, request.webAccess, gateway.origin,registry) : [...await Promise.all(apps.filter(app => !app.adminOnly).map(localEntry)), ...developmentApps];
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
      const platformHtml = ['index.html', 'settings.html'].includes(file);
      if (platformHtml) content = renderPlatformLocale(content, requestLocale(request));
      return send(request, response, 200, content, type, platformHtml ? { ...headers, Vary: 'Cookie' } : headers || {});
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
