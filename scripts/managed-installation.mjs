import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { composeArgs } from './managed-compose.mjs';
import { docker } from '../src/deployment/controller.mjs';

export const managedDescriptorFile = () => process.env.PRAXIS_MANAGED_COMPOSE_FILE || join(homedir(), '.config/praxis/managed-checkout/managed-compose.json');

export async function readManagedInstallation(file = managedDescriptorFile()) {
  let handle;
  try { handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.uid !== process.getuid() || info.mode & 0o077 || info.size > 1024 * 1024) throw new Error('Expected a private installation descriptor owned by the operator.');
    const config = JSON.parse(await handle.readFile('utf8'));
    if (config.version !== 1 || !config.projects || typeof config.projects !== 'object' || Array.isArray(config.projects)) throw new Error('Invalid installation descriptor.');
    for (const project of Object.keys(config.projects)) composeArgs(config, ['check', project]);
    return config;
  } finally { await handle.close(); }
}

export function installationCommand(config, project, command, requested = []) {
  const item = config.projects[project];
  if (!item) throw new Error('Installation project is not registered.');
  if (requested.some(name => !item.services.includes(name))) throw new Error('Service is outside this installation project.');
  const services = requested.length ? requested : item.services;
  if (command === 'up') return composeArgs(config, ['up', project, ...services]);
  if (command === 'down') return composeArgs(config, ['stop', project, ...services]);
  if (command === 'validate') return composeArgs(config, ['check', project]);
  const status = composeArgs(config, ['status', project, ...services]);
  const prefix = status.slice(0, status.indexOf('ps'));
  if (command === 'status') return [...prefix, 'ps', '--all', '--format', 'json', ...services];
  if (command === 'logs') return [...prefix, 'logs', '--tail', '100', ...services];
  if (command === 'build') return [...prefix, 'build', ...services];
  throw new Error('Unsupported installation command.');
}

export async function installationOperation(config, project, command, { services = [], execute = docker } = {}) {
  return execute(installationCommand(config, project, command, services));
}

export function installationStatus(output, item, ports = {}) {
  const text = String(output || '').trim();
  let rows = [];
  if (text) {
    try { const parsed = JSON.parse(text); rows = Array.isArray(parsed) ? parsed : [parsed]; }
    catch { rows = text.split('\n').filter(Boolean).map(line => JSON.parse(line)); }
  }
  const services = item.services.map(name => {
    const row = rows.find(value => value.Service === name);
    return { name, ...(ports[name] ? { port: ports[name] } : {}), state: row?.State || 'absent', health: row?.Health || 'unknown' };
  });
  return { projectName: item.name, healthy: services.every(service => service.state === 'running' && ['healthy', ''].includes(service.health)), services };
}
