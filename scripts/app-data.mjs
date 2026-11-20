import { DEFAULT_APP_REGISTRY } from '../src/default-app-registry.mjs';
import { readFile, lstat, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { loadConfig, writePrivateJson } from '../src/storage/config.mjs';
import { validateAppPathParents, storageEntries } from '../src/storage/app-paths.mjs';
import { planAppData, rebaseDeploymentPrototype } from '../src/storage/app-data-plan.mjs';
import { validateRelocations, relocateVerified, rollbackRelocation } from '../src/storage/relocate.mjs';

export async function main(args = process.argv.slice(2), { print = console.log } = {}) {
  const [command = 'plan', ...flags] = args, opts = {}, declarations = storageEntries(DEFAULT_APP_REGISTRY);
  const optionName = argument => argument.replace(/[A-Z]/g, letter => '-' + letter.toLowerCase());
  const appOptions = declarations.flatMap(({ storage }) => [storage.relocation?.legacyConfiguration?.configOption, ...(storage.relocation?.registeredRoots || []).flatMap(item => item.argument ? [optionName(item.argument)] : [])]).filter(Boolean);
  for (let i = 0; i < flags.length; i++) {
    if (flags[i] === '--writers-stopped') { opts.stopped = true; continue; }
    if (!['config', 'business-config', 'roots-file', ...appOptions].map(option => '--' + option).includes(flags[i]) || !flags[i + 1]) throw new Error('Invalid app-data option.');
    opts[flags[i].slice(2)] = resolve(flags[++i]);
  }
  if (!['plan', 'migrate'].includes(command)) throw new Error('Usage: app-data.mjs plan|migrate [--config PATH] [--business-config PATH] [--roots-file PATH] [--writers-stopped] ' + appOptions.map(option => '[--' + option + ' PATH]').join(' '));
  const base = join(homedir(), '.config/praxis'), storageFile = opts.config || join(base, 'storage.json'), businessFile = opts['business-config'] || join(base, 'business.json');
  const json = async file => { const bytes = await readFile(file, 'utf8'); try { return JSON.parse(bytes); } catch { throw new Error('Private deployment configuration contains invalid JSON.'); } };
  const storage = await loadConfig(storageFile);
  if (opts['roots-file']) {
    const info = await lstat(opts['roots-file']);
    if (!info.isFile() || info.isSymbolicLink() || info.mode & 0o077 || info.uid !== process.getuid()) throw new Error('Root overrides require a private regular JSON file.');
    storage.workingData = { version: 1, roots: await json(opts['roots-file']) };
  }
  const business = await json(businessFile), inputs = {}, inputFiles = [];
  for (const { storage: declaration, adapterId } of declarations) {
    const relocation = declaration.relocation || {}, map = relocation.spaceMap;
    if (map && business.apps?.[adapterId]) {
      const file = business.apps[adapterId][map.fileField];
      if (typeof file !== 'string') throw new Error('An app-owned configuration path is missing.');
      inputs[map.input] = await json(file); inputFiles.push([file, map.input]);
    }
    const legacy = relocation.legacyConfiguration;
    if (legacy?.configFile) {
      const file = opts[legacy.configOption] || join(dirname(storageFile), legacy.configFile);
      if (await lstat(file).catch(error => { if (error.code === 'ENOENT' && legacy.optional && !opts[legacy.configOption]) return null; throw error; })) { inputs[legacy.input] = await json(file); inputFiles.push([file, legacy.input]); }
    }
    for (const item of relocation.registeredRoots || []) if (item.argument && opts[optionName(item.argument)]) inputs[item.argument] = opts[optionName(item.argument)];
  }
  const plan = planAppData({ storage, business, ...inputs, configRoot: dirname(storageFile) });
  await validateAppPathParents(plan.paths);
  if (command === 'plan') { print(JSON.stringify({ roots: plan.paths.roots, moves: plan.moves, unavailable: plan.unavailable }, null, 2)); return plan; }
  if (!opts.stopped) throw new Error('Migration requires stopped writers, agents and schedules; pass --writers-stopped after stopping them.');
  if (plan.unavailable.length) throw new Error(plan.unavailable.map(item => item.reason).join(' '));
  // This assertion covers external writers; existing listening services are also rejected.
  const { createConnection } = await import('node:net');
  for (const port of new Set([4321, 4326, 14321, ...DEFAULT_APP_REGISTRY.apps.filter(app => app.integration.web.readOnly !== true).flatMap(app => [app.port, app.integration.web.nativePort, app.integration.deployment?.adapterPort, ...(app.integration.deployment?.writerPorts || [])])].filter(Number.isInteger))) {
    const open = await new Promise(accept => { const socket = createConnection({ host: '127.0.0.1', port }); const done = value => { socket.destroy(); accept(value); }; socket.setTimeout(250, () => done(false)); socket.once('connect', () => done(true)); socket.once('error', () => done(false)); });
    if (open) throw new Error('A data-writing service is still listening; no data was moved.');
  }
  for (const source of plan.storage.appSources) {
    const move = [...plan.moves].sort((a, b) => b.to.length - a.to.length).find(item => source.source === item.to || source.source.startsWith(item.to + '/'));
    const original = move ? move.from + source.source.slice(move.to.length) : source.source;
    if (!await lstat(original).catch(error => { if (error.code === 'ENOENT') return null; throw error; })) throw new Error('A required existing application store is missing; no empty replacement was created.');
  }
  const moves = await validateRelocations(plan.moves);
  const journalDir = join(dirname(storageFile), 'data-migrations', randomUUID());
  await mkdir(journalDir, { recursive: true, mode: 0o700 });
  const bindings = [...inputFiles.map(([file, key]) => [file, plan[key]]), [businessFile, plan.business], [storageFile, plan.storage]];
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
  try {
    for (const move of moves) { completed.push(await relocateVerified(move)); await writePrivateJson(join(journalDir, 'progress.json'), { completed }); }
    for (const root of Object.values(plan.paths.roots)) await mkdir(root, { recursive: true, mode: 0o700 });
    for (const [file, value] of bindings) await writePrivateJson(file, value);
    await writePrivateJson(join(journalDir, 'result.json'), { status: 'bindings-switched', completed });
  } catch (error) {
    for (const [index, [file]] of bindings.entries()) await writePrivateJson(file, JSON.parse(await readFile(join(journalDir, `binding-${index}.json`), 'utf8')));
    for (const move of completed.reverse()) await rollbackRelocation(move);
    throw error;
  }
  print(JSON.stringify({ migrated: completed.length, journal: journalDir, requires: 'Materialize initial content if absent; rebind paused deployment slots with verified image; rebuild/start; verify inventory.' }));
  return { plan, journalDir };
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) main().catch(error => { console.error(`App data migration failed: ${error.message}`); process.exitCode = 1; });
