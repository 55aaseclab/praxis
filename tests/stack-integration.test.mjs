import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadAppIntegrations } from '../src/app-integrations.mjs';
import { resolveStackSettings, stackRecipes, stackServiceInventory, stackEnvironment, validateData, writeComposeEnvironment, main } from '../scripts/stack.mjs';
import { writeInstalledAppsFixture } from './helpers/app-manifest-fixture.mjs';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'praxis-owned-stack-')); t.after(() => rm(root, { recursive: true, force: true }));
  await writeInstalledAppsFixture(root, [{ id: 'sample-notebook', name: 'Sample notebook' }]);
  const own = join(root, 'third_party/sample-notebook'); await mkdir(join(own, 'praxis'));
  await writeFile(join(own, 'praxis-integration.mjs'), `import {createStackIntegration} from './praxis/stack.mjs';export function createIntegration(){return {schemaVersion:1,appId:'sample-notebook',web:{slug:'notebook',policy:'grant',kind:'proxy',nativePort:45125},deployment:{stack:createStackIntegration()}}}`);
  await writeFile(join(own, 'praxis/stack.mjs'), `import{join,dirname}from'node:path';export function createStackIntegration(){return {
    services:[{name:'notebook',port:45125},{name:'notebook-public',port:45126}],
    resolveSources(ctx){const path=join(ctx.appsRoot,'notebook/notes.json');return {sources:[{key:'notebookStore',path}],data:[{path:dirname(path),kind:'directory'},{path,kind:'file',nonempty:true}]};},
    resolveRuntime(){return {settings:{notebookRuntime:'ready'},fingerprint:{notebookSchema:'v1'}}},
    environment:({settings})=>({PRAXIS_NOTEBOOK_DATA_FILE:settings.sourceMap.notebookStore}),
    compose:({settings})=>({services:{notebook:{environment:{NOTEBOOK_STORE:'/data/notes.json'},volumes:[{type:'bind',source:settings.sourceMap.notebookStore,target:'/data/notes.json',read_only:true,bind:{create_host_path:false}}]}}}),
    assets:async({compose})=>compose(['run','--rm','--no-deps','notebook-public','prepare-assets'])
  }}`);
  const registry = await loadAppIntegrations(root), configFile = join(root, 'storage.json');
  const config = { schemaVersion: 1, workspaceId: 'notebook-fixture', dataRoot: join(root, 'data'), deviceId: 'fixture-device', activeWriterDeviceId: 'fixture-device' };
  await writeFile(configFile, JSON.stringify(config)); const env = { PRAXIS_STORAGE_CONFIG: configFile, PRAXIS_UID: String(process.getuid?.() || 1000), PRAXIS_GID: String(process.getgid?.() || 1000), PRAXIS_PUBLIC_URLS_FILE: join(root, 'public-urls.json') };
  const settings = await resolveStackSettings({ registry, env, home: root });
  await mkdir(join(settings.appsRoot, 'notebook'), { recursive: true }); await writeFile(settings.sourceMap.notebookStore, '{"synthetic":true}'); await writeFile(settings.publicUrlsFile, '{"apps":{}}');
  return { root, registry, env, settings };
}

test('a reviewed additional app owns its stack services, source checks, environment, Compose patch and assets', async t => {
  const f = await fixture(t); assert.deepEqual(f.settings.services, { praxis: 4321, 'praxis-public': 14321, notebook: 45125, 'notebook-public': 45126 });
  assert.equal(f.settings.notebookRuntime, 'ready'); await validateData(f.settings); await writeComposeEnvironment(f.settings);
  const environment = await readFile(f.settings.envFile, 'utf8'); assert.ok(environment.includes('PRAXIS_NOTEBOOK_DATA_FILE=')); assert.ok(!environment.includes('REMINDER') && !environment.includes('SLIDES'));
  assert.equal((await stat(f.settings.envFile)).mode & 0o777, 0o600);
  const override = JSON.parse(await readFile(f.settings.runtimeOverrideFile, 'utf8')); assert.deepEqual(Object.keys(override.services), ['notebook']); assert.equal(override.services.notebook.volumes[0].bind.create_host_path, false); assert.equal(override.services.notebook.volumes[0].source, f.settings.sourceMap.notebookStore);
  const calls = [], run = async (command, args, options) => { calls.push({ command, args, options }); return ''; };
  await main(['assets'], { registry: f.registry, env: f.env, home: f.root, root: f.root, run, print() {} });
  assert.ok(calls.some(call => call.args.includes('notebook-public') && call.args.includes('prepare-assets')));
  assert.ok(!calls.some(call => call.args.includes('slides-public')));
  await rm(f.settings.sourceMap.notebookStore); await assert.rejects(validateData(f.settings), /Refusing to initialize or replace/);
  await assert.rejects(stat(f.settings.sourceMap.notebookStore), { code: 'ENOENT' });
});

test('app stack declarations cannot replace platform services, duplicate ports or override platform process settings', async t => {
  const f = await fixture(t), entry = f.registry.apps[0];
  const registry = stack => ({ apps: [{ ...entry, integration: { ...entry.integration, deployment: { stack } } }] });
  for (const services of [[{ name: 'praxis', port: 45125 }], [{ name: 'notebook', port: 4321 }], [{ name: '../control', port: 45125 }]]) assert.throws(() => stackServiceInventory(registry({ services })));
  assert.throws(() => stackRecipes(registry({ services: [], cliFlags: [{ flag: '--unsafe', setting: 'constructor' }] })));
  for (const key of ['HOME', 'PATH', 'NODE_OPTIONS', 'PRAXIS_UID', 'PRAXIS_COMPOSE_PROJECT']) assert.throws(() => stackEnvironment({ recipes: [{ stack: { environment: () => ({ [key]: 'synthetic' }) } }] }));
});
