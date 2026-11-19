import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { parse } from 'parse5';
import { createBusinessServer } from '../src/business/server.mjs';
import { SESSION_COOKIE } from '../src/business/auth.mjs';
import { createPraxisServer } from '../src/server.mjs';
import { renderIconPng } from '../scripts/render-logo-png.mjs';

test('installation metadata uses fresh pine icons on sign-in, the workbench and Settings', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'praxis-install-icons-'));
  const host = 'install.example.test';
  const origin = 'https://' + host;
  const core = createBusinessServer({
    config: {
      issuer: origin, allowedHosts: [host], apps: {}, observationsFile: null, webGateway: { enabled: true },
      database: join(directory, 'auth.db'), eventsDatabase: join(directory, 'events.db'),
    },
  });
  core.listen(0, '127.0.0.1');
  await once(core, 'listening');
  const gateway = createPraxisServer({
    publicUrlsFile: null, observationsFile: null,
    webGateway: {
      enabled: true, canonicalUrl: origin,
      coreUrl: 'http://127.0.0.1:' + core.address().port,
    },
  });
  gateway.listen(0, '127.0.0.1');
  await once(gateway, 'listening');
  t.after(async () => {
    for (const server of [gateway, core]) {
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
    }
    await core.business.shutdown();
    core.business.auth.close();
    core.business.events.close();
    await rm(directory, { recursive: true, force: true });
  });

  const member = { username: 'icon-reader', password: 'Synthetic-only-icon-password' };
  core.business.auth.createUser({ id: 'icon-reader', ...member });
  const cookie = SESSION_COOKIE + '=' + core.business.auth.login(member).sessionToken;
  function read(path, signedIn = false) {
    return new Promise((resolve, reject) => {
      const request = httpRequest({
        hostname: '127.0.0.1', port: gateway.address().port, path,
        headers: { Host: host, ...(signedIn ? { Cookie: cookie } : {}) },
      }, response => {
        const chunks = [];
        response.on('data', chunk => chunks.push(chunk));
        response.on('error', reject);
        response.on('end', () => resolve({
          status: response.statusCode, headers: response.headers,
          body: Buffer.concat(chunks),
        }));
      });
      request.on('error', reject);
      request.end();
    });
  }

  let manifestUrl, appleUrl, faviconUrl;
  for (const [path, signedIn] of [['/auth/login', false], ['/', true], ['/admin/', true]]) {
    const response = await read(path, signedIn);
    assert.equal(response.status, 200, path);
    const links = new Map();
    const nodes = [parse(response.body.toString())];
    while (nodes.length) {
      const node = nodes.pop();
      if (node.tagName === 'link') {
        const attributes = Object.fromEntries(node.attrs.map(value => [value.name, value.value]));
        links.set(attributes.rel, attributes.href);
      }
      nodes.push(...(node.childNodes || []));
    }
    for (const rel of ['icon', 'apple-touch-icon', 'manifest']) {
      assert.ok(links.has(rel), path + ' supplies ' + rel);
      assert.ok(links.get(rel).startsWith('/'), path + ' uses a same-origin ' + rel);
    }
    const apple = new URL(links.get('apple-touch-icon'), origin);
    assert.ok(apple.searchParams.get('v'), 'Apple touch icon has a new resource identity');
    if (appleUrl) assert.equal(links.get('apple-touch-icon'), appleUrl);
    appleUrl = links.get('apple-touch-icon');
    if (manifestUrl) assert.equal(links.get('manifest'), manifestUrl);
    manifestUrl = links.get('manifest');
    if (faviconUrl) assert.equal(links.get('icon'), faviconUrl);
    faviconUrl = links.get('icon');
    const icon = await read(faviconUrl);
    assert.equal(icon.status, 200, 'An installer can fetch the page icon without signing in');
    if (path === '/auth/login') {
      assert.match(response.headers['content-security-policy'], /(?:^|;)\s*img-src 'self'(?:;|$)/);
      assert.match(response.headers['content-security-policy'], /(?:^|;)\s*manifest-src 'self'(?:;|$)/);
    }
  }

  const response = await read(manifestUrl);
  assert.equal(response.status, 200);
  const manifest = JSON.parse(response.body);
  assert.equal(manifest.id, '/');
  assert.equal(manifest.start_url, '/');
  assert.equal(manifest.scope, '/');
  const svg = await readFile(new URL('../public/praxis.svg', import.meta.url), 'utf8');
  const expectedVersion = 'pine-' + createHash('sha256').update(svg).digest('hex').slice(0, 10);
  const icons = [
    { src: appleUrl, size: 180 },
    ...manifest.icons.map(icon => ({ src: icon.src, size: Number(icon.sizes.split('x')[0]) })),
  ];
  assert.deepEqual(icons.map(icon => icon.size).sort((a, b) => a - b), [180, 192, 512]);
  for (const { src, size } of icons) {
    const url = new URL(src, origin);
    assert.equal(url.searchParams.get('v'), expectedVersion, 'Artwork changes also change the installation resource identity');
    assert.equal(url.searchParams.get('v'), new URL(appleUrl, origin).searchParams.get('v'));
    const image = await read(src);
    assert.equal(image.status, 200, 'Installers can fetch icons without a session');
    assert.match(image.headers['content-type'], /^image\/png/);
    assert.equal(image.body.readUInt32BE(16), size);
    assert.equal(image.body.readUInt32BE(20), size);
    assert.deepEqual(image.body, renderIconPng(svg, size), 'Installation icon matches the pine artwork');
  }
});
