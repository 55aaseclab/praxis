import { lstat, open, realpath } from 'node:fs/promises';
import { constants } from 'node:fs';
import { resolve, relative, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { readApps } from './apps.mjs';

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const id = value => typeof value === 'string' && /^[a-z][a-z0-9-]{0,79}$/.test(value);
const operationName = value => typeof value === 'string' && /^[a-z][a-z0-9_]{0,99}$/.test(value);
const actionName = value => typeof value === 'string' && /^[a-z][a-z0-9_]{0,79}$/.test(value);
const boundedText = (value, maximum = 20000) => typeof value === 'string' && value.length > 0 && value.length <= maximum && !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value);
const fail = message => { throw Object.assign(new Error(message), { code: 'INVALID_APP_INTEGRATION' }); };
const reservedClaims = new Set(['v', 'appId', 'userId', 'clientId', 'grantId', 'spaceId', 'action', 'resources', 'expiresAt', 'requestId', 'method', 'path', 'bodyHash', 'actionsGranted']);
function freeze(value) {
  if (Array.isArray(value)) { value.forEach(freeze); return Object.freeze(value); }
  if (object(value) && typeof value.safeParse !== 'function') { for (const item of Object.values(value)) freeze(item); return Object.freeze(value); }
  return value;
}
async function sourceFile(root, source, name, maximum) {
  if (!/^third_party\/[a-z][a-z0-9-]*$/.test(source) || typeof name !== 'string' || /[\\\x00-\x1f\x7f?#]/.test(name) || name.startsWith('/') || name.split('/').some(part => !part || part === '.' || part === '..')) fail('Integration files must stay inside their installed repository.');
  const base = await realpath(root); let target = base;
  for (const part of `${source}/${name}`.split('/')) { target = resolve(target, part); if ((await lstat(target)).isSymbolicLink()) fail('Integration source must not contain symbolic links.'); }
  const appRoot = await realpath(resolve(base, source)), actual = await realpath(target), within = relative(appRoot, actual);
  if (within === '..' || within.startsWith(`..${sep}`) || within.startsWith(sep)) fail('Integration file escapes its installed repository.');
  const handle = await open(actual, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await handle.stat(); if (!info.isFile() || info.size > maximum) fail('Integration source must be a bounded regular file.');
    const bytes = Buffer.alloc(info.size + 1); let length = 0;
    while (length < bytes.length) { const part = await handle.read(bytes, length, bytes.length - length, null); if (!part.bytesRead) break; length += part.bytesRead; }
    const after = await handle.stat();
    if (length !== info.size || after.size !== info.size || after.mtimeMs !== info.mtimeMs || after.ctimeMs !== info.ctimeMs) fail('Integration source changed while reading.');
    return { filename: actual, content: bytes.subarray(0, length).toString('utf8'), stamp: `${info.ino}:${info.mtimeMs}:${info.ctimeMs}:${info.size}` };
  } finally { await handle.close(); }
}
function relativePath(value) { return typeof value === 'string' && value.length > 0 && value.length < 1024 && !/[\\\x00-\x1f\x7f?#]/.test(value) && !value.startsWith('/') && !value.split('/').some(part => !part || part === '.' || part === '..'); }
function httpPath(value) { return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//') && value.length <= 2048 && !/[\\\x00-\x1f\x7f?#]/.test(value) && !/%(?:2e|2f|5c)/i.test(value) && !value.split('/').some(part => part === '.' || part === '..'); }
function validateWeb(web) {
  if (!object(web) || !id(web.slug) || ['api', 'auth', 'oauth', 'admin', 'business', 'mcp', 'prds'].includes(web.slug) || !['grant', 'platform-admin', 'document-owner'].includes(web.policy) || !['proxy', 'static', 'private-documents'].includes(web.kind)) fail('Invalid native app integration.');
  if (web.nativePort !== undefined && (!Number.isInteger(web.nativePort) || web.nativePort < 1 || web.nativePort > 65535)) fail('Invalid native app port.');
  if (web.directory !== undefined && !relativePath(web.directory)) fail('Invalid native static root.');
  for (const field of ['assets', 'internalPaths']) if (web[field] !== undefined && (!Array.isArray(web[field]) || web[field].length > 128 || web[field].some(value => typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || /[\\\x00-\x1f\x7f?#]/.test(value) || value.split('/').some(part => part === '.' || part === '..')))) fail('Invalid native path declaration.');
  if (web.route !== undefined && typeof web.route !== 'function' || web.readOnly !== undefined && typeof web.readOnly !== 'boolean') fail('Invalid native route policy.');
  if (web.nativePolicies !== undefined) {
    if (!object(web.nativePolicies) || Object.keys(web.nativePolicies).length > 32) fail('Invalid native scope policies.');
    for (const [name, policy] of Object.entries(web.nativePolicies)) if (!id(name) || !object(policy) || !boundedText(policy.resource, 200) || !Array.isArray(policy.actions) || !policy.actions.length || policy.actions.some(action => !actionName(action))) fail('Invalid native scope policy.');
  }
  if (web.corePrefixes !== undefined && (!Array.isArray(web.corePrefixes) || web.corePrefixes.length > 32 || web.corePrefixes.some(path => typeof path !== 'string' || !path.startsWith('/api/business/') || /^\/api\/business\/(?:admin|console|account)(?:\/|$)/.test(path) || /[\\\x00-\x1f\x7f?#]/.test(path) || path.split('/').some(part => part === '.' || part === '..')))) fail('Invalid declared Core route prefixes.');
  if (Object.hasOwn(web, 'headers')) fail('Native request policies use forwardHeaders.');
  if (web.forwardHeaders !== undefined && (!Array.isArray(web.forwardHeaders) || web.forwardHeaders.length > 64 || web.forwardHeaders.some(name => typeof name !== 'string' || !/^[a-z][a-z0-9-]{0,79}$/.test(name) || ['authorization', 'cookie', 'host', 'proxy-authorization', 'connection', 'upgrade'].includes(name)))) fail('Invalid native request header policy.');
  for (const name of ['directoryEnv', 'privateConfigKey']) if (web[name] !== undefined && (typeof web[name] !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]{0,119}$/.test(web[name]))) fail('Invalid private document binding declaration.');
  for (const name of ['corePages', 'coreAssets']) if (web[name] !== undefined && (!Array.isArray(web[name]) || web[name].length > 128 || web[name].some(entry => !object(entry) || !httpPath(entry.path) || !relativePath(entry.file) || name === 'corePages' && (!entry.path.startsWith('/business/') || entry.path === '/business/')))) fail('Invalid app-owned Core asset declaration.');
  for (const name of ['legacyPaths', 'noNavigationPrefixes']) if (web[name] !== undefined && (!Array.isArray(web[name]) || web[name].length > 64 || web[name].some(path => !httpPath(path)))) fail('Invalid native route declaration.');
  if (web.upgradePolicies !== undefined && (!Array.isArray(web.upgradePolicies) || web.upgradePolicies.some(name => !Object.hasOwn(web.nativePolicies || {}, name)))) fail('Invalid native upgrade policy.');
  if (web.httpHandlers !== undefined && (!Array.isArray(web.httpHandlers) || web.httpHandlers.length > 32 || web.httpHandlers.some(entry => !object(entry) || !httpPath(entry.prefix) || !entry.prefix.startsWith('/api/business/') || /^\/api\/business\/(?:admin|console|account)(?:\/|$)/.test(entry.prefix) || typeof entry.createHandler !== 'function'))) fail('Invalid app-owned HTTP handler.');
  if (web.coreReads !== undefined && (!Array.isArray(web.coreReads) || web.coreReads.some(entry => !object(entry) || !httpPath(entry.path) || !httpPath(entry.upstream) || !entry.upstream.startsWith('/api/business/')))) fail('Invalid declared native Core read.');
  if (web.share !== undefined && (!object(web.share) || !httpPath(web.share.prefix) || !web.share.prefix.startsWith('/share/') || !id(web.share.configurationKey) && !/^[a-z][A-Za-z0-9]{0,79}$/.test(web.share.configurationKey) || ['authorize', 'read', 'validate'].some(name => typeof web.share[name] !== 'function'))) fail('Invalid app-owned sharing integration.');
}
function validateBusiness(value, app) {
  if (!object(value) || !id(value.adapterId) || ['praxis', 'spaces', 'control', 'public'].includes(value.adapterId) || !Array.isArray(value.actions) || !value.actions.length || value.actions.length > 32 || value.actions.some(item => !actionName(item)) || new Set(value.actions).size !== value.actions.length || !object(value.operations) || !Array.isArray(value.tools) || value.tools.length > 256 || !object(value.scopes) || typeof value.validateInvocation !== 'function') fail('Invalid business integration.');
  const operations = {};
  for (const [name, raw] of Object.entries(value.operations)) {
    const definition = typeof raw === 'string' ? { action: raw, mutation: raw !== 'read' } : raw;
    if (!operationName(name) || !object(definition) || !value.actions.includes(definition.action) || typeof definition.mutation !== 'boolean' || definition.readOnly !== undefined && typeof definition.readOnly !== 'boolean') fail('Invalid business operation declaration.');
    operations[name] = { ...definition };
  }
  if (!Object.keys(operations).length || Object.keys(operations).length > 256) fail('Invalid business operation declarations.');
  const scopes = {};
  for (const [name, actions] of Object.entries(value.scopes)) {
    if (!name.startsWith(value.adapterId + ':') || !/^[a-z][a-z0-9-]*:[a-z][a-z0-9_]{0,79}$/.test(name) || !Array.isArray(actions) || !actions.length || actions.some(action => !value.actions.includes(action)) || new Set(actions).size !== actions.length) fail('Invalid business OAuth scope.');
    scopes[name] = { appId: value.adapterId, actions: [...actions] };
  }
  const tools = value.tools.map(tool => {
    if (!object(tool) || !operationName(tool.name) || tool.name.startsWith('praxis_') || !operationName(tool.operation) || !Object.hasOwn(operations, tool.operation) || tool.action !== operations[tool.operation].action || tool.appId !== undefined && tool.appId !== value.adapterId || !boundedText(tool.description) || !tool.schema || typeof tool.schema.safeParse !== 'function' || !object(tool.schema.shape) || tool.input !== undefined && typeof tool.input !== 'function') fail('Invalid typed MCP tool declaration.');
    return { ...tool, appId: value.adapterId, readOnly: tool.readOnly ?? !operations[tool.operation].mutation };
  });
  if (value.targetedCreate !== undefined && typeof value.targetedCreate !== 'boolean') fail('Invalid resource creation policy.');
  if (value.ownerOnlyActions !== undefined && (!Array.isArray(value.ownerOnlyActions) || value.ownerOnlyActions.some(action => !value.actions.includes(action)))) fail('Invalid owner action policy.');
  if (value.actionRoles !== undefined && (!object(value.actionRoles) || Object.entries(value.actionRoles).some(([action, roles]) => !value.actions.includes(action) || !Array.isArray(roles) || !roles.length || roles.some(role => !['owner', 'admin', 'member'].includes(role))))) fail('Invalid business membership role policy.');
  if (value.assertionFields !== undefined && (!Array.isArray(value.assertionFields) || value.assertionFields.some(field => !actionName(field) && !/^[a-z][A-Za-z0-9]{0,79}$/.test(field) || reservedClaims.has(field)))) fail('Invalid app assertion fields.');
  if (value.collectActions !== undefined && typeof value.collectActions !== 'boolean') fail('Invalid action assertion policy.');
  if (value.authorizedReads !== undefined && (!Array.isArray(value.authorizedReads) || value.authorizedReads.some(name => operations[name]?.action !== 'read' || operations[name]?.mutation))) fail('Invalid bound source read declaration.');
  for (const field of value.assertionFields || []) {
    const rule = value.assertionRules?.[field];
    if (!object(rule) || !['member-action', 'subjects-read', 'source-read', 'authorization-expiry', 'native-session'].includes(rule.kind)) fail('App assertion fields require a bound authorization rule.');
    if (rule.kind === 'member-action' && (!value.actions.includes(rule.action) || !Array.isArray(rule.roles) || !rule.roles.length || rule.roles.some(role => !['owner', 'admin', 'member'].includes(role)))) fail('Invalid member action assertion rule.');
  }
  for (const field of ['prepareInvocation', 'normalizeAdapterRequest', 'requiredActions', 'sourceAuthorizations', 'errorDetails', 'projectResult', 'formatMcpResult', 'validateConfig']) if (value[field] !== undefined && typeof value[field] !== 'function') fail('Invalid app integration hook.');
  if (value.responseLimit !== undefined && typeof value.responseLimit !== 'function' && (!Number.isInteger(value.responseLimit) || value.responseLimit < 1024 || value.responseLimit > 16 * 1024 * 1024)) fail('Invalid app response limit.');
  if (value.instructions !== undefined && (!Array.isArray(value.instructions) || value.instructions.length > 32 || value.instructions.some(text => !boundedText(text)))) fail('Invalid app instructions.');
  return { ...value, appId: app.id, operations, scopes, tools };
}
function validateInstallation(integration, app) {
  const storage = integration.storage, deployment = integration.deployment;
  if (storage !== undefined) {
    if (!object(storage) || storage.rootId !== undefined && (!id(storage.rootId) || storage.rootId === 'praxis') || !object(storage.paths || {}) || !Array.isArray(storage.sources || []) || !Array.isArray(storage.omissions || [])) fail('Invalid app storage declaration.');
    for (const [alias, path] of Object.entries(storage.paths || {})) if (!/^[A-Za-z][A-Za-z0-9_-]{0,99}$/.test(alias) || ['platform', 'observations'].includes(alias) || path !== '' && !relativePath(path)) fail('Invalid app storage path.');
    if (storage.sources?.length > 128 || storage.omissions?.some(value => !boundedText(value, 2000))) fail('Invalid app storage source declarations.');
    for (const source of storage.sources || []) {
      if (!object(source) || !['json', 'sqlite', 'directory'].includes(source.kind)) fail('Invalid app storage source.');
      for (const key of ['path', 'target', 'filename', 'nativeSource', 'primaryTarget']) if (source[key] !== undefined && source[key] !== '' && !relativePath(source[key])) fail('Invalid app storage source path.');
    }
    if (storage.validators !== undefined && (!object(storage.validators) || Object.entries(storage.validators).some(([name, validate]) => !id(name) || typeof validate !== 'function'))) fail('Invalid app storage validators.');
    if (storage.inventory !== undefined && (!object(storage.inventory) || typeof storage.inventory.project !== 'function' || storage.inventory.inspect !== undefined && typeof storage.inventory.inspect !== 'function')) fail('Invalid app inventory hook.');
    if (storage.backup !== undefined && !object(storage.backup)) fail('Invalid app backup declaration.');
  }
  if (deployment !== undefined) {
    if (!object(deployment)) fail('Invalid app deployment declaration.');
    if (deployment.allowSourceData !== undefined && !relativePath(deployment.allowSourceData)) fail('Invalid source data allowance.');
    if (deployment.native !== undefined && (!object(deployment.native) || !relativePath(deployment.native.dockerfile) || deployment.native.command !== undefined && (!Array.isArray(deployment.native.command) || !deployment.native.command.length || deployment.native.command.some(value => !boundedText(value, 4096))))) fail('Invalid app-owned native build.');
    for (const name of ['managedService', 'validateBusinessConfig', 'resolveModelCaches']) if (deployment[name] !== undefined && typeof deployment[name] !== 'function') fail('Invalid app deployment hook.');
    if (deployment.adminBootstrap !== undefined && (!object(deployment.adminBootstrap) || typeof deployment.adminBootstrap.create !== 'function' || !/^[A-Za-z][A-Za-z0-9]{0,99}$/.test(deployment.adminBootstrap.input || '') || !id(deployment.adminBootstrap.flag))) fail('Invalid app administration bootstrap hook.');
    if (deployment.stack !== undefined && !object(deployment.stack)) fail('Invalid app stack declaration.');
    if (deployment.platformBuild !== undefined && (!Array.isArray(deployment.platformBuild) || deployment.platformBuild.length > 32 || deployment.platformBuild.some(step => !object(step) || !/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(step.command || '') || !Array.isArray(step.args) || step.args.some(value => !boundedText(value, 4096))))) fail('Invalid app asset build recipe.');
    if (deployment.localCompose !== undefined) {
      const recipe = deployment.localCompose;
      if (!object(recipe) || !object(recipe.services || {}) || !object(recipe.volumes || {})) fail('Invalid app local Compose recipe.');
      for (const service of Object.values(recipe.services || {})) {
        if (!object(service)) fail('Invalid app local service.');
        if (service.build !== undefined && (!object(service.build) || service.build.context?.replace(/^\.\//, '') !== app.source || !relativePath(service.build.dockerfile) || service.build.additional_contexts !== undefined)) fail('Local app builds require their own installed source context.');
      }
    }
  }
}

/** Load only fixed reviewed modules selected by the installed source index. */
export async function loadAppIntegrations(root, { catalog } = {}) {
  const installed = catalog || await readApps(root, { publicUrlsFile: null });
  if (!Array.isArray(installed) || installed.length > 128) fail('Invalid installed integration catalogue.');
  const apps = [], identities = new Set(), slugs = new Set(), adapters = new Set(), toolNames = new Set(), scopeNames = new Set(), storageRoots = new Set(), storageAliases = new Set(), storageSchemas = new Set();
  const operations = {}, operationDefinitions = {}, businessActions = {}, scopes = {}, tools = [], skills = {};
  for (const app of installed) {
    if (!id(app.id) || identities.has(app.id)) fail('Duplicate installed application identity.');
    identities.add(app.id);
    const source = await sourceFile(root, app.source, 'praxis-integration.mjs', 256 * 1024);
    const url = pathToFileURL(source.filename); url.searchParams.set('v', source.stamp);
    const module = await import(url.href);
    if (typeof module.createIntegration !== 'function') fail('An app must export createIntegration.');
    const integration = module.createIntegration({ z });
    if (!object(integration) || integration.schemaVersion !== 1 || integration.appId !== app.id) fail('Invalid app integration identity.');
    validateInstallation(integration, app);
    if (integration.storage?.rootId) { if (storageRoots.has(integration.storage.rootId)) fail('Duplicate app storage root.'); storageRoots.add(integration.storage.rootId); }
    for (const name of Object.keys(integration.storage?.paths || {})) { if (storageAliases.has(name)) fail('Duplicate app storage path alias.'); storageAliases.add(name); }
    for (const name of Object.keys(integration.storage?.validators || {})) { if (storageSchemas.has(name)) fail('Duplicate app storage schema validator.'); storageSchemas.add(name); }
    validateWeb(integration.web); if (slugs.has(integration.web.slug)) fail('Duplicate native app route.'); slugs.add(integration.web.slug);
    let business;
    if (integration.business !== undefined) {
      business = validateBusiness(integration.business, app);
      if (adapters.has(business.adapterId)) fail('Duplicate business adapter identity.'); adapters.add(business.adapterId);
      operations[business.adapterId] = Object.fromEntries(Object.entries(business.operations).map(([name, value]) => [name, value.action]));
      operationDefinitions[business.adapterId] = business.operations;
      businessActions[business.adapterId] = [...business.actions];
      for (const [name, value] of Object.entries(business.scopes)) { if (scopeNames.has(name)) fail('Duplicate OAuth scope.'); scopeNames.add(name); scopes[name] = value; }
      if (!object(business.skill) || !relativePath(business.skill.path) || !boundedText(business.skill.name, 160)) fail('An app must own its MCP skill.');
      const skillFile = await sourceFile(root, app.source, business.skill.path, 128 * 1024);
      const header = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(skillFile.content);
      const name = header?.[1].match(/^name:\s*([^\r\n]+)$/m)?.[1].trim(), description = header?.[1].match(/^description:\s*([^\r\n]+)$/m)?.[1].trim();
      if (name !== business.skill.name || !description) fail('Invalid app MCP skill metadata.');
      const skill = { name, uri: `praxis://skills/${business.adapterId}`, description, mimeType: 'text/markdown', content: skillFile.content };
      skills[business.adapterId] = skill;
      for (const tool of business.tools) {
        if (toolNames.has(tool.name) || !skill.content.includes('`' + tool.name + '`')) fail('Duplicate or undocumented MCP tool.');
        toolNames.add(tool.name); tools.push(tool);
      }
    }
    apps.push({ ...app, integration: { ...integration, ...(business ? { business } : {}) } });
  }
  freeze(apps); freeze(operations); freeze(operationDefinitions); freeze(businessActions); freeze(scopes); freeze(tools); freeze(skills);
  const getApp = id => apps.find(app => app.id === id);
  const getBusiness = id => apps.find(app => app.integration.business?.adapterId === id)?.integration.business;
  const webApps = apps.map(app => ({ id: app.id, ...app.integration.web })); freeze(webApps);
  return Object.freeze({ root: await realpath(root), apps, webApps, webAppIds: Object.freeze(webApps.filter(app => app.policy === 'grant').map(app => app.id)), operations, operationDefinitions, businessActions, scopes, tools, skills,
    targetedCreateApps: Object.freeze(apps.filter(app => app.integration.business?.targetedCreate).map(app => app.integration.business.adapterId)),
    getApp, getBusiness, getWeb: id => getApp(id)?.integration.web,
    webId: adapterId => apps.find(app => app.integration.business?.adapterId === adapterId)?.id || adapterId,
    businessId: appId => getApp(appId)?.integration.business?.adapterId || appId,
    publicFacts: () => apps.map(app => ({ id: app.id, kind: app.kind, name: app.name, description: app.description, labels: app.labels, icon: app.icon, version: app.version,
      ...(app.launcher !== undefined ? { launcher: app.launcher } : {}), runtime: Boolean(app.integration.web.runtimeTrace),
      entry: { nativePath: `/apps/${app.integration.web.slug}/`, policy: app.integration.web.policy, kind: app.integration.web.kind, legacyPaths: app.integration.web.legacyPaths || [],
        ...(app.integration.business ? { adapterId: app.integration.business.adapterId } : {}),
        ...(app.integration.web.workbenchDirectory ? { workbenchDirectory: { path: app.integration.web.workbenchDirectory.path, title: app.integration.web.workbenchDirectory.title } } : {}) } })),
  });
}

/** Internal source reader: callers select a declared asset, never a user path. */
export async function readAppIntegrationFile(registry, appId, path, maximum = 2 * 1024 * 1024) {
  const app = registry.getApp(appId);
  if (!app || !Number.isInteger(maximum) || maximum < 1 || maximum > 16 * 1024 * 1024) fail('Invalid app integration source read.');
  return sourceFile(registry.root, app.source, path, maximum);
}
