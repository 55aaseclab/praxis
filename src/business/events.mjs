import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID, randomBytes, createHmac } from 'node:crypto';

const TRACE_STAGES = new Set(['authorization', 'dispatch', 'commit', 'readback', 'result']);
const TRACE_STATUSES = new Set(['started', 'allowed', 'denied', 'succeeded', 'failed', 'unknown']);
const TRACE_FINAL_STATUSES = new Set(['succeeded', 'denied', 'failed', 'unknown']);
const traceObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const traceIdValue = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/.test(value);
const traceFields = (value, fields) => traceObject(value) && Object.keys(value).every(key => fields.includes(key));
function traceAssert(value) { if (!value) throw new Error('Invalid business trace metadata.'); }
function traceReference(value) {
  traceAssert(traceFields(value, ['appId', 'spaceId', 'resourceId', 'revision']));
  for (const key of ['appId', 'spaceId', 'resourceId']) traceAssert(traceIdValue(value[key]));
  if (value.revision !== undefined) traceAssert(traceIdValue(String(value.revision)));
  return { appId: value.appId, spaceId: value.spaceId, resourceId: value.resourceId, ...(value.revision !== undefined && { revision: String(value.revision) }) };
}
function traceMetadata(value) {
  const result = {};
  if (value.sources !== undefined) {
    traceAssert(Array.isArray(value.sources) && value.sources.length <= 8);
    result.sources = value.sources.map(traceReference);
  }
  if (value.workflow !== undefined) {
    traceAssert(traceFields(value.workflow, ['id', 'version', 'runId']) && traceIdValue(value.workflow.id));
    for (const key of ['version', 'runId']) if (value.workflow[key] !== undefined) traceAssert(traceIdValue(String(value.workflow[key])));
    result.workflow = { id: value.workflow.id, ...(value.workflow.version !== undefined && { version: String(value.workflow.version) }), ...(value.workflow.runId !== undefined && { runId: value.workflow.runId }) };
  }
  if (value.humanDecision !== undefined) {
    traceAssert(traceFields(value.humanDecision, ['id', 'decision', 'at']) && traceIdValue(value.humanDecision.id) && ['approved', 'rejected', 'changes_requested'].includes(value.humanDecision.decision));
    if (value.humanDecision.at !== undefined) traceAssert(Number.isSafeInteger(value.humanDecision.at) && value.humanDecision.at >= 0);
    result.humanDecision = { id: value.humanDecision.id, decision: value.humanDecision.decision, ...(value.humanDecision.at !== undefined && { at: value.humanDecision.at }) };
  }
  return result;
}
function traceStep(value) {
  traceAssert(traceFields(value, ['stage', 'status', 'code', 'revision', 'generation', 'committed', 'resourceId', 'sources', 'workflow', 'humanDecision']));
  traceAssert(TRACE_STAGES.has(value.stage) && TRACE_STATUSES.has(value.status));
  if (value.stage === 'result') traceAssert(TRACE_FINAL_STATUSES.has(value.status));
  const result = { stage: value.stage, status: value.status, ...traceMetadata(value) };
  if (value.code !== undefined) { traceAssert(typeof value.code === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/.test(value.code)); result.code = value.code; }
  for (const key of ['revision', 'resourceId']) if (value[key] !== undefined) { traceAssert(traceIdValue(String(value[key]))); result[key] = String(value[key]); }
  if (value.generation !== undefined) { traceAssert(Number.isSafeInteger(value.generation) && value.generation >= 0); result.generation = value.generation; }
  if (value.committed !== undefined) { traceAssert(typeof value.committed === 'boolean'); result.committed = value.committed; }
  if (value.stage === 'commit' && value.status === 'succeeded') traceAssert(value.committed === true);
  return result;
}
const traceSafeToken = value => traceIdValue(value) ? value : null;
const traceTime = value => Number.isFinite(value) ? new Date(value).toISOString() : null;

export class BusinessEvents {
  constructor(file, { clock = () => Date.now(), coalesceMs = 2000 } = {}) {
    mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(file); chmodSync(file, 0o600); this.clock = clock; this.coalesceMs = coalesceMs;
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS business_events(seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL, app TEXT NOT NULL, space TEXT NOT NULL, resource TEXT NOT NULL, revision TEXT, operation TEXT, committed_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS source_cursors(app TEXT NOT NULL,space TEXT NOT NULL,cursor INTEGER NOT NULL,PRIMARY KEY(app,space));
      CREATE TABLE IF NOT EXISTS resource_source_cursors(app TEXT NOT NULL,space TEXT NOT NULL,resource TEXT NOT NULL,cursor INTEGER NOT NULL,PRIMARY KEY(app,space,resource));
      CREATE TABLE IF NOT EXISTS business_audit(id TEXT PRIMARY KEY,at INTEGER NOT NULL,request_id TEXT,user_id TEXT,client_id TEXT,grant_id TEXT,app TEXT,space TEXT,resource TEXT,action TEXT,decision TEXT,code TEXT);
      CREATE TABLE IF NOT EXISTS business_traces(seq INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT UNIQUE NOT NULL,request_id TEXT NOT NULL,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,state TEXT NOT NULL,context TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS business_trace_steps(seq INTEGER PRIMARY KEY AUTOINCREMENT,trace_id TEXT NOT NULL REFERENCES business_traces(id),at INTEGER NOT NULL,stage TEXT NOT NULL,status TEXT NOT NULL,metadata TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS business_trace_steps_lookup ON business_trace_steps(trace_id,seq);
      CREATE TABLE IF NOT EXISTS business_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS replica_queue(id INTEGER PRIMARY KEY CHECK(id=1), generation INTEGER NOT NULL, completed INTEGER NOT NULL DEFAULT 0, due_at INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, lease_id TEXT,lease_until INTEGER NOT NULL DEFAULT 0,last_error TEXT);`);
    this.db.prepare("INSERT OR IGNORE INTO business_meta VALUES('audit_key',?)").run(randomBytes(32).toString('hex'));
    this.auditKey = this.db.prepare("SELECT value FROM business_meta WHERE key='audit_key'").get().value;
  }
  sourceCursor(app, space, resource) {
    return (resource === undefined ? this.db.prepare('SELECT cursor FROM source_cursors WHERE app=? AND space=?').get(app, space) : this.db.prepare('SELECT cursor FROM resource_source_cursors WHERE app=? AND space=? AND resource=?').get(app, space, resource))?.cursor || 0;
  }
  ingest(app, space, result, { resourceId } = {}) {
    const now = this.clock(); this.db.exec('BEGIN IMMEDIATE');
    try {
      let changed = 0;
      const prior = this.sourceCursor(app, space, resourceId);
      const source = resourceId === undefined ? `${app}:${space}` : `${app}:${space}:${resourceId}`;
      if (result.resetRequired || result.cursor < prior) {
        changed += Number(this.db.prepare('INSERT OR IGNORE INTO business_events(id,app,space,resource,revision,operation,committed_at) VALUES(?,?,?,?,?,?,?)').run(`${source}:reset:${prior}:${result.cursor}`, app, space, resourceId ?? '*', '', 'reset', now).changes);
      }
      for (const event of result.events) {
        if (!(typeof event.id === 'string' && event.id.length || Number.isSafeInteger(event.id) && event.id > 0) || typeof event.resourceId !== 'string' || !Number.isSafeInteger(event.cursor) || event.cursor < 0) throw new Error('Invalid application event.');
        if (resourceId !== undefined && event.resourceId !== resourceId) throw new Error('Application event has an unexpected resource.');
        const inserted = this.db.prepare('INSERT OR IGNORE INTO business_events(id,app,space,resource,revision,operation,committed_at) VALUES(?,?,?,?,?,?,?)').run(`${source}:${event.id}`, app, space, event.resourceId, String(event.revision ?? ''), String(event.operation || 'change'), Number.isFinite(event.committedAt) ? event.committedAt : now);
        changed += Number(inserted.changes);
      }
      if (!Number.isSafeInteger(result.cursor) || result.cursor < 0) throw new Error('Invalid application event cursor.');
      if (resourceId === undefined) this.db.prepare('INSERT INTO source_cursors VALUES(?,?,?) ON CONFLICT(app,space) DO UPDATE SET cursor=excluded.cursor').run(app, space, result.cursor);
      else this.db.prepare('INSERT INTO resource_source_cursors VALUES(?,?,?,?) ON CONFLICT(app,space,resource) DO UPDATE SET cursor=excluded.cursor').run(app, space, resourceId, result.cursor);
      if (changed) this.db.prepare(`INSERT INTO replica_queue(id,generation,due_at) VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET generation=generation+excluded.generation,due_at=CASE WHEN replica_queue.generation=replica_queue.completed THEN excluded.due_at ELSE replica_queue.due_at END`).run(changed, now + this.coalesceMs);
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  audit(event) {
    const pseudo = value => value ? createHmac('sha256', this.auditKey).update(String(value)).digest('hex').slice(0, 24) : null;
    this.db.prepare('INSERT INTO business_audit VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(randomUUID(), this.clock(), event.requestId || null, pseudo(event.userId), pseudo(event.clientId), pseudo(event.grantId), event.appId || null, pseudo(event.spaceId), pseudo(event.resourceId), event.action || null, event.decision || null, event.code || null);
  }
  tracePseudonym(value) {
    return value ? createHmac('sha256', this.auditKey).update(String(value)).digest('hex').slice(0, 24) : null;
  }
  beginTrace(context) {
    traceAssert(traceFields(context, ['requestId', 'appId', 'spaceId', 'resourceId', 'operation', 'action', 'userId', 'clientId', 'grantId', 'source', 'sources', 'workflow', 'humanDecision']));
    for (const key of ['requestId', 'appId', 'spaceId', 'operation', 'action']) traceAssert(traceIdValue(context[key]));
    if (context.resourceId !== undefined) traceAssert(traceIdValue(context.resourceId));
    if (context.source !== undefined) traceAssert(['mcp', 'web', 'http', 'sync'].includes(context.source));
    const metadata = traceMetadata(context), id = randomUUID(), now = this.clock();
    const safe = { requestId: context.requestId, appId: context.appId, spaceId: context.spaceId, operation: context.operation, action: context.action, source: context.source || 'http', ...metadata,
      ...(context.resourceId !== undefined && { resourceId: context.resourceId }),
      actor: { userRef: this.tracePseudonym(context.userId), clientRef: this.tracePseudonym(context.clientId), grantRef: this.tracePseudonym(context.grantId) } };
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare('INSERT INTO business_traces(id,request_id,created_at,updated_at,state,context) VALUES(?,?,?,?,?,?)').run(id, context.requestId, now, now, 'started', JSON.stringify(safe));
      this.db.prepare('INSERT INTO business_trace_steps(trace_id,at,stage,status,metadata) VALUES(?,?,?,?,?)').run(id, now, 'authorization', 'started', '{}');
      this.db.exec('COMMIT'); return id;
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  recordTrace(id, value) {
    traceAssert(traceIdValue(id));
    const step = traceStep(value), trace = this.db.prepare('SELECT state,context FROM business_traces WHERE id=?').get(id);
    traceAssert(trace && trace.state === 'started');
    const context = JSON.parse(trace.context);
    if (step.committed === true) {
      traceAssert(context.action !== 'read');
      if (step.stage === 'commit') traceAssert(step.status === 'succeeded');
      if (step.stage !== 'commit') traceAssert(this.db.prepare("SELECT 1 FROM business_trace_steps WHERE trace_id=? AND stage='commit' AND status='succeeded'").get(id));
    }
    const { stage, status, ...metadata } = step, now = this.clock();
    this.db.exec('BEGIN IMMEDIATE');
    try {
      traceAssert(this.db.prepare('SELECT COUNT(*) AS count FROM business_trace_steps WHERE trace_id=?').get(id).count < 64);
      const row = this.db.prepare('INSERT INTO business_trace_steps(trace_id,at,stage,status,metadata) VALUES(?,?,?,?,?)').run(id, now, stage, status, JSON.stringify(metadata));
      this.db.prepare('UPDATE business_traces SET updated_at=?,state=? WHERE id=?').run(now, stage === 'result' ? status : 'started', id);
      this.db.exec('COMMIT'); return Number(row.lastInsertRowid);
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  endTrace(id, outcome) {
    traceAssert(traceObject(outcome) && TRACE_FINAL_STATUSES.has(outcome.status));
    const trace = this.db.prepare('SELECT context,state FROM business_traces WHERE id=?').get(id);
    traceAssert(trace && trace.state === 'started');
    const committed = Boolean(this.db.prepare("SELECT 1 FROM business_trace_steps WHERE trace_id=? AND stage='commit' AND status='succeeded'").get(id));
    let final = { ...outcome, stage: 'result' };
    if (outcome.status === 'succeeded' && JSON.parse(trace.context).action !== 'read' && !committed) final = { ...final, status: 'unknown', code: 'COMMIT_UNCONFIRMED', committed: false };
    this.recordTrace(id, final);
    return id;
  }
  traceCoverage() {
    const count = (table, time, kind, filter = '', values = []) => {
      const value = this.db.prepare(`SELECT COUNT(*) AS count,MIN(${time}) AS firstAt,MAX(${time}) AS lastAt FROM ${table}${filter}`).get(...values);
      return { count: value.count, firstRecordedAt: traceTime(value.firstAt), lastRecordedAt: traceTime(value.lastAt), kind };
    };
    return { lifecycle: count('business_traces', 'created_at', 'structured-lifecycle'), audit: count('business_audit', 'at', 'decision-only', " WHERE NOT(COALESCE(action,'')='read' AND COALESCE(client_id,'')=?)", [this.tracePseudonym('praxis-browser')]), outbox: count('business_events', 'committed_at', 'application-outbox') };
  }
  tracePage({ source = 'lifecycle', before = Number.MAX_SAFE_INTEGER, limit = 25, traceId } = {}) {
    traceAssert(['lifecycle', 'audit', 'outbox'].includes(source) && Number.isSafeInteger(before) && before > 0 && Number.isSafeInteger(limit) && limit >= 1 && limit <= 50);
    if (traceId !== undefined) traceAssert(source === 'lifecycle' && traceIdValue(traceId));
    const toStep = row => ({ cursor: row.seq, at: traceTime(row.at), stage: row.stage, status: row.status, ...JSON.parse(row.metadata) });
    const lifecycle = row => {
      const context = JSON.parse(row.context), count = this.db.prepare('SELECT COUNT(*) AS count FROM business_trace_steps WHERE trace_id=?').get(row.id).count;
      const steps = this.db.prepare('SELECT * FROM business_trace_steps WHERE trace_id=? AND seq<? ORDER BY seq DESC LIMIT ?').all(row.id, traceId ? before : Number.MAX_SAFE_INTEGER, traceId ? limit : 8).map(toStep).reverse();
      const committed = Boolean(this.db.prepare("SELECT 1 FROM business_trace_steps WHERE trace_id=? AND stage='commit' AND status='succeeded'").get(row.id));
      const readback = this.db.prepare("SELECT status FROM business_trace_steps WHERE trace_id=? AND stage='readback' ORDER BY seq DESC LIMIT 1").get(row.id)?.status || 'not_recorded';
      return { kind: 'lifecycle', cursor: row.seq, id: row.id, at: traceTime(row.created_at), updatedAt: traceTime(row.updated_at), status: row.state, committed, readback, ...context, steps, stepCount: count, olderStepsCursor: steps.length && this.db.prepare('SELECT 1 FROM business_trace_steps WHERE trace_id=? AND seq<?').get(row.id, steps[0].cursor) ? steps[0].cursor : null };
    };
    let items, rows;
    if (source === 'lifecycle') {
      rows = traceId ? this.db.prepare('SELECT * FROM business_traces WHERE id=?').all(traceId) : this.db.prepare('SELECT * FROM business_traces WHERE seq<? ORDER BY seq DESC LIMIT ?').all(before, limit + 1);
      items = rows.slice(0, limit).map(lifecycle);
    } else if (source === 'audit') {
      rows = this.db.prepare("SELECT rowid AS seq,* FROM business_audit WHERE rowid<? AND NOT(COALESCE(action,'')='read' AND COALESCE(client_id,'')=?) ORDER BY rowid DESC LIMIT ?").all(before, this.tracePseudonym('praxis-browser'), limit + 1);
      items = rows.slice(0, limit).map(row => ({ kind: 'audit', cursor: row.seq, id: `audit:${row.seq}`, at: traceTime(row.at), appId: traceSafeToken(row.app), action: traceSafeToken(row.action), requestId: traceSafeToken(row.request_id), status: row.decision === 'allow' ? 'allowed' : row.decision === 'reject' ? 'denied' : 'unknown', code: /^[A-Z][A-Z0-9_]{0,63}$/.test(row.code || '') ? row.code : null, actor: { userRef: row.user_id, clientRef: row.client_id, grantRef: row.grant_id }, spaceRef: row.space, resourceRef: row.resource, committed: null, readback: 'not_recorded' }));
    } else {
      rows = this.db.prepare('SELECT * FROM business_events WHERE seq<? ORDER BY seq DESC LIMIT ?').all(before, limit + 1);
      items = rows.slice(0, limit).map(row => ({ kind: 'outbox', cursor: row.seq, id: `outbox:${row.seq}`, at: traceTime(row.committed_at), appId: traceSafeToken(row.app), spaceId: traceSafeToken(row.space), resourceId: traceSafeToken(row.resource), revision: traceSafeToken(row.revision), operation: traceSafeToken(row.operation), status: row.operation === 'reset' ? 'unknown' : 'committed', committed: row.operation === 'reset' ? false : true, readback: 'not_recorded' }));
    }
    let size = 0;
    const bounded = [];
    for (const item of items) {
      const bytes = Buffer.byteLength(JSON.stringify(item));
      if (bounded.length && size + bytes > 80 * 1024) break;
      if (bytes > 80 * 1024) { item.steps = item.steps?.slice(-8); item.olderStepsCursor = item.steps?.[0]?.cursor ?? null; }
      bounded.push(item); size += Buffer.byteLength(JSON.stringify(item));
    }
    return { schemaVersion: 1, state: bounded.length ? 'ready' : 'empty', source, generatedAt: traceTime(this.clock()), coverage: this.traceCoverage(), items: bounded, nextCursor: traceId ? bounded[0]?.olderStepsCursor ?? null : (rows.length > bounded.length ? bounded.at(-1)?.cursor ?? null : null) };
  }
  notePolicyVersion(version) {
    if (!Number.isSafeInteger(version) || version < 0) throw new Error('Invalid policy version.');
    if (this.db.prepare("SELECT value FROM business_meta WHERE key='policy_version'").get()?.value === String(version)) return;
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare("INSERT INTO business_meta VALUES('policy_version',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(String(version));
      this.db.prepare('INSERT INTO replica_queue(id,generation,due_at) VALUES(1,1,?) ON CONFLICT(id) DO UPDATE SET generation=generation+1,due_at=CASE WHEN generation=completed THEN excluded.due_at ELSE due_at END').run(this.clock() + this.coalesceMs);
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  cursor() { return this.db.prepare('SELECT COALESCE(MAX(seq),0) AS cursor FROM business_events').get().cursor; }
  changes(after, limit = 100) {
    return this.db.prepare('SELECT seq AS cursor,app AS appId,space AS spaceId,resource AS resourceId,revision,operation,committed_at AS committedAt FROM business_events WHERE seq>? ORDER BY seq LIMIT ?').all(after, limit);
  }
  status() {
    const row = this.db.prepare('SELECT generation,completed,due_at AS dueAt,attempts,lease_until AS leaseUntil,last_error AS lastError FROM replica_queue WHERE id=1').get();
    return row ? { ...row, state: row.generation <= row.completed ? 'synced' : row.lastError ? 'retry' : 'pending' } : { state: 'idle', generation: 0, completed: 0 };
  }
  claim({ leaseMs = 15 * 60_000 } = {}) {
    const now = this.clock(), leaseId = randomUUID();
    const row = this.db.prepare('UPDATE replica_queue SET lease_id=?,lease_until=? WHERE id=1 AND generation>completed AND due_at<=? AND lease_until<=? RETURNING generation').get(leaseId, now + leaseMs, now, now);
    return row ? { leaseId, generation: row.generation } : null;
  }
  complete(job) {
    return this.db.prepare('UPDATE replica_queue SET completed=MAX(completed,?),attempts=0,last_error=NULL,lease_id=NULL,lease_until=0 WHERE id=1 AND lease_id=?').run(job.generation, job.leaseId).changes === 1;
  }
  renew(job, leaseMs = 15 * 60_000) {
    return this.db.prepare('UPDATE replica_queue SET lease_until=? WHERE id=1 AND lease_id=?').run(this.clock() + leaseMs, job.leaseId).changes === 1;
  }
  retry(job, code = 'REPLICA_FAILED') {
    if (!/^[A-Z_]{1,64}$/.test(code)) code = 'REPLICA_FAILED';
    const attempts = this.status().attempts || 0;
    return this.db.prepare('UPDATE replica_queue SET attempts=attempts+1,last_error=?,due_at=?,lease_id=NULL,lease_until=0 WHERE id=1 AND lease_id=?').run(code, this.clock() + Math.min(3600_000, 5000 * 2 ** Math.min(attempts, 10)), job.leaseId).changes === 1;
  }
  requestPeriodicSync() {
    this.db.prepare(`INSERT INTO replica_queue(id,generation,due_at) VALUES(1,1,?)
      ON CONFLICT(id) DO UPDATE SET
      generation=CASE WHEN generation<=completed THEN generation+1 ELSE generation END,
      due_at=CASE WHEN generation<=completed THEN excluded.due_at ELSE due_at END`).run(this.clock());
    return this.status();
  }
  close() { this.db.close(); }
}
