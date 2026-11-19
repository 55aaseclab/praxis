import { parseFragment } from 'parse5';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import { readFile, lstat } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { PolicyGate } from './policy-gate.mjs';
import { z } from 'zod';
import { travelPlaceIdSchema } from './travel-schema.mjs';
import { travelPlacePatchSchema, travelDayPlanSchema, travelBudgetItemSchema } from './travel-planning-schema.mjs';
import { projectIdSchema, projectRevisionSchema, projectInputs } from './project-schema.mjs';
import { knowledgeIdSchema, knowledgeRevisionSchema, knowledgeInputs } from './knowledge-schema.mjs';
import { memoTopicSchema, memoRevisionSchema, memoInputs, MEMO_RECORD_OPERATIONS } from './memo-schema.mjs';
import { slidesAvailable, slidesInputs, SLIDES_OPERATIONS, SLIDES_NO_RESOURCE, SLIDES_DOCUMENT_WRITES, SLIDES_KEYED_OPERATIONS, SLIDES_ACTIONS, SLIDES_SNAPSHOT_OPERATIONS, slidesIdSchema, slidesRevisionSchema, slidesRequiredActions, slidesErrorDetails } from './slides-schema.mjs';

function reminderTitle(markup) {
  if (!/[<&]/.test(markup)) return markup;
  const visit = node => {
    if (['script', 'style'].includes(node.tagName)) return '';
    if (node.tagName === 'br') return ' ';
    return node.value ?? (node.childNodes || []).map(visit).join('');
  };
  return visit(parseFragment(markup)).trim();
}

export const OPERATIONS = {
  reminder: { list: 'read', stats: 'read', events: 'read', add: 'create', record: 'create', update: 'update', complete: 'complete', delete: 'delete' },
  tingproof: { list_assignments: 'read', get_assignment: 'read', events: 'read', submit_corrections: 'submit', create_assignment: 'assign', revoke_assignment: 'assign' },
  travel: { list_itineraries: 'read', read_itinerary: 'read', update_place_details: 'update', upsert_place: 'update', set_day_plan: 'update', set_budget_item: 'update', search_places: 'read', get_place: 'read', plan_route: 'read', query_travel_services: 'read', events: 'read' },
  projects: { list_projects: 'read', read_project: 'read', find_references: 'read', create_project: 'create', update_project: 'update', set_work_item: 'update', set_reference: 'update', events: 'read' },
  knowledge: { import_document: 'update', read_document: 'read', search_evidence: 'read', list_libraries: 'read', import_paper_statistics: 'update', read_library: 'read', create_library: 'create', set_collection: 'update', add_source: 'update', capture_project: 'update', read_source: 'read', set_entry: 'update', read_entry: 'read', search: 'read', replace_document_text: 'update', insert_document_text: 'update', delete_document_text: 'update', events: 'read' },
  memo: { read_records: 'read', put_record: 'update', delete_record: 'update', import_records: 'update', replace_records: 'update', list_topics: 'read', read_topic: 'read', events: 'read', set_guide: 'update', archive_guide: 'update' },
  ...(slidesAvailable ? { slides: SLIDES_OPERATIONS } : {}),
};
export function businessError(status, code, message = code) {
  return Object.assign(new Error(message), { status, code });
}
export async function readSigningKey(file) {
  const info = await lstat(file);
  if (!info.isFile() || info.isSymbolicLink() || (info.mode & 0o077)) throw businessError(500, 'UNSAFE_KEY', 'Signing keys must be private regular files.');
  const key = await readFile(file);
  if (key.length < 32) throw businessError(500, 'UNSAFE_KEY', 'Signing keys require at least 32 bytes.');
  return key;
}
export function signAssertion(claims, key) {
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return `${payload}.${createHmac('sha256', key).update(payload).digest('base64url')}`;
}
const fields = new Set(['appId', 'operation', 'spaceId', 'resourceId', 'sourceResourceId', 'input', 'expectedRevision', 'idempotencyKey']);
const identifier = value => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,199}$/.test(value);
const travelPlanningInputs = Object.freeze({
  upsert_place: z.object({ placeId: travelPlaceIdSchema, patch: travelPlacePatchSchema }).strict(),
  set_day_plan: travelDayPlanSchema,
  set_budget_item: travelBudgetItemSchema,
});
export function validateInvocation(request) {
  if (!request || typeof request !== 'object' || Array.isArray(request) || Object.keys(request).some(k => !fields.has(k))) throw businessError(400, 'INVALID_REQUEST');
  const { appId, operation, spaceId, resourceId } = request;
  if (!Object.hasOwn(OPERATIONS, appId) || !Object.hasOwn(OPERATIONS[appId], operation) || !identifier(spaceId) || (resourceId !== undefined && !identifier(resourceId))) throw businessError(400, 'INVALID_REQUEST');
  if (request.input !== undefined && (!request.input || typeof request.input !== 'object' || Array.isArray(request.input))) throw businessError(400, 'INVALID_INPUT');
  if (operation === 'record' && (!identifier(request.sourceResourceId) || resourceId !== undefined)) throw businessError(400, 'SOURCE_RESOURCE_REQUIRED');
  if (operation !== 'record' && request.sourceResourceId !== undefined) throw businessError(400, 'INVALID_REQUEST');
  const action = OPERATIONS[appId][operation];
  if (action !== 'read' && (typeof request.idempotencyKey !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,199}$/.test(request.idempotencyKey))) throw businessError(400, 'IDEMPOTENCY_REQUIRED');
  if (['update', 'complete', 'delete', 'get_assignment', 'submit_corrections', 'revoke_assignment'].includes(operation) && !resourceId) throw businessError(400, 'RESOURCE_REQUIRED');
  if (appId === 'travel') {
    if (!['list_itineraries', 'events'].includes(operation) && !resourceId) throw businessError(400, 'RESOURCE_REQUIRED');
    if (action === 'update' && (typeof request.expectedRevision !== 'string' || !/^(0|[1-9]\d*)$/.test(request.expectedRevision) || !Number.isSafeInteger(Number(request.expectedRevision)))) throw businessError(400, 'INVALID_REVISION');
  }
  if (appId === 'travel' && Object.hasOwn(travelPlanningInputs, operation) && !travelPlanningInputs[operation].safeParse(request.input).success) throw businessError(400, 'INVALID_INPUT');
  if (appId === 'projects') {
    if (!['list_projects', 'find_references', 'events'].includes(operation) && !resourceId) throw businessError(400, 'RESOURCE_REQUIRED');
    if (['list_projects', 'find_references', 'events'].includes(operation) && resourceId !== undefined) throw businessError(400, 'INVALID_REQUEST');
    if (resourceId !== undefined && !projectIdSchema.safeParse(resourceId).success) throw businessError(400, 'INVALID_REQUEST');
    if (action === 'update' && !projectRevisionSchema.safeParse(request.expectedRevision).success) throw businessError(400, 'INVALID_REVISION');
    if (['list_projects', 'read_project', 'find_references', 'create_project', 'events'].includes(operation) && request.expectedRevision !== undefined) throw businessError(400, 'INVALID_REVISION');
    if (action === 'read' && request.idempotencyKey !== undefined) throw businessError(400, 'INVALID_REQUEST');
    if (Object.hasOwn(projectInputs, operation) && !projectInputs[operation].safeParse(request.input).success) throw businessError(400, 'INVALID_INPUT');
    if (['list_projects', 'read_project'].includes(operation) && request.input !== undefined && Object.keys(request.input).length) throw businessError(400, 'INVALID_INPUT');
    if (operation === 'events' && !z.object({ after: z.number().int().nonnegative().optional() }).strict().safeParse(request.input || {}).success) throw businessError(400, 'INVALID_INPUT');
  }
  if (appId === 'knowledge') {
    const catalog = ['list_libraries', 'events'].includes(operation);
    if (catalog ? resourceId !== undefined : !knowledgeIdSchema.safeParse(resourceId).success) throw businessError(400, 'INVALID_REQUEST');
    if (resourceId === 'legacy-library' && !['read_library', 'read_entry', 'read_source', 'search', 'add_source', 'set_entry', 'set_collection', 'replace_document_text', 'insert_document_text', 'delete_document_text'].includes(operation)) throw businessError(400, 'INVALID_REQUEST');
    if (action === 'update' ? !knowledgeRevisionSchema.safeParse(request.expectedRevision).success : request.expectedRevision !== undefined) throw businessError(400, 'INVALID_REVISION');
    if (action === 'read' && request.idempotencyKey !== undefined) throw businessError(400, 'INVALID_REQUEST');
    if (!knowledgeInputs[operation].safeParse(request.input || {}).success) throw businessError(400, 'INVALID_INPUT');
    if (operation === 'capture_project' && request.input.sourceSpaceId !== spaceId) throw businessError(400, 'CROSS_SPACE_CAPTURE_UNSUPPORTED');
  }
  if (appId === 'memo') {
    if (['list_topics', 'events'].includes(operation) ? resourceId !== undefined : !(MEMO_RECORD_OPERATIONS.includes(operation) ? resourceId === 'records' : memoTopicSchema.safeParse(resourceId).success)) throw businessError(400, 'INVALID_REQUEST');
    if (action === 'update' ? !memoRevisionSchema.safeParse(request.expectedRevision).success : request.expectedRevision !== undefined) throw businessError(400, 'INVALID_REVISION');
    if (action === 'read' && request.idempotencyKey !== undefined) throw businessError(400, 'INVALID_REQUEST');
    if (!memoInputs[operation].safeParse(request.input || {}).success) throw businessError(400, 'INVALID_INPUT');
  }
  if (appId === 'slides') {
    if (SLIDES_NO_RESOURCE.has(operation) ? resourceId !== undefined : !slidesIdSchema.safeParse(resourceId).success) throw businessError(400, 'RESOURCE_REQUIRED');
    const revisionRequired = operation !== 'create_deck' && (SLIDES_DOCUMENT_WRITES.has(operation) || SLIDES_SNAPSHOT_OPERATIONS.has(operation));
    if (revisionRequired ? !slidesRevisionSchema.safeParse(request.expectedRevision).success : request.expectedRevision !== undefined) throw businessError(400, 'INVALID_REVISION');
    if (SLIDES_KEYED_OPERATIONS.has(operation) ? !identifier(request.idempotencyKey) : request.idempotencyKey !== undefined) throw businessError(400, 'INVALID_REQUEST');
    if (!slidesInputs[operation].safeParse(request.input || {}).success) throw businessError(400, 'INVALID_INPUT');
    if (operation === 'get_artifact') {
      const input = request.input || {};
      if (Number(Boolean(input.artifactId)) + Number(Boolean(input.assetId)) !== 1 || input.mode !== 'chunk' && (input.offset !== undefined || input.length !== undefined)) throw businessError(400, 'INVALID_INPUT');
    }
  }
  return action;
}

export class BusinessBridge {
  constructor({ auth, apps, events, fetchImpl = fetch, clock = () => Date.now(), gate = new PolicyGate(), observeAdapter }) {
    this.auth = auth; this.apps = apps; this.events = events; this.fetch = fetchImpl; this.clock = clock; this.gate = gate;
    this.observeAdapter = observeAdapter;
    for (const [appId, app] of Object.entries(apps)) {
      const url = new URL(app.url);
      if (!Object.hasOwn(OPERATIONS, appId) || !['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/api/business') throw businessError(500, 'INVALID_ADAPTER');
    }
  }
  async callAdapter(appId, request, scope, { requestId = randomUUID(), sourceReadGranted = false, actionsGranted } = {}) {
    const started = performance.now(); let observedStatus = 200, observedCode;
    try {
      return await this.executeAdapter(appId, request, scope, { requestId, sourceReadGranted, actionsGranted });
    } catch (error) { observedStatus = error.status || 500; observedCode = error.code; throw error; }
    finally {
      try { this.observeAdapter?.({ appId, operation: request.operation, system: scope.clientId === 'business-service' && scope.grantId === 'event-recovery', status: observedStatus, code: observedCode, durationMs: Math.max(0, Math.round(performance.now() - started)) }); } catch {}
    }
  }
  async executeAdapter(appId, request, scope, { requestId = randomUUID(), sourceReadGranted = false, actionsGranted } = {}) {
    const app = this.apps[appId];
    if (!app) throw businessError(503, 'APP_UNAVAILABLE');
    const { appId: ignored, ...body } = request;
    if (appId === 'tingproof' && request.operation === 'list_assignments' && !body.resourceId) body.resourceId = 'assignments';
    if (appId === 'tingproof' && body.expectedRevision !== undefined) {
      if (!/^(0|[1-9]\d*)$/.test(String(body.expectedRevision)) || !Number.isSafeInteger(Number(body.expectedRevision))) throw businessError(400, 'INVALID_REVISION');
      body.expectedRevision = Number(body.expectedRevision);
    }
    const raw = JSON.stringify(body);
    const key = app.key || await readSigningKey(app.keyFile);
    const validUntil = Math.min(scope.expiresAt, this.clock() + 20_000);
    const assertion = signAssertion({
      v: 1, appId, userId: scope.userId, clientId: scope.clientId, grantId: scope.grantId,
      spaceId: request.spaceId, action: OPERATIONS[appId][request.operation], resources: scope.resources,
      expiresAt: validUntil, requestId,
      ...(sourceReadGranted ? { sourceReadGranted: true } : {}),
      ...(appId === 'slides' ? { actionsGranted: actionsGranted || ['read'], authorizationExpiresAt: scope.expiresAt, firstPartyNative: scope.firstPartyNative === true } : {}),
      method: 'POST', path: '/api/business', bodyHash: createHash('sha256').update(raw).digest('hex'),
    }, key);
    const write = OPERATIONS[appId][request.operation] !== 'read' || appId === 'slides' && SLIDES_KEYED_OPERATIONS.has(request.operation);
    let response;
    try {
      response = await this.fetch(app.url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Praxis-Assertion': assertion }, body: raw, redirect: 'error', signal: AbortSignal.timeout(15_000) });
    } catch { throw Object.assign(businessError(503, write ? 'OUTCOME_UNKNOWN' : 'APP_UNAVAILABLE'), write ? { validUntil } : {}); }
    try {
    const maximumResponseBytes = appId === 'memo' && MEMO_RECORD_OPERATIONS.includes(request.operation) ? 10 * 1024 * 1024 : appId === 'slides' && request.operation === 'get_artifact' ? 8 * 1024 * 1024 : 4 * 1024 * 1024;
    const length = Number(response.headers.get('content-length'));
    if (length > maximumResponseBytes) { await response.body?.cancel(); throw businessError(502, 'INVALID_APP_RESPONSE'); }
    const reader = response.body?.getReader(); const parts = []; let size = 0;
    if (reader) while (true) {
      const part = await reader.read(); if (part.done) break;
      size += part.value.byteLength;
      if (size > maximumResponseBytes) { await reader.cancel(); throw businessError(502, 'INVALID_APP_RESPONSE'); }
      parts.push(Buffer.from(part.value));
    }
    let result;
    try { result = JSON.parse(Buffer.concat(parts).toString('utf8')); } catch { throw businessError(502, 'INVALID_APP_RESPONSE'); }
    if (!response.ok) {
      const code = String(result.code || result.error?.code || 'APP_REQUEST_REJECTED').toUpperCase();
      const status = [400, 401, 403, 404, 409, 412, 413, 416, 422, 423, 428, 429, 503].includes(response.status) ? response.status : 502;
      const safeCode = /^[A-Z_]{1,64}$/.test(code) ? code : 'APP_REQUEST_REJECTED';
      throw Object.assign(businessError(status, safeCode), appId === 'slides' ? slidesErrorDetails(status, safeCode, result) : {});
    }
    return result;
    } catch (error) {
      if (write && (!error.status || error.status >= 500)) throw Object.assign(businessError(503, 'OUTCOME_UNKNOWN'), { validUntil });
      throw error;
    }
  }
  async invoke(token, request) {
    return this.gate.run(() => this.auth.withPolicyLease(() => this.executeInvocation(token, request)));
  }
  async invokeProjection(token, request) {
    return this.gate.run(() => this.auth.withPolicyLease(() => this.executeInvocation(token, request, { projection: true })));
  }
  async executeInvocation(token, request, { projection = false } = {}) {
    const action = validateInvocation(request);
    const requestId = randomUUID();
    let actor, scope, traceId;
    const traceStep = value => { if (traceId) this.events.recordTrace(traceId, value); };
    const captureProject = request.appId === 'knowledge' && request.operation === 'capture_project';
    const authorizeSource = () => this.auth.authorize(token, captureProject ? { appId: 'projects', spaceId: request.input.sourceSpaceId, action: 'read', resourceId: request.input.projectId } : { appId: request.appId, spaceId: request.spaceId, action: 'read', resourceId: request.sourceResourceId });
    let committed = false;
    try {
      actor = this.auth.authenticate(token);
      if (!projection && (action !== 'read' || actor.grantId) && this.events?.beginTrace) traceId = this.events.beginTrace({ requestId, appId: request.appId, spaceId: request.spaceId, resourceId: request.resourceId, operation: request.operation, action, userId: actor.userId, clientId: actor.clientId, grantId: actor.grantId, source: actor.grantId ? 'mcp' : 'web' });
      if (!this.apps[request.appId]?.spaces?.includes(request.spaceId)) throw businessError(403, 'FORBIDDEN');
      scope = this.auth.authorize(token, { appId: request.appId, spaceId: request.spaceId, action, resourceId: request.resourceId });
      traceStep({ stage: 'authorization', status: 'allowed' });
      const slidesScopes = [];
      let actionsGranted;
      if (request.appId === 'slides') {
        for (const required of slidesRequiredActions(request.operation, request.input)) slidesScopes.push(this.auth.authorize(token, { appId: 'slides', spaceId: request.spaceId, resourceId: request.resourceId, action: required }));
        actionsGranted = SLIDES_ACTIONS.filter(required => {
          try { const permission = this.auth.authorize(token, { appId: 'slides', spaceId: request.spaceId, resourceId: request.resourceId, action: required }, { auditDenied: false }); slidesScopes.push(permission); return true; }
          catch (error) { if (error.status !== 403) throw error; return false; }
        });
        scope = { ...scope, expiresAt: Math.min(scope.expiresAt, ...slidesScopes.map(permission => permission.expiresAt)) };
      }
      const sourceScope = request.operation === 'record' || captureProject ? authorizeSource() : null;
      let adapterRequest = request;
      if (captureProject) {
        if (!this.apps.projects?.spaces?.includes(request.input.sourceSpaceId)) throw businessError(403, 'FORBIDDEN');
        const source = await this.callAdapter('projects', { operation: 'read_project', spaceId: request.input.sourceSpaceId, resourceId: request.input.projectId }, sourceScope);
        if (!source.project || source.project.id !== request.input.projectId || source.revision !== request.input.projectRevision || source.project.revision !== source.revision) throw businessError(409, 'SOURCE_REVISION_CONFLICT');
        authorizeSource();
        traceStep({ stage: 'readback', status: 'succeeded', sources: [{ appId: 'projects', spaceId: request.input.sourceSpaceId, resourceId: request.input.projectId, revision: source.revision }] });
        adapterRequest = { ...request, input: { ...request.input, snapshot: source.project } };
      }
      traceStep({ stage: 'dispatch', status: 'started' });
      const result = await this.callAdapter(request.appId, adapterRequest, sourceScope ? { ...scope, expiresAt: Math.min(scope.expiresAt, sourceScope.expiresAt) } : scope, { requestId, sourceReadGranted: request.operation === 'record' || captureProject, actionsGranted });
      committed = action !== 'read';
      const traceRevision = result.revision ?? result.item?.revision ?? result.project?.revision;
      traceStep({ stage: committed ? 'commit' : 'readback', status: 'succeeded', ...(committed ? { committed: true } : {}), ...(typeof traceRevision === 'string' || typeof traceRevision === 'number' ? { revision: String(traceRevision) } : {}) });
      if (!projection) this.events?.audit({ requestId, userId: scope.userId, clientId: scope.clientId, grantId: scope.grantId, appId: request.appId, spaceId: request.spaceId, resourceId: request.resourceId, action, decision: 'allow' });
      // Application outboxes recover a committed change even if collection fails.
      if (action !== 'read') await this.harvest(request.appId, request.spaceId, request.appId === 'travel' ? request.resourceId : undefined).catch(() => {});
      try { this.auth.authorize(token, { appId: request.appId, spaceId: request.spaceId, action, resourceId: request.resourceId }); }
      catch (error) {
        if (action !== 'read') { error.code = 'AUTHORIZATION_CHANGED_AFTER_COMMIT'; error.committed = true; error.requestId = requestId; }
        throw error;
      }
      if (request.operation === 'record' || captureProject) authorizeSource();
      if (request.appId === 'slides') for (const required of slidesRequiredActions(request.operation, request.input)) this.auth.authorize(token, { appId: 'slides', spaceId: request.spaceId, resourceId: request.resourceId, action: required });
      if (request.appId === 'reminder' && request.operation === 'list' && Array.isArray(result.items)) {
        const actions = new Map();
        for (const hintAction of ['update', 'complete']) {
          try {
            const hintScope = this.auth.authorize(token, { appId: 'reminder', spaceId: request.spaceId, action: hintAction }, { auditDenied: false });
            actions.set(hintAction, new Set(hintScope.resources));
          } catch (error) { if (error.status !== 403 || error.code !== 'FORBIDDEN') throw error; }
        }
        if (traceId) this.events.endTrace(traceId, { status: 'succeeded' });
        return { ...result, items: result.items.map(entry => ({ ...entry, allowedActions: ['read', ...['update', 'complete'].filter(hintAction => {
          if (typeof entry.resourceId !== 'string' || hintAction === 'complete' && entry.collection === 'recurring') return false;
          const resources = actions.get(hintAction);
          return resources?.has('*') || resources?.has(entry.resourceId);
        })] })), requestId };
      }
      if (request.appId === 'tingproof' && request.operation === 'get_assignment') {
        let submit = false;
        try { this.auth.authorize(token, { appId: 'tingproof', spaceId: request.spaceId, resourceId: request.resourceId, action: 'submit' }, { auditDenied: false }); submit = true; }
        catch (error) { if (error.status !== 403) throw error; }
        if (traceId) this.events.endTrace(traceId, { status: 'succeeded' });
        return { ...result, permissions: { submit }, requestId, ...(traceId ? { traceId } : {}) };
      }
      if (traceId) this.events.endTrace(traceId, { status: 'succeeded', ...(committed ? { committed: true } : {}) });
      return { ...result, requestId, ...(traceId ? { traceId } : {}) };
    } catch (error) {
      if (request.appId === 'slides' && (error.fieldErrors || error.currentRevision)) {
        try {
          this.auth.authorize(token, { appId: 'slides', spaceId: request.spaceId, resourceId: request.resourceId, action });
          for (const required of slidesRequiredActions(request.operation, request.input)) this.auth.authorize(token, { appId: 'slides', spaceId: request.spaceId, resourceId: request.resourceId, action: required });
        } catch (permissionError) { error = permissionError; }
      }
      // A timeout does not prove the owning application stopped. Keep revocation
      // serialized until its signed execution window has expired.
      if (error.validUntil) await delay(Math.max(0, error.validUntil - this.clock()));
      if (committed) { error.committed = true; error.requestId = requestId; }
      if (!projection && !traceId && this.events?.beginTrace && action !== 'read') traceId = this.events.beginTrace({ requestId, appId: request.appId, spaceId: request.spaceId, resourceId: request.resourceId, operation: request.operation, action, userId: actor?.userId, clientId: actor?.clientId, grantId: actor?.grantId, source: actor?.grantId ? 'mcp' : 'web' });
      if (traceId) this.events.endTrace(traceId, { status: 'failed', code: /^[A-Z0-9_]{1,64}$/.test(error.code || '') ? error.code : 'REQUEST_FAILED', ...(committed ? { committed: true } : {}) });
      const identity = scope || actor;
      if (!projection) this.events?.audit({ requestId, userId: identity?.userId, clientId: identity?.clientId, grantId: identity?.grantId, appId: request.appId, spaceId: request.spaceId, resourceId: request.resourceId, action, decision: 'reject', code: error.code || 'REQUEST_FAILED' });
      throw error;
    }
  }
  async harvest(appId, spaceId, targetResourceId) {
    if (!this.events) return;
    if (appId === 'travel') {
      const scope = { userId: 'system-events', clientId: 'business-service', grantId: 'event-recovery', resources: ['*'], expiresAt: this.clock() + 20_000 };
      let items = targetResourceId === undefined ? null : [{ resourceId: targetResourceId }];
      if (!items) items = (await this.callAdapter(appId, { operation: 'list_itineraries', spaceId }, scope)).items;
      if (!Array.isArray(items) || items.length > 100 || items.some(item => !identifier(item.resourceId)) || new Set(items.map(item => item.resourceId)).size !== items.length) throw businessError(502, 'INVALID_APP_RESPONSE');
      for (const { resourceId } of items) {
        const after = this.events.sourceCursor(appId, spaceId, resourceId);
        const result = await this.callAdapter(appId, { operation: 'events', spaceId, resourceId, input: { after } }, { ...scope, resources: [resourceId], expiresAt: this.clock() + 20_000 });
        if (result.resourceId !== resourceId || !Array.isArray(result.events)) throw businessError(502, 'INVALID_APP_RESPONSE');
        this.events.ingest(appId, spaceId, result, { resourceId });
      }
      return;
    }
    const after = this.events.sourceCursor(appId, spaceId);
    const result = await this.callAdapter(appId, { operation: 'events', spaceId, ...(appId === 'tingproof' ? { resourceId: 'events' } : {}), input: { after } }, { userId: 'system-events', clientId: 'business-service', grantId: 'event-recovery', resources: ['*'], expiresAt: this.clock() + 20_000 });
    if (!Array.isArray(result.events)) throw businessError(502, 'INVALID_APP_RESPONSE');
    this.events.ingest(appId, spaceId, result);
  }
  workbenchProjects(token) {
    return this.workbenchItems(token, 'projects', 'list_projects');
  }
  async workbenchAgenda(token) {
    const { spaces, partial } = await this.workbenchItems(token, 'reminder', 'list');
    const items = [];
    for (const space of spaces) {
      for (const { resourceId, collection, item } of space.items) {
        if (!item || item.done || !['plans', 'pool'].includes(collection) || typeof item.text !== 'string') continue;
        const date = typeof item.date === 'string' && /^\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2})?$/.test(item.date) ? item.date : null;
        if (date || item.flagged) items.push({ resourceId, spaceId: space.spaceId, title: reminderTitle(item.text), date, flagged: item.flagged === true });
      }
    }
    return { items, partial };
  }
  async workbenchAttention(token) {
    const [agenda, projects] = await Promise.all([this.workbenchAgenda(token), this.workbenchProjects(token)]);
    const { user } = this.auth.requireNativeSession(token);
    const assigned = [];
    let partial = agenda.partial || projects.partial;
    const refs = projects.spaces.flatMap(space =>
      space.items.map(item => ({ spaceId: space.spaceId, resourceId: item.resourceId })));
    for (let offset = 0; offset < refs.length; offset += 4) {
      const batch = refs.slice(offset, offset + 4);
      const reads = await Promise.allSettled(batch.map(ref =>
        this.invoke(token, { appId: 'projects', operation: 'read_project', ...ref })));
      for (const [index, result] of reads.entries()) {
        if (result.status === 'rejected') {
          if (result.reason?.status === 401) throw result.reason;
          if (result.reason?.status !== 403 && result.reason?.status !== 404) partial = true;
          continue;
        }
        const project = result.value.project;
        if (!project || project.status !== 'active') continue;
        for (const item of project.workItems) {
          if (item.status === 'done' || !(item.owner === user.id || item.owner === user.username)) continue;
          assigned.push({ ...batch[index], appId: 'projects', itemId: item.id, domain: item.domain,
            title: item.title, date: item.dueDate, review: item.status === 'review' });
        }
      }
    }
    // Recheck source grants after all async reads, including reminders that returned first.
    const access = this.auth.getWebAccess(token);
    const scopes = new Map();
    const items = [...agenda.items.map(item => ({ ...item, appId: 'reminder' })), ...assigned].filter(item => {
      if (!access.apps.includes(item.appId)) return false;
      const key = JSON.stringify([item.appId, item.spaceId]);
      if (!scopes.has(key)) {
        try {
          const scope = this.auth.authorize(token, { appId: item.appId, spaceId: item.spaceId, action: 'read' }, { auditDenied: false });
          scopes.set(key, new Set(scope.resources));
        } catch (error) {
          if (error.status !== 403) throw error;
          scopes.set(key, new Set());
        }
      }
      const allowed = scopes.get(key);
      return allowed.has('*') || allowed.has(item.resourceId);
    });
    return { items, partial };
  }
  async workbenchItems(token, appId, operation) {
    const empty = { spaces: [], partial: false };
    if (!this.auth.getWebAccess(token).apps.includes(appId)) return empty;
    const { user } = this.auth.requireNativeSession(token);
    const readableSpaces = (this.apps[appId]?.spaces || []).filter(spaceId =>
      this.auth.userPermissions(user.id, spaceId, appId, 'read').length > 0);
    const results = await Promise.allSettled(readableSpaces.map(spaceId =>
      this.invoke(token, { appId, spaceId, operation })));

    // A grant or session can expire while other spaces are still responding.
    if (!this.auth.getWebAccess(token).apps.includes(appId)) return empty;
    const spaces = [];
    let partial = false;
    for (const [index, result] of results.entries()) {
      const spaceId = readableSpaces[index];
      if (result.status === 'rejected') {
        if (result.reason?.status === 401) throw result.reason;
        if (result.reason?.status !== 403) partial = true;
        continue;
      }
      if (result.value.spaceId !== spaceId || !Array.isArray(result.value.items)) {
        partial = true;
        continue;
      }
      let resources;
      try {
        resources = this.auth.authorize(token, { appId, spaceId, action: 'read' }, { auditDenied: false }).resources;
      } catch (error) {
        if (error.status === 403) continue;
        throw error;
      }
      const items = result.value.items.filter(item => resources.includes('*') || resources.includes(item.resourceId));
      spaces.push({ spaceId, items });
    }
    return { spaces, partial };
  }
  catalog(token) {
    const spaces = this.auth.listSpaces(token);
    return spaces.map(space => ({ ...space, apps: Object.keys(this.apps).flatMap(appId => {
      if (!this.apps[appId].spaces?.includes(space.id)) return [];
      const actions = [...new Set(Object.values(OPERATIONS[appId]))].filter(action => {
        try { this.auth.authorize(token, { appId, spaceId: space.id, action }); return true; } catch { return false; }
      });
      return actions.length ? [{ id: appId, actions }] : [];
    }) })).filter(space => space.apps.length);
  }
}
