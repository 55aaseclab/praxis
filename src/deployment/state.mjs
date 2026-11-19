import { open, rename, unlink } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';

const colors = ['blue', 'green'];
function exact(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}
function origin(value) {
  if (typeof value !== 'string') throw new Error('Deployment targets must be loopback HTTP origins.');
  const url = new URL(value);
  if (url.protocol !== 'http:' || !['127.0.0.1', '[::1]'].includes(url.hostname) || !url.port || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('Deployment targets must be loopback HTTP origins.');
  return url.origin;
}
export function validateDeploymentState(value) {
  if (!exact(value, ['version', 'generation', 'active', 'writer', 'paused', 'slots']) || value.version !== 1 || !Number.isSafeInteger(value.generation) || value.generation < 1 || !colors.includes(value.active) || value.writer !== null && !colors.includes(value.writer) || typeof value.paused !== 'boolean' || !exact(value.slots, colors) || !value.paused && value.writer !== value.active) throw new Error('The deployment state is invalid.');
  const slots = Object.fromEntries(colors.map(color => {
    if (!exact(value.slots[color], ['web', 'core'])) throw new Error('The deployment slot is invalid.');
    return [color, { web: origin(value.slots[color].web), core: origin(value.slots[color].core) }];
  }));
  if (new Set(colors.flatMap(color => Object.values(slots[color]))).size !== 4) throw new Error('Deployment targets must be distinct.');
  return { version: 1, generation: value.generation, active: value.active, writer: value.writer, paused: value.paused, slots };
}
export async function readDeploymentState(file) {
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size > 16384 || info.mode & 0o077) throw new Error('The deployment state must be a private regular file.');
    return validateDeploymentState(JSON.parse(await handle.readFile('utf8')));
  } finally { await handle.close(); }
}
export async function writeDeploymentState(file, value) {
  const state = validateDeploymentState(value), temporary = join(dirname(file), `.state-${randomUUID()}.tmp`);
  let handle;
  try {
    handle = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    await handle.writeFile(JSON.stringify(state) + '\n'); await handle.sync(); await handle.close(); handle = undefined;
    await rename(temporary, file);
    const directory = await open(dirname(file), constants.O_RDONLY);
    try { await directory.sync(); } finally { await directory.close(); }
    return state;
  } finally { await handle?.close(); await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
}
export { validateDeploymentState as validateState, readDeploymentState as readState, writeDeploymentState as writeState };
