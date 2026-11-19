import { readFile, lstat, mkdir, writeFile, rename } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { loadConfig, writePrivateJson } from '../src/storage/config.mjs';
import { validateAppPathParents } from '../src/storage/app-paths.mjs';
import { planAppData, rebaseDeploymentPrototype, rebasePolarisEnvironment } from '../src/storage/app-data-plan.mjs';
import { validateRelocations, relocateVerified, rollbackRelocation } from '../src/storage/relocate.mjs';

export async function main(args = process.argv.slice(2), { print = console.log } = {}) {
  const [command = 'plan', ...flags] = args, opts = {};
  for (let i = 0; i < flags.length; i++) {
    if (flags[i] === '--writers-stopped') { opts.stopped = true; continue; }
    if (!['--config', '--business-config', '--polaris-config', '--finance-file', '--roots-file'].includes(flags[i]) || !flags[i + 1]) throw new Error('Invalid app-data option.');
    opts[flags[i].slice(2)] = resolve(flags[++i]);
  }
  if (!['plan', 'migrate'].includes(command)) throw new Error('Usage: app-data.mjs plan|migrate [--config PATH] [--business-config PATH] [--polaris-config PATH] [--finance-file PATH] [--roots-file PATH] [--writers-stopped]');
  const base = join(homedir(), '.config/praxis'), storageFile = opts.config || join(base, 'storage.json'), businessFile = opts['business-config'] || join(base, 'business.json'), polarisFile = opts['polaris-config'] || join(base, 'polaris.json');
  const json = async file => JSON.parse(await readFile(file, 'utf8'));
  const storage = await loadConfig(storageFile);
  if (opts['roots-file']) {
    const info = await lstat(opts['roots-file']);
    if (!info.isFile() || info.isSymbolicLink() || info.mode & 0o077 || info.uid !== process.getuid()) throw new Error('Root overrides require a private regular JSON file.');
    storage.workingData = { version: 1, roots: await json(opts['roots-file']) };
  }
  const business = await json(businessFile), polaris = await json(polarisFile);
  const reminderFile = business.apps.reminder.spacesFile, slidesFile = business.apps.slides.spacesFile;
  const plan = planAppData({ storage, business, reminderMapping: await json(reminderFile), slidesMapping: await json(slidesFile), polaris, financeFile: opts['finance-file'], configRoot: dirname(storageFile) });
  await validateAppPathParents(plan.paths);
  if (command === 'plan') { print(JSON.stringify({ roots: plan.paths.roots, moves: plan.moves }, null, 2)); return plan; }
  if (!opts.stopped) throw new Error('Migration requires stopped writers, agents and schedules; pass --writers-stopped after stopping them.');
  // This assertion covers external writers; existing listening services are also rejected.
  const { createConnection } = await import('node:net');
  for (const port of [4321, 4322, 4323, 4325, 4326, 4327, 4328, 4329, 4666, 5173, 8787, 9377, 18787, 14321, 14324, 14666, 15173]) {
    const open = await new Promise(accept => { const socket = createConnection({ host: '127.0.0.1', port }); const done = value => { socket.destroy(); accept(value); }; socket.setTimeout(250, () => done(false)); socket.once('connect', () => done(true)); socket.once('error', () => done(false)); });
    if (open) throw new Error('A data-writing service is still listening; no data was moved.');
  }
  if (!plan.moves.some(item => item.to === plan.paths.finance) && !await lstat(plan.paths.finance).catch(() => null)) throw new Error('Finance requires its existing data file or an explicit --finance-file source; no empty replacement was created.');
  const moves = await validateRelocations(plan.moves);
  const journalDir = join(dirname(storageFile), 'data-migrations', randomUUID());
  await mkdir(journalDir, { recursive: true, mode: 0o700 });
  const bindings = [[reminderFile, plan.reminderMapping], [slidesFile, plan.slidesMapping], [businessFile, plan.business], [polarisFile, plan.polaris], [storageFile, plan.storage]];
  const deploymentRoot = process.env.PRAXIS_DEPLOYMENT_DIR || join(dirname(businessFile), 'deployment');
  const manifest = await json(join(deploymentRoot, 'manifest.json')).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
  if (manifest?.enabled) {
    const state = await json(join(deploymentRoot, 'state/state.json'));
    if (!state.paused || state.writer !== null) throw new Error('Deployment must be stopped with its writer lease released.');
    for (const color of ['core', 'web']) { const file = join(deploymentRoot, 'prototypes', `${color}.json`); bindings.push([file, rebaseDeploymentPrototype(await json(file), plan.moves)]); }
  }
  for (let index = 0; index < bindings.length; index++) await writeFile(join(journalDir, `binding-${index}.json`), await readFile(bindings[index][0]), { mode: 0o600, flag: 'wx' });
  await writePrivateJson(join(journalDir, 'plan.json'), { roots: plan.paths.roots, moves });
  const completed = [];
  const oldPolarisEnvironment = polaris?.enabled ? await readFile(polaris.envFile, 'utf8') : null;
  const newPolarisEnvironment = oldPolarisEnvironment === null ? null : rebasePolarisEnvironment(oldPolarisEnvironment, polaris.dataRoot, plan.paths.polaris);
  const writeEnvironment = async value => { const temp = `${polaris.envFile}.${randomUUID()}.tmp`; await writeFile(temp, value, { mode: 0o600, flag: 'wx' }); await rename(temp, polaris.envFile); };
  let polarisHook;
  const polarisReport = join(journalDir, 'polaris-paths.json');
  try {
    for (const move of moves) { completed.push(await relocateVerified(move)); await writePrivateJson(join(journalDir, 'progress.json'), { completed }); }
    const polarisMove = moves.find(item => item.id === 'polaris' && item.from === polaris.dataRoot);
    if (polarisMove) {
      const { runDataRootRelocationCli } = await import('../third_party/polaris/apps/polaris/scripts/migrate-data-root.mjs');
      polarisHook = runDataRootRelocationCli;
      polarisHook(['--from-root', polarisMove.from, '--to-root', polarisMove.to, '--report', polarisReport, '--apply', '--writers-stopped']);
      polarisHook(['--verify', '--report', polarisReport]);
    }
    for (const root of Object.values(plan.paths.roots)) await mkdir(root, { recursive: true, mode: 0o700 });
    if (newPolarisEnvironment !== oldPolarisEnvironment) await writeEnvironment(newPolarisEnvironment);
    for (const [file, value] of bindings) await writePrivateJson(file, value);
    await writePrivateJson(join(journalDir, 'result.json'), { status: 'bindings-switched', completed });
  } catch (error) {
    if (newPolarisEnvironment !== oldPolarisEnvironment) await writeEnvironment(oldPolarisEnvironment);
    if (polarisHook && await lstat(polarisReport).catch(() => null)) polarisHook(['--rollback', '--report', polarisReport, '--writers-stopped']);
    for (const [index, [file]] of bindings.entries()) await writePrivateJson(file, JSON.parse(await readFile(join(journalDir, `binding-${index}.json`), 'utf8')));
    for (const move of completed.reverse()) await rollbackRelocation(move);
    throw error;
  }
  print(JSON.stringify({ migrated: completed.length, journal: journalDir, requires: 'Materialize initial content if absent; rebind paused deployment slots with verified image; rebuild/start; verify inventory.' }));
  return { plan, journalDir };
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) main().catch(error => { console.error(`App data migration failed: ${error.message}`); process.exitCode = 1; });
