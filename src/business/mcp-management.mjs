import { BUSINESS_TOOLS, MCP_CONTROL_TOOLS } from './mcp.mjs';
import { requireConsoleAdmin } from './console.mjs';

export const MCP_MANAGEMENT_PATH = '/api/business/admin/mcp';
const MAX_BYTES = 128 * 1024, WINDOW_MS = 7 * 86400000;
const APP_NAMES = Object.freeze({ memo: 'Memo', reminder: 'Reminder', tingproof: '听校', travel: 'Travel', projects: 'Projects', knowledge: 'Knowledge', slides: 'Lattice' });
const iso = value => new Date(value).toISOString();

function activity(observations, appId, now) {
  try {
    if (observations?.state !== 'ready' || !observations.db) return { activity: 'unknown', lastObservedAt: null };
    const row = observations.db.prepare("SELECT MAX(occurred_at) AS at FROM observations WHERE event_name='business_action' AND source='mcp' AND route_id='mcp' AND app_id=? AND result='ok' AND occurred_at>=? AND occurred_at<=?").get(appId, now - WINDOW_MS, now);
    if (row.at === null) return { activity: 'not_observed', lastObservedAt: null };
    if (!Number.isSafeInteger(row.at) || row.at < now - WINDOW_MS || row.at > now) throw new Error('Invalid observation timestamp.');
    return { activity: 'observed', lastObservedAt: iso(row.at) };
  } catch { return { activity: 'unknown', lastObservedAt: null }; }
}

function businessTool(tool) {
  return {
    name: tool.name, description: tool.description, appId: tool.appId, operation: tool.operation,
    action: tool.action, readOnly: tool.readOnly ?? tool.action === 'read', destructive: tool.operation === 'delete' || tool.operation === 'archive_deck',
    openWorld: tool.openWorld === true, inputFields: Object.keys(tool.schema.shape),
  };
}

function guideTool(tool) {
  return { name: tool.name, description: tool.description, action: 'read', readOnly: true, destructive: false, openWorld: false, inputFields: Object.keys(tool.schema.shape) };
}

export async function readMcpManagement({ config, observations, guideRegistry, guideEnabled = false, clock = Date.now }) {
  const now = clock();
  const tools = [...MCP_CONTROL_TOOLS, ...BUSINESS_TOOLS].map(businessTool);
  const apps = [...new Set(BUSINESS_TOOLS.map(tool => tool.appId))].map(appId => {
    const app = Object.hasOwn(config.apps || {}, appId) ? config.apps[appId] : undefined;
    return {
      appId, name: APP_NAMES[appId], adapter: app ? 'configured' : 'not_configured',
      mode: app?.managed === true ? 'managed' : app?.managed === false ? 'standalone' : 'unknown',
      toolCount: tools.filter(tool => tool.appId === appId).length,
      ...activity(observations, appId, now),
    };
  });
  const endpoints = [{
    id: 'business', path: '/mcp', url: `${config.issuer}/mcp`, registration: 'registered',
    transport: 'streamable-http', authentication: 'oauth2-bearer', discovery: 'authorized-subset',
    toolCount: tools.length, tools, apps,
  }];
  if (guideRegistry) {
    const guideTools = guideRegistry.tools.map(guideTool);
    endpoints.push({
      id: 'guide', path: guideRegistry.path, url: `${config.issuer}${guideRegistry.path}`,
      registration: guideEnabled ? 'registered' : 'not_registered', transport: 'streamable-http',
      authentication: 'none', discovery: 'fixed-public', toolCount: guideTools.length, tools: guideTools, apps: [],
    });
  }
  return { schemaVersion: 1, generatedAt: iso(now), observationWindowDays: 7, endpoints };
}

function reply(response, status, value, headers = {}) {
  let body = JSON.stringify(value);
  if (Buffer.byteLength(body) > MAX_BYTES) { status = 503; body = '{"code":"MCP_MANAGEMENT_UNAVAILABLE"}'; }
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'same-origin', Vary: 'Cookie, Origin', ...headers,
  });
  response.end(body);
}

export function createMcpManagementHandler({ auth, config, observations, guideRegistry, guideEnabled = false, clock = Date.now }) {
  return async (request, response) => {
    const url = new URL(request.url, config.issuer);
    if (url.pathname !== MCP_MANAGEMENT_PATH) return false;
    try {
      requireConsoleAdmin(request, { auth, config });
      if (request.method !== 'GET') { reply(response, 405, { code: 'METHOD_NOT_ALLOWED' }, { Allow: 'GET' }); return true; }
      if (request.url !== MCP_MANAGEMENT_PATH || url.search) { reply(response, 400, { code: 'INVALID_REQUEST' }); return true; }
      const value = await readMcpManagement({ config, observations, guideRegistry, guideEnabled, clock });
      requireConsoleAdmin(request, { auth, config });
      reply(response, 200, value);
    } catch (error) {
      if (error.status === 401) reply(response, 401, { code: 'UNAUTHENTICATED', loginUrl: `${config.issuer}/auth/login?return_to=%2Fadmin%2F` });
      else if (error.status === 403) reply(response, 403, { code: 'MCP_MANAGEMENT_FORBIDDEN' });
      else reply(response, 503, { code: 'MCP_MANAGEMENT_UNAVAILABLE' });
    }
    return true;
  };
}
