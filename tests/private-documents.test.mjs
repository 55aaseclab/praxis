import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { link, mkdir, mkdtemp, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createPrivateDocumentHandler } from '../src/private-documents.mjs';
import { setAppFacts } from '../public/app-registry.js';
import * as lettersProvider from '../third_party/letters/praxis-provider.mjs';
import * as profilesProvider from '../third_party/profiles/praxis-provider.mjs';
setAppFacts(['letters', 'profiles'].map(id => ({ id, name: id, entry: { nativePath: '/apps/' + id + '/', policy: 'document-owner' } })));

async function fixture(t, { authorize, configured = true } = {}) {
  const area = await mkdtemp(join(tmpdir(), 'private-doc-store-'));
  const root = join(area, 'documents');
  await mkdir(root);
  const handler = createPrivateDocumentHandler(configured ? root : undefined);
  const server = createServer((req, res) => {
    handler(req, res, req.url, authorize).catch(error => {
      res.writeHead(error.status || 500);
      res.end();
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    await rm(area, { recursive: true, force: true });
  });
  const get = (path = '', options) => fetch(`http://127.0.0.1:${server.address().port}/api/documents` + path, options);
  return { area, root, get };
}

test('list returns only supported private documents with opaque identifiers and relative groups', async t => {
  const { area, root, get } = await fixture(t);
  const office = join(root, 'Example group');
  await mkdir(office);
  await writeFile(join(office, 'Test 文档.md'), 'Synthetic document content.');
  await writeFile(join(root, 'Synthetic.tex'), 'This is a synthetic fixture.');
  await writeFile(join(root, 'Synthetic.aux'), 'build artifact');
  await writeFile(join(root, 'AGENTS.md'), 'control text');
  await mkdir(join(root, '.config')); await writeFile(join(root, '.config', 'Secret.txt'), 'hidden');
  await mkdir(join(root, 'build')); await writeFile(join(root, 'build', 'Unrelated.pdf'), 'build artifact');
  const external = join(area, 'external.txt');
  await writeFile(external, 'outside');
  await symlink(external, join(root, 'Link.txt'));
  await symlink(area, join(root, 'Elsewhere'));
  await link(external, join(root, 'Hardlink.txt'));
  const res = await get();
  assert.equal(res.status, 200);
  assert.match(res.headers.get('cache-control'), /private, no-store/);
  const { items } = await res.json();
  assert.equal(items.length, 2);
  assert.deepEqual(items.map(({ name, group, type }) => [name, group, type]), [
    ['Synthetic.tex', '', 'tex'], ['Test 文档.md', 'Example group', 'md'],
  ]);
  for (const item of items) {
    assert.match(item.id, /^[a-f0-9]{64}$/);
    assert.match(item.revision, /^[a-f0-9]{64}$/);
    assert.ok(Number.isFinite(Date.parse(item.updatedAt)));
    assert.ok(item.preview.length <= 280);
    assert.deepEqual(Object.keys(item).sort(), ['group', 'id', 'name', 'preview', 'revision', 'type', 'updatedAt']);
  }
  assert.equal(JSON.stringify(items).includes(area), false);
  const doc = await get('/' + items[1].id);
  assert.equal(doc.status, 200);
  assert.equal(doc.headers.get('content-type'), 'text/plain; charset=utf-8');
  assert.equal(doc.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(await doc.text(), 'Synthetic document content.');
  assert.deepEqual((await (await get()).json()).items, items);
});

test('PDF byte ranges use the already-open file and office documents download as attachments', async t => {
  const { root, get } = await fixture(t);
  await writeFile(join(root,'Example.pdf'), '%PDF-test');
  await writeFile(join(root,'Example.docx'), 'not actual office data');
  await writeFile(join(root,'Empty.txt'), '');
  const { items } = await (await get()).json();
  const id = type => '/' + items.find(x => x.type === type).id;
  for (const [range, expected, contentRange] of [
    ['bytes=1-3','PDF','bytes 1-3/9'], ['bytes=-4','test','bytes 5-8/9'], ['bytes=4-','-test','bytes 4-8/9'],
  ]) {
    const res = await get(id('pdf'), { headers: { Range: range } });
    assert.equal(res.status, 206);
    assert.equal(res.headers.get('content-type'), 'application/pdf');
    assert.equal(res.headers.get('content-range'), contentRange);
    assert.equal(await res.text(), expected);
  }
  const bad = await get(id('pdf'), { headers: { Range: 'bytes=12-13' } });
  assert.equal(bad.status, 416);
  assert.equal(bad.headers.get('content-range'), 'bytes */9');
  const head = await get(id('pdf'), { method: 'HEAD' });
  assert.equal(head.headers.get('content-length'), '9');
  assert.equal(await head.text(), '');
  assert.equal(await (await get(id('txt'))).text(), '');
  assert.match((await get(id('docx'))).headers.get('content-disposition'), /^attachment;/);
});

test('rejects unsupported methods and malformed IDs, and a removed or replaced file is inaccessible', async t => {
  const { area, root, get } = await fixture(t);
  assert.equal((await get('', { method: 'POST' })).status, 405);
  assert.equal((await get('/example.txt')).status, 404);
  assert.equal((await get('/..%2foutside')).status, 404);
  assert.deepEqual(await (await get()).json(), { items: [] });
  const path = join(root, 'Example.txt');
  await writeFile(path, 'public draft');
  const { items: [doc] } = await (await get()).json();
  await rename(path, join(area, 'outside'));
  await symlink(join(area, 'outside'), path);
  assert.equal((await get('/' + doc.id)).status, 404);
  await rename(root, join(area, 'old-location'));
  await symlink(join(area, 'old-location'), root);
  const rejected = await get();
  assert.equal(rejected.status, 503);
  assert.equal((await rejected.text()).includes(root), false);
});

test('unconfigured source fails closed and a second permission check fences the response', async t => {
  const unavailable = await fixture(t, { configured: false });
  assert.equal((await unavailable.get()).status, 503);
  let allowed = true;
  const { root, get } = await fixture(t, {
    authorize: () => { if (!allowed) throw Object.assign(new Error('Forbidden'), { status: 403 }); },
  });
  await writeFile(join(root,'Fixture.tex'), 'CONFIDENTIAL_FIXTURE');
  const { items: [doc] } = await (await get()).json();
  allowed = false;
  const list = await get(), detail = await get('/' + doc.id);
  assert.equal(list.status, 403); assert.equal(detail.status, 403);
  assert.equal((await detail.text()).includes('CONFIDENTIAL_FIXTURE'), false);
});


test('catalog versions use open-file metadata and only bounded plain text receives a preview', async t => {
  const { root, get } = await fixture(t);
  const text = '# Synthetic heading\nA **short** [source](https://example.test) excerpt. <script>SCRIPT_NOT_PREVIEW</script>\n' + 'x'.repeat(4096) + 'TAIL_NOT_PREVIEW';
  await writeFile(join(root, 'Versioned.md'), text);
  await writeFile(join(root, 'Metadata.pdf'), '%PDF-BINARY_NOT_PREVIEW');
  await writeFile(join(root, 'Metadata.docx'), 'OFFICE_NOT_PREVIEW');
  await writeFile(join(root, 'Empty.txt'), '');
  await writeFile(join(root, 'credentials.txt'), 'SECRET_CONTROL_NOT_PREVIEW');
  let catalog = await (await get()).json();
  const document = catalog.items.find(item => item.name === 'Versioned.md');
  assert.match(document.revision, /^[a-f0-9]{64}$/); assert.ok(Number.isFinite(Date.parse(document.updatedAt)));
  assert.ok(document.preview.startsWith('Synthetic heading A short source excerpt.')); assert.ok(Array.from(document.preview).length <= 280);
  assert.doesNotMatch(JSON.stringify(catalog), /SCRIPT_NOT_PREVIEW|TAIL_NOT_PREVIEW|BINARY_NOT_PREVIEW|OFFICE_NOT_PREVIEW|SECRET_CONTROL_NOT_PREVIEW/);
  for (const item of catalog.items.filter(item => ['pdf', 'docx'].includes(item.type))) { assert.equal(item.preview, undefined); assert.match(item.revision, /^[a-f0-9]{64}$/); }
  assert.equal(catalog.items.find(item => item.name === 'Empty.txt').preview, undefined);
  assert.equal((await (await get()).json()).items.find(item => item.id === document.id).revision, document.revision);
  assert.equal(await (await get('/' + document.id)).text(), text);
  await writeFile(join(root, 'Versioned.md'), '# Updated synthetic original.');
  catalog = await (await get()).json();
  const changed = catalog.items.find(item => item.id === document.id);
  assert.notEqual(changed.revision, document.revision); assert.equal(changed.preview, 'Updated synthetic original.');
});

test('a final owner reauthorization failure suppresses catalog filenames and newly derived text previews', async t => {
  let checks = 0;
  const { root, get } = await fixture(t, { authorize: () => { if (++checks === 2) throw Object.assign(new Error('Revoked'), { status: 403 }); } });
  await writeFile(join(root, 'Private preview.md'), 'SYNTHETIC_PREVIEW_MUST_NOT_ESCAPE');
  const response = await get(); assert.equal(response.status, 403);
  assert.doesNotMatch(await response.text(), /Private preview|SYNTHETIC_PREVIEW_MUST_NOT_ESCAPE|revision|items/);
});


test('native catalogs feed real Letters and Profiles cards that satisfy the strict browser DTO', async t => {
  let allowed = true;
  const { root, get } = await fixture(t, { authorize: () => { if (!allowed) throw Object.assign(new Error('Denied'), { status: 403 }); } });
  const original = '# Synthetic source\nRead the actual authorized document.';
  await writeFile(join(root, 'Correspondence.md'), original); await writeFile(join(root, 'Metadata only.pdf'), '%PDF-SYNTHETIC_BINARY_NOT_A_SUMMARY');
  for (const provider of [lettersProvider, profilesProvider]) {
    let reads = 0;
    const context = { identity: { userId: 'synthetic-owner' }, read: async path => { reads++; assert.equal(path, 'api/documents'); const response = await get(); if (!response.ok) throw new Error('Denied'); return response.json(); } };
    const result = await provider.getCards(context); assert.equal(result.status, 'ready'); assert.equal(result.items.length, 2); assert.equal(reads, 1);
    const cards = result.items;
    const text = cards.find(card => card.title === 'Correspondence.md'), binary = cards.find(card => card.title === 'Metadata only.pdf');
    assert.match(text.revision, /^[a-f0-9]{64}$/); assert.match(text.primaryAction.href, new RegExp('^/apps/' + provider.describe().appId + '/#document=[a-f0-9]{64}$'));
    assert.equal(text.evidence[0].href, text.primaryAction.href); assert.equal(binary.preview, undefined);
    assert.equal(await (await get('/' + text.resourceId)).text(), original);
    allowed = false;
    const denied = await provider.getCards(context); assert.equal(denied.status, 'unavailable'); assert.deepEqual(denied.items, []); assert.doesNotMatch(JSON.stringify(denied), /Correspondence|Synthetic source/);
    allowed = true;
  }
});
