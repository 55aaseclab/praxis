import { injectSystemNavigation, MAX_NAVIGATION_BYTES } from './system-navigation.mjs';
import { createReadStream } from 'node:fs';
import { readFile, realpath, stat } from 'node:fs/promises';
import { extname, join, relative, sep } from 'node:path';

const assetTypes = {
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
};
const pageType = 'text/html; charset=utf-8';
const securityHeaders = {
  'Content-Security-Policy': "frame-ancestors 'none'",
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
};

export function createManagedStaticHandler(root, namedAssets = []) {
  return async (request, response, pathname, navigation, reauthorize) => {
    const end = (status, body, headers = {}) => {
      response.writeHead(status, { ...securityHeaders, 'Cache-Control': 'no-store', 'Content-Type': 'text/plain; charset=utf-8', ...headers });
      response.end(request.method === 'HEAD' ? undefined : body);
    };
    if (!['GET', 'HEAD'].includes(request.method)) return end(405, 'Method not allowed.', { Allow: 'GET, HEAD' });

    const health = pathname === '/health';
    const page = pathname === '/' || pathname === '/index.html';
    const fingerprinted = /^\/assets\/[a-z\d_-]+-[a-z\d_-]{8,}\.(?:js|css|woff2|wasm)$/i.test(pathname || '');
    const asset = fingerprinted || namedAssets.includes(pathname);
    if (!health && !page && !asset) return end(404, 'Not found.');
    try {
      const directory = await realpath(root);
      const file = await realpath(join(directory, asset ? pathname.slice(1) : 'index.html'));
      const within = relative(directory, file);
      const info = await stat(file);
      if (!within || within.startsWith('..' + sep) || within === '..' || !info.isFile() || !info.size) {
        return end(404, 'Not found.');
      }
      if (health) return end(200, '{"status":"ok"}', { 'Content-Type': 'application/json' });
      if (page && navigation) {
        if (info.size > MAX_NAVIGATION_BYTES) return end(503, 'Page unavailable.');
        const bytes = await injectSystemNavigation(await readFile(file), { ...navigation, headers: { 'content-type': pageType } });
        await reauthorize();
        response.writeHead(200, { ...securityHeaders, 'Cache-Control': 'no-store', 'Content-Type': pageType, 'Content-Length': bytes.length });
        return response.end(bytes);
      }
      response.writeHead(200, {
        ...securityHeaders,
        'Cache-Control': fingerprinted ? 'private, max-age=31536000, immutable' : 'no-store',
        'Content-Type': page ? pageType : assetTypes[extname(pathname).toLowerCase()],
        'Content-Length': info.size,
      });
      if (request.method === 'HEAD') return response.end();
      createReadStream(file).on('error', () => response.destroy()).pipe(response);
    } catch (error) {
      if (error.status) throw error;
      if (response.headersSent) return response.destroy();
      if (['ENOENT', 'ENOTDIR'].includes(error.code)) return end(404, 'Not found.');
      return end(500, 'Unable to read app.');
    }
  };
}
