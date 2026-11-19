import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';
import { SESSION_COOKIE } from './auth.mjs';
import { validateStorageProjection } from '../storage/status.mjs';
import { readDataInventory } from './data-inventory.mjs';

const MAX_BYTES = 128 * 1024, MAX_STORAGE_BYTES = 64 * 1024, FRESH_MS = 90000;
const APPS = Object.freeze([
  { id: 'reminder', name: 'Reminder', port: 4322 }, { id: 'knowledge', name: 'Knowledge', port: 4324 },
  { id: 'lattice-slides', name: 'Lattice', port: 4666 }, { id: 'travel', name: 'Travel', port: 4323 },
  { id: 'tingproof', name: '听校', port: 5173 }, { id: 'memo', name: 'Memo', port: 4325 },
  { id: 'projects', name: 'Projects', port: 4327 }, { id: 'finance', name: 'Finance', port: 4329 }, { id: 'intelligence', name: 'Intelligence', port: 4330 },
]);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const keys = (value, allowed) => object(value) && Object.keys(value).every(key => allowed.includes(key));
const iso = value => new Date(value).toISOString();

export function validateConsoleConfig(value) {
  if (value === undefined) return;
  if (!keys(value, ['storageStatusFile', 'storageConfigFile', 'dataInventoryFile'])) throw new Error('Invalid console configuration.');
  for (const file of [value.storageStatusFile, value.storageConfigFile, value.dataInventoryFile]) {
    if (file !== undefined && (typeof file !== 'string' || !isAbsolute(file) || resolve(file) !== file || /[\0\r\n]/.test(file))) throw new Error('Invalid console status path.');
  }
}

export const validStorageProjection = validateStorageProjection;

const unknownStorage = (state = 'unknown', generatedAt = null, freshUntil = null) => ({ state, schemaVersion: 1, generatedAt, freshUntil, writer: 'unknown', working: { mode: 'unknown', configuredSources: { json: null, sqlite: null, directory: null } }, local: { state: 'unknown', lastSuccessAt: null, lastVerifiedAt: null }, targets: [], worker: { state: 'unknown', heartbeatAt: null, lastResultAt: null, lastResult: 'unknown', configCurrent: null }, coverage: { state: 'unknown', browserData: 'requires-export', omissions: ['browser-export', 'original-audio', 'key-materials'] } });
export async function readStorageStatus(file, now = Date.now()) {
  if (!file) return unknownStorage();
  let handle;
  try {
    if (!isAbsolute(file) || resolve(file) !== file || await realpath(dirname(file)) !== dirname(file)) return unknownStorage();
    const parent = await lstat(dirname(file));
    if (!parent.isDirectory() || parent.mode & 0o077 || typeof process.getuid === 'function' && parent.uid !== process.getuid()) return unknownStorage();
    handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
    const info = await handle.stat();
    if (!info.isFile() || info.nlink !== 1 || info.mode & 0o077 || info.size > MAX_STORAGE_BYTES || typeof process.getuid === 'function' && info.uid !== process.getuid()) return unknownStorage();
    const bytes = Buffer.alloc(MAX_STORAGE_BYTES + 1);
    const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
    if (bytesRead > MAX_STORAGE_BYTES) return unknownStorage();
    const value = JSON.parse(bytes.subarray(0, bytesRead).toString('utf8'));
    if (!validStorageProjection(value, now)) return unknownStorage();
    const at = Date.parse(value.generatedAt), until = Date.parse(value.freshUntil);
    if (at > now + 5000 || until <= at || until > at + FRESH_MS) return unknownStorage();
    if (now - at > FRESH_MS || until <= now) return { ...value, state: 'stale', writer: 'unknown', local: { ...value.local, state: 'unknown' }, targets: value.targets.map(target => ({ ...target, state: 'unknown' })), worker: { ...value.worker, state: 'stale' } };
    return { state: 'ready', ...value };
  } catch { return unknownStorage(); }
  finally { await handle?.close().catch(() => {}); }
}

function sessionCredential(request) {
  if (request.headers.authorization !== undefined) throw Object.assign(new Error('Browser login is required.'), { status: 401 });
  const cookie = request.headers.cookie;
  const matches = typeof cookie === 'string' ? cookie.split(';').map(value => value.trim()).filter(value => value.startsWith(`${SESSION_COOKIE}=`)) : [];
  if (matches.length !== 1) throw Object.assign(new Error('Browser login is required.'), { status: 401 });
  try { return decodeURIComponent(matches[0].slice(SESSION_COOKIE.length + 1)); }
  catch { throw Object.assign(new Error('Browser login is required.'), { status: 401 }); }
}

export function requireConsoleAdmin(request, { auth, config }) {
  const token = sessionCredential(request);
  if (request.headers.origin && request.headers.origin !== config.issuer || request.headers['sec-fetch-site'] && !['same-origin', 'none'].includes(request.headers['sec-fetch-site'])) throw Object.assign(new Error('The browser request origin is not allowed.'), { status: 403, code: 'ORIGIN_REJECTED' });
  return { ...auth.requirePlatformAdminSession(token), platformAdmin: true };
}

export function createConsoleHandler({ auth, config, events, observations, fetchImpl = fetch, clock = () => Date.now(), readInventory = readDataInventory }) {
  const cache = new Map(), pending = new Map();
  const requireAdmin = request => requireConsoleAdmin(request, { auth, config });
  async function probe(app) {
    const previous = cache.get(app.id), now = clock();
    if (previous && now >= previous.at && now - previous.at < 30000) return previous.value;
    if (pending.has(app.id)) return pending.get(app.id);
    const operation = (async () => {
      let state = 'unavailable';
      try {
        const response = await fetchImpl(`http://127.0.0.1:${app.port}/`, { method: 'HEAD', redirect: 'manual', signal: AbortSignal.timeout(750) });
        state = response.status >= 200 && response.status < 400 ? 'reachable' : [401, 403].includes(response.status) ? 'restricted' : response.status < 500 ? 'unknown' : 'unavailable';
        await response.body?.cancel();
      } catch {}
      const at = clock(), value = { state, checkedAt: iso(at) };
      cache.set(app.id, { at, value }); return value;
    })();
    pending.set(app.id, operation);
    try { return await operation; } finally { pending.delete(app.id); }
  }
  function mcpActivity(appId) {
    try {
      if (!observations?.db || observations.state !== 'ready') return { activity: 'unknown', lastObservedAt: null };
      const row = observations.db.prepare("SELECT MAX(occurred_at) AS at FROM observations WHERE event_name='business_action' AND source='mcp' AND route_id='mcp' AND app_id=? AND result='ok' AND occurred_at>=? AND occurred_at<=?").get(appId, clock() - 7 * 86400000, clock());
      return row.at === null ? { activity: 'not_observed', lastObservedAt: null } : { activity: 'observed', lastObservedAt: iso(row.at) };
    } catch { return { activity: 'unknown', lastObservedAt: null }; }
  }
  function permissions(session, now) {
    try {
      const count = (sql, ...args) => auth.db.prepare(sql).get(...args).count;
      return { state: 'ready', observedAt: iso(now), freshUntil: iso(now + FRESH_MS), platformAdmin: true,
        spaces: count('SELECT COUNT(*) AS count FROM auth_members WHERE user_id=?', session.user.id),
        resourcePermissions: count('SELECT COUNT(*) AS count FROM auth_resources r WHERE user_id=? AND (expires_at IS NULL OR expires_at>?) AND (membership_required=0 OR EXISTS(SELECT 1 FROM auth_members m WHERE m.space_id=r.space_id AND m.user_id=r.user_id))', session.user.id, now),
        activeGrants: count('SELECT COUNT(*) AS count FROM auth_grants WHERE user_id=? AND revoked_at IS NULL AND expires_at>?', session.user.id, now),
        revokedGrants: count('SELECT COUNT(*) AS count FROM auth_grants WHERE user_id=? AND revoked_at IS NOT NULL', session.user.id),
        managedApps: APPS.filter(app => config.apps[app.id]?.managed === true).length,
        unmanagedApps: APPS.filter(app => config.apps[app.id]?.managed !== true).length,
      };
    } catch { return { state: 'unknown', observedAt: iso(now), freshUntil: iso(now + FRESH_MS), platformAdmin: true }; }
  }
  function queue(storage) {
    try {
      const value = events.status(), worker = storage.worker;
      const freshWorker = worker?.state === 'fresh' && worker.configCurrent === true && typeof worker.heartbeatAt === 'string' && Date.parse(worker.heartbeatAt) <= clock() + 5000 && clock() - Date.parse(worker.heartbeatAt) <= FRESH_MS;
      return { state: freshWorker && value.generation > value.completed && value.leaseUntil > clock() ? 'processing' : ['pending', 'retry', 'synced', 'idle'].includes(value.state) ? value.state : 'unknown' };
    }
    catch { return { state: 'unknown' }; }
  }
  function reply(response, status, value, headers = {}) {
    let body = JSON.stringify(value);
    if (Buffer.byteLength(body) > MAX_BYTES) { status = 503; body = '{"code":"CONSOLE_UNAVAILABLE"}'; }
    response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers }); response.end(body);
  }
  return async (request, response) => {
    const url = new URL(request.url, config.issuer);
    if (!['/api/business/console/status', '/api/business/console/observations', '/api/business/console/data'].includes(url.pathname)) return false;
    try {
      const session = requireAdmin(request);
      if (request.method !== 'GET') { reply(response, 405, { code: 'METHOD_NOT_ALLOWED' }, { Allow: 'GET' }); return true; }
      if (url.pathname.endsWith('/data')) {
        if (url.search) { reply(response, 400, { code: 'INVALID_REQUEST' }); return true; }
        const inventory = await readInventory(config.console?.dataInventoryFile);
        requireAdmin(request); reply(response, 200, inventory); return true;
      }
      if (url.pathname.endsWith('/observations')) {
        const window = url.searchParams.get('window') || 'day';
        if (!['day', 'week'].includes(window) || [...url.searchParams.keys()].some(key => key !== 'window') || url.searchParams.getAll('window').length > 1) { reply(response, 400, { code: 'INVALID_WINDOW' }); return true; }
        const report = observations.report(window); let truncated = false;
        for (const key of ['http', 'protocol', 'business', 'adapters', 'browser', 'capability_candidates']) if (report[key].length > 30) { report[key] = report[key].slice(0, 30); truncated = true; }
        requireAdmin(request); reply(response, 200, { ...report, truncated }); return true;
      }
      if (url.search) { reply(response, 400, { code: 'INVALID_REQUEST' }); return true; }
      const now = clock();
      const permissionState = permissions(session, now);
      const apps = await Promise.all(APPS.map(async app => ({ id: app.id, name: app.name, service: await probe(app), business: { state: config.apps[app.id] ? 'configured' : 'not_configured', mode: config.apps[app.id]?.managed === true ? 'managed' : config.apps[app.id]?.managed === false ? 'standalone' : 'unknown' }, mcp: { state: config.apps[app.id] ? 'configured' : 'not_configured', ...mcpActivity(app.id) } })));
      const storage = await readStorageStatus(config.console?.storageStatusFile, clock());
      requireAdmin(request);
      const generatedAt = iso(clock());
      reply(response, 200, { schemaVersion: 1, generatedAt, sections: { permissions: permissionState, connections: { state: apps.every(app => ['reachable', 'restricted'].includes(app.service.state)) ? 'ready' : 'mixed', observedAt: generatedAt, freshUntil: iso(clock() + FRESH_MS), apps }, storage: { ...storage, queue: queue(storage) } } });
    } catch (error) {
      if (error.status === 401) reply(response, 401, { code: 'UNAUTHENTICATED', loginUrl: `${config.issuer}/auth/login?return_to=%2Fadmin%2F` });
      else if (error.status === 403) reply(response, 403, { code: 'CONSOLE_FORBIDDEN' });
      else if (error.code === 'DATA_INVENTORY_UNAVAILABLE') reply(response, 503, { code: 'DATA_INVENTORY_UNAVAILABLE' });
      else reply(response, 503, { code: 'CONSOLE_UNAVAILABLE' });
    }
    return true;
  };
}
