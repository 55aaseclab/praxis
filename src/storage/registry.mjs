import { DEFAULT_APP_REGISTRY } from '../default-app-registry.mjs';
import { storageEntries } from './app-paths.mjs';
import { lstat, readdir } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';

export const browserOmissions = [...new Set([
  ...storageEntries().flatMap(({ storage }) => storage.omissions || []),
  'Gateway credentials, TLS keys and provider/encryption passwords are separate private recovery material; source bundles do not include them.',
  'Unrelated repositories, personal archives and audit artifacts are outside this workspace backup scope.',
])];
const exists = async file => Boolean(await lstat(file).catch(() => null));
export async function registerWorkspace(config, repositoryRoot, { runtime = 'native', registry = DEFAULT_APP_REGISTRY } = {}) {
  if (!['native', 'docker'].includes(runtime)) throw new Error('Runtime must be native or docker');
  const root = resolve(repositoryRoot), apps = join(config.dataRoot, 'workspaces', config.workspaceId, 'apps');
  const appSources = [];
  const required = async item => {
    if (!await exists(item.source)) throw new Error(`Required application source is missing: ${item.id}`);
    appSources.push(item);
  };
  for (const { app, storage } of storageEntries(registry)) for (const source of storage.sources || []) {
    if (!source.registerDefault) continue;
    const id = storage.sourceId || storage.rootId || app.id, target = source.primaryTarget || source.target;
    if (!target || !source.nativeSource) throw new Error('A default storage source requires owned native and target paths.');
    await required({ id, kind: source.kind, ...(source.schema ? { schema: source.schema } : {}), target,
      source: config.appSources?.find(item => item.id === id && item.target === target)?.source ?? (runtime === 'native' ? join(root, app.source, source.nativeSource) : join(apps, id, target)) });
  }
  for (const item of config.appSources ?? []) {
    if (!appSources.some(current => current.id === item.id && current.target === item.target)) appSources.push(item);
  }
  const platformPaths = ['src', 'scripts', 'tests', 'public', 'docs', 'skills', 'config', 'packaging',
    '.dockerignore',
    '.gitignore', '.gitmodules', 'package.json', 'package-lock.json', 'AGENTS.md',
    'README.md', 'README.zh-CN.md', 'CONTRIBUTING.md', 'LICENSE', 'CODE_OF_CONDUCT.md'];
  platformPaths.push(...(await readdir(root)).filter(name => /^(?:Dockerfile(?:\.[A-Za-z0-9-]+)*|compose(?:\.[A-Za-z0-9_-]+)*\.yaml)$/.test(name)));
  const paths = [];
  for (const name of platformPaths) if (await exists(join(root, name))) paths.push(name);
  const sourceRepos = [{ id: 'praxis', path: root, paths }];
  for (const app of registry.apps) {
    const path = join(root, app.source), id = basename(app.source);
    if (!await exists(join(path, '.git'))) throw new Error(`Required source repository is missing: ${id}`);
    sourceRepos.push({ id, path });
  }
  for (const registered of config.sourceRepos ?? []) {
    if (!sourceRepos.some(current => current.id === registered.id)) sourceRepos.push(registered);
  }
  return { ...config, runtime, appSources, sourceRepos, coverage: { ...config.coverage, omitted: [...new Set([...storageEntries(registry).flatMap(({ storage }) => storage.omissions || []), ...browserOmissions.filter(value => !storageEntries().some(({ storage }) => (storage.omissions || []).includes(value))), ...(config.coverage?.omitted ?? [])])] } };
}
