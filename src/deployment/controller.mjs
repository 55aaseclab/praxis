import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { request } from 'node:http';
import { constants } from 'node:fs';
import { readFile, writeFile, mkdir, rename, unlink, lstat, chmod, realpath, open } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readDeploymentState, writeDeploymentState } from './state.mjs';

export const DEFAULT_DEPLOYMENT_ROOT = join(homedir(), '.config/praxis/deployment');
const workspace = fileURLToPath(new URL('../../', import.meta.url)).replace(/\/$/, '');
const COLORS = ['blue', 'green'];
const DEFAULT_SLOTS = Object.freeze({ blue: { web: 'http://127.0.0.1:24321', core: 'http://127.0.0.1:24326' }, green: { web: 'http://127.0.0.1:34321', core: 'http://127.0.0.1:34326' } });
const fail = (code, message = code) => Object.assign(new Error(message), { code });
const pause = ms => new Promise(resolvePromise => setTimeout(resolvePromise, ms));
export function getDeploymentPaths(root = DEFAULT_DEPLOYMENT_ROOT) {
  root = resolve(root);
  return { root, manifest: join(root, 'manifest.json'), lock: join(root, 'deployment.lock'), stateDir: join(root, 'state'), state: join(root, 'state/state.json'), socketDir: join(root, 'sockets'), leaseDir: join(root, 'lease'), prototypeDir: join(root, 'prototypes'), envDir: join(root, 'env'), appsOverride: join(root, 'compose.apps.yml'), businessOverride: join(root, 'compose.business.yml') };
}
async function optionalJson(file) { try { return JSON.parse(await readFile(file, 'utf8')); } catch (error) { if (error.code === 'ENOENT') return null; throw fail('INVALID_DEPLOYMENT_METADATA'); } }
async function documentBindings(root) {
  let handle;
  try {
    handle = await open(join(root, 'private-documents.json'), constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch (error) {
    if (error.code === 'ENOENT') return { env: {}, mounts: [] };
    throw fail('INVALID_PRIVATE_DOCUMENT_CONFIG');
  }
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.uid !== process.getuid() || (info.mode & 0o077) || info.size > 8192) throw fail('INVALID_PRIVATE_DOCUMENT_CONFIG');
    const config = JSON.parse(await handle.readFile('utf8'));
    if (!config || typeof config.ownerId !== 'string' || !/^[a-zA-Z0-9_.:-]{1,200}$/.test(config.ownerId)) throw fail('INVALID_PRIVATE_DOCUMENT_CONFIG');
    const env = { PRAXIS_DOCUMENT_OWNER_ID: config.ownerId }, mounts = [];
    for (const id of ['letters', 'profiles']) {
      const source = config[id];
      if (typeof source !== 'string' || source === '/' || source !== resolve(source) || /[,\r\n\0]/.test(source) ||
          await realpath(source) !== source || !(await lstat(source)).isDirectory()) throw fail('INVALID_PRIVATE_DOCUMENT_CONFIG');
      const target = '/run/praxis-documents/' + id;
      env['PRAXIS_' + id.toUpperCase() + '_DIR'] = target;
      mounts.push({ type: 'bind', source, target, readOnly: true });
    }
    if (config.letters === config.profiles || config.letters.startsWith(config.profiles + '/') || config.profiles.startsWith(config.letters + '/')) throw fail('INVALID_PRIVATE_DOCUMENT_CONFIG');
    return { env, mounts };
  } catch { throw fail('INVALID_PRIVATE_DOCUMENT_CONFIG'); }
  finally { await handle.close(); }
}
export async function isDeploymentEnabled(root = DEFAULT_DEPLOYMENT_ROOT) { const value = await optionalJson(getDeploymentPaths(root).manifest); return value?.version === 1 && value.enabled === true; }
async function privateJson(file, value) { const temp = `${file}.${randomUUID()}.tmp`; await writeFile(temp, JSON.stringify(value, null, 2) + '\n', { mode: 0o600, flag: 'wx' }); await rename(temp, file); await chmod(file, 0o600); }
async function privateDirectory(path) {
  await mkdir(path, { recursive: true, mode: 0o700 });
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink() || info.uid !== process.getuid() || info.mode & 0o077 || await realpath(path) !== path) throw fail('UNSAFE_DEPLOYMENT_DIRECTORY');
}
async function processStartTick(pid) {
  try { const stat = await readFile(`/proc/${pid}/stat`, 'utf8'); return stat.slice(stat.lastIndexOf(')') + 2).trim().split(/\s+/)[19]; }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
async function lockIdentity() { return { pid: process.pid, uid: process.getuid(), bootId: (await readFile('/proc/sys/kernel/random/boot_id', 'utf8')).trim(), startTick: await processStartTick(process.pid) }; }
async function lockGuard(file) {
  const guard = await open(file, constants.O_CREAT | constants.O_RDWR | constants.O_NOFOLLOW, 0o600);
  try {
    const info = await guard.stat();
    if (!info.isFile() || info.uid !== process.getuid() || info.mode & 0o077) throw fail('UNSAFE_DEPLOYMENT_LOCK');
    await new Promise((accept, reject) => {
      const child = spawn('flock', ['--exclusive', '--nonblock', '3'], { stdio: ['ignore', 'ignore', 'ignore', guard.fd] });
      child.once('error', () => reject(fail('LOCK_SYSTEM_UNAVAILABLE')));
      child.once('close', code => code === 0 ? accept() : reject(fail(code === 1 ? 'DEPLOYMENT_LOCKED' : 'LOCK_SYSTEM_UNAVAILABLE')));
    });
    return guard;
  } catch (error) { await guard.close(); throw error; }
}
async function reclaimDeadLock(file, identity) {
  const info = await lstat(file);
  if (!info.isFile() || info.isSymbolicLink() || info.uid !== identity.uid || info.mode & 0o077 || info.size > 4096) throw fail('DEPLOYMENT_LOCKED');
  let value; try { value = JSON.parse(await readFile(file, 'utf8')); } catch { throw fail('DEPLOYMENT_LOCKED'); }
  if (!Number.isInteger(value.pid) || value.pid <= 0 || value.uid !== identity.uid || !/^[a-f\d-]{36}$/.test(value.bootId || '') || !/^\d+$/.test(value.startTick || '')) throw fail('DEPLOYMENT_LOCKED');
  if (value.bootId === identity.bootId) {
    const currentTick = await processStartTick(value.pid);
    if (currentTick === value.startTick) throw fail('DEPLOYMENT_LOCKED');
  }
  const current = await lstat(file);
  if (current.ino !== info.ino || current.dev !== info.dev) throw fail('DEPLOYMENT_LOCKED');
  await unlink(file);
}
async function execute(command, args, { cwd = workspace, env = process.env } = {}) {
  return new Promise((accept, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] }), chunks = [];
    child.stdout.on('data', chunk => chunks.push(chunk));
    child.stderr.on('data', () => {});
    child.once('error', () => reject(fail('DOCKER_EXECUTION_FAILED')));
    child.once('close', code => code === 0 ? accept(Buffer.concat(chunks).toString('utf8')) : reject(fail('DOCKER_COMMAND_FAILED')));
  });
}
const quote = value => "'" + String(value).replaceAll("'", "'\\''") + "'";
let dockerExecutor;
export async function docker(args, options) {
  if (!dockerExecutor) dockerExecutor = (async () => {
    try { await execute('docker', ['info', '--format', '{{.ServerVersion}}'], options); return 'docker'; }
    catch { await execute('sg', ['docker', '-c', "docker info --format '{{.ServerVersion}}'"], options); return 'sg'; }
  })().catch(error => { dockerExecutor = null; throw error; });
  return await dockerExecutor === 'docker' ? execute('docker', args, options) : execute('sg', ['docker', '-c', ['docker', ...args.map(quote)].join(' ')], options);
}
export function unixControl(socketPath, method = 'GET', path = '/status') {
  return new Promise((accept, reject) => {
    const req = request({ socketPath, method, path, timeout: 3000 }, response => {
      const parts = []; response.on('data', chunk => parts.push(chunk)); response.on('end', () => { try { if (response.statusCode !== 200) throw new Error(); accept(JSON.parse(Buffer.concat(parts).toString('utf8'))); } catch { reject(fail('PROXY_CONTROL_UNAVAILABLE')); } });
    });
    req.on('error', () => reject(fail('PROXY_CONTROL_UNAVAILABLE'))); req.on('timeout', () => req.destroy()); req.end();
  });
}
export class DockerDeploymentOps {
  constructor(paths, { run = docker, timeoutMs = 40000 } = {}) { this.paths = paths; this.run = run; this.timeoutMs = timeoutMs; }
  async original(service) {
    const ids = (await this.run(['ps', '--all', '--filter', `label=com.docker.compose.service=${service}`, '--format', '{{.ID}}'])).trim().split(/\s+/).filter(Boolean);
    const found = [];
    for (const id of ids) { const item = JSON.parse(await this.run(['inspect', id]))[0]; if (resolve(item.Config?.Labels?.['com.docker.compose.project.working_dir'] || '.') === workspace) found.push(item); }
    if (found.length !== 1) throw fail('ORIGINAL_SERVICE_UNAVAILABLE');
    return found[0];
  }
  async buildImage(image) {
    if (!image) { await this.run(['build', '--target', 'praxis', '--tag', 'praxis-deployment/candidate:local', '.']); image = 'praxis-deployment/candidate:local'; }
    return (await this.run(['image', 'inspect', image, '--format', '{{.Id}}'])).trim();
  }
  async buildProxy() { await this.run(['build', '--target', 'deployment-router', '--tag', 'praxis-deployment/router:local', '.']); return (await this.run(['image', 'inspect', 'praxis-deployment/router:local', '--format', '{{.Id}}'])).trim(); }
  async exists(name) { try { return JSON.parse(await this.run(['inspect', name]))[0]; } catch { return null; } }
  async remove(name) { if (await this.exists(name)) await this.run(['rm', '--force', name]); }
  async start(name) { await this.run(['start', name]); }
  async stop(name) { if (await this.exists(name)) await this.run(['stop', '--time', '30', name]); }
  async create(prototype, { name, image, command, env, mounts = [], labels = false }) {
    const environment = new Map((prototype.Config.Env || []).map(value => { const index = value.indexOf('='); return [value.slice(0, index), value.slice(index + 1)]; }));
    for (const [key, value] of Object.entries(env || {})) environment.set(key, String(value));
    if ([...environment].some(([key, value]) => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || /[\r\n\0]/.test(value))) throw fail('UNSUPPORTED_CONTAINER_ENVIRONMENT');
    const envFile = join(this.paths.envDir, `${name}.env`); await writeFile(envFile, [...environment].map(([key, value]) => `${key}=${value}`).join('\n') + '\n', { mode: 0o600 }); await chmod(envFile, 0o600);
    const host = prototype.HostConfig, args = ['create', '--name', name, '--network', 'host', '--env-file', envFile, '--restart', 'unless-stopped', '--stop-timeout', '30'];
    if (prototype.Config.User) args.push('--user', prototype.Config.User);
    if (prototype.Config.WorkingDir) args.push('--workdir', prototype.Config.WorkingDir);
    if (host.ReadonlyRootfs) args.push('--read-only'); if (host.Init) args.push('--init');
    for (const capability of host.CapDrop || []) args.push('--cap-drop', capability);
    for (const capability of host.CapAdd || []) args.push('--cap-add', capability);
    for (const option of host.SecurityOpt || []) args.push('--security-opt', option);
    for (const [path, options] of Object.entries(host.Tmpfs || {})) args.push('--tmpfs', `${path}:${options}`);
    if (host.ShmSize) args.push('--shm-size', String(host.ShmSize));
    for (const mount of [...prototype.Mounts.map(value => ({ type: value.Type, source: value.Type === 'volume' ? value.Name : value.Source, target: value.Destination, readOnly: !value.RW })), ...mounts]) {
      if (!['bind', 'volume'].includes(mount.type) || [mount.source, mount.target].some(value => typeof value !== 'string' || /[,\r\n\0]/.test(value))) throw fail('UNSUPPORTED_CONTAINER_MOUNT');
      args.push('--mount', `type=${mount.type},source=${mount.source},target=${mount.target}${mount.readOnly ? ',readonly' : ''}`);
    }
    if (labels) for (const [key, value] of Object.entries(prototype.Config.Labels || {})) args.push('--label', `${key}=${value}`);
    args.push(image, ...(command || prototype.Config.Cmd)); await this.run(args); await this.start(name);
  }
  async stage(color, image, prototypes, state) {
    const documents = await documentBindings(this.paths.root);
    const slot = { image, coreContainer: `praxis-${color}-core`, webContainer: `praxis-${color}-web`, leaseOwner: randomUUID() };
    for (const name of [slot.webContainer, slot.coreContainer]) await this.remove(name);
    const shared = [{ type: 'bind', source: this.paths.stateDir, target: '/run/praxis-deploy/state', readOnly: true }];
    await this.create(prototypes.core, { name: slot.coreContainer, image, command: ['node', 'scripts/serve-business-slot.mjs', '--host', '127.0.0.1', '--port', new URL(state.slots[color].core).port, '--slot', color, '--state', '/run/praxis-deploy/state/state.json'], env: { PRAXIS_DEPLOY_LEASE_DIR: '/run/praxis-deploy/lease', PRAXIS_DEPLOY_LEASE_OWNER: slot.leaseOwner }, mounts: [...shared, { type: 'bind', source: this.paths.leaseDir, target: '/run/praxis-deploy/lease', readOnly: false }] });
    await this.create(prototypes.web, { name: slot.webContainer, image, command: ['node', 'scripts/serve-public-praxis.mjs'], env: { PORT: new URL(state.slots[color].web).port, HOST: '127.0.0.1', PRAXIS_WEB_CORE_URL: state.slots[color].core, ...documents.env }, mounts: [...shared, ...documents.mounts] });
    return slot;
  }
  async health(color, state, role) {
    const response = await fetch(state.slots[color].core + '/health', { signal: AbortSignal.timeout(2000) }); const core = await response.json();
    if (!response.ok || role && core.role !== role || core.slot !== color) throw fail('SLOT_NOT_READY');
    const web = await fetch(state.slots[color].web + '/health', { signal: AbortSignal.timeout(2000) }); await web.body?.cancel(); if (!web.ok) throw fail('SLOT_NOT_READY');
    return { role: core.role, version: core.version, healthy: true };
  }
  control(channel, method = 'GET', path = '/status') { return unixControl(join(this.paths.socketDir, `${channel}.sock`), method, path); }
  async facades(prototypes, proxyImage) {
    for (const [service, prototype, file, channel, port, host] of [['praxis-public', prototypes.web, this.paths.appsOverride, 'web', 14321, '0.0.0.0'], ['business', prototypes.core, this.paths.businessOverride, 'core', 4326, '127.0.0.1']]) {
      const command = ['node', 'scripts/serve-deploy-proxy.mjs', '--channel', channel, '--state', '/run/praxis-deploy/state/state.json', '--socket', `/run/praxis-deploy/sockets/${channel}.sock`, '--host', host, '--port', String(port)];
      const mounts = [{ type: 'bind', source: this.paths.stateDir, target: '/run/praxis-deploy/state', read_only: true, bind: { create_host_path: false } }, { type: 'bind', source: this.paths.socketDir, target: '/run/praxis-deploy/sockets', bind: { create_host_path: false } }];
      const healthcheck = { test: ['CMD', 'node', '-e', 'fetch(process.env.HEALTH_URL,{signal:AbortSignal.timeout(5000)}).then(response=>process.exit(response.ok?0:1)).catch(()=>process.exit(1))'], interval: '5s', timeout: '6s', start_period: '5s', retries: 5 };
      const yaml = `services:\n  ${service}:\n    image: ${JSON.stringify(proxyImage)}\n    build: !reset null\n    command: ${JSON.stringify(command)}\n    network_mode: host\n    ports: !reset []\n    user: ${JSON.stringify(prototype.Config.User || '1000:1000')}\n    volumes: !override ${JSON.stringify(mounts)}\n    environment: !override ${JSON.stringify({ HEALTH_URL: `http://127.0.0.1:${port}/health` })}\n    healthcheck: !override ${JSON.stringify(healthcheck)}\n`;
      await writeFile(file, yaml, { mode: 0o600 }); await chmod(file, 0o600);
    }
  }
  async applyFacade(prototype, override) {
    const labels = prototype.Config.Labels, files = (labels['com.docker.compose.project.config_files'] || '').split(',').filter(Boolean);
    if (!files.length) throw fail('ORIGINAL_COMPOSE_METADATA_MISSING');
    const directory = labels['com.docker.compose.project.working_dir'] || workspace;
    const args = ['compose', '--project-directory', directory, '--project-name', labels['com.docker.compose.project']];
    const envFile = labels['com.docker.compose.project.environment_file']; if (envFile) args.push('--env-file', envFile);
    for (const file of files) args.push('--file', file);
    args.push('--file', override, 'up', '--detach', '--no-deps', '--no-build', '--force-recreate', '--wait', '--wait-timeout', '60', labels['com.docker.compose.service']);
    await this.run(args, { cwd: directory });
  }
  async restoreOriginal(prototype) { const name = prototype.Name.replace(/^\//, ''); await this.remove(name); await this.create(prototype, { name, image: prototype.Image, command: prototype.Config.Cmd, env: {}, labels: true }); }
}

export class DeploymentController {
  constructor({ root = DEFAULT_DEPLOYMENT_ROOT, ops, timeoutMs = 40000, sleep = pause, now = Date.now } = {}) { this.paths = getDeploymentPaths(root); this.ops = ops || new DockerDeploymentOps(this.paths); this.timeoutMs = timeoutMs; this.sleep = sleep; this.now = now; }
  async prepare() { for (const path of [this.paths.root, this.paths.stateDir, this.paths.socketDir, this.paths.leaseDir, this.paths.prototypeDir, this.paths.envDir]) await privateDirectory(path); }
  async locked(action) {
    await this.prepare(); const guard = await lockGuard(this.paths.lock + '.guard'); let handle;
    try {
      const identity = await lockIdentity();
      try { handle = await open(this.paths.lock, 'wx', 0o600); }
      catch (error) { if (error.code !== 'EEXIST') throw error; await reclaimDeadLock(this.paths.lock, identity); handle = await open(this.paths.lock, 'wx', 0o600); }
      await handle.writeFile(JSON.stringify({ ...identity, at: this.now() }));
      try { return await action(); } finally {
        const own = await handle.stat(); await handle.close(); handle = null;
        const current = await lstat(this.paths.lock).catch(() => null);
        if (current?.ino === own.ino && current?.dev === own.dev) await unlink(this.paths.lock);
      }
    } finally { if (handle) await handle.close(); await guard.close(); }
  }
  async manifest() { const value = await optionalJson(this.paths.manifest); if (!value || value.version !== 1 || value.enabled !== true) throw fail('DEPLOYMENT_NOT_INITIALIZED'); return value; }
  async prototypes() { return { web: await optionalJson(join(this.paths.prototypeDir, 'web.json')), core: await optionalJson(join(this.paths.prototypeDir, 'core.json')) }; }
  async assertSettled(manifest) { const state = await readDeploymentState(this.paths.state); if (state.paused || state.writer !== state.active || state.active !== manifest.active) throw fail('DEPLOYMENT_RECOVERY_REQUIRED'); return state; }
  async change(patch) { const current = await readDeploymentState(this.paths.state); const next = { ...current, ...patch, generation: current.generation + 1 }; await writeDeploymentState(this.paths.state, next); return next; }
  async until(check, code = 'DEPLOYMENT_HEALTH_TIMEOUT') {
    const end = this.now() + this.timeoutMs;
    for (;;) { try { const value = await check(); if (value) return value; } catch {} if (this.now() >= end) throw fail(code); await this.sleep(100); }
  }
  async ready(color, role) { return this.until(async () => this.ops.health(color, await readDeploymentState(this.paths.state), role)); }
  async acknowledged(state) { return this.until(async () => { const rows = await Promise.all(['web','core'].map(channel => this.ops.control(channel))); return rows.every(row => row.generation >= state.generation && row.paused === state.paused) && rows; }, 'PROXY_ACK_TIMEOUT'); }
  async handoff(target, manifest, { proxies = true } = {}) {
    let state = await this.change({ paused: true });
    if (proxies) {
      await this.acknowledged(state);
      await Promise.all(['web','core'].map(channel => this.ops.control(channel, 'POST', '/close-streams')));
      await this.until(async () => { const rows = await Promise.all(['web','core'].map(channel => this.ops.control(channel))); return rows.every(row => row.generation >= state.generation && row.inFlight.normal === 0); }, 'REQUEST_DRAIN_TIMEOUT');
    }
    state = await this.change({ writer: null, paused: true });
    for (const color of COLORS) if (manifest.slots[color]) await this.ready(color, 'standby');
    state = await this.change({ writer: target, paused: true }); await this.ready(target, 'active');
    state = await this.change({ active: target, writer: target, paused: false });
    if (proxies) await this.acknowledged(state);
    return state;
  }
  async init({ image } = {}) {
    return this.locked(async () => {
      if (await isDeploymentEnabled(this.paths.root)) return this.status();
      const prototypes = { web: await this.ops.original('praxis-public'), core: await this.ops.original('business') };
      await privateJson(join(this.paths.prototypeDir, 'web.json'), prototypes.web); await privateJson(join(this.paths.prototypeDir, 'core.json'), prototypes.core);
      const pinned = await this.ops.buildImage(image), proxyImage = await this.ops.buildProxy();
      await writeDeploymentState(this.paths.state, { version: 1, generation: 1, active: 'blue', writer: null, paused: true, slots: structuredClone(DEFAULT_SLOTS) });
      const manifest = { version: 1, enabled: false, active: 'blue', previous: null, initializedAt: new Date(this.now()).toISOString(), proxyImage, slots: {} };
      let legacyStopped = false, facadeApplied = false;
      try {
        manifest.slots.blue = await this.ops.stage('blue', pinned, prototypes, await readDeploymentState(this.paths.state)); await this.ready('blue', 'standby');
        await this.ops.stop(prototypes.core.Name.replace(/^\//, '')); legacyStopped = true;
        await this.handoff('blue', manifest, { proxies: false });
        await this.ops.facades(prototypes, proxyImage);
        await this.ops.applyFacade(prototypes.core, this.paths.businessOverride); facadeApplied = true;
        await this.ops.applyFacade(prototypes.web, this.paths.appsOverride);
        await this.acknowledged(await readDeploymentState(this.paths.state));
        manifest.enabled = true; await privateJson(this.paths.manifest, manifest); return this.status();
      } catch (error) {
        try { await this.change({ paused: true, writer: null }); } catch {}
        if (manifest.slots.blue) {
          await this.ops.stop(manifest.slots.blue.webContainer);
          await this.ops.stop(manifest.slots.blue.coreContainer);
        }
        if (legacyStopped) { try { await this.ops.restoreOriginal(prototypes.core); } catch {} }
        if (facadeApplied) { try { await this.ops.restoreOriginal(prototypes.web); } catch {} }
        throw fail(error.code || 'INITIALIZATION_FAILED');
      }
    });
  }
  async deploy({ image } = {}) {
    return this.locked(async () => {
      const manifest = await this.manifest(), old = manifest.active, target = old === 'blue' ? 'green' : 'blue';
      await this.assertSettled(manifest);
      const pinned = await this.ops.buildImage(image), prototypes = await this.prototypes();
      let switching = false;
      try {
        const slot = await this.ops.stage(target, pinned, prototypes, await readDeploymentState(this.paths.state)); manifest.slots[target] = slot;
        await this.ready(target, 'standby');
        await privateJson(this.paths.manifest, manifest);
        switching = true; await this.handoff(target, manifest);
        manifest.active = target; manifest.previous = old; manifest.deployedAt = new Date(this.now()).toISOString(); await privateJson(this.paths.manifest, manifest);
        return this.status();
      } catch (error) {
        if (!switching) {
          await this.ops.stop(`praxis-${target}-web`); await this.ops.stop(`praxis-${target}-core`);
          delete manifest.slots[target]; if (manifest.previous === target) manifest.previous = null;
          manifest.lastFailure = { code: error.code || 'CANDIDATE_NOT_READY', phase: 'candidate', at: new Date(this.now()).toISOString() };
          await privateJson(this.paths.manifest, manifest);
          throw fail(error.code || 'CANDIDATE_NOT_READY');
        }
        try { await this.handoff(old, manifest); } catch { throw fail('ROLLBACK_REQUIRED'); }
        manifest.lastFailure = { code: error.code || 'DEPLOYMENT_FAILED', phase: 'handoff', restored: old, at: new Date(this.now()).toISOString() };
        await privateJson(this.paths.manifest, manifest);
        throw fail(error.code || 'DEPLOYMENT_FAILED');
      }
    });
  }
  async rebind({ image } = {}) {
    return this.locked(async () => {
      const manifest = await this.manifest(), state = await readDeploymentState(this.paths.state);
      if (!state.paused || state.writer !== null || state.active !== manifest.active) throw fail('DEPLOYMENT_MUST_BE_STOPPED');
      if (typeof image !== 'string' || !image.trim()) throw fail('REBIND_IMAGE_REQUIRED');
      if (typeof this.ops.exists !== 'function') throw fail('SLOT_STATE_UNAVAILABLE');
      const names = new Set(COLORS.flatMap(color => [`praxis-${color}-core`, `praxis-${color}-web`]));
      for (const slot of Object.values(manifest.slots)) {
        if (!slot || typeof slot.coreContainer !== 'string' || typeof slot.webContainer !== 'string') throw fail('INVALID_DEPLOYMENT_METADATA');
        names.add(slot.coreContainer); names.add(slot.webContainer);
      }
      for (const name of names) {
        const container = await this.ops.exists(name);
        if (container && container.State?.Running !== false) throw fail('DEPLOYMENT_CONTAINERS_MUST_BE_STOPPED');
      }
      const prototypes = await this.prototypes();
      if (!prototypes.core?.Config || !prototypes.web?.Config || !Array.isArray(prototypes.core.Mounts) || !Array.isArray(prototypes.web.Mounts)) throw fail('INVALID_DEPLOYMENT_PROTOTYPES');
      const pinned = await this.ops.buildImage(image);
      const original = structuredClone(manifest);
      manifest.rebindPending = { image: pinned, at: new Date(this.now()).toISOString() };
      await privateJson(this.paths.manifest, manifest);
      try {
        const slots = {};
        for (const color of COLORS) {
          slots[color] = await this.ops.stage(color, pinned, prototypes, state);
          await this.ready(color, 'standby');
        }
        manifest.slots = slots;
        manifest.previous = null;
        manifest.reboundAt = new Date(this.now()).toISOString();
        delete manifest.rebindPending;
        await privateJson(this.paths.manifest, manifest);
        return { ...(await this.status()), rebound: true };
      } catch (error) {
        await this.change({ paused: true, writer: null });
        for (const name of names) { try { await this.ops.stop(name); } catch {} }
        original.rebindPending = manifest.rebindPending;
        original.lastFailure = { code: error.code || 'REBIND_FAILED', phase: 'rebind', at: new Date(this.now()).toISOString() };
        await privateJson(this.paths.manifest, original);
        throw fail(error.code || 'REBIND_FAILED');
      }
    });
  }
  async rollback() {
    return this.locked(async () => {
      const manifest = await this.manifest(), target = manifest.previous;
      await this.assertSettled(manifest);
      if (!target || !manifest.slots[target]) throw fail('ROLLBACK_UNAVAILABLE');
      const old = manifest.active;
      await this.ops.start(manifest.slots[target].coreContainer); await this.ops.start(manifest.slots[target].webContainer); await this.ready(target, 'standby');
      try { await this.handoff(target, manifest); } catch (error) { try { await this.handoff(old, manifest); } catch { throw fail('ROLLBACK_REQUIRED'); } throw error; }
      manifest.active = target; manifest.previous = old; manifest.rolledBackAt = new Date(this.now()).toISOString(); await privateJson(this.paths.manifest, manifest); return this.status();
    });
  }
  async up() {
    return this.locked(async () => {
      const manifest = await this.manifest();
      if (manifest.rebindPending) throw fail('DEPLOYMENT_REBIND_REQUIRED');
      const current = await this.status(); if (current.healthy) return current;
      for (const slot of Object.values(manifest.slots)) { await this.ops.start(slot.coreContainer); await this.ops.start(slot.webContainer); }
      const prototypes = await this.prototypes();
      await this.ops.applyFacade(prototypes.core, this.paths.businessOverride);
      await this.ops.applyFacade(prototypes.web, this.paths.appsOverride);
      await this.handoff(manifest.active, manifest); return this.status();
    });
  }
  async down() {
    return this.locked(async () => {
      const manifest = await this.manifest(), state = await this.change({ paused: true }); await this.acknowledged(state);
      await Promise.all(['web','core'].map(channel => this.ops.control(channel, 'POST', '/close-streams')));
      await this.until(async () => (await Promise.all(['web','core'].map(channel => this.ops.control(channel)))).every(row => row.inFlight.normal === 0), 'REQUEST_DRAIN_TIMEOUT');
      await this.change({ paused: true, writer: null });
      for (const color of COLORS) if (manifest.slots[color]) { await this.ready(color, 'standby'); await this.ops.stop(manifest.slots[color].webContainer); await this.ops.stop(manifest.slots[color].coreContainer); }
      const prototypes = await this.prototypes();
      await this.ops.stop(prototypes.web.Name.replace(/^\//, ''));
      await this.ops.stop(prototypes.core.Name.replace(/^\//, ''));
      return { enabled: true, active: manifest.active, paused: true, healthy: false, stopped: true };
    });
  }
  async status() {
    if (!await isDeploymentEnabled(this.paths.root)) return { enabled: false, healthy: false };
    const manifest = await this.manifest(), state = await readDeploymentState(this.paths.state), slots = {};
    for (const color of COLORS) {
      if (!manifest.slots[color]) { slots[color] = { present: false }; continue; }
      try { const health = await this.ops.health(color, state); slots[color] = { present: true, image: manifest.slots[color].image, ...health }; } catch { slots[color] = { present: true, image: manifest.slots[color].image, healthy: false }; }
    }
    let proxies = false; try { const rows = await Promise.all(['web','core'].map(channel => this.ops.control(channel))); proxies = rows.every(row => row.valid && row.generation >= state.generation); } catch {}
    const needsRecovery = Boolean(manifest.rebindPending) || state.paused || state.active !== state.writer || state.active !== manifest.active;
    return { enabled: true, active: state.active, writer: state.writer, paused: state.paused, generation: state.generation, needsRecovery, healthy: !needsRecovery && slots[state.active]?.healthy === true && slots[state.active]?.role === 'active' && proxies, rollbackAvailable: Boolean(manifest.previous && slots[manifest.previous]?.healthy), slots };
  }
}
