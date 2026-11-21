import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { toJsonSchemaCompat } from '@modelcontextprotocol/sdk/server/zod-json-schema-compat.js';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { classifyCapability, classifyOutcome, classifyTool, recordObservation } from '../observability.mjs';
import { assertMcpSkillCoverage, skillForTool, skillsForTools, registerMcpSkills } from './mcp-skills.mjs';
import { businessError } from './bridge.mjs';
import { DEFAULT_APP_REGISTRY } from '../default-app-registry.mjs';

export const BUSINESS_TOOLS = DEFAULT_APP_REGISTRY.tools;

export const MCP_CONTROL_TOOLS = [{
  name: 'praxis_refresh_capabilities', operation: 'refresh_capabilities', action: 'read',
  description: 'Refresh this authenticated Praxis connection\'s current capability contract: server version, instructions and authorized tool schemas. Takes no arguments, reads no business records and grants no new permissions. This does not reconnect the client transport or install tools in its harness; use native client discovery or reconnection if its cached tool inventory needs updating.',
  schema: z.object({}).strict(),
}];

assertMcpSkillCoverage([...MCP_CONTROL_TOOLS, ...BUSINESS_TOOLS]);

function toolAnnotations(tool) {
  return { readOnlyHint: tool.readOnly ?? tool.action === 'read', destructiveHint: ['delete', 'archive_deck', 'archive_guide'].includes(tool.operation), idempotentHint: true, openWorldHint: tool.openWorld === true };
}

function currentCapabilities(bridge, token, version) {
  bridge.auth.authenticate(token);
  const catalog = bridge.catalog(token);
  const spaces = catalog.map(({ id, apps }) => ({ spaceId: id, apps }));
  const availableTools = [...MCP_CONTROL_TOOLS, ...bridge.registry.tools.filter(tool => catalog.some(space => space.apps.some(app => app.id === tool.appId && app.actions.includes(tool.action) && (!tool.sourceRead || app.actions.includes('read')) && (tool.requiredActions || []).every(action => app.actions.includes(action)))))];
  const instructions = [
    'Praxis is a business-data service for external agents, not an agent harness. This contract is delivered by MCP negotiation and does not depend on your startup command or local configuration.',
    `Authorized tools: ${availableTools.map(tool => tool.name).join(', ')}`,
    `Current authorized spaces and app actions: ${JSON.stringify(spaces)}`,
    'OAuth code-exchange and refresh responses include space_id for designated consent. Pass that value as the tool argument spaceId. Some client SDKs hide token extensions; use the current authorized spaces above or praxis_refresh_capabilities.spaces to obtain spaceId instead. Never guess an ID or use a space outside this connection. If a legacy grant allows several spaces and the intended space is unclear, ask the user rather than choosing the first. Refresh after permissions change; every operation still checks current space, resource and action permissions.',
    'When this service changes or you need to verify its current capabilities, call praxis_refresh_capabilities with {}. Follow the returned instructions and schemas. Capability refresh does not reconnect your client transport or automatically update its tool cache; do not claim that it does.',
    'Every MCP tool has a companion skill in its metadata. Read the matching skill before using the tool: resources/list and resources/read expose authorized skills; tool-only clients can get the same full text in praxis_refresh_capabilities.skills[].content. Skill guidance does not grant new permissions or install anything in your harness.',
    'Before promising to execute a Praxis request, inspect tools/list and the inputSchema and description of the relevant tool. tools/list is authoritative for the capabilities of this connection. A visible workbench app is not an MCP capability.',
    'If no listed tool supports the requested app or operation, explicitly tell the user that this connection cannot execute it. Do not promise execution, invent tools, substitute an unrelated tool, or claim that data or artifacts were created or changed. Do not bypass this boundary with host, filesystem, shell, browser automation, or another connection.',
    'Operate business data only in an explicitly authorized space and resource. The tool list covers permissions across spaces; it does not grant every action on every resource. Every call is independently authorized by the server.',
    'Use only the documented typed fields; code owns the UI, layout and data formatting. Read current revisions before changing resources, use one stable idempotency key per intended mutation, and read back results. Report success only after a successful tool result and verification; report errors and unknown facts honestly.',
    ...[...new Set(availableTools.map(tool => tool.appId).filter(Boolean))].flatMap(appId => bridge.registry.getBusiness(appId)?.instructions || []),
    'No code, host, file, or deployment tools are provided. These instructions constrain this Praxis connection, not the startup or system prompt of the external agent.',
  ].join('\n');
  return { serverInfo: { name: 'praxis-business', version }, instructions, availableTools, spaces };
}

function refreshedContract(bridge, token, version) {
  const { serverInfo, instructions, availableTools, spaces } = currentCapabilities(bridge, token, version);
  return {
    serverInfo, instructions, spaces, transportReconnected: false,
    skills: skillsForTools(availableTools, bridge.registry),
    tools: availableTools.map(tool => ({
      name: tool.name, description: tool.description,
      inputSchema: toJsonSchemaCompat(tool.schema, { strictUnions: true, pipeStrategy: 'input' }),
      _meta: { 'praxis/skill': skillForTool(tool, bridge.registry) },
      annotations: toolAnnotations(tool), execution: { taskSupport: 'forbidden' },
    })),
  };
}

// MCP captures reuse BusinessEvents lifecycle rows. No arguments, outputs, caller
// labels, raw RPC ids or cancellation reasons are persisted here.
const pendingMcpCalls = new Map();
const recordedMcpErrors = new WeakSet();
const safeMcpCode = (error, fallback = 'REQUEST_FAILED') => /^[A-Z][A-Z0-9_]{0,63}$/.test(error?.code || '') ? error.code : fallback;
const mcpOutcome = error => ({ status: [401, 403].includes(error?.status) ? 'denied' : error?.code === 'OUTCOME_UNKNOWN' ? 'unknown' : 'failed', code: safeMcpCode(error) });
function rememberMcpError(error) { if (error && typeof error === 'object') recordedMcpErrors.add(error); }
function mcpCallKey(events, actor, rpcId) {
  if (!events?.tracePseudonym || !actor || !(typeof rpcId === 'string' || typeof rpcId === 'number' && Number.isFinite(rpcId))) return null;
  return events.tracePseudonym(JSON.stringify([actor.userId, actor.clientId, actor.grantId, typeof rpcId, rpcId]));
}
export function recordMcpIngressFailure(error, { events, started = performance.now(), actor } = {}) {
  if (!events?.beginTrace || error && typeof error === 'object' && recordedMcpErrors.has(error)) return;
  const id = events.beginTrace({ requestId: randomUUID(), operation: 'mcp_ingress', action: 'read', source: 'mcp', userId: actor?.userId, clientId: actor?.clientId, grantId: actor?.grantId,
    mcp: { endpoint: '/mcp', transport: 'streamable-http', method: 'not_available', category: 'ingress' } });
  events.endTrace(id, { ...mcpOutcome(error), durationMs: Math.max(0, Math.round(performance.now() - started)) });
  rememberMcpError(error);
}
function captureMcpCall(request, response, bridge, actor, body, requested) {
  if (body?.method !== 'tools/call' || !bridge.events?.beginTrace) return null;
  const events = bridge.events, started = performance.now(), name = body?.params?.name;
  const category = requested?.appId ? 'business' : requested ? 'control' : 'unknown';
  const id = events.beginTrace({ requestId: randomUUID(), ...(requested?.appId && { appId: requested.appId }), operation: requested?.operation || 'call_tool', action: requested?.action || 'invoke', source: 'mcp', userId: actor?.userId, clientId: actor?.clientId, grantId: actor?.grantId,
    mcp: { endpoint: '/mcp', transport: 'streamable-http', method: 'tools/call', category, ...(requested ? { toolName: requested.name } : typeof name === 'string' ? { toolRef: events.tracePseudonym(name) } : {}) } });
  let callbackStarted = false, settled = false, ended = false, cancelled = false, cancelCode, ready;
  const key = mcpCallKey(events, actor, body?.id);
  const remove = () => { const values = key && pendingMcpCalls.get(key); values?.delete(capture); if (values?.size === 0) pendingMcpCalls.delete(key); };
  const finish = () => {
    if (ended || !settled) return;
    ended = true;
    try { events.endTrace(id, { ...(cancelled ? { status: 'cancelled', code: cancelCode } : ready), durationMs: Math.max(0, Math.round(performance.now() - started)) }); }
    finally { remove(); }
  };
  const capture = {
    id,
    get started() { return callbackStarted; },
    get ended() { return ended; },
    get cancelled() { return cancelled; },
    step(value) { if (!ended) events.recordTrace(id, value); },
    beginCallback() { if (cancelled) return false; callbackStarted = true; return true; },
    complete(value) { if (ended) return; ready ||= value; settled = true; if (response.writableEnded || response.destroyed) finish(); },
    cancel(code = 'CLIENT_CANCELLED') {
      if (ended || cancelled) return;
      cancelled = true; cancelCode = code;
      capture.step({ stage: 'transport', status: 'cancelled', code });
      // A delivered request can still commit after the client leaves. Its bridge
      // steps must finish before the shared lifecycle row becomes terminal.
      if (!callbackStarted) { ready = { status: 'cancelled', code }; settled = true; }
      if (settled) finish();
    },
    responseFinished(fallback) { if (!settled && !callbackStarted) { capture.step({ stage: fallback.status === 'denied' ? 'authorization' : 'validation', ...fallback }); capture.complete(fallback); } finish(); },
  };
  if (key) { const values = pendingMcpCalls.get(key) || new Set(); values.add(capture); pendingMcpCalls.set(key, values); }
  request.once('aborted', () => capture.cancel('CLIENT_DISCONNECTED'));
  response.once('close', () => { if (!response.writableEnded) capture.cancel('CLIENT_DISCONNECTED'); });
  return capture;
}

export async function handleMcp(request, response, { bridge, token, actor: authenticatedActor, version, body, observations }) {
  const started = performance.now(), name = body?.params?.name;
  const requested = [...bridge.registry.tools, ...MCP_CONTROL_TOOLS].find(tool => tool.name === name);
  let actor = authenticatedActor;
  try { actor ||= bridge.auth.authenticate(token); } catch { /* Negotiation below returns the actual authorization failure. */ }
  if (body?.method === 'notifications/cancelled') {
    const key = mcpCallKey(bridge.events, actor, body?.params?.requestId), pending = key && pendingMcpCalls.get(key);
    // Stateless HTTP clients can reuse ids. Do not guess when a caller has more
    // than one matching in-flight call, and never persist the untrusted reason.
    if (pending?.size === 1) [...pending][0].cancel('CLIENT_CANCELLED');
  }
  const capture = captureMcpCall(request, response, bridge, actor, body, requested);
  const isControl = MCP_CONTROL_TOOLS.some(tool => tool.name === name);
  const registered = new Set(); let emitted = false;
  const record = outcome => {
    if (isControl || emitted || body?.method !== 'tools/call') return;
    emitted = true;
    recordObservation(observations, { event_name: 'business_action', route_id: 'mcp', method: 'POST', source: 'mcp', ...(requested?.appId ? classifyCapability(requested.appId, requested.operation, bridge.registry) : classifyTool(name, bridge.registry)), ...outcome, duration_ms: Math.max(0, Math.round(performance.now() - started)) });
  };
  response.once('finish', () => {
    let fallback;
    if (body?.jsonrpc !== '2.0' || typeof name !== 'string') { record({ result: 'invalid', reason_code: 'INVALID_INPUT' }); fallback = { status: 'failed', code: 'INVALID_MCP_REQUEST' }; }
    else if (response.statusCode >= 400) { record({ result: 'invalid', reason_code: 'SDK_VALIDATION' }); fallback = { status: 'failed', code: 'MCP_TRANSPORT_ERROR' }; }
    else if (requested && !registered.has(name)) { record({ result: 'forbidden', reason_code: 'FORBIDDEN' }); fallback = { status: 'denied', code: 'FORBIDDEN' }; }
    else if (!requested) { record({ result: 'unsupported', reason_code: 'UNKNOWN_TOOL' }); fallback = { status: 'failed', code: 'UNKNOWN_TOOL' }; }
    else { record({ result: 'invalid', reason_code: 'SDK_VALIDATION' }); fallback = { status: 'failed', code: 'INVALID_INPUT' }; }
    capture?.responseFinished(fallback);
  });
  let server, transport;
  try {
    const contract = currentCapabilities(bridge, token, version);
    server = new McpServer(contract.serverInfo, { instructions: contract.instructions });
    registerMcpSkills(server, contract.availableTools, () => currentCapabilities(bridge, token, version).availableTools, bridge.registry);
    for (const tool of contract.availableTools) {
      registered.add(tool.name);
      server.registerTool(tool.name, { description: tool.description, inputSchema: tool.schema, annotations: toolAnnotations(tool), _meta: { 'praxis/skill': skillForTool(tool, bridge.registry) } }, async (args, extra) => {
        if (capture && !capture.beginCallback()) return { isError: true, content: [{ type: 'text', text: '{"code":"CLIENT_CANCELLED","status":499}' }] };
        const cancelled = () => capture?.cancel('CLIENT_CANCELLED'); extra?.signal?.addEventListener('abort', cancelled, { once: true });
        let invoked = false;
        try {
          const invocation = tool.appId ? {
            appId: tool.appId, operation: tool.operation, spaceId: args.spaceId,
            ...Object.fromEntries(['resourceId', 'sourceResourceId', 'expectedRevision', 'idempotencyKey'].filter(k => args[k] !== undefined).map(k => [k, args[k]])),
            ...(tool.input ? { input: tool.input(args) } : {}),
          } : null;
          capture?.step({ stage: 'validation', status: 'succeeded' });
          invoked = true;
          const result = tool.appId ? await bridge.invoke(token, invocation, { source: 'mcp', ...(capture && { mcpTraceId: capture.id }) }) : refreshedContract(bridge, token, version);
          let output;
          const formatter = tool.appId && bridge.registry.getBusiness(tool.appId)?.formatMcpResult;
          output = formatter ? await formatter({ operation: tool.operation }, args, result) : null;
          output ||= { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
          record(classifyOutcome(200)); capture?.complete({ status: 'succeeded' }); return output;
        } catch (error) {
          record(classifyOutcome(error.status || 500, error.code));
          if (!invoked || error.code === 'INVALID_APP_RESPONSE') capture?.step({ stage: 'validation', status: 'failed', code: safeMcpCode(error, 'INVALID_INPUT') });
          capture?.complete(mcpOutcome(error));
          const details = tool.appId ? bridge.registry.getBusiness(tool.appId)?.errorDetails?.(error.status, error.code, error) || {} : {};
          const value = { code: safeMcpCode(error), status: error.status || 500, ...(error.committed ? { committed: true, requestId: error.requestId } : {}), ...details };
          return { isError: true, content: [{ type: 'text', text: JSON.stringify(value) }], ...(Object.keys(details).length ? { structuredContent: value } : {}) };
        } finally { extra?.signal?.removeEventListener('abort', cancelled); }
      });
    }
    transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    response.on('close', () => { transport.close().catch(() => {}); server.close().catch(() => {}); });
    await server.connect(transport);
    await transport.handleRequest(request, response, body);
  } catch (error) {
    capture?.complete(mcpOutcome(error));
    if (capture) rememberMcpError(error);
    throw error;
  }
}
