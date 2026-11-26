import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { registerWorkspace } from '../src/storage/registry.mjs';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'praxis-lattice-registry-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const id of ['tingproof', 'lattice', 'memo', 'travel', 'intelligence', 'projects', 'letters', 'profiles', 'polaris']) {
    await mkdir(join(root, 'third_party', id, '.git'), { recursive: true });
  }
  for (const path of ['tingproof/data/tingproof.db', 'memo/data/memo.db']) {
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

test('all built-in source repositories and build recipes are registered with existing ancillary sources', async t => {
  const { root, config } = await fixture(t);
  for (const target of ['decks', '.lattice']) await mkdir(join(root, 'third_party/lattice', target));
  for (const file of ['compose.apps.yaml', 'compose.business.yaml', 'compose.polaris-viewer.yaml', 'compose.polaris-observations.yaml']) {
    await writeFile(join(root, file), '# Synthetic recipe');
  }
  await mkdir(join(root, 'packaging'));
  const ancillary = { id: 'private-ancillary', path: join(root, 'private', 'archived-source') };
  config.sourceRepos = [ancillary];
  const result = await registerWorkspace(config, root);
  assert.equal(result.sourceRepos.length, 11);
  for (const id of ['intelligence', 'projects', 'letters', 'profiles', 'polaris']) {
    assert.deepEqual(result.sourceRepos.find(item => item.id === id), { id, path: join(root, 'third_party', id) });
  }
  assert.deepEqual(result.sourceRepos.find(item => item.id === ancillary.id), ancillary);
  const paths = result.sourceRepos.find(item => item.id === 'praxis').paths;
  for (const path of ['packaging', 'compose.apps.yaml', 'compose.business.yaml', 'compose.polaris-viewer.yaml', 'compose.polaris-observations.yaml']) assert.ok(paths.includes(path));
  assert.equal(result.appSources.some(item => item.source.includes('polaris')), false);
  await rm(join(root, 'third_party/intelligence/.git'), { recursive: true });
  await assert.rejects(registerWorkspace(config, root), /Required source repository is missing: intelligence/);
});
