import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

function publicAppUrl(value) {
  if (typeof value !== 'string') throw new Error('Public app URL must be an absolute HTTPS URL.');
  let url;
  try { url = new URL(value); } catch { throw new Error('Public app URL must be an absolute HTTPS URL.'); }
  if (url.protocol !== 'https:' || url.username || url.password || value.includes('?') || value.includes('#')) {
    throw new Error('Public app URL must use HTTPS without user information, a query or a fragment.');
  }
  return url.href;
}

export async function readApps(root, { publicUrlsFile = process.env.PRAXIS_PUBLIC_URLS_FILE } = {}) {
  const apps = JSON.parse(await readFile(resolve(root, 'config/apps.json'), 'utf8'));
  const ids = new Set();
  if (!Array.isArray(apps)) throw new Error('App registry must be an array.');
  for (const app of apps) {
    if (!/^[a-z\d-]+$/.test(app.id) || ids.has(app.id) || app.kind !== 'app') throw new Error('Invalid app identity.');
    if (typeof app.name !== 'string' || !app.path?.startsWith('/') || app.path.startsWith('//') || !/^\/[a-z\d-]+\.svg$/.test(app.icon)) throw new Error('Invalid app metadata.');
    if (app.labels !== undefined && (!app.labels || typeof app.labels !== 'object' || Array.isArray(app.labels)
        || Object.entries(app.labels).some(([locale, value]) => !['en', 'zh'].includes(locale) || !value ||
          ['name', 'description'].some(field => typeof value[field] !== 'string' || !value[field].trim() || value[field].length > 160)))) {
      throw new Error('Invalid localized app labels.');
    }
    if (app.port !== undefined && (!Number.isInteger(app.port) || app.port < 1 || app.port > 65535)) throw new Error('Invalid app port.');
    if (app.url !== undefined) app.url = publicAppUrl(app.url);
    if (app.launcher !== undefined && typeof app.launcher !== 'boolean') throw new Error('Invalid launcher setting.');
    if (app.adminOnly !== undefined && typeof app.adminOnly !== 'boolean') throw new Error('Invalid administrator entry setting.');
    ids.add(app.id);
  }
  if (!publicUrlsFile) return apps;
  let publicUrls;
  try { publicUrls = JSON.parse(await readFile(resolve(publicUrlsFile), 'utf8')); }
  catch (error) {
    if (error instanceof SyntaxError) throw new Error('Public app URL configuration must contain valid JSON.');
    throw error;
  }
  if (!publicUrls || typeof publicUrls !== 'object' || Array.isArray(publicUrls)) throw new Error('Public app URL configuration must be an object.');
  const overrides = new Map();
  for (const [id, value] of Object.entries(publicUrls)) {
    if (!ids.has(id)) throw new Error('Unknown public app ID.');
    overrides.set(id, publicAppUrl(value));
  }
  return apps.map(app => overrides.has(app.id) ? { ...app, url: overrides.get(app.id) } : app);
}

export function appUrl(app, origin) {
  if (app.url) return new URL(app.url).href;
  const url = new URL(app.path, origin);
  if (app.port !== undefined) url.port = String(app.port);
  return url.href;
}
