import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { activateRegisteredSources, prepareDocker } from '../scripts/storage-bootstrap.mjs';
import { SERVICES } from '../scripts/stack.mjs';

test('offline Docker preparation verifies copies, preserves native source and refuses overwrite', async t => {
  const root = await mkdtemp(join(tmpdir(), 'praxis-bootstrap-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const file = join(root, 'native.json');
  const raw = JSON.stringify({ version: 2, plans: [], recurring: [], pool: [], history: [] });
  await writeFile(file, raw);
  const deviceId = randomUUID();
  const config = { dataRoot: join(root, 'data'), deviceId, activeWriterDeviceId: deviceId, workspaceId: randomUUID(), appSources: [{ id: 'reminder', kind: 'json', source: file, target: 'checklist.json', schema: 'reminder-v2' }] };
  await assert.rejects(prepareDocker(config, { checkWriters: false }), /source-stopped assertion/);
  const copied = await prepareDocker(config, { checkWriters: false, sourceStopped: true });
  assert.equal(await readFile(join(copied.appsRoot, 'reminder/checklist.json'), 'utf8'), raw);
  assert.equal(await readFile(file, 'utf8'), raw);
  await assert.rejects(prepareDocker(config, { checkWriters: false, sourceStopped: true }), /refusing to overwrite/);
  await assert.rejects(prepareDocker({ ...config, activeWriterDeviceId: randomUUID() }, { checkWriters: false, sourceStopped: true }), /active writer/);
  await assert.rejects(prepareDocker({ ...config, runtime: 'docker' }, { checkWriters: false, sourceStopped: true }), /already registered/);
});

test('registered activation changes only runtime metadata and rejects stale copied-store receipts', () => {
  const deviceId = randomUUID(), workspaceId = randomUUID();
  const config = { deviceId, activeWriterDeviceId: deviceId, workspaceId, runtime: 'native', appSources: [{ id: 'reminder', source: '/synthetic/native/checklist.json' }], sourceRepos: [{ id: 'praxis', path: '/synthetic/code' }] };
  const fingerprint = 'a'.repeat(64), sourceMap = { reminder: '/synthetic/native/checklist.json' };
  const names = Object.keys(SERVICES).filter(name => name !== 'reminder');
  const receipt = { schemaVersion: 2, sourceMode: 'registered', workspaceId, projectName: 'synthetic-stack', sourceFingerprint: fingerprint, sourceMap, services: names };
  const status = { healthy: true, sourceMode: 'registered', sourceFingerprint: fingerprint, workspaceId, projectName: 'synthetic-stack', services: names.map(name => ({ name })) };
  const options = { sourceFingerprint: fingerprint, sourceMap, businessConfigFile: '/synthetic/private/business.json' };
  const next = activateRegisteredSources(config, receipt, status, options);
  assert.equal(next.runtime, 'docker');
  assert.equal(next.dockerSourceMode, 'registered');
  assert.equal(next.businessConfigFile, options.businessConfigFile);
  assert.equal(next.appSources, config.appSources);
  assert.equal(next.sourceRepos, config.sourceRepos);
  assert.throws(() => activateRegisteredSources(config, { ...receipt, schemaVersion: 1 }, status, options), /current registered-source/);
  assert.throws(() => activateRegisteredSources(config, receipt, status, { ...options, sourceFingerprint: 'b'.repeat(64) }), /current registered-source/);
  assert.throws(() => activateRegisteredSources(config, receipt, { ...status, healthy: false }, options), /must be healthy/);
  for (const omitted of ['finance', 'knowledge-public']) {
    const incomplete = names.filter(name => name !== omitted);
    assert.throws(() => activateRegisteredSources(config, { ...receipt, services: incomplete }, { ...status, services: incomplete.map(name => ({ name })) }, options), /current registered-source/);
  }
  assert.throws(() => activateRegisteredSources(config, { ...receipt, services: names.map(name => name === 'finance' ? 'unknown-service' : name) }, status, options), /current registered-source/);
  assert.equal(config.runtime, 'native');
});
