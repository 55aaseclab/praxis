import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { link, mkdir, mkdtemp, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createPrivateDocumentHandler } from '../src/private-documents.mjs';

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
    assert.deepEqual(Object.keys(item).sort(), ['group', 'id', 'name', 'type']);
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
