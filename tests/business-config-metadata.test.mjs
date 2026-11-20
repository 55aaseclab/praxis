import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { loadBusinessConfig } from '../src/business/config.mjs';
import { runBusinessSyncWorker } from '../scripts/business-sync-worker.mjs';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'praxis-metadata-config-')); t.after(() => rm(root, { recursive: true, force: true }));
  const file = join(root, 'business.json'), key = join(root, 'not-mounted.key');
  const config = { issuer: 'https://metadata.example.test', database: join(root, 'identity.sqlite'), eventsDatabase: join(root, 'events.sqlite'), metadataOnly: true,
    apps: { tingproof: { keyFile: key, spaces: ['space-a'], url: 'http://127.0.0.1:15173/api/business', dataFile: join(root, 'tingproof.sqlite') } } };
  const save = () => writeFile(file, JSON.stringify(config), { mode: 0o600 }); await save();
  return { root, file, key, config, save };
}

test('metadata loading needs no business signing key while runtime loading still validates it', async t => {
  const f = await fixture(t), original = await readFile(f.file);
  await assert.rejects(loadBusinessConfig(f.file), { code: 'ENOENT' });
  const metadata = await loadBusinessConfig(f.file, { metadataOnly: true });
  assert.equal(metadata.credentialsValidated, false); assert.equal(metadata.apps.tingproof.dataFile, f.config.apps.tingproof.dataFile);
  await assert.rejects(lstat(f.key), { code: 'ENOENT' }); assert.deepEqual(await readFile(f.file), original);
  await assert.rejects(loadBusinessConfig(f.file, { metadataOnly: 'true' }), { code: 'INVALID_CONFIG_MODE' });
  f.config.apps.tingproof.keyFile = 'relative.key'; await f.save();
  await assert.rejects(loadBusinessConfig(f.file, { metadataOnly: true }), { code: 'INVALID_ADAPTER' });
  f.config.apps.tingproof.keyFile = f.key; await f.save(); await writeFile(f.key, Buffer.alloc(48, 31), { mode: 0o600 });
  assert.equal((await loadBusinessConfig(f.file)).credentialsValidated, true);
});

test('the backup worker starts its metadata path with an unmounted key without starting a snapshot', async t => {
  const f = await fixture(t), deviceId = randomUUID(), storageFile = join(f.root, 'storage.json');
  await writeFile(storageFile, JSON.stringify({ schemaVersion: 1, workspaceId: randomUUID(), deviceId, activeWriterDeviceId: deviceId, dataRoot: join(f.root, 'data'), stateRoot: join(f.root, 'state'),
    repositories: [{ id: 'local', type: 'local', path: join(f.root, 'repository'), passwordFile: join(f.root, 'repository-password') }], appSources: [], sourceRepos: [] }), { mode: 0o600 });
  const controller = new AbortController(); controller.abort();
  await runBusinessSyncWorker({ businessConfigFile: f.file, storageConfigFile: storageFile, signal: controller.signal, repositoriesFactory() { throw new Error('A stopped worker must not start a snapshot.'); } });
  await assert.rejects(lstat(f.key), { code: 'ENOENT' });
});
