import { access, lstat, readFile, realpath } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { isWithin } from './storage/config.mjs';

// Validate exact application bindings without inspecting business records.
export async function resolveKnowledgeRuntime(app, { uid, workspace, protectedPaths = [], privateFiles = [] } = {}) {
  if (app === undefined) return null;
  if (!app || app.url !== 'http://127.0.0.1:14324/api/business' || !Array.isArray(app.spaces) || !app.spaces.length || app.spaces.some(space => typeof space !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,199}$/.test(space)) || new Set(app.spaces).size !== app.spaces.length) throw new Error('Knowledge requires explicit spaces and its fixed local adapter.');
  const paths = [app.dataDir, app.keyFile, app.businessConfigFile];
  if (paths.some(path => typeof path !== 'string' || !isAbsolute(path) || resolve(path) !== path || /[\\\0\r\n$]/.test(path))) throw new Error('Knowledge runtime paths must be canonical absolute paths.');
  const [dataDir, keyFile, configFile] = paths;
  const overlaps = (left, right) => isWithin(left, right) || isWithin(right, left);
  if (dataDir.split('/').filter(Boolean).length < 3 || paths.some(path => isWithin(workspace, path)) || protectedPaths.filter(Boolean).some(path => overlaps(dataDir, resolve(path))) || privateFiles.filter(Boolean).some(path => isWithin(dataDir, resolve(path))) || [dirname(keyFile), dirname(configFile)].some(path => overlaps(dataDir, path)) || keyFile === configFile || privateFiles.filter(Boolean).some(path => [keyFile, configFile].includes(resolve(path)))) throw new Error('Knowledge data, credentials, controls and other applications must remain separate.');
  const data = await lstat(dataDir);
  if (!data.isDirectory() || data.isSymbolicLink() || data.uid !== Number(uid) || (data.mode & 0o777) !== 0o700 || await realpath(dataDir) !== dataDir) throw new Error('Knowledge requires an existing canonical private mode700 data directory.');
  await access(dataDir, constants.R_OK | constants.W_OK);
  for (const [path, minimum, maximum] of [[keyFile, 32, 4096], [configFile, 2, 65536]]) {
    const file = await lstat(path), parent = await lstat(dirname(path));
    if (!file.isFile() || file.isSymbolicLink() || file.nlink !== 1 || file.uid !== Number(uid) || (file.mode & 0o777) !== 0o600 || file.size < minimum || file.size > maximum || !parent.isDirectory() || parent.uid !== Number(uid) || (parent.mode & 0o077) !== 0 || await realpath(path) !== path) throw new Error('Knowledge credentials require separate canonical private mode600 files.');
    await access(path, constants.R_OK);
  }
  let mapping;
  try { mapping = JSON.parse(await readFile(configFile, 'utf8')); } catch { throw new Error('Knowledge mapping must be valid JSON.'); }
  if (!mapping || Object.keys(mapping).some(key => !['version', 'spaces'].includes(key)) || mapping.version !== 1 || !Array.isArray(mapping.spaces) || JSON.stringify([...mapping.spaces].sort()) !== JSON.stringify([...app.spaces].sort())) throw new Error('Knowledge mapping must match its configured spaces exactly.');
  // A file is offered to exactly one library. The business actor submits the import.
  const inboxDir = app.attachmentInbox;
  if (inboxDir !== undefined) {
    if (typeof inboxDir !== 'string' || !isAbsolute(inboxDir) || resolve(inboxDir) !== inboxDir || /[\x00-\x1f$]/.test(inboxDir)
      || [workspace, dataDir, dirname(keyFile), dirname(configFile), ...protectedPaths].filter(Boolean).some(path => overlaps(resolve(path), inboxDir))
      || privateFiles.filter(Boolean).some(path => isWithin(inboxDir, resolve(path)))) throw new Error('Knowledge attachment inbox must be separate from managed data and configuration.');
    const info = await lstat(inboxDir);
    if (!info.isDirectory() || info.uid !== Number(uid) || (info.mode & 0o777) !== 0o700 || await realpath(inboxDir) !== inboxDir) throw new Error('Knowledge requires a private, canonical attachment inbox.');
  }
  const staged = app.attachments ?? [];
  if (!Array.isArray(staged) || staged.length > 1000 || (inboxDir && staged.length)) throw new Error('Invalid Knowledge attachment list.');
  const attachments = [], targets = new Set();
  for (const item of staged) {
    if (!item || Object.keys(item).some(key => !['spaceId', 'resourceId', 'sha256', 'file'].includes(key))
      || !app.spaces.includes(item.spaceId) || !/^[a-z0-9][a-z0-9-]{0,79}$/.test(item.resourceId || '')
      || item.resourceId === 'legacy-library' || !/^[a-f0-9]{64}$/.test(item.sha256 || '')
      || typeof item.file !== 'string' || !isAbsolute(item.file) || resolve(item.file) !== item.file
      || /[\x00-\x1f$]/.test(item.file) || !/\.(?:epub|zip|docx?|xlsx?|pptx?|pdf|wps|rtf|txt|md|csv|html?)$/i.test(item.file)) {
      throw new Error('Invalid scoped Knowledge attachment.');
    }
    const target = `/run/knowledge-inbox/${item.spaceId}/${item.resourceId}/${item.sha256}`;
    if (targets.has(target) || [workspace, dataDir, dirname(keyFile), dirname(configFile), ...protectedPaths].filter(Boolean).some(path => isWithin(resolve(path), item.file))
      || privateFiles.filter(Boolean).some(path => resolve(path) === item.file)) throw new Error('Attachment bindings must be unique and separate from protected data.');
    const info = await lstat(item.file);
    if (!info.isFile() || info.uid !== Number(uid) || info.size < 1 || info.size > 1024 ** 3 || await realpath(item.file) !== item.file) throw new Error('A Knowledge attachment must be a regular, owned file of at most 1 GiB.');
    targets.add(target);
    attachments.push({ source: item.file, target, read_only: true });
  }
  return { dataDir, keyFile, configFile, attachments, inboxDir };
}

export function knowledgeComposeService(runtime, { contentRoot } = {}) {
  return {
    environment: { KNOWLEDGE_MANAGED: '1', ...(runtime.inboxDir || runtime.attachments?.length ? { KNOWLEDGE_INBOX_ROOT: '/run/knowledge-inbox' } : {}), KNOWLEDGE_DATA_DIR: '/data/knowledge', KNOWLEDGE_ADAPTER_KEY_FILE: '/run/secrets/knowledge-key', KNOWLEDGE_BUSINESS_CONFIG: '/run/config/knowledge-business.json', KNOWLEDGE_BASE_PATH: '/apps/knowledge/', KNOWLEDGE_STATIC_DIR: contentRoot ? '/data/content/published' : '/workspace/third_party/knowledge/dist-public', ...(contentRoot ? { KNOWLEDGE_CONTENT_ROOT: '/data/content' } : {}) },
    volumes: [
      { source: runtime.dataDir, target: '/data/knowledge', read_only: false },
      { source: runtime.keyFile, target: '/run/secrets/knowledge-key', read_only: true },
      { source: runtime.configFile, target: '/run/config/knowledge-business.json', read_only: true },
      ...(runtime.inboxDir ? [{ source: runtime.inboxDir, target: '/run/knowledge-inbox', read_only: true }] : []),
      ...(runtime.attachments || []),
      ...(contentRoot ? [{ source: contentRoot, target: '/data/content', read_only: true }] : []),
    ].map(binding => ({ type: 'bind', ...binding, bind: { create_host_path: false } })),
  };
}
