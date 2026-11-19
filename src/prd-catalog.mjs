import { lstat, readFile, realpath, stat } from 'node:fs/promises';
import { resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = fileURLToPath(new URL('../', import.meta.url));
export const MAX_PRD_BYTES = 2 * 1024 * 1024;
export const PRD_SOURCES = Object.freeze([
  { id: 'praxis', group: 'main', project: 'Praxis', source: 'docs/PRD.md', en: 'docs/PRD.en.md' },
  { id: 'reminder', group: 'third-party', project: 'Reminder', source: 'third_party/reminder/docs/PRD.md', en: 'third_party/reminder/docs/PRD.en.md' },
  { id: 'memo', group: 'third-party', project: 'Memo', source: 'third_party/memo/docs/Memo_PRD.md', en: 'third_party/memo/docs/PRD.en.md' },
  { id: 'tingproof', group: 'third-party', project: '听校（TingProof）', source: 'third_party/tingproof/docs/听校_PRD_V1.0.0.md', en: 'third_party/tingproof/docs/PRD.en.md' },
  { id: 'lattice-slides', group: 'third-party', project: 'Lattice', source: 'third_party/lattice/docs/Slides-Platform_PRD.md', en: 'third_party/lattice/docs/PRD.en.md' },
  { id: 'travel', group: 'third-party', project: 'Travel', source: 'third_party/travel/docs/PRD.md', en: 'third_party/travel/docs/PRD.en.md' },
  { id: 'knowledge', group: 'third-party', project: 'Knowledge', source: 'third_party/knowledge/docs/PRD.md', en: 'third_party/knowledge/docs/PRD.en.md' },
  { id: 'finance', group: 'third-party', project: 'Finance', source: 'third_party/finance/docs/PRD.md', zhHeading: '# Finance 财务应用产品需求文档' },
  { id: 'intelligence', group: 'third-party', project: 'Intelligence', source: 'third_party/intelligence/docs/PRD.md', en: 'third_party/intelligence/docs/PRD.en.md' },
  { id: 'projects', group: 'third-party', project: 'Projects', source: 'third_party/projects/docs/PRD.md', en: 'third_party/projects/docs/PRD.en.md' },
  { id: 'matrix-reader', group: 'third-party', project: 'Matrix Reader', source: 'third_party/matrix-reader/PRD.md', zhHeading: '# Matrix Reader 产品需求' },
  { id: 'letters', group: 'third-party', project: 'Letters', source: 'third_party/letters/PRD.md', zhHeading: '## 简体中文' },
  { id: 'profiles', group: 'third-party', project: 'Profiles', source: 'third_party/profiles/PRD.md', zhHeading: '## 简体中文' },
  { id: 'calendar', group: 'third-party', project: 'Calendar', source: 'third_party/calendar/PRD.md', zhHeading: '# 日历' },
  { id: 'polaris', group: 'third-party', project: 'Polaris', source: 'third_party/polaris/apps/docs/site/development/prd.zh-CN.md', en: 'third_party/polaris/apps/docs/site/development/prd.md' },
].map(Object.freeze));

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
  const explicit = body.match(/^(?:\*\*)?(?:当前)?(?:版本号?|version)(?:\*\*)?\s*[:：]\s*(?:\*\*)?([vV]?\d+\.\d+\.\d+)(?:\b|\*|\s)/im);
  const tableVersions = [...body.matchAll(/^\|\s*\*{0,2}([vV]?\d+\.\d+\.\d+)\*{0,2}\s*\|/gm)].map(match => match[1]);
  const version = explicit?.[1] || tableVersions.sort(compareVersions).at(-1) || null;
  return { title, version };
}

// A document ID selects a fixed source; callers cannot supply a filesystem path.
export async function loadPrd(id, { root = REPO_ROOT, locale = 'en' } = {}) {
  const entry = PRD_SOURCES.find(entry => entry.id === id);
  if (!entry) return null;
  const source = {
    id, group: entry.group,
    project: id === 'tingproof' && locale !== 'zh' ? 'TingProof' : entry.project,
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

export async function listPrds(options) {
  const documents = await Promise.all(PRD_SOURCES.map(source => loadPrd(source.id, options)));
  return documents.map(({ content, ...metadata }) => metadata);
}
