import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DeploymentController, getDeploymentPaths } from '../src/deployment/controller.mjs';
import { readDeploymentState, writeDeploymentState } from '../src/deployment/state.mjs';
import { main } from '../scripts/deploy.mjs';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'praxis-rebind-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const paths = getDeploymentPaths(root), trace = [], containers = new Map();
  let clock = 0;
  const prototype = name => ({ Name: '/' + name, Config: { Env: ['PRIVATE=SYNTHETIC_SECRET'] }, HostConfig: {}, Mounts: [{ Type: 'bind', Source: '/synthetic/new', Destination: '/data', RW: true }] });
  const ops = {
    failStage: null,
    exists: async name => containers.has(name) ? { State: { Running: containers.get(name) } } : null,
    buildImage: async image => { trace.push(['pin', image]); return 'sha256:verified'; },
    stage: async (color, image, prototypes, state) => {
      trace.push(['stage', color, image, prototypes.core.Mounts[0].Source, state.writer, state.paused]);
      containers.set(`praxis-${color}-core`, true); containers.set(`praxis-${color}-web`, true);
      if (ops.failStage === color) throw Object.assign(new Error('Synthetic stage failure'), { code: 'SYNTHETIC_STAGE_FAILED' });
      return { image, coreContainer: `praxis-${color}-core`, webContainer: `praxis-${color}-web`, leaseOwner: `${color}-new` };
    },
    health: async (color, state, expected) => {
      const role = state.writer === color ? 'active' : 'standby';
      trace.push(['health', color, role]);
      if (!containers.get(`praxis-${color}-core`)) throw new Error('Stopped');
      if (expected && expected !== role) throw new Error('Wrong role');
      return { healthy: true, role };
    },
    stop: async name => { trace.push(['stop', name]); containers.set(name, false); },
    start: async name => { trace.push(['start', name]); containers.set(name, true); },
    applyFacade: async () => { trace.push(['facade']); },
    control: async () => ({ ...(await readDeploymentState(paths.state)), valid: true, inFlight: { normal: 0 } }),
  };
  const controller = new DeploymentController({ root, ops, timeoutMs: 5, now: () => clock, sleep: async () => { clock += 2; } });
  await controller.prepare();
  await writeDeploymentState(paths.state, { version: 1, generation: 7, active: 'green', writer: null, paused: true, slots: { blue: { core: 'http://127.0.0.1:24326', web: 'http://127.0.0.1:24321' }, green: { core: 'http://127.0.0.1:34326', web: 'http://127.0.0.1:34321' } } });
  const manifest = { version: 1, enabled: true, active: 'green', previous: 'blue', slots: Object.fromEntries(['blue', 'green'].map(color => [color, { image: 'sha256:old', coreContainer: `praxis-${color}-core`, webContainer: `praxis-${color}-web` }])) };
  for (const slot of Object.values(manifest.slots)) { containers.set(slot.coreContainer, false); containers.set(slot.webContainer, false); }
  await writeFile(paths.manifest, JSON.stringify(manifest), { mode: 0o600 });
  await writeFile(join(paths.prototypeDir, 'core.json'), JSON.stringify(prototype('core')), { mode: 0o600 });
  await writeFile(join(paths.prototypeDir, 'web.json'), JSON.stringify(prototype('web')), { mode: 0o600 });
  return { controller, paths, ops, containers, trace, manifest };
}

test('offline rebind recreates both slots from current mounts with no writer until explicit up', async t => {
  const f = await fixture(t);
  const result = await f.controller.rebind({ image: 'verified-candidate:local' });
  assert.equal(result.rebound, true); assert.equal(result.active, 'green'); assert.equal(result.writer, null); assert.equal(result.paused, true); assert.equal(result.healthy, false);
  assert.deepEqual(f.trace.filter(row => row[0] === 'stage'), [['stage', 'blue', 'sha256:verified', '/synthetic/new', null, true], ['stage', 'green', 'sha256:verified', '/synthetic/new', null, true]]);
  assert.ok(f.trace.filter(row => row[0] === 'health').every(row => row[2] === 'standby'));
  assert.ok(!f.trace.some(row => row[0] === 'facade'));
  const manifest = JSON.parse(await readFile(f.paths.manifest));
  assert.equal(manifest.active, 'green'); assert.equal(manifest.previous, null); assert.equal(manifest.rebindPending, undefined);
  assert.equal(manifest.slots.blue.image, 'sha256:verified'); assert.equal(manifest.slots.green.image, 'sha256:verified');
  assert.ok(!JSON.stringify(result).includes('SYNTHETIC_SECRET'));
  const up = await f.controller.up();
  assert.equal(up.healthy, true); assert.equal(up.writer, 'green');
});

test('rebind rejects active writers, manifest disagreement and any running slot before image staging', async t => {
  const f = await fixture(t);
  await assert.rejects(f.controller.rebind(), { code: 'REBIND_IMAGE_REQUIRED' });
  await f.controller.change({ writer: 'green' });
  await assert.rejects(f.controller.rebind({ image: 'candidate' }), { code: 'DEPLOYMENT_MUST_BE_STOPPED' });
  await f.controller.change({ writer: null, active: 'blue' });
  await assert.rejects(f.controller.rebind({ image: 'candidate' }), { code: 'DEPLOYMENT_MUST_BE_STOPPED' });
  await f.controller.change({ active: 'green' });
  f.containers.set('praxis-blue-web', true);
  await assert.rejects(f.controller.rebind({ image: 'candidate' }), { code: 'DEPLOYMENT_CONTAINERS_MUST_BE_STOPPED' });
  assert.equal(f.trace.length, 0);
});

test('partial rebind stops candidate slots, preserves active and blocks up until a successful retry', async t => {
  const f = await fixture(t); f.ops.failStage = 'green';
  await assert.rejects(f.controller.rebind({ image: 'candidate' }), { code: 'SYNTHETIC_STAGE_FAILED' });
  const state = await readDeploymentState(f.paths.state);
  assert.equal(state.active, 'green'); assert.equal(state.writer, null); assert.equal(state.paused, true);
  assert.ok([...f.containers.values()].every(running => running === false));
  const manifest = JSON.parse(await readFile(f.paths.manifest));
  assert.equal(manifest.active, 'green'); assert.equal(manifest.slots.green.image, 'sha256:old');
  assert.equal(manifest.lastFailure.phase, 'rebind'); assert.equal(manifest.rebindPending.image, 'sha256:verified');
  await assert.rejects(f.controller.up(), { code: 'DEPLOYMENT_REBIND_REQUIRED' });
  f.ops.failStage = null;
  assert.equal((await f.controller.rebind({ image: 'candidate' })).rebound, true);
});

test('rebind CLI passes an explicit candidate and rejects image flags on unrelated commands', async () => {
  let received;
  assert.deepEqual(await main(['rebind', '--image', 'verified-image'], { controller: { rebind: async value => { received = value; return { rebound: true }; } }, print: false }), { rebound: true });
  assert.deepEqual(received, { image: 'verified-image' });
  await assert.rejects(main(['status', '--image', 'image'], { controller: {}, print: false }), /Usage/);
});
