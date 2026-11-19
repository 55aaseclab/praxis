import { createReadStream } from 'node:fs';
import { cp, lstat, mkdir, readdir, realpath, rename, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join, resolve, relative, isAbsolute } from 'node:path';

async function digest(path) { const hash = createHash('sha256'); for await (const chunk of createReadStream(path)) hash.update(chunk); return hash.digest('hex'); }
export async function identityManifest(path, prefix = '') {
  const info = await lstat(path, { bigint: true });
  if (info.isSymbolicLink()) {
    // Application-owned browser/model trees can contain links, retained by rename only.
    const { readlink } = await import('node:fs/promises');
    return [{ path: prefix, type: 'link', value: await readlink(path), dev: String(info.dev), ino: String(info.ino) }];
  }
  if (!info.isFile() && !info.isDirectory()) throw new Error('Working data contains an unsupported special file.');
  if (info.isFile()) return [{ path: prefix, type: 'file', dev: String(info.dev), ino: String(info.ino), size: String(info.size), mtime: String(info.mtimeNs) }];
  const entries = [{ path: prefix, type: 'directory', dev: String(info.dev), ino: String(info.ino) }];
  for (const name of (await readdir(path)).sort()) entries.push(...await identityManifest(join(path, name), prefix ? `${prefix}/${name}` : name));
  return entries;
}
export async function validateRelocations(moves) {
  const inside = (a, b) => { const r = relative(a, b); return r === '' || r !== '..' && !r.startsWith('../') && !isAbsolute(r); };
  const active = moves.filter(item => item.from !== item.to);
  for (const [index, item] of active.entries()) {
    if (![item.from, item.to].every(path => typeof path === 'string' && isAbsolute(path) && resolve(path) === path) || inside(item.from, item.to) || inside(item.to, item.from)) throw new Error('Unsafe relocation pair.');
    if (await lstat(item.to).catch(error => { if (error.code === 'ENOENT') return null; throw error; })) throw new Error('Relocation target already exists.');
    if ((await lstat(item.from)).isSymbolicLink()) throw new Error('A relocation source cannot be a symbolic link.');
    let parent = dirname(item.to);
    while (!await lstat(parent).catch(error => { if (error.code === 'ENOENT') return null; throw error; })) parent = dirname(parent);
    if (!(await lstat(parent)).isDirectory() || await realpath(parent) !== parent) throw new Error('Relocation targets cannot traverse symbolic links.');
    for (const other of active.slice(0, index)) if ([other.from, other.to].some(path => inside(path, item.from) || inside(item.from, path) || inside(path, item.to) || inside(item.to, path))) throw new Error('Relocation pairs overlap.');
  }
  return active;
}

/** Caller must stop all writers. Same-device rename preserves each data inode. */
export async function relocateVerified(item) {
  const before = await identityManifest(item.from);
  await mkdir(dirname(item.to), { recursive: true, mode: 0o700 });
  let renamed = false;
  try {
    await rename(item.from, item.to); renamed = true;
    const after = await identityManifest(item.to);
    if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error('Relocation identity verification failed.');
    return { ...item, method: 'rename', entries: before.length };
  } catch (error) {
    if (renamed) { await rename(item.to, item.from); throw error; }
    if (error.code !== 'EXDEV') throw error;
  }
  if (before.some(entry => entry.type === 'link')) throw new Error('Cross-device relocation of application links requires an explicit app export.');
  const staging = `${item.to}.relocating`;
  if (await lstat(staging).catch(() => null)) throw new Error('Previous relocation staging exists.');
  try {
  await cp(item.from, staging, { recursive: true, preserveTimestamps: true, force: false, errorOnExist: true });
  for (const entry of before.filter(entry => entry.type === 'file')) if (await digest(join(item.from, entry.path)) !== await digest(join(staging, entry.path))) throw new Error('Cross-device relocation checksum failed.');
  if (JSON.stringify(before) !== JSON.stringify(await identityManifest(item.from))) throw new Error('Source changed during relocation.');
  await rename(staging, item.to);
  // Retain the source until every binding has switched; caller removes it explicitly later.
  return { ...item, method: 'copy', entries: before.length };
  } catch (error) { await rm(staging, { recursive: true, force: true }); throw error; }
}
export async function rollbackRelocation(item) {
  if (item.method === 'rename') { await mkdir(dirname(item.from), { recursive: true, mode: 0o700 }); await rename(item.to, item.from); }
  else if (item.method === 'copy') await rm(item.to, { recursive: true });
}
