import { execFile } from 'node:child_process';
import { constants } from 'node:fs';
import { lstat, mkdir, open, realpath, rename, rm } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { readApps } from '../src/apps.mjs';

const executeFile = promisify(execFile);
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ENVIRONMENT_NAME = /^[A-Z][A-Z0-9_]{0,119}$/;
const PRIVATE_ENVIRONMENT = /(?:^|_)(?:KEY|PASSWORD|PASSWD|SECRET|TOKEN|CREDENTIALS?)(?:_|$)/i;
const SERVICE = /^[a-z0-9][a-z0-9-]{0,119}$/;
const CONTAINER = /^[a-f0-9]{12,64}$/;
const SUFFIX = '(?:business|native|runtime|app|web|server|service|api|reader|viewer)(?:-(?:blue|green))?';

function problem(code) { return Object.assign(new Error(code), { code }); }
function unique(values) { return [...new Set(values)].sort(); }
function declaredEnvironment(provider) {
  const names = unique((provider.dataSources || []).flatMap(source => source.location?.env ? [source.location.env] : []));
  if (names.some(name => typeof name !== 'string' || !ENVIRONMENT_NAME.test(name) || PRIVATE_ENVIRONMENT.test(name))) throw problem('UNSAFE_DATA_ENVIRONMENT');
  return names;
}
function aliases(provider) {
  const source = provider.source?.split('/').at(-1);
  const values = unique([provider.appId, provider.adapterAppId, source].filter(Boolean));
  if (!values.length || values.some(value => !SERVICE.test(value))) throw problem('INVALID_PROVIDER_ALIAS');
  return values;
}
function matches(provider, service) {
  if (!SERVICE.test(service || '')) return null;
  for (const alias of aliases(provider)) {
    if (service === alias) return 'exact';
    if (new RegExp(`^${alias}-${SUFFIX}$`).test(service)) return 'suffix';
  }
  return null;
}
function ownership(provider, snapshot) {
  if (snapshot.appId) {
    if (snapshot.appId !== provider.appId || snapshot.role && !['native', 'business'].includes(snapshot.role)) return null;
    return 'label';
  }
  return matches(provider, snapshot.service);
}
function dataPath(value) {
  if (typeof value !== 'string' || !isAbsolute(value) || /[\u0000-\u001f\u007f]/.test(value) || value.includes('://')) return null;
  return resolve(value);
}
function sanitizedEnvironment(value, names) {
  const allowed = new Set(names), result = {};
  const entries = Array.isArray(value) ? value.flatMap(entry => {
    if (typeof entry !== 'string') return [];
    const separator = entry.indexOf('=');
    return separator > 0 ? [[entry.slice(0, separator), entry.slice(separator + 1)]] : [];
  }) : Object.entries(value || {});
  for (const [name, raw] of entries) {
    if (!allowed.has(name)) continue;
    const path = dataPath(raw);
    if (path) result[name] = path;
  }
  return result;
}
function sanitizedMounts(values) {
  const mounts = [];
  for (const value of values || []) {
    const source = dataPath(value.source ?? value.Source), destination = dataPath(value.destination ?? value.Destination);
    const type = value.type ?? value.Type, name = value.name ?? value.Name;
    if (!source || !destination || !['bind', 'volume', 'tmpfs'].includes(type)) continue;
    mounts.push({ source, destination, type, ...(typeof name === 'string' && name ? { name } : {}) });
  }
  return [...new Map(mounts.map(mount => [JSON.stringify(mount), mount])).values()].sort((left, right) => left.destination.localeCompare(right.destination) || left.source.localeCompare(right.source));
}

/** Load only installed, app-owned descriptors. No business stores are opened. */
export async function loadProviderDescriptors({ root = repositoryRoot, catalog, importProvider } = {}) {
  const apps = catalog ?? await readApps(root, { publicUrlsFile: null });
  if (!Array.isArray(apps)) throw problem('INVALID_APP_CATALOG');
  const providers = [];
  for (const app of apps.filter(value => value.builtin)) {
    if (!SERVICE.test(app.id || '') || typeof app.source !== 'string' || !/^third_party\/[a-z0-9][a-z0-9-]*$/.test(app.source)) throw problem('INVALID_APP_SOURCE');
    const filename = resolve(root, app.source, 'praxis-provider.mjs');
    let module;
    try {
      const url = pathToFileURL(filename);
      if (importProvider) module = await importProvider(url.href);
      else {
        const source = await lstat(filename);
        if (!source.isFile() || source.isSymbolicLink()) throw problem('INVALID_PROVIDER_SOURCE');
        // Keep watch mode current after an app pin changes, while reusing imports
        // when the installed source has not changed.
        url.searchParams.set('runtimeVersion', `${source.mtimeMs}-${source.size}`);
        module = await import(url.href);
      }
    }
    catch (error) {
      if (error.code === 'ENOENT') { providers.push({ appId: app.id, source: app.source, dataSources: [], unsupported: true }); continue; }
      throw problem('PROVIDER_LOAD_FAILED');
    }
    const metadata = await module.describe();
    if (metadata?.version !== 1 || metadata.appId !== app.id || !Array.isArray(metadata.dataSources)) throw problem('INVALID_PROVIDER_DESCRIPTOR');
    const provider = { ...metadata, source: app.source };
    declaredEnvironment(provider); aliases(provider); providers.push(provider);
  }
  return providers;
}

/** Merge injected, metadata-only snapshots without guessing conflicting bindings. */
export function collectProviderRuntime({ providers, snapshots, now = Date.now() }) {
  if (!Array.isArray(providers) || !Array.isArray(snapshots)) throw problem('INVALID_RUNTIME_INPUT');
  const apps = providers.map(provider => {
    const names = declaredEnvironment(provider), bindings = [];
    for (const snapshot of snapshots) {
      const service = snapshot.service, match = ownership(provider, snapshot);
      if (!match) continue;
      const environment = sanitizedEnvironment(snapshot.environment, names);
      // A suffix alone must not pull an unrelated session service into inventory.
      if (match === 'suffix' && !Object.keys(environment).length) continue;
      const workingDirectory = dataPath(snapshot.workingDirectory);
      const role = ['native', 'business'].includes(snapshot.role) ? snapshot.role : /-business(?:-(?:blue|green))?$/.test(service) ? 'business' : 'native';
      bindings.push({ service, role, environment, ...(workingDirectory ? { workingDirectory } : {}), mounts: sanitizedMounts(snapshot.mounts) });
    }
    const distinctBindings = [...new Map(bindings.map(value => [JSON.stringify(value), value])).values()];
    const environment = {}, mounts = [], conflicts = [];
    for (const name of names) {
      const paths = unique(distinctBindings.flatMap(binding => binding.environment[name] ? [binding.environment[name]] : []));
      if (paths.length === 1) environment[name] = paths[0];
      else if (paths.length > 1) conflicts.push({ kind: 'environment', name });
    }
    const directories = unique(distinctBindings.flatMap(binding => binding.workingDirectory ? [binding.workingDirectory] : []));
    if (directories.length > 1) conflicts.push({ kind: 'working-directory' });
    const allMounts = sanitizedMounts(distinctBindings.flatMap(binding => binding.mounts));
    for (const destination of unique(allMounts.map(mount => mount.destination))) {
      const candidates = allMounts.filter(mount => mount.destination === destination);
      if (candidates.length === 1) mounts.push(candidates[0]);
      else conflicts.push({ kind: 'mount', destination });
    }
    return { appId: provider.appId, status: provider.unsupported ? 'unsupported' : !distinctBindings.length || conflicts.length ? 'unknown' : 'ready', environment,
      ...(directories.length === 1 ? { workingDirectory: directories[0] } : {}), mounts,
      ...(distinctBindings.length ? { bindings: distinctBindings } : {}), ...(conflicts.length ? { conflicts } : {}) };
  });
  return { schemaVersion: 1, generatedAt: new Date(typeof now === 'function' ? now() : now).toISOString(), apps };
}

function shellQuote(value) { return `'${String(value).replaceAll("'", "'\\''")}'`; }
export async function executeDockerMetadata(args) {
  const command = ['docker', ...args].map(shellQuote).join(' ');
  const { stdout } = await executeFile('sg', ['docker', '-c', command], { encoding: 'utf8', timeout: 30000, maxBuffer: 4 * 1024 * 1024 });
  return stdout;
}
function inspectFormat(names) {
  const selected = names.length ? `or ${names.map(name => `(eq (index (split . "=") 0) ${JSON.stringify(name)})`).join(' ')}` : 'false';
  return '{"workingDirectory":{{json .Config.WorkingDir}},"environment":[{{$first := true}}{{range .Config.Env}}{{if ' + selected + '}}{{if not $first}},{{end}}{{json .}}{{$first = false}}{{end}}{{end}}],"mounts":{{json .Mounts}}}';
}

/** Public app/role labels or conventional service aliases select before inspect. */
export async function readDockerSnapshots({ providers, execute = executeDockerMetadata }) {
  const listing = await execute(['ps', '--format', '{{.ID}}\t{{.Label "com.docker.compose.service"}}\t{{.Label "io.praxis.app"}}\t{{.Label "io.praxis.role"}}']);
  const snapshots = [];
  for (const line of listing.trim().split('\n').filter(Boolean)) {
    const [id, service, appId, role] = line.split('\t');
    if (!CONTAINER.test(id || '')) continue;
    const labels = { service, ...(appId ? { appId } : {}), ...(role ? { role } : {}) };
    const owners = providers.filter(provider => !provider.unsupported && ownership(provider, labels));
    if (!owners.length) continue;
    const names = unique(owners.flatMap(declaredEnvironment));
    const raw = await execute(['inspect', '--format', inspectFormat(names), id]);
    let selected;
    try { selected = JSON.parse(raw); } catch { throw problem('INVALID_DOCKER_METADATA'); }
    snapshots.push({ ...labels, environment: selected.environment, workingDirectory: selected.workingDirectory, mounts: selected.mounts });
  }
  return snapshots;
}

async function ensurePrivateParent(output) {
  const parent = dirname(output);
  await mkdir(parent, { recursive: true, mode: 0o700 });
  if (await realpath(parent) !== parent) throw problem('UNSAFE_RUNTIME_OUTPUT');
  const directory = await lstat(parent);
  if (!directory.isDirectory() || directory.isSymbolicLink() || directory.mode & 0o077) throw problem('UNSAFE_RUNTIME_OUTPUT');
  try { const file = await lstat(output); if (!file.isFile() || file.isSymbolicLink() || file.mode & 0o077) throw problem('UNSAFE_RUNTIME_OUTPUT'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
}
export async function writeProviderRuntime(output, snapshot) {
  if (!isAbsolute(output) || resolve(output) !== output) throw problem('INVALID_RUNTIME_OUTPUT');
  const inside = relative(repositoryRoot, output);
  if (!inside || inside !== '..' && !inside.startsWith('../') && !isAbsolute(inside)) throw problem('RUNTIME_OUTPUT_IN_SOURCE');
  await ensurePrivateParent(output);
  const temporary = resolve(dirname(output), `.provider-runtime-${randomUUID()}.tmp`);
  let handle;
  try {
    handle = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    await handle.writeFile(JSON.stringify(snapshot, null, 2) + '\n'); await handle.sync(); await handle.close(); handle = null;
    await rename(temporary, output);
  } finally { await handle?.close(); await rm(temporary, { force: true }); }
}
export async function publishProviderRuntime({ output, providers, snapshots, now, execute } = {}) {
  providers ??= await loadProviderDescriptors();
  snapshots ??= await readDockerSnapshots({ providers, execute });
  const result = collectProviderRuntime({ providers, snapshots, now });
  await writeProviderRuntime(output, result);
  return result;
}
export function parseProviderRuntimeArgs(args) {
  let output, watch = false;
  for (let index = 0; index < args.length; index++) {
    if (args[index] === '--output' && args[index + 1]) output = resolve(args[++index]);
    else if (args[index] === '--watch') {
      watch = 30;
      if (args[index + 1] && !args[index + 1].startsWith('--')) {
        watch = Number(args[++index]); if (!Number.isFinite(watch) || watch < 1 || watch > 86400) throw problem('INVALID_WATCH_INTERVAL');
      }
    } else throw problem('INVALID_RUNTIME_ARGUMENT');
  }
  if (!output) throw problem('RUNTIME_OUTPUT_REQUIRED');
  return { output, watch };
}
async function main() {
  const { output, watch } = parseProviderRuntimeArgs(process.argv.slice(2));
  const controller = new AbortController();
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => controller.abort());
  do {
    try { const snapshot = await publishProviderRuntime({ output }); console.log(`Provider runtime metadata updated: ${snapshot.apps.length} apps.`); }
    catch (error) { console.error(`Provider runtime metadata update failed: ${error.code || 'RUNTIME_METADATA_UNAVAILABLE'}`); if (!watch) { process.exitCode = 1; return; } }
    if (!watch || controller.signal.aborted) break;
    try { await delay(watch * 1000, undefined, { signal: controller.signal }); } catch { break; }
  } while (!controller.signal.aborted);
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch(error => { console.error(`Provider runtime metadata failed: ${error.code || 'RUNTIME_METADATA_UNAVAILABLE'}`); process.exitCode = 1; });
}
