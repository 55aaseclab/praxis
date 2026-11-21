import { createHash, createHmac, randomUUID } from 'node:crypto';
import { readFile, lstat } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { PolicyGate } from './policy-gate.mjs';
import { DEFAULT_APP_REGISTRY } from '../default-app-registry.mjs';

export const OPERATIONS = DEFAULT_APP_REGISTRY.operations;
export function businessError(status, code, message = code) { return Object.assign(new Error(message), { status, code }); }
export async function readSigningKey(file) {
  const info = await lstat(file);
  if (!info.isFile() || info.isSymbolicLink() || info.mode & 0o077) throw businessError(500, 'UNSAFE_KEY', 'Signing keys must be private regular files.');
  const key = await readFile(file);
  if (key.length < 32) throw businessError(500, 'UNSAFE_KEY', 'Signing keys require at least 32 bytes.');
  return key;
}
export function signAssertion(claims, key) { const payload = Buffer.from(JSON.stringify(claims)).toString('base64url'); return `${payload}.${createHmac('sha256', key).update(payload).digest('base64url')}`; }
const fields = new Set(['appId', 'operation', 'spaceId', 'resourceId', 'sourceResourceId', 'input', 'expectedRevision', 'idempotencyKey']);
const identifier = value => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,199}$/.test(value);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const identityFields = ['appId', 'operation', 'spaceId', 'resourceId', 'sourceResourceId', 'expectedRevision', 'idempotencyKey'];
export function validateInvocation(request, registry = DEFAULT_APP_REGISTRY) {
  if (!object(request) || Object.keys(request).some(key => !fields.has(key))) throw businessError(400, 'INVALID_REQUEST');
  const { appId, operation, spaceId, resourceId } = request;
  const business = registry.getBusiness(appId), definition = business && Object.hasOwn(business.operations, operation) ? business.operations[operation] : null;
  if (!definition || !identifier(spaceId) || resourceId !== undefined && !identifier(resourceId) || request.sourceResourceId !== undefined && !identifier(request.sourceResourceId)) throw businessError(400, 'INVALID_REQUEST');
  if (request.input !== undefined && !object(request.input)) throw businessError(400, 'INVALID_INPUT');
  if (definition.mutation && !identifier(request.idempotencyKey)) throw businessError(400, 'IDEMPOTENCY_REQUIRED');
  business.validateInvocation(request);
  return definition.action;
}
function boundRequest(original, prepared) {
  if (!object(prepared) || Object.keys(prepared).some(key => !fields.has(key)) || identityFields.some(key => prepared[key] !== original[key]) || prepared.input !== undefined && !object(prepared.input)) throw businessError(500, 'INVALID_APP_INTEGRATION');
  return prepared;
}
const details = (business, status, code, value) => business?.errorDetails?.(status, code, value) || {};

export class BusinessBridge {
  constructor({ auth, apps, events, fetchImpl = fetch, clock = () => Date.now(), gate = new PolicyGate(), observeAdapter, registry = auth?.registry || DEFAULT_APP_REGISTRY }) {
    Object.assign(this, { auth, apps, events, fetch: fetchImpl, clock, gate, observeAdapter, registry });
    for (const [appId, app] of Object.entries(apps)) {
      const url = new URL(app.url);
      if (!registry.getBusiness(appId) || !['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/api/business') throw businessError(500, 'INVALID_ADAPTER');
    }
  }
  async callAdapter(appId, request, scope, options = {}) {
    const started = performance.now(); let observedStatus = 200, observedCode;
    try { return await this.executeAdapter(appId, request, scope, options); }
    catch (error) { observedStatus = error.status || 500; observedCode = error.code; throw error; }
    finally { try { this.observeAdapter?.({ appId, operation: request.operation, system: scope.clientId === 'business-service' && scope.grantId === 'event-recovery', status: observedStatus, code: observedCode, durationMs: Math.max(0, Math.round(performance.now() - started)) }); } catch {} }
  }
  async executeAdapter(appId, request, scope, { requestId = randomUUID(), assertion = {}, actionsGranted } = {}) {
    const app = this.apps[appId], business = this.registry.getBusiness(appId), definition = business?.operations?.[request.operation];
    if (!app || !definition) throw businessError(503, 'APP_UNAVAILABLE');
    const normalized = business.normalizeAdapterRequest?.(request) || request;
    const sameResource = normalized.resourceId === request.resourceId || request.resourceId === undefined && definition.adapterResourceId !== undefined && normalized.resourceId === definition.adapterResourceId;
    if (!object(normalized) || ['appId', 'operation', 'spaceId', 'idempotencyKey'].some(key => normalized[key] !== request[key]) || !sameResource || String(normalized.expectedRevision) !== String(request.expectedRevision)) throw businessError(500, 'INVALID_APP_INTEGRATION');
    const { appId: ignored, ...body } = normalized, raw = JSON.stringify(body), key = app.key || await readSigningKey(app.keyFile);
    const validUntil = Math.min(scope.expiresAt, this.clock() + 20_000);
    const extras = { ...assertion };
    // System outbox reads use the same declared claim primitives, without a user token.
    for (const [field, rule] of Object.entries(business.assertionRules || {})) {
      if (rule.kind === 'authorization-expiry') extras[field] = scope.expiresAt;
      if (rule.kind === 'native-session') extras[field] = scope.firstPartyNative === true;
    }
    if (Object.keys(extras).some(field => !business.assertionFields?.includes(field))) throw businessError(500, 'INVALID_APP_INTEGRATION');
    const claims = signAssertion({ ...extras, ...(business.collectActions ? { actionsGranted: actionsGranted || [definition.action] } : {}),
      v: 1, appId, userId: scope.userId, clientId: scope.clientId, grantId: scope.grantId, spaceId: request.spaceId,
      action: definition.action, resources: scope.resources, expiresAt: validUntil, requestId,
      method: 'POST', path: '/api/business', bodyHash: createHash('sha256').update(raw).digest('hex') }, key);
    let response;
    try { response = await this.fetch(app.url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Praxis-Assertion': claims }, body: raw, redirect: 'error', signal: AbortSignal.timeout(15_000) }); }
    catch { throw Object.assign(businessError(503, definition.mutation ? 'OUTCOME_UNKNOWN' : 'APP_UNAVAILABLE'), definition.mutation ? { validUntil } : {}); }
    try {
      const maximum = (typeof business.responseLimit === 'function' ? business.responseLimit(request) : business.responseLimit) || 4 * 1024 * 1024;
      if (!Number.isInteger(maximum) || maximum < 1024 || maximum > 16 * 1024 * 1024) throw businessError(500, 'INVALID_APP_INTEGRATION');
      if (Number(response.headers.get('content-length')) > maximum) { await response.body?.cancel(); throw businessError(502, 'INVALID_APP_RESPONSE'); }
      const reader = response.body?.getReader(), parts = []; let size = 0;
      if (reader) for (;;) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength; if (size > maximum) { await reader.cancel(); throw businessError(502, 'INVALID_APP_RESPONSE'); } parts.push(Buffer.from(part.value)); }
      let result; try { result = JSON.parse(Buffer.concat(parts).toString('utf8')); } catch { throw businessError(502, 'INVALID_APP_RESPONSE'); }
      if (!response.ok) {
        const code = String(result.code || result.error?.code || 'APP_REQUEST_REJECTED').toUpperCase();
        const status = [400, 401, 403, 404, 409, 412, 413, 416, 422, 423, 428, 429, 503].includes(response.status) ? response.status : 502;
        const safeCode = /^[A-Z_]{1,64}$/.test(code) ? code : 'APP_REQUEST_REJECTED';
        throw Object.assign(businessError(status, safeCode), details(business, status, safeCode, result));
      }
      return result;
    } catch (error) { if (definition.mutation && (!error.status || error.status >= 500)) throw Object.assign(businessError(503, 'OUTCOME_UNKNOWN'), { validUntil }); throw error; }
  }
  invoke(token, request, options) { return this.gate.run(() => this.auth.withPolicyLease(() => this.executeInvocation(token, request, options))); }
  invokeProjection(token, request) {
    if (this.registry.operationDefinitions[request?.appId]?.[request?.operation]?.mutation) throw businessError(403, 'FORBIDDEN');
    return this.gate.run(() => this.auth.withPolicyLease(() => this.executeInvocation(token, request, { projection: true })));
  }
  async executeInvocation(token, request, { projection = false, source, mcpTraceId, depth = 0 } = {}) {
    if (depth > 8) throw businessError(500, 'INVALID_APP_INTEGRATION');
    const requestId = randomUUID(), action = validateInvocation(request, this.registry), business = this.registry.getBusiness(request.appId), definition = business.operations[request.operation];
    let actor, scope, traceId = projection ? undefined : mcpTraceId, authorized = false, dispatched = false, committed = false, traceSource = source;
    if (traceId) this.events.linkTrace(traceId, { requestId, bridgeLinked: true });
    const traceStep = value => { if (traceId) this.events.recordTrace(traceId, value); };
    const finishTrace = value => { if (traceId && !mcpTraceId) this.events.endTrace(traceId, value); };
    const checks = [], subjects = new Map(), sourceScopes = [], sourceReads = [];
    const authorize = (query, required = true) => {
      try { const permission = this.auth.authorize(token, query, { auditDenied: required }); checks.push(query); if (scope) scope = { ...scope, expiresAt: Math.min(scope.expiresAt, permission.expiresAt) }; return permission; }
      catch (error) { if (!required && error.status === 403 && error.code === 'FORBIDDEN') return null; throw error; }
    };
    const recheck = () => {
      for (const query of checks) this.auth.authorize(token, query, { auditDenied: false });
      for (const [userId, allowed] of subjects) if (allowed && !this.auth.subjectReadScope(userId, request)) throw businessError(403, 'FORBIDDEN');
    };
    try {
      actor = this.auth.authenticate(token); traceSource = mcpTraceId ? 'mcp' : source || (actor.firstPartyNative ? 'web' : 'http');
      if (!projection && !traceId && (definition.mutation || traceSource !== 'web') && this.events?.beginTrace) traceId = this.events.beginTrace({ requestId, appId: request.appId, operation: request.operation, action, userId: actor.userId, clientId: actor.clientId, grantId: actor.grantId, source: traceSource });
      if (!this.auth.appSpaceEnabled(request.appId, request.spaceId, this.apps)) throw businessError(403, 'FORBIDDEN');
      scope = authorize({ appId: request.appId, spaceId: request.spaceId, action, resourceId: request.resourceId }); authorized = true;
      if (traceId) this.events.linkTrace(traceId, { appId: request.appId, spaceId: request.spaceId, ...(request.resourceId !== undefined && { resourceId: request.resourceId }), operation: request.operation, action });
      traceStep({ stage: 'authorization', status: 'allowed' });
      const requiredActions = business.requiredActions?.(request) || [];
      if (!Array.isArray(requiredActions) || requiredActions.some(value => !business.actions.includes(value))) throw businessError(500, 'INVALID_APP_INTEGRATION');
      for (const required of requiredActions) authorize({ appId: request.appId, spaceId: request.spaceId, resourceId: request.resourceId, action: required });
      const actionsGranted = business.actions.filter(hint => Boolean(authorize({ appId: request.appId, spaceId: request.spaceId, resourceId: request.resourceId, action: hint }, false)));
      const sourceQueries = business.sourceAuthorizations?.(request) || [];
      if (!Array.isArray(sourceQueries) || sourceQueries.length > 32) throw businessError(500, 'INVALID_APP_INTEGRATION');
      for (const query of sourceQueries) {
        if (!object(query) || query.action !== 'read' || !identifier(query.spaceId) || !identifier(query.resourceId) || !this.auth.appSpaceEnabled(query.appId, query.spaceId, this.apps) || query.operation !== undefined && (this.registry.operations[query.appId]?.[query.operation] !== 'read' || this.registry.operationDefinitions[query.appId][query.operation].mutation)) throw businessError(403, 'FORBIDDEN');
        sourceScopes.push({ query, scope: authorize({ appId: query.appId, spaceId: query.spaceId, resourceId: query.resourceId, action: 'read' }) });
      }
      const context = Object.freeze({
        membershipRole: this.auth.membershipRole(actor.userId, request.spaceId), actionsGranted: Object.freeze(actionsGranted), firstPartyNative: actor.firstPartyNative === true,
        get authorizationExpiresAt() { return scope.expiresAt; }, sourceReadGranted: sourceScopes.length > 0,
        hasAction: (hint, resourceId = request.resourceId) => {
          if (!business.actions.includes(hint) || request.resourceId !== undefined && resourceId !== request.resourceId || resourceId !== undefined && !identifier(resourceId)) return false;
          return Boolean(authorize({ appId: request.appId, spaceId: request.spaceId, resourceId, action: hint }, false));
        },
        canReadSubject: userId => {
          const permission = this.auth.subjectReadScope(userId, request), allowed = Boolean(permission); subjects.set(userId, allowed);
          if (permission) scope = { ...scope, expiresAt: Math.min(scope.expiresAt, permission.expiresAt) }; return allowed;
        },
        authorizedRead: async input => {
          if (!object(input)) throw businessError(403, 'FORBIDDEN');
          const query = { ...input, appId: input.appId ?? request.appId, spaceId: input.spaceId ?? request.spaceId, resourceId: input.resourceId ?? request.resourceId };
          const selected = sourceScopes.find(value => ['appId', 'spaceId', 'resourceId', 'operation'].every(field => value.query[field] === query[field]));
          const self = query.appId === request.appId && query.spaceId === request.spaceId && query.resourceId === request.resourceId && business.authorizedReads?.includes(query.operation);
          if ((!selected?.query.operation && !self) || this.registry.operations[query.appId]?.[query.operation] !== 'read' || this.registry.operationDefinitions[query.appId][query.operation].mutation) throw businessError(403, 'FORBIDDEN');
          recheck(); const result = await this.executeInvocation(token, query, { projection: true, depth: depth + 1 }); recheck();
          const revision = result.revision; sourceReads.push({ appId: query.appId, spaceId: query.spaceId, resourceId: query.resourceId, ...(typeof revision === 'string' || typeof revision === 'number' ? { revision: String(revision) } : {}) }); return result;
        },
      });
      const prepared = await business.prepareInvocation?.(request, context) || {};
      if (!object(prepared) || Object.keys(prepared).some(key => !['request', 'assertion'].includes(key))) throw businessError(500, 'INVALID_APP_INTEGRATION');
      const adapterRequest = prepared.request ? boundRequest(request, prepared.request) : request, assertion = prepared.assertion || {};
      if (!object(assertion)) throw businessError(500, 'INVALID_APP_INTEGRATION');
      for (const [field, supplied] of Object.entries(assertion)) {
        if (!business.assertionFields?.includes(field)) throw businessError(500, 'INVALID_APP_INTEGRATION');
        const rule = business.assertionRules[field]; let actual;
        if (rule.kind === 'member-action') actual = rule.roles.includes(context.membershipRole) && context.hasAction(rule.action);
        if (rule.kind === 'subjects-read') actual = [...subjects.values()].every(Boolean);
        if (rule.kind === 'source-read') actual = context.sourceReadGranted;
        if (rule.kind === 'authorization-expiry') actual = context.authorizationExpiresAt;
        if (rule.kind === 'native-session') actual = context.firstPartyNative;
        if (supplied !== actual) throw businessError(403, 'FORBIDDEN');
      }
      recheck();
      if (sourceReads.length) traceStep({ stage: 'validation', status: 'succeeded', sources: sourceReads });
      traceStep({ stage: 'dispatch', status: 'started' });
      dispatched = true;
      const result = await this.callAdapter(request.appId, adapterRequest, scope, { requestId, assertion, actionsGranted }); committed = definition.mutation;
      const revision = result.revision ?? result.item?.revision ?? result.project?.revision;
      traceStep({ stage: committed ? 'commit' : 'readback', status: 'succeeded', ...(committed ? { committed: true } : {}), ...(typeof revision === 'string' || typeof revision === 'number' ? { revision: String(revision) } : {}) });
      if (!projection && (definition.mutation || traceSource !== 'web')) this.events?.audit({ requestId, userId: scope.userId, clientId: scope.clientId, grantId: scope.grantId, appId: request.appId, spaceId: request.spaceId, resourceId: request.resourceId, action, decision: 'allow' });
      if (definition.mutation) await this.harvest(request.appId, request.spaceId, request.resourceId).catch(() => {});
      try { recheck(); } catch (error) { if (committed) { error.code = 'AUTHORIZATION_CHANGED_AFTER_COMMIT'; error.committed = true; error.requestId = requestId; } throw error; }
      const projected = business.projectResult ? await business.projectResult(request, result, context) : result; recheck();
      finishTrace({ status: 'succeeded', ...(committed ? { committed: true } : {}) });
      return { ...projected, requestId, ...(traceId ? { traceId } : {}) };
    } catch (caught) {
      let error = caught;
      if (error.fieldErrors || error.currentRevision) { try { recheck(); } catch (permissionError) { error = permissionError; } }
      if (error.validUntil) await delay(Math.max(0, error.validUntil - this.clock()));
      if (committed) { error.committed = true; error.requestId = requestId; }
      if (!projection && !traceId && this.events?.beginTrace && definition.mutation) traceId = this.events.beginTrace({ requestId, appId: request.appId, operation: request.operation, action, userId: actor?.userId, clientId: actor?.clientId, grantId: actor?.grantId, source: source || 'http' });
      const outcome = { status: [401, 403].includes(error.status) ? 'denied' : error.code === 'OUTCOME_UNKNOWN' ? 'unknown' : 'failed', code: /^[A-Z][A-Z0-9_]{0,63}$/.test(error.code || '') ? error.code : 'REQUEST_FAILED', ...(committed ? { committed: true } : {}) };
      if (traceId) { traceStep({ ...outcome, stage: dispatched ? 'dispatch' : !authorized || [401, 403].includes(error.status) ? 'authorization' : 'validation', ...(!dispatched && sourceReads.length ? { sources: sourceReads } : {}) }); finishTrace(outcome); }
      const identity = scope || actor;
      if (!projection && (definition.mutation || traceSource !== 'web')) this.events?.audit({ requestId, userId: identity?.userId, clientId: identity?.clientId, grantId: identity?.grantId, appId: request.appId, spaceId: request.spaceId, resourceId: request.resourceId, action, decision: 'reject', code: error.code || 'REQUEST_FAILED' });
      throw error;
    }
  }
  async harvest(appId, spaceId, targetResourceId) {
    const descriptor = this.registry.getBusiness(appId)?.events;
    if (!this.events || !descriptor) return;
    const scope = () => ({ userId: 'system-events', clientId: 'business-service', grantId: 'event-recovery', resources: ['*'], expiresAt: this.clock() + 20_000 });
    if (descriptor.resourceListOperation) {
      const items = targetResourceId === undefined ? (await this.callAdapter(appId, { operation: descriptor.resourceListOperation, spaceId }, scope())).items : [{ resourceId: targetResourceId }];
      if (!Array.isArray(items) || items.length > 100 || items.some(item => !identifier(item.resourceId)) || new Set(items.map(item => item.resourceId)).size !== items.length) throw businessError(502, 'INVALID_APP_RESPONSE');
      for (const { resourceId } of items) {
        const after = this.events.sourceCursor(appId, spaceId, resourceId), result = await this.callAdapter(appId, { operation: descriptor.operation, spaceId, resourceId, input: { after } }, { ...scope(), resources: [resourceId] });
        if (result.resourceId !== resourceId || !Array.isArray(result.events)) throw businessError(502, 'INVALID_APP_RESPONSE'); this.events.ingest(appId, spaceId, result, { resourceId });
      }
    } else {
      const after = this.events.sourceCursor(appId, spaceId), result = await this.callAdapter(appId, { operation: descriptor.operation, spaceId, ...(descriptor.resourceId ? { resourceId: descriptor.resourceId } : {}), input: { after } }, scope());
      if (!Array.isArray(result.events)) throw businessError(502, 'INVALID_APP_RESPONSE'); this.events.ingest(appId, spaceId, result);
    }
  }
  workbenchContext(token, appId) {
    const session = this.auth.requireNativeSession(token);
    return Object.freeze({ actor: { userId: session.user.id, username: session.user.username }, items: operation => this.workbenchItems(token, appId, operation), read: request => {
      if (this.registry.operations[appId]?.[request.operation] !== 'read' || this.registry.operationDefinitions[appId][request.operation].mutation) throw businessError(403, 'FORBIDDEN');
      return this.invoke(token, { ...request, appId });
    } });
  }
  async workbenchAgenda(token, tagged = false) {
    const values = await Promise.all(this.registry.apps.flatMap(app => app.integration.business?.workbench?.agenda ? [Promise.resolve(app.integration.business.workbench.agenda(this.workbenchContext(token, app.integration.business.adapterId))).then(value => ({ ...value, appId: app.integration.business.adapterId }))] : []));
    return { items: values.flatMap(value => value.items.map(item => tagged ? { ...item, appId: value.appId } : item)), partial: values.some(value => value.partial) };
  }
  async workbenchAttention(token) {
    const agenda = await this.workbenchAgenda(token, true), values = await Promise.all(this.registry.apps.flatMap(app => app.integration.business?.workbench?.attention ? [Promise.resolve(app.integration.business.workbench.attention(this.workbenchContext(token, app.integration.business.adapterId))).then(value => ({ ...value, items: value.items.map(item => ({ ...item, appId: app.integration.business.adapterId })) }))] : []));
    const access = this.auth.getWebAccess(token), items = [...agenda.items, ...values.flatMap(value => value.items)].filter(item => {
      if (!access.apps.includes(this.registry.webId(item.appId))) return false;
      try { const resources = this.auth.authorize(token, { appId: item.appId, spaceId: item.spaceId, action: 'read' }, { auditDenied: false }).resources; return resources.includes('*') || resources.includes(item.resourceId); }
      catch (error) { if (error.status !== 403) throw error; return false; }
    });
    return { items, partial: agenda.partial || values.some(value => value.partial) };
  }
  async workbenchItems(token, appId, operation) {
    const empty = { spaces: [], partial: false }, webId = this.registry.webId(appId);
    if (!this.auth.getWebAccess(token).apps.includes(webId)) return empty;
    const { user } = this.auth.requireNativeSession(token), readableSpaces = this.auth.listSpaces(token).map(space => space.id).filter(spaceId => this.auth.appSpaceEnabled(appId, spaceId, this.apps) && this.auth.userPermissions(user.id, spaceId, appId, 'read').length > 0);
    const results = await Promise.allSettled(readableSpaces.map(spaceId => this.invoke(token, { appId, spaceId, operation })));
    if (!this.auth.getWebAccess(token).apps.includes(webId)) return empty;
    const spaces = []; let partial = false;
    for (const [index, result] of results.entries()) {
      const spaceId = readableSpaces[index];
      if (result.status === 'rejected') { if (result.reason?.status === 401) throw result.reason; if (result.reason?.status !== 403) partial = true; continue; }
      if (result.value.spaceId !== spaceId || !Array.isArray(result.value.items)) { partial = true; continue; }
      let resources; try { resources = this.auth.authorize(token, { appId, spaceId, action: 'read' }, { auditDenied: false }).resources; } catch (error) { if (error.status === 403) continue; throw error; }
      spaces.push({ spaceId, items: result.value.items.filter(item => resources.includes('*') || resources.includes(item.resourceId)) });
    }
    return { spaces, partial };
  }
  catalog(token) {
    return this.auth.listSpaces(token).map(space => ({ ...space, apps: Object.keys(this.apps).flatMap(appId => {
      if (!this.auth.appSpaceEnabled(appId, space.id, this.apps)) return [];
      const actions = this.registry.getBusiness(appId).actions.filter(action => { try { this.auth.authorize(token, { appId, spaceId: space.id, action }); return true; } catch { return false; } });
      return actions.length ? [{ id: appId, actions }] : [];
    }) })).filter(space => space.apps.length);
  }
}
