import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile, rm, symlink } from 'node:fs/promises';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { readApps, readInstalledApps, readAppManifest, resolveAppIcon } from '../src/apps.mjs';
import { developmentApps, loadDevelopmentApps } from '../scripts/local-app.mjs';
import { createPraxisServer } from '../src/server.mjs';
import { appManifest, writeAppManifestFixture, writeInstalledAppsFixture, SYNTHETIC_ICON } from './helpers/app-manifest-fixture.mjs';

async function workspace(t) {
  const root = await mkdtemp(join(tmpdir(), 'praxis-app-manifest-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}
const sample = { id: 'sample', name: 'Sample app', source: 'third_party/sample' };
const load = root => readApps(root, { publicUrlsFile: null });
const saveManifest = (directory, value) => writeFile(join(directory, 'praxis-app.json'), JSON.stringify(value));

test('installed selection contains only source references and presentation comes from the owning app', async t => {
  const root = await workspace(t); await writeInstalledAppsFixture(root, [sample]);
  const index = JSON.parse(await readFile(join(root, 'config/installed-apps.json'), 'utf8'));
  assert.deepEqual(index, { schemaVersion: 1, apps: [{ source: 'third_party/sample' }] });
  await writeFile(join(root, 'config/apps.json'), JSON.stringify([{ ...sample, name: 'Stale duplicated name', version: '9.9.9' }]));
  const [app] = await load(root); assert.equal(app.name, 'Sample app'); assert.equal(app.version, '1.2.3'); assert.equal(app.icon, '/app-icons/sample.svg');
  assert.equal(app.builtin, true); assert.equal(app.source, 'third_party/sample'); assert.ok(!JSON.stringify(app).includes(root));
  const icon = await resolveAppIcon(root, app.icon); assert.equal(icon.content.toString(), SYNTHETIC_ICON);
});

test('a missing source-only index cannot fall back to the removed central app catalogue', async t => {
  const root = await workspace(t); await mkdir(join(root, 'config'));
  await writeAppManifestFixture(root, sample); await writeFile(join(root, 'config/apps.json'), JSON.stringify([sample]));
  await assert.rejects(load(root), { code: 'ENOENT' });
});

test('strict installed indices reject duplicated, remote and escaped sources and copied app metadata', async t => {
  const root = await workspace(t); await writeInstalledAppsFixture(root, [sample]);
  for (const apps of [
    [{ source: sample.source }, { source: sample.source }],
    [{ source: 'https://outside.example.test/source.git' }],
    [{ source: '../private/app' }],
    [{ source: sample.source, name: 'Copied metadata' }],
  ]) {
    await writeFile(join(root, 'config/installed-apps.json'), JSON.stringify({ schemaVersion: 1, apps }));
    await assert.rejects(readInstalledApps(root));
  }
});

test('app release versions are canonical numeric MAJOR.MINOR.PATCH values, independent of schema and content revisions', async t => {
  const root = await workspace(t), f = await writeAppManifestFixture(root, sample);
  for (const version of ['0.0.0', '1.2.3', '12.34.567']) { await saveManifest(f.directory, { ...f.manifest, version }); assert.equal((await readAppManifest(f.directory)).version, version); }
  for (const version of ['1.2', 'v1.2.3', 'V1.2.3', '01.2.3', '1.02.3', '1.2.03', '1.2.3-beta', '1.2.3+build', ' 1.2.3', 123, null]) { await saveManifest(f.directory, { ...f.manifest, version }); await assert.rejects(readAppManifest(f.directory), /MAJOR.MINOR.PATCH/); }
  await saveManifest(f.directory, f.manifest); assert.equal((await readAppManifest(f.directory)).schemaVersion, 1);
});

test('existing package and lockfile release declarations must agree with the app-owned manifest', async t => {
  const root = await workspace(t), f = await writeAppManifestFixture(root, sample);
  await writeFile(join(f.directory, 'package.json'), JSON.stringify({ name: 'sample', version: '1.2.3' }));
  await writeFile(join(f.directory, 'package-lock.json'), JSON.stringify({ name: 'sample', version: '1.2.3', packages: { '': { version: '1.2.3' } } }));
  assert.equal((await readAppManifest(f.directory)).version, '1.2.3');
  for (const patch of [
    { file: 'package.json', data: { name: 'sample', version: '1.2.4' } },
    { file: 'package-lock.json', data: { version: '1.2.4', packages: { '': { version: '1.2.3' } } } },
    { file: 'package-lock.json', data: { version: '1.2.3', packages: { '': { version: '1.2.4' } } } },
  ]) {
    await writeFile(join(f.directory, 'package.json'), JSON.stringify({ name: 'sample', version: '1.2.3' }));
    await writeFile(join(f.directory, 'package-lock.json'), JSON.stringify({ version: '1.2.3', packages: { '': { version: '1.2.3' } } }));
    await writeFile(join(f.directory, patch.file), JSON.stringify(patch.data)); await assert.rejects(readAppManifest(f.directory), /release versions must agree/);
  }
});

test('manifest, icon, icon-directory and installed-source symlinks cannot escape a reviewed repository', async t => {
  for (const target of ['manifest', 'icon', 'directory', 'source']) {
    const root = await workspace(t), f = await writeAppManifestFixture(root, sample);
    await writeInstalledAppsFixture(root, [sample]);
    const outside = join(root, 'private-fixture'); await mkdir(outside);
    await writeFile(join(outside, 'praxis-app.json'), JSON.stringify(f.manifest)); await writeFile(join(outside, 'praxis-icon.svg'), SYNTHETIC_ICON);
    if (target === 'manifest') { await rm(join(f.directory, 'praxis-app.json')); await symlink(join(outside, 'praxis-app.json'), join(f.directory, 'praxis-app.json')); }
    if (target === 'icon') { await rm(join(f.directory, 'public/praxis-icon.svg')); await symlink(join(outside, 'praxis-icon.svg'), join(f.directory, 'public/praxis-icon.svg')); }
    if (target === 'directory') { await rm(join(f.directory, 'public'), { recursive: true }); await symlink(outside, join(f.directory, 'public')); }
    if (target === 'source') { await rm(f.directory, { recursive: true }); await symlink(outside, f.directory); }
    await assert.rejects(load(root), /symbolic link|repository directory/);
  }
});

test('manifest path and duplicate identity/alias validation fail closed', async t => {
  const root = await workspace(t), f = await writeAppManifestFixture(root, sample);
  for (const icon of ['../private.svg', '/private.svg', 'public/../../private.svg', 'https://outside.example.test/icon.svg', 'public/icon.png']) { await saveManifest(f.directory, { ...f.manifest, icon }); await assert.rejects(readAppManifest(f.directory)); }
  await saveManifest(f.directory, { ...f.manifest, documents: { prd: { en: '../private.md', zh: 'PRD.md' } } }); await assert.rejects(readAppManifest(f.directory));
  await saveManifest(f.directory, { ...f.manifest, iconAliases: ['/praxis.svg'] }); await assert.rejects(readAppManifest(f.directory));
  await writeInstalledAppsFixture(root, [sample, { id: 'other', source: 'third_party/other' }]);
  await saveManifest(join(root, 'third_party/other'), appManifest({ id: 'other' }, { id: 'sample' })); await assert.rejects(load(root), /unique|Duplicate/);
  await saveManifest(f.directory, { ...f.manifest, iconAliases: ['/same-icon.svg'] }); await saveManifest(join(root, 'third_party/other'), appManifest({ id: 'other' }, { iconAliases: ['/same-icon.svg'] })); await assert.rejects(load(root), /alias|Duplicate/);
});

test('changed owned metadata and icon bytes update without rewriting the installed index or a generated catalogue', async t => {
  const root = await workspace(t); await writeInstalledAppsFixture(root, [sample]);
  const index = await readFile(join(root, 'config/installed-apps.json'), 'utf8');
  const directory = join(root, sample.source), before = (await load(root))[0];
  const next = appManifest({ ...sample, name: 'Changed app name' }, { version: '1.2.4', labels: { zh: { name: '变更后的应用', description: '合成说明' } } });
  await saveManifest(directory, next); const blue = SYNTHETIC_ICON.replace('#21594d', '#1672d4'); await writeFile(join(directory, 'public/praxis-icon.svg'), blue);
  const after = (await load(root))[0]; assert.equal(after.name, 'Changed app name'); assert.equal(after.labels.zh.name, '变更后的应用'); assert.equal(after.version, '1.2.4'); assert.equal(before.icon, after.icon);
  assert.equal((await resolveAppIcon(root, after.icon)).content.toString(), blue); assert.equal(await readFile(join(root, 'config/installed-apps.json'), 'utf8'), index);
});

test('local app references reuse owned labels, version and icon while exposing no host paths or production capability', async t => {
  const root = await workspace(t); await writeInstalledAppsFixture(root, [{ id: 'official', source: 'third_party/official' }]);
  await writeAppManifestFixture(root, { id: 'notebook', source: 'third_party/notebook', name: 'Private local notebook' });
  const value = { schemaVersion: 1, apps: [{ manifest: './third_party/notebook/praxis-app.json', id: 'notebook-local', url: 'http://127.0.0.1:18555/' }] };
  const official = await load(root), apps = await loadDevelopmentApps(value, official, { configFile: join(root, 'local.json') });
  assert.equal(apps[0].name, 'Private local notebook'); assert.equal(apps[0].version, '1.2.3'); assert.equal(apps[0].icon, '/app-icons/notebook-local.svg'); assert.equal(apps[0].builtin, undefined); assert.ok(!JSON.stringify(apps).includes(root));
  const server = createPraxisServer({ root, publicDir: resolve('public'), developmentApps: apps, publicUrlsFile: null, observationsFile: null, businessUrl: null, consoleUpstream: null });
  server.listen(0, '127.0.0.1'); await once(server, 'listening'); t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const listed = await (await fetch(origin + '/api/apps')).json(), local = listed.apps.find(app => app.id === 'notebook-local'); assert.equal(local.url, 'http://127.0.0.1:18555/'); assert.equal(local.source, undefined); assert.equal(local.documents, undefined); assert.ok(!JSON.stringify(listed).includes(root));
  const icon = await fetch(origin + '/app-icons/notebook-local.svg'); assert.equal(icon.status, 200); assert.match(icon.headers.get('content-type'), /image\/svg\+xml/); const etag = icon.headers.get('etag'); assert.ok(etag); assert.equal(await icon.text(), SYNTHETIC_ICON);
  const cached = await fetch(origin + '/app-icons/notebook-local.svg', { headers: { 'If-None-Match': etag } }); assert.equal(cached.status, 304); assert.equal(await cached.text(), '');
  assert.equal((await fetch(origin + '/app-icons/not-installed.svg')).status, 404);
  for (const url of ['https://outside.example.test/', 'http://user:password@127.0.0.1:18555/', 'http://127.0.0.1:18555/?token=sample', 'http://127.0.0.1:18555/#sample']) await assert.rejects(loadDevelopmentApps({ ...value, apps: [{ ...value.apps[0], url }] }, official, { configFile: join(root, 'local.json') }));
  await assert.rejects(loadDevelopmentApps({ ...value, apps: [{ ...value.apps[0], id: 'official' }] }, official, { configFile: join(root, 'local.json') }));
});

test('the existing private local array still enforces bilingual labels and loopback-only distinct IDs', () => {
  const local = { id: 'sample-local', name: { en: 'Sample', zh: '合成' }, description: { en: 'Synthetic app', zh: '合成应用' }, url: 'http://127.0.0.1:18555/' };
  assert.equal(developmentApps([local], [])[0].url, local.url);
  assert.throws(() => developmentApps([local, local], [])); assert.throws(() => developmentApps([{ ...local, name: { en: 'Sample' } }], []));
});
