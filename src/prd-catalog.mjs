import { lstat, readFile, realpath, stat } from 'node:fs/promises';
import { resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readApps } from './apps.mjs';

export const REPO_ROOT = fileURLToPath(new URL('../', import.meta.url));
export const MAX_PRD_BYTES = 2 * 1024 * 1024;
export const PLATFORM_PRD_SOURCE = Object.freeze({ id: 'praxis', group: 'main', project: 'Praxis', source: 'docs/PRD.md', en: 'docs/PRD.en.md' });

export async function getPrdSources({ root = REPO_ROOT } = {}) {
  const apps = await readApps(root, { publicUrlsFile: null });
  return [PLATFORM_PRD_SOURCE, ...apps.filter(app => app.documents?.prd).map(app => {
    if (app.id === 'praxis') throw new Error('The platform document ID is reserved.');
    const prd = app.documents.prd;
    return { id: app.id, group: 'third-party', project: app.name,
      projectZh: app.labels?.zh?.name || app.name, appVersion: app.version,
      source: `${app.source}/${prd.zh}`, en: `${app.source}/${prd.en}`,
      ...(prd.zhHeading ? { zhHeading: prd.zhHeading } : {}),
    };
  })];
}

function compareVersions(a, b) {
  const left = a.replace(/^v/i, '').split('.').map(Number);
  const right = b.replace(/^v/i, '').split('.').map(Number);
  for (let index = 0; index < 3; index++) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
}

export function prdMetadata(content, fallback) {
  const body = content.replace(/^\uFEFF/, '').replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, '');
  const title = body.match(/^#\s+(.+?)\s*#*\s*$/m)?.[1]?.replace(/[*_`]/g, '').trim() || `${fallback} PRD`;
  const explicit = body.match(/^(?:\*\*)?(?:当前)?(?:需求(?:文档)?修订(?:号)?|requirements\s+revision|版本号?|version)(?:\*\*)?\s*[:：]\s*(?:\*\*)?([vV]?\d+\.\d+\.\d+)(?:\b|\*|\s)/im);
  const tableVersions = [...body.matchAll(/^\|\s*\*{0,2}([vV]?\d+\.\d+\.\d+)\*{0,2}\s*\|/gm)].map(match => match[1]);
  const version = explicit?.[1] || tableVersions.sort(compareVersions).at(-1) || null;
  return { title, version };
}

// A document ID selects a fixed source; callers cannot supply a filesystem path.
export async function loadPrd(id, { root = REPO_ROOT, locale = 'en' } = {}) {
  if (typeof id !== 'string' || !/^[a-z][a-z0-9-]{0,79}$/.test(id)) return null;
  const entry = id === 'praxis' ? PLATFORM_PRD_SOURCE : (await getPrdSources({ root })).find(entry => entry.id === id);
  if (!entry) return null;
  return loadPrdSource(entry, { root, locale });
}

async function loadPrdSource(entry, { root = REPO_ROOT, locale = 'en' } = {}) {
  const source = {
    id: entry.id, group: entry.group,
    project: locale === 'zh' ? entry.projectZh || entry.project : entry.project,
    ...(entry.appVersion ? { appVersion: entry.appVersion } : {}),
    source: locale === 'zh' ? entry.source : entry.en || entry.source,
  };
  const result = { ...source, title: `${source.project} PRD`, version: null, status: 'missing', content: '' };
  try {
    const allowedRoot = await realpath(resolve(root));
    let target = allowedRoot;
    for (const segment of source.source.split('/')) {
      target = resolve(target, segment);
      const info = await lstat(target);
      if (info.isSymbolicLink()) return { ...result, status: 'unavailable' };
    }
    const actual = await realpath(target);
    const within = relative(allowedRoot, actual);
    if (within === '..' || within.startsWith(`..${sep}`) || within.startsWith(sep)) return { ...result, status: 'unavailable' };
    const info = await stat(actual);
    if (!info.isFile() || info.size > MAX_PRD_BYTES) return { ...result, status: 'unavailable' };
    const content = await readFile(actual, 'utf8');
    if (Buffer.byteLength(content) > MAX_PRD_BYTES) return { ...result, status: 'unavailable' };
    const metadata = prdMetadata(content, source.project);
    const boundary = entry.zhHeading ? content.indexOf('\n' + entry.zhHeading + '\n') : -1;
    let edition = content;
    if (boundary >= 0) {
      edition = locale === 'zh' ? content.slice(boundary + 1) : content.slice(0, boundary).replace(/^\[简体中文\]\(#[^)]+\)\s*$/m, '');
    }
    const title = boundary < 0 ? metadata.title : prdMetadata(edition, source.project).title;
    return { ...result, title, version: metadata.version, status: 'ready', content: edition };
  } catch (error) {
    return { ...result, status: error.code === 'ENOENT' ? 'missing' : 'unavailable' };
  }
}

export async function listPrds(options = {}) {
  const sources = await getPrdSources(options);
  const documents = await Promise.all(sources.map(source => loadPrdSource(source, options)));
  return documents.map(({ content, ...metadata }) => metadata);
}
