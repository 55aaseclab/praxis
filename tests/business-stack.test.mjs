import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, link, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { once } from 'node:events';
import { randomUUID, createHash } from 'node:crypto';
import { BUSINESS_HEALTHCHECK, businessStackPlan, runBusinessStack, coreInstallation } from '../scripts/business-stack.mjs';

const runFile = promisify(execFile);
async function fixture(t, { managed = false, cleanup = true } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'praxis-business-stack-'));
  if (cleanup) t.after(() => rm(root, { recursive: true, force: true }));
  const directory = join(root, 'private'), configuration = join(directory, 'config');
  const state = join(directory, 'state'), secret = join(directory, 'secrets'), data = join(directory, 'app-data');
  for (const path of [directory, configuration, state, join(state, 'auth'), join(state, 'events'), secret, data]) await mkdir(path, { mode: 0o700 });
  const keyFile = join(secret, 'reminder.key'), spacesFile = join(configuration, 'reminder-spaces.json');
  const configFile = join(configuration, 'business.json'), dataFile = join(data, 'checklist.json');
  await writeFile(keyFile, 'synthetic-signing-key-material-never-in-image', { mode: 0o600 });
  await writeFile(spacesFile, JSON.stringify({ spaces: { 'space-a': dataFile } }), { mode: 0o600 });
  const config = {
    issuer: 'https://business-synthetic.example', allowedHosts: ['127.0.0.1:17326'],
    database: join(state, 'auth/auth.db'), eventsDatabase: join(state, 'events/events.db'),
    apps: { reminder: { managed, url: 'http://127.0.0.1:4322/api/business', spaces: ['space-a'], keyFile, spacesFile } },
  };
  const save = () => writeFile(configFile, JSON.stringify(config), { mode: 0o600 });
  await save();
  return { root, config, configFile, keyFile, spacesFile, dataFile, data, state, configuration, save };
}
const plan = f => businessStackPlan(f.configFile, { port: 17326, projectName: 'praxis-business-synthetic' });

test('managed Slides mounts a separate JSON store and only its signing and space files', async t => {
  const f = await fixture(t);
  const dataDir = join(f.root, 'slides-data'); await mkdir(dataDir, { mode: 0o700 });
  const keyFile = join(f.configuration, 'slides.key'), spacesFile = join(f.configuration, 'slides.json');
  await writeFile(keyFile, 'synthetic-slides-signing-key-material', { mode: 0o600 });
  await writeFile(spacesFile, JSON.stringify({ spaces: { 'space-a': join(dataDir, 'personal.json') } }), { mode: 0o600 });
  f.config.apps.slides = { managed: true, url: 'http://127.0.0.1:4328/api/business', spaces: ['space-a'], keyFile, spacesFile, dataDir }; await f.save();
  const result = await plan(f), service = result.override.services['slides-business'];
  assert.equal(service.build.dockerfile, 'Dockerfile.praxis'); assert.equal(service.network_mode, 'host'); assert.equal(service.read_only, true);
  assert.deepEqual(service.volumes.filter(volume => !volume.read_only).map(volume => volume.source), [dataDir]);
  assert.deepEqual(service.volumes.filter(volume => volume.read_only).map(volume => volume.source).sort(), [keyFile, spacesFile].sort());
  assert.ok(result.ports.includes(4328));
  f.config.apps.slides.dataDir = join(f.state, 'auth'); await f.save();
  await assert.rejects(plan(f));
});

test('managed Slides adds only configured read-only native model caches to its own service', async t => {
  const f = await fixture(t), dataDir = join(f.root,'slides-data'), modelDir = join(f.root,'models'), piper = join(modelDir,'piper');
  for (const path of [dataDir,modelDir,piper]) await mkdir(path,{mode:0o700});
  await writeFile(join(piper,'model.onnx'),'synthetic-public-model',{mode:0o600});
  const keyFile = join(f.configuration,'slides.key'), spacesFile = join(f.configuration,'slides.json');
  await writeFile(keyFile,'synthetic-slides-signing-key-material',{mode:0o600});
  await writeFile(spacesFile,JSON.stringify({spaces:{'space-a':join(dataDir,'personal.json')}}),{mode:0o600});
  f.config.apps.slides = {managed:true,url:'http://127.0.0.1:4328/api/business',spaces:['space-a'],keyFile,spacesFile,dataDir,modelCaches:{piper}}; await f.save();
  const result = await plan(f), service = result.override.services['slides-business'];
  assert.equal(service.environment.LATTICE_PIPER_DIR,'/opt/lattice-model-cache/piper');
  assert.equal(service.environment.HOME,undefined);
  assert.deepEqual(service.volumes.find(volume=>volume.source===piper),{type:'bind',source:piper,target:'/opt/lattice-model-cache/piper',read_only:true,bind:{create_host_path:false}});
  assert.equal(result.override.services.core.volumes.some(volume=>volume.source===piper),false);
  assert.equal(result.override.services.core.environment.LATTICE_PIPER_DIR,undefined);
  f.config.apps.slides.modelCaches = {piper:join(f.state,'auth/piper')}; await mkdir(f.config.apps.slides.modelCaches.piper,{mode:0o700}); await f.save();
  await assert.rejects(plan(f),{code:'UNSAFE_MODEL_CACHE'});
});

async function enablePublisher(f) {
  const metadata = join(f.root, 'storage-metadata'), statusDirectory = join(f.root, 'private/console-status');
  for (const path of [metadata, statusDirectory, ...['snapshots', 'cache', 'docker'].map(name => join(metadata, name))]) await mkdir(path, { mode: 0o700 });
  const workspaceId = randomUUID(), deviceId = randomUUID(), storageFile = join(f.configuration, 'storage.json');
  const storage = { schemaVersion: 1, workspaceId, deviceId, activeWriterDeviceId: deviceId, dataRoot: join(f.root, 'working'), stateRoot: metadata, repositories: [{ id: 'local', type: 'local', path: join(f.root, 'encrypted'), passwordFile: join(f.root, 'private/secrets/recovery-key') }], appSources: [] };
  await writeFile(storageFile, JSON.stringify(storage), { mode: 0o600 });
  await writeFile(join(metadata, 'repositories.json'), JSON.stringify({ schemaVersion: 1, workspaceId, headSnapshotId: null, targets: {} }), { mode: 0o600 });
  await writeFile(join(metadata, 'worker-heartbeat.json'), JSON.stringify({ schemaVersion: 1, workspaceId, configDigest: createHash('sha256').update(await readFile(storageFile)).digest('hex'), watcherRunning: true, heartbeatAt: new Date().toISOString(), lastResultStatus: 'starting' }), { mode: 0o600 });
  await writeFile(join(metadata, 'snapshots/private-body.json'), 'PRIVATE-SYNTHETIC-PAYLOAD', { mode: 0o600 });
  f.config.console = { storageStatusFile: join(statusDirectory, 'storage-status.json'), storageConfigFile: storageFile };
  await f.save();
  return { metadata, statusDirectory, storageFile, storage };
}

test('business stack mounts only identity/event directories writable and precise private files read-only', async t => {
  const f = await fixture(t), result = await plan(f), service = result.override.services.core;
  assert.deepEqual(Object.keys(result.override.services), ['core']);
  assert.deepEqual(service.command.slice(-2), ['--port', '17326']);
  assert.equal(service.environment.HEALTH_URL, 'http://127.0.0.1:17326/health');
  const writable = service.volumes.filter(volume => !volume.read_only).map(volume => volume.source);
  assert.deepEqual(writable.sort(), [join(f.state, 'auth'), join(f.state, 'events')].sort());
  assert.deepEqual(service.volumes.filter(volume => volume.read_only).map(volume => volume.source).sort(), [f.configFile, f.keyFile].sort());
  assert.ok(service.volumes.every(volume => volume.bind.create_host_path === false && volume.source === volume.target));
  assert.equal(service.user, `${process.getuid?.() ?? 1000}:${process.getgid?.() ?? 1000}`);
  assert.equal(service.volumes.some(volume => result.overrideFile.startsWith(`${volume.source}/`)), false);
  assert.equal(JSON.stringify(result.override).includes('synthetic-signing-key-material'), false);
});

test('business stack rejects public permissions, symlink aliases, hard links and nonowner files', async t => {
  const f = await fixture(t);
  await chmod(f.configFile, 0o644);
  await assert.rejects(plan(f), { code: 'UNSAFE_PRIVATE_PATH' });
  await chmod(f.configFile, 0o600);
  const alias = join(f.configuration, 'alias.json');
  await symlink(f.configFile, alias);
  await assert.rejects(businessStackPlan(alias, { port: 17326 }), { code: 'UNSAFE_PRIVATE_PATH' });
  await link(f.keyFile, join(f.configuration, 'key-hardlink'));
  await assert.rejects(plan(f), { code: 'UNSAFE_PRIVATE_PATH' });
  await rm(join(f.configuration, 'key-hardlink'));
  await chmod(join(f.state, 'auth'), 0o755);
  await assert.rejects(plan(f), { code: 'UNSAFE_PRIVATE_PATH' });
  await chmod(join(f.state, 'auth'), 0o700);
  const uid = process.getuid();
  t.mock.method(process, 'getuid', () => uid + 1);
  await assert.rejects(plan(f), { code: 'UNSAFE_PRIVATE_PATH' });
  t.mock.restoreAll();
});

test('business stack rejects broad or overlapping state and secret mounts', async t => {
  const f = await fixture(t);
  const original = f.config.database;
  f.config.database = f.config.eventsDatabase; await f.save();
  await assert.rejects(plan(f), { code: 'OVERLAPPING_STATE' });
  f.config.database = join(f.configuration, 'auth.db'); await f.save();
  await assert.rejects(plan(f), { code: 'OVERLAPPING_SECRET_MOUNT' });
  f.config.database = join('/home', 'auth.db'); await f.save();
  await assert.rejects(plan(f), { code: 'UNSAFE_PATH' });
  f.config.database = original; f.config.eventsDatabase = join(f.state, 'auth/child/events.db');
  await mkdir(join(f.state, 'auth/child'), { mode: 0o700 }); await f.save();
  await assert.rejects(plan(f), { code: 'OVERLAPPING_MOUNTS' });
});

test('managed Reminder is explicitly enabled with only data directories writable', async t => {
  const f = await fixture(t, { managed: true }), result = await plan(f), service = result.override.services.reminder;
  assert.equal(service.network_mode, 'host');
  assert.equal(service.build.dockerfile, 'Dockerfile.praxis');
  assert.equal(service.read_only, true);
  assert.deepEqual(result.ports, [17326, 4322]);
  assert.equal(service.environment.REMINDER_MANAGED, '1');
  assert.equal(service.environment.REMINDER_BUSINESS_UI_URL, `${f.config.issuer}/business/reminder/`);
  assert.deepEqual(service.volumes.filter(volume => !volume.read_only).map(volume => volume.source), [f.data]);
  assert.deepEqual(service.volumes.filter(volume => volume.read_only).map(volume => volume.source).sort(), [f.keyFile, f.spacesFile].sort());
  assert.equal(service.volumes.some(volume => volume.source === f.root || volume.source === f.state), false);
  await assert.rejects(stat(f.dataFile), { code: 'ENOENT' });
});

test('enabled source gateway binds both host-network business services to loopback only', async t => {
  const f = await fixture(t, { managed: true });
  f.config.webGateway = { enabled: true, originHost: 'origin.example' }; await f.save();
  const result = await plan(f);
  for (const name of ['core', 'reminder']) {
    const command = result.override.services[name].command;
    assert.equal(command[command.indexOf('--host') + 1], '127.0.0.1');
  }
  f.config.webGateway.enabled = false; await f.save();
  const legacy = await plan(f);
  for (const name of ['core', 'reminder']) { const command = legacy.override.services[name].command; assert.equal(command[command.indexOf('--host') + 1], '0.0.0.0'); }
});

test('managed Reminder rejects unapproved endpoints, mapping drift and writable secret overlap', async t => {
  const f = await fixture(t, { managed: true });
  f.config.apps.reminder.url = 'http://remote.example:4322/api/business'; await f.save();
  await assert.rejects(plan(f), { code: 'INVALID_MANAGED_ENDPOINT' });
  f.config.apps.reminder.url = 'http://127.0.0.1:4322/api/business'; await f.save();
  await writeFile(f.spacesFile, JSON.stringify({ spaces: { 'other-space': f.dataFile } }));
  await assert.rejects(plan(f), { code: 'INVALID_SPACE_MAPPING' });
  await writeFile(f.spacesFile, JSON.stringify({ spaces: { 'space-a': join(f.configuration, 'data.json') } }));
  await assert.rejects(plan(f), { code: 'OVERLAPPING_DATA_MOUNT' });
  await writeFile(f.spacesFile, JSON.stringify({ spaces: { 'space-a': resolve('src/private-task.json') } }));
  await assert.rejects(plan(f), { code: 'UNSAFE_DATA_PATH' });
  await writeFile(f.spacesFile, JSON.stringify({ spaces: { 'space-a': f.dataFile } }));
  await mkdir(join(f.data, '.git'), { mode: 0o700 });
  await assert.rejects(plan(f), { code: 'UNSAFE_PATH' });
});

test('generated Docker controls remain outside writable mounts and use private permissions', async t => {
  const f = await fixture(t), calls = [];
  await runBusinessStack('status', { configFile: f.configFile, port: 17326, execute: async (...args) => { calls.push(args); return '[]'; } });
  await assert.rejects(stat(join(f.configuration, 'business-docker')), { code: 'ENOENT' });
  await runBusinessStack('up', { configFile: f.configFile, port: 17326, portProbe: async () => false, execute: async (...args) => { calls.push(args); return '[]'; } });
  const result = await plan(f);
  assert.equal((await stat(result.controlDirectory)).mode & 0o777, 0o700);
  assert.equal((await stat(result.overrideFile)).mode & 0o777, 0o600);
  const generated = JSON.parse(await readFile(result.overrideFile, 'utf8'));
  assert.equal(generated.services.core.environment.PRAXIS_BUSINESS_CONFIG, f.configFile);
  assert.equal(calls[0][0], 'docker');
  assert.ok(calls[0][1].includes('praxis-core'));
  assert.equal(calls[0][2].env.PRAXIS_UID, String(process.getuid?.() ?? 1000));
});

test('optional observations share only a dedicated metadata directory with the business core', async t => {
  const f = await fixture(t, { managed: true });
  f.config.observationsFile = join(f.root, 'private/observability/observations.db'); await f.save();
  const before = await readFile(f.configFile), result = await plan(f);
  const core = result.override.services.core, reminder = result.override.services.reminder;
  assert.equal(core.environment.PRAXIS_OBSERVATIONS_FILE, f.config.observationsFile);
  assert.deepEqual(core.volumes.filter(volume => volume.source === result.observationsDirectory), [{ type: 'bind', source: result.observationsDirectory, target: result.observationsDirectory, bind: { create_host_path: false } }]);
  assert.equal(reminder.volumes.some(volume => volume.source === result.observationsDirectory), false);
  await assert.rejects(stat(result.observationsDirectory), { code: 'ENOENT' });
  await runBusinessStack('status', { configFile: f.configFile, port: 17326, execute: async () => '[]' });
  await assert.rejects(stat(result.observationsDirectory), { code: 'ENOENT' });
  await assert.rejects(stat(result.controlDirectory), { code: 'ENOENT' });
  await runBusinessStack('up', { configFile: f.configFile, port: 17326, portProbe: async () => false, execute: async () => '[]' });
  assert.equal((await stat(result.observationsDirectory)).mode & 0o777, 0o700);
  await assert.rejects(stat(f.config.observationsFile), { code: 'ENOENT' });
  assert.deepEqual(await readFile(f.configFile), before);
});

test('observations reject business data, secrets, controls, public paths and unsafe database files', async t => {
  const f = await fixture(t, { managed: true });
  for (const directory of [join(f.state, 'auth'), join(f.state, 'events'), f.data, join(f.root, 'private/secrets'), f.configuration, join(f.configuration, 'business-docker'), resolve('src'), '/tmp']) {
    f.config.observationsFile = join(directory, 'observations.db'); await f.save();
    await assert.rejects(plan(f), { code: 'UNSAFE_OBSERVATIONS_PATH' });
  }
  const directory = join(f.root, 'private/observability');
  f.config.observationsFile = join(directory, 'other.db'); await f.save();
  await assert.rejects(plan(f), { code: 'UNSAFE_OBSERVATIONS_PATH' });
  f.config.observationsFile = join(directory, 'observations.db'); await f.save();
  await mkdir(directory, { mode: 0o755 });
  await chmod(directory, 0o755);
  await assert.rejects(plan(f), { code: 'UNSAFE_OBSERVATIONS_PATH' });
  await chmod(directory, 0o700);
  await writeFile(f.config.observationsFile, 'Synthetic telemetry only.', { mode: 0o644 });
  await chmod(f.config.observationsFile, 0o644);
  await assert.rejects(plan(f), { code: 'UNSAFE_OBSERVATIONS_PATH' });
  await chmod(f.config.observationsFile, 0o600);
  await link(f.config.observationsFile, join(f.root, 'metadata-hardlink'));
  await assert.rejects(plan(f), { code: 'UNSAFE_OBSERVATIONS_PATH' });
  await rm(join(f.root, 'metadata-hardlink'));
  await writeFile(join(directory, 'secret.json'), '{}', { mode: 0o600 });
  await assert.rejects(plan(f), { code: 'UNSAFE_OBSERVATIONS_PATH' });
  await rm(join(directory, 'secret.json'));
  const alias = join(f.root, 'metadata-alias'); await symlink(directory, alias);
  f.config.observationsFile = join(alias, 'observations.db'); await f.save();
  await assert.rejects(plan(f), { code: 'UNSAFE_OBSERVATIONS_PATH' });
});

test('optional offline storage publisher exposes only sanitized metadata to core and never mounts it in Reminder', async t => {
  const f = await fixture(t, { managed: true }), input = await enablePublisher(f), result = await plan(f);
  assert.deepEqual(result.services, ['core', 'reminder', 'storage-status']);
  const core = result.override.services.core, publisher = result.override.services['storage-status'];
  assert.equal(core.volumes.some(volume => volume.source === input.storageFile || volume.source === input.metadata), false);
  assert.deepEqual(core.volumes.find(volume => volume.source === input.statusDirectory), { type: 'bind', source: input.statusDirectory, target: input.statusDirectory, read_only: true, bind: { create_host_path: false } });
  assert.equal(publisher.network_mode, 'none');
  assert.equal(publisher.read_only, true);
  assert.deepEqual(publisher.volumes.filter(volume => !volume.read_only).map(volume => volume.source), [input.statusDirectory]);
  assert.deepEqual(publisher.volumes.filter(volume => volume.read_only).map(volume => volume.source).sort(), [input.storageFile, input.metadata].sort());
  assert.equal(publisher.volumes.some(volume => [f.keyFile, f.config.database, f.config.eventsDatabase, f.data, '/var/run/docker.sock'].includes(volume.source)), false);
  assert.equal(publisher.tmpfs.filter(value => value.startsWith('/run/praxis-storage-metadata/')).length, 3);
  assert.equal(result.override.services.reminder.volumes.some(volume => [input.statusDirectory, input.metadata, input.storageFile].includes(volume.source)), false);
  await runBusinessStack('status', { configFile: f.configFile, port: 17326, execute: async () => '[]' });
  await assert.rejects(stat(f.config.console.storageStatusFile), { code: 'ENOENT' });
  await assert.rejects(stat(result.controlDirectory), { code: 'ENOENT' });
});

test('storage publisher refuses shared outputs and metadata inputs containing business sources', async t => {
  const f = await fixture(t, { managed: true }), input = await enablePublisher(f);
  for (const directory of [join(f.state, 'auth'), f.data, join(f.root, 'private/secrets'), input.metadata, f.configuration]) {
    f.config.console.storageStatusFile = join(directory, 'storage-status.json'); await f.save();
    await assert.rejects(plan(f), { code: 'UNSAFE_STATUS_PATH' });
  }
  f.config.console.storageStatusFile = join(input.statusDirectory, 'storage-status.json');
  input.storage.appSources = [{ id: 'synthetic', kind: 'json', target: 'data.json', source: join(input.metadata, 'private.json') }];
  await writeFile(input.storageFile, JSON.stringify(input.storage)); await f.save();
  await assert.rejects(plan(f), { code: 'UNSAFE_STATUS_INPUT' });
  delete f.config.console.storageStatusFile; await f.save();
  await assert.rejects(plan(f), { code: 'INVALID_STATUS_CONFIG' });
});

test('native port conflicts prevent up and down is restricted to the selected project without volume deletion', async t => {
  const f = await fixture(t), calls = [], execute = async (command, args) => { calls.push(args); return '[]'; };
  await assert.rejects(runBusinessStack('up', { configFile: f.configFile, port: 17326, projectName: 'praxis-business-synthetic-only', portProbe: async () => true, execute }), { code: 'PORT_IN_USE' });
  assert.ok(!calls.some(args => args.includes('up')));
  await runBusinessStack('down', { configFile: f.configFile, port: 17326, projectName: 'praxis-business-synthetic-only', execute });
  const down = calls.at(-1);
  assert.ok(down.includes('praxis-business-synthetic-only'));
  assert.ok(down.includes('down'));
  assert.ok(!down.includes('--volumes') && !down.includes('-v'));
});

test('managed Reminder port conflicts are checked independently from the business listener', async t => {
  const f = await fixture(t, { managed: true }), calls = [];
  await assert.rejects(runBusinessStack('up', { configFile: f.configFile, port: 17326, portProbe: async port => port === 4322, execute: async (command, args) => { calls.push(args); return '[]'; } }), { code: 'PORT_IN_USE' });
  assert.ok(!calls.some(args => args.includes('up')));
});

test('idempotent up accepts only its own running container on the exact requested port', async t => {
  const f = await fixture(t), calls = [];
  const execute = async (command, args) => {
    calls.push(args);
    if (args[0] === 'inspect') return JSON.stringify([{ HostConfig: { NetworkMode: 'host' }, Config: { Cmd: ['node', 'src/business/server.mjs', '--port', '17326'] } }]);
    if (args.includes('ps')) return JSON.stringify([{ Service: 'core', State: 'running', ID: 'synthetic-container' }]);
    return '';
  };
  await runBusinessStack('up', { configFile: f.configFile, port: 17326, execute, portProbe: async () => true });
  assert.ok(calls.some(args => args.includes('up') && args.includes('--force-recreate')));
  calls.length = 0;
  f.config.allowedHosts.push('127.0.0.1:17327'); await f.save();
  await assert.rejects(runBusinessStack('up', { configFile: f.configFile, port: 17327, execute, portProbe: async () => true }), { code: 'PORT_IN_USE' });
  assert.ok(!calls.some(args => args.includes('up')));
});

test('blue-green core facade is preserved while business applications remain single instances', async t => {
  const f = await fixture(t, { managed: true }), root = join(dirname(f.configFile), 'deployment'), calls = [];
  await mkdir(root, { mode: 0o700 });
  for (const [name, value] of [['manifest.json', '{"enabled":true}'], ['compose.apps.yml', 'services: {}'], ['compose.business.yml', 'services: {}']]) await writeFile(join(root, name), value, { mode: 0o600 });
  const execute = async (_command, args) => { calls.push(args); return '[]'; };
  await runBusinessStack('up', { configFile: f.configFile, port: 17326, execute, portProbe: async () => false });
  const starts = calls.filter(args => args.includes('up'));
  assert.equal(starts.length, 2);
  assert.ok(starts.every(args => args.includes(join(root, 'compose.business.yml'))));
  assert.equal(starts.find(args => args.includes('--no-recreate')).at(-1), 'core');
  const replace = starts.find(args => args.includes('--force-recreate'));
  assert.equal(replace.at(-1), 'reminder');
  assert.ok(!replace.includes('core'));
});

test('Docker health verifies each configured adapter rejects unsigned reads without using private credentials', () => {
  assert.match(BUSINESS_HEALTHCHECK, /Object\.entries\(config\.apps\)/);
  assert.match(BUSINESS_HEALTHCHECK, /\[401,403\]/);
  assert.ok(!BUSINESS_HEALTHCHECK.includes('readSigningKey'));
  assert.ok(!BUSINESS_HEALTHCHECK.includes('Authorization'));
});

if (process.env.PRAXIS_BUSINESS_DOCKER_TEST === '1') test('isolated Docker business service persists synthetic MCP data with private mounts and backend health', { timeout: 300000 }, async t => {
  const f = await fixture(t, { cleanup: false });
  f.config.observationsFile = join(f.root, 'private/observability/observations.db');
  f.config.webGateway = { enabled: true, originHost: 'origin.example' };
  const publisherInput = await enablePublisher(f);
  const projectName = `praxis-business-synthetic-${process.pid}`;
  const { AuthStore } = await import('../src/business/auth.mjs');
  const { BusinessService } = await import('../third_party/reminder/src/business.js');
  const { createServer: createReminderServer } = await import('../third_party/reminder/src/server.js');
  const auth = new AuthStore({ file: f.config.database, issuer: f.config.issuer });
  auth.createUser({ id: 'synthetic-owner', username: 'synthetic-owner', password: 'Synthetic-Docker-password-2026' });
  auth.setWebAccess({ userId: 'synthetic-owner', apps: ['reminder'], prds: false });
  auth.createSpace({ id: 'space-a', type: 'personal', ownerId: 'synthetic-owner' });
  auth.createClient({ id: 'synthetic-client', name: 'Synthetic Docker client', redirectUris: ['https://client.example/callback'] });
  const grant = auth.createGrant({ userId: 'synthetic-owner', clientId: 'synthetic-client', rules: [{ appId: 'reminder', spaceId: 'space-a', resources: ['*'], actions: ['read', 'create', 'update', 'complete', 'delete'] }] });
  const token = auth.issueToken({ grantId: grant.id }).accessToken;
  auth.close();
  const key = await readFile(f.keyFile);
  const reminder = createReminderServer({ businessService: new BusinessService({ key, spaces: { 'space-a': f.dataFile } }) });
  reminder.listen(0, '127.0.0.1'); await once(reminder, 'listening');
  f.config.apps.reminder.url = `http://127.0.0.1:${reminder.address().port}/api/business`;
  await f.save();
  const options = { configFile: f.configFile, port: 17326, projectName };
  const execute = async (command, args, settings) => (await runFile(command, args, { ...settings, maxBuffer: 8 * 1024 * 1024 })).stdout;
  let mcpClient;
  t.after(async () => {
    await mcpClient?.close().catch(() => {});
    try { await runBusinessStack('down', { ...options, execute }); }
    finally { await new Promise(resolvePromise => { reminder.close(resolvePromise); reminder.closeAllConnections(); }); await rm(f.root, { recursive: true, force: true }); }
  });
  await runBusinessStack('up', { ...options, execute });
  const result = await businessStackPlan(f.configFile, options);
  const common = ['compose', '--project-name', projectName, '--file', resolve('compose.core.yaml'), '--file', result.overrideFile];
  const containerId = (await execute('docker', [...common, 'ps', '-q', 'core'], { cwd: resolve('.') })).trim();
  const inspected = JSON.parse((await runFile('docker', ['inspect', containerId])).stdout)[0];
  assert.equal(inspected.State.Health.Status, 'healthy');
  assert.equal(inspected.HostConfig.ReadonlyRootfs, true);
  assert.equal(inspected.Config.User, `${process.getuid?.() ?? 1000}:${process.getgid?.() ?? 1000}`);
  assert.equal(inspected.Config.Cmd[inspected.Config.Cmd.indexOf('--host') + 1], '127.0.0.1');
  assert.deepEqual(inspected.Mounts.filter(item => item.RW).map(item => item.Source).sort(), [join(f.state, 'auth'), join(f.state, 'events'), join(f.root, 'private/observability')].sort());
  assert.equal(inspected.Mounts.some(item => item.Source === f.root || item.Source === f.data || item.Destination === '/var/run/docker.sock'), false);
  assert.equal(inspected.Mounts.some(item => item.Source === publisherInput.storageFile || item.Source === publisherInput.metadata), false);
  assert.equal(inspected.Mounts.find(item => item.Source === publisherInput.statusDirectory).RW, false);
  const publisherId = (await execute('docker', [...common, 'ps', '-q', 'storage-status'], { cwd: resolve('.') })).trim();
  const publisherContainer = JSON.parse((await runFile('docker', ['inspect', publisherId])).stdout)[0];
  assert.equal(publisherContainer.State.Health.Status, 'healthy');
  assert.equal(publisherContainer.HostConfig.NetworkMode, 'none');
  assert.deepEqual(publisherContainer.Mounts.filter(item => item.Type === 'bind' && item.RW).map(item => item.Source), [publisherInput.statusDirectory]);
  await runFile('docker', ['exec', publisherId, 'node', '-e', "const fs=require('node:fs');try{fs.readFileSync('/run/praxis-storage-metadata/snapshots/private-body.json');process.exit(2)}catch(error){if(!['ENOENT','EACCES'].includes(error.code))throw error}for(const file of process.argv.slice(1))if(fs.existsSync(file))process.exit(3)", f.keyFile, f.config.database, f.config.eventsDatabase, '/var/run/docker.sock']);
  const published = JSON.parse(await readFile(f.config.console.storageStatusFile, 'utf8'));
  assert.equal(published.schemaVersion, 1);
  assert.equal(published.local.state, 'none');
  assert.equal(JSON.stringify(published).includes('PRIVATE-SYNTHETIC-PAYLOAD'), false);
  const writeProbe = "const fs=require('node:fs');for(const file of process.argv.slice(1)){try{fs.appendFileSync(file,'forbidden');process.exit(2)}catch(error){if(error.code!=='EROFS')throw error}}";
  await runFile('docker', ['exec', containerId, 'node', '-e', writeProbe, f.keyFile, f.configFile, '/workspace/src/business/private-probe']);
  const imageProbe = "const fs=require('node:fs');for(const file of process.argv.slice(1)){if(fs.existsSync(file))process.exit(2)}";
  await runFile('docker', ['run', '--rm', '--network', 'none', '--entrypoint', 'node', 'praxis-core/server:local', '-e', imageProbe, f.keyFile, f.configFile, f.config.database, f.config.observationsFile]);
  const base = 'http://127.0.0.1:17326';
  assert.equal((await fetch(`${base}/health`)).status, 200);
  assert.equal((await fetch(`${base}/api/business/catalog`)).status, 401);
  const invoke = async request => {
    const response = await fetch(`${base}/api/business/invoke`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ appId: 'reminder', spaceId: 'space-a', ...request }) });
    assert.equal(response.status, 200); return response.json();
  };
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
  const { StreamableHTTPClientTransport } = await import('@modelcontextprotocol/sdk/client/streamableHttp.js');
  mcpClient = new Client({ name: 'synthetic-docker-client', version: '1.0.0' });
  await mcpClient.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
  assert.ok((await mcpClient.listTools()).tools.some(tool => tool.name === 'reminder_add'));
  const added = await mcpClient.callTool({ name: 'reminder_add', arguments: { spaceId: 'space-a', item: { text: '容器内合成事项', tags: ['合成'] }, idempotencyKey: 'docker-synthetic-create' } });
  assert.equal(added.isError, undefined);
  const created = added.structuredContent;
  const completed = await invoke({ operation: 'complete', resourceId: created.resourceId, expectedRevision: created.revision, input: { actualHours: 1.5 }, idempotencyKey: 'docker-synthetic-complete' });
  assert.equal(completed.item.done, true);
  assert.equal((await invoke({ operation: 'list' })).items.length, 1);
  await invoke({ operation: 'delete', resourceId: completed.resourceId, expectedRevision: completed.revision, idempotencyKey: 'docker-synthetic-delete' });
  assert.equal((await invoke({ operation: 'list' })).items.length, 0);
  await runFile('docker', ['exec', containerId, 'node', '-e', BUSINESS_HEALTHCHECK]);
  await new Promise(resolvePromise => { reminder.close(resolvePromise); reminder.closeAllConnections(); });
  await assert.rejects(runFile('docker', ['exec', containerId, 'node', '-e', BUSINESS_HEALTHCHECK]));
});

test('managed Projects has one private data mount and fixed loopback adapter for all project records', async t => {
  const f = await fixture(t, { managed: true });
  const dataDir = join(f.root, 'projects-data'), keyFile = join(f.configuration, 'projects.key'), businessConfigFile = join(f.configuration, 'projects.json');
  await mkdir(dataDir, { mode: 0o700 });
  await writeFile(keyFile, 'independent-synthetic-project-signing-key', { mode: 0o600 });
  await writeFile(businessConfigFile, JSON.stringify({ version: 1, spaces: ['space-a'] }), { mode: 0o600 });
  f.config.apps.projects = { managed: true, url: 'http://127.0.0.1:4327/api/business', spaces: ['space-a'], keyFile, dataDir, businessConfigFile };
  await f.save();
  const result = await plan(f), service = result.override.services.projects;
  assert.deepEqual(service.command.slice(-4), ['--host', '127.0.0.1', '--port', '4327']);
  assert.equal(service.build.dockerfile, 'Dockerfile.praxis'); assert.equal(service.read_only, true);
  assert.deepEqual(service.volumes.filter(v => !v.read_only).map(v => v.source), [dataDir]);
  assert.deepEqual(service.volumes.filter(v => v.read_only).map(v => v.source).sort(), [keyFile, businessConfigFile].sort());
  assert.ok(result.ports.includes(4327));
  await writeFile(businessConfigFile, JSON.stringify({ version: 1, spaces: ['space-b'] }), { mode: 0o600 });
  await assert.rejects(plan(f), { code: 'INVALID_SPACE_MAPPING' });
  await writeFile(businessConfigFile, JSON.stringify({ version: 1, spaces: ['space-a'] }), { mode: 0o600 });
  f.config.apps.projects.dataDir = join(f.state, 'auth'); await f.save();
  await assert.rejects(plan(f), { code: 'OVERLAPPING_DATA_MOUNT' });
});


test('administrator data locations use a separate read-only metadata directory', async t => {
  const f = await fixture(t);
  const directory = join(f.root, 'private', 'data-locations');
  await mkdir(directory, { mode: 0o700 });
  f.config.console = { dataInventoryFile: join(directory, 'locations.json') };
  await f.save();
  const result = await plan(f);
  assert.equal(result.dataInventoryDirectory, directory);
  assert.ok(result.override.services.core.volumes.some(mount => mount.source === directory && mount.read_only === true));
  assert.equal(result.override.services.core.volumes.some(mount => mount.source === f.root), false);
  f.config.console.dataInventoryFile = join(f.data, 'locations.json');
  await f.save();
  await assert.rejects(plan(f), { code: 'UNSAFE_INVENTORY_PATH' });
});


test('core defaults and explicit legacy plans preserve the configured data mounts', async t => {
  const f = await fixture(t);
  const current = await plan(f), legacy = await businessStackPlan(f.configFile, { port: 17326, serviceName: 'business', projectName: 'praxis-business' });
  assert.equal(current.serviceName, 'core');
  assert.deepEqual(legacy.override.services.business.volumes, current.override.services.core.volumes);
  assert.equal(legacy.projectName, 'praxis-business');
  assert.deepEqual(coreInstallation({ projects: { business: { name: 'unchanged-project', services: ['business', 'reminder'] } } }), { group: 'business', item: { name: 'unchanged-project', services: ['business', 'reminder'] }, serviceName: 'business' });
  assert.throws(() => coreInstallation({ projects: { core: { services: ['core', 'business'] } } }), { code: 'INVALID_CORE_SERVICE' });
});

test('managed core startup defers the actual facade while preserving legacy project identities', async () => {
  for (const [group, service] of [['core', 'core'], ['business', 'business'], ['business', 'core']]) {
    const installation = { version: 1, projects: { [group]: { name: 'unchanged-private-project', files: ['/private/compose.yml'], services: [service, 'reminder'] } } };
    const calls = [];
    await runBusinessStack('up', { installation, deferDeploymentFacade: true, execute: async (_command, args) => { calls.push(args); return ''; } });
    assert.equal(calls.length, 1);
    assert.ok(calls[0].includes('unchanged-private-project'));
    assert.deepEqual(calls[0].slice(calls[0].indexOf('--wait') + 1), ['reminder']);
  }
});


test('an existing standalone override keeps its legacy service and project on retry', async t => {
  const f = await fixture(t), calls = [];
  const legacy = await businessStackPlan(f.configFile, { port: 17326, serviceName: 'business' });
  await mkdir(legacy.controlDirectory, { mode: 0o700 });
  await writeFile(legacy.overrideFile, JSON.stringify(legacy.override), { mode: 0o600 });
  await runBusinessStack('status', { configFile: f.configFile, port: 17326, execute: async (_command, args) => { calls.push(args); return '[]'; } });
  assert.ok(calls[0].includes('praxis-business'));
  assert.ok(calls[0].includes(resolve('compose.business.yaml')));
  assert.ok(!calls[0].includes(resolve('compose.core.yaml')));
});

test('deployment prototype determines the facade even before a standalone override exists', async t => {
  const f = await fixture(t, { managed: true }), root = join(dirname(f.configFile), 'deployment'), calls = [];
  await mkdir(join(root, 'prototypes'), { recursive: true, mode: 0o700 });
  for (const [name, value] of [['manifest.json', { enabled: true }], ['prototypes/core.json', { Config: { Labels: { 'com.docker.compose.service': 'business' } } }]]) await writeFile(join(root, name), JSON.stringify(value), { mode: 0o600 });
  for (const name of ['compose.apps.yml', 'compose.business.yml']) await writeFile(join(root, name), 'services: {}', { mode: 0o600 });
  await runBusinessStack('status', { configFile: f.configFile, port: 17326, execute: async (_command, args) => { calls.push(args); return '[]'; } });
  assert.ok(calls[0].includes(resolve('compose.business.yaml')));
  assert.ok(calls[0].includes('praxis-business'));
});
