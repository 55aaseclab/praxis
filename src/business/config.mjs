import { readFile, lstat } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { homedir } from 'node:os';
import { businessError, readSigningKey, OPERATIONS } from './bridge.mjs';
import { validateConsoleConfig } from './console.mjs';
import { validateSlidesModelCacheConfig } from './slides-model-caches.mjs';

export const DEFAULT_CORE_CONFIG = resolve(homedir(), '.config/praxis/core.json');
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
export async function loadBusinessConfig(file = process.env.PRAXIS_CORE_CONFIG || process.env.PRAXIS_BUSINESS_CONFIG) {
  if (!file) throw new Error('Supply the private platform configuration using --config or PRAXIS_CORE_CONFIG.');
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
  for (const file of [config.appProviderRuntimeFile, config.providerRoot]) if (file !== undefined && (typeof file !== 'string' || !isAbsolute(file) || resolve(file) !== file || /[\0\r\n]/.test(file))) throw businessError(500, 'INVALID_APP_PROVIDER_CONFIG');
  if (config.appProviders !== undefined) {
    if (!config.appProviders || typeof config.appProviders !== 'object' || Array.isArray(config.appProviders) || Object.keys(config.appProviders).length > 128) throw businessError(500, 'INVALID_APP_PROVIDER_CONFIG');
    for (const [id, provider] of Object.entries(config.appProviders)) {
      if (!/^[a-z][a-z0-9-]{0,79}$/.test(id) || provider !== null && (typeof provider !== 'object' || Array.isArray(provider))) throw businessError(500, 'INVALID_APP_PROVIDER_CONFIG');
      if (provider === null) continue;
      if (provider.ownerId !== undefined && (typeof provider.ownerId !== 'string' || !/^[a-zA-Z0-9_.:-]{1,200}$/.test(provider.ownerId))) throw businessError(500, 'INVALID_APP_PROVIDER_CONFIG');
      if (provider.url !== undefined && provider.url !== null) {
        let url; try { url = new URL(provider.url); } catch { throw businessError(500, 'INVALID_APP_PROVIDER_CONFIG'); }
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/' || url.protocol === 'http:' && !['127.0.0.1','localhost','[::1]'].includes(url.hostname)) throw businessError(500, 'INVALID_APP_PROVIDER_CONFIG');
      }
    }
  }
  try { validateConsoleConfig(config.console); } catch { throw businessError(500, 'INVALID_CONSOLE_CONFIG'); }
  validateWebGatewayConfig(config.webGateway);
  return { ...config, issuer: issuer.origin };
}

export const loadCoreConfig = loadBusinessConfig;
