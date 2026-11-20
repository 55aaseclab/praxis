import { spawn } from 'node:child_process';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, lstat, realpath, rm } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { DEFAULT_APP_REGISTRY } from '../src/default-app-registry.mjs';

const execute = promisify(execFile), platform = fileURLToPath(new URL('../', import.meta.url));
const fail = (message, exitCode = 1) => Object.assign(new Error(message), { exitCode });
const within = (root, path) => { const value = relative(root, path); return !value || value !== '..' && !value.startsWith('..' + sep) && !isAbsolute(value); };
const safeModule = value => typeof value === 'string' && value.endsWith('.mjs') && !isAbsolute(value) && !/[\\\x00-\x1f\x7f]/.test(value) && !value.split('/').some(part => !part || part === '.' || part === '..');
export function demoDeclaration(appId, registry = DEFAULT_APP_REGISTRY) {
  const app = registry.getApp(appId), declared = app?.integration.deployment?.demo;
  if (!app || declared?.supported !== true) throw fail('This installed app does not declare an isolated native demo.', 2);
  if (!safeModule(declared.module)) throw fail('The app demo requires a reviewed relative module.');
  return { app, declared };
}
export function demoEnvironment(base, extra = {}) {
  if (!extra || typeof extra !== 'object' || Array.isArray(extra)) throw fail('Invalid app demo environment.');
  const reserved = new Set(['PATH', 'HOME', 'TMPDIR', 'HOST', 'PORT', 'NODE_OPTIONS', 'PRAXIS_DEMO_APP', 'PRAXIS_APP_SOURCE_ROOT']);
  const environment = { ...base };
  for (const [name, value] of Object.entries(extra)) {
    if (!/^[A-Z][A-Z0-9_]{0,119}$/.test(name) || reserved.has(name) || typeof value !== 'string' || /[\x00\r\n]/.test(value)) throw fail('Demo recipes cannot replace isolated process settings.');
    environment[name] = value;
  }
  return environment;
}
function argumentsList(value) { return Array.isArray(value) && value.length > 0 && value.length <= 64 && value.every(item => typeof item === 'string' && item.length <= 4096 && !/[\0\r\n]/.test(item)); }
async function nodeEntry(args, directory) {
  if (!argumentsList(args) || !safeModule(args[0]) && !(typeof args[0] === 'string' && /\.js$/.test(args[0]) && !isAbsolute(args[0]) && !/[\\\x00-\x1f]/.test(args[0]) && !args[0].split('/').some(part => !part || part === '.' || part === '..'))) throw fail('Node demo commands require a relative app entry file.');
  const file = resolve(directory, args[0]), info = await lstat(file);
  if (!within(directory, file) || !info.isFile() || info.isSymbolicLink() || !within(directory, await realpath(file))) throw fail('The demo entry must stay inside its pinned app source.');
}

export async function main(args = process.argv.slice(2), { registry = DEFAULT_APP_REGISTRY, root = registry.root, print = console.log } = {}) {
  if (args.length < 1 || args.length > 2 || !/^[1-9][0-9]{0,4}$/.test(args[1] || '18432') || Number(args[1] || 18432) < 1024 || Number(args[1] || 18432) > 65535) throw fail('Usage: npm run app:demo -- <installed-app-id> [loopback-port]', 2);
  const appId = args[0], port = Number(args[1] || 18432), { app, declared } = demoDeclaration(appId, registry);
  const sourceDir = resolve(root, app.source);
  const { stdout } = await execute('git', ['-C', root, 'ls-tree', 'HEAD', '--', app.source]);
  const [mode, type, revision] = stdout.trim().split(/\s+/);
  if (mode !== '160000' || type !== 'commit' || !/^[a-f0-9]{40}$/.test(revision || '') || !await lstat(join(sourceDir, '.git')).catch(() => null)) throw fail('Initialize the exact pinned app source with git submodule update --init --recursive.');
  const previousMask = process.umask(0o077), demoRoot = await mkdtemp(join(process.env.TMPDIR || tmpdir(), 'praxis-' + appId + '-'));
  let active, signalCode = 0;
  const interrupt = signal => { signalCode = signal === 'SIGINT' ? 130 : 143; active?.kill(signal); };
  const onInterrupt = () => interrupt('SIGINT'), onTerminate = () => interrupt('SIGTERM');
  process.on('SIGINT', onInterrupt); process.on('SIGTERM', onTerminate);
  const run = (command, values, options) => new Promise((complete, reject) => {
    if (signalCode) return reject(Object.assign(fail('Demo interrupted.', signalCode), { interrupted: true }));
    const child = spawn(command, values, { ...options, stdio: 'inherit', shell: false }); active = child;
    child.once('error', reject);
    child.once('close', code => {
      if (active === child) active = null;
      if (signalCode) reject(Object.assign(fail('Demo interrupted.', signalCode), { interrupted: true }));
      else if (code === 0) complete(); else reject(fail('The isolated demo process failed.', code || 1));
    });
  });
  try {
    const appDir = join(demoRoot, 'app'), dataDir = join(demoRoot, 'data'), home = join(demoRoot, 'home'), archive = join(demoRoot, 'source.tar');
    await Promise.all([appDir, dataDir, home].map(path => mkdir(path, { mode: 0o700 })));
    await run('git', ['-C', sourceDir, 'archive', '--format=tar', '--output=' + archive, revision], { cwd: root });
    await run('tar', ['-xf', archive, '-C', appDir], { cwd: root }); await rm(archive);
    const moduleFile = resolve(appDir, declared.module), info = await lstat(moduleFile);
    if (!within(appDir, moduleFile) || !info.isFile() || info.isSymbolicLink() || info.size > 128 * 1024 || !within(appDir, await realpath(moduleFile))) throw fail('The pinned app demo module is unavailable or unsafe.');
    const imported = await import(pathToFileURL(moduleFile).href);
    const recipe = imported.createDemoIntegration?.();
    if (recipe?.supported !== true || typeof recipe.plan !== 'function') throw fail('The pinned source does not supply its declared demo recipe.');
    const plan = await recipe.plan(Object.freeze({ appDir, dataDir, home, port }));
    if (!plan || !Array.isArray(plan.steps) || plan.steps.length > 8 || !plan.server || !argumentsList(plan.server.args)) throw fail('Invalid app-owned demo plan.');
    const base = { PATH: process.env.PATH || '', HOME: home, TMPDIR: demoRoot, HOST: '127.0.0.1', PORT: String(port) };
    for (const step of plan.steps) {
      if (!step || !['npm', 'node'].includes(step.command) || !argumentsList(step.args)) throw fail('Invalid app-owned demo preparation.');
      if (step.command === 'node') await nodeEntry(step.args, appDir);
      await run(step.command === 'node' ? process.execPath : 'npm', step.args, { cwd: appDir, env: demoEnvironment(base, step.environment) });
    }
    await nodeEntry(plan.server.args, appDir);
    const env = { ...demoEnvironment(base, plan.server.environment), PRAXIS_DEMO_APP: appId, ...(process.env.PRAXIS_APP_SOURCE_ROOT ? { PRAXIS_APP_SOURCE_ROOT: process.env.PRAXIS_APP_SOURCE_ROOT } : {}) };
    print(`Starting ${appId} on loopback. Open the demo workbench URL. Press Ctrl-C to discard the demo.`);
    await run(process.execPath, ['--import', join(platform, 'scripts/demo-workbench.mjs'), ...plan.server.args], { cwd: appDir, env });
  } finally {
    process.off('SIGINT', onInterrupt); process.off('SIGTERM', onTerminate);
    if (active && active.exitCode === null && active.signalCode === null) { active.kill('SIGTERM'); await new Promise(resolve => active.once('close', resolve)); }
    await rm(demoRoot, { recursive: true, force: true }); process.umask(previousMask);
  }
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) main().catch(error => { if (!error.interrupted) console.error(error.message); process.exitCode = error.exitCode || 1; });
