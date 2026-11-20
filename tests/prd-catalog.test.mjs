import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { getPrdSources, loadPrd, listPrds } from '../src/prd-catalog.mjs';
import { writeInstalledAppsFixture } from './helpers/app-manifest-fixture.mjs';

async function workspace(t) {
  const root = await mkdtemp(join(tmpdir(), 'prd-catalog-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeInstalledAppsFixture(root, metadata.filter(item => item.group === 'third-party').map(item => {
    const source = item.source.split('/').slice(0, 2).join('/'), prd = item.source.slice(source.length + 1);
    return { id: item.id, source, name: item.project, labels: { zh: { name: item.project, description: 'Synthetic app requirements' } }, documents: { prd: { en: prd, zh: prd } } };
  }));
  async function put(source, content) {
    const file = join(root, source);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, content);
    return file;
  }
  return { root, put };
}

const metadata = [
  { id: 'praxis', group: 'main', project: 'Praxis', source: 'docs/PRD.md' },
  { id: 'reminder', group: 'third-party', project: 'Reminder', source: 'third_party/reminder/docs/PRD.md' },
  { id: 'memo', group: 'third-party', project: 'Memo', source: 'third_party/memo/docs/Memo_PRD.md' },
  { id: 'tingproof', group: 'third-party', project: '听校（TingProof）', source: 'third_party/tingproof/docs/听校_PRD_V1.0.0.md' },
  { id: 'lattice-slides', group: 'third-party', project: 'Lattice', source: 'third_party/lattice/docs/Slides-Platform_PRD.md' },
  { id: 'travel', group: 'third-party', project: 'Travel', source: 'third_party/travel/docs/PRD.md' },
  { id: 'knowledge', group: 'third-party', project: 'Knowledge', source: 'third_party/knowledge/docs/PRD.md' },
  { id: 'finance', group: 'third-party', project: 'Finance', source: 'third_party/finance/docs/PRD.md' },
  { id: 'intelligence', group: 'third-party', project: 'Intelligence', source: 'third_party/intelligence/docs/PRD.md' },
  { id: 'projects', group: 'third-party', project: 'Projects', source: 'third_party/projects/docs/PRD.md' },
  { id: 'matrix-reader', group: 'third-party', project: 'Matrix Reader', source: 'third_party/matrix-reader/PRD.md' },
  { id: 'letters', group: 'third-party', project: 'Letters', source: 'third_party/letters/PRD.md' },
  { id: 'profiles', group: 'third-party', project: 'Profiles', source: 'third_party/profiles/PRD.md' },
  { id: 'calendar', group: 'third-party', project: 'Calendar', source: 'third_party/calendar/PRD.md' },
  { id: 'polaris', group: 'third-party', project: 'Polaris', source: 'third_party/polaris/apps/docs/site/development/prd.zh-CN.md' },
];

test('installed app declarations classify Praxis and independent app PRDs', async (t) => {
  const { root, put } = await workspace(t);
  const ordered = values => [...values].sort((a, b) => a.id.localeCompare(b.id));
  assert.deepEqual(ordered((await getPrdSources({ root })).map(({ id, group, project, source }) => ({ id, group, project, source }))), ordered(metadata));
  for (const source of metadata) await put(source.source, `# **${source.project}** PRD\n\n版本：v0.1.0\n\nSynthetic ${source.id} content.\n`);
  const list = await listPrds({ root, locale: 'zh' });
  assert.equal(list.length, metadata.length);
  assert.equal(list.filter(document => document.group === 'main').length, 1);
  assert.equal(list.filter(document => document.group === 'third-party').length, metadata.length - 1);
  for (const document of list) {
    assert.equal(document.status, 'ready');
    assert.equal('content' in document, false);
    assert.equal(document.title, `${document.project} PRD`);
    assert.equal(document.version, 'v0.1.0');
  }
});

test('Chinese source paths use the explicit current version rather than the filename or history', async (t) => {
  const { root, put } = await workspace(t);
  const source = 'third_party/tingproof/docs/听校_PRD_V1.0.0.md';
  const original = '# 听校（TingProof）产品需求文档\n\n版本号：V1.1.4\n\n| 版本 | 日期 |\n| --- | --- |\n| V9.9.9 | 过去示例 |\n';
  const file = await put(source, original);
  const document = await loadPrd('tingproof', { root, locale: 'zh' });
  assert.equal(document.version, 'V1.1.4');
  assert.equal(document.appVersion, '1.2.3');
  assert.equal(document.title, '听校（TingProof）产品需求文档');
  assert.equal(document.content, original);
  assert.equal(await readFile(file, 'utf8'), original);
});

test('version tables use semantic ordering and never infer a version from the filename', async (t) => {
  const { root, put } = await workspace(t);
  await put('third_party/memo/docs/Memo_PRD.md', '# Memo PRD\n\n| 版本 | 日期 |\n| --- | --- |\n| V0.9.9 | 2026-01-01 |\n| V0.10.0 | 2026-02-01 |\n| V0.2.1 | 2026-03-01 |\n');
  assert.equal((await loadPrd('memo', { root, locale: 'zh' })).version, 'V0.10.0');
  await put('third_party/tingproof/docs/听校_PRD_V1.0.0.md', '# A document without a declared version\n\nPlain content.\n');
  assert.equal((await loadPrd('tingproof', { root, locale: 'zh' })).version, null);
});

test('missing declared PRD files degrade one entry without failing the catalog', async (t) => {
  const { root, put } = await workspace(t);
  await put('docs/PRD.md', '# Available main PRD\n');
  const list = await listPrds({ root, locale: 'zh' });
  assert.equal(list.length, metadata.length);
  assert.equal(list.find(document => document.id === 'praxis').status, 'ready');
  assert.equal(list.filter(document => document.status === 'missing').length, metadata.length - 1);
  const missing = await loadPrd('reminder', { root, locale: 'zh' });
  assert.equal(missing.status, 'missing');
  assert.equal(missing.content, '');
  await put('third_party/reminder/docs/PRD.md', '# Newly initialized source\n');
  assert.equal((await loadPrd('reminder', { root, locale: 'zh' })).status, 'ready');
});

test('source refresh reads new bytes and empty documents remain distinguishable from errors', async (t) => {
  const { root, put } = await workspace(t);
  await put('docs/PRD.md', '# First title\n\n版本：v0.1.0\n');
  const first = await loadPrd('praxis', { root, locale: 'zh' });
  await put('docs/PRD.md', '# Updated title\n\n版本：v0.2.0\n');
  const second = await loadPrd('praxis', { root, locale: 'zh' });
  assert.notEqual(second.content, first.content);
  assert.equal(second.title, 'Updated title');
  assert.equal(second.version, 'v0.2.0');
  await put('docs/PRD.md', '');
  const empty = await loadPrd('praxis', { root, locale: 'zh' });
  assert.equal(empty.status, 'ready');
  assert.equal(empty.content, '');
  assert.equal(empty.version, null);
});

test('unknown IDs, arbitrary paths and traversal inputs cannot read another file', async (t) => {
  const { root, put } = await workspace(t);
  await put('docs/PRD.md', '# Allowed\n');
  await put('secret.md', 'DO NOT EXPOSE SYNTHETIC SECRET');
  for (const id of ['unknown', 'docs/PRD.md', '../docs/PRD.md', '../../secret.md', '%2e%2e%2fsecret.md', '/etc/passwd', 'constructor', '__proto__']) {
    assert.equal(await loadPrd(id, { root, locale: 'zh' }), null, id);
  }
  const allowed = await loadPrd('praxis', { root, locale: 'zh', path: 'secret.md', source: 'secret.md' });
  assert.equal(allowed.content, '# Allowed\n');
  assert.doesNotMatch(JSON.stringify(await listPrds({ root, locale: 'zh' })), /SYNTHETIC SECRET/);
});

test('source symlinks and symlinked parent directories are unavailable even inside the root', async (t) => {
  const { root, put } = await workspace(t);
  const target = await put('alternate/PRD.md', '# Symlink target must not be served\n');
  await mkdir(join(root, 'docs'));
  await symlink(target, join(root, 'docs/PRD.md'));
  const fileLink = await loadPrd('praxis', { root, locale: 'zh' });
  assert.equal(fileLink.status, 'unavailable');
  assert.equal(fileLink.content, '');
  await mkdir(join(root, 'third_party/reminder'), { recursive: true });
  await symlink(join(root, 'alternate'), join(root, 'third_party/reminder/docs'));
  const parentLink = await loadPrd('reminder', { root, locale: 'zh' });
  assert.equal(parentLink.status, 'unavailable');
  assert.equal(parentLink.content, '');
  const list = await listPrds({ root, locale: 'zh' });
  assert.equal(list.length, metadata.length);
  assert.equal(list.find(document => document.id === 'memo').status, 'missing');
});

test('oversized or non-file sources are unavailable without exposing their content', async (t) => {
  const { root, put } = await workspace(t);
  await put('docs/PRD.md', Buffer.alloc(2 * 1024 * 1024 + 1, 65));
  const oversized = await loadPrd('praxis', { root, locale: 'zh' });
  assert.equal(oversized.status, 'unavailable');
  assert.equal(oversized.content, '');
  await mkdir(join(root, 'third_party/memo/docs/Memo_PRD.md'), { recursive: true });
  const directory = await loadPrd('memo', { root, locale: 'zh' });
  assert.equal(directory.status, 'unavailable');
  assert.equal(directory.content, '');
});

test('English is the default reader edition and has its own fixed source allowlist', async t => {
  const { root, put } = await workspace(t);
  await put('docs/PRD.en.md', '# English requirements\n\nCurrent contract.');
  await put('docs/PRD.md', '# 中文需求\n\n中文正文。');
  const first = await loadPrd('praxis', { root });
  assert.equal(first.title, 'English requirements');
  assert.equal(first.source, 'docs/PRD.en.md');
  assert.equal((await loadPrd('praxis', { root, locale: 'zh' })).title, '中文需求');
  assert.equal((await loadPrd('praxis', { root, locale: '../../secret' })).source, 'docs/PRD.en.md');
});


test('app release and PRD location refresh from the app declaration without a platform entry edit', async t => {
  const { root, put } = await workspace(t);
  await put('third_party/reminder/docs/PRD.md', '# First requirements\n\nVersion: 9.8.7\n');
  const before = await loadPrd('reminder', { root, locale: 'zh' });
  assert.equal(before.appVersion, '1.2.3'); assert.equal(before.version, '9.8.7');
  const manifestFile = join(root, 'third_party/reminder/praxis-app.json');
  const manifest = JSON.parse(await readFile(manifestFile, 'utf8'));
  manifest.version = '1.2.4'; manifest.documents.prd.zh = 'docs/current.md';
  await writeFile(manifestFile, JSON.stringify(manifest));
  await put('third_party/reminder/docs/current.md', '# App-owned updated requirements\n\nVersion: 2.0.0\n');
  const after = await loadPrd('reminder', { root, locale: 'zh' });
  assert.equal(after.appVersion, '1.2.4'); assert.equal(after.version, '2.0.0');
  assert.equal(after.title, 'App-owned updated requirements');
  assert.equal(after.source, 'third_party/reminder/docs/current.md');
});
