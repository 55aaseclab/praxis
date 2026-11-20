import { parse } from 'parse5';
import { DEFAULT_APP_REGISTRY } from './default-app-registry.mjs';
import { promisify } from 'node:util';
import { gunzip, inflate, brotliDecompress } from 'node:zlib';

export const MAX_NAVIGATION_BYTES = 2 * 1024 * 1024;
const decode = { gzip: promisify(gunzip), deflate: promisify(inflate), br: promisify(brotliDecompress) };
const HTML = 'http://www.w3.org/1999/xhtml';
const unavailable = () => Object.assign(new Error('System navigation cannot be added safely.'), { status: 503, code: 'NAVIGATION_UNAVAILABLE' });

export function navigationContext(request, pathname, appId, { registry = DEFAULT_APP_REGISTRY } = {}) {
  if (request.method !== 'GET' || request.headers.range || request.headers.upgrade || request.headers['sec-fetch-dest'] && request.headers['sec-fetch-dest'] !== 'document') return null;
  if (appId) {
    if (!registry.getApp(appId) || /^\/(?:api|assets|static|_astro|_workbench)(?:\/|$)/.test(pathname) || /^\/workbench\/api(?:\/|$)/.test(pathname) || (registry.getWeb(appId).noNavigationPrefixes || []).some(prefix => pathname === prefix || pathname.startsWith(prefix + '/'))) return null;
    const last = pathname.split('/').at(-1);
    if (last?.includes('.') && !/\.html?$/i.test(last)) return null;
    return { appId, mode: 'app', ...(registry !== DEFAULT_APP_REGISTRY ? { registry } : {}) };
  }
  const focused = registry.apps.find(app => app.integration.web.legacyPaths?.includes(pathname));
  if (focused) return { appId: focused.id, mode: 'business', ...(registry !== DEFAULT_APP_REGISTRY ? { registry } : {}) };
  if (pathname === '/prds/' || /^\/prds\/[a-z\d-]+\/$/.test(pathname)) return { mode: 'prds' };
  return ['/admin', '/admin/'].includes(pathname) ? { mode: 'admin' } : null;
}

export function isNavigationHtml(response) {
  return response.statusCode === 200 && typeof response.headers['content-type'] === 'string' && /^text\/html(?:\s*;|\s*$)/i.test(response.headers['content-type']) && !response.headers['content-disposition'] && !response.headers['content-range'];
}

export async function collectNavigationBody(stream, { timeoutMs = 2000 } = {}) {
  const announced = Number(stream.headers['content-length']);
  if (Number.isFinite(announced) && announced > MAX_NAVIGATION_BYTES) { stream.once('error', () => {}); stream.destroy(); throw unavailable(); }
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0, settled = false;
    const cleanup = () => { clearTimeout(timer); stream.removeListener('data', data); stream.removeListener('end', end); stream.removeListener('error', failed); stream.removeListener('aborted', failed); stream.removeListener('close', closed); };
    const finish = (error, value) => {
      if (settled) return;
      settled = true; cleanup();
      if (error) {
        const absorb = () => {};
        stream.once('error', absorb); stream.once('close', () => stream.removeListener('error', absorb));
        stream.destroy(); reject(unavailable());
      } else resolve(value);
    };
    const failed = () => finish(true);
    const closed = () => { if (!stream.complete) finish(true); };
    const data = chunk => { size += chunk.length; if (size > MAX_NAVIGATION_BYTES) finish(true); else chunks.push(chunk); };
    const end = () => finish(false, Buffer.concat(chunks));
    const timer = setTimeout(failed, timeoutMs); timer.unref();
    stream.on('data', data); stream.once('end', end); stream.once('error', failed); stream.once('aborted', failed); stream.once('close', closed);
  });
}

function charset(contentType) {
  if (typeof contentType !== 'string') throw unavailable();
  for (const field of contentType.split(';').slice(1)) {
    const separator = field.indexOf('=');
    if (separator < 0 || field.slice(0, separator).trim().toLowerCase() !== 'charset') continue;
    const value = field.slice(separator + 1).trim().replace(/^(?:"([^"]*)"|'([^']*)')$/, (_, double, single) => double ?? single).toLowerCase();
    if (!['utf-8', 'utf8'].includes(value)) throw unavailable();
  }
}
function policyAllowsNavigation(policy) {
  const directives = new Map();
  for (const part of policy.split(';')) {
    const [name, ...values] = part.trim().split(/\s+/);
    if (name && !directives.has(name.toLowerCase())) directives.set(name.toLowerCase(), values);
  }
  const effective = name => directives.get(`${name}-src-elem`) ?? directives.get(`${name}-src`) ?? directives.get('default-src');
  for (const name of ['script', 'style']) {
    const values = effective(name);
    if (values && (!values.includes("'self'") || name === 'script' && values.includes("'strict-dynamic'"))) return false;
  }
  const sandbox = directives.get('sandbox');
  return !sandbox || sandbox.includes('allow-scripts') && sandbox.includes('allow-same-origin');
}
function checkPolicies(values) {
  for (const value of values.flatMap(value => Array.isArray(value) ? value : [value])) {
    if (value === undefined) continue;
    if (typeof value !== 'string' || value.split(',').some(policy => !policyAllowsNavigation(policy))) throw unavailable();
  }
}

export async function injectSystemNavigation(bytes, { headers, canonicalOrigin, appId, mode, registry = DEFAULT_APP_REGISTRY }) {
  const platformMode = ['admin', 'prds'].includes(mode);
  if (!Buffer.isBuffer(bytes) || bytes.length > MAX_NAVIGATION_BYTES || !['app', 'business', 'admin', 'prds'].includes(mode) || (platformMode ? appId !== undefined : !registry.getApp(appId))) throw unavailable();
  const canonical = new URL(canonicalOrigin);
  if (!['http:', 'https:'].includes(canonical.protocol) || canonical.username || canonical.password || canonical.pathname !== '/' || canonical.search || canonical.hash) throw unavailable();
  charset(headers['content-type']);
  let input = bytes;
  const encoding = headers['content-encoding'];
  if (encoding && encoding !== 'identity') {
    if (typeof encoding !== 'string' || !Object.hasOwn(decode, encoding.toLowerCase())) throw unavailable();
    try { input = await decode[encoding.toLowerCase()](bytes, { maxOutputLength: MAX_NAVIGATION_BYTES }); } catch { throw unavailable(); }
  }
  if (input.length > MAX_NAVIGATION_BYTES) throw unavailable();
  let source;
  try { source = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(input); } catch { throw unavailable(); }
  const prefix = source.startsWith('\uFEFF') ? '\uFEFF' : '';
  if (prefix) source = source.slice(1);
  const document = parse(source, { sourceCodeLocationInfo: true });
  const stack = [document], policies = [headers['content-security-policy']];
  const scriptUrl = `${canonical.origin}/praxis-nav.js`, styleUrl = `${canonical.origin}/praxis-nav.css`;
  let head, body, scriptFound = false, styleFound = false, nodes = 0;
  while (stack.length) {
    const node = stack.pop();
    if (++nodes > 250000) throw unavailable();
    if (node.namespaceURI === HTML) {
      const attributes = Object.fromEntries((node.attrs || []).map(attribute => [attribute.name, attribute.value]));
      if (node.tagName === 'head') head = node;
      if (node.tagName === 'body') body = node;
      if (node.tagName === 'meta') {
        if (attributes.charset !== undefined && !['utf-8', 'utf8'].includes(attributes.charset.toLowerCase())) throw unavailable();
        if (attributes['http-equiv']?.toLowerCase() === 'content-type') charset(attributes.content || '');
        if (attributes['http-equiv']?.toLowerCase() === 'content-security-policy') policies.push(attributes.content || '');
      }
      if (Object.hasOwn(attributes, 'data-praxis-platform-nav')) {
        if (node.tagName === 'script' && attributes.src === scriptUrl && attributes.type === 'module' && attributes['data-mode'] === mode && attributes['data-app-id'] === appId) scriptFound = true;
        else if (node.tagName === 'link' && attributes.href === styleUrl && attributes.rel === 'stylesheet') styleFound = true;
        else throw unavailable();
      }
      if (['template', 'noscript'].includes(node.tagName)) continue;
    }
    for (const child of node.childNodes || []) stack.push(child);
  }
  checkPolicies(policies);
  if (scriptFound && styleFound) return Buffer.from(prefix + source);
  const firstBodyOffset = body?.childNodes?.find(node => node.sourceCodeLocation)?.sourceCodeLocation?.startOffset;
  const offset = head?.sourceCodeLocation?.endTag?.startOffset ?? body?.sourceCodeLocation?.startTag?.startOffset ?? firstBodyOffset;
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > source.length) throw unavailable();
  const style = styleFound ? '' : `<link rel="stylesheet" href="${styleUrl}" data-praxis-platform-nav>`;
  const script = scriptFound ? '' : `<script type="module" src="${scriptUrl}" data-praxis-platform-nav data-mode="${mode}"${appId ? ` data-app-id="${appId}"` : ''}></script>`;
  return Buffer.from(`${prefix}${source.slice(0, offset)}${style}${script}${source.slice(offset)}`);
}

export function navigationHeaders(headers, bytes) {
  const result = { ...headers, 'content-type': 'text/html; charset=utf-8', 'content-length': String(bytes.length), 'cache-control': 'no-store' };
  for (const key of ['content-encoding', 'etag', 'last-modified', 'content-md5', 'digest', 'content-digest', 'repr-digest']) delete result[key];
  return result;
}
