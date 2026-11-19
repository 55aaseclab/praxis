import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { chmodSync, closeSync, existsSync, lstatSync, mkdirSync, openSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const DAY = 86400000, APPLICATION_ID = 0x50584f42;
const workspace = resolve(fileURLToPath(new URL('../', import.meta.url)));
export const OBSERVATION_SCHEMA = Object.freeze({
  version: 1, retention_days: 30, max_rows: 50000,
  slow_page_ms: 3000, slow_business_ms: 1000,
  event_name: ['http_request', 'business_action', 'adapter_request', 'mcp_protocol', 'page_load', 'registry_load', 'app_open', 'page_error'],
  route_id: ['home', 'registry', 'prd_catalog', 'prd_document', 'legacy_redirect', 'static', 'other', 'business_ui', 'business_static', 'business_invoke', 'business_catalog', 'business_events', 'mcp', 'auth', 'oauth', 'health', 'browser_ingress', 'platform_status'],
  method: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'OTHER'],
  source: ['http', 'mcp', 'browser', 'system'],
  result: ['ok', 'invalid', 'unsupported', 'unauthenticated', 'forbidden', 'conflict', 'unavailable', 'outcome_unknown', 'cancelled'],
  reason_code: ['NONE', 'INVALID_INPUT', 'UNKNOWN_ROUTE', 'UNKNOWN_OPERATION', 'UNKNOWN_TOOL', 'UNSUPPORTED_CAPABILITY', 'UNAUTHENTICATED', 'FORBIDDEN', 'CONFLICT', 'APP_UNAVAILABLE', 'OUTCOME_UNKNOWN', 'REQUEST_FAILED', 'CLIENT_REPORTED', 'METHOD_NOT_ALLOWED', 'REQUEST_TOO_LARGE', 'RATE_LIMITED', 'ORIGIN_REJECTED', 'HOST_REJECTED', 'SDK_VALIDATION', 'STREAM_OPEN'],
  app_id: ['reminder', 'knowledge', 'lattice-slides', 'travel', 'tingproof', 'memo', 'projects', 'finance', 'intelligence', 'polaris', 'calendar', 'matrix-reader', 'other'],
  capability: ['read', 'create', 'update', 'complete', 'delete', 'search', 'share', 'import', 'export', 'stats', 'schedule', 'other'],
});
const pick = (key, value, fallback) => OBSERVATION_SCHEMA[key].includes(value) ? value : fallback;
export function canonicalizeObservation(fields) {
  if (!fields || typeof fields !== 'object' || Array.isArray(fields) || !OBSERVATION_SCHEMA.event_name.includes(fields.event_name)) return null;
  if (fields.duration_ms !== undefined && (!Number.isSafeInteger(fields.duration_ms) || fields.duration_ms < 0 || fields.duration_ms > DAY)) return null;
  return {
    event_name: fields.event_name, route_id: pick('route_id', fields.route_id, 'other'),
    method: pick('method', fields.method, 'OTHER'), source: pick('source', fields.source, 'system'),
    result: pick('result', fields.result, 'invalid'), reason_code: pick('reason_code', fields.reason_code, 'INVALID_INPUT'),
    app_id: pick('app_id', fields.app_id, 'other'), capability: pick('capability', fields.capability, 'other'),
    duration_ms: fields.duration_ms ?? null,
  };
}

const operations = Object.freeze({ list_topics: 'read', read_topic: 'read', set_guide: 'update', archive_guide: 'update', list: 'read', list_projects: 'read', find_references: 'read', list_libraries: 'read', read_library: 'read', create_library: 'create', set_collection: 'update', add_source: 'update', capture_project: 'update', read_source: 'read', set_entry: 'update', replace_document_text: 'update', insert_document_text: 'update', delete_document_text: 'update', import_paper_statistics: 'update', import_document: 'update', read_document: 'read', search_evidence: 'search', read_entry: 'read', search: 'search', read_project: 'read', create_project: 'create', update_project: 'update', set_work_item: 'update', set_reference: 'update', list_assignments: 'read', get_assignment: 'read', list_itineraries: 'read', read_itinerary: 'read', update_place_details: 'update', upsert_place: 'update', set_day_plan: 'update', set_budget_item: 'update', search_places: 'search', get_place: 'read', plan_route: 'read', query_travel_services: 'read', events: 'read', add: 'create', record: 'create', create_assignment: 'create', submit_corrections: 'update', revoke_assignment: 'delete' });
export function classifyCapability(appId, operation) {
  if (appId === 'slides') {
    const mapping = { get_capabilities: 'read', get_media_catalog: 'read', get_template: 'read', get_slot_guidance: 'read', list_decks: 'read', read_deck: 'read', create_deck: 'create', apply_edits: 'update', list_assets: 'read', create_upload: 'create', write_upload_chunk: 'update', finish_upload: 'update', import_asset: 'create', remove_asset: 'delete', preview: 'read', check: 'read', validate: 'read', lint: 'read', budget: 'read', prepare_audio: 'create', render_video: 'create', review: 'create', export: 'read', get_job: 'read', cancel_job: 'update', retry_job: 'create', get_artifact: 'read', list_revisions: 'read', restore_revision: 'update', set_content_lock: 'update', archive_deck: 'delete', get_links: 'read', events: 'read' };
    return { app_id: 'lattice-slides', capability: mapping[operation] || 'other' };
  }
  return { app_id: pick('app_id', appId, 'other'), capability: typeof operation === 'string' && Object.hasOwn(operations, operation) ? operations[operation] : pick('capability', operation, 'other') };
}
export function classifyTool(name) {
  if (typeof name === 'string' && name.startsWith('slides_')) return classifyCapability('slides', name.slice('slides_'.length));
  if (name === 'travel_search_services') return classifyCapability('travel', 'query_travel_services');
  for (const app of OBSERVATION_SCHEMA.app_id.filter(value => value !== 'other')) {
    for (const operation of [...Object.keys(operations), ...OBSERVATION_SCHEMA.capability.filter(value => value !== 'other')]) {
      if (name === `${app}_${operation}`) return classifyCapability(app, operation);
    }
  }
  return { app_id: 'other', capability: 'other' };
}
export function classifyOutcome(status, code) {
  if (code === 'OUTCOME_UNKNOWN' || code === 'AUTHORIZATION_CHANGED_AFTER_COMMIT') return { result: 'outcome_unknown', reason_code: 'OUTCOME_UNKNOWN' };
  if (status === 401) return { result: 'unauthenticated', reason_code: 'UNAUTHENTICATED' };
  if (status === 403) return { result: 'forbidden', reason_code: ['ORIGIN_REJECTED', 'HOST_REJECTED'].includes(code) ? code : 'FORBIDDEN' };
  if ([409, 412, 428].includes(status)) return { result: 'conflict', reason_code: 'CONFLICT' };
  if (status === 429) return { result: 'unavailable', reason_code: 'RATE_LIMITED' };
  if (status >= 500) return { result: 'unavailable', reason_code: code === 'APP_UNAVAILABLE' ? code : 'REQUEST_FAILED' };
  if (status === 405) return { result: 'invalid', reason_code: 'METHOD_NOT_ALLOWED' };
  if (status === 413) return { result: 'invalid', reason_code: 'REQUEST_TOO_LARGE' };
  if (status >= 400) return { result: 'invalid', reason_code: 'INVALID_INPUT' };
  return { result: 'ok', reason_code: 'NONE' };
}
export function routeId(path, surface = 'praxis') {
  if (path === '/health') return 'health';
  if (['/api/platform/status', '/api/platform/observations', '/api/business/console/status', '/api/business/console/observations'].includes(path)) return 'platform_status';
  if (surface === 'business') {
    if (['/', '/business', '/business/', '/business/reminder/', '/business/tingproof/'].includes(path)) return 'business_ui';
    if (['/reminder.js', '/tingproof.js', '/tingproof.css', '/app-transport.js', '/reminder-view.js', '/reminder-view-model.js', '/reminder-view.css'].includes(path)) return 'business_static';
    if (path === '/mcp') return 'mcp';
    if (path === '/api/business/invoke') return 'business_invoke';
    if (path === '/api/business/catalog') return 'business_catalog';
    if (path === '/api/business/events') return 'business_events';
    if (path.startsWith('/auth/')) return 'auth';
    if (path.startsWith('/oauth/') || path.startsWith('/.well-known/oauth-')) return 'oauth';
    return 'other';
  }
  if (path === '/') return 'home';
  if (path === '/api/apps') return 'registry';
  if (path === '/api/observations') return 'browser_ingress';
  if (path === '/prds/') return 'prd_catalog';
  if (path.startsWith('/prds/')) return 'prd_document';
  if (['/app.js', '/experience.js', '/platform.js', '/styles.css', '/praxis.svg'].includes(path) || /^\/[a-z-]+-icon\.svg$/.test(path)) return 'static';
  return 'other';
}

function safeFile(file, { readOnly = false } = {}) {
  if (typeof file !== 'string' || !isAbsolute(file) || resolve(file) !== file || /[\0\r\n]/.test(file) || file === workspace || file.startsWith(workspace + sep)) throw new Error('Unsafe observation location.');
  const directory = dirname(file);
  for (let cursor = directory; cursor !== dirname(cursor); cursor = dirname(cursor)) if (existsSync(join(cursor, '.git'))) throw new Error('Observation files must stay outside Git repositories.');
  if (!existsSync(directory) && !readOnly) mkdirSync(directory, { recursive: true, mode: 0o700 });
  if (realpathSync(directory) !== directory) throw new Error('Observation paths must be canonical.');
  const parent = lstatSync(directory);
  if (!parent.isDirectory() || parent.mode & 0o077 || typeof process.getuid === 'function' && parent.uid !== process.getuid()) throw new Error('Observation directory must be private.');
  if (!existsSync(file) && !readOnly) { try { closeSync(openSync(file, 'wx', 0o600)); } catch (error) { if (error.code !== 'EEXIST') throw error; } }
  const info = lstatSync(file);
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.mode & 0o077 || typeof process.getuid === 'function' && info.uid !== process.getuid()) throw new Error('Observation database must be private.');
  return info.size;
}

export class ObservationStore {
  constructor({ file, clock = () => Date.now(), readOnly = false } = {}) {
    this.clock = clock; this.state = file ? 'unavailable' : 'disabled'; this.db = null; this.readOnly = readOnly;
    if (!file) return;
    try {
      const size = safeFile(file, { readOnly });
      if (size) {
        const inspected = new DatabaseSync(file, { readOnly: true });
        try {
          inspected.exec('PRAGMA busy_timeout=250');
          const id = inspected.prepare('PRAGMA application_id').get().application_id;
          const empty = !readOnly && id === 0 && !inspected.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' LIMIT 1").get();
          if (id !== APPLICATION_ID && !empty) throw new Error('Unrecognized observation database.');
        }
        finally { inspected.close(); }
      }
      if (readOnly && !size) return;
      this.db = new DatabaseSync(file, { readOnly });
      if (!readOnly) {
        chmodSync(file, 0o600);
        this.db.exec(`PRAGMA busy_timeout=250; PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA max_page_count=16384; BEGIN IMMEDIATE; PRAGMA application_id=${APPLICATION_ID};
          CREATE TABLE IF NOT EXISTS observations(id INTEGER PRIMARY KEY AUTOINCREMENT,event_id TEXT NOT NULL UNIQUE,occurred_at INTEGER NOT NULL,event_name TEXT NOT NULL,route_id TEXT NOT NULL,method TEXT NOT NULL,source TEXT NOT NULL,result TEXT NOT NULL,reason_code TEXT NOT NULL,app_id TEXT NOT NULL,capability TEXT NOT NULL,duration_ms INTEGER);
          CREATE INDEX IF NOT EXISTS observations_time ON observations(occurred_at);
          CREATE TRIGGER IF NOT EXISTS observations_cap AFTER INSERT ON observations BEGIN DELETE FROM observations WHERE id<=NEW.id-${OBSERVATION_SCHEMA.max_rows}; END;`);
        this.db.prepare('DELETE FROM observations WHERE occurred_at<?').run(this.clock() - OBSERVATION_SCHEMA.retention_days * DAY);
        this.db.exec('COMMIT; PRAGMA busy_timeout=0;');
      } else this.db.exec('PRAGMA busy_timeout=0; PRAGMA query_only=ON;');
      this.state = 'ready';
    } catch { try { this.db?.close(); } catch {} this.db = null; }
  }
  record(fields) {
    const value = canonicalizeObservation(fields);
    if (!this.db || this.readOnly || !value) return false;
    try {
      const now = this.clock();
      if (!Number.isSafeInteger(now) || now < 0) return false;
      this.db.exec('BEGIN IMMEDIATE');
      this.db.prepare('DELETE FROM observations WHERE occurred_at<?').run(now - OBSERVATION_SCHEMA.retention_days * DAY);
      this.db.prepare('INSERT INTO observations(event_id,occurred_at,event_name,route_id,method,source,result,reason_code,app_id,capability,duration_ms) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(randomUUID(), now, ...Object.values(value));
      this.db.exec('COMMIT'); return true;
    } catch { try { this.db.exec('ROLLBACK'); } catch {} return false; }
  }
  report(window = 'day') {
    if (!['day', 'week'].includes(window)) throw new Error('Report window must be day or week.');
    const generated_at = new Date(this.clock()).toISOString();
    const output = { status: this.state, window, generated_at, retention_days: OBSERVATION_SCHEMA.retention_days, max_rows: OBSERVATION_SCHEMA.max_rows, http: [], protocol: [], business: [], adapters: [], browser: [], capability_candidates: [], excluded_system_events: 0 };
    if (!this.db) return output;
    try {
      const rows = this.db.prepare('SELECT event_name,route_id,method,source,result,reason_code,app_id,capability,duration_ms FROM observations WHERE occurred_at>=? AND occurred_at<=? ORDER BY id').all(this.clock() - (window === 'day' ? DAY : 7 * DAY), this.clock());
      output.status = rows.length ? 'ready' : 'empty';
      const groups = new Map();
      for (const row of rows) {
        if (row.source === 'system') { output.excluded_system_events++; continue; }
        const section = row.source === 'browser' ? 'browser' : row.event_name === 'business_action' ? 'business' : row.event_name === 'adapter_request' ? 'adapters' : row.event_name === 'mcp_protocol' ? 'protocol' : 'http';
        const key = JSON.stringify([section, row.event_name, row.route_id, row.app_id, row.capability]);
        if (!groups.has(key)) groups.set(key, { section, event_name: row.event_name, route_id: row.route_id, app_id: row.app_id, capability: row.capability, samples: 0, outcomes: {}, slow_samples: 0, durations: [] });
        const group = groups.get(key); group.samples++; group.outcomes[row.result] = (group.outcomes[row.result] || 0) + 1;
        if (Number.isSafeInteger(row.duration_ms)) {
          group.durations.push(row.duration_ms);
          if (row.duration_ms >= (section === 'business' || section === 'adapters' ? OBSERVATION_SCHEMA.slow_business_ms : OBSERVATION_SCHEMA.slow_page_ms)) group.slow_samples++;
        }
      }
      for (const group of groups.values()) {
        const { section, durations, ...rest } = group;
        durations.sort((a, b) => a - b);
        const quantile = p => durations.length ? durations[Math.max(0, Math.ceil(p * durations.length) - 1)] : null;
        const value = { ...rest, failure_samples: group.samples - (group.outcomes.ok || 0), p50_ms: quantile(0.5), p95_ms: quantile(0.95), ...(section === 'browser' ? { untrusted: true } : {}) };
        output[section].push(value);
        if (section === 'business' && group.outcomes.unsupported) output.capability_candidates.push({ app_id: group.app_id, capability: group.capability, samples: group.outcomes.unsupported, requires_review: true });
      }
      for (const section of ['http', 'protocol', 'business', 'adapters', 'browser']) output[section].sort((a, b) => b.slow_samples - a.slow_samples || (b.p95_ms ?? -1) - (a.p95_ms ?? -1) || b.failure_samples - a.failure_samples || JSON.stringify(a).localeCompare(JSON.stringify(b)));
      output.capability_candidates.sort((a, b) => b.samples - a.samples || a.app_id.localeCompare(b.app_id) || a.capability.localeCompare(b.capability));
      return output;
    } catch { return { ...output, status: 'unavailable' }; }
  }
  close() { try { this.db?.close(); } catch {} this.db = null; }
}

export function browserObservation(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => !['event_name', 'duration_ms', 'app_id'].includes(key)) || !['page_load', 'registry_load', 'app_open', 'page_error'].includes(body.event_name)) return null;
  if (body.app_id !== undefined && !OBSERVATION_SCHEMA.app_id.includes(body.app_id)) return null;
  if (body.duration_ms !== undefined && (!Number.isSafeInteger(body.duration_ms) || body.duration_ms < 0 || body.duration_ms > 600000)) return null;
  return canonicalizeObservation({ ...body, route_id: 'home', method: 'POST', source: 'browser', result: body.event_name === 'page_error' ? 'invalid' : 'ok', reason_code: 'CLIENT_REPORTED' });
}

export function recordObservation(store, fields) { try { return store?.record(fields) === true; } catch { return false; } }

export function createBrowserIngress({ store, clock = () => Date.now(), limit = 120, origin: configuredOrigin } = {}) {
  let count = 0, started = clock();
  let fixedOrigin, invalidOrigin = false;
  if (configuredOrigin) {
    try {
      const url = new URL(configuredOrigin);
      if (url.origin !== configuredOrigin || url.username || url.password || !['https:', 'http:'].includes(url.protocol) || url.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw new Error('Invalid observation origin.');
      fixedOrigin = url.origin;
    } catch { invalidOrigin = true; }
  }
  return async (request, response) => {
    const reply = status => { if (response.destroyed || response.headersSent) return; response.writeHead(status, { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); response.end(); };
    try {
      const origin = new URL(request.headers.origin);
      if (invalidOrigin || !['http:', 'https:'].includes(origin.protocol) || origin.origin !== request.headers.origin || (fixedOrigin ? origin.origin !== fixedOrigin : origin.host !== request.headers.host) || request.headers['sec-fetch-site'] && request.headers['sec-fetch-site'] !== 'same-origin') return reply(403);
    } catch { return reply(403); }
    if (request.method !== 'POST' || !/^application\/json(?:\s*;|$)/i.test(request.headers['content-type'] || '')) return reply(400);
    const now = clock(); if (now < started || now - started >= 60000) { started = now; count = 0; }
    if (++count > limit) return reply(429);
    try {
      const raw = await new Promise((accept, reject) => {
        let size = 0; const chunks = [];
        const cleanup = () => { clearTimeout(timer); request.removeListener('data', data); request.removeListener('end', end); request.removeListener('error', error); request.removeListener('aborted', error); request.removeListener('close', error); };
        const error = () => { cleanup(); request.resume(); request.once('error', () => {}); if (!response.destroyed && !response.headersSent) response.setHeader('Connection', 'close'); response.once('finish', () => { if (!request.complete) request.destroy(); }); reject(new Error('Invalid browser event.')); };
        const data = chunk => { size += chunk.length; if (size > 1024) error(); else chunks.push(chunk); };
        const end = () => { cleanup(); accept(Buffer.concat(chunks).toString('utf8')); };
        const timer = setTimeout(error, 2000);
        request.on('data', data); request.once('end', end); request.once('error', error); request.once('aborted', error); request.once('close', error);
      });
      const value = browserObservation(JSON.parse(raw));
      if (!value) return reply(400);
      recordObservation(store, value); return reply(204);
    } catch { return reply(400); }
  };
}

export function observeResponse(store, request, response, surface = 'praxis') {
  const started = performance.now(); let route = 'other', emitted = false;
  try { route = routeId(new URL(request.url, 'http://observation.invalid').pathname, surface); } catch {}
  const source = ['health', 'business_catalog', 'business_events', 'browser_ingress', 'platform_status'].includes(route) ? 'system' : 'http';
  const emit = (aborted = false) => { if (emitted) return; emitted = true; recordObservation(store, { event_name: route === 'mcp' ? 'mcp_protocol' : 'http_request', route_id: route, method: request.method, source, duration_ms: Math.max(0, Math.round(performance.now() - started)), ...(aborted ? { result: 'cancelled', reason_code: 'REQUEST_FAILED' } : classifyOutcome(response.statusCode)) }); };
  response.once('finish', () => emit());
  response.once('close', () => emit(!response.writableFinished));
  return { openStream() { emit(); } };
}
