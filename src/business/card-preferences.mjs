import { createHash } from 'node:crypto';
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const fail = (status, code, current) => Object.assign(new Error('Card preference request rejected.'), { status, code, ...(current && { current }) });
const identifier = value => typeof value === 'string' && value.length > 0 && value.length <= 1024 && !/[\x00-\x1f\x7f]/.test(value);
export class CardPreferences {
  constructor({ db, clock = Date.now }) {
    this.db = db; this.clock = clock;
    db.exec(`CREATE TABLE IF NOT EXISTS card_preference_versions(user_id TEXT PRIMARY KEY,revision INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS card_preferences(user_id TEXT NOT NULL,card_id TEXT NOT NULL,card_revision TEXT NOT NULL,state TEXT NOT NULL,until_at TEXT,updated_at INTEGER NOT NULL,PRIMARY KEY(user_id,card_id));
      CREATE TABLE IF NOT EXISTS card_preference_receipts(user_id TEXT NOT NULL,key TEXT NOT NULL,digest TEXT NOT NULL,created_at INTEGER NOT NULL,PRIMARY KEY(user_id,key));`);
  }
  get(userId) {
    if (!identifier(userId)) throw fail(401,'UNAUTHENTICATED');
    const revision = this.db.prepare('SELECT revision FROM card_preference_versions WHERE user_id=?').get(userId)?.revision || 0;
    const rows = this.db.prepare('SELECT card_id AS cardId,card_revision AS cardRevision,state,until_at AS until FROM card_preferences WHERE user_id=? ORDER BY card_id').all(userId);
    return { revision, items: rows.filter(row=>row.state==='hidden'||Date.parse(row.until)>this.clock()).map(row=>({cardId:row.cardId,cardRevision:row.cardRevision,state:row.state,...(row.until?{until:row.until}:{})})) };
  }
  set(userId, input) {
    if (!identifier(userId)) throw fail(401,'UNAUTHENTICATED');
    const allowed = ['cardId','cardRevision','state','until','expectedRevision','idempotencyKey'];
    if (!object(input) || Object.keys(input).some(key=>!allowed.includes(key)) || !identifier(input.cardId) || !identifier(input.cardRevision) || input.cardRevision.length>256 || !['visible','later','hidden'].includes(input.state) || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision<0 || !identifier(input.idempotencyKey) || input.idempotencyKey.length>200) throw fail(400,'INVALID_PREFERENCE');
    let until;
    if (input.state==='later') {
      if (typeof input.until!=='string' || !Number.isFinite(Date.parse(input.until)) || new Date(input.until).toISOString()!==input.until || Date.parse(input.until)<=this.clock() || Date.parse(input.until)>this.clock()+366*86400000) throw fail(400,'INVALID_PREFERENCE_TIME');
      until=input.until;
    } else if (input.until!==undefined) throw fail(400,'INVALID_PREFERENCE_TIME');
    const digest=createHash('sha256').update(JSON.stringify({cardId:input.cardId,cardRevision:input.cardRevision,state:input.state,until:until??null,expectedRevision:input.expectedRevision})).digest('hex');
    this.db.exec('SAVEPOINT card_preference_mutation');
    try {
      const receipt=this.db.prepare('SELECT digest FROM card_preference_receipts WHERE user_id=? AND key=?').get(userId,input.idempotencyKey);
      if(receipt){if(receipt.digest!==digest)throw fail(409,'IDEMPOTENCY_CONFLICT');const current=this.get(userId);this.db.exec('RELEASE SAVEPOINT card_preference_mutation');return current;}
      const current=this.get(userId);
      if(current.revision!==input.expectedRevision)throw fail(409,'PREFERENCE_REVISION_CONFLICT',current);
      if(input.state==='visible')this.db.prepare('DELETE FROM card_preferences WHERE user_id=? AND card_id=?').run(userId,input.cardId);
      else {
        const size=this.db.prepare('SELECT COUNT(*) AS n FROM card_preferences WHERE user_id=?').get(userId).n;
        if(size>=10000&&!this.db.prepare('SELECT 1 FROM card_preferences WHERE user_id=? AND card_id=?').get(userId,input.cardId))throw fail(409,'PREFERENCE_LIMIT');
        this.db.prepare('INSERT INTO card_preferences VALUES(?,?,?,?,?,?) ON CONFLICT(user_id,card_id) DO UPDATE SET card_revision=excluded.card_revision,state=excluded.state,until_at=excluded.until_at,updated_at=excluded.updated_at').run(userId,input.cardId,input.cardRevision,input.state,until??null,this.clock());
      }
      this.db.prepare('INSERT INTO card_preference_versions VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET revision=excluded.revision').run(userId,current.revision+1);
      this.db.prepare('INSERT INTO card_preference_receipts VALUES(?,?,?,?)').run(userId,input.idempotencyKey,digest,this.clock());
      this.db.prepare('DELETE FROM card_preference_receipts WHERE user_id=? AND created_at<?').run(userId,this.clock()-30*86400000);
      const value=this.get(userId);this.db.exec('RELEASE SAVEPOINT card_preference_mutation');return value;
    } catch(error) {this.db.exec('ROLLBACK TO SAVEPOINT card_preference_mutation; RELEASE SAVEPOINT card_preference_mutation');throw error;}
  }
}
