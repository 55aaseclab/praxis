import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveMemoRuntime, memoComposeService } from '../src/memo-runtime.mjs';

test('Memo mounts private guides separately from credentials and browser records', async t => {
  const root = await mkdtemp(join(tmpdir(), 'memo-runtime-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const dataDir = join(root, 'data'), secrets = join(root, 'secrets'), keyFile = join(secrets, 'key');
  await mkdir(dataDir, { mode: 0o700 }); await mkdir(secrets, { mode: 0o700 });
  await writeFile(keyFile, Buffer.alloc(32, 7), { mode: 0o600 });
  const app = { url: 'http://127.0.0.1:4325/api/business', spaces: ['space-a'], dataDir, keyFile };
  const options = { uid: process.getuid(), workspace: join(root, 'source') };
  const runtime = await resolveMemoRuntime(app, options);
  const service = memoComposeService(runtime);
  assert.equal(service.environment.MEMO_SPACE_IDS, 'space-a');
  assert.deepEqual(service.volumes.map(item => item.read_only), [false, true]);
  assert.equal(service.volumes[0].source, dataDir);
  await assert.rejects(resolveMemoRuntime({ ...app, spaces: ['same', 'same'] }, options));
  await assert.rejects(resolveMemoRuntime(app, { ...options, protectedPaths: [dataDir] }));
  await assert.rejects(resolveMemoRuntime(app, { ...options, workspace: root }));
  await symlink(keyFile, join(secrets, 'linked'));
  await assert.rejects(resolveMemoRuntime({ ...app, keyFile: join(secrets, 'linked') }, options));
  assert.equal(await resolveMemoRuntime(undefined, options), null);
});
