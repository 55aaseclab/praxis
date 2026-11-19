import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { registerWorkspace } from '../src/storage/registry.mjs';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'praxis-lattice-registry-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const id of ['reminder', 'tingproof', 'lattice', 'memo', 'travel', 'knowledge', 'vpns']) {
    await mkdir(join(root, 'third_party', id, '.git'), { recursive: true });
  }
  for (const path of ['reminder/data/checklist.json', 'tingproof/data/tingproof.db']) {
    const file = join(root, 'third_party', path);
    await mkdir(join(file, '..'), { recursive: true });
    await writeFile(file, 'Synthetic registered data.');
  }
  return { root, config: { dataRoot: join(root, 'private'), workspaceId: 'synthetic-workspace', appSources: [] } };
}

test('unified Lattice registration retains canonical private directories and has one source repository', async t => {
  const { root, config } = await fixture(t);
  for (const target of ['decks', '.lattice']) {
    const source = join(root, 'private', 'native-lattice', target);
    await mkdir(source, { recursive: true });
    config.appSources.push({ id: 'slides', kind: 'directory', target, source });
  }
  const result = await registerWorkspace(config, root);
  assert.deepEqual(result.appSources.filter(item => item.id === 'slides'), config.appSources);
  assert.deepEqual(result.sourceRepos.filter(item => item.id.startsWith('lattice')), [
    { id: 'lattice', path: join(root, 'third_party/lattice') },
  ]);
});

test('fresh native Lattice registration uses the merged application root', async t => {
  const { root, config } = await fixture(t);
  for (const target of ['decks', '.lattice']) await mkdir(join(root, 'third_party/lattice', target));
  const result = await registerWorkspace(config, root);
  assert.deepEqual(result.appSources.filter(item => item.id === 'slides').map(item => item.source), [
    join(root, 'third_party/lattice/decks'), join(root, 'third_party/lattice/.lattice'),
  ]);
});

test('optional Polaris code is registered without adding its live data as a source', async t => {
  const { root, config } = await fixture(t);
  for (const target of ['decks', '.lattice']) await mkdir(join(root, 'third_party/lattice', target));
  const before = await registerWorkspace(config, root);
  assert.equal(before.sourceRepos.some(item => item.id === 'polaris'), false);
  await mkdir(join(root, 'third_party/polaris'), { recursive: true });
  await writeFile(join(root, 'third_party/polaris/.git'), 'gitdir: ../../.git/modules/third_party/polaris\n');
  const after = await registerWorkspace(config, root);
  assert.deepEqual(after.sourceRepos.find(item => item.id === 'polaris'), { id: 'polaris', path: join(root, 'third_party/polaris') });
  assert.ok(after.sourceRepos.find(item => item.id === 'praxis').paths.includes('compose.polaris.yaml'));
  assert.deepEqual(after.appSources, before.appSources);
});
