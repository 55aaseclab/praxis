import { resolveAppPaths } from './app-paths.mjs';
import { randomBytes, randomUUID } from 'node:crypto';
import { chmod, lstat, mkdir, open, readFile, realpath, rename, unlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const WORKSPACE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const DEFAULT_CONFIG_FILE = resolve(homedir(), '.config/praxis/storage.json');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ID = /^[a-z][a-z0-9-]{0,63}$/;

export function storageError(code, message) {
  return Object.assign(new Error(message), { code });
}

export function isWithin(parent, child) {
  const path = relative(resolve(parent), resolve(child));
  return path === '' || (path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path));
}

export function assertOutsideWorkspace(path, label = 'Path') {
  if (!isAbsolute(path) || isWithin(WORKSPACE_ROOT, path)) {
    throw storageError('UNSAFE_PATH', `${label} must be an absolute path outside the Git workspace`);
  }
  return path;
}

export async function assertPrivateFile(path, { allowEmpty = false } = {}) {
  assertOutsideWorkspace(path, 'Secret file');
  const info = await lstat(path).catch(() => { throw storageError('NOT_CONFIGURED', 'A required private file is missing'); });
  if (!info.isFile() || info.isSymbolicLink() || (info.mode & 0o077) || (typeof process.getuid === 'function' && info.uid !== process.getuid())) {
    throw storageError('UNSAFE_SECRET', 'Private files must be regular owner-only files (mode 600)');
  }
  assertOutsideWorkspace(await realpath(path), 'Secret file');
  if (!allowEmpty && !(await readFile(path, 'utf8')).trim()) throw storageError('NOT_CONFIGURED', 'A required private file is empty');
}

export function validateConfig(input) {
  const config = structuredClone(input);
  if (config.schemaVersion !== 1) throw storageError('INVALID_CONFIG', 'Unsupported storage configuration schema');
  for (const field of ['workspaceId', 'deviceId', 'activeWriterDeviceId']) {
    if (!UUID.test(config[field] ?? '')) throw storageError('INVALID_CONFIG', `${field} must be a UUID`);
  }
  assertOutsideWorkspace(config.dataRoot ?? '', 'dataRoot');
  config.stateRoot ??= resolve(config.dataRoot, 'workspaces', config.workspaceId, '.praxis-storage');
  assertOutsideWorkspace(config.stateRoot, 'stateRoot');
  config.primaryRepositoryId ??= config.repositories?.[0]?.id;
  config.preferredRepositoryId ??= config.primaryRepositoryId;
  if (!Array.isArray(config.repositories) || !config.repositories.length) throw storageError('INVALID_CONFIG', 'At least one repository is required');
  const ids = new Set();
  const localPaths = [];
  for (const repo of config.repositories) {
    if (!ID.test(repo.id ?? '') || ids.has(repo.id)) throw storageError('INVALID_CONFIG', 'Repository IDs must be unique lowercase identifiers');
    ids.add(repo.id);
    if (!['local', 'jianguoyun', 'rclone'].includes(repo.type)) throw storageError('INVALID_CONFIG', 'Unsupported repository type');
    assertOutsideWorkspace(repo.passwordFile ?? '', 'passwordFile');
    if (repo.type === 'local') {
      assertOutsideWorkspace(repo.path ?? '', 'Repository path');
      const appsRoot = resolve(config.dataRoot, 'workspaces', config.workspaceId, 'apps');
      if (isWithin(appsRoot, repo.path) || isWithin(repo.path, appsRoot) || isWithin(repo.path, config.stateRoot) || isWithin(config.stateRoot, repo.path)) {
        throw storageError('UNSAFE_PATH', 'Repository, working data and staging paths must be separate');
      }
      if (localPaths.some(path => isWithin(path, repo.path) || isWithin(repo.path, path))) throw storageError('INVALID_CONFIG', 'Local repositories must be independent directories');
      localPaths.push(repo.path);
    } else {
      repo.remotePath ??= `praxis/${config.workspaceId}`;
      if (!repo.remotePath || repo.remotePath.startsWith('/') || /[\\\r\n]/.test(repo.remotePath) || repo.remotePath.split('/').some(part => !part || part === '.' || part === '..')) {
        throw storageError('INVALID_CONFIG', 'remotePath must be a safe relative directory');
      }
      if (repo.type === 'jianguoyun') {
        assertOutsideWorkspace(repo.credentialsFile ?? '', 'credentialsFile');
      } else {
        if (!/^[A-Za-z0-9_-]+$/.test(repo.remote ?? '')) throw storageError('INVALID_CONFIG', 'rclone remote must be a configured remote name');
        assertOutsideWorkspace(repo.rcloneConfigFile ?? '', 'rcloneConfigFile');
      }
    }
    if (['password', 'applicationPassword', 'username', 'token'].some(key => key in repo)) throw storageError('INVALID_CONFIG', 'Repository configuration must reference secret files instead of containing credentials');
  }
  if (config.repositories.find(repo => repo.id === config.primaryRepositoryId)?.type !== 'local') throw storageError('INVALID_CONFIG', 'The active backup repository must be local');
  if (!ids.has(config.preferredRepositoryId)) throw storageError('INVALID_CONFIG', 'Unknown preferred repository');
  config.writerHistory ??= [];
  if (!Array.isArray(config.writerHistory) || config.writerHistory.some(event => !UUID.test(event.deviceId ?? '') || !UUID.test(event.nextDeviceId ?? '') || typeof event.atSnapshotId !== 'string')) {
    throw storageError('INVALID_CONFIG', 'Invalid writer history');
  }
  config.appSources ??= [];
  config.sourceRepos ??= [];
  if (!Array.isArray(config.appSources) || !Array.isArray(config.sourceRepos)) throw storageError('INVALID_CONFIG', 'Application and source repositories must be arrays');
  config.intervalSeconds ??= 3600;
  if (!Number.isInteger(config.intervalSeconds) || config.intervalSeconds < 60) throw storageError('INVALID_CONFIG', 'intervalSeconds must be at least 60');
  config.retryAttempts ??= 3;
  if (!Number.isInteger(config.retryAttempts) || config.retryAttempts < 1 || config.retryAttempts > 5) throw storageError('INVALID_CONFIG', 'retryAttempts must be between 1 and 5');
  for (const binary of ['resticBinary', 'rcloneBinary']) {
    config[binary] ??= binary === 'resticBinary' ? 'restic' : 'rclone';
    if (typeof config[binary] !== 'string' || /[\r\n]/.test(config[binary])) throw storageError('INVALID_CONFIG', 'Invalid tool executable');
  }
  if (config.workingData) resolveAppPaths(config);
  return config;
}

export async function writePrivateJson(path, value) {
  assertOutsideWorkspace(path);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${randomUUID()}.tmp`;
  let handle;
  try {
    handle = await open(temporary, 'wx', 0o600);
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`);
    await handle.sync();
    await handle.close(); handle = undefined;
    await rename(temporary, path);
    await chmod(path, 0o600);
  } finally {
    await handle?.close();
    await unlink(temporary).catch(() => {});
  }
}

export async function loadConfig(path = process.env.PRAXIS_STORAGE_CONFIG || DEFAULT_CONFIG_FILE) {
  await assertPrivateFile(path);
  let raw;
  try { raw = JSON.parse(await readFile(path, 'utf8')); } catch { throw storageError('INVALID_CONFIG', 'Storage configuration is not valid JSON'); }
  return validateConfig(raw);
}

export async function saveConfig(config, path = process.env.PRAXIS_STORAGE_CONFIG || DEFAULT_CONFIG_FILE) {
  const validated = validateConfig(config);
  await writePrivateJson(path, validated);
  return validated;
}

export async function initializeConfig({ configFile = process.env.PRAXIS_STORAGE_CONFIG || DEFAULT_CONFIG_FILE, dataRoot = resolve(homedir(), '.local/share/praxis'), workspaceId = randomUUID(), deviceId = randomUUID(), repositoryPath, passwordFile, resticBinary = 'restic', rcloneBinary = 'rclone' } = {}) {
  if (await lstat(configFile).catch(() => null)) throw storageError('ALREADY_EXISTS', 'Storage configuration already exists');
  passwordFile ??= resolve(dirname(configFile), 'secrets/local-repository-password');
  repositoryPath ??= resolve(dataRoot, 'repositories', workspaceId, 'local');
  assertOutsideWorkspace(passwordFile);
  await mkdir(dirname(passwordFile), { recursive: true, mode: 0o700 });
  const handle = await open(passwordFile, 'wx', 0o600);
  try { await handle.writeFile(`${randomBytes(48).toString('base64url')}\n`); await handle.sync(); } finally { await handle.close(); }
  return saveConfig({ schemaVersion: 1, workspaceId, deviceId, activeWriterDeviceId: deviceId, dataRoot, resticBinary, rcloneBinary, repositories: [{ id: 'local', type: 'local', path: repositoryPath, passwordFile }], primaryRepositoryId: 'local', appSources: [], sourceRepos: [] }, configFile);
}
