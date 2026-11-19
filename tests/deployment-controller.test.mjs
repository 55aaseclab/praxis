import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readFile, writeFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DeploymentController, getDeploymentPaths, isDeploymentEnabled, DockerDeploymentOps } from '../src/deployment/controller.mjs';
import { readDeploymentState } from '../src/deployment/state.mjs';
import { main } from '../scripts/deploy.mjs';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'praxis-deploy-controller-')); t.after(() => rm(root, { recursive: true, force: true }));
  const paths = getDeploymentPaths(root), trace = []; let now = 0, image = 0;
  const prototype = name => ({ Name: '/' + name, Image: 'sha256:original', Config: { Env: ['PRIVATE_TOKEN=SYNTHETIC_SECRET'], Labels: {}, Cmd: ['node', 'old.mjs'] }, HostConfig: {}, Mounts: [] });
  const ops = {
    badCandidate: false, failActivation: false,
    original: async service => prototype(Array.isArray(service) ? service[0] : service),
    buildImage: async value => value || 'sha256:candidate-' + (++image), buildProxy: async () => 'sha256:router',
    stage: async (color, pinned) => { trace.push(['stage', color, pinned]); return { image: pinned, webContainer: `praxis-${color}-web`, coreContainer: `praxis-${color}-core`, leaseOwner: color + '-owner' }; },
    stop: async name => { trace.push(['stop', name]); }, start: async name => { trace.push(['start', name]); },
    facades: async () => { trace.push(['facades']); }, applyFacade: async value => { trace.push(['facade', value.Name]); }, restoreOriginal: async value => { trace.push(['restore', value.Name]); },
    health: async (color, state, role) => {
      trace.push(['health', color, role, state.writer, state.paused]);
      if (color === 'green' && ops.badCandidate) throw new Error('Synthetic unhealthy candidate.');
      if (color === 'green' && ops.failActivation && state.writer === 'green') throw new Error('Synthetic activation failure.');
      const actual = state.writer === color ? 'active' : 'standby';
      if (role && role !== actual) throw new Error('Unexpected role.'); return { healthy: true, role: actual, version: 'synthetic' };
    },
    control: async (_channel, method) => { const state = await readDeploymentState(paths.state); trace.push(['control', method || 'GET', state.generation, state.writer]); return { ...state, valid: true, inFlight: { normal: 0, streams: 0, upgrades: 0 }, queued: 0 }; },
  };
  const controller = new DeploymentController({ root, ops, timeoutMs: 5, now: () => now, sleep: async () => { now += 2; } });
  return { controller, ops, trace, paths };
}

test('initialization preserves private prototypes and single writer; subsequent deploy and rollback switch both entries', async t => {
  const f = await fixture(t);
  assert.equal(await isDeploymentEnabled(f.paths.root), false);
  const initialized = await f.controller.init(); assert.equal(initialized.active, 'blue'); assert.equal(initialized.healthy, true);
  assert.equal(await isDeploymentEnabled(f.paths.root), true);
  assert.ok(f.trace.findIndex(item => item[0] === 'stop' && item[1] === 'business') < f.trace.findIndex(item => item[0] === 'health' && item[2] === 'active'));
  assert.equal((await stat(join(f.paths.prototypeDir, 'core.json'))).mode & 0o777, 0o600);
  assert.ok((await readFile(join(f.paths.prototypeDir, 'core.json'), 'utf8')).includes('SYNTHETIC_SECRET'));
  const deployed = await f.controller.deploy({ image: 'sha256:new' });
  assert.equal(deployed.active, 'green'); assert.equal(deployed.writer, 'green'); assert.equal(deployed.rollbackAvailable, true);
  assert.ok(!JSON.stringify(deployed).includes('SYNTHETIC_SECRET'));
  const rolled = await f.controller.rollback(); assert.equal(rolled.active, 'blue'); assert.equal(rolled.writer, 'blue'); assert.equal(rolled.healthy, true);
  assert.ok(f.trace.some(item => item[0] === 'health' && item[2] === 'standby' && item[3] === null));
});

test('an unhealthy staged image never pauses or changes the active release', async t => {
  const f = await fixture(t); await f.controller.init(); const original = await readDeploymentState(f.paths.state); f.ops.badCandidate = true;
  await assert.rejects(f.controller.deploy(), { code: 'DEPLOYMENT_HEALTH_TIMEOUT' });
  assert.deepEqual(await readDeploymentState(f.paths.state), original);
  assert.equal((await f.controller.status()).healthy, true);
  const failure = JSON.parse(await readFile(f.paths.manifest, 'utf8')).lastFailure;
  assert.equal(failure.phase, 'candidate'); assert.equal(failure.code, 'DEPLOYMENT_HEALTH_TIMEOUT');
});

test('failed activation restores the old writer and route before unpausing', async t => {
  const f = await fixture(t); await f.controller.init(); f.ops.failActivation = true;
  await assert.rejects(f.controller.deploy(), { code: 'DEPLOYMENT_HEALTH_TIMEOUT' });
  const state = await readDeploymentState(f.paths.state); assert.equal(state.active, 'blue'); assert.equal(state.writer, 'blue'); assert.equal(state.paused, false);
  assert.equal((await f.controller.status()).healthy, true);
  const failure = JSON.parse(await readFile(f.paths.manifest, 'utf8')).lastFailure;
  assert.equal(failure.phase, 'handoff'); assert.equal(failure.restored, 'blue');
});

test('deployment lock prevents concurrent mutation and cold up restores facades after slots', async t => {
  const f = await fixture(t); await f.controller.init();
  await writeFile(f.paths.lock, 'synthetic-lock', { mode: 0o600 }); const before = f.trace.length;
  await assert.rejects(f.controller.deploy(), { code: 'DEPLOYMENT_LOCKED' }); assert.equal(f.trace.length, before);
  await rm(f.paths.lock); await f.controller.down(); assert.equal((await readDeploymentState(f.paths.state)).writer, null);
  const offset = f.trace.length; const result = await f.controller.up(); assert.equal(result.healthy, true);
  const trace = f.trace.slice(offset); assert.ok(trace.findIndex(item => item[0] === 'start') < trace.findIndex(item => item[0] === 'facade'));
});

test('Docker stage pins nested gateway requests to the same color and preserves original named mounts', async t => {
  const f = await fixture(t); await f.controller.prepare(); const calls = [];
  const ops = new DockerDeploymentOps(f.paths, { run: async args => { calls.push(args); if (args[0] === 'inspect') throw new Error('Synthetic absent container.'); return ''; } });
  const prototype = { Config: { Env: ['SECRET=SYNTHETIC_SECRET'], User: '1000:1000', WorkingDir: '/workspace' }, HostConfig: { ReadonlyRootfs: true, Init: true, Tmpfs: { '/tmp': 'rw' }, CapDrop: ['ALL'], SecurityOpt: ['no-new-privileges:true'] }, Mounts: [{ Type: 'volume', Name: 'same-canonical-volume', Source: '/docker/private/path', Destination: '/data', RW: true }] };
  await ops.stage('blue', 'sha256:immutable', { core: prototype, web: prototype }, { slots: { blue: { core: 'http://127.0.0.1:24326', web: 'http://127.0.0.1:24321' } } });
  const core = calls.find(args => args[0] === 'create' && args[2] === 'praxis-blue-core'), web = calls.find(args => args[0] === 'create' && args[2] === 'praxis-blue-web');
  assert.ok(core.includes('type=volume,source=same-canonical-volume,target=/data')); assert.ok(!core.includes('SYNTHETIC_SECRET'));
  const env = await readFile(web[web.indexOf('--env-file') + 1], 'utf8'); assert.match(env, /PRAXIS_WEB_CORE_URL=http:\/\/127.0.0.1:24326/);
  assert.ok(!core.some(value => value.startsWith('com.docker.compose.')));
});

test('private documents are optional read-only web mounts and invalid configuration stops staging', async t => {
  const { paths, controller } = await fixture(t);
  await controller.prepare();
  const calls = [];
  const ops = new DockerDeploymentOps(paths, { run: async args => {
    calls.push(args);
    if (args[0] === 'inspect') throw new Error('Synthetic absent container.');
    return '';
  } });
  const prototype = { Config: { Env: [] }, HostConfig: {}, Mounts: [] };
  const prototypes = { core: prototype, web: prototype };
  const state = { slots: { blue: { core: 'http://127.0.0.1:24326', web: 'http://127.0.0.1:24321' } } };
  const stage = () => ops.stage('blue', 'sha256:synthetic', prototypes, state);
  const created = service => calls.find(args => args[0] === 'create' && args.includes('praxis-blue-' + service));
  const envFile = args => readFile(args[args.indexOf('--env-file') + 1], 'utf8');

  await stage();
  assert.ok(!created('web').some(arg => arg.includes('/run/praxis-documents/')));
  assert.doesNotMatch(await envFile(created('web')), /PRAXIS_DOCUMENT_OWNER_ID|PRAXIS_(?:LETTERS|PROFILES)_DIR/);
  calls.length = 0;

  const config = { ownerId: 'synthetic-owner', letters: join(paths.root, 'letters'), profiles: join(paths.root, 'profiles') };
  await mkdir(config.letters); await mkdir(config.profiles);
  const file = join(paths.root, 'private-documents.json');
  await writeFile(file, JSON.stringify(config), { mode: 0o600 });
  await stage();
  const core = created('core'), web = created('web'), webEnv = await envFile(web);
  assert.match(webEnv, /^PRAXIS_DOCUMENT_OWNER_ID=synthetic-owner$/m);
  assert.doesNotMatch(await envFile(core), /PRAXIS_DOCUMENT_OWNER_ID|PRAXIS_(?:LETTERS|PROFILES)_DIR/);
  for (const id of ['letters', 'profiles']) {
    const target = '/run/praxis-documents/' + id;
    assert.deepEqual(web.filter(arg => arg.includes('target=' + target)), [
      'type=bind,source=' + config[id] + ',target=' + target + ',readonly',
    ]);
    assert.ok(webEnv.split('\n').includes('PRAXIS_' + id.toUpperCase() + '_DIR=' + target));
    assert.ok(!core.some(arg => arg.includes(config[id]) || arg.includes(target)));
  }
  calls.length = 0;
  await chmod(file, 0o644);
  await assert.rejects(stage(), { code: 'INVALID_PRIVATE_DOCUMENT_CONFIG' });
  assert.deepEqual(calls, []);
  await chmod(file, 0o600);
  await writeFile(file, JSON.stringify({ ...config, profiles: config.letters }));
  await assert.rejects(stage(), { code: 'INVALID_PRIVATE_DOCUMENT_CONFIG' });
  assert.deepEqual(calls, []);
});

test('deployment CLI returns metadata and rejects unknown commands without executing Docker', async () => {
  const seen = [], controller = { status: async () => ({ enabled: false }) };
  assert.deepEqual(await main(['status'], { controller, print: value => seen.push(JSON.parse(value)) }), { enabled: false });
  assert.deepEqual(seen, [{ enabled: false }]);
  await assert.rejects(main(['replace-data'], { controller, print: false }), /Usage/);
});

test('facade overrides replace inherited application healthchecks and exclude application credentials', async t => {
  const f = await fixture(t); await f.controller.prepare();
  const ops = new DockerDeploymentOps(f.paths, { run: async () => '' });
  await ops.facades({ core: { Config: { User: '1000:1000', Labels: { 'com.docker.compose.service': 'core' } } }, web: { Config: { User: '1000:1000', Labels: { 'com.docker.compose.service': 'praxis-public' } } } }, 'sha256:router');
  for (const file of [f.paths.appsOverride, f.paths.businessOverride]) {
    const yaml = await readFile(file, 'utf8');
    const health = JSON.parse(yaml.match(/^    healthcheck: !override (.+)$/m)[1]);
    assert.equal(health.test[0], 'CMD'); assert.equal(health.test[1], 'node');
    assert.match(health.test[3], /fetch\(process\.env\.HEALTH_URL/);
    assert.ok(!yaml.includes('PRAXIS_BUSINESS_CONFIG')); assert.ok(!yaml.includes('SYNTHETIC_SECRET'));
    assert.equal((await stat(file)).mode & 0o777, 0o600);
  }
});

test('dead-process and previous-boot locks recover while live or malformed owners remain protected', async t => {
  const f = await fixture(t); await f.controller.prepare();
  const bootId = (await readFile('/proc/sys/kernel/random/boot_id', 'utf8')).trim();
  const dead = { pid: 2147483647, uid: process.getuid(), bootId, startTick: '1' };
  await writeFile(f.paths.lock, JSON.stringify(dead), { mode: 0o600 });
  assert.equal(await f.controller.locked(async () => 'recovered'), 'recovered');
  await writeFile(f.paths.lock, JSON.stringify({ ...dead, pid: process.pid, bootId: '00000000-0000-0000-0000-000000000000' }), { mode: 0o600 });
  assert.equal(await f.controller.locked(async () => 'boot-recovered'), 'boot-recovered');
  await f.controller.locked(async () => { await assert.rejects(f.controller.locked(async () => {}), { code: 'DEPLOYMENT_LOCKED' }); });
  await writeFile(f.paths.lock, 'malformed', { mode: 0o600 });
  await assert.rejects(f.controller.locked(async () => {}), { code: 'DEPLOYMENT_LOCKED' });
  assert.equal(await readFile(f.paths.lock, 'utf8'), 'malformed');
});

test('healthy up is idempotent and an interrupted route-to-manifest commit requires explicit recovery', async t => {
  const f = await fixture(t); await f.controller.init(); await f.controller.deploy();
  let offset = f.trace.length; assert.equal((await f.controller.up()).healthy, true);
  assert.ok(!f.trace.slice(offset).some(item => ['start', 'stop', 'facade', 'stage'].includes(item[0])));
  await f.controller.change({ active: 'blue', writer: 'blue' });
  const status = await f.controller.status(); assert.equal(status.needsRecovery, true); assert.equal(status.healthy, false);
  offset = f.trace.length;
  await assert.rejects(f.controller.deploy(), { code: 'DEPLOYMENT_RECOVERY_REQUIRED' });
  await assert.rejects(f.controller.rollback(), { code: 'DEPLOYMENT_RECOVERY_REQUIRED' });
  assert.equal(f.trace.length, offset);
  const recovered = await f.controller.up(); assert.equal(recovered.active, 'green'); assert.equal(recovered.healthy, true); assert.equal(recovered.needsRecovery, false);
});


test('facades use the prototype service label for core and legacy installations', async t => {
  const f = await fixture(t); await f.controller.prepare();
  const ops = new DockerDeploymentOps(f.paths, { run: async () => '' });
  for (const service of ['core', 'business']) {
    const core = { Config: { Labels: { 'com.docker.compose.service': service } } };
    const web = { Config: { Labels: { 'com.docker.compose.service': 'praxis-public' } } };
    await ops.facades({ core, web }, 'sha256:router');
    assert.match(await readFile(f.paths.coreOverride, 'utf8'), new RegExp('^services:\n  ' + service + ':', 'm'));
    assert.equal(f.paths.coreOverride, f.paths.businessOverride);
  }
  await assert.rejects(ops.facades({ core: { Config: { Labels: {} } }, web: { Config: { Labels: { 'com.docker.compose.service': 'praxis-public' } } } }, 'sha256:router'), { code: 'INVALID_FACADE_SERVICE' });
});

test('core discovery supports one legacy facade and refuses ambiguous writers', async t => {
  const f = await fixture(t), containers = new Map();
  const root = process.cwd();
  const prototype = service => ({ Config: { Labels: { 'com.docker.compose.service': service, 'com.docker.compose.project.working_dir': root } } });
  const ops = new DockerDeploymentOps(f.paths, { run: async args => args[0] === 'ps' ? [...containers.keys()].filter(id => args.includes('label=com.docker.compose.service=' + id)).join('\n') : JSON.stringify([containers.get(args[1])]) });
  containers.set('business', prototype('business'));
  assert.equal((await ops.original(['core', 'business'])).Config.Labels['com.docker.compose.service'], 'business');
  containers.set('core', prototype('core'));
  await assert.rejects(ops.original(['core', 'business']), { code: 'ORIGINAL_SERVICE_UNAVAILABLE' });
  containers.delete('business');
  assert.equal((await ops.original(['core', 'business'])).Config.Labels['com.docker.compose.service'], 'core');
});
