import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID, createHash } from 'node:crypto';
import { collectStorageStatus, publishStorageStatus, validateStorageProjection, validateStorageStatusDestination } from '../src/storage/status.mjs';
import { runStorageStatusPublisher } from '../scripts/storage-status-publisher.mjs';

const now = Date.parse('2026-11-12T10:00:00.000Z'), stamp = offset => new Date(now + offset).toISOString();
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'praxis-storage-status-')); t.after(() => rm(root, { recursive: true, force: true }));
  const stateRoot = join(root, 'metadata'), output = join(root, 'sanitized');
  for (const directory of [stateRoot, output]) await mkdir(directory, { mode: 0o700 });
  const workspaceId = randomUUID(), deviceId = randomUUID(), configFile = join(root, 'storage.json');
  const config = { schemaVersion: 1, workspaceId, deviceId, activeWriterDeviceId: deviceId, dataRoot: join(root, 'data'), stateRoot, repositories: [{ id: 'local', type: 'local', path: join(root, 'repositories/local'), passwordFile: join(root, 'secrets/local-password') }, { id: 'private-provider-title', type: 'jianguoyun', passwordFile: join(root, 'secrets/cloud-password'), credentialsFile: join(root, 'secrets/provider.json') }], appSources: [{ kind: 'json', source: '/private-business-path/secret-title.json' }, { kind: 'sqlite', source: '/private-business-path/secret.db' }, { kind: 'directory', source: '/private-business-path/secret-directory' }] };
  const saveConfig = async () => writeFile(configFile, JSON.stringify(config), { mode: 0o600 }); await saveConfig();
  const state = { schemaVersion: 1, workspaceId, headSnapshotId: 'private-snapshot-id', targets: { local: { status: 'success', lastSnapshotId: 'private-snapshot-id', lastSuccessAt: stamp(-60000), lastVerifiedAt: stamp(-1000), updatedAt: stamp(-1000) }, 'private-provider-title': { status: 'unconfigured', pendingSnapshotId: 'private-snapshot-id', error: { code: 'NOT_CONFIGURED', message: 'PRIVATE-SENTINEL-DO-NOT-LOG' }, updatedAt: stamp(-86400000) } } };
  const saveState = () => writeFile(join(stateRoot, 'repositories.json'), JSON.stringify(state), { mode: 0o600 }); await saveState();
  const worker = { schemaVersion: 1, workspaceId, watcherRunning: true, pid: 999999, heartbeatAt: stamp(-3000), lastResultAt: null, lastResultStatus: 'starting', configDigest: createHash('sha256').update(await readFile(configFile)).digest('hex') };
  const saveWorker = () => writeFile(join(stateRoot, 'worker-heartbeat.json'), JSON.stringify(worker), { mode: 0o600 }); await saveWorker();
  return { root, stateRoot, outputFile: join(output, 'storage-status.json'), configFile, config, state, worker, saveState, saveWorker, saveConfig };
}

test('projection uses only fixed status metadata and separates configured targets from historic credential failures', async t => {
  const f = await fixture(t);
  await mkdir(join(f.stateRoot, 'snapshots'), { mode: 0o700 });
  await writeFile(join(f.stateRoot, 'snapshots/private-body.json'), 'PRIVATE-BUSINESS-BODY');
  const value = await collectStorageStatus({ configFile: f.configFile, now });
  assert.equal(validateStorageProjection(value, now), true);
  assert.equal(value.local.state, 'available');
  assert.equal(value.targets[1].configured, true);
  assert.equal(value.targets[1].state, 'unknown');
  assert.equal(value.targets[1].lastRecordedState, 'unconfigured');
  assert.equal(value.worker.state, 'fresh');
  assert.equal(value.worker.lastResult, 'starting');
  assert.deepEqual(value.working, { mode: 'local', configuredSources: { json: 1, sqlite: 1, directory: 1 } });
  assert.equal(value.coverage.state, 'unknown');
  const serialized = JSON.stringify(value);
  for (const secret of ['PRIVATE-SENTINEL', 'PRIVATE-BUSINESS', 'private-snapshot-id', 'private-provider-title', 'private-business-path', f.root, f.config.workspaceId, String(f.worker.pid), 'NOT_CONFIGURED']) assert.equal(serialized.includes(secret), false);
  assert.equal(await readFile(join(f.stateRoot, 'snapshots/private-body.json'), 'utf8'), 'PRIVATE-BUSINESS-BODY');
});

test('replica timestamps are retained independently from publication freshness and the latest local snapshot', async t => {
  const f = await fixture(t), cloud = f.state.targets['private-provider-title'];
  Object.assign(cloud, { status: 'success', lastSnapshotId: f.state.headSnapshotId, lastSuccessAt: stamp(-3600000), lastCheckAt: stamp(-7200000), lastCheckStatus: 'success' }); await f.saveState();
  const value = await collectStorageStatus({ configFile: f.configFile, now });
  assert.equal(value.targets[1].state, 'synced');
  assert.equal(value.targets[1].lastSuccessAt, stamp(-3600000));
  assert.equal(value.targets[1].lastVerifiedAt, null);
  assert.equal(value.generatedAt, stamp(0));
  cloud.lastSnapshotId = 'older-private-snapshot'; await f.saveState();
  assert.equal((await collectStorageStatus({ configFile: f.configFile, now })).targets[1].state, 'pending');
});

test('stale, stopped and mismatched worker metadata never becomes a synchronized-replica claim', async t => {
  const f = await fixture(t);
  f.worker.heartbeatAt = stamp(-91000); await f.saveWorker();
  assert.equal((await collectStorageStatus({ configFile: f.configFile, now })).worker.state, 'stale');
  f.worker.heartbeatAt = stamp(-1000); f.worker.configDigest = 'a'.repeat(64); await f.saveWorker();
  const mismatch = await collectStorageStatus({ configFile: f.configFile, now });
  assert.equal(mismatch.worker.state, 'stale'); assert.equal(mismatch.worker.configCurrent, false);
  f.worker.watcherRunning = false; await f.saveWorker();
  assert.equal((await collectStorageStatus({ configFile: f.configFile, now })).worker.state, 'stopped');
});

test('missing, corrupt, public and foreign metadata produces unknown without touching sources', async t => {
  const f = await fixture(t);
  f.state.workspaceId = randomUUID(); await f.saveState();
  assert.equal((await collectStorageStatus({ configFile: f.configFile, now })).local.state, 'unknown');
  await writeFile(join(f.stateRoot, 'repositories.json'), 'PRIVATE-INVALID-JSON');
  assert.equal((await collectStorageStatus({ configFile: f.configFile, now })).targets[0].state, 'unknown');
  await chmod(f.configFile, 0o644);
  const denied = await collectStorageStatus({ configFile: f.configFile, now });
  assert.equal(denied.writer, 'unknown'); assert.equal(denied.working.mode, 'unknown'); assert.equal(validateStorageProjection(denied, now), true);
  await chmod(f.configFile, 0o600); await rm(join(f.stateRoot, 'worker-heartbeat.json'));
  assert.equal((await collectStorageStatus({ configFile: f.configFile, now })).worker.state, 'unknown');
});

test('strict projection validation rejects additional fields, unsafe types, unbounded targets and fake future freshness', async t => {
  const f = await fixture(t), value = await collectStorageStatus({ configFile: f.configFile, now });
  for (const change of [copy => { copy.path = '/private'; }, copy => { copy.worker.error = 'PRIVATE'; }, copy => { copy.local.state = 'synced'; }, copy => { copy.targets = Array(17).fill(copy.targets[0]); }, copy => { copy.generatedAt = stamp(6000); }, copy => { copy.freshUntil = stamp(91000); }, copy => { copy.working.configuredSources.json = -1; }, copy => { copy.coverage.state = 'complete'; }]) {
    const invalid = structuredClone(value); change(invalid); assert.equal(validateStorageProjection(invalid, now), false);
  }
  assert.equal(validateStorageProjection(value, now + 90001), true);
});

test('publisher writes private sanitized JSON only and rejects non-dedicated or linked outputs', async t => {
  const f = await fixture(t), configBefore = await readFile(f.configFile), stateBefore = await readFile(join(f.stateRoot, 'repositories.json'));
  await publishStorageStatus({ configFile: f.configFile, outputFile: f.outputFile, now });
  assert.equal((await stat(f.outputFile)).mode & 0o777, 0o600);
  assert.equal(validateStorageProjection(JSON.parse(await readFile(f.outputFile, 'utf8')), now), true);
  await assert.rejects(validateStorageStatusDestination(join(f.stateRoot, 'status.json'), { protectedPaths: [f.stateRoot] }));
  const alias = join(f.root, 'output-alias'); await symlink(f.outputFile, alias);
  await assert.rejects(validateStorageStatusDestination(alias));
  await writeFile(join(f.root, 'sanitized/private-record.json'), '{}', { mode: 0o600 });
  await assert.rejects(publishStorageStatus({ configFile: f.configFile, outputFile: f.outputFile, now }));
  assert.deepEqual(await readFile(f.configFile), configBefore); assert.deepEqual(await readFile(join(f.stateRoot, 'repositories.json')), stateBefore);
});

test('publisher logging is fixed and failures preserve existing sanitized evidence', async t => {
  const f = await fixture(t), controller = new AbortController(), events = [];
  await runStorageStatusPublisher({ configFile: f.configFile, outputFile: f.outputFile }, { signal: controller.signal, intervalMs: 1, output(value) { events.push(value); controller.abort(); } });
  assert.deepEqual(events, [{ event: 'storage-status', state: 'published' }]);
  const before = await readFile(f.outputFile);
  await writeFile(join(f.root, 'sanitized/private.txt'), 'PRIVATE-SENTINEL', { mode: 0o600 });
  const failed = new AbortController();
  await runStorageStatusPublisher({ configFile: f.configFile, outputFile: f.outputFile }, { signal: failed.signal, intervalMs: 1, output(value) { events.push(value); failed.abort(); } });
  assert.deepEqual(events.at(-1), { event: 'storage-status', state: 'unavailable' });
  assert.deepEqual(await readFile(f.outputFile), before);
});
