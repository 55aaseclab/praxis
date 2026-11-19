import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { open, readdir, readlink } from 'node:fs/promises';
import { extname, isAbsolute, join, resolve, sep } from 'node:path';
import { pipeline } from 'node:stream/promises';

const extensions = new Set(['.md', '.txt', '.tex', '.bib', '.pdf', '.docx']);
const excludedDirs = new Set(['node_modules', 'build', 'dist', 'out', 'output', 'cache', 'tmp', '__pycache__']);
const excludedFile = /^(?:readme(?:\.[a-z-]+)?|agents|claude|skill|contributing|license|changelog|prd|roadmap|security|credentials|secrets?|passwords?)\.(?:md|txt)$/i;
const validName = name => !name.startsWith('.') && !/[\\\u0000-\u001f\u007f]/u.test(name);
const folderFlags = constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_DIRECTORY;
const fileFlags = constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK;
const vanished = error => ['ENOENT', 'ENOTDIR', 'ELOOP', 'ESTALE'].includes(error.code);
const fdPath = handle => '/proc/self/fd/' + handle.fd;
const headers = {
  'Cache-Control': 'private, no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'X-Robots-Tag': 'noindex, nofollow',
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'self'; base-uri 'none'; form-action 'none'",
  Vary: 'Cookie',
};

// Production and tests run on Linux. Anchor every component to an already-open
// directory descriptor so renaming a directory into a symlink cannot redirect
// the next open. Never accept a file path supplied by the browser.
async function openRoot(root) {
  if (!root || root === sep) throw new Error('Private source unavailable');
  let current = await open(sep, folderFlags);
  try {
    for (const part of root.split(sep).filter(Boolean)) {
      const next = await open(join(fdPath(current), part), folderFlags);
      await current.close();
      current = next;
    }
    return current;
  } catch (error) {
    await current.close();
    throw error;
  }
}

async function* documents(folder, root, group = '') {
  const entries = await readdir(fdPath(folder), { withFileTypes: true });
  for (const entry of entries) {
    if (!validName(entry.name)) continue;
    const child = join(fdPath(folder), entry.name);
    if (entry.isDirectory()) {
      if (excludedDirs.has(entry.name.toLowerCase())) continue;
      let directory;
      try {
        directory = await open(child, folderFlags);
        yield* documents(directory, root, join(group, entry.name));
      } catch (error) {
        if (!vanished(error)) throw error;
      } finally {
        await directory?.close();
      }
      continue;
    }
    const extension = extname(entry.name).toLowerCase();
    if (!entry.isFile() || !extensions.has(extension) || excludedFile.test(entry.name)) continue;
    const relative = join(group, entry.name);
    const id = createHash('sha256').update(root).update('\0').update(relative).digest('hex');
    yield { metadata: { id, name: entry.name, group, type: extension.slice(1) }, child, relative };
  }
}

async function openDocument(entry, root) {
  let file;
  try {
    file = await open(entry.child, fileFlags);
    const stat = await file.stat();
    if (stat.isFile() && stat.nlink === 1 && await readlink(fdPath(file)) === join(root, entry.relative)) {
      return { file, size: stat.size };
    }
  } catch (error) {
    if (!vanished(error) && error.code !== 'ENXIO') {
      await file?.close();
      throw error;
    }
  }
  await file?.close();
  return null;
}

function byteRange(value, total) {
  if (!value) return { start: 0, end: total - 1, partial: false };
  const match = /^bytes=(\d*)-(\d*)$/.exec(value);
  if (!match || (!match[1] && !match[2]) || total === 0) return null;
  const first = match[1] ? Number(match[1]) : null;
  const last = match[2] ? Number(match[2]) : null;
  if ([first, last].some(n => n !== null && !Number.isSafeInteger(n))) return null;
  const start = first ?? Math.max(0, total - last);
  const end = first === null || last === null ? total - 1 : Math.min(total - 1, last);
  return start >= total || end < start ? null : { start, end, partial: true };
}

function json(request, response, status, value, extra = {}) {
  const body = Buffer.from(JSON.stringify(value));
  response.writeHead(status, { ...headers, ...extra, 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': body.length });
  response.end(request.method === 'HEAD' ? undefined : body);
}

async function serve(request, response, entry, opened) {
  const { file, size } = opened;
  const { name, type } = entry.metadata;
  const range = byteRange(request.headers.range, size);
  if (!range) return json(request, response, 416, { code: 'INVALID_RANGE' }, { 'Content-Range': 'bytes */' + size });
  const mime = type === 'pdf' ? 'application/pdf' : type === 'docx'
    ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' : 'text/plain; charset=utf-8';
  const encoded = encodeURIComponent(name).replace(/['()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
  response.writeHead(range.partial ? 206 : 200, {
    ...headers, 'Content-Type': mime, 'Content-Length': range.end - range.start + 1,
    'Content-Disposition': (type === 'docx' ? 'attachment' : 'inline') + "; filename*=UTF-8''" + encoded,
    'Accept-Ranges': 'bytes',
    ...(range.partial ? { 'Content-Range': `bytes ${range.start}-${range.end}/${size}` } : {}),
  });
  if (request.method === 'HEAD' || !size) return response.end();
  const stream = file.createReadStream({ start: range.start, end: range.end, autoClose: false });
  await pipeline(stream, response);
}

// The owning gateway verifies the native app grant before calling the handler.
// Reauthorization fences filesystem enumeration/open before sending any bytes.
export function createPrivateDocumentHandler(privateRoot) {
  const root = typeof privateRoot === 'string' && isAbsolute(privateRoot) ? resolve(privateRoot) : null;
  return async function privateDocument(request, response, pathname, reauthorize = () => {}) {
    if (!['GET', 'HEAD'].includes(request.method)) return json(request, response, 405, { code: 'METHOD_NOT_ALLOWED' }, { Allow: 'GET, HEAD' });
    const match = /^\/api\/documents(?:\/([a-f0-9]{64}))?$/.exec(pathname);
    if (!match) return json(request, response, 404, { code: 'NOT_FOUND' });
    let folder;
    try {
      folder = await openRoot(root);
      const items = [];
      for await (const entry of documents(folder, root)) {
        if (match[1] && match[1] !== entry.metadata.id) continue;
        const opened = await openDocument(entry, root);
        if (!opened) continue;
        try {
          if (match[1]) {
            await reauthorize();
            if (await readlink(fdPath(opened.file)) !== join(root, entry.relative)) {
              return json(request, response, 404, { code: 'NOT_FOUND' });
            }
            await serve(request, response, entry, opened);
            return;
          }
          items.push(entry.metadata);
        } finally {
          await opened.file.close();
        }
      }
      if (match[1]) return json(request, response, 404, { code: 'NOT_FOUND' });
      items.sort((a, b) => a.group.localeCompare(b.group) || a.name.localeCompare(b.name));
      await reauthorize();
      return json(request, response, 200, { items });
    } catch (error) {
      if (response.headersSent || response.destroyed) return response.destroy();
      if (error.status) throw error;
      return json(request, response, 503, { code: 'PRIVATE_SOURCE_UNAVAILABLE' });
    } finally {
      await folder?.close();
    }
  };
}
