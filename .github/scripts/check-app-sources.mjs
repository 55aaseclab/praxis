import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const populate = process.argv.slice(2).includes('--populate');
if (process.argv.slice(2).some(argument => argument !== '--populate')) {
  throw new Error('Usage: node .github/scripts/check-app-sources.mjs [--populate]');
}
const git = async (args, options = {}) => (await execute('git', args, {
  cwd: root, encoding: 'utf8', timeout: 120000, maxBuffer: 8 * 1024 * 1024, ...options,
})).stdout;
const samePaths = (actual, expected) => actual.length === expected.length &&
  [...actual].sort().every((path, index) => path === [...expected].sort()[index]);

const apps = JSON.parse(await readFile(join(root, 'config/apps.json'), 'utf8')).filter(app => app.builtin);
const sources = apps.map(app => app.source);
if (!sources.length || sources.some(source => !/^third_party\/[a-z][a-z0-9-]*$/.test(source)) || new Set(sources).size !== sources.length) {
  throw new Error('Built-in apps must have unique third_party source paths.');
}
const modules = new Map();
for (const entry of (await git(['config', '--no-includes', '--file', '.gitmodules', '--null', '--list'])).split('\0').filter(Boolean)) {
  const separator = entry.indexOf('\n');
  const key = entry.slice(0, separator), value = entry.slice(separator + 1);
  const match = key.match(/^submodule\.(.+)\.(path|url|branch|shallow)$/);
  if (!match) throw new Error(`Unsupported .gitmodules setting: ${key}`);
  const module = modules.get(match[1]) ?? {};
  if (Object.hasOwn(module, match[2])) throw new Error(`Duplicate .gitmodules setting: ${key}`);
  module[match[2]] = value;
  modules.set(match[1], module);
}
const links = new Map((await git(['ls-tree', '-r', '-z', 'HEAD'])).split('\0').flatMap(entry => {
  const match = entry.match(/^160000 commit ([0-9a-f]{40})\t(.+)$/);
  return match ? [[match[2], match[1]]] : [];
}));
if (!samePaths([...modules.values()].map(module => module.path), sources) || !samePaths([...links.keys()], sources)) {
  throw new Error('Built-in catalog sources, .gitmodules paths and committed gitlinks must agree.');
}
for (const module of modules.values()) {
  if (!/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\.git$/.test(module.url ?? '')) {
    throw new Error(`Use a public GitHub HTTPS URL for ${module.path}.`);
  }
  if (module.branch !== 'main') {
    throw new Error(`Built-in apps must publish from main: ${module.path}.`);
  }
}

const temporary = await mkdtemp(join(tmpdir(), 'praxis-public-sources-'));
const home = join(temporary, 'home');
await mkdir(home);
// Do not inherit developer credentials, credential helpers or checkout tokens.
const env = {
  PATH: process.env.PATH, HOME: home, LANG: 'C.UTF-8',
  GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_SYSTEM: '/dev/null', GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_COUNT: '0', GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never',
};
try {
  for (const module of modules.values()) {
    const sha = links.get(module.path);
    const destination = populate ? join(root, module.path) : join(temporary, module.path);
    if (populate) {
      await mkdir(destination, { recursive: true });
      if ((await readdir(destination)).length) throw new Error(`Refusing to replace a nonempty worktree: ${module.path}`);
    } else await mkdir(destination, { recursive: true });
    await git(['init', '--quiet', destination], { env });
    await git(['-C', destination, 'remote', 'add', 'origin', module.url], { env });
    const releaseRef = 'refs/heads/main';
    const head = await git(['ls-remote', '--symref', module.url, 'HEAD'], { env });
    if (head.match(/^ref: (refs\/heads\/\S+)\tHEAD$/m)?.[1] !== releaseRef) {
      throw new Error(`The public default branch must be main: ${module.path}.`);
    }
    await git(['-C', destination, 'fetch', '--quiet', '--no-tags', '--depth=1', 'origin', sha], { env });
    const fetched = (await git(['-C', destination, 'rev-parse', 'FETCH_HEAD'], { env })).trim();
    if (fetched !== sha) throw new Error(`Fetched revision differs from the gitlink: ${module.path}`);
    await git(['-C', destination, 'fetch', '--quiet', '--no-tags', 'origin', `${releaseRef}:refs/remotes/origin/release-check`], { env });
    try {
      await git(['-C', destination, 'merge-base', '--is-ancestor', sha, 'refs/remotes/origin/release-check'], { env });
    } catch (error) {
      if (error.code !== 1) throw error;
      throw new Error(`Pinned app revision has not landed in ${releaseRef}: ${module.path}`);
    }
    const tree = await git(['-C', destination, 'ls-tree', '-r', sha], { env });
    if (/^160000 /m.test(tree)) throw new Error(`Nested submodules need an explicit source review: ${module.path}`);
    if (populate) await git(['-C', destination, 'checkout', '--quiet', '--detach', sha], { env });
    console.log(`${module.path} ${sha} anonymously retrievable and released in ${releaseRef}${populate ? ' and checked out' : ''}`);
  }
  console.log(`Public app source check passed: ${apps.length} fixed revisions.`);
} finally {
  await rm(temporary, { recursive: true, force: true });
}
