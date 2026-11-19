import { lstat } from 'node:fs/promises';
import { join, resolve } from 'node:path';

export const browserOmissions = [
  'Memo browser localStorage and photos require a full JSON export; a server volume does not include them.',
  'Travel checklists stored in a browser require an export or a backup of that browser profile.',
  'TingProof database excludes original audio and browser file handles; register an original-media directory and relink on the new browser.',
  'Gateway credentials, TLS keys and provider/encryption passwords are separate private recovery material; source bundles do not include them.',
  'Unrelated repositories, personal archives and audit artifacts are outside this workspace backup scope.',
];
const exists = async file => Boolean(await lstat(file).catch(() => null));
export async function registerWorkspace(config, repositoryRoot, { runtime = 'native' } = {}) {
  if (!['native', 'docker'].includes(runtime)) throw new Error('Runtime must be native or docker');
  const root = resolve(repositoryRoot), apps = join(config.dataRoot, 'workspaces', config.workspaceId, 'apps');
  const appSources = [];
  const required = async item => {
    if (!await exists(item.source)) throw new Error(`Required application source is missing: ${item.id}`);
    appSources.push(item);
  };
  await required({ id: 'reminder', kind: 'json', schema: 'reminder-v2', target: 'checklist.json', source: config.appSources?.find(item => item.id === 'reminder' && item.target === 'checklist.json')?.source ?? (runtime === 'native' ? join(root, 'third_party/reminder/data/checklist.json') : join(apps, 'reminder/checklist.json')) });
  await required({ id: 'tingproof', kind: 'sqlite', target: 'tingproof.db', source: config.appSources?.find(item => item.id === 'tingproof' && item.target === 'tingproof.db')?.source ?? (runtime === 'native' ? join(root, 'third_party/tingproof/data/tingproof.db') : join(apps, 'tingproof/tingproof.db')) });
  for (const target of ['decks', '.lattice']) {
    const registered = config.appSources?.find(item => item.id === 'slides' && item.target === target);
    await required({ id: 'slides', kind: 'directory', target, source: registered?.source ?? (runtime === 'native' ? join(root, 'third_party/lattice', target) : join(apps, 'slides', target)) });
  }
  for (const item of config.appSources ?? []) {
    if (!appSources.some(current => current.id === item.id && current.target === item.target)) appSources.push(item);
  }
  const platformPaths = ['src', 'scripts', 'tests', 'public', 'docs', 'skills', 'config', 'packaging',
    'Dockerfile', 'Dockerfile.builtins', 'Dockerfile.builtins.dockerignore', 'Dockerfile.storage',
    'compose.yaml', 'compose.apps.yaml', 'compose.business.yaml', 'compose.storage.yaml',
    'compose.polaris-viewer.yaml', 'compose.polaris-observations.yaml', '.dockerignore',
    '.gitignore', '.gitmodules', 'package.json', 'package-lock.json', 'AGENTS.md',
    'README.md', 'README.zh-CN.md', 'CONTRIBUTING.md', 'LICENSE', 'CODE_OF_CONDUCT.md'];
  const paths = [];
  for (const name of platformPaths) if (await exists(join(root, name))) paths.push(name);
  const sourceRepos = [{ id: 'praxis', path: root, paths }];
  const builtinIds = ['reminder', 'knowledge', 'lattice', 'travel', 'tingproof', 'memo',
    'finance', 'intelligence', 'projects', 'calendar', 'matrix-reader', 'letters', 'profiles', 'polaris'];
  for (const id of builtinIds) {
    const path = join(root, 'third_party', id);
    if (!await exists(join(path, '.git'))) throw new Error(`Required source repository is missing: ${id}`);
    sourceRepos.push({ id, path });
  }
  for (const registered of config.sourceRepos ?? []) {
    if (!sourceRepos.some(current => current.id === registered.id)) sourceRepos.push(registered);
  }
  return { ...config, runtime, appSources, sourceRepos, coverage: { ...config.coverage, omitted: [...new Set([...browserOmissions, ...(config.coverage?.omitted ?? [])])] } };
}
