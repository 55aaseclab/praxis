import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, chmod, lstat, readdir, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadProviderDescriptors, collectProviderRuntime, readDockerSnapshots, publishProviderRuntime, parseProviderRuntimeArgs, writeProviderRuntime } from '../scripts/provider-runtime.mjs';

const projects = { version: 1, appId: 'projects', source: 'third_party/projects', dataSources: [{ id: 'database', location: { env: 'PROJECTS_DATA_DIR', relative: 'projects.db' } }] };
const slides = { version: 1, appId: 'lattice-slides', adapterAppId: 'slides', source: 'third_party/lattice', dataSources: [{ id: 'records', location: { env: 'SLIDES_BUSINESS_SPACES_FILE', map: 'spaces' } }] };
const mount = { Type: 'bind', Source: '/synthetic/private/projects', Destination: '/data', RW: true };
const snapshot = { service: 'projects', environment: ['PROJECTS_DATA_DIR=/data', 'PROJECTS_BUSINESS_KEY_FILE=/private/key', 'PASSWORD=not-for-output'], workingDirectory: '/app', mounts: [mount] };

test('installed provider descriptors own allowed path variables and aliases', async () => {
  const loaded = await loadProviderDescriptors({ root: '/synthetic/source', catalog: [{ builtin: true, id: 'projects', source: 'third_party/projects' }, { builtin: false, id: 'private-local', source: '/not-read' }], importProvider: async url => {
    assert.equal(url, 'file:///synthetic/source/third_party/projects/praxis-provider.mjs'); return { describe: () => projects };
  } });
  assert.equal(loaded.length, 1); assert.equal(loaded[0].source, 'third_party/projects');
  await assert.rejects(loadProviderDescriptors({ catalog: [{ builtin: true, id: 'projects', source: '../escape' }] }), { code: 'INVALID_APP_SOURCE' });
});
test('secret-named variables are rejected rather than read or published', async () => {
  for (const name of ['APP_KEY_FILE', 'APP_PASSWORD', 'ACCESS_TOKEN', 'PRIVATE_SECRET', 'PROVIDER_CREDENTIALS']) {
    const bad = { ...projects, dataSources: [{ location: { env: name } }] };
    assert.throws(() => collectProviderRuntime({ providers: [bad], snapshots: [] }), { code: 'UNSAFE_DATA_ENVIRONMENT' });
  }
});
test('watch descriptor reads discover app-source updates instead of retaining an old ESM import', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'praxis-provider-descriptors-')); t.after(() => rm(directory, { recursive: true, force: true }));
  const app = join(directory, 'third_party/projects'); await mkdir(app, { recursive: true }); const file = join(app, 'praxis-provider.mjs');
  const catalog = [{ builtin: true, id: 'projects', source: 'third_party/projects' }];
  await writeFile(file, `export const describe = () => (${JSON.stringify(projects)});\n`);
  assert.equal((await loadProviderDescriptors({ root: directory, catalog }))[0].dataSources[0].location.env, 'PROJECTS_DATA_DIR');
  const updated = { ...projects, dataSources: [{ id: 'database', location: { env: 'PROJECTS_DATA_DIRECTORY' } }] };
  await writeFile(file, `export const describe = () => (${JSON.stringify(updated)});\n`);
  assert.equal((await loadProviderDescriptors({ root: directory, catalog }))[0].dataSources[0].location.env, 'PROJECTS_DATA_DIRECTORY');
});
test('metadata includes only declared path variables and normalized mount fields', () => {
  const output = collectProviderRuntime({ providers: [projects], snapshots: [snapshot, { service: 'business-agent', environment: ['AGENT_CONFIG=/private/session'], mounts: [{ Type: 'bind', Source: '/private/session', Destination: '/session' }] }], now: 0 });
  assert.equal(output.generatedAt, '1970-01-01T00:00:00.000Z'); assert.equal(output.apps[0].status, 'ready');
  assert.deepEqual(output.apps[0].environment, { PROJECTS_DATA_DIR: '/data' });
  assert.deepEqual(output.apps[0].mounts, [{ source: '/synthetic/private/projects', destination: '/data', type: 'bind' }]);
  assert.ok(!JSON.stringify(output).match(/PASSWORD|not-for-output|BUSINESS_KEY|\/private\/session|"RW"/));
});
test('adapter aliases with a conventional suffix need declared source-path evidence', () => {
  const output = collectProviderRuntime({ providers: [slides], snapshots: [
    { service: 'slides-business', environment: ['SLIDES_BUSINESS_SPACES_FILE=/config/spaces.json'], workingDirectory: '/business', mounts: [] },
    { service: 'slides-agent', environment: ['SLIDES_BUSINESS_SPACES_FILE=/private/agent'], mounts: [] },
    { service: 'lattice-runtime', environment: [], workingDirectory: '/unproven', mounts: [] },
  ] });
  assert.equal(output.apps[0].bindings.length, 1); assert.equal(output.apps[0].workingDirectory, '/business');
  assert.equal(output.apps[0].bindings[0].role, 'business');
  assert.ok(!JSON.stringify(output).includes('/private/agent')); assert.ok(!JSON.stringify(output).includes('/unproven'));
});
test('identical blue/green bindings coalesce and conflicts never choose a writer', () => {
  const identical = collectProviderRuntime({ providers: [projects], snapshots: [snapshot, structuredClone(snapshot)] }).apps[0];
  assert.equal(identical.status, 'ready'); assert.equal(identical.bindings.length, 1);
  const conflict = collectProviderRuntime({ providers: [projects], snapshots: [snapshot, { ...snapshot, environment: ['PROJECTS_DATA_DIR=/different'], workingDirectory: '/other', mounts: [{ ...mount, Source: '/other/source' }] }] }).apps[0];
  assert.equal(conflict.status, 'unknown'); assert.deepEqual(conflict.environment, {}); assert.equal(conflict.workingDirectory, undefined); assert.deepEqual(conflict.mounts, []);
  assert.deepEqual(conflict.conflicts.map(value => value.kind), ['environment', 'working-directory', 'mount']); assert.equal(conflict.bindings.length, 2);
});
test('discovery never inspects unrelated private sessions and requests no raw config', async () => {
  const calls = [];
  const execute = async args => {
    calls.push(args);
    if (args[0] === 'ps') return 'aaaaaaaaaaaa\tprojects\nbbbbbbbbbbbb\tagent\ncccccccccccc\tprojects-agent\ndddddddddddd\t\n';
    assert.equal(args.at(-1), 'aaaaaaaaaaaa');
    const format = args[2]; assert.ok(format.includes('PROJECTS_DATA_DIR')); assert.ok(!format.includes('BUSINESS_KEY')); assert.ok(!format.includes('.Config.Cmd')); assert.ok(!format.includes('{{json .Config}}'));
    return JSON.stringify({ environment: ['PROJECTS_DATA_DIR=/data'], workingDirectory: '/app', mounts: [mount] });
  };
  const selected = await readDockerSnapshots({ providers: [projects], execute });
  assert.equal(calls.length, 2); assert.equal(selected.length, 1);
  assert.deepEqual(collectProviderRuntime({ providers: [projects], snapshots: selected }).apps[0].environment, { PROJECTS_DATA_DIR: '/data' });
});
test('public catalog app labels identify a generic viewer before inspecting only its declared paths', async () => {
  const observer = { version: 1, appId: 'runtime-demo', source: 'third_party/runtime-demo', dataSources: [{ id: 'observations', location: { env: 'RUNTIME_OBSERVATIONS_FILE' } }] };
  const inspected = [];
  const execute = async args => {
    if (args[0] === 'ps') {
      assert.ok(args[2].includes('io.praxis.app')); assert.ok(args[2].includes('io.praxis.role'));
      return 'aaaaaaaaaaaa\tviewer\truntime-demo\tnative\nbbbbbbbbbbbb\tingress\t\t\ncccccccccccc\tagent\tother-app\tnative\ndddddddddddd\tviewer\truntime-demo\tunsafe-role\n';
    }
    inspected.push(args.at(-1)); assert.ok(args[2].includes('RUNTIME_OBSERVATIONS_FILE')); assert.ok(!args[2].includes('PASSWORD'));
    return JSON.stringify({ environment: ['RUNTIME_OBSERVATIONS_FILE=/run/approved/observations.json'], workingDirectory: '/app', mounts: [] });
  };
  const snapshots = await readDockerSnapshots({ providers: [observer], execute });
  assert.deepEqual(inspected, ['aaaaaaaaaaaa']);
  const value = collectProviderRuntime({ providers: [observer], snapshots }).apps[0];
  assert.equal(value.status, 'ready'); assert.equal(value.bindings[0].service, 'viewer'); assert.equal(value.bindings[0].role, 'native');
  assert.deepEqual(value.environment, { RUNTIME_OBSERVATIONS_FILE: '/run/approved/observations.json' });
});
test('reader and viewer suffix fallback still requires the app alias and declared path evidence', () => {
  const value = collectProviderRuntime({ providers: [projects], snapshots: [
    { service: 'viewer', environment: ['PROJECTS_DATA_DIR=/unowned'], mounts: [] },
    { service: 'projects-reader', environment: ['PROJECTS_DATA_DIR=/approved'], mounts: [] },
    { service: 'projects-viewer', environment: [], mounts: [] },
  ] }).apps[0];
  assert.equal(value.bindings.length, 1); assert.equal(value.bindings[0].service, 'projects-reader'); assert.equal(value.environment.PROJECTS_DATA_DIR, '/approved');
});
test('missing and unsupported runtime sources have explicit states', () => {
  const output = collectProviderRuntime({ providers: [projects, { appId: 'field-notes', source: 'third_party/field-notes', dataSources: [], unsupported: true }], snapshots: [] });
  assert.equal(output.apps[0].status, 'unknown'); assert.equal(output.apps[1].status, 'unsupported');
  assert.deepEqual(output.apps[0].mounts, []);
});
test('atomic metadata publication stays outside source with private permissions', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'praxis-provider-runtime-')); t.after(() => rm(directory, { recursive: true, force: true }));
  const parent = join(directory, 'private'), output = join(parent, 'runtime.json');
  const result = await publishProviderRuntime({ output, providers: [projects], snapshots: [snapshot], now: 0 });
  assert.equal((await lstat(parent)).mode & 0o777, 0o700); assert.equal((await lstat(output)).mode & 0o777, 0o600);
  assert.deepEqual(JSON.parse(await readFile(output, 'utf8')), result); assert.deepEqual(await readdir(parent), ['runtime.json']);
  await publishProviderRuntime({ output, providers: [projects], snapshots: [], now: 1 });
  assert.equal(JSON.parse(await readFile(output, 'utf8')).apps[0].status, 'unknown');
  await assert.rejects(writeProviderRuntime(join(process.cwd(), 'runtime.json'), result), { code: 'RUNTIME_OUTPUT_IN_SOURCE' });
});
test('metadata output refuses symlinked or public parents without changing targets', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'praxis-provider-runtime-')); t.after(() => rm(directory, { recursive: true, force: true }));
  const actual = join(directory, 'actual'); await mkdir(actual, { mode: 0o700 }); const link = join(directory, 'linked'); await symlink(actual, link);
  await assert.rejects(writeProviderRuntime(join(link, 'runtime.json'), {}), { code: 'UNSAFE_RUNTIME_OUTPUT' });
  const publicDirectory = join(directory, 'public'); await mkdir(publicDirectory, { mode: 0o755 }); await chmod(publicDirectory, 0o755);
  await assert.rejects(writeProviderRuntime(join(publicDirectory, 'runtime.json'), {}), { code: 'UNSAFE_RUNTIME_OUTPUT' });
  assert.deepEqual(await readdir(actual), []);
});
test('CLI requires an explicit destination and supports a 30-second watch default', () => {
  assert.deepEqual(parseProviderRuntimeArgs(['--output', '/synthetic/runtime.json']), { output: '/synthetic/runtime.json', watch: false });
  assert.deepEqual(parseProviderRuntimeArgs(['--output', '/synthetic/runtime.json', '--watch']), { output: '/synthetic/runtime.json', watch: 30 });
  assert.equal(parseProviderRuntimeArgs(['--watch', '15', '--output', '/synthetic/runtime.json']).watch, 15);
  for (const args of [[], ['--output','/synthetic/runtime.json','--watch','0'], ['--output','/synthetic/runtime.json','--unknown']]) assert.throws(() => parseProviderRuntimeArgs(args));
});
