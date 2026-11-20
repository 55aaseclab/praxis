import { DEFAULT_APP_REGISTRY } from '../src/default-app-registry.mjs';
import { readManagedInstallation, installationOperation, installationStatus, installationCommand } from './managed-installation.mjs';
import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { access, chmod, lstat, mkdir, readFile, readdir, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createConnection } from 'node:net';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isWithin } from '../src/storage/config.mjs';
import { resolveAppPaths } from '../src/storage/app-paths.mjs';
import { createPlatformProxy } from '../src/platform-proxy.mjs';
import { validateStorageStatusDestination } from '../src/storage/status.mjs';
import { deploymentOverrides } from '../src/deployment/integration.mjs';
import { docker } from '../src/deployment/controller.mjs';

export function stackRecipes(registry = DEFAULT_APP_REGISTRY) {
  return registry.apps.map(app => {
    const stack = app.integration.deployment?.stack;
    if (!stack || !Array.isArray(stack.services)) throw new Error(`Installed app ${app.id} has no reviewed stack recipe.`);
    for (const service of stack.services) if (!service || !/^[a-z][a-z0-9-]{0,79}$/.test(service.name) || !Number.isInteger(service.port) || service.port < 1 || service.port > 65535 || service.excludeWhen !== undefined && !/^[a-z][a-zA-Z0-9]{0,79}$/.test(service.excludeWhen)) throw new Error('Invalid app-owned stack service.');
    if (stack.cliFlags !== undefined && (!Array.isArray(stack.cliFlags) || stack.cliFlags.length > 16 || stack.cliFlags.some(option => !option || !/^--[a-z][a-z0-9-]{0,79}$/.test(option.flag) || !/^[a-z][a-zA-Z0-9]{0,79}$/.test(option.setting) || ['constructor', 'prototype'].includes(option.setting)))) throw new Error('Invalid app-owned command option.');
    for (const name of ['resolveSources','resolveRuntime','validateData','environment','compose','assets','checkRunning']) if (stack[name] !== undefined && typeof stack[name] !== 'function') throw new Error('Invalid app-owned stack hook.');
    return { app, stack };
  }).sort((a, b) => (a.stack.order || 0) - (b.stack.order || 0));
}
export function stackServiceInventory(registry = DEFAULT_APP_REGISTRY, options = {}) {
  const services = { praxis: 4321, 'praxis-public': 14321 };
  const ports = new Set(Object.values(services));
  for (const { stack } of stackRecipes(registry)) for (const service of stack.services) {
    if (service.excludeWhen && options[service.excludeWhen]) continue;
    if (Object.hasOwn(services, service.name) || ports.has(service.port)) throw new Error('Duplicate app-owned stack service or port.');
    services[service.name] = service.port;
    ports.add(service.port);
  }
  return services;
}
export const SERVICES = Object.freeze(stackServiceInventory());
const workspace = fileURLToPath(new URL('../', import.meta.url));
const HELP = `Usage: npm run stack -- <command> [options]

Commands:
  plan                    Validate and print canonical bindings without writing
  build                   Build source-only images; no service is stopped
  up                      Build images, prepare app assets, start detached
  assets                  Prepare assets through the installed app recipes
  activate                Verify managed deployment and record canonical bindings
  down                    Stop this stack; preserve every data directory
  status [--json]         Show all application services and their health
  logs [service] [--follow] [--tail N]
  exec <service> -- <command> [arguments...]

Options: --config PATH, --apps-root PATH, --public-urls PATH,
         --source-mode copied|registered
         installed app options are declared by their stack recipes
Example: npm run stack -- exec <service> -- <command> [arguments...]
`;

const absolutePath = (value, home) => {
  if (typeof value !== 'string' || !value || /[\r\n\0]/.test(value)) throw new Error('Configuration paths must be nonempty single-line strings.');
  const path = value === '~' ? home : value.startsWith('~/') ? join(home, value.slice(2)) : value;
  if (!isAbsolute(path)) throw new Error('Configuration paths must be absolute.');
  return resolve(path);
};
function observationsOriginSetting(value) {
  if (value === '') return '';
  let origin;
  try { origin = new URL(value); } catch { throw new Error('The observations origin must be an explicit HTTPS origin.'); }
  if (typeof value !== 'string' || value !== value.trim() || /[\0\r\n?#]/.test(value) || !/^https?:\/\//i.test(value) || !['http:', 'https:'].includes(origin.protocol) || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash || (origin.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname))) throw new Error('The observations origin must use HTTPS or HTTP loopback without paths, credentials or query parameters.');
  return origin.origin;
}

export async function validateObservationsDirectory(directory, { uid = process.getuid?.() ?? 1000, create = false, protectedPaths = [] } = {}) {
  const overlaps = (left, right) => isWithin(left, right) || isWithin(right, left);
  const broad = ['/', '/tmp', '/var', '/var/lib', '/run', '/etc', '/opt', '/mnt', '/media', '/home', homedir()];
  if (typeof directory !== 'string' || !isAbsolute(directory) || resolve(directory) !== directory || /[\0\r\n$]/.test(directory) || broad.includes(directory) || directory.split('/').filter(Boolean).length < 3 || overlaps(directory, workspace) || directory.split('/').some(part => ['.git', '.ssh', '.gnupg', '.aws', '.kube', '.docker'].includes(part)) || ['/proc', '/sys', '/dev', '/etc', '/usr', '/bin', '/sbin', '/lib', '/run'].some(root => isWithin(root, directory)) || protectedPaths.some(path => typeof path === 'string' && overlaps(directory, resolve(path)))) throw new Error('Observations require a dedicated private directory outside application data, secrets, source and controls.');
  let ancestor = directory, info;
  while (!(info = await lstat(ancestor).catch(error => { if (error.code === 'ENOENT') return null; throw error; }))) ancestor = dirname(ancestor);
  if (!info.isDirectory() || info.isSymbolicLink() || await realpath(ancestor) !== ancestor) throw new Error('Observations paths must use canonical directories without symbolic links.');
  for (const protectedPath of protectedPaths.filter(path => typeof path === 'string')) {
    let current = resolve(protectedPath); const suffix = [];
    while (!await lstat(current).catch(error => { if (error.code === 'ENOENT') return null; throw error; })) { suffix.unshift(basename(current)); current = dirname(current); }
    if (overlaps(directory, resolve(await realpath(current), ...suffix))) throw new Error('Observations must remain separate from canonical application data, secrets, source and controls.');
  }
  const existing = ancestor === directory;
  if (existing) {
    if (info.uid !== Number(uid) || (info.mode & 0o777) !== 0o700) throw new Error('The observations directory must be owned by the runtime user with mode700.');
    for (const name of await readdir(directory)) {
      if (!['observations.db', 'observations.db-wal', 'observations.db-shm', 'observations.db-journal'].includes(name)) throw new Error('The observations directory may contain only its database and SQLite sidecars.');
      const file = await lstat(join(directory, name)).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
      if (file && (!file.isFile() || file.isSymbolicLink() || file.nlink !== 1 || file.uid !== Number(uid) || (file.mode & 0o777) !== 0o600)) throw new Error('Observations database files must be private regular files with mode600.');
    }
  }
  if (create && !existing) {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    return validateObservationsDirectory(directory, { uid, protectedPaths });
  }
  return join(directory, 'observations.db');
}

export async function resolveStackSettings({ env = process.env, home = homedir(), configPath, appsRoot, publicUrls, sourceMode, registry = DEFAULT_APP_REGISTRY, ...featureOptions } = {}) {
  const configFile = absolutePath(configPath || env.PRAXIS_STORAGE_CONFIG || join(home, '.config/praxis/storage.json'), home);
  let config;
  try { config = JSON.parse(await readFile(configFile, 'utf8')); }
  catch (error) { throw new Error(`Unable to load storage configuration at ${configFile}; initialize storage first (${error.code || 'invalid JSON'}).`); }
  if (config.schemaVersion !== 1 || typeof config.workspaceId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,100}$/.test(config.workspaceId)) throw new Error('Storage configuration requires schemaVersion 1 and a safe workspaceId.');
  const dataRoot = absolutePath(config.dataRoot || join(home, '.local/share/praxis'), home);
  const workspaceRoot = join(dataRoot, 'workspaces', config.workspaceId);
  const stateRoot = absolutePath(config.stateRoot || join(workspaceRoot, '.praxis-storage'), home);
  const workingPaths = config.workingData ? resolveAppPaths({ ...config, dataRoot, stateRoot }) : null;
  const resolvedAppsRoot = absolutePath(appsRoot || env.PRAXIS_APPS_ROOT || join(workspaceRoot, 'apps'), home);
  sourceMode ??= config.dockerSourceMode || 'copied';
  if (!['copied', 'registered'].includes(sourceMode)) throw new Error('Source mode must be copied or registered.');
  const registered = (id, target, kind) => {
    const sources = (config.appSources || []).filter(source => source.id === id && source.target === target);
    if (sources.length !== 1 || sources[0].kind !== kind) throw new Error(`One registered ${id}/${target} source is required.`);
    return absolutePath(sources[0].source, home);
  };
  const recipes = stackRecipes(registry), sourceMap = {}, dataBindings = [], sourceBindings = [], appSettings = {}, fingerprintFields = {};
  const sourceContext = { config, registered, home, appsRoot: resolvedAppsRoot, sourceMode, workingPaths, registeredMode: sourceMode === 'registered' || Boolean(workingPaths), options: featureOptions };
  for (const recipe of recipes) if (recipe.stack.resolveSources) {
    const resolved = await recipe.stack.resolveSources(Object.freeze({ ...sourceContext }));
    if (!resolved || !Array.isArray(resolved.sources) || !Array.isArray(resolved.data)) throw new Error('Invalid app-owned source bindings.');
    Object.assign(appSettings, resolved.settings || {});
    sourceBindings.push(...resolved.sources); dataBindings.push(...resolved.data);
  }
  for (const binding of sourceBindings.sort((a, b) => (a.order || 0) - (b.order || 0))) {
    if (!/^[a-z][a-zA-Z0-9]{0,79}$/.test(binding.key) || typeof binding.path !== 'string' || !isAbsolute(binding.path) || Object.hasOwn(sourceMap, binding.key)) throw new Error('Invalid or duplicate application source key.');
    sourceMap[binding.key] = binding.path;
  }
  for (const binding of dataBindings) if (!binding || !['directory','file'].includes(binding.kind) || typeof binding.path !== 'string' || !isAbsolute(binding.path)) throw new Error('Invalid app-owned data binding.');
  const baseDataDirectories = [...new Set(dataBindings.map(binding => binding.kind === 'directory' ? binding.path : dirname(binding.path)))];
  const publicUrlsFile = absolutePath(publicUrls || env.PRAXIS_PUBLIC_URLS_FILE || join(home, '.config/praxis/public-urls.json'), home);
  const projectName = env.PRAXIS_COMPOSE_PROJECT || `praxis-${config.workspaceId.toLowerCase().replace(/[^a-z0-9_-]/g, '-')}`;
  if (!/^[a-z0-9][a-z0-9_-]{0,120}$/.test(projectName)) throw new Error('PRAXIS_COMPOSE_PROJECT must be a safe lowercase Compose project name.');
  const uid = String(env.PRAXIS_UID || process.getuid?.() || 1000);
  const gid = String(env.PRAXIS_GID || process.getgid?.() || 1000);
  if (!/^[1-9]\d*$/.test(uid) || !/^[1-9]\d*$/.test(gid)) throw new Error('Containers must use a non-root UID and GID.');
  const bindAddress = env.PRAXIS_BIND_ADDRESS || '0.0.0.0';
  if (!/^(?:\d{1,3}\.){3}\d{1,3}$/.test(bindAddress) || bindAddress.split('.').some(part => Number(part) > 255)) throw new Error('PRAXIS_BIND_ADDRESS must be an IPv4 address.');
  const controlRoot = sourceMode === 'registered' ? join(dirname(configFile), 'docker-apps') : join(stateRoot, 'docker');
  const services = stackServiceInventory(registry, appSettings);
  if (workingPaths && env.PRAXIS_OBSERVATIONS_DIR && absolutePath(env.PRAXIS_OBSERVATIONS_DIR, home) !== workingPaths.observations) throw new Error('Observations must match the configured application working root.');
  const observationsDir = workingPaths?.observations || absolutePath(env.PRAXIS_OBSERVATIONS_DIR || join(dataRoot, 'observability'), home);
  let observationsOrigin = env.PRAXIS_OBSERVATIONS_ORIGIN ?? '';
  let consoleUpstream = '', consoleHost = '', consoleOrigin = '';
  let webGateway = false, originHost = '', canonicalUrl = '', shareManifestFile = '', business = null, businessFile;
  const observationsProtectedPaths = [...(workingPaths ? Object.entries(workingPaths.roots).filter(([id]) => id !== 'praxis').map(([, path]) => path) : [resolvedAppsRoot]), stateRoot, controlRoot, configFile, publicUrlsFile, ...baseDataDirectories,
    ...(config.appSources || []).map(source => source.kind === 'directory' ? source.source : dirname(source.source)), ...(config.sourceRepos || []).map(repo => repo.path),
    ...(config.repositories || []).flatMap(repo => [repo.path, ...['passwordFile', 'credentialsFile', 'rcloneConfigFile'].map(key => repo[key] && dirname(repo[key]))]).filter(Boolean)];
  if (config.businessConfigFile) {
    businessFile = absolutePath(config.businessConfigFile, home);
    business = JSON.parse(await readFile(businessFile, 'utf8'));
    if (business.webGateway !== undefined && (!business.webGateway || typeof business.webGateway !== 'object' || Array.isArray(business.webGateway) || typeof business.webGateway.enabled !== 'boolean' || Object.keys(business.webGateway).some(key => !['enabled', 'originHost', 'shareManifestFile'].includes(key)))) throw new Error('The web gateway requires an explicit enabled setting and trusted origin host.');
    if (business.webGateway?.enabled === true) {
      originHost = business.webGateway.originHost;
      if (typeof originHost !== 'string' || originHost.length > 253 || !/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(originHost)) throw new Error('The web gateway origin host must be a fixed hostname without a port.');
      const issuer = new URL(observationsOriginSetting(business.issuer));
      webGateway = true; canonicalUrl = issuer.origin;
      consoleUpstream = 'http://127.0.0.1:4326'; consoleHost = issuer.host; consoleOrigin = issuer.origin;
    }
    if (business.console) {
      const issuer = new URL(observationsOriginSetting(business.issuer));
      consoleUpstream = webGateway ? 'http://127.0.0.1:4326' : env.PRAXIS_CONSOLE_UPSTREAM ?? 'http://host.docker.internal:4326';
      consoleHost = issuer.host;
      consoleOrigin = issuer.origin;
      createPlatformProxy({ upstream: consoleUpstream, host: consoleHost, origin: consoleOrigin });
    }
    if (env.PRAXIS_OBSERVATIONS_ORIGIN === undefined) observationsOrigin = business.issuer ?? '';
    observationsProtectedPaths.push(businessFile, dirname(business.database), dirname(business.eventsDatabase), join(dirname(businessFile), 'business-docker'));
    for (const app of Object.values(business.apps || {})) {
      if (app.keyFile) observationsProtectedPaths.push(dirname(app.keyFile));
      if (app.dataFile) observationsProtectedPaths.push(dirname(app.dataFile));
      if (app.dataDir) observationsProtectedPaths.push(app.dataDir);
      if (app.spacesFile) {
        observationsProtectedPaths.push(app.spacesFile);
        const mapping = JSON.parse(await readFile(app.spacesFile, 'utf8'));
        observationsProtectedPaths.push(...Object.values(mapping.spaces || {}).map(file => dirname(file)));
      }
    }
    if (business.observationsFile !== undefined && business.observationsFile !== join(observationsDir, 'observations.db')) throw new Error('Workbench and business observations must use the same configured database.');
  }
  const runtimeContext = {
    config, configFile, business, businessFile, registered, env, home, uid, gid, workspace,
    appsRoot: resolvedAppsRoot, publicUrlsFile, stateRoot, controlRoot, observationsDir, webGateway, canonicalUrl,
    sourceMap, workingPaths, sourceMode, baseDataDirectories,
    protectedFor({ excludeSources = [], otherBusinessData } = {}) {
      return [stateRoot, controlRoot, observationsDir, ...baseDataDirectories,
        ...(config.appSources || []).filter(source => !excludeSources.some(exclusion => source.id === exclusion.id && (exclusion.target === undefined || source.target === exclusion.target))).map(source => source.kind === 'directory' ? source.source : dirname(source.source)),
        ...(otherBusinessData ? Object.entries(business?.apps || {}).filter(([id]) => id !== otherBusinessData).map(([, app]) => app.dataDir).filter(Boolean) : []),
        ...(config.sourceRepos || []).map(repo => repo.path), ...(config.repositories || []).map(repo => repo.path)].filter(Boolean);
    },
    privateFor({ except, fields = [], repositoryCredentials = false } = {}) {
      return [configFile, publicUrlsFile, businessFile, ...Object.entries(business?.apps || {}).filter(([id]) => id !== except).flatMap(([, app]) => fields.map(field => app[field])), ...(repositoryCredentials ? (config.repositories || []).flatMap(repo => [repo.passwordFile, repo.credentialsFile, repo.rcloneConfigFile]) : [])].filter(Boolean);
    },
  };
  for (const recipe of recipes) if (recipe.stack.resolveRuntime) {
    const resolved = await recipe.stack.resolveRuntime(Object.freeze({ ...runtimeContext }));
    if (!resolved || typeof resolved !== 'object') throw new Error('Invalid app-owned runtime settings.');
    for (const [key, value] of Object.entries(resolved.settings || {})) { if (Object.hasOwn(appSettings, key)) throw new Error('Duplicate app-owned runtime setting.'); appSettings[key] = value; }
    for (const [key, value] of Object.entries(resolved.sourceMap || {})) { if (Object.hasOwn(sourceMap, key)) throw new Error('Duplicate app-owned runtime source.'); sourceMap[key] = value; }
    Object.assign(fingerprintFields, resolved.fingerprint || {});
  }
  shareManifestFile = appSettings.shareManifestFile || '';
  observationsOrigin = observationsOriginSetting(observationsOrigin);
  await validateObservationsDirectory(observationsDir, { uid, protectedPaths: observationsProtectedPaths });
  if (shareManifestFile) await validateStorageStatusDestination(shareManifestFile, { protectedPaths: [...observationsProtectedPaths, observationsDir] });
  const overlay = recipes.map(recipe => recipe.stack.overlayFilename).filter(Boolean);
  if (overlay.length > 1 || overlay.some(name => typeof name !== 'string' || !/^compose\.[a-z0-9-]+\.json$/.test(name))) throw new Error('Invalid app runtime overlay filename.');
  const runtimeOverrideFile = join(controlRoot, overlay[0] || 'compose.apps-runtime.json');
  const sourceFingerprint = createHash('sha256').update(JSON.stringify(workingPaths ? { sourceMap, workingPaths, ...fingerprintFields } : { ...sourceMap, ...fingerprintFields })).digest('hex');
  return { ...appSettings, recipes, dataBindings, registry, runtimeOverrideFile, config, configFile, workingPaths, workspaceId: config.workspaceId, appsRoot: resolvedAppsRoot, stateRoot, publicUrlsFile, projectName, uid, gid, bindAddress, appBindAddress: webGateway ? '127.0.0.1' : bindAddress, webGateway, originHost, canonicalUrl, shareManifestFile, gatewayOverrideFile: webGateway ? join(controlRoot, 'compose.gateway.yml') : '', sourceMode, sourceMap, sourceFingerprint, services, observationsDir, observationsOrigin, observationsFile: join(observationsDir, 'observations.db'), observationsProtectedPaths, consoleUpstream, consoleHost, consoleOrigin, envFile: join(controlRoot, 'compose.env'), receiptFile: sourceMode === 'registered' ? join(controlRoot, 'activation.json') : join(stateRoot, 'docker-active.json') };
}

export function assertActiveWriter(settings) {
  const { deviceId, activeWriterDeviceId } = settings.config;
  if (!deviceId || !activeWriterDeviceId || deviceId !== activeWriterDeviceId) throw new Error('This device is not the active workspace writer. Activate it through the storage workflow before starting or changing app data.');
}

export async function validateData(settings) {
  for (const binding of settings.dataBindings) {
    const path = binding.path, info = await stat(path).catch(() => null), directory = binding.kind === 'directory';
    if (!info || (directory ? !info.isDirectory() : !info.isFile()) || binding.nonempty && info.size === 0) throw new Error(`Required ${directory ? 'app data directory' : 'nonempty app data file'} is missing: ${path}. Refusing to initialize or replace data.`);
    if (settings.sourceMode === 'registered' && (await realpath(path) !== path || (await lstat(path)).isSymbolicLink())) throw new Error('Registered data paths must be precise canonical application paths; symbolic-link aliases are forbidden.');
    if (directory && settings.sourceMode === 'registered' && (['/', '/home', '/tmp', homedir(), workspace.replace(/\/$/, '')].includes(path) || path.split('/').includes('.git') || (settings.config.sourceRepos || []).some(repo => repo.path === path || repo.path.startsWith(`${path}/`)))) throw new Error('Registered data directories must be precise canonical application paths.');
    await access(path, constants.R_OK | (binding.writable ? constants.W_OK : 0));
    if (directory && info.uid !== undefined && info.uid !== Number(settings.uid)) throw new Error(`App data directory must be owned by runtime UID ${settings.uid}: ${path}.`);
  }
  const validateContent = async ({ directories = [], files = [], label = 'Application' }) => {
    for (const directory of directories) { const info = await lstat(directory).catch(() => null); if (!info?.isDirectory() || info.isSymbolicLink() || await realpath(directory) !== directory || info.uid !== Number(settings.uid)) throw new Error(`Configured ${label} directories must already exist as canonical application paths.`); await access(directory, constants.R_OK); }
    for (const binding of files) { const info = await lstat(binding.path).catch(() => null); if (!info?.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size === 0 || await realpath(binding.path) !== binding.path) throw new Error(`Configured ${label} content or data is missing or unsafe; no replacement will be created.`); await access(binding.path, constants.R_OK | (binding.writable ? constants.W_OK : 0)); if (binding.private && (info.uid !== Number(settings.uid) || (info.mode & 0o777) !== 0o600)) throw new Error(`${label} data must be owned by the runtime user with mode600.`); }
  };
  for (const recipe of settings.recipes) if (recipe.stack.validateData) await recipe.stack.validateData({ settings, validateContent });
  const publicInfo = await stat(settings.publicUrlsFile).catch(() => null);
  if (!publicInfo?.isFile() || !publicInfo.size) throw new Error(`Public launcher configuration is missing: ${settings.publicUrlsFile}.`);
  await access(settings.publicUrlsFile, constants.R_OK);
}

export function stackEnvironment(settings) {
  const values = {};
  const reserved = new Set(['PATH', 'HOME', 'NODE_OPTIONS', 'PRAXIS_APPS_ROOT', 'PRAXIS_PUBLIC_URLS_FILE', 'PRAXIS_COMPOSE_PROJECT', 'PRAXIS_UID', 'PRAXIS_GID', 'PRAXIS_BIND_ADDRESS', 'PRAXIS_APP_BIND_ADDRESS', 'PRAXIS_WEB_GATEWAY', 'PRAXIS_ORIGIN_HOST', 'PRAXIS_CANONICAL_URL', 'PRAXIS_OBSERVATIONS_DIR', 'PRAXIS_OBSERVATIONS_ORIGIN', 'PRAXIS_CONSOLE_UPSTREAM', 'PRAXIS_CONSOLE_HOST', 'PRAXIS_CONSOLE_ORIGIN', 'PRAXIS_PUBLIC_BUSINESS_URL', 'PRAXIS_STORAGE_CONFIG']);
  for (const recipe of settings.recipes) if (recipe.stack.environment) {
    const declared = recipe.stack.environment({ settings });
    if (!declared || typeof declared !== 'object' || Array.isArray(declared)) throw new Error('Invalid app-owned stack environment.');
    for (const [key, value] of Object.entries(declared)) { if (reserved.has(key) || !/^[A-Z][A-Z0-9_]{0,119}$/.test(key) || !['string','number','boolean'].includes(typeof value) || /[\0\r\n]/.test(String(value)) || Object.hasOwn(values,key)) throw new Error('Invalid or duplicate app-owned stack environment.'); values[key] = value; }
  }
  return values;
}
const quoteEnv = value => `'${String(value).replaceAll("'", "\\'")}'`;
export async function writeComposeEnvironment(settings) {
  const directory = dirname(settings.envFile);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
  const variables = {
    PRAXIS_APPS_ROOT: settings.appsRoot, PRAXIS_PUBLIC_URLS_FILE: settings.publicUrlsFile,
    PRAXIS_COMPOSE_PROJECT: settings.projectName, PRAXIS_UID: settings.uid,
    PRAXIS_GID: settings.gid, PRAXIS_BIND_ADDRESS: settings.bindAddress,
    PRAXIS_APP_BIND_ADDRESS: settings.appBindAddress,
    PRAXIS_WEB_GATEWAY: settings.webGateway ? 'true' : 'false', PRAXIS_ORIGIN_HOST: settings.originHost,
    PRAXIS_CANONICAL_URL: settings.canonicalUrl,
    PRAXIS_OBSERVATIONS_DIR: settings.observationsDir,
    PRAXIS_OBSERVATIONS_ORIGIN: settings.observationsOrigin,
    PRAXIS_CONSOLE_UPSTREAM: settings.consoleUpstream,
    PRAXIS_CONSOLE_HOST: settings.consoleHost,
    PRAXIS_CONSOLE_ORIGIN: settings.consoleOrigin,
    PRAXIS_PUBLIC_BUSINESS_URL: settings.consoleOrigin ? `${settings.consoleOrigin}/business/` : '',
  };
  Object.assign(variables, stackEnvironment(settings));
  const temporary = `${settings.envFile}.${process.pid}.tmp`;
  await writeFile(temporary, Object.entries(variables).map(([key, value]) => `${key}=${quoteEnv(value)}`).join('\n') + '\n', { mode: 0o600 });
  await chmod(temporary, 0o600);
  await rename(temporary, settings.envFile);
  const mapOverride = { services: {} };
  for (const recipe of settings.recipes) if (recipe.stack.compose) {
    const value = await recipe.stack.compose({ settings, workspace });
    if (!value || !value.services || typeof value.services !== 'object') throw new Error('Invalid app-owned Compose override.');
    const allowed = new Set(recipe.stack.services.map(service => service.name));
    for (const [name, definition] of Object.entries(value.services)) { if (!allowed.has(name) || Object.hasOwn(mapOverride.services, name)) throw new Error('App Compose overrides must use unique owned services.'); mapOverride.services[name] = definition; }
  }
  const temporaryMap = `${settings.runtimeOverrideFile}.${process.pid}.tmp`;
  await writeFile(temporaryMap, JSON.stringify(mapOverride, null, 2) + '\n', { mode: 0o600 });
  await chmod(temporaryMap, 0o600); await rename(temporaryMap, settings.runtimeOverrideFile);
  if (settings.webGateway) {
    const directory = dirname(settings.shareManifestFile);
    const contents = `services:\n  praxis-public:\n    network_mode: host\n    ports: !reset []\n    volumes:\n      - type: bind\n        source: ${JSON.stringify(directory)}\n        target: ${JSON.stringify(directory)}\n        read_only: true\n        bind: { create_host_path: false }\n`;
    const temporaryOverride = `${settings.gatewayOverrideFile}.${process.pid}.tmp`;
    await writeFile(temporaryOverride, contents, { mode: 0o600 }); await chmod(temporaryOverride, 0o600); await rename(temporaryOverride, settings.gatewayOverrideFile);
  }
  return settings.envFile;
}

export function execute(command, args, { capture = false, env = process.env, cwd = workspace } = {}) {
  return new Promise((accept, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit' });
    let output = '', errors = '';
    if (capture) {
      child.stdout.setEncoding('utf8').on('data', value => { output += value; });
      child.stderr.setEncoding('utf8').on('data', value => { errors += value; });
    }
    child.on('error', error => reject(new Error(error.code === 'ENOENT' ? 'Docker Engine and the Compose v2 plugin must be installed and accessible on this host.' : error.message)));
    child.on('exit', (code, signal) => code === 0 ? accept(output) : reject(new Error(`${command} ${args[0] || ''} failed (${signal || code}).${capture && errors ? ` ${errors.trim().slice(-1200)}` : ''}`)));
  });
}

export const portInUse = port => new Promise(accept => {
  const socket = createConnection({ host: '127.0.0.1', port });
  const finish = used => { socket.destroy(); accept(used); };
  socket.setTimeout(500);
  socket.once('connect', () => finish(true));
  socket.once('timeout', () => finish(false));
  socket.once('error', () => finish(false));
});

export function serviceStatus(output, inventory = SERVICES) {
  const trimmed = output.trim();
  let rows = [];
  if (trimmed) rows = trimmed.startsWith('[') ? JSON.parse(trimmed) : trimmed.split('\n').filter(Boolean).map(line => JSON.parse(line));
  const services = Object.keys(inventory).map(name => {
    const row = rows.find(item => item.Service === name);
    return { name, port: inventory[name], state: row?.State || 'absent', health: row?.Health || 'unknown' };
  });
  return { healthy: services.every(item => item.state === 'running' && item.health === 'healthy'), services };
}

export async function main(argv = process.argv.slice(2), dependencies = {}) {
  const args = [...argv], options = {};
  const ownedFlags = stackRecipes(dependencies.registry || DEFAULT_APP_REGISTRY).flatMap(recipe => recipe.stack.cliFlags || []);
  for (let index = 0; index < args.length && args[index] !== '--'; index++) {
    if (args[index] === '--defer-deployment-facade') { options.deferDeploymentFacade = true; args.splice(index, 1); index--; continue; }
    const owned = ownedFlags.find(option => option.flag === args[index]);
    if (owned) { options[owned.setting] = true; args.splice(index, 1); index--; continue; }
    const key = { '--config': 'configPath', '--apps-root': 'appsRoot', '--public-urls': 'publicUrls', '--source-mode': 'sourceMode' }[args[index]];
    if (!key) continue;
    if (!args[index + 1] || args[index + 1].startsWith('--')) throw new Error(`Missing value for ${args[index]}.`);
    options[key] = args[index + 1]; args.splice(index, 2); index--;
  }
  const command = args.shift() || 'help';
  if (['help', '--help', '-h'].includes(command)) { (dependencies.print || console.log)(HELP); return; }
  if (!['plan', 'build', 'up', 'activate', 'assets', 'down', 'status', 'logs', 'exec'].includes(command)) throw new Error(`Unknown stack command: ${command}.`);
  const env = dependencies.env || process.env;
  const settings = await resolveStackSettings({ ...options, env, home: dependencies.home, registry: dependencies.registry || DEFAULT_APP_REGISTRY });
  const inventory = stackServiceInventory(settings.registry);
  const run = dependencies.run || execute;
  const print = dependencies.print || console.log;
  const root = dependencies.root || workspace;
  const installed = !dependencies.run && !dependencies.env && !dependencies.home && !dependencies.root ? await readManagedInstallation() : null;
  if (installed?.projects.apps && ['up', 'activate', 'down', 'status', 'logs', 'build', 'assets', 'exec'].includes(command)) {
    if (['up', 'activate', 'assets', 'exec'].includes(command)) { assertActiveWriter(settings); await validateData(settings); }
    const project = installed.projects.apps;
    if (command === 'exec' || command === 'assets') {
      const statusArgs = installationCommand(installed, 'apps', 'status');
      const prefix = statusArgs.slice(0, statusArgs.indexOf('ps'));
      let operation;
      if (command === 'assets') {
        if (args.length) throw new Error('assets does not accept additional arguments.');
        const hooks = settings.recipes.filter(recipe => recipe.stack.assets);
        if (!hooks.length) throw new Error('No installed app declares asset preparation.');
        for (const recipe of hooks) await recipe.stack.assets({ services: project.services, compose: async tail => { const output = await docker([...prefix, ...tail]); if (output) process.stdout.write(output); } });
        return;
      } else {
        const [service, ...tokens] = args;
        if (!project.services.includes(service)) throw new Error('exec requires a registered installation service.');
        if (tokens[0] === '--') tokens.shift();
        if (!tokens.length) throw new Error('exec requires an application command.');
        operation = ['exec', '-T', service, ...tokens];
      }
      const output = await docker([...prefix, ...operation]); if (output) process.stdout.write(output); return;
    }
    if (command === 'logs') {
      const statusArgs = installationCommand(installed, 'apps', 'status');
      const prefix = statusArgs.slice(0, statusArgs.indexOf('ps'));
      const tail = ['logs', '--tail', '100'];
      while (args.length) {
        const token = args.shift();
        if (['--follow', '-f'].includes(token)) tail.push('--follow');
        else if (token === '--tail') {
          const count = args.shift(); if (!/^\d+$/.test(count || '')) throw new Error('--tail requires a nonnegative integer.'); tail.push('--tail', count);
        } else if (project.services.includes(token)) tail.push(token);
        else throw new Error('logs requires a registered installation service.');
      }
      const output = await docker([...prefix, ...tail]); if (output) process.stdout.write(output); return;
    }
    if (command === 'up') {
      if (args.length) throw new Error('up does not accept additional arguments.');
      const services = project.services.filter(name => !options.deferDeploymentFacade || name !== 'praxis-public');
      await installationOperation(installed, 'apps', 'up', { services });
      if (options.deferDeploymentFacade) return { deploymentPending: true };
    } else if (command !== 'activate' && command !== 'status') {
      if (args.length) throw new Error(command + ' does not accept additional arguments.');
      const output = await installationOperation(installed, 'apps', command); if (output) process.stdout.write(output); return;
    }
    const output = await installationOperation(installed, 'apps', 'status');
    const status = { ...installationStatus(output, project, inventory), workspaceId: settings.workspaceId, sourceMode: 'registered', sourceFingerprint: settings.sourceFingerprint };
    if (command === 'status') {
      if (args.some(arg => arg !== '--json')) throw new Error('status only accepts --json.');
      print(args.includes('--json') ? JSON.stringify(status) : status.services.map(item => `${item.name} ${item.state} ${item.health}`).join('\n'));
      return status;
    }
    if (!status.healthy) throw new Error('Registered installation is unhealthy; no activation receipt was written.');
    await mkdir(settings.stateRoot, { recursive: true, mode: 0o700 });
    const receipt = { schemaVersion: 2, workspaceId: settings.workspaceId, appsRoot: settings.appsRoot, projectName: project.name, activatedAt: new Date().toISOString(), composeFile: installed.projects.apps.files[0], services: settings.services, sourceMode: 'registered', sourceFingerprint: settings.sourceFingerprint, sourceMap: settings.sourceMap };
    const temporary = settings.receiptFile + '.' + process.pid + '.tmp'; await writeFile(temporary, JSON.stringify(receipt, null, 2) + '\n', { mode: 0o600 }); await chmod(temporary, 0o600); await rename(temporary, settings.receiptFile);
    return status;
  }
  if (command === 'plan') {
    if (args.length) throw new Error('plan does not accept additional arguments.');
    await validateData(settings);
    const result = { workspaceId: settings.workspaceId, projectName: settings.projectName, sourceMode: settings.sourceMode, services: Object.keys(settings.services), sourceMap: settings.sourceMap, sourceFingerprint: settings.sourceFingerprint, observationsFile: settings.observationsFile, webGateway: settings.webGateway, appBindAddress: settings.appBindAddress, activeWriter: settings.config.deviceId === settings.config.activeWriterDeviceId };
    print(JSON.stringify(result)); return result;
  }
  await run('docker', ['info', '--format', '{{.ServerVersion}}'], { capture: true, env, cwd: root });
  await run('docker', ['compose', 'version', '--short'], { capture: true, env, cwd: root });
  if (['up', 'activate', 'assets', 'exec'].includes(command)) { assertActiveWriter(settings); await validateData(settings); }
  if (command === 'status' && settings.sourceMode === 'registered') await validateData(settings);
  if (['up', 'build'].includes(command)) await validateObservationsDirectory(settings.observationsDir, { uid: settings.uid, create: true, protectedPaths: settings.observationsProtectedPaths });
  if (['up', 'build'].includes(command) && settings.shareManifestFile) await validateStorageStatusDestination(settings.shareManifestFile, { create: true, protectedPaths: [...settings.observationsProtectedPaths, settings.observationsDir] });
  if (command !== 'status') await writeComposeEnvironment(settings);
  const prefix = ['compose', '--project-name', settings.projectName];
  if (command !== 'status' || await lstat(settings.envFile).catch(error => { if (error.code === 'ENOENT') return null; throw error; })) prefix.push('--env-file', settings.envFile);
  prefix.push('--file', join(root, 'compose.apps.yaml'));
  if (settings.gatewayOverrideFile && (command !== 'status' || await lstat(settings.gatewayOverrideFile).catch(error => { if (error.code === 'ENOENT') return null; throw error; }))) prefix.push('--file', settings.gatewayOverrideFile);
  if (command !== 'status' || await lstat(settings.runtimeOverrideFile).catch(error => { if (error.code === 'ENOENT') return null; throw error; })) prefix.push('--file', settings.runtimeOverrideFile);
  if (env.PRAXIS_COMPOSE_EXTRA_FILE) prefix.push('--file', absolutePath(env.PRAXIS_COMPOSE_EXTRA_FILE, dependencies.home || homedir()));
  const deployment = await deploymentOverrides(settings.configFile, env);
  if (deployment) prefix.push('--file', deployment.apps);
  for (const profile of (env.PRAXIS_COMPOSE_PROFILES || '').split(',').filter(Boolean)) {
    if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(profile)) throw new Error('Compose profile names must be safe identifiers.');
    prefix.push('--profile', profile);
  }
  const composeEnv = { ...env, PRAXIS_APPS_ROOT: settings.appsRoot, PRAXIS_PUBLIC_URLS_FILE: settings.publicUrlsFile, PRAXIS_COMPOSE_PROJECT: settings.projectName, PRAXIS_UID: settings.uid, PRAXIS_GID: settings.gid, PRAXIS_BIND_ADDRESS: settings.bindAddress,
    PRAXIS_OBSERVATIONS_DIR: settings.observationsDir, PRAXIS_OBSERVATIONS_ORIGIN: settings.observationsOrigin,
    PRAXIS_CONSOLE_UPSTREAM: settings.consoleUpstream, PRAXIS_CONSOLE_HOST: settings.consoleHost, PRAXIS_CONSOLE_ORIGIN: settings.consoleOrigin, PRAXIS_PUBLIC_BUSINESS_URL: settings.consoleOrigin ? `${settings.consoleOrigin}/business/` : '', PRAXIS_APP_BIND_ADDRESS: settings.appBindAddress, PRAXIS_WEB_GATEWAY: settings.webGateway ? 'true' : 'false', PRAXIS_ORIGIN_HOST: settings.originHost, PRAXIS_CANONICAL_URL: settings.canonicalUrl, ...stackEnvironment(settings) };
  const compose = (tail, extra = {}) => run('docker', [...prefix, ...tail], { env: composeEnv, cwd: root, ...extra });
  const inspect = async () => {
    const raw = await compose(['ps', '--all', '--format', 'json'], { capture: true });
    const status = serviceStatus(raw, settings.services);
    for (const recipe of settings.recipes) recipe.stack.checkRunning?.({ settings, status: serviceStatus(raw, inventory) });
    return { projectName: settings.projectName, workspaceId: settings.workspaceId, sourceMode: settings.sourceMode, sourceFingerprint: settings.sourceFingerprint, ...status };
  };
  const assets = async () => { for (const recipe of settings.recipes) if (recipe.stack.assets) await recipe.stack.assets({ compose }); };
  const activate = async () => {
    const status = await inspect();
    if (!status.healthy) throw new Error('Stack has unhealthy or missing services; no activation receipt was written. Inspect stack status and logs.');
    await mkdir(settings.stateRoot, { recursive: true, mode: 0o700 });
    const receipt = { schemaVersion: settings.sourceMode === 'registered' ? 2 : 1, workspaceId: settings.workspaceId, appsRoot: settings.appsRoot, projectName: settings.projectName, activatedAt: new Date().toISOString(), ...(settings.sourceMode === 'registered' ? { sourceMode: settings.sourceMode, sourceMap: settings.sourceMap, sourceFingerprint: settings.sourceFingerprint, services: Object.keys(settings.services) } : {}) };
    await writeFile(settings.receiptFile, JSON.stringify(receipt, null, 2) + '\n', { mode: 0o600 });
    await chmod(settings.receiptFile, 0o600);
    print(`Started ${status.services.length} healthy services in detached project ${settings.projectName}.`); return status;
  };
  if (command === 'activate') {
    if (!deployment || args.length) throw new Error('activate requires an adopted deployment and no additional arguments.');
    return activate();
  }
  if (command === 'build') { if (args.length) throw new Error('build does not accept additional arguments.'); await compose(['build', ...Object.keys(settings.services)]); return; }
  if (command === 'up') {
    if (args.length) throw new Error('up does not accept additional arguments.');
    const current = await inspect();
    const alreadyRunning = new Set(current.services.filter(item => item.state === 'running').map(item => item.name));
    const occupied = [];
    for (const [name, port] of Object.entries(settings.services)) if (!alreadyRunning.has(name) && await (dependencies.portInUse || portInUse)(port)) occupied.push(`${name}:${port}`);
    if (occupied.length) throw new Error(`Existing services occupy ${occupied.join(', ')}. Keep them running until the documented data-safe cutover; stack up never stops native processes.`);
    await compose(['build', ...Object.keys(settings.services)]); await assets();
    const recreate = Object.keys(settings.services).filter(name => !deployment || name !== 'praxis-public');
    await compose(['up', '--detach', '--force-recreate', '--wait', '--wait-timeout', '180', ...recreate]);
    if (deployment && !options.deferDeploymentFacade) await compose(['up', '--detach', '--no-recreate', '--wait', '--wait-timeout', '180', 'praxis-public']);
    if (deployment && options.deferDeploymentFacade) return { deploymentPending: true };
    return activate();
  }
  if (command === 'assets') { if (args.length) throw new Error('assets does not accept additional arguments.'); await assets(); return; }
  if (command === 'down') { if (args.length) throw new Error('down does not accept additional arguments.'); await compose(['down', '--remove-orphans']); await rm(settings.receiptFile, { force: true }); return; }
  if (command === 'status') {
    if (args.some(arg => arg !== '--json')) throw new Error('status only accepts --json.');
    const status = await inspect();
    print(args.includes('--json') ? JSON.stringify(status) : status.services.map(item => `${item.name.padEnd(18)} ${String(item.port).padEnd(6)} ${item.state.padEnd(10)} ${item.health}`).join('\n')); return status;
  }
  if (command === 'exec') {
    const service = args.shift();
    if (!Object.hasOwn(inventory, service)) throw new Error('exec requires a known service name.');
    if (args[0] === '--') args.shift();
    if (!args.length) throw new Error('exec requires an application command.');
    await compose(['exec', '-T', service, ...args]); return;
  }
  if (command === 'logs') {
    const tail = ['logs', '--tail', '100'];
    while (args.length) {
      const argument = args.shift();
      if (argument === '--follow' || argument === '-f') tail.push('--follow');
      else if (argument === '--tail') {
        const count = args.shift(); if (!/^\d+$/.test(count || '')) throw new Error('--tail requires a nonnegative integer.'); tail.push('--tail', count);
      } else if (Object.hasOwn(inventory, argument)) tail.push(argument);
      else throw new Error(`Unknown logs argument: ${argument}.`);
    }
    await compose(tail);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error(`Stack failed: ${error.message}`); process.exitCode = 1; });
}
