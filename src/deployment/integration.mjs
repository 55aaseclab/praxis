import { dirname, isAbsolute, join, resolve } from 'node:path';
import { lstat, readFile } from 'node:fs/promises';

export function deploymentRoot(configFile, env = process.env) {
  const root = env.PRAXIS_DEPLOYMENT_DIR || join(dirname(resolve(configFile)), 'deployment');
  if (!isAbsolute(root)) throw new Error('PRAXIS_DEPLOYMENT_DIR must be absolute.');
  return resolve(root);
}

export async function deploymentOverrides(configFile, env = process.env) {
  const root = deploymentRoot(configFile, env);
  let info;
  try { info = await lstat(join(root, 'manifest.json')); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  if (!info.isFile() || info.size > 1024 * 1024 || (info.mode & 0o077)) throw new Error('Deployment manifest must be a private bounded regular file.');
  const manifest = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8'));
  if (manifest.enabled !== true) return null;
  const paths = { root, apps: join(root, 'compose.apps.yml'), core: join(root, 'compose.business.yml'), business: join(root, 'compose.business.yml') };
  for (const file of [paths.apps, paths.business]) {
    const stat = await lstat(file);
    if (!stat.isFile() || (stat.mode & 0o077)) throw new Error('Deployment overrides must be private regular files.');
  }
  const prototypeFile = join(root, 'prototypes/core.json');
  try {
    const stat = await lstat(prototypeFile);
    if (!stat.isFile() || (stat.mode & 0o077) || stat.size > 1024 * 1024) throw new Error('Core prototype must be a private bounded regular file.');
    const prototype = JSON.parse(await readFile(prototypeFile, 'utf8'));
    paths.coreService = prototype.Config?.Labels?.['com.docker.compose.service'];
    if (!['core', 'business'].includes(paths.coreService)) throw new Error('Core prototype must identify its Compose facade.');
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  return paths;
}
