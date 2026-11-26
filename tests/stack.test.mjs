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
  for (const name of ['tingproof', 'slides/decks', 'slides/.lattice']) await mkdir(join(settings.appsRoot, name), { recursive: true });
  for (const name of ['tingproof/tingproof.db', 'slides/decks/registry.js']) await writeFile(join(settings.appsRoot, name), 'Synthetic nonempty file.');
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
  assert.ok(replaced.includes('tingproof') && replaced.includes('intelligence'));
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
  const file = join(settings.appsRoot, 'tingproof/tingproof.db');
  await rm(file);
  await assert.rejects(validateData(settings), /Refusing to initialize or replace/);
  await assert.rejects(stat(file), { code: 'ENOENT' });
});

test('stack refuses writes from a standby device before invoking Compose', async t => {
  const { config, configPath, env, root } = await fixture(t);
  await writeFile(configPath, JSON.stringify({ ...config, activeWriterDeviceId: 'another-device' }));
  const docker = fakeDocker();
  await assert.rejects(main(['exec', 'tingproof', '--', 'node', 'src/cli.js', 'ls'], { env, home: root, run: docker.run }), /not the active workspace writer/);
  assert.ok(!docker.calls.some(call => call.args.includes('exec')));
});

test('an existing native listener prevents startup and is never stopped', async t => {
  const { env, root, settings } = await fixture(t);
  const docker = fakeDocker();
  await assert.rejects(main(['up'], { env, home: root, run: docker.run, portInUse: async port => port === 15173 }), /tingproof-public:15173/);
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
  assert.ok((await stat(join(settings.appsRoot, 'tingproof/tingproof.db'))).isFile());
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
  await main(['--apps-root', settings.appsRoot, 'exec', 'tingproof', '--', 'node', 'src/cli.js', 'add', text], { env: { ...env, PRAXIS_APPS_ROOT: '/wrong/environment/path' }, home: root, run: docker.run });
  const call = docker.calls.find(item => item.args.includes('exec'));
  assert.deepEqual(call.args.slice(-7), ['exec', '-T', 'tingproof', 'node', 'src/cli.js', 'add', text]);
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
  for (const name of ['tingproof', 'slides/decks', 'slides/.lattice']) await mkdir(join(native, name), { recursive: true });
  const sources = [
    { id: 'tingproof', kind: 'sqlite', target: 'tingproof.db', source: join(native, 'tingproof/tingproof.db') },
    { id: 'slides', kind: 'directory', target: 'decks', source: join(native, 'slides/decks') },
    { id: 'slides', kind: 'directory', target: '.lattice', source: join(native, 'slides/.lattice') },
  ];
  for (const file of [sources[0].source, join(sources[1].source, 'registry.js')]) await writeFile(file, 'Synthetic registered source remains unchanged.');
  f.config.appSources = sources;
  await writeFile(f.configPath, JSON.stringify(f.config)); await chmod(f.configPath, 0o600);
  f.registeredSettings = await resolveStackSettings({ env: f.env, home: f.root, sourceMode: 'registered' });
  return f;
}

test('registered-source plan is read-only and binds original canonical data without creating copied stores', async t => {
  const f = await registered(t);
  const result = await main(['plan', '--source-mode', 'registered'], { env: f.env, home: f.root, print() {}, run: async () => { throw new Error('Read-only plan must not call Docker'); } });
  assert.equal(result.sourceMode, 'registered');
  assert.equal(result.services.length, Object.keys(SERVICES).length);
  assert.equal(result.sourceMap.slidesDecks, f.config.appSources[1].source);
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
  for (const observationsDir of [f.registeredSettings.appsRoot, f.registeredSettings.stateRoot, join(f.root, 'native/tingproof/nested'), secret, join(f.root, 'repositories/local'), join(f.root, 'source-repository'), join(f.root, 'docker-apps'), f.root]) {
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
  const f = await registered(t), docker = fakeDocker(healthyRows());
  const result = await main(['up', '--source-mode', 'registered'], { env: f.env, home: f.root, print() {}, run: docker.run, portInUse: async () => false });
  assert.equal(result.services.length, Object.keys(SERVICES).length);
  const receipt = JSON.parse(await readFile(f.registeredSettings.receiptFile, 'utf8'));
  assert.equal(receipt.schemaVersion, 2);
  assert.equal(receipt.sourceMode, 'registered');
  assert.equal(receipt.sourceFingerprint, f.registeredSettings.sourceFingerprint);
  assert.deepEqual(receipt.sourceMap, f.registeredSettings.sourceMap);
    const up = docker.calls.find(call => call.args.includes('up'));
    assert.equal(up.options.env.PRAXIS_TINGPROOF_DATA_DIR, join(f.root, 'native/tingproof'));
  assert.equal(up.options.env.PRAXIS_SLIDES_STATE_DIR, join(f.root, 'native/slides/.lattice'));
  await assert.rejects(stat(f.settings.appsRoot), { code: 'ENOENT' });
});

test('registered mode rejects symbolic-link sources and duplicate TingProof writers', async t => {
  const f = await registered(t);
  const linked = join(f.root, 'native/alias/tingproof.db');
  await mkdir(dirname(linked), { recursive: true, mode: 0o700 });
  await symlink(f.config.appSources[1].source, linked);
  f.config.appSources[1].source = linked;
  await writeFile(f.configPath, JSON.stringify(f.config));
  const settings = await resolveStackSettings({ env: f.env, home: f.root, sourceMode: 'registered' });
  await assert.rejects(validateData(settings), /symbolic-link/);
  f.config.appSources[1].source = join(f.root, 'native/tingproof/tingproof.db');
  f.config.appSources.push({ id: 'tingproof', kind: 'sqlite', target: 'tingproof.db', source: f.config.appSources[1].source }); await writeFile(f.configPath, JSON.stringify(f.config));
  const docker = fakeDocker(healthyRows());
  await assert.rejects(main(['status', '--source-mode', 'registered'], { env: f.env, home: f.root, run: docker.run, print() {} }), /One registered tingproof\/tingproof\.db/);
});

async function configuredWorkingRoots(t) {
  const f = await fixture(t);
  const { resolveAppPaths, appStorageSources } = await import('../src/storage/app-paths.mjs');
  f.config.workingData = { version: 1, roots: { intelligence: join(f.root, 'other-disk/intelligence') } };
  f.config.dockerSourceMode = 'registered';
  const paths = resolveAppPaths(f.config);
  f.config.appSources = appStorageSources(paths, {});
  await writeFile(f.configPath, JSON.stringify(f.config));
  for (const file of [paths.tingproof, join(paths.slidesDecks, 'registry.js')]) {
    await mkdir(dirname(file), { recursive: true, mode: 0o700 });
    await writeFile(file, 'Synthetic content.', { mode: 0o600 });
  }
  await mkdir(paths.slidesState, { recursive: true, mode: 0o700 });
  await mkdir(paths.intelligence, { recursive: true, mode: 0o700 });
  const settings = await resolveStackSettings({ env: f.env, home: f.root });
  return { ...f, paths, settings };
}

test('configured published data fails closed when missing without creating replacements', async t => {
  const f = await configuredWorkingRoots(t);
  const registry = join(f.paths.slidesDecks, 'registry.js');
  await rm(registry);
  await assert.rejects(validateData(f.settings), /Refusing to initialize or replace/);
  await assert.rejects(stat(registry), { code: 'ENOENT' });
  await writeFile(registry, 'Synthetic content.', { mode: 0o600 });
  const store = f.paths.tingproof;
  await rm(store);
  await assert.rejects(validateData(f.settings), /Refusing to initialize or replace/);
  await assert.rejects(stat(store), { code: 'ENOENT' });
});

