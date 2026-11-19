import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';

export const DATA_INVENTORY_MAX_BYTES = 128 * 1024;
const kinds = new Set(['json', 'sqlite', 'directory', 'browser', 'docker-volume', 'source', 'cache', 'unknown', 'browser-file', 'derived', 'external']);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const fields = (value, required, optional = []) => object(value) && required.every(key => Object.hasOwn(value, key)) && Object.keys(value).every(key => required.includes(key) || optional.includes(key));
const text = (value, maximum) => typeof value === 'string' && value.length > 0 && value.length <= maximum && value === value.trim() && !/[\u0000-\u001f\u007f<>]/.test(value);
const path = value => text(value, 2048) && isAbsolute(value) && resolve(value) === value && !/[\\?#]/.test(value);
const unavailable = () => Object.assign(new Error('Data inventory is unavailable.'), { code: 'DATA_INVENTORY_UNAVAILABLE', status: 503 });

/** Validate metadata only; this never opens an application data location. */
export function validateDataInventory(value) {
  const fail = () => { throw unavailable(); };
  if (!fields(value, ['schemaVersion', 'generatedAt', 'apps'], ['workspaceRoot']) || value.schemaVersion !== 1 || typeof value.generatedAt !== 'string') fail();
  try { if (new Date(value.generatedAt).toISOString() !== value.generatedAt) fail(); } catch { fail(); }
  if (Object.hasOwn(value, 'workspaceRoot') && !path(value.workspaceRoot)) fail();
  if (!Array.isArray(value.apps) || !value.apps.length || value.apps.length > 64) fail();
  const ids = new Set();
  for (const app of value.apps) {
    if (!fields(app, ['id', 'name', 'locations']) || typeof app.id !== 'string' || !/^[a-z0-9][a-z0-9-]{0,79}$/.test(app.id) || ids.has(app.id) || !text(app.name, 160) || !Array.isArray(app.locations) || !app.locations.length || app.locations.length > 32) fail();
    ids.add(app.id);
    for (const location of app.locations) {
      if (!fields(location, ['label', 'kind'], ['id', 'status', 'applicationPath', 'labels', 'hostPath', 'containerPath', 'volumeName', 'storageKey', 'description']) || !text(location.label, 160) || !kinds.has(location.kind)) fail();
      for (const key of ['hostPath', 'containerPath', 'applicationPath']) if (Object.hasOwn(location, key) && !path(location[key])) fail();
      if (Object.hasOwn(location, 'volumeName') && (typeof location.volumeName !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,199}$/.test(location.volumeName))) fail();
      if (Object.hasOwn(location, 'storageKey') && !text(location.storageKey, 160)) fail();
      if (Object.hasOwn(location, 'description') && !text(location.description, 1000)) fail();
      if (location.kind === 'browser' && ['hostPath', 'containerPath', 'volumeName'].some(key => Object.hasOwn(location, key))) fail();
    }
  }
  try { if (Buffer.byteLength(JSON.stringify(value)) > DATA_INVENTORY_MAX_BYTES) fail(); } catch { fail(); }
  return value;
}

export async function readDataInventory(file) {
  let handle;
  try {
    if (!path(file) || await realpath(dirname(file)) !== dirname(file)) throw unavailable();
    const parent = await lstat(dirname(file));
    if (!parent.isDirectory() || (parent.mode & 0o777) !== 0o700 || typeof process.getuid === 'function' && parent.uid !== process.getuid()) throw unavailable();
    handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
    const info = await handle.stat();
    if (!info.isFile() || info.nlink !== 1 || (info.mode & 0o777) !== 0o600 || info.size > DATA_INVENTORY_MAX_BYTES || typeof process.getuid === 'function' && info.uid !== process.getuid()) throw unavailable();
    const bytes = Buffer.alloc(DATA_INVENTORY_MAX_BYTES + 1);
    const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
    if (bytesRead > DATA_INVENTORY_MAX_BYTES) throw unavailable();
    return validateDataInventory(JSON.parse(bytes.subarray(0, bytesRead).toString('utf8')));
  } catch { throw unavailable(); }
  finally { await handle?.close().catch(() => {}); }
}
