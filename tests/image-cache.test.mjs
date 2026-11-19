import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { createPraxisServer } from '../src/server.mjs';
import { createStaticAppServer } from '../scripts/serve-static-app.mjs';

for (const [name, create] of [['Praxis', root => createPraxisServer({ root, publicDir: join(root, 'public') })], ['production static adapter', root => createStaticAppServer({ root: join(root, 'public') })]]) {
  test(`${name} caches resolved images, validates conditionals and refreshes changed files`, async t => {
    const root = await mkdtemp(join(tmpdir(), 'praxis-image-cache-'));
    await mkdir(join(root, 'public'));
    const file = join(root, 'public/photo.svg');
    const original = '<svg xmlns="http://www.w3.org/2000/svg"><title>first</title></svg>';
    const modified = original.replace('first', 'other');
    await writeFile(file, original);
    await writeFile(join(root, 'public/index.html'), '<h1>Public test page</h1>');
    await writeFile(join(root, 'public/data.json'), '{"synthetic":true}');
    const server = create(root);
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    t.after(async () => { await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }); await rm(root, { recursive:true, force:true }); });
    const base = `http://127.0.0.1:${server.address().port}`;
    const response = await fetch(base+'/photo.svg');
    assert.equal(response.status, 200); assert.equal(await response.text(), original);
    assert.equal(response.headers.get('cache-control'), 'private, max-age=3600, must-revalidate');
    assert.match(response.headers.get('vary'), /Authorization/);
    const tag = response.headers.get('etag'); const modifiedAt = response.headers.get('last-modified');
    assert.ok(tag); assert.ok(Number.isFinite(Date.parse(modifiedAt)));
    const head = await fetch(base+'/photo.svg', {method:'HEAD'});
    assert.equal(head.headers.get('etag'), tag); assert.equal(await head.text(), '');
    assert.equal(head.headers.get('content-length'), String(Buffer.byteLength(original)));
    for (const headers of [{ 'If-None-Match':tag }, {'If-None-Match':tag.replace(/^W\//,'')}, {'If-None-Match':`"unrelated", ${tag}`}, {'If-None-Match':'*'}, {'If-Modified-Since':modifiedAt}]) {
      for(const method of ['GET','HEAD']) {
        const result = await fetch(base+'/photo.svg', { method, headers });
        assert.equal(result.status,304); assert.equal(await result.text(),'');
        assert.equal(result.headers.get('content-length'),null);
        assert.equal(result.headers.get('content-type'),'image/svg+xml');
        assert.equal(result.headers.get('etag'),tag);
      }
    }
    const precedence = await fetch(base+'/photo.svg',{headers:{'If-None-Match':'"different"','If-Modified-Since':'Wed, 01 Jan 2099 00:00:00 GMT'}});
    assert.equal(precedence.status,200);
    const previous = await stat(file); await delay(5);
    await writeFile(file, modified); await utimes(file, previous.atime, previous.mtime);
    const changed = await fetch(base+'/photo.svg',{headers:{'If-None-Match':tag}});
    assert.equal(changed.status,200); assert.equal(await changed.text(),modified);
    assert.notEqual(changed.headers.get('etag'),tag,'A same-size replacement with restored mtime must change its validator.');
    for(const path of ['/','/data.json','/missing.png']) {
      const result = await fetch(base+path,{headers:{'If-None-Match':'*'}});
      assert.notEqual(result.status,304,path);
      assert.doesNotMatch(result.headers.get('cache-control') || '',/max-age=3600/);
      assert.equal(result.headers.get('etag'),null,path);
    }
    const denied = await fetch(base+'/photo.svg',{method:'POST'});
    assert.equal(denied.status,405); assert.equal(denied.headers.get('cache-control'),'no-store');
    for(const extension of ['png','jpg','jpeg','webp','gif','avif','ico']) {
      await writeFile(join(root,'public/photo.'+extension),'synthetic image bytes');
      const result = await fetch(base+'/photo.'+extension);
      assert.match(result.headers.get('content-type'),/^image\//);
      assert.match(result.headers.get('cache-control'),/max-age=3600/);
    }
  });
}
