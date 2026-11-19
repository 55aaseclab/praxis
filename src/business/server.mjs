import { MEMO_RECORD_OPERATIONS } from './memo-schema.mjs';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { AuthStore, createAuthHandler, credentialFromRequest } from './auth.mjs';
import { BusinessBridge, businessError, OPERATIONS } from './bridge.mjs';
import { BusinessEvents } from './events.mjs';
import { handleMcp } from './mcp.mjs';
import { loadBusinessConfig } from './config.mjs';
import { PolicyGate } from './policy-gate.mjs';
import packageMetadata from '../../package.json' with { type: 'json' };
import { ObservationStore, observeResponse, recordObservation, classifyCapability, classifyOutcome } from '../observability.mjs';
import { createConsoleHandler, requireConsoleAdmin } from './console.mjs';
import { createAdminHandler, createAccountHandler, requireAccountSession } from './admin.mjs';
import { createMcpManagementHandler } from './mcp-management.mjs';
import { PUBLIC_GUIDANCE_MCP_PATH, PUBLIC_GUIDANCE_TOOLS } from '../public-mcp-registry.mjs';
import { createSlidesWebHandler } from './slides-web.mjs';
import { createSlidesJobAuthorizationHandler } from './slides-job-authorization.mjs';

const ADMIN_ASSETS = Object.freeze({ '/admin.js': ['admin.js', 'application/javascript'], '/admin.css': ['admin.css', 'text/css'], '/admin-mcp.js': ['admin-mcp.js', 'application/javascript'], '/admin-data.js': ['admin-data.js', 'application/javascript'], '/admin-mcp.css': ['admin-mcp.css', 'text/css'], '/platform.js': ['platform.js', 'application/javascript'], '/platform.css': ['platform.css', 'text/css'], '/platform-charts.js': ['platform-charts.js', 'application/javascript'], '/vendor/chartjs-4.6.1.umd.min.js': [new URL('../../node_modules/chart.js/dist/chart.umd.min.js', import.meta.url), 'application/javascript'] });
const APP_PAGES = Object.freeze({ '/business/reminder/': 'reminder.html', '/business/tingproof/': 'tingproof.html' });
const APP_ASSETS = Object.freeze({ '/i18n.js': ['i18n.js', 'application/javascript'], '/reminder.js': ['reminder.js', 'application/javascript'], '/tingproof.js': ['tingproof.js', 'application/javascript'], '/tingproof.css': ['tingproof.css', 'text/css'], '/app-transport.js': ['app-transport.js', 'application/javascript'], '/reminder-view.js': ['reminder-view.js', 'application/javascript'], '/reminder-view-model.js': ['reminder-view-model.js', 'application/javascript'], '/reminder-view.css': ['reminder-view.css', 'text/css'] });

export async function readJson(request, maximumBytes = 1024 * 1024) {
  let size = 0; const chunks = [];
  for await (const chunk of request) { size += chunk.length; if (size > maximumBytes) throw businessError(413, 'REQUEST_TOO_LARGE'); chunks.push(chunk); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw businessError(400, 'INVALID_JSON'); }
}
function json(response, status, result, headers = {}) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers }); response.end(JSON.stringify(result));
}
export function createBusinessServer({ config, auth = new AuthStore({ file: config.database, issuer: config.issuer }), events = new BusinessEvents(config.eventsDatabase), fetchImpl, consoleFetchImpl, pollMs = 1000, version = packageMetadata.version }) {
  const gate = new PolicyGate();
  const observations = new ObservationStore({ file: config.observationsFile });
  const bridge = new BusinessBridge({ auth, events, apps: config.apps, fetchImpl, gate, observeAdapter: value => recordObservation(observations, { event_name: 'adapter_request', route_id: 'business_invoke', method: 'POST', source: value.system ? 'system' : 'http', ...classifyCapability(value.appId, value.operation), ...classifyOutcome(value.status, value.code), duration_ms: value.durationMs }) });
  const handleAuth = createAuthHandler({ store: auth, issuer: config.issuer, webGateway: config.webGateway, apps: config.apps });
  const handleConsole = createConsoleHandler({ auth, config, events, observations, fetchImpl: consoleFetchImpl });
  const handleAdmin = createAdminHandler({ auth });
  const handleSlidesWeb = createSlidesWebHandler({ auth, bridge });
  const handleSlidesJobAuthorization = createSlidesJobAuthorizationHandler({ auth, config });
  const handleMcpManagement = createMcpManagementHandler({ auth, config, observations, guideRegistry: { path: PUBLIC_GUIDANCE_MCP_PATH, tools: PUBLIC_GUIDANCE_TOOLS }, guideEnabled: config.webGateway?.enabled === true });
  const handleAccount = createAccountHandler({ auth });
  const streams = new Set(), collectionErrors = new Set(), pendingRequests = new Set();
  let polling = false, quiescing = false, collected = false, closed = false, collectionWork = Promise.resolve();
  function collect() {
    if (quiescing || polling) return collectionWork;
    polling = true;
    collectionWork = (async () => {
      try {
        events.notePolicyVersion(auth.policyVersion); collectionErrors.delete('policy');
        for (const [appId, app] of Object.entries(config.apps)) for (const spaceId of app.spaces || []) {
          if (quiescing) return;
          const key = `${appId}:${spaceId}`;
          try { await bridge.harvest(appId, spaceId); collectionErrors.delete(key); } catch { collectionErrors.add(key); }
        }
        collected = true;
      } catch { collectionErrors.add('policy'); }
      finally { polling = false; }
    })();
    return collectionWork;
  }
  const poll = setInterval(() => collect(), pollMs); poll.unref();
  const handleRequest = async (request, response) => {
    const observed = observeResponse(observations, request, response, 'business');
    try {
      const url = new URL(request.url, config.issuer);
      const origin = request.headers.origin;
      if (request.headers.host !== new URL(config.issuer).host && !(config.allowedHosts || []).includes(request.headers.host)) throw businessError(403, 'HOST_REJECTED');
      if (await gate.run(() => handleAuth(request, response))) return;
      if (origin && origin !== config.issuer && !(config.allowedOrigins || []).includes(origin)) throw businessError(403, 'ORIGIN_REJECTED');
      if (await handleSlidesJobAuthorization(request, response)) return;
      if (await handleSlidesWeb(request, response)) return;
      if (await gate.run(() => handleAccount(request, response))) return;
      if (await gate.run(() => handleMcpManagement(request, response))) return;
      if (await gate.run(() => handleAdmin(request, response))) return;
      if (['/admin', '/admin/'].includes(url.pathname) || Object.hasOwn(ADMIN_ASSETS, url.pathname)) {
        const shared = ['/admin', '/admin/', '/admin.js', '/admin.css'].includes(url.pathname);
        const authorizePage = () => shared ? requireAccountSession(request, { auth }) : requireConsoleAdmin(request, { auth, config });
        try { authorizePage(); }
        catch (error) {
          if (error.status === 401 && !request.headers.authorization && ['/admin', '/admin/'].includes(url.pathname) && ['GET', 'HEAD'].includes(request.method)) {
            response.writeHead(303, { Location: '/auth/login?return_to=%2Fadmin%2F', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' }); response.end(); return;
          }
          throw error;
        }
        if (!['GET', 'HEAD'].includes(request.method)) return json(response, 405, { code: 'METHOD_NOT_ALLOWED' }, { Allow: 'GET, HEAD' });
        const asset = ADMIN_ASSETS[url.pathname] || ['admin.html', 'text/html'];
        const content = await readFile(asset[0] instanceof URL ? asset[0] : new URL(`../../public/${asset[0]}`, import.meta.url));
        authorizePage();
        response.writeHead(200, { 'Content-Type': `${asset[1]}; charset=utf-8`, 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'", 'X-Frame-Options': 'DENY', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin', Vary: 'Cookie' });
        response.end(request.method === 'HEAD' ? undefined : content); return;
      }
      if (await handleConsole(request, response)) return;
      if (url.pathname === '/health' && request.method === 'GET') return json(response, collectionErrors.size ? 503 : 200, { status: collectionErrors.size ? 'degraded' : 'ok', version });
      if (['/', '/business', '/business/', '/business.html'].includes(url.pathname)) {
        if (!['GET', 'HEAD'].includes(request.method)) return json(response, 405, { code: 'METHOD_NOT_ALLOWED' }, { Allow: 'GET, HEAD' });
        response.writeHead(303, { Location: config.webGateway?.enabled === true ? `${config.issuer}/` : '/business/reminder/', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin' }); response.end(); return;
      }
      if (Object.hasOwn(APP_PAGES, url.pathname)) {
        if (!['GET', 'HEAD'].includes(request.method)) return json(response, 405, { code: 'METHOD_NOT_ALLOWED' }, { Allow: 'GET, HEAD' });
        const content = await readFile(new URL(`../../public/${APP_PAGES[url.pathname]}`, import.meta.url));
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'self'; base-uri 'none'; form-action 'self'", 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin' });
        return response.end(request.method === 'HEAD' ? undefined : content);
      }
      const asset = Object.hasOwn(APP_ASSETS, url.pathname) && APP_ASSETS[url.pathname];
      if (asset && ['GET', 'HEAD'].includes(request.method)) { const content = await readFile(new URL(`../../public/${asset[0]}`, import.meta.url)); response.writeHead(200, { 'Content-Type': `${asset[1]}; charset=utf-8`, 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' }); return response.end(request.method === 'HEAD' ? undefined : content); }
      if (url.pathname === '/mcp') {
        if (request.method !== 'POST') return json(response, 405, { code: 'METHOD_NOT_ALLOWED' }, { Allow: 'POST' });
        const token = credentialFromRequest(request);
        auth.authenticate(token);
        if (!request.headers.authorization) throw businessError(401, 'BEARER_REQUIRED');
        return await handleMcp(request, response, { bridge, token, version, body: await readJson(request, 3 * 1024 * 1024), observations });
      }
      if (['/api/business/workbench/projects', '/api/business/workbench/agenda', '/api/business/workbench/attention'].includes(url.pathname)) {
        if (request.method !== 'GET') return json(response, 405, { code: 'METHOD_NOT_ALLOWED' }, { Allow: 'GET' });
        if (url.search) throw businessError(400, 'INVALID_REQUEST');
        requireAccountSession(request, { auth });
        const token = credentialFromRequest(request);
        const source = url.pathname.split('/').at(-1);
        const reads = { projects: 'workbenchProjects', agenda: 'workbenchAgenda', attention: 'workbenchAttention' };
        const data = await bridge[reads[source]](token);
        return json(response, 200, data, { Vary: 'Cookie' });
      }
      if (url.pathname === '/api/business/catalog' && request.method === 'GET') return json(response, 200, { spaces: bridge.catalog(credentialFromRequest(request)) });
      if (['/api/business/invoke', '/api/business/memo-records'].includes(url.pathname) && request.method === 'POST') {
        const started = performance.now(); let invocation, actorKnown = false;
        const record = outcome => recordObservation(observations, { event_name: 'business_action', route_id: 'business_invoke', method: 'POST', source: 'http', ...classifyCapability(invocation?.appId, invocation?.operation), ...outcome, duration_ms: Math.max(0, Math.round(performance.now() - started)) });
        try {
          auth.requireRequestCsrf(request);
          const token = credentialFromRequest(request);
          try { auth.authenticate(token); actorKnown = true; } catch {}
          invocation = await readJson(request, (url.pathname === '/api/business/memo-records' ? 10 : 3) * 1024 * 1024);
          if (url.pathname === '/api/business/memo-records' && (invocation?.appId !== 'memo' || invocation?.resourceId !== 'records' || !MEMO_RECORD_OPERATIONS.includes(invocation?.operation))) throw businessError(400, 'INVALID_REQUEST');
          const result = await bridge.invoke(token, invocation);
          record(classifyOutcome(200)); return json(response, 200, result);
        } catch (error) {
          const unknown = typeof invocation?.appId === 'string' && typeof invocation?.operation === 'string' && (!Object.hasOwn(OPERATIONS, invocation.appId) || !Object.hasOwn(OPERATIONS[invocation.appId], invocation.operation));
          record(actorKnown && unknown && error.code === 'INVALID_REQUEST' ? { result: 'unsupported', reason_code: 'UNKNOWN_OPERATION' } : classifyOutcome(error.status || 500, error.code));
          throw error;
        }
      }
      if (url.pathname === '/api/business/events' && request.method === 'GET') {
        const token = credentialFromRequest(request), spaceId = url.searchParams.get('spaceId'), appId = url.searchParams.get('appId');
        const scope = () => auth.authorize(token, { appId, spaceId, action: 'read' }); scope();
        const rawCursor = request.headers['last-event-id'] || url.searchParams.get('after');
        let cursor = rawCursor === null ? events.cursor() : Number(rawCursor);
        if (!Number.isSafeInteger(cursor) || cursor < 0) throw businessError(400, 'INVALID_CURSOR');
        response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no', 'X-Content-Type-Options': 'nosniff' });
        response.write(`event: ready\ndata: ${JSON.stringify({ cursor })}\n\n`);
        observed.openStream();
        if (cursor > events.cursor()) { cursor = events.cursor(); response.write(`event: reset\ndata: ${JSON.stringify({ cursor })}\n\n`); }
        let busy = false;
        const timer = setInterval(async () => {
          if (busy || response.destroyed) return; busy = true;
          try {
            const current = scope();
            if (collectionErrors.has(`${appId}:${spaceId}`)) response.write('event: unavailable\ndata: {}\n\n');
            for (const event of events.changes(cursor)) {
              cursor = event.cursor;
              if (event.appId !== appId || event.spaceId !== spaceId) continue;
              if (event.operation === 'reset') { response.write(`id: ${event.cursor}\nevent: reset\ndata: ${JSON.stringify({ cursor: event.cursor })}\n\n`); continue; }
              if (!(current.resources.includes('*') || current.resources.includes(event.resourceId))) continue;
              response.write(`id: ${event.cursor}\nevent: change\ndata: ${JSON.stringify(event)}\n\n`);
            }
            response.write(': keepalive\n\n');
          } catch { response.write('event: revoked\ndata: {}\n\n'); response.end(); }
          finally { busy = false; }
        }, pollMs);
        const close = () => { clearInterval(timer); streams.delete(response); }; streams.add(response); response.on('close', close);
        return;
      }
      return json(response, 404, { code: 'NOT_FOUND' });
    } catch (error) {
      if (response.headersSent) return response.end();
      const status = Number.isInteger(error.status) && error.status >= 400 && error.status <= 599 ? error.status : 500;
      const headers = status === 401 ? { 'WWW-Authenticate': `Bearer resource_metadata="${config.issuer}/.well-known/oauth-protected-resource/mcp"` } : {};
      return json(response, status, { code: error.code || 'REQUEST_FAILED', ...(error.committed ? { committed: true, requestId: error.requestId } : {}) }, headers);
    }
  };
  const server = createServer((request, response) => {
    if (quiescing) return json(response, 503, { code: 'SERVICE_DRAINING' }, { 'Retry-After': '1' });
    const work = handleRequest(request, response);
    pendingRequests.add(work);
    work.then(() => pendingRequests.delete(work), () => pendingRequests.delete(work));
  });
  async function quiesce() {
    quiescing = true; clearInterval(poll);
    for (const response of streams) response.end();
    await Promise.allSettled([collectionWork, ...pendingRequests]);
    for (const response of streams) response.end();
  }
  async function shutdown() {
    await quiesce();
    if (!closed) { closed = true; observations.close(); }
  }
  const status = () => ({ healthy: collected && !collectionErrors.size && !quiescing, quiescing, collecting: polling, inflight: pendingRequests.size, collectionErrors: collectionErrors.size });
  server.core = { auth, events, bridge, collect, observations, status, quiesce, shutdown };
  server.business = server.core;
  server.on('close', () => { shutdown().catch(() => {}); });
  return server;
}

export const createCoreServer = createBusinessServer;

export async function startCoreServer(argv = process.argv.slice(2)) {
  const { values } = parseArgs({ args: argv, options: { config: { type: 'string' }, host: { type: 'string', default: '127.0.0.1' }, port: { type: 'string', default: '4326' } } });
  const config = await loadBusinessConfig(values.config);
  const server = createCoreServer({ config });
  server.listen(Number(values.port), values.host, () => console.log(`Praxis core service listening on port ${values.port}`));
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { server.close(); server.closeAllConnections(); });
  return server;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) await startCoreServer();
