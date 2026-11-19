import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, open, readFile, readdir, realpath, rm, unlink } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { assertOutsideWorkspace, assertPrivateFile, isWithin, saveConfig, storageError, validateConfig, writePrivateJson } from './config.mjs';
import { createSnapshot, verifySnapshot } from './snapshot.mjs';

const TAGS = { workspace: 'praxis-workspace:', snapshot: 'praxis-snapshot:', parent: 'praxis-parent:', writer: 'praxis-writer:' };
const SNAPSHOT_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,100}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const conflict = message => storageError('LINEAGE_CONFLICT', message);
const isConflict = error => ['LINEAGE_CONFLICT', 'WRITER_CONFLICT', 'LOCAL_BEHIND', 'FOREIGN_REPOSITORY'].includes(error.code);

export function executeFile(file, args, { input, ...options } = {}) {
  return new Promise((resolvePromise, reject) => {
    let resolveClosed;
    const closed = new Promise(accept => { resolveClosed = accept; });
    const child = execFile(file, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 30 * 60 * 1000, ...options }, (error, stdout, stderr) => {
      if (error) {
        error.stdout = stdout; error.stderr = stderr;
        // AbortError can arrive before the process finishes its SIGTERM cleanup.
        if (error.name === 'AbortError' || error.code === 'ABORT_ERR') closed.then(() => reject(error));
        else reject(error);
      }
      else resolvePromise({ stdout, stderr });
    });
    child.once('close', () => resolveClosed());
    child.stdin?.on('error', () => {});
    child.stdin?.end(input);
  });
}

function cleanEnvironment() {
  return Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('RESTIC_') && !key.startsWith('RCLONE_')));
}

function publicFailure(error) {
  const code = /^[A-Z_]+$/.test(error.code ?? '') ? error.code : 'STORAGE_FAILED';
  return { code, message: {
    NOT_CONFIGURED: 'Required credentials or private files are not configured',
    NOT_INITIALIZED: 'Repository has not been initialized',
    TOOL_MISSING: 'A required storage executable is unavailable',
    WRONG_PASSWORD: 'Repository password was rejected',
    LOCKED: 'Repository is locked by another operation',
    LISTING_LIMIT: 'Directory listing reached the safe provider limit',
    REMOTE_FAILED: 'Remote storage request failed',
    RESTIC_FAILED: 'Backup operation failed; source data was preserved',
    LINEAGE_CONFLICT: 'Conflicting snapshot lineage was detected; nothing was overwritten',
    WRITER_CONFLICT: 'This device is not the active writer',
    LOCAL_BEHIND: 'The local repository is behind another replica',
    FOREIGN_REPOSITORY: 'Repository contains another workspace or unsupported snapshots',
  }[code] ?? 'Storage operation failed; source data was preserved' };
}

function sanitizeCommandError(error, tool) {
  if (error.name === 'AbortError' || ['ABORT_ERR', 'ABORTED'].includes(error.code)) return storageError('ABORTED', 'Storage operation was cancelled');
  if (error.code === 'ENOENT') return storageError('TOOL_MISSING', 'A required storage executable is unavailable');
  const text = `${error.stderr ?? ''}\n${error.stdout ?? ''}`;
  if (error.code === 10 || /repository does not exist|unable to open config file.*does not exist|directory not found|\bAncestorsNotFound\b/i.test(text)) return storageError('NOT_INITIALIZED', 'Repository has not been initialized');
  if (error.code === 12 || /wrong password|no key found|password is incorrect/i.test(text)) return storageError('WRONG_PASSWORD', 'Repository password was rejected');
  if (error.code === 11 || /repository is already locked|unable to create lock/i.test(text)) return storageError('LOCKED', 'Repository is locked by another operation');
  const result = storageError(tool === 'restic' ? 'RESTIC_FAILED' : 'REMOTE_FAILED', 'Storage subprocess failed; no command output was logged');
  result.retryable = /429|rate.?limit|503|502|504|connection reset|temporar|timeout|timed out|unexpected EOF/i.test(text);
  return result;
}

async function jianguoyunCredentials(repository) {
  await assertPrivateFile(repository.credentialsFile);
  let credentials;
  try { credentials = JSON.parse(await readFile(repository.credentialsFile, 'utf8')); }
  catch { throw storageError('NOT_CONFIGURED', 'Jianguoyun credentials are not configured'); }
  if (typeof credentials.username !== 'string' || !credentials.username.trim() || typeof credentials.applicationPassword !== 'string' || !credentials.applicationPassword.trim() || /[\r\n]/.test(credentials.username + credentials.applicationPassword)) throw storageError('NOT_CONFIGURED', 'Jianguoyun credentials are not configured');
  return credentials;
}

function tagValue(tags, name) {
  const values = tags.filter(tag => tag.startsWith(TAGS[name])).map(tag => tag.slice(TAGS[name].length));
  if (values.length !== 1) throw storageError('FOREIGN_REPOSITORY', 'Repository snapshot metadata is incomplete');
  return values[0];
}

export function validateLineage(records, config) {
  const all = new Map(), children = new Map();
  const allowedWriters = new Set([config.activeWriterDeviceId, ...(config.writerHistory ?? []).map(event => event.deviceId)]);
  for (const record of records) {
    if (record.workspaceId !== config.workspaceId) throw storageError('FOREIGN_REPOSITORY', 'Repository belongs to another workspace');
    if (!SNAPSHOT_ID.test(record.snapshotId) || (record.parentSnapshotId !== null && !SNAPSHOT_ID.test(record.parentSnapshotId))) throw conflict('Invalid snapshot identity');
    if (!allowedWriters.has(record.writerDeviceId)) throw storageError('WRITER_CONFLICT', 'An unrecognized writer published a snapshot');
    const existing = all.get(record.snapshotId);
    if (existing && (existing.parentSnapshotId !== record.parentSnapshotId || existing.writerDeviceId !== record.writerDeviceId || existing.treeHash !== record.treeHash)) throw conflict('Snapshot identity has conflicting metadata or content');
    all.set(record.snapshotId, record);
  }
  for (const record of all.values()) {
    if (record.parentSnapshotId !== null && !all.has(record.parentSnapshotId)) throw conflict('Snapshot parent is missing');
    const key = record.parentSnapshotId ?? '<root>';
    if (children.has(key) && children.get(key) !== record.snapshotId) throw conflict('Snapshot history has diverged');
    children.set(key, record.snapshotId);
  }
  let current = null;
  const visited = new Set();
  const fences = new Map();
  for (const event of config.writerHistory ?? []) {
    if (fences.has(event.atSnapshotId)) throw conflict('Writer history contains duplicate handover fences');
    fences.set(event.atSnapshotId, event);
  }
  let writer = config.writerHistory?.[0]?.deviceId ?? config.activeWriterDeviceId;
  let fenceIndex = 0;
  while (children.has(current ?? '<root>')) {
    current = children.get(current ?? '<root>');
    if (visited.has(current)) throw conflict('Snapshot history contains a cycle');
    visited.add(current);
    if (all.get(current).writerDeviceId !== writer) throw storageError('WRITER_CONFLICT', 'A retired or unexpected writer published after a handover fence');
    if (fences.has(current)) {
      const event = fences.get(current);
      if (event !== config.writerHistory[fenceIndex++] || event.deviceId !== writer || event.nextDeviceId === writer) throw conflict('Writer handovers do not follow snapshot history');
      writer = event.nextDeviceId;
    }
  }
  if (visited.size !== all.size) throw conflict('Snapshot history is disconnected');
  if (all.size && (fenceIndex !== fences.size || writer !== config.activeWriterDeviceId)) throw conflict('Writer history does not match the active writer and snapshot chain');
  return { head: current, records: all };
}

async function canonicalPath(path) {
  let existing = resolve(path);
  const suffix = [];
  while (!(await lstat(existing).catch(error => { if (error.code === 'ENOENT') return null; throw error; }))) {
    suffix.unshift(basename(existing));
    existing = dirname(existing);
  }
  return resolve(await realpath(existing), ...suffix);
}

export class StorageRepositories {
  constructor(config, options = {}) {
    this.config = validateConfig(config);
    const runtime = validateConfig({ ...this.config, resticBinary: options.resticBinary ?? process.env.PRAXIS_RESTIC_BINARY ?? this.config.resticBinary, rcloneBinary: options.rcloneBinary ?? process.env.PRAXIS_RCLONE_BINARY ?? this.config.rcloneBinary });
    this.resticBinary = runtime.resticBinary;
    this.rcloneBinary = runtime.rcloneBinary;
    this.execute = options.execFile ?? executeFile;
    this.createSnapshot = options.createSnapshot ?? createSnapshot;
    this.verifySnapshot = options.verifySnapshot ?? verifySnapshot;
    this.configFile = options.configFile;
    this.sleep = options.sleep ?? delay;
    this.fetch = options.fetchImpl ?? fetch;
    this.prepared = new Map();
    this.stateFile = resolve(this.config.stateRoot, 'repositories.json');
  }

  repository(id = this.config.preferredRepositoryId) {
    const repo = this.config.repositories.find(item => item.id === id);
    if (!repo) throw storageError('INVALID_CONFIG', 'Unknown repository ID');
    return repo;
  }

  assertWriter() {
    if (this.config.deviceId !== this.config.activeWriterDeviceId) throw storageError('WRITER_CONFLICT', 'This device is not the active writer');
  }

  assertRunning() {
    if (this.activeAbortSignal?.aborted) throw storageError('ABORTED', 'Storage operation was cancelled');
  }

  async state() {
    let state;
    try { state = JSON.parse(await readFile(this.stateFile, 'utf8')); }
    catch (error) {
      if (error.code !== 'ENOENT') throw storageError('CORRUPT_STATE', 'Storage state is unreadable; no state was overwritten');
      state = { schemaVersion: 1, workspaceId: this.config.workspaceId, headSnapshotId: null, targets: {}, migrations: {} };
    }
    if (state.schemaVersion !== 1 || state.workspaceId !== this.config.workspaceId || !state.targets || !state.migrations) throw storageError('CORRUPT_STATE', 'Storage state belongs to another workspace or schema');
    return state;
  }

  async withLock(operation) {
    assertOutsideWorkspace(await canonicalPath(this.config.stateRoot), 'stateRoot');
    await mkdir(this.config.stateRoot, { recursive: true, mode: 0o700 });
    const lockPath = resolve(this.config.stateRoot, 'coordinator.lock');
    let handle;
    try { handle = await open(lockPath, 'wx', 0o600); }
    catch (error) {
      if (error.code === 'EEXIST') throw storageError('LOCKED', 'Another storage operation holds the coordinator lock; stop all coordinators before recovering a stale lock');
      throw error;
    }
    try { await handle.writeFile(`${process.pid}\n`); return await operation(); }
    finally { await handle.close(); await unlink(lockPath).catch(() => {}); }
  }

  async updateTarget(state, repo, patch) {
    state.targets[repo.id] = { ...state.targets[repo.id], ...patch, updatedAt: new Date().toISOString() };
    await writePrivateJson(this.stateFile, state);
  }

  async prepare(repo) {
    this.assertRunning();
    if (this.prepared.has(repo.id)) return this.prepared.get(repo.id);
    await assertPrivateFile(repo.passwordFile);
    const env = {};
    let location;
    if (repo.type === 'local') {
      const canonical = await canonicalPath(repo.path);
      assertOutsideWorkspace(canonical, 'Repository path');
      for (const protectedPath of [this.config.stateRoot, resolve(this.config.dataRoot, 'workspaces', this.config.workspaceId, 'apps'), ...this.config.appSources.map(item => item.source)]) {
        const protectedCanonical = await canonicalPath(protectedPath);
        if (isWithin(canonical, protectedCanonical) || isWithin(protectedCanonical, canonical)) throw storageError('UNSAFE_PATH', 'Repository must not overlap active application data or coordinator state');
      }
      location = repo.path;
    }
    else if (repo.type === 'rclone') {
      await assertPrivateFile(repo.rcloneConfigFile);
      env.RCLONE_CONFIG = repo.rcloneConfigFile;
      location = `rclone:${repo.remote}:${repo.remotePath}`;
    } else {
      const credentials = await jianguoyunCredentials(repo);
      let obscured;
      try { obscured = (await this.execute(this.rcloneBinary, ['obscure', '-'], { input: credentials.applicationPassword, env: cleanEnvironment(), ...(this.activeAbortSignal ? { signal: this.activeAbortSignal } : {}) })).stdout.trim(); }
      catch (error) { throw sanitizeCommandError(error, 'rclone'); }
      const remote = `praxis_${repo.id.replaceAll('-', '_')}`;
      const prefix = `RCLONE_CONFIG_${remote.toUpperCase()}_`;
      Object.assign(env, {
        [`${prefix}TYPE`]: 'webdav', [`${prefix}URL`]: 'https://dav.jianguoyun.com/dav/',
        [`${prefix}VENDOR`]: 'other', [`${prefix}USER`]: credentials.username, [`${prefix}PASS`]: obscured,
      });
      location = `rclone:${remote}:${repo.remotePath}`;
    }
    const result = { location, env };
    this.prepared.set(repo.id, result);
    return result;
  }

  async environment(repo, source) {
    const prepared = await this.prepare(repo);
    const sourcePrepared = source ? await this.prepare(source) : null;
    const remote = repo.type !== 'local' || (source && source.type !== 'local');
    if (repo.type === 'rclone' && source?.type === 'rclone' && repo.rcloneConfigFile !== source.rcloneConfigFile) throw storageError('INVALID_CONFIG', 'Copying between configured rclone remotes requires a shared private rclone configuration file');
    const env = {
      ...cleanEnvironment(), ...(sourcePrepared?.env ?? {}), ...prepared.env,
      RESTIC_REPOSITORY: prepared.location, RESTIC_PASSWORD_FILE: repo.passwordFile,
      RESTIC_CACHE_DIR: resolve(this.config.stateRoot, 'cache', repo.id),
      ...(source ? { RESTIC_FROM_REPOSITORY: sourcePrepared.location, RESTIC_FROM_PASSWORD_FILE: source.passwordFile } : {}),
    };
    if (remote) Object.assign(env, {
      RCLONE_TPSLIMIT: '0.1', RCLONE_TPSLIMIT_BURST: '1', RCLONE_TRANSFERS: '1', RCLONE_CHECKERS: '1',
      RCLONE_RETRIES: '1', RCLONE_LOW_LEVEL_RETRIES: '1', RCLONE_TIMEOUT: '1m', RCLONE_CONTIMEOUT: '20s',
    });
    return env;
  }

  async restic(repo, args, { source, cwd, retry = true } = {}) {
    this.assertRunning();
    const env = await this.environment(repo, source);
    this.assertRunning();
    const remote = repo.type !== 'local' || (source && source.type !== 'local');
    const flags = ['--json', '--pack-size', '8', ...(remote ? ['-o', `rclone.program=${this.rcloneBinary}`, '-o', 'rclone.connections=1', '-o', 'rclone.args=serve restic --stdio'] : [])];
    let failure;
    for (let attempt = 0; attempt < (retry ? this.config.retryAttempts : 1); attempt++) {
      try { return await this.execute(this.resticBinary, [...flags, ...args], { env, cwd, ...(this.activeAbortSignal ? { signal: this.activeAbortSignal } : {}) }); }
      catch (error) {
        failure = sanitizeCommandError(error, 'restic');
        if (!failure.retryable || attempt + 1 === this.config.retryAttempts) throw failure;
        try { await this.sleep(Math.min(30000, 1000 * 2 ** attempt), undefined, this.activeAbortSignal ? { signal: this.activeAbortSignal } : undefined); }
        catch (error) { throw sanitizeCommandError(error, 'restic'); }
      }
    }
    throw failure;
  }

  async guardListing(repo, { allowMissing = false } = {}) {
    this.assertRunning();
    if (repo.type !== 'jianguoyun') return;
    const prepared = await this.prepare(repo);
    let result;
    try {
      result = await this.execute(this.rcloneBinary, ['lsjson', prepared.location.slice('rclone:'.length), '--recursive'], { env: await this.environment(repo), ...(this.activeAbortSignal ? { signal: this.activeAbortSignal } : {}) });
    } catch (error) {
      const failure = sanitizeCommandError(error, 'rclone');
      if (allowMissing && failure.code === 'NOT_INITIALIZED') return;
      throw failure;
    }
    let entries;
    try { entries = JSON.parse(result.stdout); } catch { throw storageError('REMOTE_FAILED', 'Remote listing returned invalid metadata'); }
    if (!Array.isArray(entries)) throw storageError('REMOTE_FAILED', 'Remote listing returned invalid metadata');
    const counts = new Map();
    for (const entry of entries) {
      if (typeof entry.Path !== 'string' || entry.Path.startsWith('/') || entry.Path.split('/').some(part => part === '..')) throw storageError('REMOTE_FAILED', 'Remote listing contained unsafe paths');
      const parent = dirname(entry.Path);
      counts.set(parent, (counts.get(parent) ?? 0) + 1);
    }
    // A WebDAV response can include the directory itself in its 750 entries.
    if ([...counts.values()].some(count => count >= 749)) throw storageError('LISTING_LIMIT', 'Remote listing reached the safe provider limit; automatic operations were stopped');
  }

  async inspect(repo, { allowMissing = false } = {}) {
    await this.guardListing(repo, { allowMissing });
    let result;
    try { result = await this.restic(repo, ['snapshots']); }
    catch (error) { if (allowMissing && error.code === 'NOT_INITIALIZED') return null; throw error; }
    let snapshots;
    try { snapshots = JSON.parse(result.stdout); } catch { throw storageError('RESTIC_FAILED', 'Repository returned invalid snapshot metadata'); }
    if (!Array.isArray(snapshots)) throw storageError('RESTIC_FAILED', 'Repository returned invalid snapshot metadata');
    return snapshots.map(snapshot => {
      const tags = snapshot.tags ?? [];
      const parent = tagValue(tags, 'parent');
      if (!/^[a-f0-9]{64}$/.test(snapshot.id ?? '')) throw conflict('Invalid encrypted snapshot identity');
      if (!/^[a-f0-9]{64}$/.test(snapshot.tree ?? '')) throw conflict('Invalid encrypted snapshot tree');
      return { repositoryId: repo.id, resticId: snapshot.id, treeHash: snapshot.tree, workspaceId: tagValue(tags, 'workspace'), snapshotId: tagValue(tags, 'snapshot'), parentSnapshotId: parent === 'root' ? null : parent, writerDeviceId: tagValue(tags, 'writer'), createdAt: snapshot.time };
    });
  }

  async collect(state, { allowMissing = false } = {}) {
    const targets = new Map(), failures = new Map();
    for (const repo of this.config.repositories) {
      try { targets.set(repo.id, await this.inspect(repo, { allowMissing })); }
      catch (error) {
        if (error.code === 'ABORTED') throw error;
        if (isConflict(error)) throw error;
        failures.set(repo.id, error);
        await this.updateTarget(state, repo, { status: error.code === 'NOT_CONFIGURED' ? 'unconfigured' : 'failed', error: publicFailure(error) });
      }
    }
    const lineage = validateLineage([...targets.values()].flatMap(records => records ?? []), this.config);
    return { targets, failures, ...lineage };
  }

  async ensureInitialized(repo, source) {
    if (await this.inspect(repo, { allowMissing: true }) !== null) return;
    if (repo.type === 'local') {
      const info = await lstat(repo.path).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
      if (info && (!info.isDirectory() || info.isSymbolicLink() || (await readdir(repo.path)).length)) throw storageError('NOT_EMPTY', 'New local repositories require an empty directory');
      await mkdir(repo.path, { recursive: true, mode: 0o700 });
    }
    if (repo.type === 'jianguoyun') await this.initializeJianguoyunPath(repo);
    await this.restic(repo, ['init', ...(source ? ['--copy-chunker-params'] : [])], { source });
    await this.guardListing(repo);
  }

  async initializeJianguoyunPath(repo) {
    this.assertWriter();
    this.assertRunning();
    const configured = this.repository(repo.id);
    if (repo.type !== 'jianguoyun' || typeof repo.remotePath !== 'string' || repo.remotePath !== configured.remotePath || repo.credentialsFile !== configured.credentialsFile) throw storageError('INVALID_CONFIG', 'Cloud initialization requires its configured repository namespace');
    const parts = repo.remotePath.split('/');
    if (parts[0] !== 'praxis' || parts[1] !== this.config.workspaceId || parts.some(part => !part || part === '.' || part === '..' || /[\\\0\r\n]/.test(part))) throw storageError('INVALID_CONFIG', 'Cloud initialization requires the configured Praxis workspace namespace');
    const credentials = await jianguoyunCredentials(repo);
    const authorization = `Basic ${Buffer.from(`${credentials.username}:${credentials.applicationPassword}`).toString('base64')}`;
    for (let index = 0; index < parts.length; index++) {
      if (index) {
        try { await this.sleep(10000, undefined, this.activeAbortSignal ? { signal: this.activeAbortSignal } : undefined); }
        catch { throw storageError('ABORTED', 'Storage operation was cancelled'); }
      }
      this.assertRunning();
      const url = `https://dav.jianguoyun.com/dav/${parts.slice(0, index + 1).map(encodeURIComponent).join('/')}/`;
      const timeout = AbortSignal.timeout(20000);
      const signal = this.activeAbortSignal ? AbortSignal.any([this.activeAbortSignal, timeout]) : timeout;
      let response;
      try { response = await this.fetch(url, { method: 'MKCOL', headers: { Authorization: authorization }, redirect: 'error', signal }); }
      catch {
        if (this.activeAbortSignal?.aborted) throw storageError('ABORTED', 'Storage operation was cancelled');
        const error = storageError('REMOTE_FAILED', 'WebDAV initialization failed; no provider response was logged');
        error.retryable = true;
        throw error;
      }
      await response.body?.cancel().catch(() => {});
      if (![201, 405].includes(response.status)) {
        const error = storageError('REMOTE_FAILED', 'WebDAV initialization failed; no provider response was logged');
        error.httpStatus = response.status;
        error.retryable = [429, 502, 503, 504].includes(response.status);
        throw error;
      }
    }
  }

  async initialize() {
    return this.withLock(async () => {
      this.assertWriter();
      const state = await this.state(), primary = this.repository(this.config.primaryRepositoryId);
      await this.ensureInitialized(primary);
      for (const repo of this.config.repositories) {
        try {
          if (repo.id !== primary.id) await this.ensureInitialized(repo, primary);
          await this.updateTarget(state, repo, { status: 'pending', error: null });
        } catch (error) {
          if (error.code === 'ABORTED') throw error;
          if (isConflict(error)) throw error;
          await this.updateTarget(state, repo, { status: error.code === 'NOT_CONFIGURED' ? 'unconfigured' : 'failed', error: publicFailure(error) });
        }
      }
      await this.collect(state);
      return this.status();
    });
  }

  async status() {
    const state = await this.state();
    return { schemaVersion: 1, workspaceId: this.config.workspaceId, deviceId: this.config.deviceId, activeWriterDeviceId: this.config.activeWriterDeviceId, headSnapshotId: state.headSnapshotId, primaryRepositoryId: this.config.primaryRepositoryId, preferredRepositoryId: this.config.preferredRepositoryId, repositories: this.config.repositories.map(repo => ({ id: repo.id, type: repo.type, ...(state.targets[repo.id] ?? { status: 'unconfigured' }) })), migrations: state.migrations };
  }

  async snapshot() {
    return this.withLock(async () => {
      this.assertWriter();
      this.assertRunning();
      const state = await this.state(), primary = this.repository(this.config.primaryRepositoryId);
      await this.ensureInitialized(primary);
      const known = await this.collect(state, { allowMissing: true });
      if (known.failures.has(primary.id)) throw known.failures.get(primary.id);
      const local = known.targets.get(primary.id) ?? [];
      if (known.head && !local.some(item => item.snapshotId === known.head)) throw storageError('LOCAL_BEHIND', 'Restore repository history from the advanced replica before creating a new snapshot');
      if (state.headSnapshotId && state.headSnapshotId !== known.head) throw conflict('Local coordinator head does not match repository history');
      const staged = await this.createSnapshot({ ...this.config, parentSnapshotId: known.head });
      const manifest = await this.verifySnapshot(staged.directory);
      if (manifest.workspaceId !== this.config.workspaceId || manifest.writerDeviceId !== this.config.deviceId || manifest.parentSnapshotId !== known.head || !SNAPSHOT_ID.test(manifest.snapshotId)) throw conflict('Snapshot manifest does not match the active writer and parent');
      this.assertRunning();
      const contentHash = createHash('sha256').update(JSON.stringify({ schemaVersion: manifest.schemaVersion, workspaceId: manifest.workspaceId, writerDeviceId: manifest.writerDeviceId, files: manifest.files, apps: manifest.apps, sourceVersion: manifest.sourceVersion, coverage: manifest.coverage })).digest('hex');
      if (known.head && state.headSnapshotId === known.head && state.lastContentHash === contentHash) {
        await this.updateTarget(state, primary, { status: 'success', lastSnapshotId: known.head, lastVerifiedAt: new Date().toISOString(), error: null });
        if (isWithin(this.config.stateRoot, staged.directory) && resolve(staged.directory) !== resolve(this.config.stateRoot)) await rm(staged.directory, { recursive: true, force: true });
        return { snapshotId: known.head, repositoryId: primary.id, files: manifest.files.length, unchanged: true, coverage: manifest.coverage };
      }
      await this.restic(primary, ['backup', '.', '--host', this.config.deviceId, '--no-scan', '--force', '--tag', `${TAGS.workspace}${this.config.workspaceId}`, '--tag', `${TAGS.snapshot}${manifest.snapshotId}`, '--tag', `${TAGS.parent}${manifest.parentSnapshotId ?? 'root'}`, '--tag', `${TAGS.writer}${manifest.writerDeviceId}`], { cwd: staged.directory });
      const after = await this.inspect(primary);
      const chain = validateLineage(after, this.config);
      if (chain.head !== manifest.snapshotId) throw conflict('Encrypted backup head did not match the staged snapshot');
      state.headSnapshotId = manifest.snapshotId;
      state.lastContentHash = contentHash;
      for (const repo of this.config.repositories) {
        if (repo.id !== primary.id) state.targets[repo.id] = { ...state.targets[repo.id], status: state.targets[repo.id]?.status === 'unconfigured' ? 'unconfigured' : 'pending', pendingSnapshotId: manifest.snapshotId };
      }
      await this.updateTarget(state, primary, { status: 'success', lastSnapshotId: manifest.snapshotId, lastSuccessAt: new Date().toISOString(), lastVerifiedAt: new Date().toISOString(), pendingSnapshotId: null, error: null });
      if (isWithin(this.config.stateRoot, staged.directory) && resolve(staged.directory) !== resolve(this.config.stateRoot)) await rm(staged.directory, { recursive: true, force: true });
      return { snapshotId: manifest.snapshotId, repositoryId: primary.id, files: manifest.files.length, coverage: manifest.coverage };
    });
  }

  async copyTarget(state, source, target, sourceRecords, targetRecords) {
    validateLineage([...sourceRecords, ...targetRecords], this.config);
    const targetIds = new Set(targetRecords.map(item => item.snapshotId));
    const missing = sourceRecords.filter(record => !targetIds.has(record.snapshotId));
    if (missing.length) await this.restic(target, ['copy', ...missing.map(record => record.resticId)], { source });
    await this.guardListing(target);
    const copied = await this.inspect(target);
    validateLineage([...sourceRecords, ...copied], this.config);
    const copiedIds = new Set(copied.map(record => record.snapshotId));
    if (sourceRecords.some(record => !copiedIds.has(record.snapshotId))) throw storageError('INCOMPLETE_COPY', 'Not all source snapshots are present in the target');
    const head = validateLineage(copied, this.config).head;
    await this.updateTarget(state, target, { status: 'success', lastSnapshotId: head, lastSuccessAt: new Date().toISOString(), pendingSnapshotId: null, error: null });
    return { repositoryId: target.id, status: 'success', snapshotId: head, copied: missing.length };
  }

  async sync({ from = this.config.primaryRepositoryId, to } = {}) {
    return this.withLock(async () => {
      this.assertWriter();
      const state = await this.state(), source = this.repository(from);
      const known = await this.collect(state, { allowMissing: true });
      if (known.failures.has(source.id)) throw known.failures.get(source.id);
      const sourceRecords = known.targets.get(source.id);
      if (!sourceRecords) throw storageError('NOT_INITIALIZED', 'Source repository is not initialized');
      validateLineage(sourceRecords, this.config);
      if (validateLineage(sourceRecords, this.config).head !== known.head) throw storageError('LOCAL_BEHIND', 'Sync source does not contain the latest known snapshot');
      const results = [];
      for (const target of this.config.repositories.filter(repo => repo.id !== source.id && (!to || repo.id === to))) {
        try {
          if (known.failures.has(target.id)) throw known.failures.get(target.id);
          await this.ensureInitialized(target, source);
          results.push(await this.copyTarget(state, source, target, sourceRecords, known.targets.get(target.id) ?? []));
        } catch (error) {
          if (error.code === 'ABORTED') throw error;
          if (isConflict(error)) throw error;
          const status = error.code === 'NOT_CONFIGURED' ? 'unconfigured' : 'failed';
          await this.updateTarget(state, target, { status, error: publicFailure(error), pendingSnapshotId: validateLineage(sourceRecords, this.config).head });
          results.push({ repositoryId: target.id, status, error: publicFailure(error) });
        }
      }
      if (to && !this.config.repositories.some(repo => repo.id === to && repo.id !== source.id)) throw storageError('INVALID_CONFIG', 'Sync target must be a different configured repository');
      return { sourceRepositoryId: source.id, results };
    });
  }

  async check({ repositoryId = this.config.preferredRepositoryId, readData = true } = {}) {
    return this.withLock(async () => {
      const state = await this.state(), repo = this.repository(repositoryId);
      try {
        const known = await this.collect(state);
        if (known.failures.has(repo.id)) throw known.failures.get(repo.id);
        await this.restic(repo, ['check', ...(readData ? ['--read-data'] : [])]);
        await this.guardListing(repo);
        await this.updateTarget(state, repo, { lastCheckAt: new Date().toISOString(), lastCheckStatus: 'success', error: null });
        return { repositoryId: repo.id, status: 'success', readData };
      } catch (error) {
        await this.updateTarget(state, repo, { lastCheckStatus: 'failed', error: publicFailure(error) });
        throw error;
      }
    });
  }

  async restoreInto(repo, records, target, snapshotId) {
    assertOutsideWorkspace(target, 'Restore destination');
    const info = await lstat(target).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
    if (info && (!info.isDirectory() || info.isSymbolicLink() || (await readdir(target)).length)) throw storageError('NOT_EMPTY', 'Restore destination must be a new empty directory');
    const canonicalTarget = await canonicalPath(target);
    assertOutsideWorkspace(canonicalTarget, 'Restore destination');
    const protectedPaths = [resolve(this.config.dataRoot, 'workspaces', this.config.workspaceId, 'apps'), this.config.stateRoot, ...this.config.appSources.map(item => item.source), ...this.config.repositories.filter(item => item.type === 'local').map(item => item.path)];
    for (const protectedPath of protectedPaths) {
      const canonical = await canonicalPath(protectedPath);
      if (isWithin(canonical, canonicalTarget) || isWithin(canonicalTarget, canonical)) throw storageError('UNSAFE_PATH', 'Restore must not overlap active data, repositories or coordinator state');
    }
    await mkdir(target, { recursive: true, mode: 0o700 });
    assertOutsideWorkspace(await realpath(target), 'Restore destination');
    const head = snapshotId ?? validateLineage(records, this.config).head;
    const record = records.find(item => item.snapshotId === head);
    if (!record) throw storageError('SNAPSHOT_NOT_FOUND', 'Requested snapshot is not available in this repository');
    await this.restic(repo, ['restore', record.resticId, '--target', target, '--verify']);
    const manifest = await this.verifySnapshot(target);
    if (manifest.workspaceId !== this.config.workspaceId || manifest.snapshotId !== record.snapshotId || manifest.parentSnapshotId !== record.parentSnapshotId || manifest.writerDeviceId !== record.writerDeviceId) throw conflict('Restored manifest does not match encrypted snapshot metadata');
    await this.guardListing(repo);
    return { repositoryId: repo.id, snapshotId: manifest.snapshotId, target, files: manifest.files.length, coverage: manifest.coverage };
  }

  async restore({ repositoryId = this.config.preferredRepositoryId, target, snapshotId } = {}) {
    return this.withLock(async () => {
      if (!target) throw storageError('INVALID_CONFIG', 'Restore requires an explicit empty destination');
      const state = await this.state(), known = await this.collect(state), repo = this.repository(repositoryId);
      if (known.failures.has(repo.id)) throw known.failures.get(repo.id);
      return this.restoreInto(repo, known.targets.get(repo.id), resolve(target), snapshotId);
    });
  }

  async addTarget(repository) {
    return this.withLock(async () => {
      this.assertWriter();
      const config = validateConfig({ ...this.config, repositories: [...this.config.repositories, repository] });
      if (!this.configFile) throw storageError('INVALID_CONFIG', 'Updating repositories requires a configuration file path');
      await saveConfig(config, this.configFile);
      this.config = config;
      const state = await this.state(), repo = this.repository(repository.id);
      await this.updateTarget(state, repo, { status: 'pending', error: null });
      return { repositoryId: repo.id, status: 'pending' };
    });
  }

  async migrate({ to, from = this.config.preferredRepositoryId } = {}) {
    return this.withLock(async () => {
      this.assertWriter();
      if (!to || to === from || !this.configFile) throw storageError('INVALID_CONFIG', 'Migration requires distinct repository IDs and a configuration file');
      const state = await this.state(), source = this.repository(from), target = this.repository(to);
      const jobId = `${source.id}--${target.id}`;
      const job = state.migrations[jobId] ??= { from, to, startedAt: new Date().toISOString() };
      try {
        job.status = 'copying'; job.error = null; await writePrivateJson(this.stateFile, state);
        const known = await this.collect(state, { allowMissing: true });
        if (known.failures.has(source.id)) throw known.failures.get(source.id);
        if (known.failures.has(target.id)) throw known.failures.get(target.id);
        const records = known.targets.get(source.id);
        if (!records?.length) throw storageError('SNAPSHOT_NOT_FOUND', 'Migration source must contain a verified snapshot');
        if (validateLineage(records, this.config).head !== known.head) throw storageError('LOCAL_BEHIND', 'Migration source does not contain the latest known snapshot');
        await this.ensureInitialized(target, source);
        await this.copyTarget(state, source, target, records, known.targets.get(target.id) ?? []);
        await this.restic(target, ['check', '--read-data']);
        job.status = 'checking'; await writePrivateJson(this.stateFile, state);
        const restoredRecords = await this.inspect(target);
        const trial = resolve(dirname(this.config.stateRoot), `migration-check-${randomUUID()}`);
        try { await this.restoreInto(target, restoredRecords, trial, validateLineage(records, this.config).head); }
        finally { await rm(trial, { recursive: true, force: true }); }
        job.status = 'verified'; job.verifiedAt = new Date().toISOString(); await writePrivateJson(this.stateFile, state);
        this.config = await saveConfig({ ...this.config, preferredRepositoryId: target.id }, this.configFile);
        job.status = 'completed'; job.completedAt = new Date().toISOString(); await writePrivateJson(this.stateFile, state);
        return { from, to, status: job.status, sourcePreserved: true };
      } catch (error) {
        job.status = 'failed'; job.error = publicFailure(error); await writePrivateJson(this.stateFile, state);
        throw error;
      }
    });
  }

  async writerHandover({ toDeviceId, sourceStopped = false } = {}) {
    return this.withLock(async () => {
      this.assertWriter();
      if (!UUID.test(toDeviceId ?? '') || toDeviceId === this.config.deviceId || !sourceStopped || !this.configFile) throw storageError('INVALID_CONFIG', 'Writer handover requires a different device UUID, a configuration file and an explicit source-stopped assertion');
      const state = await this.state(), known = await this.collect(state);
      if (known.failures.size) throw storageError('REPLICA_UNAVAILABLE', 'All configured replicas must be reachable before writer handover');
      if (!known.head || known.head !== state.headSnapshotId) throw conflict('Writer handover requires the latest locally recorded snapshot');
      for (const records of known.targets.values()) {
        if (validateLineage(records, this.config).head !== known.head) throw storageError('REPLICA_PENDING', 'All replicas must contain the latest snapshot before writer handover');
      }
      this.config = await saveConfig({ ...this.config, activeWriterDeviceId: toDeviceId, writerHistory: [...this.config.writerHistory, { deviceId: this.config.deviceId, nextDeviceId: toDeviceId, atSnapshotId: known.head, createdAt: new Date().toISOString() }] }, this.configFile);
      return { activeWriterDeviceId: toDeviceId, snapshotId: known.head, previousWriterDisabled: true };
    });
  }

  async watch({ signal, onResult = () => {} } = {}) {
    const previousSignal = this.activeAbortSignal;
    this.activeAbortSignal = signal;
    try {
      while (!signal?.aborted) {
        try {
          const snapshot = await this.snapshot();
          if (signal?.aborted) break;
          const sync = await this.sync();
          if (!signal?.aborted) onResult({ snapshot, sync });
        } catch (error) {
          if (signal?.aborted || error.code === 'ABORTED') break;
          onResult({ error: publicFailure(error) });
        }
        try { await this.sleep(this.config.intervalSeconds * 1000, undefined, { signal }); }
        catch (error) { if (error.name !== 'AbortError') throw error; }
      }
    } finally { this.activeAbortSignal = previousSignal; }
  }
}
