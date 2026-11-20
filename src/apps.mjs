import { constants } from 'node:fs';
import { lstat, open, realpath, readFile } from 'node:fs/promises';
import { resolve, relative, sep } from 'node:path';

const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value, maximum = 160) => typeof value === 'string' && value.trim().length > 0 && value.length <= maximum && !/[\x00-\x1f\x7f]/.test(value);
const releaseVersion = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/;
const appIdentity = /^[a-z][a-z0-9-]{0,79}$/;
const sourcePath = /^third_party\/[a-z][a-z0-9-]*$/;
const iconAlias = /^\/[a-z][a-z0-9-]*-icon\.svg$/;
const iconSource = Symbol('appIconSource');
const maximumManifest = 64 * 1024;

function only(value, fields, message) {
  if (!plain(value) || Object.keys(value).some(key => !fields.includes(key))) throw new Error(message);
}
function relativeAppPath(value, extension) {
  if (typeof value !== 'string' || !value || value.length > 1024 || /[\\\x00-\x1f\x7f?#]/.test(value)) throw new Error('Invalid relative app path.');
  const path = value.replace(/^\.\//, '');
  if (path.startsWith('/') || path.split('/').some(part => !part || part === '.' || part === '..') || !path.toLowerCase().endsWith(extension)) throw new Error('Invalid relative app path.');
  return path;
}

// Declarations can select only bounded regular files inside the reviewed app tree.
async function appFile(root, path, maximum, { optional = false } = {}) {
  let handle;
  try {
    const allowedRoot = await realpath(root);
    let target = allowedRoot;
    for (const part of path.split('/')) {
      target = resolve(target, part);
      if ((await lstat(target)).isSymbolicLink()) throw new Error('App source paths must not contain symbolic links.');
    }
    const actual = await realpath(target), within = relative(allowedRoot, actual);
    if (within === '..' || within.startsWith(`..${sep}`) || within.startsWith(sep)) throw new Error('App source path escapes its repository.');
    handle = await open(actual, constants.O_RDONLY | constants.O_NOFOLLOW);
    const info = await handle.stat();
    if (!info.isFile() || info.size > maximum) throw new Error('App source must be a bounded regular file.');
    const buffer = Buffer.alloc(Math.min(info.size + 1, maximum + 1));
    let length = 0;
    while (length < buffer.length) {
      const part = await handle.read(buffer, length, buffer.length - length, null);
      if (!part.bytesRead) break;
      length += part.bytesRead;
    }
    const after = await handle.stat();
    if (length > maximum || length !== info.size || after.size !== info.size || after.mtimeMs !== info.mtimeMs || after.ctimeMs !== info.ctimeMs) throw new Error('App source exceeds its size limit or changed while reading.');
    const content = buffer.subarray(0, length);
    return { filename: actual, info, content };
  } catch (error) {
    if (optional && error.code === 'ENOENT') return null;
    throw error;
  } finally { await handle?.close(); }
}
async function jsonFile(root, path, maximum, options) {
  const value = await appFile(root, path, maximum, options);
  if (!value) return undefined;
  try { return JSON.parse(value.content.toString('utf8')); }
  catch { throw new Error(`Invalid JSON in ${path}.`); }
}
async function installedRoot(root, source) {
  let target = await realpath(root);
  for (const part of source.split('/')) {
    target = resolve(target, part);
    const info = await lstat(target);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Installed app source must be a repository directory without symbolic links.');
  }
  return target;
}

/** Installation selection contains source references, without app metadata. */
export async function readInstalledApps(root) {
  const index = await jsonFile(root, 'config/installed-apps.json', maximumManifest);
  only(index, ['schemaVersion', 'apps'], 'Invalid installed app index.');
  if (index.schemaVersion !== 1 || !Array.isArray(index.apps) || index.apps.length > 128) throw new Error('Invalid installed app index.');
  const sources = new Set();
  return index.apps.map(entry => {
    only(entry, ['source'], 'Installed apps contain source references only.');
    if (!sourcePath.test(entry.source || '') || sources.has(entry.source)) throw new Error('Installed app sources must be unique third_party repository paths.');
    sources.add(entry.source);
    return { source: entry.source };
  });
}

/** Presentation, documentation and release identity belong to each app. */
export async function readAppManifest(appRoot) {
  const manifest = await jsonFile(appRoot, 'praxis-app.json', maximumManifest);
  only(manifest, ['schemaVersion', 'id', 'version', 'kind', 'name', 'description', 'labels', 'icon', 'iconAliases', 'path', 'port', 'launcher', 'adminOnly', 'documents'], 'Invalid app manifest fields.');
  if (manifest.schemaVersion !== 1 || !appIdentity.test(manifest.id || '') || manifest.id === 'praxis' || manifest.kind !== 'app') throw new Error('Invalid app identity.');
  if (typeof manifest.version !== 'string' || manifest.version.length > 48 || !releaseVersion.test(manifest.version)) throw new Error('App release version must use MAJOR.MINOR.PATCH numeric components.');
  if (!text(manifest.name) || !text(manifest.description) || typeof manifest.path !== 'string' || !manifest.path.startsWith('/') || manifest.path.startsWith('//') || /[\\\x00-\x1f\x7f?#]/.test(manifest.path) || /(?:^|\/)\.{1,2}(?:\/|$)/.test(manifest.path) || /%(?:2e|2f|5c)/i.test(manifest.path)) throw new Error('Invalid app metadata.');
  only(manifest.labels, ['en', 'zh'], 'Invalid localized app labels.');
  if (!manifest.labels.zh) throw new Error('Simplified Chinese app labels are required.');
  for (const value of Object.values(manifest.labels)) {
    only(value, ['name', 'description'], 'Invalid localized app labels.');
    if (!text(value.name) || !text(value.description)) throw new Error('Invalid localized app labels.');
  }
  if (manifest.port !== undefined && (!Number.isInteger(manifest.port) || manifest.port < 1 || manifest.port > 65535)) throw new Error('Invalid app port.');
  if (manifest.launcher !== undefined && typeof manifest.launcher !== 'boolean') throw new Error('Invalid launcher setting.');
  if (manifest.adminOnly !== undefined && typeof manifest.adminOnly !== 'boolean') throw new Error('Invalid administrator entry setting.');
  const icon = relativeAppPath(manifest.icon, '.svg');
  if (!icon.startsWith('public/')) throw new Error('App icons must belong to the app public directory.');
  if (manifest.iconAliases !== undefined && (!Array.isArray(manifest.iconAliases) || manifest.iconAliases.length > 8 || manifest.iconAliases.some(value => !iconAlias.test(value) || value === '/praxis-icon.svg') || new Set(manifest.iconAliases).size !== manifest.iconAliases.length)) throw new Error('Invalid app icon aliases.');
  only(manifest.documents, ['prd'], 'Invalid app document declarations.');
  only(manifest.documents.prd, ['en', 'zh', 'zhHeading'], 'Invalid app PRD declaration.');
  const prd = { ...manifest.documents.prd, en: relativeAppPath(manifest.documents.prd.en, '.md'), zh: relativeAppPath(manifest.documents.prd.zh, '.md') };
  if (prd.zhHeading !== undefined && (!text(prd.zhHeading, 300) || !/^#{1,6} /.test(prd.zhHeading))) throw new Error('Invalid bilingual PRD boundary.');
  await appFile(appRoot, icon, 256 * 1024);
  const pkg = await jsonFile(appRoot, 'package.json', 1024 * 1024, { optional: true });
  const lock = await jsonFile(appRoot, 'package-lock.json', 8 * 1024 * 1024, { optional: true });
  if (pkg !== undefined && !plain(pkg) || lock !== undefined && !plain(lock)) throw new Error('App package and lockfile metadata must be objects.');
  for (const version of [pkg?.version, lock?.version, lock?.packages?.['']?.version].filter(value => value !== undefined)) {
    if (version !== manifest.version) throw new Error('App manifest, package and lockfile release versions must agree.');
  }
  if (pkg !== undefined && pkg.version === undefined || lock !== undefined && lock.version === undefined && lock.packages?.['']?.version === undefined) throw new Error('App package and lockfile release versions are required.');
  return { ...manifest, icon, documents: { prd } };
}

function publicAppUrl(value) {
  if (typeof value !== 'string') throw new Error('Public app URL must be an absolute HTTPS URL.');
  let url;
  try { url = new URL(value); } catch { throw new Error('Public app URL must be an absolute HTTPS URL.'); }
  if (url.protocol !== 'https:' || url.username || url.password || value.includes('?') || value.includes('#')) throw new Error('Public app URL must use HTTPS without user information, a query or a fragment.');
  return url.href;
}

// The private file capability is non-enumerable and never enters the catalog JSON.
export function withAppIcon(app, appRoot, relativeIcon) {
  Object.defineProperty(app, iconSource, { value: { root: appRoot, path: relativeIcon } });
  return app;
}
export async function readApps(root, { publicUrlsFile = process.env.PRAXIS_PUBLIC_URLS_FILE } = {}) {
  const apps = [], ids = new Set(), aliases = new Set();
  for (const { source } of await readInstalledApps(root)) {
    const appRoot = await installedRoot(root, source);
    const manifest = await readAppManifest(appRoot);
    if (ids.has(manifest.id)) throw new Error('Installed app identities must be unique.');
    for (const alias of manifest.iconAliases || []) {
      if (aliases.has(alias)) throw new Error('App icon aliases must be unique.');
      aliases.add(alias);
    }
    ids.add(manifest.id);
    apps.push(withAppIcon({ ...manifest, source, builtin: true, icon: `/app-icons/${manifest.id}.svg` }, appRoot, manifest.icon));
  }
  if (!publicUrlsFile) return apps;
  let publicUrls;
  try { publicUrls = JSON.parse(await readFile(resolve(publicUrlsFile), 'utf8')); }
  catch (error) {
    if (error instanceof SyntaxError) throw new Error('Public app URL configuration must contain valid JSON.');
    throw error;
  }
  if (!plain(publicUrls)) throw new Error('Public app URL configuration must be an object.');
  const overrides = new Map();
  for (const [id, value] of Object.entries(publicUrls)) {
    if (!ids.has(id)) throw new Error('Unknown public app ID.');
    overrides.set(id, publicAppUrl(value));
  }
  return apps.map(app => overrides.has(app.id) ? withAppIcon({ ...app, url: overrides.get(app.id) }, app[iconSource].root, app[iconSource].path) : app);
}
export function appIconEntry(apps, pathname) {
  return apps.find(app => pathname === `/app-icons/${app.id}.svg` || app.iconAliases?.includes(pathname));
}
export async function resolveAppIcon(root, pathname, { apps } = {}) {
  const app = appIconEntry(apps || await readApps(root, { publicUrlsFile: null }), pathname);
  const source = app?.[iconSource];
  if (!source) return null;
  return { app, ...await appFile(source.root, source.path, 256 * 1024) };
}
export function appUrl(app, origin) {
  if (app.url) return new URL(app.url).href;
  const url = new URL(app.path, origin);
  if (app.port !== undefined) url.port = String(app.port);
  return url.href;
}
