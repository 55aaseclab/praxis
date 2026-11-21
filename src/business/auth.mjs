import { DatabaseSync } from 'node:sqlite';
import { chmodSync, lstatSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createHash, createHmac, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { DEFAULT_APP_REGISTRY } from '../default-app-registry.mjs';

export const SESSION_COOKIE = 'praxis_business_session';
const PLATFORM_ACTIONS = Object.freeze({ spaces: ['manage_members', 'manage_sharing', 'manage_delegation'] });
const PLATFORM_SCOPES = Object.freeze({
  'spaces:members': { appId: 'spaces', actions: ['manage_members'] },
  'spaces:sharing': { appId: 'spaces', actions: ['manage_sharing'] },
  'spaces:delegation': { appId: 'spaces', actions: ['manage_delegation'] },
});
export const WEB_APP_IDS = DEFAULT_APP_REGISTRY.webAppIds;
export const BUSINESS_SCOPES = Object.freeze({ ...DEFAULT_APP_REGISTRY.scopes, ...PLATFORM_SCOPES });
const APP_ACTIONS = Object.freeze({ ...DEFAULT_APP_REGISTRY.businessActions, ...PLATFORM_ACTIONS });
const DAY = 86400000;
const maximumGrantAge = 30 * DAY;
const hash = value => createHash('sha256').update(value).digest('hex');
const randomToken = prefix => `${prefix}_${randomBytes(32).toString('base64url')}`;
const unique = values => [...new Set(values)].sort();
const intersect = (left, right) => left.includes('*') ? [...right] : right.includes('*') ? [...left] : left.filter(value => right.includes(value));
const escapeHtml = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);

export class AuthError extends Error {
  constructor(message, status = 400, code = 'INVALID_INPUT') { super(message); this.status = status; this.code = code; }
}
const fail = (message, status, code) => { throw new AuthError(message, status, code); };
const databaseError = error => [5, 6].includes(error.errcode & 255) ? new AuthError('Authorization policy is busy; retry the request.', 503, 'POLICY_BUSY') : error;
const identifier = (value, label = 'Identifier') => {
  if (typeof value !== 'string' || !value.trim() || value.length > 200 || /[\x00-\x1f\x7f]/.test(value)) fail(`${label} must be a nonempty string of at most 200 characters.`);
  return value;
};
function passwordDigest(password) {
  if (typeof password !== 'string' || password.length < 12 || password.length > 1024) fail('Password must contain between 12 and 1024 characters.');
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
}
function timestamp(value, fallback) {
  const result = value === undefined ? fallback : typeof value === 'number' ? value : Date.parse(value);
  if (!Number.isSafeInteger(result) || result <= 0) fail('Expiry must be a valid timestamp.');
  return result;
}
function strings(value, label, wildcard = false) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 1000) fail(`${label} must be a nonempty bounded array.`);
  const result = unique(value.map(item => identifier(item, label)));
  if (result.includes('*')) {
    if (!wildcard || result.length !== 1) fail(`${label} cannot contain a wildcard in this form.`);
  }
  return result;
}
function normalizeRules(rules, appActions = APP_ACTIONS) {
  if (!Array.isArray(rules) || rules.length < 1 || rules.length > 1000) fail('Delegation requires one or more bounded rules.');
  return rules.map(rule => {
    if (!rule || typeof rule !== 'object' || Array.isArray(rule) || Object.keys(rule).some(key => !['appId', 'spaceId', 'resources', 'actions'].includes(key))) fail('Delegation rule has unknown or invalid fields.');
    const appId = identifier(rule.appId, 'Application');
    const actions = strings(rule.actions, 'Actions');
    if (!Object.hasOwn(appActions, appId) || actions.some(action => !appActions[appId].includes(action))) fail('Application or business action is not supported.');
    return { appId, spaceId: identifier(rule.spaceId, 'Space'), resources: strings(rule.resources, 'Resources', true), actions };
  });
}
function validateRedirect(value) {
  if (typeof value !== 'string' || value.length > 2048) fail('Redirect URI is invalid.');
  let url;
  try { url = new URL(value); } catch { fail('Redirect URI is invalid.'); }
  if (url.username || url.password || url.hash || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))) fail('Redirect URI must use HTTPS or HTTP loopback without credentials or fragments.');
  return value;
}
function parseCookie(request) {
  const cookie = request.headers?.cookie;
  if (typeof cookie !== 'string') return null;
  const matches = cookie.split(';').map(part => part.trim()).filter(part => part.startsWith(`${SESSION_COOKIE}=`));
  if (matches.length !== 1) return null;
  try { return decodeURIComponent(matches[0].slice(SESSION_COOKIE.length + 1)); } catch { return null; }
}
export function credentialFromRequest(request) {
  const authorization = request.headers?.authorization;
  if (authorization !== undefined) {
    const match = typeof authorization === 'string' && /^Bearer ([A-Za-z0-9_-]{20,200})$/i.exec(authorization);
    if (!match || !match[1].startsWith('pxa_')) fail('Authorization must contain one Bearer access token.', 401, 'UNAUTHENTICATED');
    return match[1];
  }
  return parseCookie(request);
}

export class AuthStore {
  constructor({ file, issuer, clock = () => Date.now(), busyTimeoutMs = 5000, registry = DEFAULT_APP_REGISTRY } = {}) {
    this.registry = registry; this.webAppIds = registry.webAppIds; this.appActions = Object.freeze({ ...registry.businessActions, ...PLATFORM_ACTIONS }); this.scopes = Object.freeze({ ...registry.scopes, ...PLATFORM_SCOPES }); this.targetedCreateApps = new Set(registry.targetedCreateApps);
    if (typeof issuer !== 'string') fail('An explicit public issuer URL is required.');
    let url;
    try { url = new URL(issuer); } catch { fail('Issuer URL is invalid.'); }
    if (url.username || url.password || url.search || url.hash || !['http:', 'https:'].includes(url.protocol) || (url.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) fail('Issuer requires HTTPS except on loopback.');
    this.issuer = issuer.replace(/\/$/, '');
    this.resource = `${this.issuer}/mcp`;
    this.clock = clock;
    this.webAccessBoundary = { enabled: false, apps: {} };
    if (!Number.isInteger(busyTimeoutMs) || busyTimeoutMs < 1 || busyTimeoutMs > 60000) fail('Policy lock timeout must be between one and sixty thousand milliseconds.');
    this.changes = new EventEmitter();
    this.file = file === ':memory:' ? file : resolve(identifier(file, 'Auth database file'));
    if (this.file !== ':memory:') {
      mkdirSync(dirname(this.file), { recursive: true, mode: 0o700 });
      try { if (lstatSync(this.file).isSymbolicLink()) fail('Auth database must not be a symbolic link.'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    this.db = new DatabaseSync(this.file);
    if (this.file !== ':memory:') chmodSync(this.file, 0o600);
    this.db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=${busyTimeoutMs};
      CREATE TABLE IF NOT EXISTS auth_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS auth_users (id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE COLLATE NOCASE, password_hash TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1);
      CREATE TABLE IF NOT EXISTS auth_platform_admins (user_id TEXT PRIMARY KEY REFERENCES auth_users(id), granted_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS auth_spaces (id TEXT PRIMARY KEY, type TEXT NOT NULL, owner_id TEXT NOT NULL REFERENCES auth_users(id));
      CREATE TABLE IF NOT EXISTS auth_self_service_spaces (space_id TEXT PRIMARY KEY REFERENCES auth_spaces(id));
      CREATE TABLE IF NOT EXISTS auth_space_apps (space_id TEXT NOT NULL REFERENCES auth_spaces(id), app_id TEXT NOT NULL, enabled INTEGER NOT NULL CHECK(enabled IN (0,1)), PRIMARY KEY(space_id,app_id));
      CREATE TABLE IF NOT EXISTS auth_members (space_id TEXT NOT NULL REFERENCES auth_spaces(id), user_id TEXT NOT NULL REFERENCES auth_users(id), role TEXT NOT NULL, PRIMARY KEY(space_id,user_id));
      CREATE TABLE IF NOT EXISTS auth_resources (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES auth_users(id), space_id TEXT NOT NULL REFERENCES auth_spaces(id), app_id TEXT NOT NULL, resources TEXT NOT NULL, actions TEXT NOT NULL, expires_at INTEGER, membership_required INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS auth_clients (id TEXT PRIMARY KEY, name TEXT NOT NULL, redirect_uris TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS auth_grants (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES auth_users(id), client_id TEXT NOT NULL REFERENCES auth_clients(id), rules TEXT NOT NULL, expires_at INTEGER NOT NULL, revoked_at INTEGER, created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS auth_tokens (hash TEXT PRIMARY KEY, type TEXT NOT NULL, grant_id TEXT NOT NULL REFERENCES auth_grants(id), client_id TEXT NOT NULL, audience TEXT NOT NULL, expires_at INTEGER NOT NULL, revoked_at INTEGER, family TEXT);
      CREATE TABLE IF NOT EXISTS auth_sessions (hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES auth_users(id), client_id TEXT NOT NULL, grant_id TEXT REFERENCES auth_grants(id), csrf TEXT NOT NULL, expires_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS auth_web_access (user_id TEXT PRIMARY KEY REFERENCES auth_users(id), apps TEXT NOT NULL, workbench INTEGER NOT NULL CHECK(workbench IN (0,1)), prds INTEGER NOT NULL CHECK(prds IN (0,1)), expires_at INTEGER, updated_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS auth_codes (hash TEXT PRIMARY KEY, grant_id TEXT NOT NULL REFERENCES auth_grants(id), client_id TEXT NOT NULL, redirect_uri TEXT NOT NULL, challenge TEXT NOT NULL, audience TEXT NOT NULL, expires_at INTEGER NOT NULL, used_at INTEGER);
      CREATE TABLE IF NOT EXISTS auth_login_attempts (key TEXT PRIMARY KEY, count INTEGER NOT NULL, reset_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS auth_audit (id TEXT PRIMARY KEY, at INTEGER NOT NULL, event TEXT NOT NULL, actor TEXT, client TEXT, grant_ref TEXT, space_ref TEXT, app_id TEXT, action TEXT, resource_ref TEXT, outcome TEXT NOT NULL, reason TEXT);
      CREATE INDEX IF NOT EXISTS auth_resource_lookup ON auth_resources(user_id,space_id,app_id);
      CREATE INDEX IF NOT EXISTS auth_token_grants ON auth_tokens(grant_id);
      INSERT OR IGNORE INTO auth_meta(key,value) VALUES('policy_version','0');`);
    this.db.prepare("INSERT OR IGNORE INTO auth_meta(key,value) VALUES('audit_key',?)").run(randomBytes(32).toString('hex'));
    this.auditKey = this.db.prepare("SELECT value FROM auth_meta WHERE key='audit_key'").get().value;
    this.createClient({ id: 'praxis-browser', name: 'Praxis 工作台', redirectUris: [`${this.issuer}/business/`] });
  }
  close() { this.changes.removeAllListeners(); this.db.close(); }
  onChange(listener) { this.changes.on('change', listener); return () => this.changes.off('change', listener); }
  get policyVersion() { return Number(this.db.prepare("SELECT value FROM auth_meta WHERE key='policy_version'").get().value); }
  changed(event) {
    this.db.prepare("UPDATE auth_meta SET value=CAST(value AS INTEGER)+1 WHERE key='policy_version'").run();
    if (this.controlContext) this.controlContext.events.push(event);
    else this.changes.emit('change', { ...event, version: this.policyVersion });
  }
  transaction(callback) {
    try { this.db.exec('BEGIN IMMEDIATE'); } catch (error) { throw databaseError(error); }
    try { const value = callback(); this.db.exec('COMMIT'); return value; } catch (error) { this.db.exec('ROLLBACK'); throw databaseError(error); }
  }
  async withPolicyLease(callback) {
    if (typeof callback !== 'function') fail('Policy lease requires a callback.');
    if (this.leaseActive) fail('Authorization policy is busy; retry the request.', 503, 'POLICY_BUSY');
    try { this.db.exec('BEGIN IMMEDIATE'); } catch (error) { throw databaseError(error); }
    this.leaseActive = true;
    try {
      const value = await callback();
      this.db.exec('COMMIT');
      return value;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw databaseError(error);
    } finally { this.leaseActive = false; }
  }
  controlTransaction(callback) {
    if (this.controlContext) return callback();
    const context = { events: [], actor: null };
    this.controlContext = context;
    let result;
    try {
      result = this.transaction(() => {
        const value = callback();
        if (value && typeof value.then === 'function') fail('Administration transactions must be synchronous.');
        return value;
      });
    } finally { this.controlContext = null; }
    for (const event of context.events) this.changes.emit('change', { ...event, version: this.policyVersion });
    return result;
  }
  withAdminSession(token, callback) {
    if (typeof callback !== 'function') fail('Administration requires a callback.');
    return this.controlTransaction(() => {
      const actor = this.requirePlatformAdminSession(token);
      const previous = this.controlContext.actor;
      this.controlContext.actor = actor;
      try { return callback(actor); }
      finally { this.controlContext.actor = previous; }
    });
  }
  isPlatformAdmin(userId) {
    return Boolean(this.db.prepare('SELECT 1 FROM auth_platform_admins WHERE user_id=?').get(userId));
  }
  requirePlatformAdminSession(token) {
    const session = this.requireNativeSession(token);
    if (!this.isPlatformAdmin(session.user.id)) fail('Platform administration is not permitted.', 403, 'FORBIDDEN');
    return session;
  }
  requireNativeSession(token) {
    const session = this.getSession(token);
    if (session.clientId !== 'praxis-browser') fail('Native browser login is required.', 401, 'UNAUTHENTICATED');
    return session;
  }
  protectLastAdmin(userId) {
    const enabledAdmin = this.db.prepare('SELECT 1 FROM auth_platform_admins a JOIN auth_users u ON u.id=a.user_id WHERE a.user_id=? AND u.enabled=1').get(userId);
    if (enabledAdmin && this.db.prepare('SELECT COUNT(*) AS n FROM auth_platform_admins a JOIN auth_users u ON u.id=a.user_id WHERE u.enabled=1').get().n <= 1) fail('The last enabled platform administrator must be preserved.', 409, 'LAST_ADMIN_REQUIRED');
  }
  auditControl(event, userId) {
    const actor = this.controlContext?.actor;
    this.audit({ event, userId: actor?.user.id ?? userId, clientId: actor?.clientId ?? 'platform-administrator', resourceId: userId, outcome: 'allowed' });
  }
  invalidateUserCredentials(userId) {
    const now = this.clock();
    this.db.prepare('DELETE FROM auth_sessions WHERE user_id=?').run(userId);
    this.db.prepare('DELETE FROM auth_codes WHERE grant_id IN (SELECT id FROM auth_grants WHERE user_id=?)').run(userId);
    this.db.prepare('UPDATE auth_tokens SET revoked_at=COALESCE(revoked_at,?) WHERE grant_id IN (SELECT id FROM auth_grants WHERE user_id=?)').run(now, userId);
    this.db.prepare('UPDATE auth_grants SET revoked_at=COALESCE(revoked_at,?) WHERE user_id=?').run(now, userId);
  }
  setPlatformAdmin({ userId, enabled } = {}) {
    identifier(userId, 'User');
    if (typeof enabled !== 'boolean') fail('Administrator status must be a boolean.');
    this.controlTransaction(() => {
      if (!this.db.prepare('SELECT 1 FROM auth_users WHERE id=?').get(userId)) fail('User not found.', 404, 'NOT_FOUND');
      if (enabled) this.db.prepare('INSERT OR IGNORE INTO auth_platform_admins VALUES(?,?)').run(userId, this.clock());
      else {
        this.protectLastAdmin(userId);
        this.db.prepare('DELETE FROM auth_platform_admins WHERE user_id=?').run(userId);
        this.db.prepare('DELETE FROM auth_sessions WHERE user_id=?').run(userId);
      }
      this.auditControl('platform.admin.updated', userId);
      this.changed({ type: 'platform_admin', userId });
    });
    return { userId, platformAdmin: enabled };
  }
  resetPassword({ userId, password } = {}) {
    identifier(userId, 'User');
    const digest = passwordDigest(password);
    this.controlTransaction(() => {
      if (!this.db.prepare('SELECT 1 FROM auth_users WHERE id=?').get(userId)) fail('User not found.', 404, 'NOT_FOUND');
      this.db.prepare('UPDATE auth_users SET password_hash=? WHERE id=?').run(digest, userId);
      this.invalidateUserCredentials(userId);
      this.auditControl('user.password_reset', userId);
      this.changed({ type: 'user_credentials', userId });
    });
    return { reset: true };
  }
  createUser({ id = randomUUID(), username, password }) {
    identifier(id); identifier(username, 'Username');
    const passwordHash = passwordDigest(password);
    try { this.db.prepare('INSERT INTO auth_users(id,username,password_hash) VALUES(?,?,?)').run(id, username, passwordHash); }
    catch (error) { if ((error.errcode & 255) === 19) fail('User or username already exists.', 409, 'CONFLICT'); throw error; }
    return { id, username };
  }
  limitUserRegistration(remote) {
    const now = this.clock(), period = 3600000;
    // Use the transport peer, never caller-controlled forwarding headers. A
    // reverse proxy shares this conservative limit across its visitors.
    const limits = [[`registration:peer:${hash(remote)}`, 5], ['registration:global', 100]];
    this.transaction(() => {
      this.db.prepare("DELETE FROM auth_login_attempts WHERE key LIKE 'registration:%' AND reset_at<=?").run(now);
      for (const [key, maximum] of limits) {
        const attempts = this.db.prepare('SELECT count,reset_at FROM auth_login_attempts WHERE key=?').get(key);
        if (attempts && attempts.count >= maximum) {
          const error = new AuthError('Account registration rate limit exceeded.', 429, 'RATE_LIMITED');
          error.retryAfter = Math.max(1, Math.ceil((attempts.reset_at - now) / 1000));
          throw error;
        }
      }
      for (const [key] of limits) this.db.prepare('INSERT INTO auth_login_attempts VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET count=count+1').run(key, 1, now + period);
    });
  }
  registerUser(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !['username', 'password', 'return_to'].includes(key))) fail('Registration contains unknown or invalid fields.');
    const username = typeof input.username === 'string' ? input.username.trim() : '';
    if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{2,63}$/.test(username)) fail('Username must contain 3 to 64 letters, numbers, dots, underscores or hyphens and start with a letter or number.');
    // Registration creates an identity only. App, space, resource and platform
    // privileges remain separately authorized, including for the first user.
    return this.controlTransaction(() => {
      const user = this.createUser({ username, password: input.password });
      this.audit({ event: 'user.registered', userId: user.id, outcome: 'allowed' });
      this.changed({ type: 'user', userId: user.id });
      return user;
    });
  }
  setUserEnabled(userId, enabled) {
    if (typeof enabled !== 'boolean') fail('Enabled must be a boolean.');
    identifier(userId, 'User');
    this.controlTransaction(() => {
      if (!this.db.prepare('SELECT 1 FROM auth_users WHERE id=?').get(userId)) fail('User not found.', 404, 'NOT_FOUND');
      if (!enabled) { this.protectLastAdmin(userId); this.invalidateUserCredentials(userId); }
      this.db.prepare('UPDATE auth_users SET enabled=? WHERE id=?').run(Number(enabled), userId);
      this.auditControl('user.enabled', userId);
      this.changed({ type: 'user', userId });
    });
  }
  setWebAccess(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !['userId', 'apps', 'workbench', 'prds', 'expiresAt'].includes(key))) fail('Web access contains unknown or invalid fields.');
    const { userId, apps, workbench, prds, expiresAt = null } = input;
    identifier(userId, 'User');
    if (!Array.isArray(apps) || apps.length > this.webAppIds.length || new Set(apps).size !== apps.length || apps.some(app => !this.webAppIds.includes(app)) || workbench !== undefined && typeof workbench !== 'boolean' || typeof prds !== 'boolean') fail('Web access requires explicit supported applications and boolean entry permissions.');
    if (expiresAt !== null && (!Number.isSafeInteger(expiresAt) || expiresAt <= this.clock())) fail('Web access expiry must be null or a future timestamp.');
    const normalized = this.webAppIds.filter(app => apps.includes(app));
    this.controlTransaction(() => {
      if (!this.db.prepare('SELECT 1 FROM auth_users WHERE id=?').get(userId)) fail('User not found.', 404, 'NOT_FOUND');
      let previous = null;
      if (this.webAccessBoundary.enabled) {
        try { previous = this.getWebEntryPolicy(userId); }
        catch (error) { if (error.code !== 'UNAVAILABLE') throw error; previous = { expiresAt: 0 }; }
      }
      this.db.prepare('INSERT INTO auth_web_access VALUES(?,?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET apps=excluded.apps,workbench=excluded.workbench,prds=excluded.prds,expires_at=excluded.expires_at,updated_at=excluded.updated_at').run(userId, JSON.stringify(normalized), 1, Number(prds), expiresAt, this.clock());
      if (this.webAccessBoundary.enabled && !this.isPlatformAdmin(userId)) {
        for (const grant of this.db.prepare('SELECT id,rules FROM auth_grants WHERE user_id=? AND revoked_at IS NULL AND expires_at>?').all(userId, this.clock())) {
          const retained = previous?.expiresAt !== null && previous?.expiresAt <= this.clock() ? [] : this.effectiveRules(userId, JSON.parse(grant.rules));
          if (retained.length) this.db.prepare('UPDATE auth_grants SET rules=? WHERE id=?').run(JSON.stringify(retained), grant.id);
          else this.revokeGrant(grant.id);
        }
      }
      this.auditControl('web.access.updated', userId);
      this.changed({ type: 'web_access', userId });
    });
    return { userId, apps: normalized, workbench: true, prds, expiresAt };
  }
  getWebEntryPolicy(userId) {
    const row = this.db.prepare('SELECT * FROM auth_web_access WHERE user_id=?').get(userId);
    if (!row) return null;
    let apps;
    try { apps = JSON.parse(row.apps); } catch { fail('Web entry policy is unavailable.', 503, 'UNAVAILABLE'); }
    if (!Array.isArray(apps) || apps.length > 128 || new Set(apps).size !== apps.length || apps.some(app => typeof app !== 'string' || !/^[a-z][a-z0-9-]{0,79}$/.test(app)) || ![0, 1].includes(row.workbench) || ![0, 1].includes(row.prds) || row.expires_at !== null && (!Number.isSafeInteger(row.expires_at) || row.expires_at <= 0)) fail('Web entry policy is unavailable.', 503, 'UNAVAILABLE');
    return { apps: this.webAppIds.filter(app => apps.includes(app)), prds: Boolean(row.prds), expiresAt: row.expires_at };
  }
  getWebAccess(token) {
    const session = this.getSession(token);
    if (session.clientId !== 'praxis-browser') fail('Native browser login is required.', 401, 'UNAUTHENTICATED');
    const base = { userId: session.user.id, username: session.user.username, workbench: true, expiresAt: session.expiresAt, csrfToken: session.csrfToken };
    if (this.isPlatformAdmin(session.user.id)) return { ...base, userId: session.user.id, apps: [...this.webAppIds], prds: true, permissionsExpireAt: null, platformAdmin: true };
    const policy = this.getWebEntryPolicy(session.user.id);
    if (!policy || policy.expiresAt !== null && policy.expiresAt <= this.clock()) return { ...base, apps: this.currentWebApps(session.user.id), prds: false, permissionsExpireAt: null, platformAdmin: false };
    return { ...base, apps: this.currentWebApps(session.user.id), prds: policy.prds, permissionsExpireAt: policy.expiresAt, platformAdmin: false };
  }
  configureWebAccessBoundary({ enabled = false, apps = {} } = {}) {
    if (typeof enabled !== 'boolean' || !apps || typeof apps !== 'object' || Array.isArray(apps)) fail('Web access boundary configuration is invalid.');
    this.webAccessBoundary = { enabled, apps: Object.fromEntries(Object.entries(apps).filter(([id]) => Boolean(this.registry.getBusiness(id))).map(([id, app]) => [id, new Set(app?.spaces || [])])) };
  }
  appSpaceEnabled(appId, spaceId, installedApps = this.webAccessBoundary.apps) {
    if (!this.registry.getBusiness(appId) || !Object.hasOwn(installedApps, appId)) return false;
    const enrollment = this.db.prepare('SELECT enabled FROM auth_space_apps WHERE space_id=? AND app_id=?').get(spaceId, appId);
    if (enrollment) return enrollment.enabled === 1;
    const settings = installedApps[appId], spaces = settings instanceof Set ? settings : settings?.spaces;
    return spaces instanceof Set ? spaces.has(spaceId) : Array.isArray(spaces) && spaces.includes(spaceId);
  }
  selfServiceSpace(spaceId) { return Boolean(this.db.prepare('SELECT 1 FROM auth_self_service_spaces WHERE space_id=?').get(spaceId)); }
  currentWebApps(userId) {
    if (this.isPlatformAdmin(userId)) return [...this.webAppIds];
    const policy = this.getWebEntryPolicy(userId);
    const legacy = policy && (policy.expiresAt === null || policy.expiresAt > this.clock()) ? policy.apps : [];
    const enrolled = this.db.prepare('SELECT space_id,app_id FROM auth_space_apps WHERE enabled=1').all()
      .filter(row => this.appSpaceEnabled(row.app_id, row.space_id) && this.appActions[row.app_id]?.some(action => this.userPermissions(userId, row.space_id, row.app_id, action).length))
      .map(row => this.registry.webId(row.app_id));
    return unique([...legacy, ...enrolled]);
  }
  webBoundaryAllows(userId, spaceId, appId) {
    if (appId === 'spaces' && this.selfServiceSpace(spaceId)) return this.membershipRole(userId, spaceId) === 'owner';
    const override = this.db.prepare('SELECT enabled FROM auth_space_apps WHERE space_id=? AND app_id=?').get(spaceId, appId);
    if (override) return this.appSpaceEnabled(appId, spaceId);
    if (!this.webAccessBoundary.enabled) return true;
    const policy = this.getWebEntryPolicy(userId);
    const allowed = this.isPlatformAdmin(userId) ? this.webAppIds : policy && (policy.expiresAt === null || policy.expiresAt > this.clock()) ? policy.apps : [];
    const configured = this.webAccessBoundary.apps;
    if (appId === 'spaces') return Object.keys(configured).some(id => allowed.includes(this.registry.webId(id)) && this.appSpaceEnabled(id, spaceId));
    return allowed.includes(this.registry.webId(appId)) && this.appSpaceEnabled(appId, spaceId);
  }
  createSelfServiceSpace({ type, ownerId }) {
    if (!['personal', 'family', 'company'].includes(type)) fail('Unknown business space type.');
    return this.controlTransaction(() => {
      const id = randomUUID();
      this.db.prepare('INSERT INTO auth_spaces VALUES(?,?,?)').run(id, type, ownerId);
      this.db.prepare('INSERT INTO auth_self_service_spaces VALUES(?)').run(id);
      this.db.prepare('INSERT INTO auth_members VALUES(?,?,?)').run(id, ownerId, 'owner');
      this.audit({ event: 'space.created', userId: ownerId, spaceId: id, outcome: 'allowed' });
      this.changed({ type: 'space', spaceId: id });
      return { id, type, ownerId };
    });
  }
  setSpaceAppEnrollment({ spaceId, appId, enabled }, installedApps = this.webAccessBoundary.apps) {
    if (typeof enabled !== 'boolean' || !this.registry.getBusiness(appId) || !Object.hasOwn(installedApps, appId)) fail('Application is not installed.', 403, 'FORBIDDEN');
    if (!this.db.prepare('SELECT 1 FROM auth_spaces WHERE id=?').get(spaceId)) fail('Space not found.', 404, 'NOT_FOUND');
    return this.controlTransaction(() => {
      this.db.prepare('INSERT INTO auth_space_apps VALUES(?,?,?) ON CONFLICT(space_id,app_id) DO UPDATE SET enabled=excluded.enabled').run(spaceId, appId, Number(enabled));
      if (!enabled) {
        this.db.prepare('DELETE FROM auth_resources WHERE space_id=? AND app_id=?').run(spaceId, appId);
        for (const grant of this.db.prepare('SELECT id,rules FROM auth_grants WHERE revoked_at IS NULL').all()) {
          const original = JSON.parse(grant.rules), retained = original.filter(rule => rule.spaceId !== spaceId || rule.appId !== appId);
          if (retained.length === original.length) continue;
          if (retained.length) this.db.prepare('UPDATE auth_grants SET rules=? WHERE id=?').run(JSON.stringify(retained), grant.id);
          else this.revokeGrant(grant.id);
        }
      }
      this.changed({ type: 'space_enrollment', spaceId, appId });
      return { spaceId, appId, enabled };
    });
  }
  webPermissionExpiry(userId) {
    if (!this.webAccessBoundary.enabled || this.isPlatformAdmin(userId)) return Infinity;
    const policy = this.getWebEntryPolicy(userId);
    return policy?.expiresAt > this.clock() ? policy.expiresAt : Infinity;
  }
  effectiveRules(userId, rules) {
    return rules.flatMap(rule => rule.actions.flatMap(action => {
      const resources = unique(intersect(this.userPermissions(userId, rule.spaceId, rule.appId, action), rule.resources));
      return resources.length && (action !== 'create' || resources.includes('*') || this.targetedCreateApps.has(rule.appId)) ? [{ appId: rule.appId, spaceId: rule.spaceId, actions: [action], resources }] : [];
    }));
  }
  accountAccess(token) {
    const session = this.requireNativeSession(token), web = this.getWebAccess(token), rules = this.availableRules(session.user.id);
    const capabilities = web.apps.map(appId => {
      const businessAppId = this.registry.businessId(appId);
      const matches = rules.filter(rule => rule.appId === businessAppId), supported = Boolean(this.registry.getBusiness(businessAppId)), configured = Object.hasOwn(this.webAccessBoundary.apps, businessAppId);
      const allResources = matches.some(rule => rule.resources.includes('*'));
      return { appId, name: this.registry.getApp(appId)?.name || appId, availability: !supported ? 'unsupported' : this.webAccessBoundary.enabled && !configured ? 'unavailable' : matches.length ? 'available' : 'no_resources', actions: unique(matches.flatMap(rule => rule.actions)), spaceCount: unique(matches.map(rule => rule.spaceId)).length, resourceCount: allResources ? null : unique(matches.flatMap(rule => rule.resources.map(id => JSON.stringify([rule.spaceId, id])))).length, allResources };
    });
    return { access: { apps: web.apps, prds: web.prds, expiresAt: web.permissionsExpireAt }, capabilities };
  }
  createSpace({ id = randomUUID(), type, ownerId }) {
    identifier(id); identifier(ownerId);
    if (!['personal', 'family', 'company'].includes(type)) fail('Unknown business space type.');
    this.transaction(() => {
      this.db.prepare('INSERT INTO auth_spaces(id,type,owner_id) VALUES(?,?,?)').run(id, type, ownerId);
      this.db.prepare('INSERT INTO auth_members(space_id,user_id,role) VALUES(?,?,?)').run(id, ownerId, 'owner');
    });
    this.changed({ type: 'space', spaceId: id });
    return { id, type, ownerId };
  }
  setMembership({ spaceId, userId, role }) {
    const space = this.db.prepare('SELECT * FROM auth_spaces WHERE id=?').get(spaceId);
    if (!space) fail('Space not found.', 404, 'NOT_FOUND');
    if (space.owner_id === userId && role !== 'owner') fail('The space owner cannot be removed or downgraded.', 409, 'OWNER_REQUIRED');
    if (role === null || role === undefined) {
      this.controlTransaction(() => {
        this.db.prepare('DELETE FROM auth_members WHERE space_id=? AND user_id=?').run(spaceId, userId);
        this.db.prepare('DELETE FROM auth_resources WHERE space_id=? AND user_id=? AND membership_required=1').run(spaceId, userId);
        for (const grant of this.listGrants(userId)) {
          if (!grant.revoked && grant.rules.some(rule => rule.spaceId === spaceId)) {
            const retained = grant.rules.filter(rule => rule.spaceId !== spaceId);
            if (retained.length) this.db.prepare('UPDATE auth_grants SET rules=? WHERE id=?').run(JSON.stringify(retained), grant.id);
            else this.db.prepare('UPDATE auth_grants SET revoked_at=? WHERE id=?').run(this.clock(), grant.id);
          }
        }
      });
    }
    else {
      if (!['owner', 'admin', 'member'].includes(role) || (role === 'owner' && space.owner_id !== userId)) fail('Membership role is invalid.');
      if (space.type === 'personal' && userId !== space.owner_id) fail('Personal spaces cannot have other members.', 403, 'FORBIDDEN');
      this.db.prepare('INSERT INTO auth_members(space_id,user_id,role) VALUES(?,?,?) ON CONFLICT(space_id,user_id) DO UPDATE SET role=excluded.role').run(spaceId, userId, role);
    }
    this.changed({ type: 'membership', userId, spaceId });
  }
  grantResource({ userId, spaceId, appId, resources, actions, expiresAt }) {
    const [rule] = this.normalizeRules([{ spaceId, appId, resources, actions }]);
    if (appId === 'spaces') fail('Space management rights require a current owner or administrator membership.', 403, 'FORBIDDEN');
    if (!this.db.prepare('SELECT 1 FROM auth_users WHERE id=?').get(userId)) fail('User not found.', 404, 'NOT_FOUND');
    const space = this.db.prepare('SELECT * FROM auth_spaces WHERE id=?').get(spaceId);
    if (!space) fail('Space not found.', 404, 'NOT_FOUND');
    const member = this.db.prepare('SELECT role FROM auth_members WHERE user_id=? AND space_id=?').get(userId, spaceId);
    if (!member && rule.resources.includes('*')) fail('External guests require explicit resource identifiers.', 403, 'FORBIDDEN');
    const expiry = expiresAt === undefined && member ? null : timestamp(expiresAt, this.clock() + 7 * DAY);
    if (expiry !== null && expiry <= this.clock()) fail('Resource permission must expire in the future.');
    const id = randomUUID();
    this.db.prepare('INSERT INTO auth_resources VALUES(?,?,?,?,?,?,?,?)').run(id, userId, spaceId, appId, JSON.stringify(rule.resources), JSON.stringify(rule.actions), expiry, Number(Boolean(member)));
    this.changed({ type: 'resource', userId, spaceId });
    return { id, userId, ...rule, expiresAt: expiry };
  }
  revokeResource(id) {
    this.db.prepare('DELETE FROM auth_resources WHERE id=?').run(id);
    this.changed({ type: 'resource', id });
  }
  createClient({ id = randomUUID(), name, redirectUris }) {
    identifier(id); identifier(name, 'Client name');
    if (!Array.isArray(redirectUris) || redirectUris.length < 1 || redirectUris.length > 10) fail('Client requires between one and ten redirect URIs.');
    const uris = unique(redirectUris.map(validateRedirect));
    const existing = this.db.prepare('SELECT * FROM auth_clients WHERE id=?').get(id);
    if (existing) {
      if (existing.name !== name || existing.redirect_uris !== JSON.stringify(uris)) fail('Client already exists with different metadata.', 409, 'CONFLICT');
      return { id, name, redirectUris: uris };
    }
    this.db.prepare('INSERT INTO auth_clients VALUES(?,?,?)').run(id, name, JSON.stringify(uris));
    return { id, name, redirectUris: uris };
  }
  normalizeRules(rules) { return normalizeRules(rules, this.appActions); }
  membershipRole(userId, spaceId) {
    return this.db.prepare('SELECT role FROM auth_members WHERE user_id=? AND space_id=?').get(userId, spaceId)?.role || null;
  }
  subjectReadScope(userId, { appId, spaceId, resourceId }) {
    identifier(userId, 'Subject');
    const resources = this.userPermissions(userId, spaceId, appId, 'read');
    if (!resources.includes('*') && !resources.includes(resourceId)) return null;
    const member = this.membershipRole(userId, spaceId);
    const expiries = ['owner', 'admin'].includes(member) && !this.selfServiceSpace(spaceId) ? [] : this.db.prepare('SELECT * FROM auth_resources WHERE user_id=? AND space_id=? AND app_id=?').all(userId, spaceId, appId)
      .filter(row => (!row.membership_required || member) && (row.expires_at === null || row.expires_at > this.clock()) && JSON.parse(row.actions).includes('read') && (JSON.parse(row.resources).includes('*') || JSON.parse(row.resources).includes(resourceId)))
      .map(row => row.expires_at ?? Infinity);
    return { expiresAt: Math.min(this.webPermissionExpiry(userId), ...expiries) };
  }
  userPermissions(userId, spaceId, appId, action) {
    if (!Object.hasOwn(this.appActions, appId) || !this.appActions[appId].includes(action) || !this.db.prepare('SELECT 1 FROM auth_users WHERE id=? AND enabled=1').get(userId)) return [];
    if (!this.webBoundaryAllows(userId, spaceId, appId)) return [];
    const member = this.db.prepare('SELECT role FROM auth_members WHERE user_id=? AND space_id=?').get(userId, spaceId);
    const business = this.registry.getBusiness(appId), roles = business?.actionRoles?.[action] || (business?.ownerOnlyActions?.includes(action) ? ['owner'] : null);
    if (roles && !roles.includes(member?.role)) return [];
    if (member && ['owner', 'admin'].includes(member.role) && (!this.selfServiceSpace(spaceId) || appId === 'spaces' && member.role === 'owner')) return ['*'];
    if (appId === 'spaces') return [];
    const rows = this.db.prepare('SELECT * FROM auth_resources WHERE user_id=? AND space_id=? AND app_id=?').all(userId, spaceId, appId);
    const resources = rows.filter(row => (!row.membership_required || member) && (row.expires_at === null || row.expires_at > this.clock()) && JSON.parse(row.actions).includes(action)).flatMap(row => JSON.parse(row.resources));
    return resources.includes('*') ? ['*'] : unique(resources);
  }
  availableRules(userId, requested = this.appActions) {
    const rules = [];
    for (const space of this.db.prepare('SELECT id FROM auth_spaces').all()) {
      for (const [appId, actions] of Object.entries(requested)) {
        for (const action of actions) {
          const resources = this.userPermissions(userId, space.id, appId, action);
          if (resources.length) rules.push({ appId, spaceId: space.id, resources, actions: [action] });
        }
      }
    }
    return rules;
  }
  createGrant({ userId, clientId, rules, expiresAt }) {
    identifier(userId); identifier(clientId);
    const normalized = this.normalizeRules(rules);
    const expiry = timestamp(expiresAt, this.clock() + 7 * DAY);
    if (expiry <= this.clock() || expiry > this.clock() + maximumGrantAge) fail('Delegation expiry must be in the future and at most thirty days away.');
    if (!this.db.prepare('SELECT 1 FROM auth_clients WHERE id=?').get(clientId)) fail('Client not found.', 404, 'NOT_FOUND');
    for (const rule of normalized) {
      for (const action of rule.actions) {
        const allowed = this.userPermissions(userId, rule.spaceId, rule.appId, action);
        if (!allowed.includes('*') && (rule.resources.includes('*') || rule.resources.some(resource => !allowed.includes(resource)))) fail('Delegation exceeds current user resource permissions.', 403, 'FORBIDDEN');
      }
    }
    const id = randomUUID();
    this.db.prepare('INSERT INTO auth_grants VALUES(?,?,?,?,?,NULL,?)').run(id, userId, clientId, JSON.stringify(normalized), expiry, this.clock());
    this.audit({ event: 'grant.created', userId, clientId, grantId: id, outcome: 'allowed' });
    this.changed({ type: 'grant', grantId: id, userId });
    return { id, userId, clientId, rules: normalized, expiresAt: expiry };
  }
  getGrant(id) {
    const grant = this.db.prepare('SELECT g.*,u.enabled FROM auth_grants g JOIN auth_users u ON u.id=g.user_id WHERE g.id=?').get(id);
    if (!grant || !grant.enabled || grant.revoked_at !== null || grant.expires_at <= this.clock()) fail('Credential is invalid, expired, or revoked.', 401, 'UNAUTHENTICATED');
    const rules = this.webAccessBoundary.enabled ? this.effectiveRules(grant.user_id, JSON.parse(grant.rules)) : JSON.parse(grant.rules);
    if (!rules.length) fail('Delegation has no currently permitted operations.', 401, 'UNAUTHENTICATED');
    return { id: grant.id, userId: grant.user_id, clientId: grant.client_id, rules, expiresAt: Math.min(grant.expires_at, this.webPermissionExpiry(grant.user_id)) };
  }
  listGrants(userId) {
    return this.db.prepare('SELECT id,client_id,rules,expires_at,revoked_at FROM auth_grants WHERE user_id=? ORDER BY created_at DESC').all(userId).map(row => ({ id: row.id, clientId: row.client_id, rules: JSON.parse(row.rules), expiresAt: row.expires_at, revoked: row.revoked_at !== null }));
  }
  issueToken({ grantId, ttlSeconds = 3600, type = 'access', family = null }) {
    const grant = this.getGrant(grantId);
    if (!Number.isInteger(ttlSeconds) || ttlSeconds < 1 || ttlSeconds > (type === 'refresh' ? 30 * 86400 : 3600) || !['access', 'refresh'].includes(type)) fail('Token lifetime or type is invalid.');
    const token = randomToken(type === 'access' ? 'pxa' : 'pxr');
    const expiry = Math.min(grant.expiresAt, this.clock() + ttlSeconds * 1000);
    this.db.prepare('INSERT INTO auth_tokens VALUES(?,?,?,?,?,?,NULL,?)').run(hash(token), type, grantId, grant.clientId, this.resource, expiry, family);
    return { accessToken: token, tokenType: 'Bearer', expiresIn: Math.floor((expiry - this.clock()) / 1000), expiresAt: expiry };
  }
  authenticate(token) {
    if (typeof token !== 'string' || token.length > 200) fail('A valid credential is required.', 401, 'UNAUTHENTICATED');
    if (token.startsWith('pxs_')) {
      const session = this.getSession(token);
      const administrator = this.isPlatformAdmin(session.user.id);
      if (session.clientId === 'praxis-browser' && (administrator || this.webAccessBoundary.enabled)) return { userId: session.user.id, clientId: session.clientId, grantId: `first-party-${createHmac('sha256', this.auditKey).update(`native-browser:${hash(token)}`).digest('hex').slice(0, 48)}`, expiresAt: Math.min(session.expiresAt, this.webPermissionExpiry(session.user.id)), firstPartyAdmin: administrator, firstPartyNative: true };
      if (!session.grantId) fail('Explicit browser delegation is required.', 403, 'DELEGATION_REQUIRED');
      const grant = this.getGrant(session.grantId);
      if (grant.userId !== session.user.id || grant.clientId !== session.clientId) fail('Session delegation is invalid.', 401, 'UNAUTHENTICATED');
      return { userId: grant.userId, clientId: grant.clientId, grantId: grant.id, expiresAt: Math.min(grant.expiresAt, session.expiresAt) };
    }
    const row = this.db.prepare('SELECT * FROM auth_tokens WHERE hash=? AND type=?').get(hash(token), 'access');
    if (!row || row.revoked_at !== null || row.expires_at <= this.clock() || row.audience !== this.resource) fail('Credential is invalid, expired, or revoked.', 401, 'UNAUTHENTICATED');
    const grant = this.getGrant(row.grant_id);
    if (grant.clientId !== row.client_id) fail('Credential binding is invalid.', 401, 'UNAUTHENTICATED');
    return { userId: grant.userId, clientId: grant.clientId, grantId: grant.id, expiresAt: Math.min(row.expires_at, grant.expiresAt) };
  }
  authorize(token, { appId, spaceId, action, resourceId } = {}, { auditDenied = true } = {}) {
    const actor = this.authenticate(token);
    identifier(appId, 'Application'); identifier(spaceId, 'Space'); identifier(action, 'Action');
    if (resourceId !== undefined) identifier(resourceId, 'Resource');
    const userResources = this.userPermissions(actor.userId, spaceId, appId, action);
    const delegated = actor.firstPartyNative || actor.firstPartyAdmin ? userResources : this.getGrant(actor.grantId).rules.filter(rule => rule.appId === appId && rule.spaceId === spaceId && rule.actions.includes(action)).flatMap(rule => rule.resources);
    const resources = unique(intersect(userResources, delegated.includes('*') ? ['*'] : delegated));
    const allowed = resources.length && (resourceId === undefined || resources.includes('*') || resources.includes(resourceId)) && (action !== 'create' || resources.includes('*') || this.targetedCreateApps.has(appId));
    if (!allowed) {
      if (auditDenied !== false) this.audit({ event: 'authorization', ...actor, appId, spaceId, action, resourceId, outcome: 'denied', reason: 'scope' });
      fail('The requested business operation is not permitted.', 403, 'FORBIDDEN');
    }
    const membership = this.db.prepare('SELECT role FROM auth_members WHERE user_id=? AND space_id=?').get(actor.userId, spaceId);
    const permissionExpiries = membership && ['owner', 'admin'].includes(membership.role) && (!this.selfServiceSpace(spaceId) || appId === 'spaces') ? [] : this.db.prepare('SELECT * FROM auth_resources WHERE user_id=? AND space_id=? AND app_id=?').all(actor.userId, spaceId, appId).filter(row => (!row.membership_required || membership) && (row.expires_at === null || row.expires_at > this.clock()) && JSON.parse(row.actions).includes(action) && intersect(JSON.parse(row.resources), resourceId === undefined ? resources : [resourceId]).length).map(row => row.expires_at ?? Infinity);
    return { ...actor, appId, spaceId, resources, actions: [action], expiresAt: Math.min(actor.expiresAt, ...permissionExpiries) };
  }
  revokeGrant(id) {
    this.controlTransaction(() => {
      this.db.prepare('UPDATE auth_grants SET revoked_at=COALESCE(revoked_at,?) WHERE id=?').run(this.clock(), id);
      this.db.prepare('UPDATE auth_tokens SET revoked_at=COALESCE(revoked_at,?) WHERE grant_id=?').run(this.clock(), id);
      this.audit({ event: 'grant.revoked', grantId: id, outcome: 'allowed' });
      this.changed({ type: 'revoke', grantId: id });
    });
  }
  revokeGrantSpace(id, spaceId) {
    const grant = this.getGrant(id);
    const retained = grant.rules.filter(rule => rule.spaceId !== spaceId);
    if (retained.length === grant.rules.length) fail('Delegation not found in this space.', 404, 'NOT_FOUND');
    if (!retained.length) this.revokeGrant(id);
    else {
      this.db.prepare('UPDATE auth_grants SET rules=? WHERE id=?').run(JSON.stringify(retained), id);
      this.audit({ event: 'grant.space_revoked', grantId: id, spaceId, outcome: 'allowed' });
      this.changed({ type: 'revoke', grantId: id, spaceId });
    }
  }
  listSpaces(token) {
    const actor = this.authenticate(token);
    const rules = actor.firstPartyNative || actor.firstPartyAdmin ? this.availableRules(actor.userId) : this.getGrant(actor.grantId).rules;
    const ids = unique(rules.filter(rule => rule.actions.some(action => intersect(this.userPermissions(actor.userId, rule.spaceId, rule.appId, action), rule.resources).length)).map(rule => rule.spaceId));
    return ids.map(id => {
      const space = this.db.prepare('SELECT id,type FROM auth_spaces WHERE id=?').get(id);
      const member = this.db.prepare('SELECT role FROM auth_members WHERE user_id=? AND space_id=?').get(actor.userId, id);
      return { ...space, role: member?.role ?? 'guest' };
    });
  }
  audit({ event, userId, clientId, grantId, spaceId, appId, action, resourceId, outcome, reason } = {}) {
    identifier(event, 'Audit event');
    if (!['allowed', 'denied', 'failed'].includes(outcome)) fail('Audit outcome is invalid.');
    const pseudonym = value => value === undefined ? null : createHmac('sha256', this.auditKey).update(String(value)).digest('hex').slice(0, 24);
    const id = randomUUID();
    this.db.prepare('INSERT INTO auth_audit VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(id, this.clock(), event, pseudonym(userId), pseudonym(clientId), pseudonym(grantId), pseudonym(spaceId), appId ?? null, action ?? null, pseudonym(resourceId), outcome, reason ?? null);
    return id;
  }
  listAudit({ limit = 100 } = {}) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 1000) fail('Audit limit must be between one and one thousand.');
    return this.db.prepare('SELECT * FROM auth_audit ORDER BY rowid DESC LIMIT ?').all(limit);
  }
  login({ username, password, clientId = 'praxis-browser' }) {
    if (typeof username !== 'string' || typeof password !== 'string' || username.length > 200 || password.length > 1024) fail('Username or password is incorrect.', 401, 'INVALID_CREDENTIALS');
    const attemptKey = hash(username.toLowerCase());
    this.transaction(() => {
      const attempts = this.db.prepare('SELECT count,reset_at FROM auth_login_attempts WHERE key=?').get(attemptKey);
      if (attempts && attempts.reset_at > this.clock() && attempts.count >= 10) fail('Login attempt limit exceeded; try again later.', 429, 'RATE_LIMITED');
      this.db.prepare('INSERT INTO auth_login_attempts VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET count=excluded.count,reset_at=excluded.reset_at').run(attemptKey, attempts && attempts.reset_at > this.clock() ? attempts.count + 1 : 1, attempts && attempts.reset_at > this.clock() ? attempts.reset_at : this.clock() + 900000);
    });
    const user = this.db.prepare('SELECT * FROM auth_users WHERE username=? COLLATE NOCASE').get(username);
    const [salt, expected] = (user?.password_hash ?? `${'0'.repeat(32)}:${'0'.repeat(128)}`).split(':');
    const actual = scryptSync(password, salt, 64);
    if (!timingSafeEqual(actual, Buffer.from(expected, 'hex')) || !user?.enabled) fail('Username or password is incorrect.', 401, 'INVALID_CREDENTIALS');
    this.db.prepare('DELETE FROM auth_login_attempts WHERE key=?').run(attemptKey);
    if (!this.db.prepare('SELECT 1 FROM auth_clients WHERE id=?').get(clientId)) fail('Client not found.', 404, 'NOT_FOUND');
    const token = randomToken('pxs');
    const csrfToken = randomToken('pxc');
    const grant = this.db.prepare('SELECT id FROM auth_grants WHERE user_id=? AND client_id=? AND revoked_at IS NULL AND expires_at>? ORDER BY created_at DESC LIMIT 1').get(user.id, clientId, this.clock());
    const expiresAt = this.clock() + 8 * 3600000;
    this.db.prepare('INSERT INTO auth_sessions VALUES(?,?,?,?,?,?)').run(hash(token), user.id, clientId, grant?.id ?? null, csrfToken, expiresAt);
    this.audit({ event: 'session.created', userId: user.id, clientId, outcome: 'allowed' });
    return { sessionToken: token, csrfToken, expiresAt, user: { id: user.id, username: user.username } };
  }
  getSession(token) {
    if (typeof token !== 'string' || !token.startsWith('pxs_')) fail('Login is required.', 401, 'UNAUTHENTICATED');
    const row = this.db.prepare('SELECT s.*,u.username,u.enabled FROM auth_sessions s JOIN auth_users u ON u.id=s.user_id WHERE s.hash=?').get(hash(token));
    if (!row || !row.enabled || row.expires_at <= this.clock()) fail('Login is required.', 401, 'UNAUTHENTICATED');
    return { user: { id: row.user_id, username: row.username }, clientId: row.client_id, grantId: row.grant_id, csrfToken: row.csrf, expiresAt: row.expires_at };
  }
  browserAuthorization(token) {
    const session = this.getSession(token);
    let delegated = false;
    if (session.grantId) {
      try {
        const grant = this.getGrant(session.grantId);
        delegated = grant.userId === session.user.id && grant.clientId === session.clientId;
      } catch (error) { if (![401, 403].includes(error.status)) throw error; }
    }
    return { delegated, authorizationMode: session.clientId === 'praxis-browser' && this.isPlatformAdmin(session.user.id) ? 'administrator' : session.clientId === 'praxis-browser' && this.webAccessBoundary.enabled ? 'native' : delegated ? 'delegated' : 'none' };
  }
  delegateSession(token, { rules, expiresAt } = {}) {
    const session = this.getSession(token);
    if (session.clientId !== 'praxis-browser') fail('This session cannot delegate browser access.', 403, 'FORBIDDEN');
    const grant = this.createGrant({ userId: session.user.id, clientId: session.clientId, rules, expiresAt });
    this.db.prepare('UPDATE auth_sessions SET grant_id=? WHERE hash=?').run(grant.id, hash(token));
    return grant;
  }
  logout(token) {
    if (typeof token === 'string') this.db.prepare('DELETE FROM auth_sessions WHERE hash=?').run(hash(token));
    this.changed({ type: 'session' });
  }
  verifyCsrf(token, supplied) {
    const session = this.getSession(token);
    if (typeof supplied !== 'string' || supplied.length !== session.csrfToken.length || !timingSafeEqual(Buffer.from(supplied), Buffer.from(session.csrfToken))) fail('The browser request could not be verified.', 403, 'CSRF_REJECTED');
    return session;
  }
  createConsent(token, rules, context) {
    this.getSession(token);
    const payload = Buffer.from(JSON.stringify({ session: hash(token), rules, context, at: this.clock() })).toString('base64url');
    const signature = createHmac('sha256', this.auditKey).update(`consent:${payload}`).digest('base64url');
    return `${payload}.${signature}`;
  }
  consentRules(token, input, context) {
    if (input.rules !== undefined) return this.normalizeRules(input.rules);
    if (typeof input.consent !== 'string' || input.consent.length > 60000) fail('Consent form is missing or expired.', 403, 'CONSENT_REQUIRED');
    const [payload, signature, extra] = input.consent.split('.');
    const expected = createHmac('sha256', this.auditKey).update(`consent:${payload}`).digest('base64url');
    if (extra !== undefined || typeof signature !== 'string' || signature.length !== expected.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) fail('Consent form could not be verified.', 403, 'CONSENT_REQUIRED');
    let consent;
    try { consent = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')); } catch { fail('Consent form could not be verified.', 403, 'CONSENT_REQUIRED'); }
    if (consent.session !== hash(token) || consent.context !== context || consent.at > this.clock() || consent.at + 600000 <= this.clock()) fail('Consent form is missing or expired.', 403, 'CONSENT_REQUIRED');
    const selected = consent.rules.filter((rule, index) => input[`rule_${index}`] === '1');
    if (!selected.length) fail('Select at least one permission to authorize this agent.', 400, 'EMPTY_CONSENT');
    return this.normalizeRules(selected);
  }
  requireRequestCsrf(request) {
    if (request.headers?.authorization !== undefined) { credentialFromRequest(request); return; }
    this.verifyCsrf(credentialFromRequest(request), request.headers?.['x-csrf-token']);
    if (request.headers?.origin !== new URL(this.issuer).origin) fail('The browser request origin is not allowed.', 403, 'ORIGIN_REJECTED');
  }
  authorizationRequest(parameters) {
    const clientId = parameters.get('client_id');
    const client = this.db.prepare('SELECT * FROM auth_clients WHERE id=?').get(clientId);
    const redirectUri = parameters.get('redirect_uri');
    if (!client || !JSON.parse(client.redirect_uris).includes(redirectUri)) fail('Client or redirect URI is not registered.', 400, 'INVALID_CLIENT');
    if (parameters.get('response_type') !== 'code' || parameters.get('code_challenge_method') !== 'S256' || !/^[A-Za-z0-9_-]{43}$/.test(parameters.get('code_challenge') ?? '')) fail('Authorization requires code response and PKCE S256.', 400, 'INVALID_REQUEST');
    if (parameters.get('resource') !== this.resource) fail('Resource audience does not match this MCP service.', 400, 'INVALID_TARGET');
    const defaultScope = Object.entries(this.scopes).find(([, value]) => value.actions.includes('read'))?.[0] || '';
    const scopes = unique((parameters.get('scope') || defaultScope).split(/\s+/).filter(Boolean));
    if (scopes.some(scope => !Object.hasOwn(this.scopes, scope))) fail('Requested scope is unsupported.', 400, 'INVALID_SCOPE');
    const requested = {};
    for (const scope of scopes) { const definition = this.scopes[scope]; requested[definition.appId] = unique([...(requested[definition.appId] ?? []), ...definition.actions]); }
    const state = parameters.get('state');
    if (state !== null && state.length > 2048) fail('OAuth state is too long.');
    return { clientId, clientName: client.name, redirectUri, challenge: parameters.get('code_challenge'), resource: this.resource, scopes, requested, state };
  }
  createAuthorizationCode({ request, userId, rules }) {
    const allowedActions = request.requested;
    const normalized = this.normalizeRules(rules);
    if (normalized.some(rule => rule.actions.some(action => !allowedActions[rule.appId]?.includes(action)))) fail('Consent cannot expand requested OAuth scopes.', 403, 'FORBIDDEN');
    const grant = this.createGrant({ userId, clientId: request.clientId, rules: normalized });
    const code = randomToken('pxc');
    this.db.prepare('INSERT INTO auth_codes VALUES(?,?,?,?,?,?,?,NULL)').run(hash(code), grant.id, request.clientId, request.redirectUri, request.challenge, request.resource, this.clock() + 120000);
    return { code, grantId: grant.id };
  }
  exchangeCode({ code, clientId, redirectUri, verifier, resource }) {
    if (typeof code !== 'string' || code.length > 200 || typeof verifier !== 'string' || !/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) fail('Authorization code or verifier is invalid.', 400, 'INVALID_GRANT');
    return this.transaction(() => {
      const row = this.db.prepare('SELECT * FROM auth_codes WHERE hash=?').get(hash(code));
      if (!row || row.used_at !== null || row.expires_at <= this.clock() || row.client_id !== clientId || row.redirect_uri !== redirectUri || row.audience !== resource || resource !== this.resource || hashVerifier(verifier) !== row.challenge) fail('Authorization code is invalid, expired, or already used.', 400, 'INVALID_GRANT');
      this.db.prepare('UPDATE auth_codes SET used_at=? WHERE hash=?').run(this.clock(), hash(code));
      return this.tokenPair(row.grant_id);
    });
  }
  tokenPair(grantId, family = randomUUID()) {
    if (this.webAccessBoundary.enabled) this.db.prepare('UPDATE auth_grants SET rules=? WHERE id=?').run(JSON.stringify(this.getGrant(grantId).rules), grantId);
    const access = this.issueToken({ grantId });
    const refresh = this.issueToken({ grantId, ttlSeconds: 7 * 86400, type: 'refresh', family });
    const grant = this.getGrant(grantId);
    const scopes = Object.entries(this.scopes).filter(([, definition]) => grant.rules.some(rule => rule.appId === definition.appId && rule.actions.some(action => definition.actions.includes(action)))).map(([scope]) => scope);
    return { access_token: access.accessToken, token_type: 'Bearer', expires_in: access.expiresIn, refresh_token: refresh.accessToken, scope: scopes.join(' ') };
  }
  refresh({ refreshToken, clientId, resource }) {
    if (typeof refreshToken !== 'string' || refreshToken.length > 200) fail('Refresh token is invalid.', 400, 'INVALID_GRANT');
    const result = this.transaction(() => {
      const row = this.db.prepare('SELECT * FROM auth_tokens WHERE hash=? AND type=?').get(hash(refreshToken), 'refresh');
      if (!row || row.client_id !== clientId || row.audience !== resource || resource !== this.resource || row.expires_at <= this.clock()) fail('Refresh token is invalid.', 400, 'INVALID_GRANT');
      if (row.revoked_at !== null) return { reusedGrant: row.grant_id };
      this.getGrant(row.grant_id);
      this.db.prepare('UPDATE auth_tokens SET revoked_at=? WHERE hash=? AND revoked_at IS NULL').run(this.clock(), hash(refreshToken));
      return this.tokenPair(row.grant_id, row.family);
    });
    if (result.reusedGrant) { this.revokeGrant(result.reusedGrant); fail('Refresh token reuse revoked this delegation.', 400, 'INVALID_GRANT'); }
    return result;
  }
}

export const hashVerifier = value => createHash('sha256').update(value).digest('base64url');

async function readBody(request) {
  let size = 0;
  const chunks = [];
  for await (const chunk of request) { size += chunk.length; if (size > 65536) fail('Authentication request exceeds 64KB.', 413, 'BODY_TOO_LARGE'); chunks.push(chunk); }
  const raw = Buffer.concat(chunks).toString('utf8');
  const type = (request.headers['content-type'] ?? '').split(';')[0].trim();
  if (type === 'application/x-www-form-urlencoded') return Object.fromEntries(new URLSearchParams(raw));
  if (type === 'application/json') {
    let value; try { value = JSON.parse(raw); } catch { fail('Request contains invalid JSON.'); }
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail('Request body must be an object.');
    return value;
  }
  fail('Authentication request requires JSON or form encoding.', 415, 'UNSUPPORTED_MEDIA_TYPE');
}
const contentSecurityPolicy = "default-src 'none'; img-src 'self'; manifest-src 'self'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'";
function send(response, status, value, type = 'application/json; charset=utf-8', headers = {}) {
  response.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', Pragma: 'no-cache', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin', 'Content-Security-Policy': contentSecurityPolicy, ...headers });
  response.end(type.startsWith('application/json') ? JSON.stringify(value) : value);
}
function page(title, content, language = 'zh') {
  return `<!doctype html><html lang="${language === 'zh' ? 'zh-CN' : 'en'}"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)} · Praxis</title><link rel="icon" href="/praxis-192.png?v=pine-6b4ddbd951" type="image/png"><link rel="apple-touch-icon" href="/praxis-180.png?v=pine-6b4ddbd951" sizes="180x180"><link rel="manifest" href="/manifest.webmanifest"><meta name="apple-mobile-web-app-title" content="Praxis"><style>body{font:15px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#f5f5f7;color:#1d1d1f;margin:0;padding:48px 20px}main{max-width:560px;margin:auto;background:#fff;border-radius:20px;padding:32px}h1{font-size:24px;margin:0 0 16px}label{display:block;margin:14px 0}input:not([type=checkbox]),button{font:inherit;box-sizing:border-box;width:100%;padding:12px;border:1px solid #d2d2d7;border-radius:10px}button.language{width:auto;margin:12px 0 0;padding:6px 0;min-height:44px;background:transparent;color:#075db4}button{background:#075db4;color:white;border:0;margin-top:20px;cursor:pointer}small{color:#6e6e73}a{color:#075db4}label{overflow-wrap:anywhere}button:focus-visible,a:focus-visible,input:focus-visible{outline:2px solid #075db4;outline-offset:2px}</style><main><h1>${escapeHtml(title)}</h1>${content}</main></html>`;
}
const loginErrors = {
  INVALID_CREDENTIALS: ['Incorrect username or password. Try again.', '账号或密码不正确，请重新输入。'],
  RATE_LIMITED: ['Too many attempts. Try again later.', '尝试次数过多，请稍后再试。'],
  INVALID_INPUT: ['Check your username and password.', '请检查账号和密码。'],
};
function loginLanguage(request, url) {
  const choice = url.searchParams.get('lang');
  if (choice === 'zh' || choice === 'en') return choice;
  return /(?:^|;\s*)praxis_locale=zh(?:;|$)/.test(request.headers.cookie || '') ? 'zh' : 'en';
}
function loginPage(target, language, username = '', errorCode = '', registered = false) {
  const zh = language === 'zh', alternate = zh ? 'en' : 'zh';
  const message = errorCode ? `<p role="alert">${loginErrors[errorCode][zh ? 1 : 0]}</p>` : '';
  const switcher = `<form method="get"><input type="hidden" name="return_to" value="${escapeHtml(target)}"><button class="language" type="submit" name="lang" value="${alternate}" lang="${zh ? 'en' : 'zh-CN'}">${zh ? 'English' : '简体中文'}</button></form>`;
  const registration = `/auth/register?${new URLSearchParams({ return_to: target, lang: language })}`;
  const success = registered ? `<p role="status">${zh ? '账号已创建，请登录。' : 'Account created. Sign in to continue.'}</p>` : '';
  return page(zh ? '登录 Praxis' : 'Sign in to Praxis', `${success}${message}<form method="post"><input type="hidden" name="return_to" value="${escapeHtml(target)}"><label>${zh ? '账号' : 'Username'}<input name="username" autocomplete="username" required value="${escapeHtml(username)}"></label><label>${zh ? '密码' : 'Password'}<input type="password" name="password" autocomplete="current-password" required${errorCode ? ' autofocus' : ''}></label><button>${zh ? '登录' : 'Sign in'}</button></form><p><a href="${escapeHtml(registration)}">${zh ? '创建账号' : 'Create an account'}</a></p>${switcher}`, language);
}
const registrationErrors = {
  INVALID_INPUT: ['Use a username of 3–64 letters, numbers, dots, underscores or hyphens, starting with a letter or number, and a password of 12–1024 characters.', '账号需为 3–64 位字母、数字、点、下划线或连字符，以字母或数字开头；密码需为 12–1024 个字符。'],
  CONFLICT: ['That username is unavailable. Choose another or sign in.', '该账号名不可用，请换一个或登录。'],
  RATE_LIMITED: ['Too many registration attempts. Try again later.', '注册尝试次数过多，请稍后再试。'],
};
function registrationPage(target, language, username = '', errorCode = '') {
  const zh = language === 'zh';
  const message = errorCode ? `<p role="alert">${registrationErrors[errorCode][zh ? 1 : 0]}</p>` : '';
  const login = `/auth/login?${new URLSearchParams({ return_to: target, lang: language })}`;
  return page(zh ? '创建 Praxis 账号' : 'Create a Praxis account', `${message}<p>${zh ? '创建账号后登录。应用和业务资源的访问权限需单独授权。' : 'Create your account, then sign in. Access to apps and business resources is granted separately.'}</p><form method="post"><input type="hidden" name="return_to" value="${escapeHtml(target)}"><label>${zh ? '账号' : 'Username'}<input name="username" autocomplete="username" required minlength="3" maxlength="64" pattern="[A-Za-z0-9][A-Za-z0-9_.\\-]{2,63}" aria-describedby="username-help" value="${escapeHtml(username)}"></label><small id="username-help">${zh ? '3–64 位字母、数字、点、下划线或连字符，以字母或数字开头。' : '3–64 letters, numbers, dots, underscores or hyphens. Start with a letter or number.'}</small><label>${zh ? '密码' : 'Password'}<input type="password" name="password" autocomplete="new-password" required minlength="12" maxlength="1024" aria-describedby="password-help"${errorCode ? ' autofocus' : ''}></label><small id="password-help">${zh ? '至少 12 个字符。' : 'At least 12 characters.'}</small><button>${zh ? '创建账号' : 'Create account'}</button></form><p><a href="${escapeHtml(login)}">${zh ? '已有账号？登录' : 'Already have an account? Sign in'}</a></p><form method="get"><input type="hidden" name="return_to" value="${escapeHtml(target)}"><button class="language" name="lang" value="${zh ? 'en' : 'zh'}" lang="${zh ? 'en' : 'zh-CN'}">${zh ? 'English' : '简体中文'}</button></form>`, language);
}
function cookie(store, token, expired = false) {
  return `${SESSION_COOKIE}=${expired ? '' : encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${expired ? 0 : 8 * 3600}${store.issuer.startsWith('https:') ? '; Secure' : ''}`;
}
function requireOrigin(request, store) {
  if (request.headers.origin !== new URL(store.issuer).origin) fail('The browser request origin is not allowed.', 403, 'ORIGIN_REJECTED');
}
function localReturn(value, fallback = '/business/', allowDelegate = false) {
  if (typeof value !== 'string' || value.length > 8192 || !/^\/(?!\/)[^\\\x00-\x20\x7f]*$/.test(value)) return fallback;
  try {
    const url = new URL(value, 'https://return.invalid');
    const path = decodeURIComponent(url.pathname);
    if (url.origin !== 'https://return.invalid' || /[\\\x00-\x20\x7f]/.test(path) || path.includes('//') || path.split('/').some(part => part === '.' || part === '..') || (path === '/auth' || path.startsWith('/auth/')) && !(allowDelegate && path === '/auth/delegate')) return fallback;
    return value;
  } catch { return fallback; }
}
function choices(rules, language, registry) {

  const actions = { read: ['Read', '读取'], create: ['Create', '新增'], update: ['Update', '修改'], complete: ['Complete', '完成'], delete: ['Delete', '删除'], submit: ['Submit corrections', '提交校正'], assign: ['Assign', '分配任务'], render: ['Render', '渲染'], export: ['Export', '导出'], notes: ['Speaker notes', '讲稿'], manage_lock: ['Manage content locks', '内容锁'], manage_members: ['Manage members', '管理成员'], manage_sharing: ['Manage sharing', '管理共享'], manage_delegation: ['Manage delegation', '管理委托'] };
  const i = language === 'zh' ? 1 : 0;
  return rules.map((rule, index) => {
    const declared = registry.getApp(registry.webId(rule.appId));
    const appName = rule.appId === 'spaces' ? ['Spaces', '空间管理'][i] : language === 'zh' ? declared?.labels?.zh?.name || declared?.name || rule.appId : declared?.name || rule.appId;
    const actionLabel = registry.getBusiness(rule.appId)?.actionLabels?.[rule.actions[0]]?.[language] || actions[rule.actions[0]]?.[i] || rule.actions[0];
    const size = rule.resources.length;
    const scope = rule.resources.includes('*') ? ['Authorized resources in this space', '空间内获准资源'][i] : [`${size} selected ${size === 1 ? 'resource' : 'resources'}`, `${size}项指定资源`][i];
    return `<label><input type="checkbox" name="rule_${index}" value="1"> ${escapeHtml(rule.spaceId)} · ${escapeHtml(appName)} · ${escapeHtml(actionLabel)} <small>(${scope})</small></label>`;
  }).join('');
}

export function createAuthHandler({ store, issuer = store.issuer, webGateway, apps = {} } = {}) {
  if (issuer.replace(/\/$/, '') !== store.issuer) fail('Handler issuer must match the auth store issuer.');
  store.configureWebAccessBoundary({ enabled: webGateway?.enabled === true, apps });
  const registrations = new Map();
  return async function authHandler(request, response) {
    const url = new URL(request.url, store.issuer);
    const path = url.pathname;
    const language = loginLanguage(request, url);
    const translate = (english, chinese) => language === 'zh' ? chinese : english;
    const renderPage = (english, chinese, html) => page(translate(english, chinese), html, language);
    if (!path.startsWith('/auth/') && !path.startsWith('/oauth/') && !path.startsWith('/api/business/management/') && !/^\/api\/business\/account\/spaces(?:\/|$)/.test(path) && !path.startsWith('/api/business/web-resource-access/') && !['/api/business/web-access', '/.well-known/oauth-authorization-server', '/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/mcp'].includes(path)) return false;
    try {
      if (/^\/api\/business\/account\/spaces(?:\/|$)/.test(path)) {
        if (request.headers.authorization !== undefined) fail('Native browser login is required.', 401, 'UNAUTHENTICATED');
        if (request.headers.origin && request.headers.origin !== store.issuer || request.headers['sec-fetch-site'] && !['same-origin', 'none'].includes(request.headers['sec-fetch-site'])) fail('The browser request origin is not allowed.', 403, 'ORIGIN_REJECTED');
        if (url.search || /%(?:2f|5c|25)/i.test(request.url) || /[\\\x00-\x20\x7f]/.test(request.url)) fail('Space route is invalid.');
        const token = parseCookie(request);
        store.requireNativeSession(token);
        const writing = !['GET', 'HEAD'].includes(request.method);
        if (writing) store.requireRequestCsrf(request);
        const input = ['POST', 'PUT'].includes(request.method) ? await readBody(request) : {};
        const fields = (allowed, required = allowed) => {
          if (Object.keys(input).some(key => !allowed.includes(key)) || required.some(key => !Object.hasOwn(input, key))) fail('Space request contains unknown or missing fields.');
        };
        const catalog = Object.keys(apps).filter(id => store.registry.getBusiness(id)).map(id => ({ id, name: store.registry.getApp(store.registry.webId(id))?.name || id, actions: store.appActions[id] }));
        const result = store.controlTransaction(() => {
          const session = store.requireNativeSession(token), userId = session.user.id;
          if (writing) store.requireRequestCsrf(request);
          if (path === '/api/business/account/spaces') {
            if (request.method === 'GET') return { status: 200, value: { spaces: store.db.prepare('SELECT s.id,s.type,s.owner_id AS ownerId,m.role FROM auth_spaces s JOIN auth_members m ON m.space_id=s.id WHERE m.user_id=? ORDER BY s.id').all(userId), catalog } };
            if (request.method === 'POST') { fields(['type']); return { status: 201, value: store.createSelfServiceSpace({ type: input.type, ownerId: userId }) }; }
            fail('Space method is not supported.', 405, 'METHOD_NOT_ALLOWED');
          }
          const match = /^\/api\/business\/account\/spaces\/([^/]+)(?:\/(apps|members|permissions)(?:\/([^/]+))?)?$/.exec(path);
          if (!match) fail('Space route was not found.', 404, 'NOT_FOUND');
          const spaceId = decodeURIComponent(match[1]), section = match[2], targetId = match[3] ? decodeURIComponent(match[3]) : null;
          const space = store.db.prepare('SELECT id,type,owner_id AS ownerId FROM auth_spaces WHERE id=?').get(spaceId);
          const role = store.membershipRole(userId, spaceId);
          if (!space || !role) fail('Space not found.', 404, 'NOT_FOUND');
          if (writing && space.ownerId !== userId) fail('Only the space owner can change this setting.', 403, 'FORBIDDEN');
          if (request.method === 'GET' && !section) {
            const members = store.db.prepare('SELECT m.user_id AS userId,u.username,m.role FROM auth_members m JOIN auth_users u ON u.id=m.user_id WHERE m.space_id=? ORDER BY m.user_id').all(spaceId);
            const permissions = store.db.prepare('SELECT id,user_id AS userId,app_id AS appId,resources,actions,expires_at AS expiresAt FROM auth_resources WHERE space_id=?').all(spaceId)
              .filter(row => space.ownerId === userId || row.userId === userId).map(row => ({ ...row, resources: JSON.parse(row.resources), actions: JSON.parse(row.actions) }));
            return { status: 200, value: { space: { ...space, role }, apps: catalog.map(app => ({ ...app, enabled: store.appSpaceEnabled(app.id, spaceId, apps) })), members, permissions } };
          }
          let value;
          if (section === 'apps' && targetId && request.method === 'PUT') {
            fields(['enabled']); value = store.setSpaceAppEnrollment({ spaceId, appId: targetId, enabled: input.enabled }, apps);
          } else if (section === 'members' && !targetId && request.method === 'POST') {
            fields(['username', 'role']);
            if (typeof input.username !== 'string' || input.role !== 'member') fail('An existing username and member role are required.');
            const member = store.db.prepare('SELECT id FROM auth_users WHERE username=? COLLATE NOCASE AND enabled=1').get(input.username.trim());
            if (!member) fail('Member identity is unavailable.', 404, 'NOT_FOUND');
            store.setMembership({ spaceId, userId: member.id, role: 'member' }); value = { userId: member.id, spaceId, role: 'member' };
          } else if (section === 'members' && targetId && request.method === 'DELETE') {
            store.setMembership({ spaceId, userId: targetId, role: null }); value = { removed: true };
          } else if (section === 'permissions' && !targetId && request.method === 'POST') {
            fields(['userId', 'appId', 'resources', 'actions', 'expiresAt'], ['userId', 'appId', 'resources', 'actions']);
            if (!store.membershipRole(input.userId, spaceId) || !store.appSpaceEnabled(input.appId, spaceId, apps)) fail('Permissions require a current member and enabled app.', 403, 'FORBIDDEN');
            value = store.grantResource({ ...input, spaceId });
          } else if (section === 'permissions' && targetId && request.method === 'DELETE') {
            if (!store.db.prepare('SELECT 1 FROM auth_resources WHERE id=? AND space_id=?').get(targetId, spaceId)) fail('Resource permission not found.', 404, 'NOT_FOUND');
            store.revokeResource(targetId); value = { revoked: true };
          } else fail('Space route or method was not found.', 404, 'NOT_FOUND');
          store.audit({ event: 'space.management', userId, spaceId, outcome: 'allowed' });
          return { status: request.method === 'POST' ? 201 : 200, value };
        });
        send(response, result.status, result.value); return true;
      }
      if (path.startsWith('/api/business/web-resource-access/')) {
        const resourceRoutes = Object.fromEntries(store.registry.apps.flatMap(app => Object.entries(app.integration.web.nativePolicies || {}).map(([policyId, policy]) => [policy.legacyEndpoint || `/api/business/web-resource-access/${store.registry.businessId(app.id)}/${policyId}`, { ...policy, appId: store.registry.businessId(app.id), webAppId: app.id, resourceId: policy.resource }])));
        const target = resourceRoutes[path];
        if (!target || webGateway?.enabled !== true) fail('Resource access route was not found.', 404, 'NOT_FOUND');
        if (request.method !== 'GET') { send(response, 405, { code: 'METHOD_NOT_ALLOWED' }, undefined, { Allow: 'GET' }); return true; }
        if (url.search) fail('Resource access does not accept query parameters.');
        if (request.headers.authorization !== undefined) fail('Native browser login is required.', 401, 'UNAUTHENTICATED');
        if (request.headers.origin && request.headers.origin !== store.issuer) fail('The browser request origin is not allowed.', 403, 'FORBIDDEN');
        if (request.headers['sec-fetch-site'] === 'cross-site') fail('The browser request site is not allowed.', 403, 'FORBIDDEN');
        const token = parseCookie(request), session = store.requireNativeSession(token), web = store.getWebAccess(token);
        if (!web.apps.includes(target.webAppId)) fail('Application access is not allowed.', 403, 'FORBIDDEN');
        let expiresAt = 0;
        if (target.allSpaces) {
          const spaces = apps[target.appId]?.spaces || [];
          const actions = target.actions;
          const rules = store.availableRules(session.user.id, { [target.appId]: actions });
          if (!spaces.length) fail('Native authoring access is not allowed.', 403, 'FORBIDDEN');
          expiresAt = Math.min(session.expiresAt, web.permissionsExpireAt ?? Infinity);
          for (const spaceId of spaces) {
            for (const action of actions) {
              const fullRule = rules.find(rule => rule.appId === target.appId &&
                rule.spaceId === spaceId && rule.actions.includes(action) && rule.resources.includes('*'));
              if (!fullRule) fail('Native authoring access is not allowed.', 403, 'FORBIDDEN');
              const scope = store.authorize(token, { appId: target.appId, spaceId, action }, { auditDenied: false });
              if (!scope.resources.includes('*')) fail('Native authoring access is not allowed.', 403, 'FORBIDDEN');
              expiresAt = Math.min(expiresAt, scope.expiresAt);
            }
          }
        } else {
          for (const { id: spaceId } of store.db.prepare('SELECT id FROM auth_spaces').all().filter(space => store.appSpaceEnabled(target.appId, space.id, apps))) {
            try {
              let scopeExpiry = Math.min(session.expiresAt, web.permissionsExpireAt ?? Infinity);
              for (const action of target.actions || ['read']) {
                const scope = store.authorize(token, { appId: target.appId, spaceId, action, resourceId: target.resourceId }, { auditDenied: false });
                scopeExpiry = Math.min(scopeExpiry, scope.expiresAt);
              }
              expiresAt = Math.max(expiresAt, scopeExpiry);
            }
            catch (error) { if (error.status !== 403) throw error; }
          }
        }
        if (expiresAt <= store.clock()) fail('Legacy resource access is not allowed.', 403, 'FORBIDDEN');
        send(response, 200, { allowed: true, expiresAt }); return true;
      }
      if (path === '/api/business/web-access') {
        if (webGateway?.enabled !== true) { send(response, 404, { code: 'NOT_FOUND' }); return true; }
        if (request.method !== 'GET') { send(response, 405, { code: 'METHOD_NOT_ALLOWED' }, undefined, { Allow: 'GET' }); return true; }
        if (url.search) fail('Web access does not accept query parameters.');
        if (request.headers.authorization !== undefined) fail('Native browser login is required.', 401, 'UNAUTHENTICATED');
        if (request.headers.origin && request.headers.origin !== store.issuer) fail('The browser request origin is not allowed.', 403, 'FORBIDDEN');
        const token = parseCookie(request);
        store.getWebAccess(token);
        const value = store.getWebAccess(token); store.getSession(token);
        send(response, 200, { ...value, canViewPlatform: value.platformAdmin });
        return true;
      }
      const publicEndpoint = path.startsWith('/.well-known/') || ['/oauth/token', '/oauth/register', '/oauth/revoke'].includes(path);
      if (publicEndpoint) {
        response.setHeader('Access-Control-Allow-Origin', '*');
        if (request.method === 'OPTIONS') { response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS'); response.setHeader('Access-Control-Allow-Headers', 'Content-Type'); send(response, 204, '', 'text/plain'); return true; }
      }
      if (request.headers.origin && request.headers.origin !== new URL(store.issuer).origin && path.startsWith('/auth/')) fail('The browser request origin is not allowed.', 403, 'ORIGIN_REJECTED');
      if (path.startsWith('/api/business/management/')) {
        const route = /^\/api\/business\/management\/spaces\/([^/]+)\/(members|permissions|delegations)(?:\/([^/]+))?$/.exec(path);
        if (!route) fail('Management route was not found.', 404, 'NOT_FOUND');
        const spaceId = decodeURIComponent(route[1]), section = route[2], targetId = route[3] === undefined ? null : decodeURIComponent(route[3]);
        const action = { members: 'manage_members', permissions: 'manage_sharing', delegations: 'manage_delegation' }[section];
        const credential = credentialFromRequest(request);
        let managementActor;
        const authorize = () => { managementActor = store.authorize(credential, { appId: 'spaces', spaceId, action }); return managementActor; };
        const audit = resourceId => store.audit({ event: 'space.management', ...managementActor, action, resourceId, outcome: 'allowed' });
        if (!['GET', 'HEAD'].includes(request.method)) store.requireRequestCsrf(request);
        if (section === 'members' && request.method === 'GET' && targetId === null) {
          authorize();
          const members = store.db.prepare('SELECT user_id AS userId,role FROM auth_members WHERE space_id=? ORDER BY user_id').all(spaceId);
          send(response, 200, { members });
        } else if (section === 'members' && request.method === 'PUT' && targetId !== null) {
          const input = await readBody(request); authorize();
          if (Object.keys(input).some(key => key !== 'role') || !['admin', 'member'].includes(input.role)) fail('Membership update requires only an admin or member role.');
          if (!store.db.prepare('SELECT 1 FROM auth_users WHERE id=? AND enabled=1').get(targetId)) fail('Member identity is unavailable.', 404, 'NOT_FOUND');
          store.setMembership({ spaceId, userId: targetId, role: input.role });
          audit(targetId);
          send(response, 200, { userId: targetId, spaceId, role: input.role });
        } else if (section === 'members' && request.method === 'DELETE' && targetId !== null) {
          authorize(); store.setMembership({ spaceId, userId: targetId, role: null }); audit(targetId); send(response, 200, { ok: true });
        } else if (section === 'permissions' && request.method === 'GET' && targetId === null) {
          authorize();
          const permissions = store.db.prepare('SELECT id,user_id,app_id,resources,actions,expires_at FROM auth_resources WHERE space_id=? ORDER BY rowid').all(spaceId).map(row => ({ id: row.id, userId: row.user_id, appId: row.app_id, spaceId, resources: JSON.parse(row.resources), actions: JSON.parse(row.actions), expiresAt: row.expires_at }));
          send(response, 200, { permissions });
        } else if (section === 'permissions' && request.method === 'POST' && targetId === null) {
          const input = await readBody(request); authorize();
          if (Object.keys(input).some(key => !['userId', 'appId', 'resources', 'actions', 'expiresAt'].includes(key))) fail('Resource permission contains unknown fields.');
          const permission = store.grantResource({ ...input, spaceId });
          audit(permission.id);
          send(response, 201, permission);
        } else if (section === 'permissions' && request.method === 'DELETE' && targetId !== null) {
          authorize();
          if (!store.db.prepare('SELECT 1 FROM auth_resources WHERE id=? AND space_id=?').get(targetId, spaceId)) fail('Resource permission not found.', 404, 'NOT_FOUND');
          store.revokeResource(targetId); audit(targetId); send(response, 200, { ok: true });
        } else if (section === 'delegations' && request.method === 'GET' && targetId === null) {
          authorize();
          const delegations = store.db.prepare('SELECT id,user_id,client_id,rules,expires_at FROM auth_grants WHERE revoked_at IS NULL AND expires_at>?').all(store.clock()).map(row => ({ id: row.id, userId: row.user_id, clientId: row.client_id, rules: JSON.parse(row.rules).filter(rule => rule.spaceId === spaceId), expiresAt: row.expires_at })).filter(grant => grant.rules.length);
          send(response, 200, { delegations });
        } else if (section === 'delegations' && request.method === 'DELETE' && targetId !== null) {
          authorize();
          let grant; try { grant = store.getGrant(targetId); } catch { fail('Delegation not found in this space.', 404, 'NOT_FOUND'); }
          if (!grant.rules.some(rule => rule.spaceId === spaceId)) fail('Delegation not found in this space.', 404, 'NOT_FOUND');
          store.revokeGrantSpace(targetId, spaceId); audit(targetId); send(response, 200, { ok: true });
        } else fail('Management route or method was not found.', 404, 'NOT_FOUND');
      } else if (path === '/.well-known/oauth-authorization-server' && request.method === 'GET') {
        send(response, 200, { issuer: store.issuer, authorization_endpoint: `${store.issuer}/oauth/authorize`, token_endpoint: `${store.issuer}/oauth/token`, registration_endpoint: `${store.issuer}/oauth/register`, revocation_endpoint: `${store.issuer}/oauth/revoke`, response_types_supported: ['code'], grant_types_supported: ['authorization_code', 'refresh_token'], code_challenge_methods_supported: ['S256'], token_endpoint_auth_methods_supported: ['none'], scopes_supported: Object.keys(store.scopes), authorization_response_iss_parameter_supported: true });
      } else if (path.startsWith('/.well-known/oauth-protected-resource') && request.method === 'GET') {
        send(response, 200, { resource: store.resource, authorization_servers: [store.issuer], bearer_methods_supported: ['header'], scopes_supported: Object.keys(store.scopes), resource_name: 'Praxis business tools' });
      } else if (path === '/oauth/register' && request.method === 'POST') {
        const remote = request.socket?.remoteAddress ?? 'unknown';
        const attempts = registrations.get(remote) ?? { count: 0, reset: store.clock() + 3600000 };
        if (attempts.reset <= store.clock()) { attempts.count = 0; attempts.reset = store.clock() + 3600000; }
        if (++attempts.count > 30) fail('Client registration rate limit exceeded.', 429, 'RATE_LIMITED');
        registrations.set(remote, attempts);
        const input = await readBody(request);
        if ((input.token_endpoint_auth_method ?? 'none') !== 'none' || (input.grant_types && (!Array.isArray(input.grant_types) || input.grant_types.some(type => !['authorization_code', 'refresh_token'].includes(type)))) || (input.response_types && (!Array.isArray(input.response_types) || input.response_types.some(type => type !== 'code')))) fail('Only public authorization-code clients are supported.');
        const client = store.createClient({ name: input.client_name || 'External MCP client', redirectUris: input.redirect_uris });
        send(response, 201, { client_id: client.id, client_name: client.name, redirect_uris: client.redirectUris, token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'] });
      } else if (path === '/auth/register' && ['GET', 'POST'].includes(request.method)) {
        const fallback = webGateway?.enabled === true ? '/' : '/business/';
        const localeHeaders = ['en', 'zh'].includes(url.searchParams.get('lang'))
          ? { 'Set-Cookie': `praxis_locale=${language}; Path=/; SameSite=Lax; Max-Age=31536000${store.issuer.startsWith('https:') ? '; Secure' : ''}` } : {};
        if (request.method === 'GET') {
          send(response, 200, registrationPage(localReturn(url.searchParams.get('return_to'), fallback, true), language), 'text/html; charset=utf-8', localeHeaders);
        } else {
          requireOrigin(request, store);
          let input = {}, target = localReturn(url.searchParams.get('return_to'), fallback, true);
          try {
            store.limitUserRegistration(request.socket?.remoteAddress ?? 'unknown');
            input = await readBody(request);
            target = localReturn(input.return_to, fallback, true);
            const user = store.registerUser(input);
            const loginUrl = `/auth/login?${new URLSearchParams({ return_to: target, lang: language, registered: '1' })}`;
            if ((request.headers['content-type'] ?? '').startsWith('application/x-www-form-urlencoded')) send(response, 303, '', 'text/plain', { ...localeHeaders, Location: loginUrl });
            else send(response, 201, { user, loginUrl }, undefined, localeHeaders);
          } catch (error) {
            if (!(request.headers['content-type'] ?? '').startsWith('application/x-www-form-urlencoded') || !Object.hasOwn(registrationErrors, error.code)) throw error;
            const username = typeof input.username === 'string' ? input.username.slice(0, 64) : '';
            send(response, error.status, registrationPage(target, language, username, error.code), 'text/html; charset=utf-8', { ...localeHeaders, ...(error.retryAfter ? { 'Retry-After': String(error.retryAfter) } : {}) });
          }
        }
      } else if (path === '/auth/login' && request.method === 'GET') {
        const target = localReturn(url.searchParams.get('return_to'), webGateway?.enabled === true ? '/' : '/business/', true);
        const headers = ['en', 'zh'].includes(url.searchParams.get('lang'))
          ? { 'Set-Cookie': `praxis_locale=${language}; Path=/; SameSite=Lax; Max-Age=31536000${store.issuer.startsWith('https:') ? '; Secure' : ''}` }
          : {};
        send(response, 200, loginPage(target, language, '', '', url.searchParams.get('registered') === '1'), 'text/html; charset=utf-8', headers);
      } else if (path === '/auth/login' && request.method === 'POST') {
        requireOrigin(request, store);
        const input = await readBody(request);
        const target = localReturn(input.return_to, webGateway?.enabled === true ? '/' : '/business/', true);
        let result;
        try { result = store.login({ username: input.username, password: input.password }); }
        catch (error) {
          if (!(request.headers['content-type'] || '').startsWith('application/x-www-form-urlencoded') || !Object.hasOwn(loginErrors, error.code)) throw error;
          const username = typeof input.username === 'string' ? input.username.slice(0, 200) : '';
          send(response, error.status, loginPage(target, language, username, error.code), 'text/html; charset=utf-8');
          return true;
        }
        const headers = { 'Set-Cookie': cookie(store, result.sessionToken) };
        if ((request.headers['content-type'] ?? '').startsWith('application/x-www-form-urlencoded')) send(response, 303, '', 'text/plain', { ...headers, Location: target });
        else send(response, 200, { user: result.user, csrfToken: result.csrfToken, ...store.browserAuthorization(result.sessionToken) }, undefined, headers);
      } else if (path === '/auth/session' && request.method === 'GET') {
        const token = parseCookie(request), session = store.getSession(token);
        const authorization = store.browserAuthorization(token);
        let spaces = [];
        if (authorization.authorizationMode !== 'none') { try { spaces = store.listSpaces(token); } catch (error) { if (![401, 403].includes(error.status)) throw error; } }
        send(response, 200, { user: session.user, csrfToken: session.csrfToken, expiresAt: session.expiresAt, ...authorization, spaces, grants: store.listGrants(session.user.id) });
      } else if (path === '/auth/delegate' && request.method === 'GET') {
        const target = localReturn(url.searchParams.get('return_to'), webGateway?.enabled === true ? '/' : '/business/');
        let session;
        try { session = store.getSession(parseCookie(request)); } catch (error) { if (error.status !== 401) throw error; const resume = `/auth/delegate?${new URLSearchParams({ return_to: target })}`; send(response, 303, '', 'text/plain', { Location: `/auth/login?return_to=${encodeURIComponent(resume)}` }); return true; }
        if (session.clientId === 'praxis-browser' && (store.isPlatformAdmin(session.user.id) || store.webAccessBoundary.enabled)) { send(response, 303, '', 'text/plain', { Location: target }); return true; }
        const rules = store.availableRules(session.user.id), consent = store.createConsent(parseCookie(request), rules, `praxis-browser:${target}`);
        if (!rules.length) { send(response, 200, renderPage('Agent access', '智能体授权', `<p>${translate('There are no available business actions to authorize. App access and agent permissions are granted separately.', '目前没有可授权的业务操作。应用访问权限不会自动产生智能体操作能力。')}</p><a href="/">${translate('Back to workbench', '返回工作台')}</a>`), 'text/html; charset=utf-8'); return true; }
        send(response, 200, renderPage('Authorize the workbench', '授权工作台', `<p>${translate('Choose the actions this workbench can perform. This grant lasts seven days and can be revoked at any time.', '选择本次工作台可以操作的范围，授权有效期为七天。可随时撤销。')}</p><form method="post" action="/auth/delegate"><input type="hidden" name="return_to" value="${escapeHtml(target)}"><input type="hidden" name="csrf" value="${escapeHtml(session.csrfToken)}"><input type="hidden" name="consent" value="${escapeHtml(consent)}">${choices(rules, language, store.registry)}<button>${translate('Authorize selected actions', '确认授权')}</button></form>`), 'text/html; charset=utf-8');
      } else if (path === '/auth/delegate' && request.method === 'POST') {
        requireOrigin(request, store);
        const input = await readBody(request), token = parseCookie(request);
        const session = store.verifyCsrf(token, input.csrf ?? request.headers['x-csrf-token']);
        const target = localReturn(input.return_to, webGateway?.enabled === true ? '/' : '/business/');
        if (session.clientId === 'praxis-browser' && (store.isPlatformAdmin(session.user.id) || store.webAccessBoundary.enabled)) { if ((request.headers['content-type'] ?? '').startsWith('application/x-www-form-urlencoded')) send(response, 303, '', 'text/plain', { Location: target }); else send(response, 200, { ...store.browserAuthorization(token), expiresAt: session.expiresAt }); return true; }
        const rules = store.consentRules(token, input, `praxis-browser:${target}`);
        const grant = store.delegateSession(token, { rules });
        if ((request.headers['content-type'] ?? '').startsWith('application/x-www-form-urlencoded')) send(response, 303, '', 'text/plain', { Location: target });
        else send(response, 201, { grantId: grant.id, expiresAt: grant.expiresAt });
      } else if (path === '/auth/logout' && request.method === 'POST') {
        store.requireRequestCsrf(request);
        store.logout(parseCookie(request));
        send(response, 200, { ok: true }, undefined, { 'Set-Cookie': cookie(store, '', true) });
      } else if (path === '/auth/grants' && request.method === 'GET') {
        send(response, 200, { grants: store.listGrants(store.getSession(parseCookie(request)).user.id) });
      } else if (/^\/auth\/grants\/[^/]+$/.test(path) && request.method === 'DELETE') {
        store.requireRequestCsrf(request);
        const userId = store.getSession(parseCookie(request)).user.id, id = path.slice('/auth/grants/'.length);
        if (!store.listGrants(userId).some(grant => grant.id === id)) fail('Delegation not found.', 404, 'NOT_FOUND');
        store.revokeGrant(id); send(response, 200, { ok: true });
      } else if (path === '/oauth/authorize' && ['GET', 'POST'].includes(request.method)) {
        const oauth = store.authorizationRequest(url.searchParams);
        let session;
        try { session = store.getSession(parseCookie(request)); } catch (error) { if (error.status !== 401) throw error; send(response, 303, '', 'text/plain', { Location: `/auth/login?return_to=${encodeURIComponent(`${url.pathname}${url.search}`)}` }); return true; }
        const available = store.availableRules(session.user.id, oauth.requested);
        const sendConsent = (status, error = false) => {
          // Chromium applies the submitting document's form-action to the 303
          // destination too. Only this verified request's callback may be added.
          const origin = new URL(oauth.redirectUri).origin;
          if (!/^https?:\/\/(?:[a-z0-9.-]+|\[[a-f0-9:]+\])(?::[0-9]+)?$/i.test(origin)) fail('Registered callback origin is not a safe CSP source.', 400, 'INVALID_CLIENT');
          send(response, status, renderConsent(error), 'text/html; charset=utf-8', {
            'Content-Security-Policy': contentSecurityPolicy.replace("form-action 'self'", `form-action 'self' ${origin}`),
          });
        };
        const renderConsent = (error = false) => {
          const consent = store.createConsent(parseCookie(request), available, `${url.pathname}${url.search}`);
          const message = error ? `<p role="alert">${translate('Select at least one permission, then choose Authorize selected actions.', '请至少勾选一项权限，再点击「确认授权」。')}</p>` : '';
          return renderPage('Authorize external agent', '授权外部智能体', `<p><strong>${escapeHtml(oauth.clientName)}</strong>${translate(' is requesting access to act on your behalf. Select the allowed actions. This grant can be revoked at any time during its seven-day term.', ' 请求代表你操作以下业务。请选择获准范围，七天内可随时撤销。')}</p>${message}<form method="post" action="${escapeHtml(`${url.pathname}${url.search}`)}"><input type="hidden" name="csrf" value="${escapeHtml(session.csrfToken)}"><input type="hidden" name="consent" value="${escapeHtml(consent)}">${choices(available, language, store.registry)}<button>${translate('Authorize selected actions', '确认授权')}</button></form>`);
        };
        if (request.method === 'GET') {
          if (!available.length) { send(response, 200, renderPage('No actions available', '暂无可授权操作', `<p>${escapeHtml(oauth.clientName)}${translate(' requested actions that are unavailable for your account.', ' 请求的操作没有与你当前权限及已接入的业务能力相交。')}</p><p>${translate('App access and agent permissions are granted separately.', '应用访问权限不会自动产生智能体操作能力。')}</p><a href="/">${translate('Back to workbench', '返回工作台')}</a>`), 'text/html; charset=utf-8'); return true; }
          sendConsent(200);
        } else {
          requireOrigin(request, store);
          const input = await readBody(request);
          store.verifyCsrf(parseCookie(request), input.csrf ?? request.headers['x-csrf-token']);
          if (!available.length) fail('No requested operations are currently available.', 400, 'INVALID_SCOPE');
          let rules;
          try { rules = store.consentRules(parseCookie(request), input, `${url.pathname}${url.search}`); }
          catch (error) {
            if (error.code !== 'EMPTY_CONSENT' || !(request.headers['content-type'] ?? '').startsWith('application/x-www-form-urlencoded')) throw error;
            sendConsent(400, true);
            return true;
          }
          const { code } = store.createAuthorizationCode({ request: oauth, userId: session.user.id, rules });
          const destination = new URL(oauth.redirectUri); destination.searchParams.set('code', code); destination.searchParams.set('iss', store.issuer); if (oauth.state !== null) destination.searchParams.set('state', oauth.state);
          send(response, 303, '', 'text/plain', { Location: destination.href });
        }
      } else if (path === '/oauth/token' && request.method === 'POST') {
        const input = await readBody(request);
        let tokens;
        if (input.grant_type === 'authorization_code') tokens = store.exchangeCode({ code: input.code, clientId: input.client_id, redirectUri: input.redirect_uri, verifier: input.code_verifier, resource: input.resource });
        else if (input.grant_type === 'refresh_token') tokens = store.refresh({ refreshToken: input.refresh_token, clientId: input.client_id, resource: input.resource });
        else fail('OAuth grant type is unsupported.', 400, 'UNSUPPORTED_GRANT_TYPE');
        send(response, 200, tokens);
      } else if (path === '/oauth/revoke' && request.method === 'POST') {
        const input = await readBody(request);
        if (typeof input.token === 'string' && input.token.length <= 200 && typeof input.client_id === 'string') {
          const token = store.db.prepare('SELECT grant_id FROM auth_tokens WHERE hash=? AND client_id=?').get(hash(input.token), input.client_id);
          if (token) store.revokeGrant(token.grant_id);
        }
        send(response, 200, {});
      } else send(response, 404, { error: 'NOT_FOUND', message: 'Authentication route or method was not found.' });
    } catch (error) {
      if (error.retryAfter) response.setHeader('Retry-After', String(error.retryAfter));
      const status = error.status ?? 500;
      const code = error.code ?? 'INTERNAL_ERROR', message = error.status ? error.message : 'Authentication request failed.';
      if (path === '/api/business/web-access' || path.startsWith('/api/business/web-resource-access/')) {
        send(response, status, { code, ...(status === 401 ? { loginUrl: `${store.issuer}/auth/login?return_to=%2F` } : {}) });
        return true;
      }
      if ((request.headers['content-type'] ?? '').startsWith('application/x-www-form-urlencoded') && ['/auth/login', '/auth/delegate', '/oauth/authorize'].includes(path)) {
        const labels = {
          INVALID_CREDENTIALS: translate('Incorrect username or password.', '账号或密码不正确。'),
          RATE_LIMITED: translate('Too many attempts. Try again later.', '尝试次数过多，请稍后再试。'),
          CSRF_REJECTED: translate('This page expired. Open it again.', '页面已失效，请重新打开后操作。'),
          CONSENT_REQUIRED: translate('The authorization page expired. Open it again.', '授权页面已失效，请重新打开。'),
          FORBIDDEN: translate('Your account cannot authorize the selected scope.', '当前身份没有所选范围的权限。'),
          INVALID_SCOPE: translate('No business actions are available for authorization.', '目前没有可授权的业务操作。'),
          INVALID_INPUT: path === '/auth/login' ? translate('Check your username and password.', '请检查账号和密码。') : translate('Reopen the page and review the available actions.', '请重新打开页面，检查可用操作后再试。'),
        };
        const login = path === '/auth/login';
        send(response, status, renderPage('Request incomplete', '操作未完成', `<p>${labels[code] ?? translate('The request could not be completed. Sign in again or check your access.', '当前请求无法完成，请重新登录或检查授权范围。')}</p><a href="${login ? '/auth/login' : '/'}">${login ? translate('Back to sign-in', '返回登录') : translate('Back to workbench', '返回工作台')}</a>`), 'text/html; charset=utf-8');
      } else if (path.startsWith('/oauth/')) send(response, status, { error: code.toLowerCase(), error_description: message, code });
      else send(response, status, { error: code, message });
    }
    return true;
  };
}
