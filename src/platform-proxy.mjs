import { request as httpRequest } from 'node:http';

const routes = new Map([
  ['/api/platform/status', '/api/business/console/status'],
  ['/api/platform/observations', '/api/business/console/observations'],
  ['/api/platform/traces', '/api/business/console/traces'],
]);

function reply(response, status, value) {
  const body = JSON.stringify(value);
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body), 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', Vary: 'Cookie, Origin' });
  response.end(body);
}

export function createPlatformProxy({ upstream, host, origin, timeoutMs = 3000 } = {}) {
  let target;
  if (upstream) {
    target = new URL(upstream);
    if (target.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]', 'host.docker.internal'].includes(target.hostname) || target.username || target.password || target.search || target.hash || target.pathname !== '/') throw new Error('Platform upstream must be a fixed local HTTP origin.');
    if (!host || !/^[a-zA-Z0-9.:[\]-]+$/.test(host)) throw new Error('Platform upstream requires a fixed Host header.');
  }
  let allowedOrigin;
  if (origin) {
    const configured = new URL(origin);
    if (configured.username || configured.password || configured.search || configured.hash || configured.pathname !== '/' || !['https:', 'http:'].includes(configured.protocol) || (configured.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(configured.hostname))) throw new Error('Platform origin must be HTTPS or local HTTP.');
    allowedOrigin = configured.origin;
  }
  return async (request, response, url) => {
    const path = routes.get(url.pathname);
    if (!path) return reply(response, 404, { error: 'NOT_FOUND' });
    if (request.method !== 'GET') return reply(response, 405, { error: 'METHOD_NOT_ALLOWED' });
    const expectedOrigin = allowedOrigin || `http://${request.headers.host}`;
    if (request.headers.authorization || (request.headers.origin && request.headers.origin !== expectedOrigin) || (request.headers['sec-fetch-site'] && request.headers['sec-fetch-site'] !== 'same-origin' && request.headers['sec-fetch-site'] !== 'none')) return reply(response, 403, { error: 'FORBIDDEN' });
    const keys = [...url.searchParams.keys()];
    if (url.pathname.endsWith('/traces')) {
      if (keys.some(key => !['source', 'before', 'limit', 'traceId'].includes(key) || url.searchParams.getAll(key).length !== 1)
        || url.searchParams.has('source') && !['lifecycle', 'audit', 'outbox', 'runtime'].includes(url.searchParams.get('source'))
        || url.searchParams.has('before') && (!/^[1-9][0-9]{0,15}$/.test(url.searchParams.get('before')) || !Number.isSafeInteger(Number(url.searchParams.get('before'))))
        || url.searchParams.has('limit') && (!/^[1-9][0-9]?$/.test(url.searchParams.get('limit')) || Number(url.searchParams.get('limit')) > 50)
        || url.searchParams.has('traceId') && (!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/.test(url.searchParams.get('traceId')) || url.searchParams.has('source') && url.searchParams.get('source') !== 'lifecycle')) return reply(response, 400, { error: 'INVALID_QUERY' });
    } else if (url.pathname.endsWith('/status') ? keys.length : keys.length > 1 || keys.some(key => key !== 'window') || (url.searchParams.has('window') && !['day', 'week'].includes(url.searchParams.get('window')))) return reply(response, 400, { error: 'INVALID_QUERY' });
    if (!target) return reply(response, 503, { error: 'UNAVAILABLE' });
    const headers = { Accept: 'application/json', Host: host };
    const cookies = (request.headers.cookie || '').split(';').map(value => value.trim()).filter(value => value.startsWith('praxis_business_session='));
    if (cookies.length === 1 && /^praxis_business_session=[a-zA-Z0-9_-]{16,512}$/.test(cookies[0])) headers.Cookie = cookies[0];
    const destination = new URL(path, target);
    if (url.pathname.endsWith('/observations')) destination.searchParams.set('window', url.searchParams.get('window') || 'day');
    if (url.pathname.endsWith('/traces')) destination.search = url.search;
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), timeoutMs);
    const onClose = () => { if (!response.writableEnded) abort.abort(); };
    response.once('close', onClose);
    try {
      const result = await new Promise((accept, reject) => {
        const outgoing = httpRequest(destination, { method: 'GET', headers, signal: abort.signal }, accept);
        outgoing.on('error', reject);
        outgoing.end();
      });
      if (![200, 400, 401, 403, 404, 503].includes(result.statusCode) || !result.headers['content-type']?.startsWith('application/json')) { result.destroy(); throw new Error('Unexpected platform response.'); }
      let size = 0;
      const chunks = [];
      for await (const value of result) {
        size += value.byteLength;
        if (size > 128 * 1024) throw new Error('Platform response is too large.');
        chunks.push(Buffer.from(value));
      }
      const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('Invalid platform response.');
      if (!response.destroyed) reply(response, result.statusCode, payload);
    } catch {
      abort.abort();
      if (!response.destroyed) reply(response, 503, { error: 'UNAVAILABLE' });
    } finally {
      clearTimeout(timer);
      response.removeListener('close', onClose);
    }
  };
}
