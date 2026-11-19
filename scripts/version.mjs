import { execFileSync } from 'node:child_process';
import { readFile, realpath, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join, resolve } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const files = ['package.json', 'package-lock.json', 'docs/PRD.md', 'docs/ROADMAP.md'];
const englishFiles = ['docs/PRD.en.md', 'docs/ROADMAP.en.md'];
const englishDeclaration = /^Version: v?(\d+\.\d+\.\d+)(?=\s|$)/m;
const declaration = /^版本：v?(\d+\.\d+\.\d+)(?=\s|$)/m;
const ownedPaths = [
  ...files, 'docs', 'src', 'public', 'scripts', 'tests', 'config', 'infra', 'ops', 'skills',
  'AGENTS.md', 'README.md', 'README.zh-CN.md', 'paseo.json', '.gitignore', '.gitmodules',
  'Dockerfile', 'Dockerfile.storage', 'Dockerfile.builtins', 'packaging', 'compose.yaml', 'compose.apps.yaml', 'compose.storage.yaml', 'compose.business.yaml', 'compose.polaris-viewer.yaml', 'compose.polaris-observations.yaml', '.dockerignore',
];

function parseVersion(version) {
  if (typeof version !== 'string' || version.trim() !== version ||
      !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) {
    throw new Error(`Invalid release version: ${version}`);
  }
  return version.split('.').map(BigInt);
}

export function nextPatch(version) {
  const [major, minor, patch] = parseVersion(version);
  return `${major}.${minor}.${patch + 1n}`;
}

async function readVersions(directory) {
  const sources = await Promise.all(files.map(file => readFile(join(directory, file), 'utf8')));
  const english = await Promise.all(englishFiles.map(async file => {
    try { return await readFile(join(directory, file), 'utf8'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; return null; }
  }));
  if (english.includes(null) && english.some(text => text !== null)) throw new Error('Missing paired English release document.');
  const pkg = JSON.parse(sources[0]);
  const lock = JSON.parse(sources[1]);
  const versions = [pkg.version, lock.version, lock.packages?.['']?.version,
    ...sources.slice(2).map(source => source.match(declaration)?.[1]),
    ...english.filter(source => source !== null).map(source => source.match(englishDeclaration)?.[1])];
  versions.forEach(parseVersion);
  if (versions.some(version => version !== pkg.version)) {
    throw new Error('Release versions differ between package.json, package-lock.json, PRD and ROADMAP.');
  }
  return { sources, english, pkg, lock, version: pkg.version };
}

export async function checkVersions(directory = root) {
  return (await readVersions(directory)).version;
}

function updateDocument(source, version, date, summary, isPrd, english = false) {
  const lines = source.split('\n');
  const cells = line => line?.trim().replace(/^\||\|$/g, '').split('|').map(cell => cell.trim()) ?? [];
  const headers = english ? ['Version', 'Date', 'Change'] : isPrd ? ['版本', '日期', '修订人', '说明'] : ['版本', '日期', '变更'];
  const start = lines.findIndex(line => line.startsWith('|') && cells(line).join('|') === headers.join('|'));
  const separators = cells(lines[start + 1]);
  if (start < 0 || cells(lines[start]).join('|') !== headers.join('|') ||
      separators.length !== headers.length || separators.some(cell => !/^:?-{3,}:?$/.test(cell))) {
    throw new Error(`Missing or invalid release history in ${isPrd ? 'PRD' : 'ROADMAP'}.`);
  }
  let end = start + 2;
  while (lines[end]?.startsWith('|')) end++;
  const author = isPrd && !english ? ' 作者与实现代理 |' : '';
  lines.splice(end, 0, `| v${version} | ${date} |${author} ${summary} |`);
  if (english) {
    return lines.join('\n').replace(/^Version: v?[^\r\n]*/m, header =>
      header.replace(englishDeclaration, `Version: ${header.startsWith('Version: v') ? 'v' : ''}${version}`).replace(/Date: \d{4}-\d{2}-\d{2}/, `Date: ${date}`));
  }
  return lines.join('\n').replace(/^版本：v?[^\r\n]*/m, header =>
    header.replace(declaration, `版本：${header.startsWith('版本：v') ? 'v' : ''}${version}`).replace(/日期：\d{4}-\d{2}-\d{2}/, `日期：${date}`));
}

export async function bumpPatch(directory = root, { summary, summaryZh, date = new Date().toISOString().slice(0, 10) } = {}) {
  if ([summary, ...(summaryZh === undefined ? [] : [summaryZh])].some(value =>
    typeof value !== 'string' || !value.trim() || /[\r\n|]/.test(value))) {
    throw new Error('Provide a nonempty, single-line --summary without table delimiters.');
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date)) ||
      new Date(date).toISOString().slice(0, 10) !== date) {
    throw new Error('Release date must be a valid YYYY-MM-DD date.');
  }
  const { sources, english, pkg, lock, version } = await readVersions(directory);
  const next = nextPatch(version);
  // Prepare every change before writing, so invalid metadata cannot cause a partial update.
  const zh = (summaryZh ?? summary).trim();
  const englishUpdates = english.flatMap((source, i) => source === null ? [] : [
    [englishFiles[i], updateDocument(source, next, date, summary.trim(), i === 0, true)],
  ]);
  const prd = updateDocument(sources[2], next, date, zh, true);
  const roadmap = updateDocument(sources[3], next, date, zh, false);
  pkg.version = lock.version = lock.packages[''].version = next;
  for (const [file, content] of [
    ...englishUpdates, [files[2], prd], [files[3], roadmap],
    [files[0], `${JSON.stringify(pkg, null, 2)}\n`],
    [files[1], `${JSON.stringify(lock, null, 2)}\n`],
  ]) await writeFile(join(directory, file), content);
  return next;
}

function git(directory, ...args) {
  return execFileSync('git', args, { cwd: directory, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

export async function checkReleaseProgress(directory = root) {
  const version = await checkVersions(directory);
  let repository;
  try { repository = git(directory, 'rev-parse', '--show-toplevel'); } catch { return version; }
  if (await realpath(directory) !== await realpath(repository)) return version;
  let previous;
  try { previous = JSON.parse(git(directory, 'show', 'HEAD:package.json')).version; } catch { return version; }
  const currentParts = parseVersion(version);
  const previousParts = parseVersion(previous);
  const changed = git(directory, 'status', '--porcelain=v1', '-z', '--untracked-files=all', '--', ...ownedPaths);
  const firstDifference = currentParts.findIndex((part, index) => part !== previousParts[index]);
  if (firstDifference >= 0 && currentParts[firstDifference] < previousParts[firstDifference]) {
    throw new Error(`Release version must not decrease from ${previous} to ${version}.`);
  }
  if (changed && version === previous) {
    throw new Error('Praxis changed without a version increment. Run npm run version:patch -- --summary "Release summary".');
  }
  if (firstDifference === 2 && version !== nextPatch(previous)) {
    throw new Error(`Increment PATCH once per requirement: expected ${nextPatch(previous)}, received ${version}.`);
  }
  return version;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    const [command, ...args] = process.argv.slice(2);
    if (command === 'patch' && args[0] === '--summary' && (args.length === 2 || args.length === 4 && args[2] === '--summary-zh')) {
      console.log(`Version updated: v${await bumpPatch(root, { summary: args[1], summaryZh: args[3] })}`);
    } else if (command === 'check' && args.length === 0) {
      console.log(`Version check passed: v${await checkReleaseProgress(root)}`);
    } else {
      throw new Error('Usage: node scripts/version.mjs check | patch --summary "English release note" [--summary-zh "中文说明"]');
    }
  } catch (error) {
    console.error(`Version error: ${error.message}`);
    process.exitCode = 1;
  }
}
