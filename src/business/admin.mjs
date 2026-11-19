import { credentialFromRequest, WEB_APP_IDS } from './auth.mjs';

const PREFIX = '/api/business/admin';
const MAX_BYTES = 16 * 1024;
const invalid = (status = 400, code = 'INVALID_INPUT') => Object.assign(new Error('Administration request rejected.'), { status, code });
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function fields(value, allowed, required = allowed) {
  if (!object(value) || Object.keys(value).some(key => !allowed.includes(key)) || required.some(key => !Object.hasOwn(value, key))) throw invalid();
  return value;
}
function identifier(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 200 || /[\/\\\x00-\x1f\x7f]/.test(value) || ['.', '..'].includes(value)) throw invalid();
  return value;
}
function page(parameters) {
  if ([...parameters.keys()].some(key => !['limit', 'after'].includes(key)) || parameters.getAll('limit').length > 1 || parameters.getAll('after').length > 1) throw invalid();
  const raw = parameters.get('limit') ?? '50';
  if (!/^[1-9]\d?$|^100$/.test(raw)) throw invalid();
  return { limit: Number(raw), after: parameters.has('after') ? identifier(parameters.get('after')) : '' };
}
function emptyQuery(parameters) { if (parameters.size) throw invalid(); }
function send(response, status, value, headers = {}) {
  let body = JSON.stringify(value);
  if (Buffer.byteLength(body) > 128 * 1024) { status = 503; body = JSON.stringify({ code: 'UNAVAILABLE' }); }
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body), 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin', Vary: 'Cookie, Origin', ...headers });
  response.end(body);
}
async function readBody(request) {
  if (!/^application\/json(?:;|$)/i.test(request.headers['content-type'] || '')) throw invalid(415, 'UNSUPPORTED_MEDIA_TYPE');
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0, settled = false;
    const cleanup = () => { clearTimeout(timer); request.removeListener('data', data); request.removeListener('end', end); request.removeListener('aborted', aborted); request.removeListener('error', aborted); };
    const finish = (error, value) => {
      if (settled) return;
      settled = true; cleanup();
      if (error) {
        const absorbError = () => {};
        request.once('error', absorbError);
        request.once('close', () => request.removeListener('error', absorbError));
        reject(error);
      } else resolve(value);
    };
    const aborted = () => finish(invalid());
    const data = chunk => { size += chunk.length; if (size > MAX_BYTES) { request.resume(); finish(invalid(413, 'BODY_TOO_LARGE')); } else chunks.push(chunk); };
    const end = () => { try { finish(null, JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { finish(invalid()); } };
    const timer = setTimeout(() => { request.resume(); finish(invalid()); }, 2000); timer.unref();
    request.on('data', data); request.once('end', end); request.once('aborted', aborted); request.once('error', aborted);
    if (request.aborted || request.destroyed) aborted();
  });
}
function user(auth, id) {
  const row = auth.db.prepare('SELECT id,username,enabled FROM auth_users WHERE id=?').get(id);
  if (!row) throw invalid(404, 'NOT_FOUND');
  return { id: row.id, username: row.username, enabled: Boolean(row.enabled), platformAdmin: auth.isPlatformAdmin(row.id) };
}
function webAccess(auth, userId) {
  user(auth, userId);
  if (auth.isPlatformAdmin(userId)) return { userId, configured: true, apps: [...WEB_APP_IDS], workbench: true, prds: true, expiresAt: null, source: 'administrator' };
  const policy = auth.getWebEntryPolicy(userId);
  if (!policy) return { userId, configured: false, apps: [], workbench: true, prds: false, expiresAt: null };
  return { userId, configured: true, ...policy, workbench: true };
}
function scopes(rules) {
  const groups = new Map();
  for (const rule of rules) {
    if (!object(rule) || typeof rule.appId !== 'string' || !Array.isArray(rule.actions) || !Array.isArray(rule.resources)) throw invalid(503, 'UNAVAILABLE');
    if (!groups.has(rule.appId)) groups.set(rule.appId, { actions: new Set(), spaces: new Set(), resources: new Set(), allResources: false });
    const group = groups.get(rule.appId); group.spaces.add(rule.spaceId);
    for (const action of rule.actions) group.actions.add(action);
    for (const resource of rule.resources) {
      if (resource === '*') group.allResources = true;
      else group.resources.add(JSON.stringify([rule.spaceId, resource]));
    }
  }
  return [...groups].sort(([left], [right]) => left.localeCompare(right)).map(([appId, group]) => ({ appId, actions: [...group.actions].sort(), spaceCount: group.spaces.size, resourceCount: group.allResources ? null : group.resources.size, allResources: group.allResources }));
}

export function requireAccountSession(request, { auth }) {
  if (request.headers.authorization !== undefined) throw invalid(401, 'UNAUTHENTICATED');
  if (request.headers.origin && request.headers.origin !== auth.issuer || request.headers['sec-fetch-site'] && !['same-origin', 'none'].includes(request.headers['sec-fetch-site'])) throw invalid(403, 'ORIGIN_REJECTED');
  return auth.requireNativeSession(credentialFromRequest(request));
}

export function createAccountHandler({ auth } = {}) {
  const prefix = '/api/business/account';
  return async (request, response) => {
    const url = new URL(request.url, auth.issuer);
    if (url.pathname !== prefix && !url.pathname.startsWith(`${prefix}/`)) return false;
    try {
      requireAccountSession(request, { auth });
      const token = credentialFromRequest(request), raw = request.url.split('?', 1)[0];
      if (!raw.startsWith(`${prefix}/`) || /[\\\x00-\x20\x7f]/.test(raw) || raw.includes('//') || /%(?:2f|5c|25)/i.test(raw)) throw invalid(404, 'NOT_FOUND');
      const path = raw.slice(prefix.length), match = /^\/grants\/([^/]+)$/.exec(path);
      if (request.method === 'GET' && path === '/session') {
        emptyQuery(url.searchParams);
        const session = requireAccountSession(request, { auth }), access = auth.accountAccess(token);
        const platformAdmin = auth.isPlatformAdmin(session.user.id);
        requireAccountSession(request, { auth });
        send(response, 200, { user: session.user, platformAdmin, csrfToken: session.csrfToken, expiresAt: session.expiresAt, ...access });
      } else if (request.method === 'GET' && path === '/grants') {
        const { limit, after } = page(url.searchParams), session = requireAccountSession(request, { auth });
        const rows = auth.db.prepare("SELECT g.*,c.name AS client_name FROM auth_grants g JOIN auth_clients c ON c.id=g.client_id WHERE g.user_id=? AND g.client_id<>'praxis-browser' AND g.id>? ORDER BY g.id LIMIT ?").all(session.user.id, after, limit + 1);
        const canonical = rules => [...new Set(rules.flatMap(rule => rule.actions.map(action => JSON.stringify([rule.appId, rule.spaceId, action, [...rule.resources].sort()]))))].sort();
        const grants = rows.slice(0, limit).map(row => {
          const original = JSON.parse(row.rules), effective = auth.effectiveRules(session.user.id, original), reduced = JSON.stringify(canonical(original)) !== JSON.stringify(canonical(effective));
          const status = row.revoked_at !== null ? 'revoked' : row.expires_at <= auth.clock() ? 'expired' : !effective.length || reduced ? 'restricted' : 'current';
          return { id: row.id, client: { id: row.client_id, name: row.client_name }, expiresAt: row.expires_at, revokedAt: row.revoked_at, status, scopes: scopes(['expired', 'revoked'].includes(status) ? original : effective) };
        });
        requireAccountSession(request, { auth });
        send(response, 200, { grants, nextCursor: rows.length > limit ? rows[limit - 1].id : null });
      } else if (request.method === 'DELETE' && match) {
        emptyQuery(url.searchParams); auth.requireRequestCsrf(request);
        const id = identifier(decodeURIComponent(match[1]));
        auth.controlTransaction(() => {
          const session = requireAccountSession(request, { auth });
          if (!auth.db.prepare("SELECT 1 FROM auth_grants WHERE id=? AND user_id=? AND client_id<>'praxis-browser'").get(id, session.user.id)) throw invalid(404, 'NOT_FOUND');
          auth.revokeGrant(id);
          auth.audit({ event: 'account.grant.revoked', userId: session.user.id, clientId: session.clientId, grantId: id, outcome: 'allowed' });
        });
        send(response, 200, { revoked: true });
      } else throw invalid(404, 'NOT_FOUND');
    } catch (error) {
      const status = [400, 401, 403, 404, 405, 503].includes(error.status) ? error.status : 500;
      const known = new Set(['INVALID_INPUT', 'UNAUTHENTICATED', 'FORBIDDEN', 'NOT_FOUND', 'CSRF_REJECTED', 'ORIGIN_REJECTED', 'POLICY_BUSY', 'UNAVAILABLE']);
      send(response, status, { code: known.has(error.code) ? error.code : 'UNAVAILABLE', ...(status === 401 ? { loginUrl: `${auth.issuer}/auth/login?return_to=%2Fadmin%2F` } : {}) });
    }
    return true;
  };
}

export function createAdminHandler({ auth } = {}) {
  if (!auth || typeof auth.requirePlatformAdminSession !== 'function') throw new Error('Administration requires an auth store.');
  return async (request, response) => {
    const url = new URL(request.url, auth.issuer);
    if (url.pathname !== PREFIX && !url.pathname.startsWith(`${PREFIX}/`)) return false;
    let session;
    try {
      if (request.headers.authorization !== undefined) throw invalid(401, 'UNAUTHENTICATED');
      const token = credentialFromRequest(request);
      session = auth.requirePlatformAdminSession(token);
      if (request.headers.origin && request.headers.origin !== auth.issuer || request.headers['sec-fetch-site'] && !['same-origin', 'none'].includes(request.headers['sec-fetch-site'])) throw invalid(403, 'FORBIDDEN');
      const raw = request.url.split('?', 1)[0];
      if (!raw.startsWith(`${PREFIX}/`) || /[\\\x00-\x20\x7f]/.test(raw) || raw.includes('//') || /%(?:2f|5c|25)/i.test(raw)) throw invalid(404, 'NOT_FOUND');
      const path = raw.slice(PREFIX.length);
      const match = /^\/users\/([^/]+)(?:\/(password|platform-admin|web-access|grants))?$/.exec(path);
      const grantMatch = /^\/grants\/([^/]+)$/.exec(path);
      const targetId = match ? identifier(decodeURIComponent(match[1])) : null;
      if (!['GET', 'POST', 'PATCH', 'PUT', 'DELETE'].includes(request.method)) throw invalid(405, 'METHOD_NOT_ALLOWED');
      const writing = request.method !== 'GET';
      if (writing) auth.requireRequestCsrf(request);
      const body = writing && request.method !== 'DELETE' ? await readBody(request) : undefined;
      const result = auth.withAdminSession(token, actor => {
        if (path === '/session' && request.method === 'GET') {
          emptyQuery(url.searchParams);
          return { status: 200, value: { user: actor.user, platformAdmin: true, csrfToken: actor.csrfToken, expiresAt: actor.expiresAt } };
        }
        if (path === '/users' && request.method === 'GET') {
          const { limit, after } = page(url.searchParams);
          const rows = auth.db.prepare('SELECT id FROM auth_users WHERE id>? ORDER BY id LIMIT ?').all(after, limit + 1);
          return { status: 200, value: { users: rows.slice(0, limit).map(row => user(auth, row.id)), nextCursor: rows.length > limit ? rows[limit - 1].id : null } };
        }
        if (path === '/users' && request.method === 'POST') {
          emptyQuery(url.searchParams); fields(body, ['username', 'password']);
          const created = auth.createUser(body);
          auth.auditControl('user.created', created.id); auth.changed({ type: 'user', userId: created.id });
          return { status: 201, value: { user: user(auth, created.id) } };
        }
        if (match) {
          const action = match[2];
          if (action !== 'grants') emptyQuery(url.searchParams);
          user(auth, targetId);
          if (!action && request.method === 'PATCH') {
            fields(body, ['enabled']); auth.setUserEnabled(targetId, body.enabled);
            return { status: 200, value: { user: user(auth, targetId), sessionInvalidated: targetId === actor.user.id && body.enabled === false } };
          }
          if (action === 'password' && request.method === 'POST') {
            fields(body, ['password']); auth.resetPassword({ userId: targetId, password: body.password });
            return { status: 200, value: { reset: true, sessionInvalidated: targetId === actor.user.id } };
          }
          if (action === 'platform-admin' && request.method === 'PUT') {
            fields(body, ['enabled']); auth.setPlatformAdmin({ userId: targetId, enabled: body.enabled });
            return { status: 200, value: { user: user(auth, targetId), sessionInvalidated: targetId === actor.user.id && body.enabled === false } };
          }
          if (action === 'web-access' && request.method === 'GET') return { status: 200, value: { webAccess: webAccess(auth, targetId) } };
          if (action === 'web-access' && request.method === 'PUT') {
            if (auth.isPlatformAdmin(targetId)) throw invalid(409, 'ADMIN_DEFAULT_ACCESS');
            fields(body, ['apps', 'workbench', 'prds', 'expiresAt'], ['apps', 'prds', 'expiresAt']); auth.setWebAccess({ ...body, userId: targetId });
            return { status: 200, value: { webAccess: webAccess(auth, targetId) } };
          }
          if (action === 'grants' && request.method === 'GET') {
            const { limit, after } = page(url.searchParams);
            const rows = auth.db.prepare('SELECT g.id,g.rules,g.expires_at,g.revoked_at,c.id AS client_id,c.name AS client_name FROM auth_grants g JOIN auth_clients c ON c.id=g.client_id WHERE g.user_id=? AND g.id>? ORDER BY g.id LIMIT ?').all(targetId, after, limit + 1);
            return { status: 200, value: { grants: rows.slice(0, limit).map(row => ({ id: row.id, client: { id: row.client_id, name: row.client_name }, expiresAt: row.expires_at, revokedAt: row.revoked_at, scopes: scopes(JSON.parse(row.rules)) })), nextCursor: rows.length > limit ? rows[limit - 1].id : null } };
          }
        }
        if (grantMatch && request.method === 'DELETE') {
          emptyQuery(url.searchParams);
          const grantId = identifier(decodeURIComponent(grantMatch[1]));
          if (!auth.db.prepare('SELECT 1 FROM auth_grants WHERE id=?').get(grantId)) throw invalid(404, 'NOT_FOUND');
          auth.revokeGrant(grantId);
          auth.audit({ event: 'platform.grant.revoked', userId: actor.user.id, clientId: actor.clientId, grantId, outcome: 'allowed' });
          return { status: 200, value: { revoked: true } };
        }
        throw invalid(404, 'NOT_FOUND');
      });
      if (!writing) auth.requirePlatformAdminSession(token);
      send(response, result.status, result.value);
    } catch (error) {
      const status = [400, 401, 403, 404, 405, 409, 413, 415, 503].includes(error.status) ? error.status : 500;
      const known = new Set(['INVALID_INPUT', 'UNAUTHENTICATED', 'FORBIDDEN', 'NOT_FOUND', 'METHOD_NOT_ALLOWED', 'CONFLICT', 'LAST_ADMIN_REQUIRED', 'ADMIN_DEFAULT_ACCESS', 'POLICY_BUSY', 'BODY_TOO_LARGE', 'UNSUPPORTED_MEDIA_TYPE', 'CSRF_REJECTED', 'ORIGIN_REJECTED', 'UNAVAILABLE']);
      const code = known.has(error.code) ? error.code : status === 500 ? 'INTERNAL_ERROR' : 'INVALID_INPUT';
      try { auth.audit({ event: 'platform.admin.denied', userId: session?.user.id, clientId: session?.clientId, outcome: 'denied', reason: code }); } catch {}
      if (!response.destroyed) send(response, status, { code, ...(status === 401 ? { loginUrl: `${auth.issuer}/auth/login?return_to=%2Fadmin%2F` } : {}) }, status === 405 ? { Allow: 'GET, POST, PATCH, PUT, DELETE' } : {});
    }
    return true;
  };
}
