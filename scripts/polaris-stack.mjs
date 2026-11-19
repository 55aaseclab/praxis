import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { docker } from '../src/deployment/controller.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
export const POLARIS_SERVICES = Object.freeze(['viewer', 'ingress']);
const defaultConfig = () => process.env.PRAXIS_POLARIS_VIEWER_ENV || join(homedir(), '.config/praxis/managed-checkout/polaris-viewer.env');

export async function polarisStackPlan(file = defaultConfig()) {
  file = resolve(file);
  let handle;
  try { handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW); }
  catch (error) { if (error.code === 'ENOENT') return { enabled: false, healthy: true, services: [] }; throw error; }
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.mode & 0o077 || stat.uid !== process.getuid() || stat.size > 65536) throw new Error('Polaris viewer configuration must be a private regular file owned by the operator.');
    const values = {};
    const allowed = new Set(['PRAXIS_POLARIS_VIEWER_REVISION', 'PRAXIS_POLARIS_OBSERVATIONS_FILE', 'PRAXIS_WORKSPACE_ID', 'PRAXIS_VIEWER_UID', 'PRAXIS_VIEWER_GID']);
    for (const line of (await handle.readFile('utf8')).split(/\r?\n/)) {
      if (!line.trim() || line.trimStart().startsWith('#')) continue;
      const match = /^([A-Z_]+)=(.*)$/.exec(line);
      if (!match || !allowed.has(match[1]) || Object.hasOwn(values, match[1]) || /[\0\r\n]/.test(match[2])) throw new Error('Use the read-only Polaris viewer environment configuration.');
      values[match[1]] = match[2];
    }
    if (!/^[a-f0-9]{40}$/.test(values.PRAXIS_POLARIS_VIEWER_REVISION || '') ||
        !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/.test(values.PRAXIS_WORKSPACE_ID || '') ||
        !isAbsolute(values.PRAXIS_POLARIS_OBSERVATIONS_FILE || '') ||
        !/^\d+$/.test(values.PRAXIS_VIEWER_UID || '') || values.PRAXIS_VIEWER_UID === '0' ||
        !/^\d+$/.test(values.PRAXIS_VIEWER_GID || '')) throw new Error('Polaris viewer requires a pinned revision, workspace, observation file and non-root owner.');
    return { enabled: true, configFile: file, projectName: 'praxis-polaris-viewer', services: [...POLARIS_SERVICES] };
  } finally { await handle.close(); }
}

export async function main(args = process.argv.slice(2), { print = console.log, execute = docker } = {}) {
  const [command = 'status', ...flags] = args;
  if (!['plan', 'validate', 'build', 'up', 'down', 'status', 'logs'].includes(command) || flags.length && (flags.length !== 2 || flags[0] !== '--config')) throw new Error('Usage: polaris-stack.mjs plan|validate|build|up|down|status|logs [--config VIEWER_ENV]');
  const emit = typeof print === 'function' ? print : () => {};
  const plan = await polarisStackPlan(flags[1] || defaultConfig());
  if (!plan.enabled) { emit(JSON.stringify(plan)); return plan; }
  const prefix = ['compose', '--project-directory', root, '--project-name', plan.projectName, '--env-file', plan.configFile,
    '--file', join(root, 'compose.polaris-viewer.yaml'), '--file', join(root, 'compose.polaris-observations.yaml')];
  if (['plan', 'validate'].includes(command)) {
    await execute([...prefix, 'config', '--quiet']);
    emit(JSON.stringify(plan)); return plan;
  }
  if (command === 'build') {
    const { spawn } = await import('node:child_process');
    await new Promise((resolveBuild, reject) => {
      const child = spawn('bash', [join(root, 'scripts/build-polaris-viewer.sh')], { cwd: root, stdio: 'inherit' });
      child.once('error', reject);
      child.once('close', code => code === 0 ? resolveBuild() : reject(new Error('Polaris viewer build failed.')));
    });
    emit(JSON.stringify(plan)); return plan;
  }
  const operations = { up: ['up', '-d', '--wait'], down: ['stop'], status: ['ps', '--all', '--format', 'json'], logs: ['logs', '--tail', '100'] };
  const output = await execute([...prefix, ...operations[command], ...plan.services]);
  if (command !== 'status') { if (output) emit(output); return plan; }
  let rows; try { const value = JSON.parse(output || '[]'); rows = Array.isArray(value) ? value : [value]; }
  catch { rows = String(output).trim().split('\n').filter(Boolean).map(line => JSON.parse(line)); }
  const services = plan.services.map(name => {
    const row = rows.find(value => value.Service === name);
    return { name, state: row?.State || 'absent', health: row?.Health || 'unknown' };
  });
  const result = { enabled: true, healthy: services.every(service => service.state === 'running' && service.health === 'healthy'), services };
  emit(JSON.stringify(result));
  return result;
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
