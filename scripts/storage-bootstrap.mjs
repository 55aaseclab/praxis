import { cp, lstat, mkdir, readFile, rm } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createConnection } from 'node:net';
import { execFileSync } from 'node:child_process';
import { initializeConfig, loadConfig, saveConfig, DEFAULT_CONFIG_FILE } from '../src/storage/config.mjs';
import { createSnapshot, verifySnapshot, verifyApplicationCopy } from '../src/storage/snapshot.mjs';
import { registerWorkspace } from '../src/storage/registry.mjs';
import { SERVICES } from './stack.mjs';

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));
async function portOpen(port) {
  return new Promise(resolve => {
    const socket = createConnection({ host: '127.0.0.1', port });
    const end = result => { socket.destroy(); resolve(result); };
    socket.setTimeout(1000, () => end(false)); socket.once('connect', () => end(true)); socket.once('error', () => end(false));
  });
}
export async function prepareDocker(config, { checkWriters = true, sourceStopped = false } = {}) {
  if (config.runtime === 'docker') throw new Error('Workspace is already registered for Docker');
  if (config.deviceId !== config.activeWriterDeviceId) throw new Error('Only the active writer can prepare Docker data');
  if (!sourceStopped) throw new Error('Preparing Docker requires an explicit source-stopped assertion covering services, CLI writers and scheduled agents');
  if (checkWriters) {
    for (const port of [4322, 5173, 15173, 4666, 14666]) if (await portOpen(port)) throw new Error('Stop all native application writers before preparing Docker data; no data was switched');
  }
  const appsRoot = join(config.dataRoot, 'workspaces', config.workspaceId, 'apps');
  if (await lstat(appsRoot).catch(() => null)) throw new Error('Docker application directory already exists; refusing to overwrite');
  const snapshot = await createSnapshot(config);
  await verifySnapshot(snapshot.directory);
  const staging = `${appsRoot}.staging`;
  if (await lstat(staging).catch(() => null)) throw new Error('Previous Docker staging directory exists; inspect it before retrying');
  await mkdir(dirname(appsRoot), { recursive: true, mode: 0o700 });
  try {
    await cp(join(snapshot.directory, 'apps'), staging, { recursive: true, errorOnExist: true, force: false, preserveTimestamps: true });
    await verifyApplicationCopy(staging, snapshot.manifest);
    const { rename } = await import('node:fs/promises'); await rename(staging, appsRoot);
  } catch (error) { await rm(staging, { recursive: true, force: true }); throw error; }
  return { appsRoot, snapshotId: snapshot.manifest.snapshotId };
}
export function activateRegisteredSources(config, receipt, status, { sourceFingerprint, sourceMap, businessConfigFile } = {}) {
  if (config.deviceId !== config.activeWriterDeviceId) throw new Error('Only the active writer may activate Docker bindings');
  const expectedServices = Object.keys(SERVICES).filter(name => name !== 'reminder').sort();
  if (typeof sourceFingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(sourceFingerprint) || receipt?.schemaVersion !== 2 || receipt.sourceMode !== 'registered' || receipt.workspaceId !== config.workspaceId || receipt.sourceFingerprint !== sourceFingerprint || JSON.stringify(receipt.sourceMap) !== JSON.stringify(sourceMap) || !Array.isArray(receipt.services) || JSON.stringify([...receipt.services].sort()) !== JSON.stringify(expectedServices) || JSON.stringify([...receipt.services].sort()) !== JSON.stringify(status?.services?.map(service => service.name).sort())) throw new Error('A current registered-source activation receipt is required');
  if (!status?.healthy || status.sourceMode !== 'registered' || status.sourceFingerprint !== sourceFingerprint || status.workspaceId !== config.workspaceId || status.projectName !== receipt.projectName || status.services?.length !== expectedServices.length) throw new Error('All selected Docker application services must be healthy');
  return { ...config, runtime: 'docker', dockerSourceMode: 'registered', dockerWithoutReminder: true, ...(businessConfigFile ? { businessConfigFile: resolve(businessConfigFile) } : {}) };
}
export async function main(args = process.argv.slice(2)) {
  let configFile = process.env.PRAXIS_STORAGE_CONFIG || DEFAULT_CONFIG_FILE;
  const index = args.indexOf('--config');
  if (index >= 0) { if (!args[index + 1]) throw new Error('--config requires a path'); configFile = resolve(args[index + 1]); args.splice(index, 2); }
  let businessConfigFile;
  const businessIndex = args.indexOf('--business-config');
  if (businessIndex >= 0) { if (!args[businessIndex + 1]) throw new Error('--business-config requires a path'); businessConfigFile = resolve(args[businessIndex + 1]); args.splice(businessIndex, 2); }
  const [command, ...rest] = args;
  if (command === 'register' && !rest.length) {
    let config;
    if (await lstat(configFile).catch(() => null)) config = await loadConfig(configFile);
    else {
      const binary = async name => await lstat(join(homedir(), '.local/bin', name)).catch(() => null) ? join(homedir(), '.local/bin', name) : name;
      config = await initializeConfig({ configFile, resticBinary: await binary('restic'), rcloneBinary: await binary('rclone') });
    }
    config = await saveConfig(config.dockerSourceMode === 'registered' ? config : await registerWorkspace(config, repositoryRoot, { runtime: config.runtime ?? 'native' }), configFile);
    console.log(`Workspace registered (${config.runtime}); ${config.appSources.length} application sources, ${config.sourceRepos.length} code repositories. Browser exports and recovery secrets remain separate.`);
  } else if (command === 'prepare-docker' && rest.length === 1 && rest[0] === '--source-stopped') {
    const config = await loadConfig(configFile), prepared = await prepareDocker(config, { sourceStopped: true });
    console.log(`Docker data prepared at ${prepared.appsRoot}; native originals retained. Start Docker, verify, then run activate-docker.`);
  } else if (command === 'activate-bind' && !rest.length) {
    const config = await loadConfig(configFile);
    const { main: stack, resolveStackSettings } = await import('./stack.mjs');
    const settings = await resolveStackSettings({ configPath: configFile, sourceMode: 'registered', withoutReminder: true });
    const receipt = JSON.parse(await readFile(settings.receiptFile, 'utf8'));
    const status = await stack(['status', '--json', '--source-mode', 'registered', '--without-reminder', '--config', configFile], { print: () => {} });
    if (businessConfigFile) {
      const { loadBusinessConfig } = await import('../src/business/config.mjs');
      const business = await loadBusinessConfig(businessConfigFile);
      if (business.apps.reminder?.managed !== true) throw new Error('The unified stack requires managed Reminder in its business profile');
      const mapping = JSON.parse(await readFile(business.apps.reminder.spacesFile, 'utf8'));
      if (!Object.values(mapping.spaces || {}).includes(settings.sourceMap.reminder)) throw new Error('Business Reminder must retain the registered source of truth');
    }
    const next = activateRegisteredSources(config, receipt, status, { sourceFingerprint: settings.sourceFingerprint, sourceMap: settings.sourceMap, businessConfigFile });
    await saveConfig(next, configFile);
    console.log('Docker bindings activated; registered source paths and records were not copied or rewritten.');
  } else if (command === 'activate-docker' && !rest.length) {
    const config = await loadConfig(configFile);
    const receipt = JSON.parse(await readFile(join(config.stateRoot, 'docker-active.json'), 'utf8'));
    const appsRoot = join(config.dataRoot, 'workspaces', config.workspaceId, 'apps');
    if (receipt.workspaceId !== config.workspaceId || receipt.appsRoot !== appsRoot || !/^[a-z0-9][a-z0-9_-]+$/.test(receipt.projectName)) throw new Error('Invalid Docker activation receipt');
    const { main: stack } = await import('./stack.mjs');
    const status = await stack(['status', '--json', '--config', configFile], { print: () => {} });
    if (!status.healthy || status.projectName !== receipt.projectName || status.workspaceId !== config.workspaceId) throw new Error('All Docker application services must be healthy before activation');
    await saveConfig(await registerWorkspace(config, repositoryRoot, { runtime: 'docker' }), configFile);
    console.log('Backup sources now point to Docker data. Native originals retained for rollback.');
  } else if (command === 'register-media' && rest.length === 1) {
    const config = await loadConfig(configFile), source = resolve(rest[0]), stat = await lstat(source);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Original media must be a regular directory');
    if (config.appSources.some(s => s.id === 'tingproof' && s.target === 'original-media')) throw new Error('Original media is already registered');
    config.appSources.push({ id: 'tingproof', kind: 'directory', target: 'original-media', source });
    await saveConfig(config, configFile); console.log('Original media directory registered; browser handles still require relinking.');
  } else if (command === 'register-memo-export' && rest.length === 1) {
    const config = await loadConfig(configFile), source = resolve(rest[0]);
    let value;
    try { value = JSON.parse(execFileSync(process.execPath, [join(repositoryRoot, 'third_party/memo/scripts/validate-backup.mjs'), source], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })); }
    catch { throw new Error('Memo rejected the backup export; no source was registered'); }
    config.appSources = config.appSources.filter(s => !(s.id === 'memo' && s.target === 'browser-export.json'));
    config.appSources.push({ id: 'memo', kind: 'json', schema: 'memo-backup-v1', exportedAt: value.exportedAt, target: 'browser-export.json', source });
    await saveConfig(config, configFile); console.log('Memo export registered; export again after browser changes to update the backup source.');
  } else throw new Error('Usage: storage-bootstrap.mjs [--config PATH] [--business-config PATH] register | activate-bind | prepare-docker --source-stopped | activate-docker | register-media DIRECTORY | register-memo-export FILE');
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) main().catch(error => { console.error(`Storage bootstrap error: ${error.message}`); process.exitCode = 1; });
