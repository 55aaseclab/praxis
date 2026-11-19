import { readFile, lstat } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { homedir } from 'node:os';
import { businessError, readSigningKey, OPERATIONS } from './bridge.mjs';
import { validateConsoleConfig } from './console.mjs';
import { validateSlidesModelCacheConfig } from './slides-model-caches.mjs';

export const DEFAULT_BUSINESS_CONFIG = resolve(homedir(), '.config/praxis/business.json');
export function validateWebGatewayConfig(value) {
  if (value === undefined) return;
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !['enabled', 'originHost', 'shareManifestFile'].includes(key)) || typeof value.enabled !== 'boolean') throw businessError(500, 'INVALID_WEB_GATEWAY_CONFIG');
  if (value.shareManifestFile !== undefined && (typeof value.shareManifestFile !== 'string' || !isAbsolute(value.shareManifestFile) || resolve(value.shareManifestFile) !== value.shareManifestFile || /[\0\r\n]/.test(value.shareManifestFile))) throw businessError(500, 'INVALID_WEB_GATEWAY_CONFIG');
  if (value.originHost === undefined && !value.enabled) return;
  if (typeof value.originHost !== 'string' || !value.originHost || /[\\\s/?#@]/.test(value.originHost)) throw businessError(500, 'INVALID_WEB_GATEWAY_CONFIG');
  let url;
  try { url = new URL(`http://${value.originHost}`); } catch { throw businessError(500, 'INVALID_WEB_GATEWAY_CONFIG'); }
  if (url.hostname !== value.originHost || url.port || url.username || url.password || url.pathname !== '/' || !/^(?:[a-z0-9]+(?:[.-][a-z0-9]+)*|\[[a-f0-9:]+\])$/.test(value.originHost)) throw businessError(500, 'INVALID_WEB_GATEWAY_CONFIG');
}
export async function loadBusinessConfig(file = process.env.PRAXIS_BUSINESS_CONFIG) {
  if (!file) throw new Error('Supply the path to a private business configuration using --config or PRAXIS_BUSINESS_CONFIG.');
  const info = await lstat(file);
  if (!info.isFile() || info.isSymbolicLink() || info.mode & 0o077 || info.size > 256 * 1024) throw businessError(500, 'UNSAFE_CONFIG');
  const config = JSON.parse(await readFile(file, 'utf8'));
  const issuer = new URL(config.issuer);
  if (!['http:', 'https:'].includes(issuer.protocol) || issuer.username || issuer.password || issuer.search || issuer.hash || !['', '/'].includes(issuer.pathname)) throw businessError(500, 'INVALID_ISSUER');
  if (issuer.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(issuer.hostname)) throw businessError(500, 'HTTPS_REQUIRED');
  if (!isAbsolute(config.database || '') || !isAbsolute(config.eventsDatabase || '') || !config.apps || typeof config.apps !== 'object' || Array.isArray(config.apps)) throw businessError(500, 'INVALID_CONFIG');
  for (const [appId, app] of Object.entries(config.apps)) {
    if (!Object.hasOwn(OPERATIONS, appId) || !app || typeof app !== 'object' || Array.isArray(app)) throw businessError(500, 'INVALID_ADAPTER');
    if (!isAbsolute(app.keyFile || '') || !Array.isArray(app.spaces) || app.spaces.some(space => typeof space !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,199}$/.test(space))) throw businessError(500, 'INVALID_ADAPTER');
    if (appId === 'slides') validateSlidesModelCacheConfig(app.modelCaches);
    else if (app.modelCaches !== undefined) throw businessError(500, 'INVALID_ADAPTER');
    await readSigningKey(app.keyFile);
  }
  try { validateConsoleConfig(config.console); } catch { throw businessError(500, 'INVALID_CONSOLE_CONFIG'); }
  validateWebGatewayConfig(config.webGateway);
  return { ...config, issuer: issuer.origin };
}
