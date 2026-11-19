import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { docker } from '../src/deployment/controller.mjs';

const workspace = fileURLToPath(new URL('../', import.meta.url)).replace(/\/$/, '');
const serviceName = /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/;
const commands = {
  check: ['config', '--quiet'],
  status: ['ps', '--all', '--format', 'table {{.Service}}\t{{.Status}}'],
  up: ['up', '--detach', '--no-deps', '--no-build', '--pull', 'never', '--wait'],
  recreate: ['up', '--detach', '--no-deps', '--no-build', '--pull', 'never', '--force-recreate', '--wait'],
  stop: ['stop'],
};
const safeName = name => typeof name === 'string' && serviceName.test(name);
const safePath = path => typeof path === 'string' && isAbsolute(path) && !/[\r\n\0]/.test(path);

export function installationProject(config, project) {
  if (['core', 'business'].includes(project) && !Object.hasOwn(config?.projects || {}, project)) {
    const compatible = project === 'core' ? 'business' : 'core';
    if (Object.hasOwn(config?.projects || {}, compatible)) return compatible;
  }
  return project;
}

export function composeArgs(config, [command, project, ...requested]) {
  if (!Object.hasOwn(commands, command) || !safeName(project)) throw Error('Usage: managed-compose.mjs check|status|up|recreate|stop PROJECT [SERVICE ...]');
  project = installationProject(config, project);
  if (config?.version !== 1 || !config.projects || !Object.hasOwn(config.projects, project)) throw Error('Unknown installation project.');
  const item = config.projects[project];
  if (!item || typeof item.name !== 'string' || !/^[a-z0-9][a-z0-9_-]*$/.test(item.name) ||
      !Array.isArray(item.files) || !item.files.length || !item.files.every(safePath) ||
      !Array.isArray(item.services) || !item.services.length || !item.services.every(safeName) ||
      (item.profiles !== undefined && (!Array.isArray(item.profiles) || !item.profiles.every(safeName))) ||
      (item.envFile !== undefined && !safePath(item.envFile))) throw Error('Invalid installation project.');
  requested = requested.map(name => ['core', 'business'].includes(name) && !item.services.includes(name) && item.services.includes(name === 'core' ? 'business' : 'core') ? (name === 'core' ? 'business' : 'core') : name);
  if (requested.some(name => !item.services.includes(name))) throw Error('Service is outside this installation project.');
  const args = ['compose', '--project-directory', workspace, '--project-name', item.name];
  for (const file of item.files) args.push('--file', file);
  if (item.envFile) args.push('--env-file', item.envFile);
  for (const profile of item.profiles || []) args.push('--profile', profile);
  return [...args, ...commands[command], ...(requested.length ? requested : item.services)];
}

async function main() {
  const file = process.env.PRAXIS_MANAGED_COMPOSE_FILE || join(homedir(), '.config/praxis/managed-checkout/managed-compose.json');
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  let config;
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.uid !== process.getuid() || info.mode & 0o077 || info.size > 1024 * 1024) throw Error('Expected a private installation file owned by the operator.');
    config = JSON.parse(await handle.readFile('utf8'));
  } finally { await handle.close(); }
  const output = await docker(composeArgs(config, process.argv.slice(2)), { cwd: workspace });
  process.stdout.write(output);
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch(error => {
    console.error(error instanceof SyntaxError ? 'Invalid installation JSON.' : error.message);
    process.exitCode = 1;
  });
}
