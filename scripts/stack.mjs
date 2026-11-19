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
import { resolveKnowledgeRuntime, knowledgeComposeService } from '../src/knowledge-runtime.mjs';
import { resolveMemoRuntime, memoComposeService } from '../src/memo-runtime.mjs';
import { createPlatformProxy } from '../src/platform-proxy.mjs';
import { validateStorageStatusDestination } from '../src/storage/status.mjs';
import { deploymentOverrides } from '../src/deployment/integration.mjs';
import { docker } from '../src/deployment/controller.mjs';

export const SERVICES = Object.freeze({
  praxis: 4321, 'praxis-public': 14321, reminder: 4322, travel: 4323,
  knowledge: 4324, 'knowledge-public': 14324, tingproof: 5173,
  'tingproof-public': 15173, slides: 4666, 'slides-public': 14666, memo: 4325, finance: 4329, intelligence: 4330,
});
const workspace = fileURLToPath(new URL('../', import.meta.url));
const HELP = `Usage: npm run stack -- <command> [options]

Commands:
  plan                    Validate and print canonical bindings without writing
  build                   Build source-only images; no service is stopped
  up                      Build images, build private Slides assets, start detached
  assets                  Rebuild public Slides assets from its mounted deck data
  activate                Verify managed deployment and record canonical bindings
  down                    Stop this stack; preserve every data directory
  status [--json]         Show all application services and their health
  logs [service] [--follow] [--tail N]
  exec <service> -- <command> [arguments...]

Options: --config PATH, --apps-root PATH, --public-urls PATH,
         --source-mode copied|registered, --without-reminder
Example: npm run stack -- exec reminder -- node src/cli.js ls
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

async function resolveTravelBusinessRuntime(app, { registered, home, uid, protectedPaths, privateFiles, businessFile }) {
  if (app === undefined) return null;
  if (!app || typeof app !== 'object' || Array.isArray(app) || app.url !== 'http://127.0.0.1:4323/api/business' || !Array.isArray(app.spaces) || app.spaces.length !== 1 || typeof app.spaces[0] !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,199}$/.test(app.spaces[0])) throw new Error('Travel business runtime requires one explicit pilot space and its fixed local adapter.');
  protectedPaths = protectedPaths.filter(path => typeof path === 'string');
  privateFiles = privateFiles.filter(path => typeof path === 'string').map(path => resolve(path));
  const dataDir = absolutePath(app.dataDir, home), keyFile = absolutePath(app.keyFile, home), configFile = absolutePath(app.businessConfigFile, home);
  if (dataDir !== registered('travel', 'itineraries', 'directory')) throw new Error('Travel business data must match its registered travel/itineraries directory.');
  const overlaps = (left, right) => isWithin(left, right) || isWithin(right, left);
  const broad = ['/', '/tmp', '/var', '/var/lib', '/run', '/etc', '/opt', '/mnt', '/media', '/home', home];
  if ([dataDir, keyFile, configFile].some(path => /[\0\r\n$]/.test(path)) || broad.includes(dataDir) || dataDir.split('/').filter(Boolean).length < 3 || dataDir.split('/').some(part => ['.git', '.ssh', '.gnupg', '.aws', '.kube', '.docker'].includes(part)) || ['/proc', '/sys', '/dev', '/etc', '/usr', '/bin', '/sbin', '/lib', '/run'].some(root => isWithin(root, dataDir)) || privateFiles.some(path => isWithin(dataDir, path)) || [workspace, ...protectedPaths, dirname(keyFile), dirname(configFile), dirname(businessFile)].some(path => overlaps(dataDir, resolve(path)))) throw new Error('Travel business data requires a dedicated private directory outside source, credentials, controls and other applications.');
  const info = await lstat(dataDir).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
  if (!info?.isDirectory() || info.isSymbolicLink() || info.uid !== Number(uid) || (info.mode & 0o777) !== 0o700 || await realpath(dataDir) !== dataDir) throw new Error('The registered Travel business directory must already exist as a canonical private mode700 directory; no replacement will be created.');
  await access(dataDir, constants.R_OK | constants.W_OK);
  if (keyFile === configFile || [keyFile, configFile].some(path => privateFiles.includes(path))) throw new Error('Travel business credentials and mapping require separate files.');
  for (const [path, minimum, maximum] of [[keyFile, 32, 4096], [configFile, 2, 65536]]) {
    const file = await lstat(path).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
    const parent = await stat(dirname(path)).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
    if (!file?.isFile() || file.isSymbolicLink() || file.nlink !== 1 || file.uid !== Number(uid) || (file.mode & 0o777) !== 0o600 || file.size < minimum || file.size > maximum || !parent?.isDirectory() || parent.uid !== Number(uid) || (parent.mode & 0o077) !== 0 || await realpath(path) !== path || [workspace, ...protectedPaths].some(root => isWithin(resolve(root), path))) throw new Error('Travel business key and mapping require separate canonical private mode600 files outside source, data and controls.');
    await access(path, constants.R_OK);
  }
  let mapping;
  try { mapping = JSON.parse(await readFile(configFile, 'utf8')); } catch { throw new Error('Travel business mapping must be valid bounded JSON.'); }
  const space = app.spaces[0];
  const approvedTrips = new Set(['western-sichuan-2026', 'daxinganling-2026', 'changbaishan-2026']);
  const trips = mapping?.spaces?.[space];
  const validTrips = Array.isArray(trips) && trips.length >= 1 && trips.length <= approvedTrips.size && new Set(trips).size === trips.length && trips.every(id => approvedTrips.has(id));
  if (!mapping || typeof mapping !== 'object' || Array.isArray(mapping) || Object.keys(mapping).some(key => !['version', 'webSpace', 'spaces'].includes(key)) || mapping.version !== 1 || mapping.webSpace !== space || !mapping.spaces || typeof mapping.spaces !== 'object' || Array.isArray(mapping.spaces) || Object.keys(mapping.spaces).length !== 1 || !Object.hasOwn(mapping.spaces, space) || !validTrips) throw new Error('Travel business mapping must bind the single pilot space to the approved itinerary IDs.');
  return { dataDir, keyFile, configFile };
}

export async function resolveStackSettings({ env = process.env, home = homedir(), configPath, appsRoot, publicUrls, sourceMode, withoutReminder } = {}) {
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
  withoutReminder ??= config.dockerWithoutReminder === true;
  if (typeof withoutReminder !== 'boolean') throw new Error('Reminder exclusion must be explicit.');
  const registered = (id, target, kind) => {
    const sources = (config.appSources || []).filter(source => source.id === id && source.target === target);
    if (sources.length !== 1 || sources[0].kind !== kind) throw new Error(`One registered ${id}/${target} source is required.`);
    return absolutePath(sources[0].source, home);
  };
  const sourceMap = sourceMode === 'registered' || workingPaths ? {
    reminder: registered('reminder', 'checklist.json', 'json'),
    tingproof: registered('tingproof', 'tingproof.db', 'sqlite'),
    slidesDecks: registered('slides', 'decks', 'directory'),
    slidesState: registered('slides', '.lattice', 'directory'),
  } : { reminder: join(resolvedAppsRoot, 'reminder/checklist.json'), tingproof: join(resolvedAppsRoot, 'tingproof/tingproof.db'), slidesDecks: join(resolvedAppsRoot, 'slides/decks'), slidesState: join(resolvedAppsRoot, 'slides/.lattice') };
  if (sourceMode === 'registered' && !sourceMap.tingproof.endsWith('/tingproof.db')) throw new Error('The TingProof server requires its registered tingproof.db filename.');
  const publicUrlsFile = absolutePath(publicUrls || env.PRAXIS_PUBLIC_URLS_FILE || join(home, '.config/praxis/public-urls.json'), home);
  const projectName = env.PRAXIS_COMPOSE_PROJECT || `praxis-${config.workspaceId.toLowerCase().replace(/[^a-z0-9_-]/g, '-')}`;
  if (!/^[a-z0-9][a-z0-9_-]{0,120}$/.test(projectName)) throw new Error('PRAXIS_COMPOSE_PROJECT must be a safe lowercase Compose project name.');
  const uid = String(env.PRAXIS_UID || process.getuid?.() || 1000);
  const gid = String(env.PRAXIS_GID || process.getgid?.() || 1000);
  if (!/^[1-9]\d*$/.test(uid) || !/^[1-9]\d*$/.test(gid)) throw new Error('Containers must use a non-root UID and GID.');
  const bindAddress = env.PRAXIS_BIND_ADDRESS || '0.0.0.0';
  if (!/^(?:\d{1,3}\.){3}\d{1,3}$/.test(bindAddress) || bindAddress.split('.').some(part => Number(part) > 255)) throw new Error('PRAXIS_BIND_ADDRESS must be an IPv4 address.');
  const controlRoot = sourceMode === 'registered' ? join(dirname(configFile), 'docker-apps') : join(stateRoot, 'docker');
  const services = Object.fromEntries(Object.entries(SERVICES).filter(([name]) => !(withoutReminder && name === 'reminder')));
  if (workingPaths && env.PRAXIS_OBSERVATIONS_DIR && absolutePath(env.PRAXIS_OBSERVATIONS_DIR, home) !== workingPaths.observations) throw new Error('Observations must match the configured application working root.');
  const observationsDir = workingPaths?.observations || absolutePath(env.PRAXIS_OBSERVATIONS_DIR || join(dataRoot, 'observability'), home);
  let observationsOrigin = env.PRAXIS_OBSERVATIONS_ORIGIN ?? '';
  let consoleUpstream = '', consoleHost = '', consoleOrigin = '';
  let webGateway = false, originHost = '', canonicalUrl = '', shareManifestFile = '', travelBusiness = null, knowledgeBusiness = null, memoBusiness = null;
  const observationsProtectedPaths = [...(workingPaths ? Object.entries(workingPaths.roots).filter(([id]) => id !== 'praxis').map(([, path]) => path) : [resolvedAppsRoot]), stateRoot, controlRoot, configFile, publicUrlsFile, dirname(sourceMap.reminder), dirname(sourceMap.tingproof), sourceMap.slidesDecks, sourceMap.slidesState,
    ...(config.appSources || []).map(source => source.kind === 'directory' ? source.source : dirname(source.source)), ...(config.sourceRepos || []).map(repo => repo.path),
    ...(config.repositories || []).flatMap(repo => [repo.path, ...['passwordFile', 'credentialsFile', 'rcloneConfigFile'].map(key => repo[key] && dirname(repo[key]))]).filter(Boolean)];
  if (config.businessConfigFile) {
    const businessFile = absolutePath(config.businessConfigFile, home);
    const business = JSON.parse(await readFile(businessFile, 'utf8'));
    if (business.webGateway !== undefined && (!business.webGateway || typeof business.webGateway !== 'object' || Array.isArray(business.webGateway) || typeof business.webGateway.enabled !== 'boolean' || Object.keys(business.webGateway).some(key => !['enabled', 'originHost', 'shareManifestFile'].includes(key)))) throw new Error('The web gateway requires an explicit enabled setting and trusted origin host.');
    if (business.webGateway?.enabled === true) {
      originHost = business.webGateway.originHost;
      if (typeof originHost !== 'string' || originHost.length > 253 || !/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(originHost)) throw new Error('The web gateway origin host must be a fixed hostname without a port.');
      const issuer = new URL(observationsOriginSetting(business.issuer));
      webGateway = true; canonicalUrl = issuer.origin;
      consoleUpstream = 'http://127.0.0.1:4326'; consoleHost = issuer.host; consoleOrigin = issuer.origin;
      shareManifestFile = absolutePath(business.webGateway.shareManifestFile || join(home, '.config/praxis/web-gateway/travel-shares.json'), home);
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
    travelBusiness = await resolveTravelBusinessRuntime(business.apps?.travel, { registered, home, uid, businessFile, protectedPaths: [stateRoot, controlRoot, observationsDir, dirname(sourceMap.reminder), dirname(sourceMap.tingproof), sourceMap.slidesDecks, sourceMap.slidesState, ...(config.appSources || []).filter(source => source.id !== 'travel' || source.target !== 'itineraries').map(source => source.kind === 'directory' ? source.source : dirname(source.source)), ...(config.sourceRepos || []).map(repo => repo.path), ...(config.repositories || []).map(repo => repo.path)], privateFiles: [configFile, publicUrlsFile, businessFile, ...Object.entries(business.apps || {}).filter(([id]) => id !== 'travel').flatMap(([, app]) => [app.keyFile, app.spacesFile]), ...(config.repositories || []).flatMap(repo => [repo.passwordFile, repo.credentialsFile, repo.rcloneConfigFile])] });
    if (travelBusiness) sourceMap.travelItineraries = travelBusiness.dataDir;
    knowledgeBusiness = await resolveKnowledgeRuntime(business.apps?.knowledge, { uid, workspace, protectedPaths: [stateRoot, controlRoot, observationsDir, dirname(sourceMap.reminder), dirname(sourceMap.tingproof), sourceMap.slidesDecks, sourceMap.slidesState, ...(config.appSources || []).filter(source => source.id !== 'knowledge').map(source => source.kind === 'directory' ? source.source : dirname(source.source)), ...(config.sourceRepos || []).map(repo => repo.path), ...(config.repositories || []).map(repo => repo.path)], privateFiles: [configFile, publicUrlsFile, businessFile, ...Object.entries(business.apps || {}).filter(([id]) => id !== 'knowledge').flatMap(([, app]) => [app.keyFile, app.spacesFile, app.businessConfigFile]), ...(config.repositories || []).flatMap(repo => [repo.passwordFile, repo.credentialsFile, repo.rcloneConfigFile])] });
    if (knowledgeBusiness) sourceMap.knowledge = join(knowledgeBusiness.dataDir, 'knowledge.db');
    memoBusiness = await resolveMemoRuntime(business.apps?.memo, { uid, workspace, protectedPaths: [stateRoot, controlRoot, observationsDir, dirname(sourceMap.reminder), dirname(sourceMap.tingproof), sourceMap.slidesDecks, sourceMap.slidesState, ...(config.appSources || []).filter(source => source.id !== 'memo').map(source => source.kind === 'directory' ? source.source : dirname(source.source)), ...Object.entries(business.apps || {}).filter(([id]) => id !== 'memo').map(([, app]) => app.dataDir).filter(Boolean), ...(config.sourceRepos || []).map(repo => repo.path), ...(config.repositories || []).map(repo => repo.path)].filter(Boolean), privateFiles: [configFile, publicUrlsFile, businessFile, ...Object.entries(business.apps || {}).filter(([id]) => id !== 'memo').flatMap(([, app]) => [app.keyFile, app.spacesFile, app.businessConfigFile]).filter(Boolean)] });
    if (memoBusiness) sourceMap.memo = join(memoBusiness.dataDir, 'memo.db');
    if (business.observationsFile !== undefined && business.observationsFile !== join(observationsDir, 'observations.db')) throw new Error('Workbench and business observations must use the same configured database.');
  }
  observationsOrigin = observationsOriginSetting(observationsOrigin);
  await validateObservationsDirectory(observationsDir, { uid, protectedPaths: observationsProtectedPaths });
  if (shareManifestFile) await validateStorageStatusDestination(shareManifestFile, { protectedPaths: [...observationsProtectedPaths, observationsDir] });
  const candidate = absolutePath(env.PRAXIS_TRAVEL_AMAP_CONFIG || join(home, '.config/praxis/secrets/travel-amap.json'), home);
  const mapInfo = await lstat(candidate).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
  let travelMapConfigFile = '';
  if (mapInfo) {
    const parent = await stat(dirname(candidate));
    if (!mapInfo.isFile() || mapInfo.isSymbolicLink() || mapInfo.nlink !== 1 || mapInfo.uid !== Number(uid) || (mapInfo.mode & 0o777) !== 0o600 || parent.uid !== Number(uid) || (parent.mode & 0o077) !== 0 || await realpath(candidate) !== candidate || isWithin(workspace, candidate) || [resolvedAppsRoot, stateRoot, controlRoot, observationsDir, dirname(sourceMap.reminder), dirname(sourceMap.tingproof), sourceMap.slidesDecks, sourceMap.slidesState, ...(travelBusiness ? [travelBusiness.dataDir] : [])].some(path => isWithin(path, candidate))) throw new Error('Travel map credentials require a private canonical mode600 file outside source, data and runtime controls.');
    travelMapConfigFile = candidate;
  } else if (env.PRAXIS_TRAVEL_AMAP_CONFIG) throw new Error('The configured Travel map credential file is missing.');
  if (travelBusiness && [travelBusiness.keyFile, travelBusiness.configFile].includes(travelMapConfigFile)) throw new Error('Travel business bindings must remain separate from map credentials.');
  const fliggyCandidate = absolutePath(env.PRAXIS_TRAVEL_FLIGGY_CONFIG || join(home, '.config/praxis/secrets/travel-fliggy.json'), home);
  const fliggyInfo = await lstat(fliggyCandidate).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
  let travelFliggyConfigFile = '';
  if (fliggyInfo) {
    const parent = await stat(dirname(fliggyCandidate));
    const excluded = [configFile, publicUrlsFile, config.businessConfigFile, travelMapConfigFile, ...(travelBusiness ? [travelBusiness.keyFile, travelBusiness.configFile] : [])].filter(Boolean);
    if (!fliggyInfo.isFile() || fliggyInfo.isSymbolicLink() || fliggyInfo.nlink !== 1 || fliggyInfo.uid !== Number(uid) || (fliggyInfo.mode & 0o777) !== 0o600 || fliggyInfo.size < 2 || fliggyInfo.size > 16384 || parent.uid !== Number(uid) || (parent.mode & 0o077) !== 0 || await realpath(fliggyCandidate) !== fliggyCandidate || excluded.includes(fliggyCandidate) || isWithin(workspace, fliggyCandidate) || [resolvedAppsRoot, stateRoot, controlRoot, observationsDir, dirname(sourceMap.reminder), dirname(sourceMap.tingproof), sourceMap.slidesDecks, sourceMap.slidesState, ...(travelBusiness ? [travelBusiness.dataDir] : [])].some(path => isWithin(path, fliggyCandidate))) throw new Error('Travel Fliggy credentials require a separate private canonical mode600 file outside source, data and runtime controls.');
    travelFliggyConfigFile = fliggyCandidate;
  } else if (env.PRAXIS_TRAVEL_FLIGGY_CONFIG) throw new Error('The configured Travel Fliggy credential file is missing.');
  if (config.intelligencePreview !== undefined && typeof config.intelligencePreview !== 'boolean') throw new Error('intelligencePreview must be boolean.');
  const intelligencePreview = env.PRAXIS_INTELLIGENCE_PREVIEW ?? (config.intelligencePreview === false ? '0' : '1');
  if (!['0', '1'].includes(intelligencePreview)) throw new Error('PRAXIS_INTELLIGENCE_PREVIEW must be 0 or 1.');
  const sourceFingerprint = createHash('sha256').update(JSON.stringify(workingPaths ? { sourceMap, workingPaths, intelligencePreview } : { ...sourceMap, intelligencePreview })).digest('hex');
  return { intelligencePreview, config, configFile, workingPaths, workspaceId: config.workspaceId, appsRoot: resolvedAppsRoot, stateRoot, publicUrlsFile, projectName, uid, gid, bindAddress, appBindAddress: webGateway ? '127.0.0.1' : bindAddress, webGateway, originHost, canonicalUrl, shareManifestFile, gatewayOverrideFile: webGateway ? join(controlRoot, 'compose.gateway.yml') : '', travelMapConfigFile, travelFliggyConfigFile, travelBusiness, knowledgeBusiness, memoBusiness, travelMapOverrideFile: join(controlRoot, 'compose.travel-map.json'), sourceMode, withoutReminder, sourceMap, sourceFingerprint, services, observationsDir, observationsOrigin, observationsFile: join(observationsDir, 'observations.db'), observationsProtectedPaths, consoleUpstream, consoleHost, consoleOrigin, envFile: join(controlRoot, 'compose.env'), receiptFile: sourceMode === 'registered' ? join(controlRoot, 'activation.json') : join(stateRoot, 'docker-active.json') };
}

export function assertActiveWriter(settings) {
  const { deviceId, activeWriterDeviceId } = settings.config;
  if (!deviceId || !activeWriterDeviceId || deviceId !== activeWriterDeviceId) throw new Error('This device is not the active workspace writer. Activate it through the storage workflow before starting or changing app data.');
}

export async function validateData(settings) {
  const directories = [...new Set([dirname(settings.sourceMap.reminder), dirname(settings.sourceMap.tingproof), settings.sourceMap.slidesDecks, settings.sourceMap.slidesState])];
  for (const path of directories) {
    const info = await stat(path).catch(() => null);
    if (!info?.isDirectory()) throw new Error(`Required app data directory is missing: ${path}. Run storage bootstrap; no empty replacement will be created.`);
    if (settings.sourceMode === 'registered' && (await realpath(path) !== path || !(await lstat(path)).isDirectory() || ['/', '/home', '/tmp', homedir(), workspace.replace(/\/$/, '')].includes(path) || path.split('/').includes('.git') || (settings.config.sourceRepos || []).some(repo => repo.path === path || repo.path.startsWith(`${path}/`)))) throw new Error('Registered data directories must be precise canonical application paths.');
    await access(path, constants.R_OK | constants.W_OK);
    if (info.uid !== undefined && info.uid !== Number(settings.uid)) throw new Error(`App data directory must be owned by runtime UID ${settings.uid}: ${path}.`);
  }
  for (const path of [settings.sourceMap.reminder, settings.sourceMap.tingproof, join(settings.sourceMap.slidesDecks, 'registry.js')]) {
    const info = await stat(path).catch(() => null);
    if (!info?.isFile() || info.size === 0) throw new Error(`Required nonempty app data file is missing: ${path}. Refusing to initialize or replace data.`);
    if (settings.sourceMode === 'registered' && (await realpath(path) !== path || !(await lstat(path)).isFile())) throw new Error('Registered data files cannot use symbolic-link aliases.');
    await access(path, constants.R_OK | constants.W_OK);
  }
  if (settings.workingPaths?.intelligence) {
    const directory = settings.workingPaths.intelligence, info = await lstat(directory).catch(() => null);
    if (!info?.isDirectory() || info.isSymbolicLink() || await realpath(directory) !== directory || info.uid !== Number(settings.uid)) throw new Error('Intelligence requires its existing canonical application directory.');
    await access(directory, constants.R_OK);
  }
  if (settings.intelligencePreview === '0') {
    const root = settings.workingPaths?.intelligence;
    if (!root) throw new Error('Intelligence data mode requires its configured working directory.');
    const file = join(root, 'data.json'), info = await lstat(file).catch(() => null);
    if (!info?.isFile() || info.isSymbolicLink() || info.size === 0 || await realpath(file) !== file) throw new Error('Intelligence data mode requires an existing canonical data.json.');
    await access(file, constants.R_OK);
  }
  if (settings.workingPaths) {
    const { knowledgeContent, travelContent, finance } = settings.workingPaths;
    for (const directory of [knowledgeContent, travelContent, dirname(finance)]) {
      const info = await lstat(directory).catch(() => null);
      if (!info?.isDirectory() || info.isSymbolicLink() || await realpath(directory) !== directory || info.uid !== Number(settings.uid)) throw new Error('Configured content and Finance directories must already exist as canonical application paths.');
      await access(directory, constants.R_OK);
    }
    for (const file of [join(knowledgeContent, 'catalog/documents.json'), join(knowledgeContent, 'published/index.html'), join(knowledgeContent, 'published-standalone/index.html'), join(travelContent, 'catalog/trips.json'), join(travelContent, 'catalog/routes.json'), join(travelContent, 'catalog/photo-credits.json'), join(travelContent, 'published/index.html'), finance]) {
      const info = await lstat(file).catch(() => null);
      if (!info?.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size === 0 || await realpath(file) !== file) throw new Error('Configured application content or Finance data is missing or unsafe; no replacement will be created.');
      await access(file, constants.R_OK | (file === finance ? constants.W_OK : 0));
      if (file === finance && (info.uid !== Number(settings.uid) || (info.mode & 0o777) !== 0o600)) throw new Error('Finance data must be owned by the runtime user with mode600.');
    }
  }
  const publicInfo = await stat(settings.publicUrlsFile).catch(() => null);
  if (!publicInfo?.isFile() || !publicInfo.size) throw new Error(`Public launcher configuration is missing: ${settings.publicUrlsFile}.`);
  await access(settings.publicUrlsFile, constants.R_OK);
}

const quoteEnv = value => `'${String(value).replaceAll("'", "\\'")}'`;
export async function writeComposeEnvironment(settings) {
  const directory = dirname(settings.envFile);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
  const variables = {
    PRAXIS_INTELLIGENCE_PREVIEW: settings.intelligencePreview,
    PRAXIS_APPS_ROOT: settings.appsRoot, PRAXIS_PUBLIC_URLS_FILE: settings.publicUrlsFile,
    PRAXIS_REMINDER_DATA_DIR: dirname(settings.sourceMap.reminder), PRAXIS_TINGPROOF_DATA_DIR: dirname(settings.sourceMap.tingproof),
    PRAXIS_SLIDES_DECKS_DIR: settings.sourceMap.slidesDecks, PRAXIS_SLIDES_STATE_DIR: settings.sourceMap.slidesState,
    PRAXIS_COMPOSE_PROJECT: settings.projectName, PRAXIS_UID: settings.uid,
    PRAXIS_GID: settings.gid, PRAXIS_BIND_ADDRESS: settings.bindAddress,
    PRAXIS_APP_BIND_ADDRESS: settings.appBindAddress,
    PRAXIS_WEB_GATEWAY: settings.webGateway ? 'true' : 'false', PRAXIS_ORIGIN_HOST: settings.originHost,
    PRAXIS_CANONICAL_URL: settings.canonicalUrl, PRAXIS_TRAVEL_SHARES_FILE: settings.shareManifestFile,
    PRAXIS_OBSERVATIONS_DIR: settings.observationsDir,
    PRAXIS_OBSERVATIONS_ORIGIN: settings.observationsOrigin,
    PRAXIS_CONSOLE_UPSTREAM: settings.consoleUpstream,
    PRAXIS_CONSOLE_HOST: settings.consoleHost,
    PRAXIS_CONSOLE_ORIGIN: settings.consoleOrigin,
    PRAXIS_PUBLIC_BUSINESS_URL: settings.consoleOrigin ? `${settings.consoleOrigin}/business/` : '',
  };
  const temporary = `${settings.envFile}.${process.pid}.tmp`;
  await writeFile(temporary, Object.entries(variables).map(([key, value]) => `${key}=${quoteEnv(value)}`).join('\n') + '\n', { mode: 0o600 });
  await chmod(temporary, 0o600);
  await rename(temporary, settings.envFile);
  const travelEnvironment = {}, travelVolumes = [];
  if (settings.travelMapConfigFile) {
    Object.assign(travelEnvironment, { TRAVEL_AMAP_CONFIG: '/run/secrets/travel-amap.json', ...(settings.canonicalUrl ? { TRAVEL_AMAP_ORIGIN: settings.canonicalUrl } : {}) });
    travelVolumes.push({ type: 'bind', source: settings.travelMapConfigFile, target: '/run/secrets/travel-amap.json', read_only: true, bind: { create_host_path: false } });
  }
  if (settings.travelFliggyConfigFile) {
    travelEnvironment.TRAVEL_FLIGGY_CONFIG = '/run/secrets/travel-fliggy.json';
    travelVolumes.push({ type: 'bind', source: settings.travelFliggyConfigFile, target: '/run/secrets/travel-fliggy.json', read_only: true, bind: { create_host_path: false } });
  }
  if (settings.travelBusiness) {
    Object.assign(travelEnvironment, { TRAVEL_DATA_DIR: '/data/itineraries', TRAVEL_BUSINESS_KEY_FILE: '/run/secrets/travel-business-key', TRAVEL_BUSINESS_CONFIG_FILE: '/run/config/travel-business.json' });
    travelVolumes.push(...[
      { source: settings.travelBusiness.dataDir, target: '/data/itineraries', read_only: false },
      { source: settings.travelBusiness.keyFile, target: '/run/secrets/travel-business-key', read_only: true },
      { source: settings.travelBusiness.configFile, target: '/run/config/travel-business.json', read_only: true },
    ].map(binding => ({ type: 'bind', ...binding, bind: { create_host_path: false } })));
  }
  if (settings.workingPaths) {
    travelEnvironment.TRAVEL_CONTENT_ROOT = '/data/content';
    travelVolumes.push({ type: 'bind', source: settings.workingPaths.travelContent, target: '/data/content', read_only: true, bind: { create_host_path: false } });
  }
  const mapOverride = { services: { ...(travelVolumes.length ? { travel: { environment: travelEnvironment, volumes: travelVolumes } } : {}), ...(settings.knowledgeBusiness ? { 'knowledge-public': knowledgeComposeService(settings.knowledgeBusiness, { contentRoot: settings.workingPaths?.knowledgeContent }) } : {}), ...(settings.memoBusiness ? { memo: memoComposeService(settings.memoBusiness) } : {}) } };
  if (settings.workingPaths) {
    const bind = (source, target, read_only) => ({ type: 'bind', source, target, read_only, bind: { create_host_path: false } });
    mapOverride.services.knowledge = { command: ['node', '/opt/praxis/scripts/serve-static-app.mjs', '--root', '/data/content/published-standalone', '--port', '4324'], volumes: [bind(settings.workingPaths.knowledgeContent, '/data/content', true), bind(join(workspace, 'scripts/serve-static-app.mjs'), '/opt/praxis/scripts/serve-static-app.mjs', true), bind(join(workspace, 'src/image-cache.mjs'), '/opt/praxis/src/image-cache.mjs', true)] };
    if (!settings.knowledgeBusiness) mapOverride.services['knowledge-public'] = { environment: { KNOWLEDGE_CONTENT_ROOT: '/data/content', KNOWLEDGE_BASE_PATH: '/apps/knowledge/', KNOWLEDGE_STATIC_DIR: '/data/content/published', KNOWLEDGE_DATA_DIR: '/data/knowledge' }, volumes: [bind(settings.workingPaths.knowledgeContent, '/data/content', true), bind(settings.workingPaths.knowledge, '/data/knowledge', false)] };
    if (settings.workingPaths.intelligence) {
      mapOverride.services.intelligence = { environment: { INTELLIGENCE_DATA_DIR: '/data/intelligence' }, volumes: [bind(settings.workingPaths.intelligence, '/data/intelligence', true)] };
    }
    mapOverride.services.finance = { volumes: [bind(dirname(settings.workingPaths.finance), '/data', false)] };
  }
  const temporaryMap = `${settings.travelMapOverrideFile}.${process.pid}.tmp`;
  await writeFile(temporaryMap, JSON.stringify(mapOverride, null, 2) + '\n', { mode: 0o600 });
  await chmod(temporaryMap, 0o600); await rename(temporaryMap, settings.travelMapOverrideFile);
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
  for (let index = 0; index < args.length && args[index] !== '--'; index++) {
    if (args[index] === '--defer-deployment-facade') { options.deferDeploymentFacade = true; args.splice(index, 1); index--; continue; }
    if (args[index] === '--without-reminder') { options.withoutReminder = true; args.splice(index, 1); index--; continue; }
    const key = { '--config': 'configPath', '--apps-root': 'appsRoot', '--public-urls': 'publicUrls', '--source-mode': 'sourceMode' }[args[index]];
    if (!key) continue;
    if (!args[index + 1] || args[index + 1].startsWith('--')) throw new Error(`Missing value for ${args[index]}.`);
    options[key] = args[index + 1]; args.splice(index, 2); index--;
  }
  const command = args.shift() || 'help';
  if (['help', '--help', '-h'].includes(command)) { (dependencies.print || console.log)(HELP); return; }
  if (!['plan', 'build', 'up', 'activate', 'assets', 'down', 'status', 'logs', 'exec'].includes(command)) throw new Error(`Unknown stack command: ${command}.`);
  const env = dependencies.env || process.env;
  const settings = await resolveStackSettings({ ...options, env, home: dependencies.home });
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
        if (args.length || !project.services.includes('slides-public')) throw new Error('assets requires the registered Slides public service.');
        const prepare = "import{mkdir}from'node:fs/promises';import{existsSync}from'node:fs';const app=existsSync('/app/package.json')?'/app':'/workspace/third_party/lattice';process.env.PRAXIS_LATTICE_ROOT=process.env.SLIDES_PROJECT_ROOT=app;for(const name of ['viewer','workbench','business'])await mkdir(app+'/.lattice/runtime/'+name,{recursive:true});await import(existsSync('/opt/praxis/scripts/build-slides-public.mjs')?'/opt/praxis/scripts/build-slides-public.mjs':'/workspace/scripts/build-slides-public.mjs')";
        operation = ['run', '--rm', '-T', '--interactive=false', '--no-deps', '--entrypoint', 'node', 'slides-public', '--input-type=module', '-e', prepare];
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
    const status = { ...installationStatus(output, project, SERVICES), workspaceId: settings.workspaceId, sourceMode: 'registered', sourceFingerprint: settings.sourceFingerprint };
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
  if (command !== 'status' || await lstat(settings.travelMapOverrideFile).catch(error => { if (error.code === 'ENOENT') return null; throw error; })) prefix.push('--file', settings.travelMapOverrideFile);
  if (env.PRAXIS_COMPOSE_EXTRA_FILE) prefix.push('--file', absolutePath(env.PRAXIS_COMPOSE_EXTRA_FILE, dependencies.home || homedir()));
  const deployment = await deploymentOverrides(settings.configFile, env);
  if (deployment) prefix.push('--file', deployment.apps);
  for (const profile of (env.PRAXIS_COMPOSE_PROFILES || '').split(',').filter(Boolean)) {
    if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(profile)) throw new Error('Compose profile names must be safe identifiers.');
    prefix.push('--profile', profile);
  }
  const composeEnv = { ...env, PRAXIS_APPS_ROOT: settings.appsRoot, PRAXIS_PUBLIC_URLS_FILE: settings.publicUrlsFile, PRAXIS_COMPOSE_PROJECT: settings.projectName, PRAXIS_UID: settings.uid, PRAXIS_GID: settings.gid, PRAXIS_BIND_ADDRESS: settings.bindAddress,
    PRAXIS_REMINDER_DATA_DIR: dirname(settings.sourceMap.reminder), PRAXIS_TINGPROOF_DATA_DIR: dirname(settings.sourceMap.tingproof), PRAXIS_SLIDES_DECKS_DIR: settings.sourceMap.slidesDecks, PRAXIS_SLIDES_STATE_DIR: settings.sourceMap.slidesState, PRAXIS_OBSERVATIONS_DIR: settings.observationsDir, PRAXIS_OBSERVATIONS_ORIGIN: settings.observationsOrigin,
    PRAXIS_CONSOLE_UPSTREAM: settings.consoleUpstream, PRAXIS_CONSOLE_HOST: settings.consoleHost, PRAXIS_CONSOLE_ORIGIN: settings.consoleOrigin, PRAXIS_PUBLIC_BUSINESS_URL: settings.consoleOrigin ? `${settings.consoleOrigin}/business/` : '', PRAXIS_APP_BIND_ADDRESS: settings.appBindAddress, PRAXIS_WEB_GATEWAY: settings.webGateway ? 'true' : 'false', PRAXIS_ORIGIN_HOST: settings.originHost, PRAXIS_CANONICAL_URL: settings.canonicalUrl, PRAXIS_TRAVEL_SHARES_FILE: settings.shareManifestFile };
  const compose = (tail, extra = {}) => run('docker', [...prefix, ...tail], { env: composeEnv, cwd: root, ...extra });
  const inspect = async () => {
    const raw = await compose(['ps', '--all', '--format', 'json'], { capture: true });
    const status = serviceStatus(raw, settings.services);
    if (settings.withoutReminder && serviceStatus(raw).services.some(service => service.name === 'reminder' && service.state === 'running')) throw new Error('A duplicate Reminder is still running in the base project. Stop it before using the business profile.');
    return { projectName: settings.projectName, workspaceId: settings.workspaceId, sourceMode: settings.sourceMode, sourceFingerprint: settings.sourceFingerprint, ...status };
  };
  const assets = async () => {
    const prepare = "import{mkdir}from'node:fs/promises';import{existsSync}from'node:fs';const app=existsSync('/app/package.json')?'/app':'/workspace/third_party/lattice';process.env.PRAXIS_LATTICE_ROOT=process.env.SLIDES_PROJECT_ROOT=app;for(const name of ['viewer','workbench','business'])await mkdir(app+'/.lattice/runtime/'+name,{recursive:true});await import(existsSync('/opt/praxis/scripts/build-slides-public.mjs')?'/opt/praxis/scripts/build-slides-public.mjs':'/workspace/scripts/build-slides-public.mjs')";
    await compose(['run', '--rm', '-T', '--interactive=false', '--no-deps', '--entrypoint', 'node', 'slides-public', '--input-type=module', '-e', prepare]);
  };
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
    if (!Object.hasOwn(SERVICES, service)) throw new Error('exec requires a known service name.');
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
      } else if (Object.hasOwn(SERVICES, argument)) tail.push(argument);
      else throw new Error(`Unknown logs argument: ${argument}.`);
    }
    await compose(tail);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error(`Stack failed: ${error.message}`); process.exitCode = 1; });
}
