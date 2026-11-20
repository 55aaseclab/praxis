#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_CONFIG_FILE, assertOutsideWorkspace, isWithin, loadConfig, storageError, validateConfig, writePrivateJson } from '../src/storage/config.mjs';

const workspace = fileURLToPath(new URL('../', import.meta.url));
const composeFile = join(workspace, 'compose.storage.yaml');
const script = fileURLToPath(import.meta.url);
const heartbeatName = 'worker-heartbeat.json';
const fail = message => { throw storageError('UNSAFE_WORKER', message); };
function workerProjectName(config, value = process.env.PRAXIS_COMPOSE_PROJECT) {
  const name = value || `praxis-${config.workspaceId.toLowerCase()}`;
  if (!/^[a-z0-9][a-z0-9_-]{0,120}$/.test(name)) fail('The Compose project name must be a safe lowercase identifier');
  return name;
}
const HELP = `Usage: node scripts/storage-worker.mjs generate|up|down|status|logs|run|health [--config PATH]

generate  Write private, explicit same-path directory mounts for the storage profile
up        Build and start only the activated Docker storage worker
down      Stop only this worker; keep apps and all data
status    Show only the storage container status
logs      Show the last 100 sanitized worker log lines
run       Supervise storage.mjs watch (container command)
health    Check live heartbeat, completed-cycle freshness and current configuration

Docker sources must be activated before starting. Regenerate and restart after
changing configuration or sources. Browser exports still require explicit export.
`;

function safePath(path) {
  if (typeof path !== 'string' || !isAbsolute(path) || /[\0\r\n$]/.test(path)) fail('Mount paths must be absolute single-line paths without Compose interpolation');
  const value = resolve(path);
  if (value.split('/').filter(Boolean).length < 2 || ['/var/lib', '/var/run', '/usr/local', '/opt/praxis', '/home', '/root', '/tmp', '/mnt', '/media', '/srv', '/run', '/etc', homedir()].includes(value) || /^\/(?:home|Users)\/[^/]+$/.test(value)) fail('Broad host directories cannot be mounted');
  if (isWithin(value, '/opt/praxis') || isWithin('/opt/praxis', value) || ['/proc', '/sys', '/dev', '/etc', '/usr', '/bin', '/sbin', '/lib', '/lib64', '/boot'].some(root => isWithin(root, value))) fail('System or image directories cannot be mounted');
  return value;
}

async function canonical(path, { directory = true, missing = false } = {}) {
  const value = safePath(path);
  let cursor = value; const suffix = [];
  let info;
  while (!(info = await lstat(cursor).catch(error => { if (error.code === 'ENOENT') return null; throw error; }))) {
    if (!missing) fail('A configured source directory or file is missing');
    suffix.unshift(basename(cursor)); cursor = dirname(cursor);
  }
  const actual = resolve(await realpath(cursor), ...suffix);
  safePath(actual);
  if (actual !== value || info.isSymbolicLink()) fail('Use canonical paths without symbolic-link aliases for worker mounts');
  if (!suffix.length && !(directory ? info.isDirectory() : info.isFile())) fail('A mount source has the wrong filesystem type');
  return value;
}

function runtime(config) {
  if (config.runtime !== 'docker') throw storageError('NOT_ACTIVATED', 'Activate Docker application sources before starting the storage worker');
  if (config.deviceId !== config.activeWriterDeviceId) throw storageError('WRITER_CONFLICT', 'This device is not the active writer');
  if (!config.appSources.length) throw storageError('INVALID_CONFIG', 'Register application sources before starting the storage worker');
}

export function deduplicateMounts(input) {
  const unique = new Map();
  for (const mount of input) {
    const previous = unique.get(mount.source);
    if (previous && previous.read_only !== mount.read_only) fail('The same directory cannot be both writable data and read-only private material');
    unique.set(mount.source, mount);
  }
  const ordered = [...unique.values()].sort((a, b) => a.source.split('/').length - b.source.split('/').length || a.source.localeCompare(b.source));
  const output = [];
  for (const mount of ordered) {
    const ancestor = output.filter(parent => isWithin(parent.source, mount.source)).at(-1);
    if (!ancestor || ancestor.read_only !== mount.read_only) output.push(mount);
  }
  return output;
}

export async function planWorker(config, configFile, { uid = process.env.PRAXIS_UID || process.getuid?.() || 1000, gid = process.env.PRAXIS_GID || process.getgid?.() || 1000, createDirectories = true } = {}) {
  config = validateConfig(config); runtime(config);
  let business; const declaredSources = [];
  if (config.businessConfigFile) {
    const { loadBusinessConfig } = await import('../src/business/config.mjs');
    const { withBusinessBackupSources } = await import('../src/business/backup-sources.mjs');
    business = await loadBusinessConfig(config.businessConfigFile, { metadataOnly: true });
    config = await withBusinessBackupSources(config, business, { onDeclaredSource: source => declaredSources.push(source) });
  }
  uid = String(uid); gid = String(gid);
  if (!/^[1-9]\d*$/.test(uid) || !/^[1-9]\d*$/.test(gid)) fail('The worker requires a non-root UID and GID');
  configFile = await canonical(configFile, { directory: false });
  assertOutsideWorkspace(configFile);
  const mounts = [], directories = [];
  async function add(path, readOnly, missing = false) {
    const source = await canonical(path, { missing });
    mounts.push({ type: 'bind', source, target: source, read_only: readOnly, bind: { create_host_path: false } });
    if (missing) directories.push(source);
  }
  async function addFile(path) {
    const source = await canonical(path, { directory: false });
    const info = await lstat(source);
    if ((info.mode & 0o077) || info.uid !== Number(uid)) fail('Private configuration files must be owner-only');
    mounts.push({ type: 'bind', source, target: source, read_only: true, bind: { create_host_path: false } });
  }
  await add(config.dataRoot, false, true);
  await add(config.stateRoot, false, true);
  if (config.dockerSourceMode === 'registered') await addFile(configFile);
  else await add(dirname(configFile), true);
  for (const repo of config.repositories) {
    if (repo.type === 'local') await add(repo.path, false, true);
    for (const key of ['passwordFile', 'credentialsFile', 'rcloneConfigFile']) if (repo[key]) {
      const file = safePath(repo[key]);
      const info = await lstat(file).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
      if (info) {
        await canonical(file, { directory: false });
        if ((info.mode & 0o077) || info.uid !== Number(uid)) fail('Secret files must be owner-only and owned by the worker UID');
      }
      if (config.dockerSourceMode === 'registered') { if (info) await addFile(file); }
      else await add(dirname(file), true, true);
    }
  }
  for (const app of config.appSources) {
    if (!['json', 'sqlite', 'directory'].includes(app.kind)) fail('Unknown application source kind');
    const source = await canonical(app.source, { directory: app.kind === 'directory' });
    const isBusinessEvents = business && (source === business.eventsDatabase || dirname(source) === dirname(business.eventsDatabase));
    await add(app.kind === 'directory' ? source : dirname(source), !isBusinessEvents);
  }
  if (business) {
    await addFile(config.businessConfigFile);
    for (const app of Object.values(business.apps)) if (app.spacesFile) await addFile(app.spacesFile);
    // Include declared, not-yet-created sources through the same owned recovery
    // projection, so a later first write does not require a broader mount.
    for (const source of declaredSources) {
      const parent = dirname(source.source), eventParent = parent === dirname(business.eventsDatabase);
      await add(parent, !eventParent);
    }
    await add(dirname(business.eventsDatabase), false);
  }
  for (const repo of config.sourceRepos) {
    const source = await canonical(repo.path);
    await add(source, true);
    const gitFile = join(source, '.git'), info = await lstat(gitFile).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
    if (info?.isSymbolicLink()) fail('Git directory pointers cannot be symbolic links');
    if (info?.isFile()) {
      if (info.size > 4096) fail('Invalid Git directory pointer');
      const pointer = /^gitdir: ([^\r\n]+)\r?\n?$/.exec(await readFile(gitFile, 'utf8'));
      if (!pointer) fail('Invalid Git directory pointer');
      const gitDirectory = resolve(source, pointer[1]); await add(gitDirectory, true);
      const commonFile = join(gitDirectory, 'commondir');
      const common = await lstat(commonFile).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
      if (common) {
        if (!common.isFile() || common.isSymbolicLink() || common.size > 4096) fail('Invalid Git common directory pointer');
        await add(resolve(gitDirectory, (await readFile(commonFile, 'utf8')).trim()), true);
      }
    }
  }
  const volumes = deduplicateMounts(mounts);
  const overrideFile = config.dockerSourceMode === 'registered' ? join(dirname(configFile), 'docker-storage/compose.override.json') : join(config.stateRoot, 'docker/storage.override.json');
  assertOutsideWorkspace(overrideFile);
  if (config.dockerSourceMode === 'registered' && volumes.some(volume => !volume.read_only && isWithin(volume.source, overrideFile))) fail('Docker control files must not be writable by the storage container');
  const projectName = workerProjectName(config);
  const override = { services: { storage: {
    user: `${uid}:${gid}`,
    build: { args: { PRAXIS_UID: uid, PRAXIS_GID: gid } },
    environment: { PRAXIS_STORAGE_CONFIG: configFile },
    volumes,
  } } };
  if (createDirectories) for (const directory of directories) await mkdir(directory, { recursive: true, mode: 0o700 });
  return { config, configFile, overrideFile, override, projectName, uid, gid };
}

export async function generateWorker(config, configFile, options) {
  const plan = await planWorker(config, configFile, options);
  await writePrivateJson(plan.overrideFile, plan.override);
  return plan;
}

const fingerprint = source => createHash('sha256').update(source).digest('hex');
export function workerHealth(state, config, digest, { now = Date.now(), processAlive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } } } = {}) {
  const recent = (value, age) => Number.isFinite(Date.parse(value)) && now - Date.parse(value) >= -5000 && now - Date.parse(value) <= age;
  const cycleLimit = Math.max(config.intervalSeconds * 2, 7200) * 1000;
  return state?.schemaVersion === 1 && state.workspaceId === config.workspaceId && state.configDigest === digest && state.watcherRunning === true && Number.isSafeInteger(state.pid) && state.pid > 0 && processAlive(state.pid) && recent(state.heartbeatAt, 90000) && recent(state.lastResultAt || state.startedAt, cycleLimit);
}

export async function health(config, configFile) {
  runtime(config);
  const state = JSON.parse(await readFile(join(config.stateRoot, heartbeatName), 'utf8'));
  const digest = fingerprint(await readFile(configFile));
  if (!workerHealth(state, config, digest)) throw storageError('UNHEALTHY', 'The worker heartbeat or completed-cycle state is stale');
  return { healthy: true, lastResultStatus: state.lastResultStatus, lastResultAt: state.lastResultAt };
}

export async function runWorker(config, configFile, { spawnProcess = spawn, intervalMs = 15000, output = value => process.stdout.write(JSON.stringify(value) + '\n') } = {}) {
  runtime(config);
  const stamp = new Date().toISOString();
  const state = { schemaVersion: 1, workspaceId: config.workspaceId, configDigest: fingerprint(await readFile(configFile)), pid: process.pid, startedAt: stamp, heartbeatAt: stamp, lastResultAt: null, lastResultStatus: 'starting', watcherRunning: true };
  let writes = Promise.resolve();
  const persist = () => { state.heartbeatAt = new Date().toISOString(); const copy = { ...state }; writes = writes.then(() => writePrivateJson(join(config.stateRoot, heartbeatName), copy)); return writes; };
  await persist();
  const workerArgs = config.businessConfigFile ? [join(workspace, 'scripts/business-sync-worker.mjs')] : [join(workspace, 'scripts/storage.mjs'), 'watch', '--config', configFile];
  const child = spawnProcess(process.execPath, workerArgs, { cwd: workspace, env: { ...process.env, PRAXIS_STORAGE_CONFIG: configFile, ...(config.businessConfigFile ? { PRAXIS_BUSINESS_CONFIG: config.businessConfigFile } : {}) }, stdio: ['ignore', 'pipe', 'pipe'] });
  let buffer = '', protocolFailed = false;
  const onLine = line => {
    let value; try { value = JSON.parse(line); } catch { return; }
    if (!value || typeof value !== 'object' || (!value.error && !(value.snapshot && Array.isArray(value.sync?.results)) && value.event !== 'business-cycle')) return;
    if (value.event === 'business-cycle') {
      state.lastResultAt = new Date().toISOString(); state.lastResultStatus = ['success', 'partial', 'idle'].includes(value.status) ? value.status : 'error';
      output({ event: 'storage-cycle', at: state.lastResultAt, status: state.lastResultStatus }); persist().catch(() => child.kill('SIGTERM')); return;
    }
    const failed = value.error, partial = value.sync?.results?.some(target => target.status !== 'success');
    state.lastResultAt = new Date().toISOString(); state.lastResultStatus = failed ? 'error' : partial ? 'partial' : 'success';
    const code = /^[A-Z_]+$/.test(failed?.code || '') ? failed.code : null;
    output({ event: 'storage-cycle', at: state.lastResultAt, status: state.lastResultStatus, ...(code ? { code } : {}) });
    persist().catch(() => child.kill('SIGTERM'));
  };
  child.stdout.on('data', chunk => {
    buffer += chunk.toString();
    if (buffer.length > 1024 * 1024) { protocolFailed = true; child.kill('SIGTERM'); return; }
    let index; while ((index = buffer.indexOf('\n')) >= 0) { onLine(buffer.slice(0, index)); buffer = buffer.slice(index + 1); }
  });
  // Provider output can contain credentials. Never forward subprocess streams.
  child.stderr.resume();
  const stop = () => child.kill('SIGTERM');
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  const timer = setInterval(() => persist().catch(stop), intervalMs);
  let exit;
  try { exit = await new Promise((accept, reject) => { child.once('error', reject); child.once('exit', (code, signal) => accept({ code, signal })); }); }
  finally {
    clearInterval(timer); process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop);
    state.watcherRunning = false; await persist();
  }
  if (protocolFailed || (exit.code !== 0 && exit.signal !== 'SIGTERM')) throw storageError('WORKER_FAILED', 'The storage watcher exited unexpectedly');
}

export function composeArguments(plan, command) {
  const base = ['compose', '--project-name', plan.projectName, '-f', composeFile, '-f', plan.overrideFile, '--profile', 'storage'];
  const commands = { up: ['up', '--build', '--detach', '--force-recreate', '--wait', '--wait-timeout', '180', 'storage'], down: ['stop', '--timeout', '60', 'storage'], status: ['ps', '--format', 'json', 'storage'], logs: ['logs', '--tail', '100', 'storage'] };
  if (!commands[command]) throw storageError('INVALID_ARGUMENT', 'Unknown worker Compose command');
  return [...base, ...commands[command]];
}

async function executeDocker(plan, command) {
  return new Promise((accept, reject) => {
    let output = '';
    const child = spawn('docker', composeArguments(plan, command), { cwd: workspace, env: { ...process.env, PRAXIS_COMPOSE_PROJECT: plan.projectName, PRAXIS_UID: plan.uid, PRAXIS_GID: plan.gid }, stdio: ['ignore', command === 'status' ? 'pipe' : 'inherit', 'pipe'] });
    if (command === 'status') child.stdout.on('data', chunk => { output += chunk.toString(); });
    child.stderr.resume();
    child.once('error', () => reject(storageError('DOCKER_FAILED', 'Docker Engine and Compose must be accessible')));
    child.once('exit', code => code === 0 ? accept(output) : reject(storageError('DOCKER_FAILED', 'Docker storage operation failed; private subprocess output was not logged')));
  });
}

export async function main(args = process.argv.slice(2), dependencies = {}) {
  const [command = 'help', ...rest] = args;
  if (command === 'help' || command === '--help') { process.stdout.write(HELP); return; }
  let configFile = process.env.PRAXIS_STORAGE_CONFIG || DEFAULT_CONFIG_FILE;
  if (rest.length) {
    if (rest.length !== 2 || rest[0] !== '--config') throw storageError('INVALID_ARGUMENT', 'Only --config PATH is accepted');
    configFile = rest[1];
  }
  configFile = resolve(configFile);
  const config = await loadConfig(configFile);
  if (command === 'run') return runWorker(config, configFile);
  if (command === 'health') { process.stdout.write(JSON.stringify(await health(config, configFile)) + '\n'); return; }
  if (command === 'generate' || command === 'up') {
    const plan = await generateWorker(config, configFile);
    if (command === 'generate') process.stdout.write(JSON.stringify({ overrideFile: plan.overrideFile, profile: 'storage' }) + '\n');
    else await (dependencies.execute || executeDocker)(plan, command);
    return;
  }
  if (['down', 'status', 'logs'].includes(command)) {
    const overrideFile = config.dockerSourceMode === 'registered' ? join(dirname(configFile), 'docker-storage/compose.override.json') : join(config.stateRoot, 'docker/storage.override.json');
    assertOutsideWorkspace(overrideFile);
    const plan = { overrideFile, projectName: workerProjectName(config), uid: String(process.env.PRAXIS_UID || process.getuid?.() || 1000), gid: String(process.env.PRAXIS_GID || process.getgid?.() || 1000) };
    await readFile(overrideFile); const output = await (dependencies.execute || executeDocker)(plan, command);
    if (command === 'status') {
      let rows; try { const value = JSON.parse(output || '[]'); rows = Array.isArray(value) ? value : [value]; } catch { rows = String(output).trim().split('\n').filter(Boolean).map(line => JSON.parse(line)); }
      const row = rows.find(service => service.Service === 'storage');
      const result = { healthy: row?.State === 'running' && row?.Health === 'healthy', services: [{ name: 'storage', state: row?.State || 'absent', health: row?.Health || 'unknown' }] };
      if (dependencies.print !== false) (dependencies.print || console.log)(JSON.stringify(result));
      return result;
    }
    return;
  }
  throw storageError('INVALID_ARGUMENT', 'Unknown storage worker command; use --help');
}

if (process.argv[1] && resolve(process.argv[1]) === script) main().catch(error => {
  const code = /^[A-Z_]+$/.test(error.code ?? '') ? error.code : 'WORKER_FAILED';
  process.stderr.write(`${code}: Storage worker operation failed; no credentials or private subprocess output were logged.\n`);
  process.exitCode = 1;
});
