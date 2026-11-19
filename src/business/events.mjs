import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID, randomBytes, createHmac } from 'node:crypto';

export class BusinessEvents {
  constructor(file, { clock = () => Date.now(), coalesceMs = 2000 } = {}) {
    mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(file); chmodSync(file, 0o600); this.clock = clock; this.coalesceMs = coalesceMs;
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS business_events(seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL, app TEXT NOT NULL, space TEXT NOT NULL, resource TEXT NOT NULL, revision TEXT, operation TEXT, committed_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS source_cursors(app TEXT NOT NULL,space TEXT NOT NULL,cursor INTEGER NOT NULL,PRIMARY KEY(app,space));
      CREATE TABLE IF NOT EXISTS resource_source_cursors(app TEXT NOT NULL,space TEXT NOT NULL,resource TEXT NOT NULL,cursor INTEGER NOT NULL,PRIMARY KEY(app,space,resource));
      CREATE TABLE IF NOT EXISTS business_audit(id TEXT PRIMARY KEY,at INTEGER NOT NULL,request_id TEXT,user_id TEXT,client_id TEXT,grant_id TEXT,app TEXT,space TEXT,resource TEXT,action TEXT,decision TEXT,code TEXT);
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
