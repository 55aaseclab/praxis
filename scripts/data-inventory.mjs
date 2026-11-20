import { DEFAULT_APP_REGISTRY } from '../src/default-app-registry.mjs';
import { assertAppBindings, resolveAppPaths } from '../src/storage/app-paths.mjs';
import { constants } from 'node:fs';
import { open, lstat, realpath, mkdir, chmod, writeFile, rename } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { validateDataInventory } from '../src/business/data-inventory.mjs';
import { readApps } from '../src/apps.mjs';

const repository = fileURLToPath(new URL('../', import.meta.url)).replace(/\/$/, '');
const exec = promisify(execFile);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const inside = (parent, child) => child === parent || child.startsWith(parent + '/');
const canonical = value => typeof value === 'string' && isAbsolute(value) && resolve(value) === value && !/[\\\x00-\x1f\x7f?#]/.test(value);
const safePath = value => canonical(value) && !/(?:^|\/)(?:\.env(?:\.[^/]*)?|auth\.json|(?:credentials|secrets?|passwords?|tokens?)(?:\.[^/]*)?|\.git|\.ssh|\.gnupg|\.aws|\.kube|\.docker|\.codex|id_rsa|id_ed25519)(?:\/|$)|\.(?:pem|key|p12|pfx|kdbx)$/i.test(value);
const paths = mapping => object(mapping?.spaces) ? Object.values(mapping.spaces).filter(safePath) : [];

/** Project configured locations only; never open application records or databases. */
export function createDataInventory({ registry = [], business = {}, storage = {}, integrations = DEFAULT_APP_REGISTRY, sourceRoot = repository, now = Date.now(), ...inputs } = {}) {
  const applications = Array.isArray(registry) ? registry.filter(app => app?.kind === 'app').map(({ id, name, source }) => ({ id, name, source })) : [];
  for (const app of integrations.apps) {
    const key = app.integration.storage?.inventory?.includeWithInput;
    if (key && object(inputs[key]) && !applications.some(entry => entry.id === app.id)) applications.push({ id: app.id, name: app.name, source: app.source });
  }
  if (!applications.some(app => app.id === 'praxis')) applications.push({ id: 'praxis', name: 'Praxis' });
  const workspaceId = typeof storage.workspaceId === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(storage.workspaceId) ? storage.workspaceId : null;
  const working = storage.workingData ? resolveAppPaths(storage, { registry: integrations }) : null;
  const sources = Array.isArray(storage.appSources) ? storage.appSources : [];
  const configuredApps = object(business.apps) ? business.apps : {};
  const apps = applications.map(app => {
    const definition = integrations.getApp(app.id)?.integration;
    const id = definition?.storage?.sourceId || definition?.business?.adapterId || app.id;
    const config = object(configuredApps[id]) ? configuredApps[id] : {};
    const locations = [];
    const add = location => {
      if (location.hostPath !== undefined && !safePath(location.hostPath)) return;
      if (locations.some(item => item.kind === location.kind && item.hostPath === location.hostPath && item.containerPath === location.containerPath && item.storageKey === location.storageKey && item.volumeName === location.volumeName)) return;
      locations.push(location);
    };
    const file = (label, kind, hostPath, description) => { if (safePath(hostPath)) add({ label, kind, hostPath, ...(description ? { description } : {}) }); };
    const source = (label, suffix, description) => {
      const root = typeof app.source === 'string' && !isAbsolute(app.source) ? resolve(sourceRoot, app.source) : null;
      if (root && inside(sourceRoot, root)) file(label, 'source', join(root, suffix), description);
    };
    if (id === 'praxis') {

      file('用户、权限与授权', 'sqlite', business.database);
      file('事件与同步元数据', 'sqlite', business.eventsDatabase);
      file('体验与性能日志', 'sqlite', business.observationsFile);
    } else {
      const projection = integrations.getApp(app.id)?.integration.storage?.inventory?.project;
      projection?.({ id, config, working, workspaceId, storage, ...inputs, locations, add, file, source, safePath, paths, object });
    }
    for (const record of sources.filter(item => item?.id === id && !definition?.storage?.inventory?.omitRegisteredSources)) {
      const kind = ['json', 'sqlite', 'directory'].includes(record.kind) ? record.kind : 'unknown';
      const label = definition?.storage?.inventory?.sourceLabels?.[record.target] || '已登记数据';
      file(label, kind, record.source);
    }
    if (!locations.length) add({ label: '数据位置', kind: 'unknown', description: '尚未登记可核实的数据位置。' });
    return { id: app.id, name: app.name, locations };
  });
  const workspaceRoot = workspaceId && safePath(storage.dataRoot) ? join(storage.dataRoot, 'workspaces', workspaceId) : null;
  return validateDataInventory({ schemaVersion: 1, generatedAt: new Date(typeof now === 'function' ? now() : now).toISOString(), ...(workspaceRoot && safePath(workspaceRoot) ? { workspaceRoot } : {}), apps });
}

async function readMetadata(file, { optional = false, privateFile = true, maximum = 262144 } = {}) {
  let handle;
  try {
    if (!canonical(file) || await realpath(dirname(file)) !== dirname(file)) throw new Error('Metadata paths must be canonical.');
    handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
    const info = await handle.stat();
    if (!info.isFile() || info.nlink !== 1 || info.size > maximum || privateFile && (info.uid !== (process.getuid?.() ?? 1000) || info.mode & 0o077)) throw new Error('Metadata requires bounded private regular files.');
    const bytes = Buffer.alloc(maximum + 1); let size = 0;
    while (size < bytes.length) { const part = await handle.read(bytes, size, bytes.length - size, null); if (!part.bytesRead) break; size += part.bytesRead; }
    if (size > maximum) throw new Error('Metadata exceeds its size limit.');
    return JSON.parse(bytes.subarray(0, size).toString('utf8'));
  } catch (error) { if (optional && error.code === 'ENOENT') return undefined; throw error; }
  finally { await handle?.close(); }
}

async function dockerOutput(args) {
  const { stdout } = await exec('docker', args, { encoding: 'utf8', timeout: 5000, maxBuffer: 262144 });
  return stdout;
}
export async function inspectInventoryInput(key, storage, runDocker = dockerOutput, integrations = DEFAULT_APP_REGISTRY) {
  const inspection = integrations.apps.map(app => app.integration.storage?.inventory?.inspection).find(value => value?.input === key);
  return inspection?.read(storage, runDocker, safePath);
}
// Named CLI compatibility exports delegate to the currently installed app declaration.
export const inspectFinanceMounts = (...args) => inspectInventoryInput('financeMounts', ...args);
export const inspectIntelligenceRuntime = (...args) => inspectInventoryInput('intelligenceRuntime', ...args);

async function publish(file, value, { sourceRoot, inputFiles }) {
  if (!safePath(file) || inside(sourceRoot, file) || !/^[a-z][a-z0-9-]{0,63}\.json$/.test(file.split('/').at(-1))) throw new Error('Inventory requires a private JSON destination outside source.');
  const directory = dirname(file);
  const protectedPaths = [...inputFiles, ...value.apps.flatMap(app => app.locations.filter(item => item.hostPath).map(item => ['directory', 'source', 'cache'].includes(item.kind) ? item.hostPath : dirname(item.hostPath)))];
  if (['/', '/tmp', '/home', '/var', '/opt', homedir()].includes(directory) || protectedPaths.some(path => canonical(path) && (inside(path, directory) || inside(directory, path)))) throw new Error('Inventory output must remain separate from source, inputs and live data.');
  let ancestor = directory;
  while (!await lstat(ancestor).catch(error => { if (error.code === 'ENOENT') return null; throw error; })) ancestor = dirname(ancestor);
  if (await realpath(ancestor) !== ancestor || !(await lstat(ancestor)).isDirectory()) throw new Error('Inventory directories cannot use aliases.');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const parent = await lstat(directory);
  if (!parent.isDirectory() || parent.isSymbolicLink() || parent.uid !== (process.getuid?.() ?? 1000) || parent.mode & 0o077 || await realpath(directory) !== directory) throw new Error('Inventory directory must be private and owner controlled.');
  const existing = await lstat(file).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
  if (existing && (!existing.isFile() || existing.isSymbolicLink() || existing.nlink !== 1 || existing.uid !== parent.uid || existing.mode & 0o077)) throw new Error('Inventory output must be a private regular file.');
  const temporary = `${file}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(value) + '\n', { mode: 0o600, flag: 'wx' });
  await chmod(temporary, 0o600); await rename(temporary, file);
}

export async function main(args = [], options = {}) {
  const [command = 'publish', ...flags] = args;
  if (command !== 'publish') throw new Error('Usage: data-inventory.mjs publish [--config PATH] [--storage-config PATH] [--polaris-config PATH] [--output PATH]');
  const parsed = {};
  for (let i = 0; i < flags.length; i += 2) {
    if (!['--config', '--storage-config', '--output', ...DEFAULT_APP_REGISTRY.apps.flatMap(app => app.integration.storage?.relocation?.legacyConfiguration ? ['--' + app.integration.storage.relocation.legacyConfiguration.input + '-config'] : [])].includes(flags[i]) || !flags[i + 1] || parsed[flags[i]]) throw new Error('Inventory options require unique configuration paths.');
    parsed[flags[i]] = flags[i + 1];
  }
  const sourceRoot = resolve(options.sourceRoot || repository), base = join(options.home || homedir(), '.config/praxis');
  const businessFile = parsed['--config'] || options.businessConfigFile || join(base, 'business.json');
  const business = await readMetadata(businessFile, { optional: true }) || {};
  const storageFile = parsed['--storage-config'] || options.storageConfigFile || business.console?.storageConfigFile || join(base, 'storage.json');
  const registryFile = join(sourceRoot, 'config/installed-apps.json');
  const registry = await readApps(sourceRoot, { publicUrlsFile: null });
  const storage = await readMetadata(storageFile, { optional: true }) || {};
  const inputs = {}, bindingInputs = {}, appInputFiles = [];
  const integrations = options.integrations || DEFAULT_APP_REGISTRY;
  for (const app of integrations.apps) {
    const definition = app.integration, declaration = definition.storage || {}, inventory = declaration.inventory || {};
    const adapterId = definition.business?.adapterId || app.id, configured = business.apps?.[adapterId];
    if (inventory.mapping) {
      const filename = configured?.[inventory.mapping.field];
      if (filename) { inputs[inventory.mapping.input] = await readMetadata(filename); appInputFiles.push(filename); }
      const assertion = declaration.relocation?.spaceMap?.assertionInput;
      if (assertion) bindingInputs[assertion] = inputs[inventory.mapping.input]?.spaces;
    }
    const legacy = declaration.relocation?.legacyConfiguration;
    if (legacy) {
      const filename = parsed['--' + legacy.input + '-config'] || options[legacy.input + 'ConfigFile'] || join(base, legacy.input + '.json');
      inputs[legacy.input] = await readMetadata(filename, { optional: true }); bindingInputs[legacy.input] = inputs[legacy.input]; appInputFiles.push(filename);
    }
    if (inventory.inspection) inputs[inventory.inspection.input] = await inspectInventoryInput(inventory.inspection.input, storage, options.runDocker, integrations);
  }
  if (storage.workingData) assertAppBindings(storage, business, { ...bindingInputs, registry: integrations });
  const value = createDataInventory({ registry, business, storage, integrations, ...inputs, sourceRoot, ...(options.now ? { now: options.now } : {}) });
  const outputFile = parsed['--output'] || options.outputFile || business.console?.dataInventoryFile || join(base, 'data-inventory/locations.json');
  const protectedInputs = [businessFile, storageFile, registryFile, ...appInputFiles,
    business.console?.storageStatusFile, storage.stateRoot,
    ...Object.values(object(business.apps) ? business.apps : {}).flatMap(config => object(config) ? [config.keyFile, config.spacesFile, config.businessConfigFile] : []),
    ...(Array.isArray(storage.repositories) ? storage.repositories : []).flatMap(config => object(config) ? [config.path, config.passwordFile, config.credentialsFile, config.rcloneConfigFile] : []),
  ].filter(value => typeof value === 'string');
  await publish(outputFile, value, { sourceRoot, inputFiles: protectedInputs });
  const result = { published: true, apps: value.apps.length, generatedAt: value.generatedAt };
  (options.print || console.log)(JSON.stringify(result)); return result;
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) main(process.argv.slice(2)).catch(() => { console.error('Data inventory publication failed.'); process.exitCode = 1; });
