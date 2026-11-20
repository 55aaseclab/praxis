import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, link, mkdtemp, mkdir, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { main, resolveStackSettings, serviceStatus, SERVICES, validateData, validateObservationsDirectory, writeComposeEnvironment } from '../scripts/stack.mjs';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'praxis-stack-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const configPath = join(root, 'storage.json');
  const config = { schemaVersion: 1, workspaceId: 'synthetic-workspace', dataRoot: join(root, 'data'), deviceId: 'synthetic-device', activeWriterDeviceId: 'synthetic-device' };
  await writeFile(configPath, JSON.stringify(config));
  const env = { PRAXIS_STORAGE_CONFIG: configPath, PRAXIS_UID: String(process.getuid?.() || 1000), PRAXIS_GID: String(process.getgid?.() || 1000), PRAXIS_PUBLIC_URLS_FILE: join(root, 'public-urls.json') };
  const settings = await resolveStackSettings({ env, home: root });
  for (const name of ['reminder', 'tingproof', 'slides/decks', 'slides/.lattice']) await mkdir(join(settings.appsRoot, name), { recursive: true });
  for (const name of ['reminder/reminder.db', 'tingproof/tingproof.db', 'slides/decks/registry.js']) await writeFile(join(settings.appsRoot, name), 'Synthetic nonempty file.');
  await writeFile(settings.publicUrlsFile, JSON.stringify({ apps: {} }));
  return { root, config, configPath, env, settings };
}

const healthyRows = () => Object.keys(SERVICES).map(Service => ({ Service, State: 'running', Health: 'healthy' }));
async function enableGateway(f) {
  const businessFile = join(f.root, 'business.json');
  const business = { issuer: 'https://gateway-synthetic.example', database: join(f.root, 'identity/auth.db'), eventsDatabase: join(f.root, 'identity/events.db'), apps: {}, webGateway: { enabled: true, originHost: 'origin-synthetic.example' } };
  f.config.businessConfigFile = businessFile;
  await writeFile(f.configPath, JSON.stringify(f.config)); await writeFile(businessFile, JSON.stringify(business), { mode: 0o600 });
  return { business, businessFile, save: () => writeFile(businessFile, JSON.stringify(business), { mode: 0o600 }) };
}
function fakeDocker(rows = []) {
  const calls = [];
  const run = async (command, args, options) => {
    calls.push({ command, args, options });
    return args.includes('ps') ? rows.map(row => JSON.stringify(row)).join('\n') : '';
  };
  return { calls, run };
}

test('blue-green facade keeps its container while application writers retain their original services', async t => {
  const f = await fixture(t), root = join(f.root, 'deployment');
  await mkdir(root, { mode: 0o700 });
  for (const [name, value] of [['manifest.json', '{"enabled":true}'], ['compose.apps.yml', 'services: {}'], ['compose.business.yml', 'services: {}']]) await writeFile(join(root, name), value, { mode: 0o600 });
  const docker = fakeDocker(healthyRows());
  await main(['up'], { env: f.env, home: f.root, run: docker.run, print() {} });
  const starts = docker.calls.filter(call => call.args.includes('up'));
  assert.equal(starts.length, 2);
  assert.ok(starts.every(call => call.args.includes(join(root, 'compose.apps.yml'))));
  assert.ok(starts.find(call => call.args.includes('--no-recreate')).args.includes('praxis-public'));
  const replaced = starts.find(call => call.args.includes('--force-recreate')).args;
  assert.ok(!replaced.includes('praxis-public'));
  assert.ok(replaced.includes('travel') && replaced.includes('finance'));
});

test('stack resolves the canonical workspace and writes only private path configuration', async t => {
  const { settings, config, root } = await fixture(t);
  assert.equal(settings.appsRoot, join(config.dataRoot, 'workspaces', config.workspaceId, 'apps'));
  assert.equal(settings.stateRoot, join(config.dataRoot, 'workspaces', config.workspaceId, '.praxis-storage'));
  await writeComposeEnvironment(settings);
  assert.equal((await stat(settings.envFile)).mode & 0o777, 0o600);
  const content = await readFile(settings.envFile, 'utf8');
  assert.ok(content.includes(root));
  assert.ok(!content.includes('PASSWORD') && !content.includes('API_KEY'));
  assert.equal(settings.observationsDir, join(config.dataRoot, 'observability'));
  assert.ok(content.includes(`PRAXIS_OBSERVATIONS_DIR='${settings.observationsDir}'`));
});

test('missing app data is rejected without creating an empty replacement', async t => {
  const { settings } = await fixture(t);
  const file = join(settings.appsRoot, 'reminder/reminder.db');
  await rm(file);
  await assert.rejects(validateData(settings), /Refusing to initialize or replace/);
  await assert.rejects(stat(file), { code: 'ENOENT' });
});

test('optional Travel map credentials mount only into Travel without copying secrets into controls', async t => {
  const f = await fixture(t), directory = join(f.root, '.config/praxis/secrets');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const file = join(directory, 'travel-amap.json');
  const secret = 'synthetic-private-provider-secret';
  await writeFile(file, JSON.stringify({ key: 'synthetic-browser-key', securityJsCode: secret, webServiceKey: 'synthetic-web-service-secret' }), { mode: 0o600 });
  const settings = await resolveStackSettings({ env: f.env, home: f.root });
  await writeComposeEnvironment(settings);
  const raw = await readFile(settings.travelMapOverrideFile, 'utf8');
  const override = JSON.parse(raw);
  assert.deepEqual(Object.keys(override.services), ['travel']);
  assert.deepEqual(override.services.travel.volumes, [{ type: 'bind', source: file, target: '/run/secrets/travel-amap.json', read_only: true, bind: { create_host_path: false } }]);
  assert.equal(override.services.travel.environment.TRAVEL_AMAP_CONFIG, '/run/secrets/travel-amap.json');
  assert.equal(raw.includes(secret), false);
  assert.equal(raw.includes('synthetic-web-service-secret'), false);
  assert.equal((await stat(settings.travelMapOverrideFile)).mode & 0o777, 0o600);
  const docker = fakeDocker(healthyRows());
  await main(['status'], { env: f.env, home: f.root, run: docker.run, print() {} });
  assert.ok(docker.calls.find(call => call.args.includes('ps')).args.includes(settings.travelMapOverrideFile));
  await enableGateway(f);
  const guarded = await resolveStackSettings({ env: f.env, home: f.root });
  await writeComposeEnvironment(guarded);
  assert.equal(JSON.parse(await readFile(guarded.travelMapOverrideFile, 'utf8')).services.travel.environment.TRAVEL_AMAP_ORIGIN, 'https://gateway-synthetic.example');
  await rm(file);
  const disabled = await resolveStackSettings({ env: f.env, home: f.root });
  await writeComposeEnvironment(disabled);
  assert.deepEqual(JSON.parse(await readFile(disabled.travelMapOverrideFile, 'utf8')), { services: {} });
});

test('Travel map credentials reject missing explicit paths, readable files, links and data paths', async t => {
  const f = await fixture(t), directory = join(f.root, 'private-map');
  await mkdir(directory, { mode: 0o700 });
  const file = join(directory, 'map.json');
  const resolveMap = path => resolveStackSettings({ env: { ...f.env, PRAXIS_TRAVEL_AMAP_CONFIG: path }, home: f.root });
  await assert.rejects(resolveMap(file), /missing/);
  await writeFile(file, '{}', { mode: 0o644 });
  await chmod(file, 0o644);
  await assert.rejects(resolveMap(file), /private canonical/);
  await chmod(file, 0o600);
  const alias = join(directory, 'alias.json'); await symlink(file, alias);
  await assert.rejects(resolveMap(alias), /private canonical/);
  await rm(alias); await link(file, alias);
  await assert.rejects(resolveMap(file), /private canonical/);
  await rm(alias); await chmod(directory, 0o755);
  await assert.rejects(resolveMap(file), /private canonical/);
  const dataFile = join(f.settings.appsRoot, 'reminder/reminder.db'); await chmod(dataFile, 0o600); await chmod(dirname(dataFile), 0o700);
  await assert.rejects(resolveMap(dataFile), /private canonical/);
});

test('optional Fliggy credentials mount only into Travel without exposing the key', async t => {
  const f = await fixture(t), directory = join(f.root, '.config/praxis/secrets');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const file = join(directory, 'travel-fliggy.json'), key = 'synthetic-fliggy-private-api-key';
  await writeFile(file, JSON.stringify({ apiKey: key }), { mode: 0o600 });
  const settings = await resolveStackSettings({ env: f.env, home: f.root });
  await writeComposeEnvironment(settings);
  const raw = await readFile(settings.travelMapOverrideFile, 'utf8'), override = JSON.parse(raw);
  assert.deepEqual(Object.keys(override.services), ['travel']);
  assert.deepEqual(override.services.travel.environment, { TRAVEL_FLIGGY_CONFIG: '/run/secrets/travel-fliggy.json' });
  assert.deepEqual(override.services.travel.volumes, [{ type: 'bind', source: file, target: '/run/secrets/travel-fliggy.json', read_only: true, bind: { create_host_path: false } }]);
  assert.equal(raw.includes(key), false);
  assert.equal((await readFile(settings.envFile, 'utf8')).includes(key), false);
  await rm(file);
  const disabled = await resolveStackSettings({ env: f.env, home: f.root }); await writeComposeEnvironment(disabled);
  assert.deepEqual(JSON.parse(await readFile(disabled.travelMapOverrideFile, 'utf8')), { services: {} });
});

test('Fliggy credentials reject missing files, public modes, aliases, data paths and reused secrets', async t => {
  const f = await travelBusinessFixture(t), directory = join(f.root, 'private-fliggy');
  await mkdir(directory, { mode: 0o700 });
  const file = join(directory, 'fliggy.json');
  const resolveFliggy = path => f.resolveTravel({ env: { ...f.env, PRAXIS_TRAVEL_FLIGGY_CONFIG: path } });
  await assert.rejects(resolveFliggy(file), /missing/);
  await writeFile(file, '{"apiKey":"synthetic-key"}', { mode: 0o600 });
  await chmod(file, 0o644); await assert.rejects(resolveFliggy(file), /separate private canonical/); await chmod(file, 0o600);
  const alias = join(directory, 'alias.json'); await symlink(file, alias);
  await assert.rejects(resolveFliggy(alias), /separate private canonical/); await rm(alias);
  await link(file, alias); await assert.rejects(resolveFliggy(file), /separate private canonical/); await rm(alias);
  await chmod(directory, 0o755); await assert.rejects(resolveFliggy(file), /separate private canonical/); await chmod(directory, 0o700);
  const dataFile = join(f.dataDir, 'credential.json'); await writeFile(dataFile, '{}', { mode: 0o600 });
  await assert.rejects(resolveFliggy(dataFile), /separate private canonical/);
  await assert.rejects(resolveFliggy(f.keyFile), /separate private canonical/);
  await assert.rejects(resolveFliggy(f.businessConfigFile), /separate private canonical/);
  await assert.rejects(f.resolveTravel({ env: { ...f.env, PRAXIS_TRAVEL_FLIGGY_CONFIG: file, PRAXIS_TRAVEL_AMAP_CONFIG: file } }), /separate private canonical/);
});

test('stack refuses writes from a standby device before invoking Compose', async t => {
  const { config, configPath, env, root } = await fixture(t);
  await writeFile(configPath, JSON.stringify({ ...config, activeWriterDeviceId: 'another-device' }));
  const docker = fakeDocker();
  await assert.rejects(main(['exec', 'reminder', '--', 'node', 'src/cli.js', 'ls'], { env, home: root, run: docker.run }), /not the active workspace writer/);
  assert.ok(!docker.calls.some(call => call.args.includes('exec')));
});

test('an existing native listener prevents startup and is never stopped', async t => {
  const { env, root, settings } = await fixture(t);
  const docker = fakeDocker();
  await assert.rejects(main(['up'], { env, home: root, run: docker.run, portInUse: async port => port === 4322 }), /reminder:4322/);
  assert.ok(!docker.calls.some(call => call.args.some(arg => ['build', 'up', 'down', 'stop'].includes(arg))));
  await assert.rejects(stat(settings.receiptFile), { code: 'ENOENT' });
});

test('activation receipt requires all healthy services and is cleared on down without volumes', async t => {
  const { env, root, settings } = await fixture(t);
  const docker = fakeDocker(healthyRows());
  await main(['up'], { env, home: root, run: docker.run, print() {}, portInUse: async () => false });
  const receipt = JSON.parse(await readFile(settings.receiptFile, 'utf8'));
  assert.equal(receipt.appsRoot, settings.appsRoot);
  assert.equal((await stat(settings.receiptFile)).mode & 0o777, 0o600);
  assert.ok(docker.calls.some(call => call.args.includes('--wait')));
  assert.ok(docker.calls.some(call => call.args.includes('run') && call.args.includes('--rm')));
  await main(['down'], { env, home: root, run: docker.run });
  assert.ok(!docker.calls.some(call => call.args.includes('--volumes') || call.args.includes('-v')));
  await assert.rejects(stat(settings.receiptFile), { code: 'ENOENT' });
  assert.ok((await stat(join(settings.appsRoot, 'reminder/reminder.db'))).isFile());
});

test('unhealthy startup does not produce an activation receipt', async t => {
  const { env, root, settings } = await fixture(t);
  const rows = healthyRows(); rows[0].Health = 'unhealthy';
  const docker = fakeDocker(rows);
  await assert.rejects(main(['up'], { env, home: root, run: docker.run, portInUse: async () => false }), /no activation receipt/);
  await assert.rejects(stat(settings.receiptFile), { code: 'ENOENT' });
});

test('application commands preserve argv and use the resolved app mount', async t => {
  const { env, root, settings } = await fixture(t);
  const docker = fakeDocker();
  const text = '汉字 $(touch should-not-exist)';
  await main(['--apps-root', settings.appsRoot, 'exec', 'reminder', '--', 'node', 'src/cli.js', 'add', text], { env: { ...env, PRAXIS_APPS_ROOT: '/wrong/environment/path' }, home: root, run: docker.run });
  const call = docker.calls.find(item => item.args.includes('exec'));
  assert.deepEqual(call.args.slice(-7), ['exec', '-T', 'reminder', 'node', 'src/cli.js', 'add', text]);
  assert.equal(call.options.env.PRAXIS_APPS_ROOT, settings.appsRoot);
});

test('status recognizes both Compose JSON encodings and requires every app health check', () => {
  const rows = healthyRows();
  assert.equal(serviceStatus(JSON.stringify(rows)).healthy, true);
  assert.equal(serviceStatus(rows.map(row => JSON.stringify(row)).join('\n')).healthy, true);
  assert.equal(serviceStatus(JSON.stringify(rows.slice(1))).healthy, false);
  assert.equal(serviceStatus('').services.length, Object.keys(SERVICES).length);
});

async function registered(t) {
  const f = await fixture(t);
  await rm(f.settings.appsRoot, { recursive: true, force: true });
  const native = join(f.root, 'native');
  for (const name of ['reminder', 'tingproof', 'slides/decks', 'slides/.lattice']) await mkdir(join(native, name), { recursive: true });
  const sources = [
    { id: 'reminder', kind: 'json', target: 'checklist.json', source: join(native, 'reminder/checklist.json') },
    { id: 'tingproof', kind: 'sqlite', target: 'tingproof.db', source: join(native, 'tingproof/tingproof.db') },
    { id: 'slides', kind: 'directory', target: 'decks', source: join(native, 'slides/decks') },
    { id: 'slides', kind: 'directory', target: '.lattice', source: join(native, 'slides/.lattice') },
  ];
  for (const file of [sources[0].source, sources[1].source, join(sources[2].source, 'registry.js')]) await writeFile(file, 'Synthetic registered source remains unchanged.');
  f.config.appSources = sources;
  await writeFile(f.configPath, JSON.stringify(f.config)); await chmod(f.configPath, 0o600);
  f.registeredSettings = await resolveStackSettings({ env: f.env, home: f.root, sourceMode: 'registered', withoutReminder: true });
  return f;
}

test('registered-source plan is read-only and binds original canonical data without creating copied stores', async t => {
  const f = await registered(t);
  const result = await main(['plan', '--source-mode', 'registered', '--without-reminder'], { env: f.env, home: f.root, print() {}, run: async () => { throw new Error('Read-only plan must not call Docker'); } });
  assert.equal(result.sourceMode, 'registered');
  assert.equal(result.services.length, Object.keys(SERVICES).length - 1);
  assert.ok(!result.services.includes('reminder'));
  assert.equal(result.sourceMap.tingproof, f.config.appSources[1].source);
  await assert.rejects(stat(f.settings.appsRoot), { code: 'ENOENT' });
  await assert.rejects(stat(f.registeredSettings.envFile), { code: 'ENOENT' });
  await assert.rejects(stat(f.registeredSettings.observationsDir), { code: 'ENOENT' });
  assert.equal(await readFile(f.config.appSources[0].source, 'utf8'), 'Synthetic registered source remains unchanged.');
});

test('status does not create observations or Compose control directories in either source mode', async t => {
  for (const mode of ['copied', 'registered']) {
    const f = mode === 'registered' ? await registered(t) : await fixture(t);
    const docker = fakeDocker(healthyRows());
    await main(['status', '--source-mode', mode], { env: f.env, home: f.root, print() {}, run: docker.run });
    const settings = await resolveStackSettings({ env: f.env, home: f.root, sourceMode: mode });
    await assert.rejects(stat(settings.observationsDir), { code: 'ENOENT' });
    await assert.rejects(stat(settings.envFile), { code: 'ENOENT' });
    assert.equal(docker.calls.some(call => call.args.includes('--env-file')), false);
  }
});

test('build prepares only a private metadata directory and forwards its exact configured path', async t => {
  const f = await fixture(t), docker = fakeDocker();
  const observationsDir = join(f.root, 'metadata/observability');
  const env = { ...f.env, PRAXIS_OBSERVATIONS_DIR: observationsDir };
  await main(['build'], { env, home: f.root, run: docker.run });
  assert.equal((await stat(observationsDir)).mode & 0o777, 0o700);
  await assert.rejects(stat(join(observationsDir, 'observations.db')), { code: 'ENOENT' });
  const build = docker.calls.find(call => call.args.includes('build'));
  assert.equal(build.options.env.PRAXIS_OBSERVATIONS_DIR, observationsDir);
});

test('observations reject app data, source, secret and Docker control overlap', async t => {
  const f = await registered(t);
  const secret = join(f.root, 'secrets');
  f.config.repositories = [{ type: 'local', path: join(f.root, 'repositories/local'), passwordFile: join(secret, 'password') }];
  f.config.sourceRepos = [{ path: join(f.root, 'source-repository') }];
  await writeFile(f.configPath, JSON.stringify(f.config));
  for (const observationsDir of [f.registeredSettings.appsRoot, f.registeredSettings.stateRoot, join(f.root, 'native/reminder'), join(f.root, 'native/tingproof/nested'), secret, join(f.root, 'repositories/local'), join(f.root, 'source-repository'), join(f.root, 'docker-apps'), f.root]) {
    await assert.rejects(resolveStackSettings({ env: { ...f.env, PRAXIS_OBSERVATIONS_DIR: observationsDir }, home: f.root, sourceMode: 'registered' }), /dedicated private directory/);
  }
});

test('observations paths reject public directories, links and unrelated files without changing them', async t => {
  const f = await fixture(t), directory = f.settings.observationsDir;
  await mkdir(directory, { mode: 0o755 });
  await chmod(directory, 0o755);
  await assert.rejects(resolveStackSettings({ env: f.env, home: f.root }), /mode700/);
  await chmod(directory, 0o700);
  const database = join(directory, 'observations.db');
  await writeFile(database, 'Synthetic metadata only.', { mode: 0o644 });
  await chmod(database, 0o644);
  await assert.rejects(resolveStackSettings({ env: f.env, home: f.root }), /mode600/);
  await chmod(database, 0o600);
  await link(database, join(f.root, 'linked-metadata'));
  await assert.rejects(resolveStackSettings({ env: f.env, home: f.root }), /mode600/);
  await rm(join(f.root, 'linked-metadata'));
  await writeFile(join(directory, 'private-record.json'), '{}', { mode: 0o600 });
  await assert.rejects(resolveStackSettings({ env: f.env, home: f.root }), /only its database/);
  await rm(join(directory, 'private-record.json'));
  const alias = join(f.root, 'metadata-alias'); await symlink(directory, alias);
  await assert.rejects(resolveStackSettings({ env: { ...f.env, PRAXIS_OBSERVATIONS_DIR: alias }, home: f.root }), /canonical/);
  await assert.rejects(validateObservationsDirectory(directory, { protectedPaths: [alias] }), /canonical application data/);
  await assert.rejects(validateObservationsDirectory(directory, { uid: Number(f.env.PRAXIS_UID) + 1 }), /runtime user/);
  assert.equal(await readFile(database, 'utf8'), 'Synthetic metadata only.');
});

test('base observations reject business state overlap and disagreeing database paths', async t => {
  const f = await fixture(t), businessFile = join(f.root, 'business.json');
  const business = { database: join(f.root, 'identity/auth.db'), eventsDatabase: join(f.root, 'events/events.db'), observationsFile: f.settings.observationsFile, apps: {} };
  f.config.businessConfigFile = businessFile;
  await writeFile(f.configPath, JSON.stringify(f.config));
  await writeFile(businessFile, JSON.stringify(business));
  const env = { ...f.env, PRAXIS_OBSERVATIONS_DIR: join(f.root, 'identity') };
  await assert.rejects(resolveStackSettings({ env, home: f.root }), /same configured database/);
  delete business.observationsFile; await writeFile(businessFile, JSON.stringify(business));
  await assert.rejects(resolveStackSettings({ env, home: f.root }), /dedicated private directory/);
  const settings = await resolveStackSettings({ env: f.env, home: f.root });
  assert.equal(settings.observationsFile, f.settings.observationsFile);
});

test('observations origin comes only from an explicit override or configured business issuer', async t => {
  const f = await fixture(t);
  assert.equal(f.settings.observationsOrigin, '');
  const businessFile = join(f.root, 'business.json');
  const business = { issuer: 'https://business-synthetic.example/', database: join(f.root, 'identity/auth.db'), eventsDatabase: join(f.root, 'events/events.db'), apps: {} };
  f.config.businessConfigFile = businessFile;
  await writeFile(f.configPath, JSON.stringify(f.config)); await writeFile(businessFile, JSON.stringify(business));
  const settings = await resolveStackSettings({ env: f.env, home: f.root });
  assert.equal(settings.observationsOrigin, 'https://business-synthetic.example');
  await writeComposeEnvironment(settings);
  assert.ok((await readFile(settings.envFile, 'utf8')).includes("PRAXIS_OBSERVATIONS_ORIGIN='https://business-synthetic.example'"));
  for (const value of ['https://public-synthetic.example', 'http://127.0.0.1:17321', 'http://localhost:17321', 'http://[::1]:17321', '']) {
    const resolved = await resolveStackSettings({ env: { ...f.env, PRAXIS_OBSERVATIONS_ORIGIN: value }, home: f.root });
    assert.equal(resolved.observationsOrigin, value);
  }
  for (const value of ['http://public-synthetic.example', 'https://public-synthetic.example/path', 'https://public-synthetic.example/?query=1', 'https://public-synthetic.example/#fragment', 'https://user:password@public-synthetic.example', 'ftp://public-synthetic.example', 'https://public-synthetic.example?', ' https://public-synthetic.example']) await assert.rejects(resolveStackSettings({ env: { ...f.env, PRAXIS_OBSERVATIONS_ORIGIN: value }, home: f.root }), /observations origin/);
});

test('console wiring uses a fixed local upstream and canonical public origin only when enabled', async t => {
  const f = await fixture(t);
  assert.equal(f.settings.consoleUpstream, '');
  const businessFile = join(f.root, 'business.json');
  const business = { issuer: 'https://console-synthetic.example', database: join(f.root, 'identity/auth.db'), eventsDatabase: join(f.root, 'events/events.db'), console: {}, apps: {} };
  f.config.businessConfigFile = businessFile;
  await writeFile(f.configPath, JSON.stringify(f.config));
  await writeFile(businessFile, JSON.stringify(business));
  const settings = await resolveStackSettings({ env: f.env, home: f.root });
  assert.equal(settings.consoleUpstream, 'http://host.docker.internal:4326');
  assert.equal(settings.consoleHost, 'console-synthetic.example');
  assert.equal(settings.consoleOrigin, business.issuer);
  await writeComposeEnvironment(settings);
  const environment = await readFile(settings.envFile, 'utf8');
  assert.ok(environment.includes("PRAXIS_CONSOLE_HOST='console-synthetic.example'"));
  assert.ok(environment.includes("PRAXIS_PUBLIC_BUSINESS_URL='https://console-synthetic.example/business/'"));
  await assert.rejects(resolveStackSettings({ env: { ...f.env, PRAXIS_CONSOLE_UPSTREAM: 'http://external.example:4326' }, home: f.root }), /fixed local/);
});

test('registered startup requires its complete service inventory and records a fingerprinted v2 receipt', async t => {
  const f = await registered(t), docker = fakeDocker(healthyRows().filter(row => row.Service !== 'reminder'));
  const result = await main(['up', '--source-mode', 'registered', '--without-reminder'], { env: f.env, home: f.root, print() {}, run: docker.run, portInUse: async () => false });
  assert.equal(result.services.length, Object.keys(SERVICES).length - 1);
  const receipt = JSON.parse(await readFile(f.registeredSettings.receiptFile, 'utf8'));
  assert.equal(receipt.schemaVersion, 2);
  assert.equal(receipt.sourceMode, 'registered');
  assert.equal(receipt.sourceFingerprint, f.registeredSettings.sourceFingerprint);
  assert.deepEqual(receipt.sourceMap, f.registeredSettings.sourceMap);
  assert.ok(!receipt.services.includes('reminder'));
  const up = docker.calls.find(call => call.args.includes('up'));
  assert.equal(up.args.includes('reminder'), false);
  assert.equal(up.options.env.PRAXIS_TINGPROOF_DATA_DIR, join(f.root, 'native/tingproof'));
  assert.equal(up.options.env.PRAXIS_SLIDES_STATE_DIR, join(f.root, 'native/slides/.lattice'));
  await assert.rejects(stat(f.settings.appsRoot), { code: 'ENOENT' });
});

test('registered mode rejects symbolic-link sources and duplicate Reminder writers', async t => {
  const f = await registered(t);
  const linked = join(f.root, 'native/reminder/alias.json');
  await symlink(f.config.appSources[0].source, linked);
  f.config.appSources[0].source = linked;
  await writeFile(f.configPath, JSON.stringify(f.config));
  const settings = await resolveStackSettings({ env: f.env, home: f.root, sourceMode: 'registered', withoutReminder: true });
  await assert.rejects(validateData(settings), /symbolic-link/);
  f.config.appSources[0].source = join(f.root, 'native/reminder/checklist.json'); await writeFile(f.configPath, JSON.stringify(f.config));
  const docker = fakeDocker(healthyRows());
  await assert.rejects(main(['status', '--source-mode', 'registered', '--without-reminder'], { env: f.env, home: f.root, run: docker.run, print() {} }), /duplicate Reminder/);
});

test('web gateway settings restrict raw app ports without changing canonical sources or storage configuration', async t => {
  const f = await registered(t), gateway = await enableGateway(f), configBefore = await readFile(f.configPath);
  const settings = await resolveStackSettings({ env: { ...f.env, PRAXIS_CONSOLE_UPSTREAM: 'http://host.docker.internal:4326' }, home: f.root, sourceMode: 'registered' });
  assert.equal(settings.webGateway, true);
  assert.equal(settings.bindAddress, '0.0.0.0'); assert.equal(settings.appBindAddress, '127.0.0.1');
  assert.equal(settings.consoleUpstream, 'http://127.0.0.1:4326');
  assert.equal(settings.consoleHost, 'gateway-synthetic.example');
  assert.equal(settings.canonicalUrl, 'https://gateway-synthetic.example');
  assert.equal(settings.originHost, 'origin-synthetic.example');
  assert.equal(settings.sourceFingerprint, f.registeredSettings.sourceFingerprint);
  assert.equal(settings.shareManifestFile, join(f.root, '.config/praxis/web-gateway/travel-shares.json'));
  await main(['plan', '--source-mode', 'registered'], { env: f.env, home: f.root, print() {} });
  await assert.rejects(stat(settings.gatewayOverrideFile), { code: 'ENOENT' });
  await assert.rejects(stat(join(f.root, '.config/praxis/web-gateway')), { code: 'ENOENT' });
  await writeComposeEnvironment(settings);
  const text = await readFile(settings.envFile, 'utf8');
  assert.ok(text.includes("PRAXIS_APP_BIND_ADDRESS='127.0.0.1'")); assert.ok(text.includes("PRAXIS_WEB_GATEWAY='true'"));
  assert.equal((await stat(settings.gatewayOverrideFile)).mode & 0o777, 0o600);
  assert.deepEqual(await readFile(f.configPath), configBefore);
  gateway.business.webGateway.enabled = false; await gateway.save();
  const legacy = await resolveStackSettings({ env: f.env, home: f.root, sourceMode: 'registered' });
  assert.equal(legacy.appBindAddress, legacy.bindAddress); assert.equal(legacy.gatewayOverrideFile, ''); assert.equal(legacy.canonicalUrl, '');
});

test('web gateway rejects malformed trusted hosts and shared capability directories', async t => {
  const f = await fixture(t), gateway = await enableGateway(f);
  for (const originHost of ['https://origin.example', 'origin.example:4321', 'bad host', 'origin.example/secret', 'origin.example\nInjected']) {
    gateway.business.webGateway.originHost = originHost; await gateway.save();
    await assert.rejects(resolveStackSettings({ env: f.env, home: f.root }), /fixed hostname/);
  }
  gateway.business.webGateway.originHost = 'origin.example';
  gateway.business.webGateway.shareManifestFile = join(f.settings.appsRoot, 'shares.json'); await gateway.save();
  await assert.rejects(resolveStackSettings({ env: f.env, home: f.root }), /separate/);
  gateway.business.webGateway.shareManifestFile = join(f.root, 'private-capabilities/travel-shares.json'); await gateway.save();
  await mkdir(dirname(gateway.business.webGateway.shareManifestFile), { mode: 0o700 });
  await writeFile(join(f.root, 'private-capabilities/password.txt'), 'synthetic-secret', { mode: 0o600 });
  await assert.rejects(resolveStackSettings({ env: f.env, home: f.root }), /sanitized projections/);
});

if (process.env.PRAXIS_BUSINESS_DOCKER_TEST === '1') test('base Compose shares observations only with the two workbench processes', async t => {
  const f = await fixture(t);
  const settings = await resolveStackSettings({ env: { ...f.env, PRAXIS_OBSERVATIONS_ORIGIN: 'https://public-synthetic.example' }, home: f.root });
  await writeComposeEnvironment(settings);
  const { stdout } = await promisify(execFile)('docker', ['compose', '--env-file', settings.envFile, '--file', resolve('compose.yaml'), 'config', '--format', 'json'], { env: { ...process.env, PRAXIS_OBSERVATIONS_DIR: settings.observationsDir, PRAXIS_OBSERVATIONS_ORIGIN: settings.observationsOrigin } });
  const rendered = JSON.parse(stdout);
  for (const [name, service] of Object.entries(rendered.services)) {
    const metadata = (service.volumes || []).filter(volume => volume.source === f.settings.observationsDir);
    if (['praxis', 'praxis-public'].includes(name)) {
      assert.equal(metadata.length, 1);
      assert.equal(metadata[0].target, f.settings.observationsDir);
      assert.notEqual(metadata[0].read_only, true);
      assert.equal(metadata[0].bind.create_host_path, false);
      assert.equal(service.environment.PRAXIS_OBSERVATIONS_FILE, f.settings.observationsFile);
      assert.equal(service.volumes.some(volume => volume.source === f.settings.appsRoot || volume.target === '/var/run/docker.sock'), false);
    } else {
      assert.equal(metadata.length, 0);
      assert.equal(service.environment.PRAXIS_OBSERVATIONS_FILE, undefined);
    }
  }
  assert.equal(rendered.services['praxis-public'].environment.PRAXIS_OBSERVATIONS_ORIGIN, settings.observationsOrigin);
  for (const name of ['praxis', 'praxis-public']) {
    const hosts = rendered.services[name].extra_hosts;
    if (Array.isArray(hosts)) assert.ok(hosts.includes('host.docker.internal=host-gateway') || hosts.includes('host.docker.internal:host-gateway'));
    else assert.equal(hosts['host.docker.internal'], 'host-gateway');
  }
  assert.equal(rendered.services.praxis.environment.PRAXIS_CONSOLE_ORIGIN, undefined);
  for (const [name, service] of Object.entries(rendered.services)) if (!['praxis', 'praxis-public'].includes(name)) assert.equal(service.environment.PRAXIS_CONSOLE_UPSTREAM, undefined);
  for (const [name, service] of Object.entries(rendered.services)) if (name !== 'praxis-public') assert.equal(service.environment.PRAXIS_OBSERVATIONS_ORIGIN, undefined);
  const launcherConfig = rendered.services['praxis-public'].volumes.find(volume => volume.source === f.settings.publicUrlsFile);
  assert.equal(launcherConfig.read_only, true);
  await assert.rejects(stat(f.settings.observationsDir), { code: 'ENOENT' });
});

if (process.env.PRAXIS_BUSINESS_DOCKER_TEST === '1') test('origin gateway Compose exposes only the guarded host-network ingress and boots the public entrypoint', { timeout: 180000 }, async t => {
  const f = await fixture(t), gateway = await enableGateway(f);
  const settings = await resolveStackSettings({ env: f.env, home: f.root });
  await writeComposeEnvironment(settings);
  const { stdout } = await promisify(execFile)('docker', ['compose', '--env-file', settings.envFile, '--file', resolve('compose.yaml'), '--file', settings.gatewayOverrideFile, 'config', '--format', 'json'], { env: { ...process.env, PRAXIS_APP_BIND_ADDRESS: settings.appBindAddress } });
  const rendered = JSON.parse(stdout), ingress = rendered.services['praxis-public'];
  assert.equal(ingress.network_mode, 'host'); assert.ok(!ingress.ports?.length);
  assert.equal(ingress.environment.PRAXIS_WEB_GATEWAY, 'true');
  assert.equal(ingress.environment.PRAXIS_CONSOLE_UPSTREAM, 'http://127.0.0.1:4326');
  assert.equal(ingress.environment.PRAXIS_ORIGIN_HOST, gateway.business.webGateway.originHost);
  assert.equal(ingress.environment.PRAXIS_CANONICAL_URL, gateway.business.issuer);
  assert.equal(ingress.environment.PRAXIS_TRAVEL_SHARES_FILE, settings.shareManifestFile);
  const capabilities = ingress.volumes.find(volume => volume.source === dirname(settings.shareManifestFile));
  assert.equal(capabilities.read_only, true); assert.equal(capabilities.bind.create_host_path, false);
  for (const [name, service] of Object.entries(rendered.services)) {
    if (name === 'praxis-public') continue;
    assert.equal((service.volumes || []).some(volume => volume.source === capabilities.source), false);
    for (const port of service.ports || []) assert.equal(port.host_ip, name === 'praxis' ? '0.0.0.0' : '127.0.0.1');
  }
  assert.equal(rendered.services.praxis.environment.PRAXIS_CANONICAL_URL, gateway.business.issuer);
  assert.equal(ingress.volumes.some(volume => [gateway.businessFile, gateway.business.database, gateway.business.eventsDatabase].includes(volume.source)), false);
  const run = promisify(execFile), image = process.env.PRAXIS_GATEWAY_TEST_IMAGE || `praxis-public-entrypoint-synthetic:${process.pid}`;
  const container = `praxis-public-entrypoint-${process.pid}`, missingCanonical = `${container}-missing-origin`;
  t.after(async () => {
    for (const name of [container, missingCanonical]) await run('docker', ['rm', '--force', name]).catch(() => {});
    if (!process.env.PRAXIS_GATEWAY_TEST_IMAGE) await run('docker', ['image', 'rm', image]).catch(() => {});
  });
  if (!process.env.PRAXIS_GATEWAY_TEST_IMAGE) await run('docker', ['build', '--target', 'praxis', '--build-arg', `PRAXIS_UID=${f.env.PRAXIS_UID}`, '--build-arg', `PRAXIS_GID=${f.env.PRAXIS_GID}`, '--tag', image, resolve('.')], { timeout: 120000, maxBuffer: 8 * 1024 * 1024 });
  await writeFile(f.settings.publicUrlsFile, '{}', { mode: 0o600 });
  await mkdir(settings.observationsDir, { recursive: true, mode: 0o700 });
  await mkdir(dirname(settings.shareManifestFile), { recursive: true, mode: 0o700 });
  const runtime = ['--network', 'none', '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges:true', '--user', ingress.user, '--tmpfs', '/tmp:rw,nosuid,nodev,size=16m', '--mount', `type=bind,source=${f.settings.publicUrlsFile},target=${ingress.environment.PRAXIS_PUBLIC_URLS_FILE},readonly`, '--mount', `type=bind,source=${settings.observationsDir},target=${settings.observationsDir}`, '--mount', `type=bind,source=${dirname(settings.shareManifestFile)},target=${dirname(settings.shareManifestFile)},readonly`];
  const environment = Object.entries(ingress.environment).flatMap(([key, value]) => ['--env', `${key}=${value ?? ''}`]);
  await run('docker', ['run', '--detach', '--name', container, ...runtime, ...environment, image, ...ingress.command]);
  const probe = `const http=require('node:http'),assert=require('node:assert/strict');const request=path=>new Promise((resolve,reject)=>{const req=http.get({host:'127.0.0.1',port:14321,path,headers:{Host:${JSON.stringify(settings.consoleHost)}}},res=>{res.resume();res.on('end',()=>resolve(res.statusCode))});req.on('error',reject)});(async()=>{let status;for(let i=0;i<50;i++){try{status=await request('/health');break}catch{await new Promise(r=>setTimeout(r,100))}}assert.equal(status,200);assert.equal(await request('/api/apps'),401)})().catch(()=>process.exit(1));`;
  await run('docker', ['exec', container, 'node', '-e', probe], { timeout: 10000 });
  const missingEnvironment = Object.entries(ingress.environment).filter(([key]) => key !== 'PRAXIS_CANONICAL_URL').flatMap(([key, value]) => ['--env', `${key}=${value ?? ''}`]);
  await assert.rejects(run('docker', ['run', '--rm', '--name', missingCanonical, ...runtime, ...missingEnvironment, image, ...ingress.command], { timeout: 10000 }), error => error.code === 1 && error.killed !== true);
});


async function travelBusinessFixture(t) {
  const f = await registered(t), privateDir = join(f.root, 'private-business');
  await mkdir(privateDir, { mode: 0o700 });
  const dataDir = join(f.root, 'native/travel/itineraries');
  await mkdir(dataDir, { recursive: true, mode: 0o700 });
  const keyFile = join(privateDir, 'travel-key'), businessConfigFile = join(privateDir, 'travel-mapping.json'), businessFile = join(privateDir, 'business.json');
  const signingKey = 'synthetic-travel-signing-key-material';
  const mapping = { version: 1, webSpace: 'pilot-space', spaces: { 'pilot-space': ['western-sichuan-2026'] } };
  await writeFile(keyFile, signingKey, { mode: 0o600 });
  await writeFile(businessConfigFile, JSON.stringify(mapping), { mode: 0o600 });
  const business = { issuer: 'https://gateway-synthetic.example', database: join(f.root, 'identity/auth.db'), eventsDatabase: join(f.root, 'identity/events.db'), apps: { travel: { url: 'http://127.0.0.1:4323/api/business', keyFile, spaces: ['pilot-space'], dataDir, businessConfigFile } } };
  f.config.businessConfigFile = businessFile;
  f.config.appSources.push({ id: 'travel', kind: 'directory', target: 'itineraries', source: dataDir });
  const save = async () => { await writeFile(f.configPath, JSON.stringify(f.config)); await writeFile(businessFile, JSON.stringify(business), { mode: 0o600 }); };
  await save();
  const resolveTravel = (extra = {}) => resolveStackSettings({ env: f.env, home: f.root, sourceMode: 'registered', withoutReminder: true, ...extra });
  return { ...f, privateDir, dataDir, keyFile, businessConfigFile, businessFile, business, mapping, signingKey, save, resolveTravel };
}

test('Travel business runtime mounts only its registered store and two read-only private files', async t => {
  const f = await travelBusinessFixture(t), settings = await f.resolveTravel();
  await writeComposeEnvironment(settings);
  const raw = await readFile(settings.travelMapOverrideFile, 'utf8'), override = JSON.parse(raw);
  assert.deepEqual(Object.keys(override.services), ['travel']);
  assert.deepEqual(override.services.travel.environment, { TRAVEL_DATA_DIR: '/data/itineraries', TRAVEL_BUSINESS_KEY_FILE: '/run/secrets/travel-business-key', TRAVEL_BUSINESS_CONFIG_FILE: '/run/config/travel-business.json' });
  assert.deepEqual(override.services.travel.volumes, [
    { type: 'bind', source: f.dataDir, target: '/data/itineraries', read_only: false, bind: { create_host_path: false } },
    { type: 'bind', source: f.keyFile, target: '/run/secrets/travel-business-key', read_only: true, bind: { create_host_path: false } },
    { type: 'bind', source: f.businessConfigFile, target: '/run/config/travel-business.json', read_only: true, bind: { create_host_path: false } },
  ]);
  assert.equal(settings.sourceMap.travelItineraries, f.dataDir);
  assert.notEqual(settings.sourceFingerprint, f.registeredSettings.sourceFingerprint);
  assert.equal(raw.includes(f.signingKey), false);
  assert.equal(raw.includes(JSON.stringify(f.mapping)), false);
  assert.equal((await readFile(settings.envFile, 'utf8')).includes(f.signingKey), false);
  assert.equal((await stat(settings.travelMapOverrideFile)).mode & 0o777, 0o600);
  assert.deepEqual(await readdir(f.dataDir), []);
  assert.equal(await readFile(f.keyFile, 'utf8'), f.signingKey);
});

test('Travel business mode and optional map credentials remain independently configurable', async t => {
  const f = await travelBusinessFixture(t), mapFile = join(f.privateDir, 'travel-amap.json');
  await writeFile(mapFile, JSON.stringify({ key: 'synthetic-js-key', securityJsCode: 'synthetic-map-secret' }), { mode: 0o600 });
  const resolveTravel = () => f.resolveTravel({ env: { ...f.env, PRAXIS_TRAVEL_AMAP_CONFIG: mapFile } });
  const settings = await resolveTravel(); await writeComposeEnvironment(settings);
  let override = JSON.parse(await readFile(settings.travelMapOverrideFile, 'utf8'));
  assert.equal(override.services.travel.volumes.length, 4);
  assert.equal(override.services.travel.environment.TRAVEL_AMAP_CONFIG, '/run/secrets/travel-amap.json');
  assert.equal(override.services.travel.environment.TRAVEL_DATA_DIR, '/data/itineraries');
  assert.equal(JSON.stringify(override).includes('synthetic-map-secret'), false);
  delete f.business.apps.travel; await f.save();
  const standalone = await resolveTravel(); await writeComposeEnvironment(standalone);
  override = JSON.parse(await readFile(standalone.travelMapOverrideFile, 'utf8'));
  assert.equal(standalone.travelBusiness, null);
  assert.equal(override.services.travel.volumes.length, 1);
  assert.equal(Object.hasOwn(override.services.travel.environment, 'TRAVEL_BUSINESS_KEY_FILE'), false);
  assert.deepEqual(await readdir(f.dataDir), []);
});

test('Travel fails closed for missing, unregistered, mismatched and symbolic-link stores without creating data', async t => {
  const f = await travelBusinessFixture(t), original = f.dataDir;
  await rm(original, { recursive: true });
  const docker = fakeDocker();
  await assert.rejects(main(['up', '--source-mode', 'registered', '--without-reminder'], { env: f.env, home: f.root, run: docker.run }), /already exist.*no replacement/);
  assert.equal(docker.calls.length, 0);
  await assert.rejects(stat(original), { code: 'ENOENT' });
  await mkdir(original, { mode: 0o700 });
  f.config.appSources = f.config.appSources.filter(source => source.id !== 'travel'); await f.save();
  await assert.rejects(f.resolveTravel(), /registered travel\/itineraries/);
  f.config.appSources.push({ id: 'travel', target: 'itineraries', kind: 'directory', source: original });
  const other = join(f.root, 'native/travel/other'); await mkdir(other, { mode: 0o700 });
  f.business.apps.travel.dataDir = other; await f.save();
  await assert.rejects(f.resolveTravel(), /must match its registered/);
  const alias = join(f.root, 'native/travel/alias'); await symlink(original, alias);
  f.business.apps.travel.dataDir = alias; f.config.appSources.at(-1).source = alias; await f.save();
  await assert.rejects(f.resolveTravel(), /canonical private mode700/);
  assert.deepEqual(await readdir(original), []);
});

test('Travel key and mapping reject public modes, links, short keys and broad application paths', async t => {
  const f = await travelBusinessFixture(t);
  for (const file of [f.keyFile, f.businessConfigFile]) {
    await chmod(file, 0o644); await assert.rejects(f.resolveTravel(), /mode600/); await chmod(file, 0o600);
    const hardLink = file + '-hardlink'; await link(file, hardLink); await assert.rejects(f.resolveTravel(), /mode600/); await rm(hardLink);
  }
  await writeFile(f.keyFile, 'short'); await assert.rejects(f.resolveTravel(), /mode600/); await writeFile(f.keyFile, f.signingKey);
  const alias = join(f.privateDir, 'key-alias'); await symlink(f.keyFile, alias);
  f.business.apps.travel.keyFile = alias; await f.save(); await assert.rejects(f.resolveTravel(), /mode600/);
  f.business.apps.travel.keyFile = f.keyFile; await f.save(); await chmod(f.privateDir, 0o755); await assert.rejects(f.resolveTravel(), /mode600/); await chmod(f.privateDir, 0o700);
  f.business.apps.travel.dataDir = dirname(f.config.appSources[0].source); f.config.appSources.at(-1).source = f.business.apps.travel.dataDir; await f.save();
  await assert.rejects(f.resolveTravel(), /dedicated private directory/);
});

test('Travel mapping binds approved itineraries in one space and rejects mismatched scopes or adapter endpoints', async t => {
  const f = await travelBusinessFixture(t);
  for (const mapping of [
    { ...f.mapping, webSpace: 'other-space' },
    { ...f.mapping, spaces: { 'pilot-space': ['western-sichuan-2026', 'other-trip'] } },
    { ...f.mapping, spaces: { 'pilot-space': ['../private'] } },
    { ...f.mapping, spaces: { 'pilot-space': [] } },
    { ...f.mapping, spaces: { 'pilot-space': ['western-sichuan-2026', 'western-sichuan-2026'] } },
    { ...f.mapping, spaces: { 'pilot-space': ['iceland-2026'] } },
    { ...f.mapping, spaces: { 'pilot-space': ['western-sichuan-2026'], 'other-space': ['western-sichuan-2026'] } },
  ]) {
    await writeFile(f.businessConfigFile, JSON.stringify(mapping)); await assert.rejects(f.resolveTravel(), /approved itinerary/);
  }
  await writeFile(f.businessConfigFile, JSON.stringify(f.mapping));
  f.business.apps.travel.spaces.push('other-space'); await f.save(); await assert.rejects(f.resolveTravel(), /one explicit pilot/);
  f.business.apps.travel.spaces = ['pilot-space']; f.business.apps.travel.url = 'http://remote.example/api/business'; await f.save(); await assert.rejects(f.resolveTravel(), /fixed local adapter/);
  f.business.apps.travel.url = 'http://127.0.0.1:4323/api/business'; delete f.business.apps.travel.businessConfigFile; await f.save(); await assert.rejects(f.resolveTravel(), /Configuration paths/);
});

test('Travel runtime accepts all three approved plans without creating records or changing private controls', async t => {
  const f = await travelBusinessFixture(t);
  const mapping = { ...f.mapping, spaces: { 'pilot-space': ['western-sichuan-2026', 'daxinganling-2026', 'changbaishan-2026'] } };
  const beforeKey = await readFile(f.keyFile);
  await writeFile(f.businessConfigFile, JSON.stringify(mapping));
  const beforeMapping = await readFile(f.businessConfigFile);
  const settings = await f.resolveTravel();
  assert.equal(settings.travelBusiness.dataDir, f.dataDir);
  assert.deepEqual(await readdir(f.dataDir), []);
  assert.deepEqual(await readFile(f.keyFile), beforeKey);
  assert.deepEqual(await readFile(f.businessConfigFile), beforeMapping);
});

test('Travel plan and status expose path metadata only and never initialize its empty COW store', async t => {
  const f = await travelBusinessFixture(t);
  const plan = await main(['plan', '--source-mode', 'registered', '--without-reminder'], { env: f.env, home: f.root, print() {}, run() { throw new Error('Plan must not call Docker.'); } });
  assert.equal(plan.sourceMap.travelItineraries, f.dataDir);
  assert.equal(JSON.stringify(plan).includes(f.keyFile), false);
  assert.equal(JSON.stringify(plan).includes(f.businessConfigFile), false);
  assert.equal(JSON.stringify(plan).includes(f.signingKey), false);
  const docker = fakeDocker(healthyRows().filter(row => row.Service !== 'reminder'));
  await main(['status', '--source-mode', 'registered', '--without-reminder'], { env: f.env, home: f.root, run: docker.run, print() {} });
  assert.deepEqual(await readdir(f.dataDir), []);
  const settings = await f.resolveTravel();
  await assert.rejects(stat(settings.envFile), { code: 'ENOENT' });
});

test('Knowledge runtime configuration produces an exact app-only Compose binding', async t => {
  const f = await fixture(t), gateway = await enableGateway(f), directory = join(f.root, 'knowledge-data'), controls = join(f.root, 'knowledge-controls');
  await mkdir(directory, { mode: 0o700 }); await mkdir(controls, { mode: 0o700 });
  const keyFile = join(controls, 'key'), businessConfigFile = join(controls, 'mapping.json');
  await writeFile(keyFile, 'synthetic-knowledge-key-with-32-bytes', { mode: 0o600 });
  await writeFile(businessConfigFile, JSON.stringify({ version: 1, spaces: ['synthetic-space'] }), { mode: 0o600 });
  gateway.business.apps.knowledge = { url: 'http://127.0.0.1:14324/api/business', spaces: ['synthetic-space'], dataDir: directory, keyFile, businessConfigFile };
  await gateway.save();
  const settings = await resolveStackSettings({ env: f.env, home: f.root });
  await writeComposeEnvironment(settings);
  const override = JSON.parse(await readFile(settings.travelMapOverrideFile, 'utf8'));
  assert.deepEqual(Object.keys(override.services), ['knowledge-public']);
  assert.equal(override.services['knowledge-public'].environment.KNOWLEDGE_DATA_DIR, '/data/knowledge');
  assert.equal(override.services['knowledge-public'].volumes[0].source, directory);
  assert.equal(settings.sourceMap.knowledge, join(directory, 'knowledge.db'));
  assert.equal(JSON.stringify(override).includes(await readFile(keyFile, 'utf8')), false);
});

async function configuredWorkingRoots(t) {
  const f = await fixture(t);
  const { resolveAppPaths, appStorageSources } = await import('../src/storage/app-paths.mjs');
  f.config.workingData = { version: 1, roots: { finance: join(f.root, 'other-disk/finance') } };
  f.config.dockerSourceMode = 'registered';
  const paths = resolveAppPaths(f.config);
  const reminder = join(paths.reminder, 'synthetic-space/checklist.json');
  f.config.appSources = appStorageSources(paths, { 'synthetic-space': reminder });
  await writeFile(f.configPath, JSON.stringify(f.config));
  for (const file of [reminder, paths.tingproof, join(paths.slidesDecks, 'registry.js'), join(paths.knowledgeContent, 'catalog/documents.json'), join(paths.knowledgeContent, 'published/index.html'), join(paths.knowledgeContent, 'published-standalone/index.html'), join(paths.travelContent, 'catalog/trips.json'), join(paths.travelContent, 'catalog/routes.json'), join(paths.travelContent, 'catalog/photo-credits.json'), join(paths.travelContent, 'published/index.html'), paths.finance]) {
    await mkdir(dirname(file), { recursive: true, mode: 0o700 });
    await writeFile(file, 'Synthetic content.', { mode: 0o600 });
  }
  await mkdir(paths.slidesState, { recursive: true, mode: 0o700 });
  await mkdir(paths.intelligence, { recursive: true, mode: 0o700 });
  const settings = await resolveStackSettings({ env: f.env, home: f.root });
  return { ...f, paths, settings };
}

test('configured roots bind Finance and both content apps explicitly and keep observations separate within the platform root', async t => {
  const f = await configuredWorkingRoots(t);
  assert.equal(f.settings.workingPaths.finance, f.paths.finance);
  assert.equal(f.settings.observationsDir, f.paths.observations);
  await validateData(f.settings);
  await writeComposeEnvironment(f.settings);
  const { services } = JSON.parse(await readFile(f.settings.travelMapOverrideFile, 'utf8'));
  assert.deepEqual(services.finance.volumes, [{ type: 'bind', source: dirname(f.paths.finance), target: '/data', read_only: false, bind: { create_host_path: false } }]);
  assert.equal(services.travel.environment.TRAVEL_CONTENT_ROOT, '/data/content');
  assert.equal(services.travel.volumes[0].source, f.paths.travelContent);
  assert.equal(services.travel.volumes[0].read_only, true);
  assert.ok(services.knowledge.command.includes('/data/content/published-standalone'));
  assert.equal(services['knowledge-public'].environment.KNOWLEDGE_STATIC_DIR, '/data/content/published');
  assert.equal(services['knowledge-public'].environment.KNOWLEDGE_CONTENT_ROOT, '/data/content');
  await assert.rejects(resolveStackSettings({ env: { ...f.env, PRAXIS_OBSERVATIONS_DIR: f.paths.knowledge }, home: f.root }), /configured application working root/);
  await assert.rejects(validateObservationsDirectory(f.paths.knowledge, { uid: f.settings.uid, protectedPaths: f.settings.observationsProtectedPaths }), /dedicated private directory/);
});

test('configured Finance and published data fail closed when missing without creating replacements', async t => {
  const f = await configuredWorkingRoots(t);
  await rm(f.paths.finance);
  await assert.rejects(validateData(f.settings), /missing or unsafe/);
  await assert.rejects(stat(f.paths.finance), { code: 'ENOENT' });
  await writeFile(f.paths.finance, 'Synthetic content.', { mode: 0o600 });
  const index = join(f.paths.knowledgeContent, 'published/index.html');
  await rm(index);
  await assert.rejects(validateData(f.settings), /missing or unsafe/);
  await assert.rejects(stat(index), { code: 'ENOENT' });
});

test('Intelligence preview and external-data modes are explicit, fingerprinted and read-only mounted', async t => {
  const f = await configuredWorkingRoots(t);
  assert.equal(f.settings.intelligencePreview, '1');
  await writeComposeEnvironment(f.settings);
  const projection = JSON.parse(await readFile(f.settings.travelMapOverrideFile, 'utf8'));
  assert.deepEqual(projection.services.intelligence.volumes, [{ type: 'bind', source: f.paths.intelligence, target: '/data/intelligence', read_only: true, bind: { create_host_path: false } }]);
  assert.equal(projection.services.intelligence.environment.INTELLIGENCE_DATA_DIR, '/data/intelligence');
  const external = await resolveStackSettings({ env: { ...f.env, PRAXIS_INTELLIGENCE_PREVIEW: '0' }, home: f.root });
  assert.notEqual(external.sourceFingerprint, f.settings.sourceFingerprint);
  await assert.rejects(validateData(external), /Intelligence data mode requires an existing canonical intelligence.db/);
  await assert.rejects(stat(join(f.paths.intelligence, 'data.json')), { code: 'ENOENT' });
  await assert.rejects(resolveStackSettings({ env: { ...f.env, PRAXIS_INTELLIGENCE_PREVIEW: 'yes' }, home: f.root }), /0 or 1/);
  f.config.intelligencePreview = false; await writeFile(f.configPath, JSON.stringify(f.config));
  const configured = await resolveStackSettings({ env: f.env, home: f.root }); assert.equal(configured.intelligencePreview, '0');
});
