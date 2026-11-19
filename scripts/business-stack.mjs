#!/usr/bin/env node
import { readManagedInstallation, installationOperation } from './managed-installation.mjs';
import { spawn } from 'node:child_process';
import { createConnection } from 'node:net';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { realpath, lstat, mkdir, readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { loadBusinessConfig, DEFAULT_BUSINESS_CONFIG, DEFAULT_CORE_CONFIG } from '../src/business/config.mjs';
import { writePrivateJson, assertOutsideWorkspace, isWithin, loadConfig } from '../src/storage/config.mjs';
import { validateStorageStatusDestination } from '../src/storage/status.mjs';
import { validateObservationsDirectory } from './stack.mjs';
import { resolveSlidesModelCaches } from '../src/business/slides-model-caches.mjs';
import { installationProject } from './managed-compose.mjs';
import { deploymentOverrides } from '../src/deployment/integration.mjs';

const workspace = fileURLToPath(new URL('../', import.meta.url)).replace(/\/$/, '');
const reminderDataRoot = resolve(workspace, 'third_party/reminder/data');
const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };
const overlaps = (left, right) => isWithin(left, right) || isWithin(right, left);
const ownerOnly = info => (info.mode & 0o077) === 0 && (typeof process.getuid !== 'function' || info.uid === process.getuid());
export const BUSINESS_HEALTHCHECK = `(async()=>{
const config=JSON.parse(require('node:fs').readFileSync(process.env.PRAXIS_BUSINESS_CONFIG,'utf8'));
const check=async(url,options,accepted)=>{const response=await fetch(url,{...options,redirect:'error',signal:AbortSignal.timeout(2000)});await response.body?.cancel();if(!accepted.includes(response.status))throw new Error('Unhealthy endpoint');};
await Promise.all([check(process.env.HEALTH_URL,{},[200]),...Object.entries(config.apps).map(([appId,app])=>check(app.url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({operation:({reminder:'list',travel:'list_itineraries',projects:'list_projects',knowledge:'list_libraries',memo:'list_topics',slides:'list_decks'})[appId]||'list_assignments',spaceId:app.spaces[0],...(appId==='tingproof'?{resourceId:'assignments'}:{})})},[401,403]))]);
})().catch(()=>process.exit(1));`;

async function privatePath(source, { directory = false, allowMissing = false, data = false, maxSize = 256 * 1024 } = {}) {
  if (typeof source !== 'string' || !isAbsolute(source) || resolve(source) !== source) fail('UNSAFE_PATH', 'Private paths must be canonical and absolute.');
  if (!data) assertOutsideWorkspace(source);
  else if (isWithin(workspace, source) && !isWithin(reminderDataRoot, source)) fail('UNSAFE_DATA_PATH', 'Only the independent Reminder data directory may be mounted within the workspace.');
  if (source.split('/').some(part => ['.git', '.ssh', '.gnupg', '.aws', '.kube', '.docker'].includes(part))) fail('UNSAFE_PATH', 'Source-control, host credentials and Docker control directories cannot be mounted.');
  if (directory) {
    const broad = new Set(['/', '/tmp', '/var', '/var/lib', '/run', '/etc', '/opt', '/mnt', '/media', '/home', homedir()]);
    if (broad.has(source) || isWithin(source, workspace) || source.split('/').filter(Boolean).length < 3) fail('UNSAFE_PATH', 'Mounts require specific private directories.');
  }
  if (await realpath(dirname(source)) !== dirname(source)) fail('UNSAFE_PATH', 'Symbolic-link parent paths are not allowed.');
  const info = await lstat(source).catch(error => { if (allowMissing && error.code === 'ENOENT') return null; throw error; });
  if (!info) return;
  if (!(directory ? info.isDirectory() : info.isFile()) || info.isSymbolicLink() || !ownerOnly(info) || (directory && (info.mode & 0o700) !== 0o700) || (!directory && (info.nlink !== 1 || info.size > maxSize)) || await realpath(source) !== source) fail('UNSAFE_PRIVATE_PATH', 'Mount sources must be canonical owner-only paths without linked files.');
  if (directory && await lstat(resolve(source, '.git')).catch(error => { if (error.code === 'ENOENT') return null; throw error; })) fail('UNSAFE_PATH', 'A source repository cannot be a writable data mount.');
}
const mount = (source, readOnly = false) => ({ type: 'bind', source, target: source, ...(readOnly ? { read_only: true } : {}), bind: { create_host_path: false } });
function distinctDirectories(paths) {
  const directories = [...new Set(paths)];
  if (directories.some((left, index) => directories.some((right, other) => index !== other && isWithin(left, right)))) fail('OVERLAPPING_MOUNTS', 'Distinct writable directories must not overlap.');
  return directories;
}
export async function coreConfigFile(explicit) {
  if (explicit) return explicit;
  if (process.env.PRAXIS_CORE_CONFIG || process.env.PRAXIS_BUSINESS_CONFIG) return process.env.PRAXIS_CORE_CONFIG || process.env.PRAXIS_BUSINESS_CONFIG;
  try { await lstat(DEFAULT_CORE_CONFIG); return DEFAULT_CORE_CONFIG; }
  catch (error) { if (error.code === 'ENOENT') return DEFAULT_BUSINESS_CONFIG; throw error; }
}
export async function businessStackPlan(configFile, { port = 4326, projectName = 'praxis-core', serviceName = 'core' } = {}) {
  if (!['core', 'business'].includes(serviceName)) fail('INVALID_CORE_SERVICE', 'Core service must be core or legacy business.');
  port = Number(port);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) fail('INVALID_PORT', 'Core port must be between 1024 and 65535.');
  if (typeof projectName !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,62}$/.test(projectName)) fail('INVALID_PROJECT', 'Compose project name is invalid.');
  configFile = resolve(await coreConfigFile(configFile));
  await privatePath(configFile);
  const config = await loadBusinessConfig(configFile);
  if (config.database === config.eventsDatabase) fail('OVERLAPPING_STATE', 'Identity and event databases require different files.');
  for (const name of ['allowedHosts', 'allowedOrigins']) if (config[name] !== undefined && (!Array.isArray(config[name]) || config[name].some(value => typeof value !== 'string' || /[\s\\]/.test(value)))) fail('INVALID_CONFIG', 'Host and origin allowlists must be explicit arrays.');
  const healthHost = `127.0.0.1:${port}`;
  if (new URL(config.issuer).host !== healthHost && !config.allowedHosts?.includes(healthHost)) fail('HEALTH_HOST_REQUIRED', 'The health-check host must be explicitly allowed.');
  const stateDirectories = distinctDirectories([dirname(config.database), dirname(config.eventsDatabase)]);
  for (const directory of stateDirectories) await privatePath(directory, { directory: true });
  for (const file of [config.database, config.eventsDatabase]) await privatePath(file, { allowMissing: true, maxSize: Infinity });
  const keyFiles = Object.values(config.apps).map(app => app.keyFile);
  if (new Set(keyFiles).size !== keyFiles.length) fail('SHARED_SIGNING_KEY', 'Independent applications require different signing key files.');
  for (const app of Object.values(config.apps)) {
    if (!Array.isArray(app.spaces) || !app.spaces.length) fail('INVALID_ADAPTER', 'Applications require explicit business spaces.');
    await privatePath(app.keyFile, { maxSize: 4096 });
  }
  const readOnlyFiles = [...new Set([configFile, ...keyFiles])];
  if (stateDirectories.some(directory => readOnlyFiles.some(file => isWithin(directory, file)))) fail('OVERLAPPING_SECRET_MOUNT', 'Writable state must not contain configuration or signing keys.');
  const controlDirectory = resolve(dirname(configFile), 'business-docker');
  if (stateDirectories.some(directory => isWithin(directory, controlDirectory))) fail('UNSAFE_CONTROL_DIRECTORY', 'Docker control files must stay outside writable container mounts.');
  const existingControl = await lstat(controlDirectory).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
  const overrideFile = resolve(controlDirectory, 'compose.override.json');
  if (existingControl) { await privatePath(controlDirectory, { directory: true }); await privatePath(overrideFile, { allowMissing: true }); }
  const uid = process.getuid?.() ?? 1000, gid = process.getgid?.() ?? 1000;
  const override = { services: { [serviceName]: {
    user: `${uid}:${gid}`, build: { args: { PRAXIS_UID: String(uid), PRAXIS_GID: String(gid) } },
    command: ['node', serviceName === 'core' ? 'src/core/server.mjs' : 'src/business/server.mjs', '--host', config.webGateway?.enabled === true ? '127.0.0.1' : '0.0.0.0', '--port', String(port)],
    environment: { PRAXIS_BUSINESS_CONFIG: configFile, HEALTH_URL: `http://${healthHost}/health` },
    healthcheck: { test: ['CMD', 'node', '-e', BUSINESS_HEALTHCHECK] },
    volumes: [...stateDirectories.map(directory => mount(directory)), ...readOnlyFiles.map(file => mount(file, true))],
  } } };
  const ports = [port], reminder = config.apps.reminder;
  const appDirectories = [];
  if (reminder?.managed !== undefined && typeof reminder.managed !== 'boolean') fail('INVALID_MANAGED_SETTING', 'Managed Reminder must be explicitly true or false.');
  if (reminder?.managed === true) {
    const endpoint = new URL(reminder.url);
    if (endpoint.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(endpoint.hostname) || endpoint.port !== '4322' || endpoint.pathname !== '/api/business' || endpoint.search || endpoint.hash || endpoint.username || endpoint.password) fail('INVALID_MANAGED_ENDPOINT', 'Managed Reminder requires its fixed loopback port4322 endpoint.');
    await privatePath(reminder.spacesFile);
    const mapping = JSON.parse(await readFile(reminder.spacesFile, 'utf8'));
    if (!mapping || typeof mapping !== 'object' || Array.isArray(mapping) || Object.keys(mapping).some(key => key !== 'spaces') || !mapping.spaces || typeof mapping.spaces !== 'object' || Array.isArray(mapping.spaces) || Object.keys(mapping.spaces).sort().join('\0') !== [...reminder.spaces].sort().join('\0')) fail('INVALID_SPACE_MAPPING', 'Reminder mapping must exactly match its configured business spaces.');
    const dataFiles = Object.values(mapping.spaces);
    if (new Set(dataFiles).size !== dataFiles.length || dataFiles.some(file => typeof file !== 'string' || !file.endsWith('.json'))) fail('INVALID_SPACE_MAPPING', 'Reminder spaces require distinct JSON data files.');
    for (const file of dataFiles) await privatePath(file, { allowMissing: true, data: true, maxSize: Infinity });
    const dataDirectories = distinctDirectories(dataFiles.map(file => dirname(file)));
    appDirectories.push(...dataDirectories);
    for (const directory of dataDirectories) {
      await privatePath(directory, { directory: true, data: true });
      if (stateDirectories.some(state => overlaps(state, directory)) || readOnlyFiles.concat(reminder.spacesFile).some(file => isWithin(directory, file)) || isWithin(directory, controlDirectory)) fail('OVERLAPPING_DATA_MOUNT', 'Reminder data must stay separate from identity state, secrets and Docker controls.');
    }
    override.services.reminder = {
      image: 'praxis-business/reminder:local',
      build: { context: join(workspace, 'third_party/reminder'), dockerfile: '../../Dockerfile.builtins', target: 'reminder', args: { PRAXIS_UID: String(uid), PRAXIS_GID: String(gid) } },
      command: ['node', 'src/server.js', '--host', config.webGateway?.enabled === true ? '127.0.0.1' : '0.0.0.0', '--port', '4322'],
      network_mode: 'host', init: true, user: `${uid}:${gid}`, read_only: true, restart: 'unless-stopped',
      cap_drop: ['ALL'], security_opt: ['no-new-privileges:true'], tmpfs: ['/tmp:rw,nosuid,nodev,size=64m,mode=1777'], stop_grace_period: '30s',
      environment: { REMINDER_MANAGED: '1', REMINDER_BUSINESS_KEY_FILE: reminder.keyFile, REMINDER_BUSINESS_SPACES_FILE: reminder.spacesFile, REMINDER_BUSINESS_UI_URL: `${config.issuer}/business/reminder/` },
      healthcheck: { test: ['CMD', 'node', '-e', "fetch('http://127.0.0.1:4322/health').then(async r=>{const h=await r.json();if(!r.ok||h.managed!==true)process.exit(1)}).catch(()=>process.exit(1))"], interval: '10s', timeout: '5s', retries: 3, start_period: '10s' },
      logging: { driver: 'json-file', options: { 'max-size': '10m', 'max-file': '3' } },
      volumes: [...dataDirectories.map(directory => mount(directory)), mount(reminder.keyFile, true), mount(reminder.spacesFile, true)],
    };
    ports.push(4322);
  }
  const projects = config.apps.projects;
  if (projects) {
    if (projects.managed !== true || projects.url !== 'http://127.0.0.1:4327/api/business') fail('INVALID_MANAGED_ENDPOINT', 'Projects requires its managed fixed loopback adapter.');
    await privatePath(projects.dataDir, { directory: true, data: true });
    await privatePath(projects.businessConfigFile);
    await privatePath(resolve(projects.dataDir, 'projects.db'), { allowMissing: true, data: true, maxSize: Infinity });
    const mapping = JSON.parse(await readFile(projects.businessConfigFile, 'utf8'));
    if (!mapping || typeof mapping !== 'object' || Array.isArray(mapping) || Object.keys(mapping).some(key => !['version', 'spaces'].includes(key)) || mapping.version !== 1 || !Array.isArray(mapping.spaces) || !mapping.spaces.length || new Set(mapping.spaces).size !== mapping.spaces.length || JSON.stringify([...mapping.spaces].sort()) !== JSON.stringify([...projects.spaces].sort())) fail('INVALID_SPACE_MAPPING', 'Projects mapping must match its configured spaces exactly.');
    if (stateDirectories.concat(appDirectories).some(directory => overlaps(directory, projects.dataDir)) || readOnlyFiles.concat(projects.businessConfigFile).some(file => isWithin(projects.dataDir, file)) || isWithin(projects.dataDir, controlDirectory)) fail('OVERLAPPING_DATA_MOUNT', 'Projects data must remain separate from identity, other applications, credentials and controls.');
    appDirectories.push(projects.dataDir);
    override.services.projects = {
      image: 'praxis-business/projects:local',
      build: { context: join(workspace, 'third_party/projects'), dockerfile: '../../Dockerfile.builtins', target: 'projects', args: { PRAXIS_UID: String(uid), PRAXIS_GID: String(gid) } },
      command: ['node', 'src/server.mjs', '--host', '127.0.0.1', '--port', '4327'],
      network_mode: 'host', init: true, user: `${uid}:${gid}`, read_only: true, restart: 'unless-stopped',
      cap_drop: ['ALL'], security_opt: ['no-new-privileges:true'], tmpfs: ['/tmp:rw,nosuid,nodev,size=64m,mode=1777'], stop_grace_period: '30s',
      environment: { PROJECTS_MANAGED: '1', PROJECTS_DATA_DIR: projects.dataDir, PROJECTS_BUSINESS_KEY_FILE: projects.keyFile, PROJECTS_BUSINESS_CONFIG_FILE: projects.businessConfigFile, PROJECTS_KNOWLEDGE_BASE_URL: '/apps/knowledge/' },
      healthcheck: { test: ['CMD', 'node', '-e', "fetch('http://127.0.0.1:4327/health').then(async r=>{const h=await r.json();if(!r.ok||h.managed!==true)process.exit(1)}).catch(()=>process.exit(1))"], interval: '10s', timeout: '5s', retries: 3, start_period: '10s' },
      logging: { driver: 'json-file', options: { 'max-size': '10m', 'max-file': '3' } },
      volumes: [mount(projects.dataDir), mount(projects.keyFile, true), mount(projects.businessConfigFile, true)],
    };
    ports.push(4327);
  }
  const slides = config.apps.slides;
  if (slides) {
    if (slides.managed !== true || slides.url !== 'http://127.0.0.1:4328/api/business') fail('INVALID_MANAGED_ENDPOINT', 'Slides requires its managed fixed loopback adapter.');
    await privatePath(slides.dataDir, { directory: true, data: true });
    await privatePath(slides.spacesFile);
    const mapping = JSON.parse(await readFile(slides.spacesFile, 'utf8'));
    if (!mapping || Object.keys(mapping).some(key => key !== 'spaces') || !mapping.spaces || typeof mapping.spaces !== 'object' || Array.isArray(mapping.spaces) || JSON.stringify(Object.keys(mapping.spaces).sort()) !== JSON.stringify([...slides.spaces].sort())) fail('INVALID_SPACE_MAPPING', 'Slides mapping must match its configured spaces exactly.');
    const files = Object.values(mapping.spaces);
    if (new Set(files).size !== files.length || files.some(file => typeof file !== 'string' || dirname(file) !== slides.dataDir || !file.endsWith('.json'))) fail('INVALID_SPACE_MAPPING', 'Slides spaces require separate JSON files in their registered data directory.');
    for (const file of files) await privatePath(file, { allowMissing: true, data: true, maxSize: Infinity });
    if (stateDirectories.concat(appDirectories).some(directory => overlaps(directory, slides.dataDir)) || readOnlyFiles.concat(slides.spacesFile).some(file => isWithin(slides.dataDir, file)) || isWithin(slides.dataDir, controlDirectory)) fail('OVERLAPPING_DATA_MOUNT', 'Slides data must remain separate from identity, other applications, credentials and controls.');
    appDirectories.push(slides.dataDir);
    const modelCaches = await resolveSlidesModelCaches(slides.modelCaches, { uid, protectedPaths: [workspace, controlDirectory, ...stateDirectories, ...appDirectories, ...readOnlyFiles, slides.spacesFile, config.observationsFile && dirname(config.observationsFile), config.console?.storageStatusFile && dirname(config.console.storageStatusFile), config.console?.storageConfigFile, ...Object.values(config.apps).flatMap(app => [app.keyFile && dirname(app.keyFile), app.spacesFile && dirname(app.spacesFile), app.dataDir, app.dataFile && dirname(app.dataFile)])] });
    override.services['slides-business'] = {
      image: 'praxis-business/slides:local',
      build: { context: join(workspace, 'third_party/lattice'), dockerfile: '../../Dockerfile.builtins', target: 'lattice', args: { PRAXIS_UID: String(uid), PRAXIS_GID: String(gid) } },
      command: ['node', 'src/business/server.mjs', '--host', '127.0.0.1', '--port', '4328'],
      network_mode: 'host', init: true, user: `${uid}:${gid}`, read_only: true, restart: 'unless-stopped',
      cap_drop: ['ALL'], security_opt: ['no-new-privileges:true'], tmpfs: ['/tmp:rw,nosuid,nodev,size=1024m,mode=1777'], shm_size: '1gb', stop_grace_period: '30s',
      environment: { SLIDES_BUSINESS_KEY_FILE: slides.keyFile, SLIDES_BUSINESS_SPACES_FILE: slides.spacesFile, SLIDES_BUSINESS_AUTHORIZATION_URL: `http://127.0.0.1:${port}/api/business/slides/authorize-job`, SLIDES_BUSINESS_AUTHORIZATION_HOST: new URL(config.issuer).host, ...modelCaches.environment },
      healthcheck: { test: ['CMD', 'node', '-e', "fetch('http://127.0.0.1:4328/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"], interval: '10s', timeout: '5s', retries: 3, start_period: '10s' },
      logging: { driver: 'json-file', options: { 'max-size': '10m', 'max-file': '3' } },
      volumes: [mount(slides.dataDir), mount(slides.keyFile, true), mount(slides.spacesFile, true), ...modelCaches.volumes],
    };
    ports.push(4328);
  }
  let observationsDirectory;
  if (config.observationsFile !== undefined) {
    const file = config.observationsFile;
    if (typeof file !== 'string' || !isAbsolute(file) || resolve(file) !== file || basename(file) !== 'observations.db') fail('UNSAFE_OBSERVATIONS_PATH', 'Observations require a canonical observations.db file outside the workspace.');
    observationsDirectory = dirname(file);
    const protectedPaths = [...stateDirectories, ...appDirectories, controlDirectory, ...readOnlyFiles];
    for (const app of Object.values(config.apps)) {
      protectedPaths.push(dirname(app.keyFile));
      if (app.dataFile) protectedPaths.push(dirname(app.dataFile));
      if (app.spacesFile) {
        await privatePath(app.spacesFile);
        protectedPaths.push(app.spacesFile);
        const mapping = JSON.parse(await readFile(app.spacesFile, 'utf8'));
        protectedPaths.push(...Object.values(mapping.spaces || {}).map(dataFile => dirname(dataFile)));
      }
    }
    try { await validateObservationsDirectory(observationsDirectory, { uid, protectedPaths }); }
    catch { fail('UNSAFE_OBSERVATIONS_PATH', 'Observations require a separate canonical owner-only metadata directory.'); }
    override.services[serviceName].volumes.push(mount(observationsDirectory));
    override.services[serviceName].environment.PRAXIS_OBSERVATIONS_FILE = file;
  }
  let storageStatusDirectory;
  if (config.console?.storageStatusFile !== undefined) {
    const storageFile = config.console.storageConfigFile;
    let storage;
    const protectedPaths = [...stateDirectories, ...appDirectories, controlDirectory, ...readOnlyFiles, ...keyFiles.map(file => dirname(file)), observationsDirectory].filter(Boolean);
    for (const app of Object.values(config.apps)) {
      if (app.spacesFile) protectedPaths.push(app.spacesFile);
      if (app.dataFile) protectedPaths.push(dirname(app.dataFile));
    }
    if (storageFile !== undefined) {
      await privatePath(storageFile);
      storage = await loadConfig(storageFile);
      await privatePath(storage.stateRoot, { directory: true });
      protectedPaths.push(storageFile, storage.stateRoot);
      for (const repository of storage.repositories) for (const key of ['path', 'passwordFile', 'credentialsFile', 'rcloneConfigFile']) if (repository[key]) protectedPaths.push(key === 'path' ? repository[key] : dirname(repository[key]));
      const forbidden = [...stateDirectories, ...appDirectories, ...readOnlyFiles, ...(storage.appSources || []).map(source => source.source), ...(storage.sourceRepos || []).map(source => source.path), ...storage.repositories.flatMap(repository => ['path', 'passwordFile', 'credentialsFile', 'rcloneConfigFile'].map(key => repository[key]).filter(Boolean))];
      if (forbidden.some(path => overlaps(storage.stateRoot, path))) fail('UNSAFE_STATUS_INPUT', 'The storage metadata directory must not contain business sources, credentials or repositories.');
    }
    try { storageStatusDirectory = await validateStorageStatusDestination(config.console.storageStatusFile, { protectedPaths }); }
    catch { fail('UNSAFE_STATUS_PATH', 'Storage status requires a separate private sanitized directory.'); }
    override.services[serviceName].volumes.push(mount(storageStatusDirectory, true));
    if (storage) {
      const metadataTarget = '/run/praxis-storage-metadata', configTarget = '/run/praxis-storage-config.json';
      const masks = [];
      for (const child of ['snapshots', 'cache', 'docker']) {
        const info = await lstat(join(storage.stateRoot, child)).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
        if (info) {
          if (!info.isDirectory() || info.isSymbolicLink()) fail('UNSAFE_STATUS_INPUT', 'Storage payload directories cannot use aliases.');
          masks.push(`${metadataTarget}/${child}:ro,nosuid,nodev,noexec,size=1m,mode=000`);
        }
      }
      override.services['storage-status'] = {
        image: 'praxis-business/server:local', build: { context: workspace, dockerfile: 'Dockerfile', target: 'praxis', args: { PRAXIS_UID: String(uid), PRAXIS_GID: String(gid) } },
        command: ['node', 'scripts/storage-status-publisher.mjs', 'run', '--config', configTarget, '--metadata-directory', metadataTarget, '--output', config.console.storageStatusFile],
        network_mode: 'none', init: true, user: `${uid}:${gid}`, read_only: true, restart: 'unless-stopped', cap_drop: ['ALL'], security_opt: ['no-new-privileges:true'],
        tmpfs: ['/tmp:rw,nosuid,nodev,size=16m,mode=1777', ...masks], stop_grace_period: '30s',
        volumes: [{ ...mount(storageFile, true), target: configTarget }, { ...mount(storage.stateRoot, true), target: metadataTarget }, mount(storageStatusDirectory)],
        healthcheck: { test: ['CMD', 'node', 'scripts/storage-status-publisher.mjs', 'health', '--output', config.console.storageStatusFile], interval: '15s', timeout: '5s', retries: 3, start_period: '15s' },
        logging: { driver: 'json-file', options: { 'max-size': '1m', 'max-file': '2' } },
      };
    }
  } else if (config.console?.storageConfigFile !== undefined) fail('INVALID_STATUS_CONFIG', 'A storage publisher requires an explicit sanitized output file.');
  let dataInventoryDirectory;
  if (config.console?.dataInventoryFile !== undefined) {
    const protectedPaths = [...stateDirectories, ...appDirectories, controlDirectory, ...readOnlyFiles, ...keyFiles.map(file => dirname(file)), observationsDirectory, storageStatusDirectory,
      ...Object.values(config.apps).flatMap(app => [app.dataDir, app.dataFile && dirname(app.dataFile), app.spacesFile, app.businessConfigFile])].filter(Boolean);
    for (const app of Object.values(config.apps)) {
      if (!app.spacesFile) continue;
      await privatePath(app.spacesFile);
      const mapping = JSON.parse(await readFile(app.spacesFile, 'utf8'));
      for (const file of Object.values(mapping.spaces || {})) if (typeof file === 'string' && isAbsolute(file)) protectedPaths.push(dirname(file));
    }
    try { dataInventoryDirectory = await validateStorageStatusDestination(config.console.dataInventoryFile, { protectedPaths }); }
    catch { fail('UNSAFE_INVENTORY_PATH', 'Data inventory requires a separate private metadata directory.'); }
    override.services[serviceName].volumes.push(mount(dataInventoryDirectory, true));
  }
  return { config, configFile, port, projectName, serviceName, uid, gid, ports, stateDirectories, observationsDirectory, storageStatusDirectory, dataInventoryDirectory, services: Object.keys(override.services), controlDirectory, overrideFile, override };
}
export function coreInstallation(config) {
  if (!config?.projects || (!config.projects.core && !config.projects.business)) return null;
  const group = installationProject(config, 'core'), item = config.projects[group];
  const facades = item.services.filter(name => ['core', 'business'].includes(name));
  if (facades.length !== 1) fail('INVALID_CORE_SERVICE', 'The installed core project requires exactly one core facade.');
  return { group, item, serviceName: facades[0] };
}
export function portInUse(port) {
  return new Promise(resolvePromise => {
    const socket = createConnection({ host: '127.0.0.1', port });
    socket.setTimeout(500);
    socket.once('connect', () => { socket.destroy(); resolvePromise(true); });
    socket.once('error', () => { socket.destroy(); resolvePromise(false); });
    socket.once('timeout', () => { socket.destroy(); resolvePromise(true); });
  });
}
async function executeDocker(command, args, options) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { ...options, stdio: ['ignore', 'pipe', 'pipe'] }), chunks = [];
    child.stdout.on('data', chunk => chunks.push(chunk)); child.stderr.on('data', chunk => process.stderr.write(chunk));
    child.once('error', reject);
    child.once('close', code => code === 0 ? resolvePromise(Buffer.concat(chunks).toString('utf8')) : reject(Object.assign(new Error('Core Compose command failed.'), { code: 'COMPOSE_FAILED' })));
  });
}
function composeRows(value) {
  if (!value?.trim()) return [];
  try { const decoded = JSON.parse(value); return Array.isArray(decoded) ? decoded : [decoded]; }
  catch { return value.trim().split('\n').map(line => JSON.parse(line)); }
}
export async function runBusinessStack(command, { configFile, execute = executeDocker, installation, port = Number(process.env.PRAXIS_CORE_PORT || process.env.PRAXIS_BUSINESS_PORT || 4326), projectName = process.env.PRAXIS_CORE_PROJECT || process.env.PRAXIS_BUSINESS_PROJECT, portProbe = portInUse, deferDeploymentFacade = false } = {}) {
  if (!['up', 'down', 'status', 'logs'].includes(command)) fail('INVALID_COMMAND', 'Usage: core-stack.mjs up|down|status|logs [--config PATH] [--port PORT] [--project NAME]');
  configFile = await coreConfigFile(configFile);
  const installed = installation ?? (execute === executeDocker ? await readManagedInstallation() : null);
  const registered = coreInstallation(installed);
  if (registered) {
    const services = registered.item.services.filter(name => !deferDeploymentFacade || command !== 'up' || name !== registered.serviceName);
    if (!services.length) return '';
    return installationOperation(installed, registered.group, command, { services, ...(execute === executeDocker ? {} : { execute: args => execute('docker', args, { cwd: workspace }) }) });
  }
  const deployment = await deploymentOverrides(configFile);
  const previousFile = resolve(dirname(configFile), 'business-docker/compose.override.json');
  let previous;
  if (await lstat(previousFile).catch(error => { if (error.code === 'ENOENT') return null; throw error; })) { await privatePath(previousFile); previous = JSON.parse(await readFile(previousFile, 'utf8')); }
  const serviceName = deployment?.coreService || (previous?.services?.business && !previous.services.core ? 'business' : 'core');
  const plan = await businessStackPlan(configFile, { port, projectName: projectName || (serviceName === 'business' ? 'praxis-business' : 'praxis-core'), serviceName });
  if (command === 'up') {
    if (plan.observationsDirectory) await validateObservationsDirectory(plan.observationsDirectory, { uid: plan.uid, create: true });
    if (plan.storageStatusDirectory) await validateStorageStatusDestination(plan.config.console.storageStatusFile, { create: true });
    await mkdir(plan.controlDirectory, { recursive: true, mode: 0o700 }); await privatePath(plan.controlDirectory, { directory: true });
    await writePrivateJson(plan.overrideFile, plan.override);
  }
  const args = ['compose', '--project-name', plan.projectName, '--file', resolve(workspace, serviceName === 'business' ? 'compose.business.yaml' : 'compose.core.yaml')];
  if (await lstat(plan.overrideFile).catch(error => { if (error.code === 'ENOENT') return null; throw error; })) args.push('--file', plan.overrideFile);
  if (deployment) args.push('--file', deployment.business);
  const options = { cwd: workspace, env: { ...process.env, PRAXIS_UID: String(plan.uid), PRAXIS_GID: String(plan.gid) } };
  if (command === 'up') {
    const rows = composeRows(await execute('docker', [...args, 'ps', '--format', 'json'], options));
    for (const targetPort of plan.ports) {
      const service = targetPort === plan.port ? serviceName : targetPort === 4327 ? 'projects' : targetPort === 4328 ? 'slides-business' : 'reminder';
      if (!(await portProbe(targetPort))) continue;
      const row = rows.find(item => item.Service === service && item.State === 'running' && typeof item.ID === 'string');
      let ownPort = false;
      if (row) {
        const inspected = JSON.parse(await execute('docker', ['inspect', row.ID], options))[0];
        const commandLine = inspected?.Config?.Cmd ?? [], index = commandLine.indexOf('--port');
        ownPort = inspected?.HostConfig?.NetworkMode === 'host' && index >= 0 && commandLine[index + 1] === String(targetPort);
      }
      if (!ownPort) fail('PORT_IN_USE', 'A required port is occupied; stop the previous writer service before starting this project.');
    }
  }
  if (command === 'up' && deployment) {
    const singletons = plan.services.filter(name => name !== serviceName);
    if (singletons.length) await execute('docker', [...args, 'up', '-d', '--build', '--force-recreate', '--wait', '--wait-timeout', '90', ...singletons], options);
    if (deferDeploymentFacade) return '';
    return execute('docker', [...args, 'up', '-d', '--no-recreate', '--wait', '--wait-timeout', '90', serviceName], options);
  }
  return execute('docker', [...args, ...({ up: ['up', '-d', '--build', '--force-recreate', '--wait', '--wait-timeout', '90', '--remove-orphans'], down: ['down', '--remove-orphans'], status: ['ps', '--format', 'json'], logs: ['logs', '--tail', '100'] }[command])], options);
}
export async function main(args = process.argv.slice(2)) {
  try {
    const { values, positionals } = parseArgs({ args, allowPositionals: true, options: { config: { type: 'string' }, port: { type: 'string' }, project: { type: 'string' } } });
    const result = await runBusinessStack(positionals[0], { configFile: values.config, ...(values.port !== undefined ? { port: Number(values.port) } : {}), ...(values.project !== undefined ? { projectName: values.project } : {}) });
    if (result) process.stdout.write(result);
  } catch (error) { console.error(`Core stack failed: ${error.code || 'INVALID_CONFIG'}`); process.exitCode = 1; }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) await main();
