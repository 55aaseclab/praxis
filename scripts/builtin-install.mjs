import { DEFAULT_APP_REGISTRY } from '../src/default-app-registry.mjs';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { access, chown, chmod, copyFile, lstat, mkdir, open, readFile, readdir, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { resolve, isAbsolute, dirname } from 'node:path';
import { AuthStore } from '../src/business/auth.mjs';
import { readApps } from '../src/apps.mjs';
import { AppProviderRegistry } from '../src/business/app-providers.mjs';

const declarations = registry => registry.apps.map(app => ({ app, deployment: app.integration?.deployment || {}, business: app.integration?.business }));
const defaultDeclarations = declarations(DEFAULT_APP_REGISTRY);
const adapters = Object.fromEntries(defaultDeclarations.filter(({ deployment, business }) => business && deployment.adapterPort).map(({ business, deployment }) => [business.adapterId, deployment.adapterPort]));
const apps = [...new Set(['web', ...defaultDeclarations.flatMap(({ deployment }) => deployment.volumes || [])])];
const runtimeDeclarations = defaultDeclarations.filter(({ deployment }) => deployment.dataId && Object.keys(deployment.runtime || {}).length);

export function renderAppRecipe(value, parameters) {
  if (typeof value === 'string') {
    const rendered = value.replace(/\$\{([A-Za-z][A-Za-z0-9]*)\}/g, (_, key) => {
      if (!Object.hasOwn(parameters, key) || !['string', 'number'].includes(typeof parameters[key])) throw new Error('An app recipe references an unknown parameter.');
      return String(parameters[key]);
    });
    if (rendered.includes('${')) throw new Error('An app recipe contains an unsupported parameter.');
    return rendered;
  }
  if (Array.isArray(value)) return value.map(item => renderAppRecipe(item, parameters));
  if (value && typeof value === 'object') {
    const entries = Object.entries(value).map(([key, item]) => [renderAppRecipe(key, parameters), renderAppRecipe(item, parameters)]);
    if (new Set(entries.map(([key]) => key)).size !== entries.length) throw new Error('App recipe keys collide after parameter substitution.');
    return Object.fromEntries(entries);
  }
  if (value === null || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value)) return value;
  throw new Error('App recipes must contain JSON-compatible values.');
}

// These are bootstrap layout declarations, never observed host/container mounts.
// Include only data-location variables explicitly owned by installed providers.
export function builtinProviderDefaults({ providers, runtime, spaceMaps = {}, workingDirectories = {}, appTargets = {}, ownerId, registry = DEFAULT_APP_REGISTRY }) {
  const result = {}, definitions = declarations(registry);
  if (ownerId !== undefined && (typeof ownerId !== 'string' || !/^[A-Za-z0-9_.:-]{1,200}$/.test(ownerId))) throw new Error('The private document owner is invalid.');
  for (const { app, deployment } of definitions) {
    if (ownerId !== undefined && app.integration.web.policy === 'document-owner') result[app.id] = { ownerId };
    if (!deployment.provider) continue;
    const selectedRuntime = runtime[deployment.dataId || app.id] || {};
    let port = deployment.provider.port;
    for (const name of deployment.provider.portEnvs || []) if (selectedRuntime[name] !== undefined) { port = selectedRuntime[name]; break; }
    if (!/^[1-9][0-9]{0,4}$/.test(String(port)) || Number(port) > 65535) throw new Error('A configured native application port is invalid.');
    result[app.id] = { ...result[app.id], url: 'http://127.0.0.1:' + port };
    if (appTargets[app.id] !== undefined) {
      const target = new URL(appTargets[app.id]);
      if (target.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname) || target.username || target.password || target.pathname !== '/' || target.search || target.hash) throw new Error('A saved native application target is invalid.');
      result[app.id].url = target.origin;
    }
  }
  for (const provider of providers) {
    if (provider.error || !provider.descriptor) continue;
    const { app, descriptor } = provider, adapterId = descriptor.adapterAppId || app.id;
    const configured = runtime[adapterId];
    if (!configured) continue;
    const environment = {}, pathMaps = {};
    for (const source of descriptor.dataSources) {
      const location = source.location || {}, name = location.env;
      if (!name) continue;
      if (!/^[A-Z][A-Z0-9_]{0,119}$/.test(name) || /(?:^|_)(?:KEY|PASSWORD|PASSWD|SECRET|TOKEN|CREDENTIALS?)(?:_|$)/i.test(name)) throw new Error('An app provider declared an unsafe data-location variable.');
      const value = configured[name];
      if (typeof value === 'string' && isAbsolute(value) && resolve(value) === value && !/[\x00-\x1f\x7f]/.test(value)) environment[name] = value;
      const map = spaceMaps[adapterId]?.spaces;
      if (location.map === 'spaces' && map && !Array.isArray(map) && typeof map === 'object') {
        const entries = Object.entries(map);
        if (entries.some(([, path]) => typeof path !== 'string' || !isAbsolute(path) || resolve(path) !== path || /[\x00-\x1f\x7f]/.test(path))) throw new Error('An app data-path mapping is invalid.');
        pathMaps[name] = Object.fromEntries(entries);
      }
    }
    if (!Object.keys(environment).length && !Object.keys(pathMaps).length && !workingDirectories[adapterId]) continue;
    result[app.id] = { ...result[app.id], runtime: { status: 'ready', bindingSource: 'installation-layout', environment,
      ...(workingDirectories[adapterId] ? { workingDirectory: workingDirectories[adapterId] } : {}),
      ...(Object.keys(pathMaps).length ? { pathMaps } : {}) } };
  }
  return result;
}

const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export function mergeMissingProviderConfiguration(config, defaults) {
  if (!plain(config) || !plain(defaults)) throw new Error('Invalid provider configuration.');
  const fill = (existing, proposed) => {
    if (!plain(existing) || !plain(proposed)) return existing;
    const output = { ...existing };
    for (const [key, value] of Object.entries(proposed)) {
      const selected = Object.hasOwn(existing, key) ? fill(existing[key], value) : structuredClone(value);
      Object.defineProperty(output, key, { value: selected, enumerable: true, configurable: true, writable: true });
    }
    return output;
  };
  return { ...config, appProviders: Object.hasOwn(config, 'appProviders') ? fill(config.appProviders, defaults) : structuredClone(defaults) };
}
async function readPrivateConfiguration(file) {
  if (!isAbsolute(file) || resolve(file) !== file || await realpath(dirname(file)) !== dirname(file)) throw new Error('A private configuration path is unsafe.');
  const info = await lstat(file);
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.mode & 0o077 || info.size > 2 * 1024 * 1024) throw new Error('A private configuration file is unsafe.');
  const bytes = await readFile(file); let value;
  try { value = JSON.parse(bytes.toString('utf8')); } catch { throw new Error('A private configuration file is invalid.'); }
  if (!plain(value)) throw new Error('A private configuration file is invalid.');
  return { bytes, value };
}
export async function upgradeBuiltinProviderConfiguration(file, defaults) {
  const { bytes, value } = await readPrivateConfiguration(file);
  const updated = mergeMissingProviderConfiguration(value, defaults);
  if (JSON.stringify(updated) === JSON.stringify(value)) return { changed: false, backupFile: null };
  const backupFile = file + '.before-providers-' + createHash('sha256').update(bytes).digest('hex').slice(0, 16) + '.json';
  try { await writeFile(backupFile, bytes, { flag: 'wx', mode: 0o600 }); }
  catch (error) { if (error.code !== 'EEXIST') throw error; const backup = await readPrivateConfiguration(backupFile); if (!backup.bytes.equals(bytes)) throw new Error('A provider configuration backup differs.'); }
  const temporary = resolve(dirname(file), '.provider-config-' + randomUUID() + '.tmp'); let handle;
  try {
    handle = await open(temporary, 'wx', 0o600); await handle.writeFile(JSON.stringify(updated, null, 2) + '\n'); await handle.sync(); await handle.close(); handle = null;
    if (!(await readFile(file)).equals(bytes)) throw new Error('Configuration changed during provider upgrade.');
    await rename(temporary, file);
  } finally { await handle?.close(); await rm(temporary, { force: true }); }
  return { changed: true, backupFile };
}

async function exists(file) {
  try { await access(file); return true; }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}
async function privateJson(file, value) {
  if (await exists(file)) {
    const info = await lstat(file);
    if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.mode & 0o077) throw new Error('A private runtime file is unsafe.');
    try { return JSON.parse(await readFile(file, 'utf8')); } catch { throw new Error('A private runtime file contains invalid JSON.'); }
  }
  await writeFile(file, JSON.stringify(value, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  return value;
}
async function mirrorKey(app, complete) {
  const core = '/config/keys/' + app + '.key';
  const native = '/app-config/' + app + '/key';
  let key;
  if (await exists(core)) key = await readFile(core);
  else if (await exists(native)) key = await readFile(native);
  else {
    if (complete) throw new Error('A service key is missing. Restore the private configuration backup.');
    key = randomBytes(48);
  }
  if (key.length < 32) throw new Error('Invalid service key.');
  for (const file of [core, native]) {
    if (await exists(file)) {
      if (!(await readFile(file)).equals(key)) throw new Error('Service keys differ. Restore a consistent configuration.');
    } else await writeFile(file, key, { mode: 0o600, flag: 'wx' });
  }
}
async function prepareVolumes() {
  const uid = Number(process.env.PRAXIS_UID || 1000), gid = Number(process.env.PRAXIS_GID || 1000);
  if (![uid, gid].every(id => Number.isSafeInteger(id) && id > 0 && id <= 2147483647)) throw new Error('Use a non-root service account UID and GID.');
  const roots = ['/config', '/data/core', ...apps.map(app => '/data/' + app),
    ...['web', ...runtimeDeclarations.map(({ deployment }) => deployment.dataId)].map(app => '/app-config/' + app)];
  for (const root of roots) {
    await mkdir(root, { recursive: true, mode: 0o700 });
    const info = await lstat(root);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('A runtime volume is invalid.');
    if (process.getuid?.() === 0 && info.uid === 0) {
      if ((await readdir(root)).length) throw new Error('A root-owned volume contains existing data. Use the recovery workflow.');
      await chown(root, uid, gid);
    } else if (info.uid !== uid || info.gid !== gid) throw new Error('A volume has another service owner. Restore the correct UID and GID.');
  }
  if (process.getuid?.() === 0) { process.setgid(gid); process.setuid(uid); }
}
export async function initializeBuiltins({ origin = process.env.PRAXIS_CANONICAL_URL || 'http://127.0.0.1:' + (process.env.PRAXIS_PORT || '4321'), username = process.env.PRAXIS_OWNER_USERNAME || 'owner' } = {}) {
  const url = new URL(origin);
  if (url.origin !== origin || url.username || url.password || !['http:', 'https:'].includes(url.protocol)
      || url.protocol === 'http:' && !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) {
    throw new Error('Use an HTTPS origin or a loopback HTTP origin.');
  }
  await prepareVolumes();
  const complete = await exists('/config/initialized.json');
  if (!await exists('/config/installation.json')) {
    for (const app of ['core', ...apps]) {
      if ((await readdir('/data/' + app)).length) throw new Error('Existing application data needs its original installation configuration. Restore it before startup.');
    }
    if ((await readdir('/config')).length) throw new Error('Existing private configuration requires recovery.');
  }
  if (!await exists('/config/core.json') && await exists('/config/business.json')) {
    await copyFile('/config/business.json', '/config/core.json');
    await chmod('/config/core.json', 0o600);
  }
  if (complete) {
    for (const file of ['/config/installation.json', '/config/owner.json', '/config/core.json']) {
      if (!await exists(file)) throw new Error('Installation configuration is missing. Restore the private backup.');
    }
  }
  const installation = await privateJson('/config/installation.json', {
    version: 1, origin, ownerId: randomUUID(), spaceId: randomUUID(), workspaceId: randomUUID(),
  });
  if (installation.version !== 1 || installation.origin !== origin) throw new Error('The installation origin changed. Use the documented migration procedure.');
  await mkdir('/config/keys', { recursive: true, mode: 0o700 });
  if (complete) {
    const required = ['/app-config/web/installation.json'];
    for (const { deployment } of runtimeDeclarations) required.push('/app-config/' + deployment.dataId + '/runtime.json');
    for (const { deployment } of runtimeDeclarations) if (deployment.spaces) required.push('/app-config/' + deployment.dataId + '/spaces.json');
    for (const file of required) if (!await exists(file)) throw new Error('Application configuration is missing. Restore the private backup.');
  }
  const credentials = await privateJson('/config/owner.json', {
    username, password: randomBytes(24).toString('base64url'), loginUrl: origin + '/auth/login',
  });
  const { spaceId, ownerId, workspaceId } = installation;
  for (const app of ['core', ...apps]) {
    const marker = '/data/' + app + '/.praxis-volume.json';
    if (complete && !await exists(marker)) throw new Error('An application volume is missing. Restore its original data.');
    const binding = await privateJson(marker, { workspaceId, app });
    if (binding.workspaceId !== workspaceId || binding.app !== app) throw new Error('A volume belongs to another installation.');
  }
  const config = {
    issuer: origin, database: '/data/core/auth.db', eventsDatabase: '/data/core/events.db',
    observationsFile: '/data/core/observations.db',
    allowedHosts: [url.host, '127.0.0.1:4326', 'localhost:4326'],
    allowedOrigins: [origin], webGateway: { enabled: true, originHost: 'localhost' },
    apps: Object.fromEntries(Object.entries(adapters).map(([app, port]) => [app, {
      url: 'http://127.0.0.1:' + port + '/api/business',
      keyFile: '/config/keys/' + app + '.key', spaces: [spaceId], managed: true,
      ...renderAppRecipe(defaultDeclarations.find(value => value.business?.adapterId === app)?.deployment.businessBindings || {}, { origin, originHost: url.host, spaceId, ownerId, workspaceId }),
    }])),
  };
  for (const app of Object.keys(adapters)) await mirrorKey(app, complete);
  const webInstallation = await privateJson('/app-config/web/installation.json', installation);
  const parameters = { origin, originHost: url.host, spaceId, ownerId, workspaceId, now: new Date().toISOString() };
  const runtime = Object.fromEntries(runtimeDeclarations.map(({ deployment }) => [deployment.dataId, renderAppRecipe(deployment.runtime, parameters)]));
  const maps = Object.fromEntries(runtimeDeclarations.filter(({ deployment }) => deployment.spaces).map(({ deployment }) => [deployment.dataId, renderAppRecipe(deployment.spaces, parameters)]));
  const configuredRuntime = {}, configuredMaps = {}, workingDirectories = {};
  for (const [app, env] of Object.entries(runtime)) {
    configuredRuntime[app] = await privateJson('/app-config/' + app + '/runtime.json', env);
    workingDirectories[app] = '/app';
    if (maps[app]) configuredMaps[app] = await privateJson('/app-config/' + app + '/spaces.json', maps[app]);
  }
  for (const { app, deployment } of defaultDeclarations) {
    if (!deployment.privateDocuments) continue;
    const { directory, environment } = deployment.privateDocuments;
    if (complete && !await exists(directory)) throw new Error('A private document directory is missing. Restore its original data.');
    await mkdir(directory, { recursive: true, mode: 0o700 });
    configuredRuntime[app.id] = { [environment]: directory }; workingDirectories[app.id] = '/workspace';
  }
  const providers = await new AppProviderRegistry({ root: DEFAULT_APP_REGISTRY.root }).providers();
  const existingCore = await exists('/config/core.json') ? (await readPrivateConfiguration('/config/core.json')).value : null;
  config.appProviders = builtinProviderDefaults({ providers, runtime: configuredRuntime, spaceMaps: configuredMaps, workingDirectories, appTargets: existingCore?.webGateway?.appTargets || {}, ownerId: webInstallation.ownerId });
  if (existingCore) await upgradeBuiltinProviderConfiguration('/config/core.json', config.appProviders);
  else await privateJson('/config/core.json', config);
  for (const { deployment } of defaultDeclarations) for (const initial of deployment.initialFiles || []) {
    if (!deployment.dataId || typeof initial.path !== 'string' || initial.path.startsWith('/') || initial.path.split('/').some(part => !part || part === '.' || part === '..')) throw new Error('An app initial file path is invalid.');
    const file = '/data/' + deployment.dataId + '/' + initial.path;
    if (complete && !await exists(file)) throw new Error('Application data is missing. Restore its original snapshot.');
    await mkdir(dirname(file), { recursive: true, mode: 0o700 });
    await privateJson(file, renderAppRecipe(initial.value, parameters));
  }
  if (!complete) {
    const auth = new AuthStore({ file: config.database, issuer: origin });
    try {
      const user = auth.db.prepare('SELECT id FROM auth_users WHERE id=?').get(ownerId);
      if (!user) auth.createUser({ id: ownerId, username: credentials.username, password: credentials.password });
      const space = auth.db.prepare('SELECT id FROM auth_spaces WHERE id=?').get(spaceId);
      if (!space) auth.createSpace({ id: spaceId, type: 'personal', ownerId });
      auth.setPlatformAdmin({ userId: ownerId, enabled: true });
      const catalog = await readApps(DEFAULT_APP_REGISTRY.root, { publicUrlsFile: null });
      auth.setWebAccess({ userId: ownerId, apps: catalog.filter(app => DEFAULT_APP_REGISTRY.getApp(app.id)?.integration.web.policy === 'grant').map(app => app.id), workbench: true, prds: true });
    } finally { auth.close(); }
    await privateJson('/config/initialized.json', { version: 1, initializedAt: new Date().toISOString() });
  }
  return { workspaceId, status: 'ready' };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (process.argv[2] === 'credentials') console.log(await readFile('/config/owner.json', 'utf8'));
    else console.log(JSON.stringify(await initializeBuiltins()));
  } catch (error) {
    console.error('Installation initialization failed: ' + error.message);
    process.exitCode = 1;
  }
}
