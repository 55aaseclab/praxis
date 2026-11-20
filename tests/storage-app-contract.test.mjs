import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { resolveAppPaths, appStorageSources } from '../src/storage/app-paths.mjs';
import { registerWorkspace } from '../src/storage/registry.mjs';
import { planAppData } from '../src/storage/app-data-plan.mjs';
import { createSnapshot, verifySnapshot } from '../src/storage/snapshot.mjs';
import { builtinProviderDefaults, renderAppRecipe } from '../scripts/builtin-install.mjs';
const declaration = () => ({ id: 'workshop', source: 'third_party/woodshop', integration: { web: { policy: 'document-owner' }, business: { adapterId: 'workshop-agent' }, deployment: { dataId: 'woodshop-runtime', provider: { port: 12347, portEnvs: ['WORKSHOP_PORT'] } }, storage: { rootId: 'workshop', sourceId: 'workshop-data', paths: { workshopFiles: '' }, sources: [{ kind: 'json', schema: 'workshop-v1', path: 'workshopFiles', relative: 'state.json', target: 'state.json', registerDefault: true, nativeSource: 'state.json' }], relocation: { businessBindings: { dataDir: 'workshopFiles' } }, omissions: ['Synthetic external originals are not registered.'], validators: { 'workshop-v1': value => { if (value.version !== 1 || !Array.isArray(value.items)) throw new Error('Synthetic validation error'); } } } } });
const registryOf = app => ({ apps: [app], getApp: id => id === app.id ? app : undefined });
const configOf = root => ({ dataRoot: join(root, 'private'), stateRoot: join(root, 'state'), workspaceId: 'synthetic-workspace', appSources: [] });
async function temporary(t) { const root = await mkdtemp(join(tmpdir(), 'praxis-storage-app-')); t.after(() => rm(root, { recursive: true, force: true })); return root; }

test('an extra app owns working aliases, sources, bindings and native origin without joining a platform app table', () => {
  const app = declaration(), registry = registryOf(app), config = configOf('/synthetic/workshop');
  const paths = resolveAppPaths(config, { registry }); assert.equal(paths.workshopFiles, join(paths.roots.workshop)); assert.equal(paths.memo, undefined);
  assert.deepEqual(appStorageSources(paths, {}, { registry }), [{ id: 'workshop-data', kind: 'json', schema: 'workshop-v1', source: join(paths.roots.workshop, 'state.json'), target: 'state.json' }]);
  const business = { apps: { 'workshop-agent': { dataDir: '/old/workshop' } }, database: '/old/core/auth.db', eventsDatabase: '/old/core/events.db', observationsFile: '/old/observe/observations.db' };
  config.appSources = [{ id: 'workshop-data', kind: 'json', schema: 'workshop-v1', source: '/old/workshop/state.json', target: 'state.json' }];
  const before = structuredClone({ config, business }), planned = planAppData({ storage: config, business, registry });
  assert.equal(planned.business.apps['workshop-agent'].dataDir, paths.workshopFiles); assert.ok(planned.moves.some(move => move.from === '/old/workshop' && move.to === paths.workshopFiles)); assert.deepEqual({ config, business }, before);
  const defaults = builtinProviderDefaults({ providers: [], runtime: { 'woodshop-runtime': { WORKSHOP_PORT: '23456' } }, ownerId: 'synthetic-owner', registry });
  assert.deepEqual(defaults, { workshop: { ownerId: 'synthetic-owner', url: 'http://127.0.0.1:23456' } });
});
test('source registration follows the installed source reference and preserves separately registered sources', async t => {
  const root = await temporary(t), app = declaration(), registry = registryOf(app), config = configOf(root);
  await mkdir(join(root, app.source, '.git'), { recursive: true }); await writeFile(join(root, app.source, 'state.json'), '{"version":1,"items":[]}');
  config.sourceRepos = [{ id: 'private-ancillary', path: join(root, 'ancillary') }];
  const result = await registerWorkspace(config, root, { registry });
  assert.deepEqual(result.appSources, [{ id: 'workshop-data', kind: 'json', schema: 'workshop-v1', target: 'state.json', source: join(root, app.source, 'state.json') }]);
  assert.deepEqual(result.sourceRepos.map(repo => repo.id), ['praxis', 'woodshop', 'private-ancillary']);
  assert.ok(result.coverage.omitted.includes(app.integration.storage.omissions[0]));
});
test('snapshots use the owning app validator and reject unknown or mutating schemas without leaking document bodies', async t => {
  const root = await temporary(t), app = declaration(), registry = registryOf(app), source = join(root, 'synthetic.json'), bytes = '{"version":1,"items":["SYNTHETIC_PRIVATE_BODY"]}\n'; await writeFile(source, bytes);
  const deviceId = randomUUID(), config = { ...configOf(root), workspaceId: randomUUID(), deviceId, activeWriterDeviceId: deviceId, appSources: [{ id: 'workshop-data', kind: 'json', schema: 'workshop-v1', target: 'state.json', source }] };
  const snapshot = await createSnapshot(config, { registry }); await verifySnapshot(snapshot.directory, { registry }); assert.equal(await readFile(source, 'utf8'), bytes);
  await assert.rejects(createSnapshot({ ...config, appSources: [{ ...config.appSources[0], schema: 'unknown-v1' }] }, { registry }), /no unique installed validator/);
  app.integration.storage.validators['workshop-v1'] = value => { value.items.length = 0; };
  await assert.rejects(createSnapshot(config, { registry }), /schema version or document/); assert.equal(await readFile(source, 'utf8'), bytes);
  app.integration.storage.validators['workshop-v1'] = () => { throw new Error('SYNTHETIC_PRIVATE_BODY'); };
  await assert.rejects(createSnapshot(config, { registry }), error => !error.message.includes('SYNTHETIC_PRIVATE_BODY'));
});
test('bootstrap substitutes declared data, keys and origin as JSON and rejects executable or unresolved templates', () => {
  assert.deepEqual(renderAppRecipe({ spaces: { '${spaceId}': '${origin}/api/' }, enabled: true, port: 12, missing: null }, { spaceId: 'synthetic-space', origin: 'https://praxis.example' }), { spaces: { 'synthetic-space': 'https://praxis.example/api/' }, enabled: true, port: 12, missing: null });
  for (const value of ['${unknown}', '${process.env.KEY}', '${bad_key}', () => 'code', Number.NaN]) assert.throws(() => renderAppRecipe(value, {}));
  assert.throws(() => renderAppRecipe({ '${spaceId}': 'one', same: 'two' }, { spaceId: 'same' }), /collide/);
});
