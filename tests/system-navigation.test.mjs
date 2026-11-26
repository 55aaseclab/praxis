import test from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { gzipSync, deflateSync, brotliCompressSync } from 'node:zlib';
import { parse } from 'parse5';
import { MAX_NAVIGATION_BYTES, navigationContext, isNavigationHtml, collectNavigationBody, injectSystemNavigation, navigationHeaders } from '../src/system-navigation.mjs';

const canonical = 'https://navigation.synthetic.example';
const source = '<!doctype html><html><head><meta charset="utf-8"><title>合成页面</title></head><body><h1>Independent app</h1></body></html>';
const htmlHeaders = { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self'; base-uri 'none'" };
const context = { canonicalOrigin: canonical, mode: 'app', appId: 'tingproof', headers: htmlHeaders };
const transform = (value = source, options = {}) => injectSystemNavigation(Buffer.isBuffer(value) ? value : Buffer.from(value), { ...context, ...options });
const unavailable = { status: 503, code: 'NAVIGATION_UNAVAILABLE' };

function elements(document) {
  const result = [], stack = [document];
  while (stack.length) { const node = stack.pop(); if (node.tagName) result.push(node); for (const child of node.childNodes || []) stack.push(child); }
  return result;
}
const attributes = node => Object.fromEntries(node.attrs.map(value => [value.name, value.value]));

test('navigation parses actual markup and preserves independent app source, including deceptive text', async () => {
  const original = '<!doctype html><html><head><!-- </head> --><script>const end = "</head>";</script><base href="https://other.synthetic.example/"></head><body><template><script data-praxis-platform-nav src="/inert.js"></script></template><p>中文 😀</p></body></html>';
  const output = (await transform(original)).toString();
  const marked = elements(parse(output)).filter(node => Object.hasOwn(attributes(node), 'data-praxis-platform-nav'));
  assert.equal(marked.length, 2);
  for (const node of marked) assert.equal(node.parentNode.tagName, 'head');
  const script = marked.find(node => node.tagName === 'script'), style = marked.find(node => node.tagName === 'link');
  assert.deepEqual(attributes(script), { type: 'module', src: `${canonical}/praxis-nav.js`, 'data-praxis-platform-nav': '', 'data-mode': 'app', 'data-app-id': 'tingproof' });
  assert.equal(attributes(style).href, `${canonical}/praxis-nav.css`);
  assert.equal(output.replace(/<link rel="stylesheet" href="https:\/\/navigation\.synthetic\.example\/praxis-nav\.css" data-praxis-platform-nav>/, '').replace(/<script type="module" src="https:\/\/navigation\.synthetic\.example\/praxis-nav\.js" data-praxis-platform-nav data-mode="app" data-app-id="tingproof"><\/script>/, ''), original);
  assert.equal((await transform(output)).toString(), output);
  assert.doesNotMatch(output, /pxs_|username|csrfToken/);
});

test('valid implicit HTML and admin markers work without serializing app markup', async () => {
  const short = '<h1>中文</h1><p>Independent</p>';
  const output = (await transform(short)).toString();
  assert.ok(output.endsWith(short));
  assert.equal(elements(parse(output)).filter(node => node.tagName === 'script').length, 1);
  const admin = (await transform(source, { mode: 'admin', appId: undefined })).toString();
  assert.match(admin, /data-mode="admin"/); assert.doesNotMatch(admin, /data-app-id=/);
  const prds = (await transform(source, { mode: 'prds', appId: undefined })).toString();
  assert.match(prds, /data-mode="prds"/); assert.doesNotMatch(prds, /data-app-id=/);
  assert.equal((await transform(prds, { mode: 'prds', appId: undefined })).toString(), prds);
  await assert.rejects(transform(source, { mode: 'app', appId: 'unknown' }), unavailable);
  await assert.rejects(transform(source, { mode: 'admin', appId: 'tingproof' }), unavailable);
  await assert.rejects(transform(source, { mode: 'prds', appId: 'tingproof' }), unavailable);
  await assert.rejects(transform(''), unavailable);
  await assert.rejects(transform(source.replace('</head>', '<script data-praxis-platform-nav src="/spoof.js"></script></head>')), unavailable);
});

test('CSP remains intact and incompatible header or active meta policies fail closed', async () => {
  const result = await transform();
  const headers = navigationHeaders(htmlHeaders, result);
  assert.equal(headers['content-security-policy'], htmlHeaders['content-security-policy']);
  for (const policy of ["default-src 'none'", "script-src 'nonce-synthetic'", "script-src 'self' 'strict-dynamic'", "style-src 'none'", "sandbox allow-scripts", "default-src 'self', script-src 'none'"]) {
    await assert.rejects(transform(source, { headers: { ...htmlHeaders, 'content-security-policy': policy } }), unavailable);
    await assert.rejects(transform(source.replace('</head>', `<meta http-equiv="Content-Security-Policy" content="${policy}"></head>`)), unavailable);
  }
  await transform(source, { headers: { ...htmlHeaders, 'content-security-policy': "default-src 'self'; sandbox allow-scripts allow-same-origin" } });
  await transform(source.replace('</head>', '<template><meta http-equiv="Content-Security-Policy" content="default-src &apos;none&apos;"></template></head>'));
});

test('charset, compression and modified response validators have bounded safe behavior', async () => {
  for (const [encoding, compress] of [['gzip', gzipSync], ['deflate', deflateSync], ['br', brotliCompressSync]]) {
    const bytes = await transform(compress(Buffer.from(source)), { headers: { ...htmlHeaders, 'content-encoding': encoding } });
    assert.match(bytes.toString(), /合成页面/); assert.match(bytes.toString(), /praxis-nav\.js/);
    const result = navigationHeaders({ ...htmlHeaders, 'content-encoding': encoding, etag: '"old"', 'last-modified': 'old', digest: 'old', 'content-digest': 'old', 'repr-digest': 'old', 'content-md5': 'old', 'content-length': '1' }, bytes);
    for (const name of ['content-encoding', 'etag', 'last-modified', 'digest', 'content-digest', 'repr-digest', 'content-md5']) assert.equal(result[name], undefined);
    assert.equal(Number(result['content-length']), bytes.length); assert.equal(result['cache-control'], 'no-store');
  }
  for (const type of ['text/html; charset=iso-8859-1', 'text/html; charset="utf-16"']) await assert.rejects(transform(source, { headers: { ...htmlHeaders, 'content-type': type } }), unavailable);
  await assert.rejects(transform(source.replace('utf-8', 'windows-1252')), unavailable);
  await assert.rejects(transform(Buffer.from([0xc0, 0xaf])), unavailable);
  await assert.rejects(transform(source, { headers: { ...htmlHeaders, 'content-encoding': 'gzip, br' } }), unavailable);
  await assert.rejects(transform(gzipSync(Buffer.alloc(MAX_NAVIGATION_BYTES + 1, 0x61)), { headers: { ...htmlHeaders, 'content-encoding': 'gzip' } }), unavailable);
  const bom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(source)]);
  assert.deepEqual((await transform(bom)).subarray(0, 3), bom.subarray(0, 3));
});

test('only document entry requests and actual successful HTML are transform candidates', () => {
  const req = { method: 'GET', headers: {} };
  assert.deepEqual(navigationContext(req, '/assignment/first-day', 'tingproof'), { mode: 'app', appId: 'tingproof' });
  assert.deepEqual(navigationContext(req, '/business/tingproof/'), { mode: 'business', appId: 'tingproof' });
  assert.deepEqual(navigationContext(req, '/admin/'), { mode: 'admin' });
  assert.deepEqual(navigationContext(req, '/prds/'), { mode: 'prds' });
  assert.deepEqual(navigationContext(req, '/prds/sample-app/'), { mode: 'prds' });
  for (const path of ['/api/items', '/assets/app.js', '/static/picture', '/workbench/api/items', '/image.png']) assert.equal(navigationContext(req, path, 'tingproof'), null, path);
  assert.equal(navigationContext(req, '/lattice/portal/decks/1', 'lattice-slides'), null, 'Lattice owns its portal exclusion');
  for (const path of ['/business/', '/business/tingproof', '/business/tingproof/private', '/admin/private', '/share/tingproof/token/trip', '/prds', '/prds/source.md', '/prds/private/file/']) assert.equal(navigationContext(req, path), null, path);
  for (const request of [{ method: 'POST', headers: {} }, { method: 'HEAD', headers: {} }, { method: 'GET', headers: { range: 'bytes=0-2' } }, { method: 'GET', headers: { upgrade: 'websocket' } }, { method: 'GET', headers: { 'sec-fetch-dest': 'script' } }]) assert.equal(navigationContext(request, '/', 'tingproof'), null);
  assert.equal(isNavigationHtml({ statusCode: 200, headers: htmlHeaders }), true);
  for (const value of [{ statusCode: 304, headers: htmlHeaders }, { statusCode: 200, headers: { 'content-type': 'application/json' } }, { statusCode: 200, headers: { ...htmlHeaders, 'content-disposition': 'attachment' } }, { statusCode: 206, headers: htmlHeaders }]) assert.equal(isNavigationHtml(value), false);
});

test('body collection handles limits, incomplete streams and bounded upload time without leaked listeners', async () => {
  const complete = new PassThrough(); complete.headers = {};
  const pending = collectNavigationBody(complete); complete.end('synthetic'); assert.equal((await pending).toString(), 'synthetic');
  for (const mode of ['announced', 'actual', 'aborted', 'closed', 'timeout']) {
    const stream = new PassThrough(); stream.headers = mode === 'announced' ? { 'content-length': MAX_NAVIGATION_BYTES + 1 } : {};
    const keepAlive = setTimeout(() => {}, 1000);
    try {
      const rejected = assert.rejects(collectNavigationBody(stream, { timeoutMs: 20 }), unavailable);
      if (mode === 'actual') stream.write(Buffer.alloc(MAX_NAVIGATION_BYTES + 1));
      if (mode === 'aborted') stream.emit('aborted');
      if (mode === 'closed') stream.destroy();
      await rejected;
      assert.equal(stream.destroyed, true);
      assert.equal(stream.listenerCount('data'), 0); assert.equal(stream.listenerCount('aborted'), 0);
    } finally { clearTimeout(keepAlive); }
  }
});
