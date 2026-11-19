import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { bumpPatch, checkReleaseProgress, checkVersions, nextPatch } from '../scripts/version.mjs';

const runFile = promisify(execFile);
const releaseFiles = ['package.json', 'package-lock.json', 'docs/PRD.md', 'docs/ROADMAP.md'];
const preservedFiles = ['third_party/example/docs/PRD.md', 'artifacts/synthetic-report.txt'];
const previousDate = '2026-01-02';
const releaseDate = '2026-11-11';

async function put(root, source, content) {
  const file = join(root, source);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, content);
}

function document(version, kind) {
  const history = kind === 'PRD'
    ? '| 版本 | 日期 | 修订人 | 说明 |\n|---|---|---|---|\n| v0.1.0 | 2025-12-01 | Synthetic author | Original scope |\n'
    : '| 版本 | 日期 | 变更 |\n|---|---|---|\n| v0.1.0 | 2025-12-01 | Original milestones |\n';
  return `# Synthetic ${kind}\n\n版本：v${version} · 日期：${previousDate} · Synthetic owner\n\n${history}\n## Preserved scope\n\nHistorical v${version} on ${previousDate} remains unchanged.\n`;
}

async function fixture(t, version = '0.1.9') {
  const root = await mkdtemp(join(tmpdir(), 'praxis-version-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const packageJson = {
    name: 'synthetic-praxis',
    version,
    private: true,
    dependencies: { 'synthetic-dependency': version },
  };
  const packageLock = {
    name: packageJson.name,
    version,
    lockfileVersion: 3,
    requires: true,
    packages: {
      '': { name: packageJson.name, version, dependencies: packageJson.dependencies },
      'node_modules/synthetic-dependency': {
        version,
        resolved: 'https://example.invalid/synthetic-dependency.tgz',
        integrity: 'sha512-synthetic-fixture',
      },
    },
  };
  await put(root, 'package.json', `${JSON.stringify(packageJson, null, 2)}\n`);
  await put(root, 'package-lock.json', `${JSON.stringify(packageLock, null, 2)}\n`);
  await put(root, 'docs/PRD.md', document(version, 'PRD'));
  await put(root, 'docs/ROADMAP.md', document(version, 'ROADMAP'));
  await put(root, preservedFiles[0], `# Synthetic independent app\n\n版本：v${version}\n`);
  await put(root, preservedFiles[1], Buffer.from([0, 255, 10, 13, 42]));
  return root;
}

async function snapshot(root) {
  return Promise.all([...releaseFiles, ...preservedFiles].map(source => readFile(join(root, source))));
}

async function rewriteJson(root, source, mutate) {
  const value = JSON.parse(await readFile(join(root, source), 'utf8'));
  mutate(value);
  await put(root, source, `${JSON.stringify(value, null, 2)}\n`);
}

async function git(root, ...args) {
  const { stdout } = await runFile('git', args, {
    cwd: root,
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' },
  });
  return stdout;
}

async function gitFixture(t, version = '0.1.9') {
  const root = await fixture(t, version);
  await git(root, '-c', 'init.defaultBranch=main', 'init', '--template=');
  await git(root, 'add', '.');
  await git(root,
    '-c', 'core.hooksPath=/dev/null',
    '-c', 'user.name=Synthetic test',
    '-c', 'user.email=synthetic@example.invalid',
    '-c', 'commit.gpgsign=false',
    'commit', '-qm', 'Synthetic release baseline');
  return root;
}

async function setVersion(root, version) {
  await rewriteJson(root, 'package.json', value => { value.version = version; });
  await rewriteJson(root, 'package-lock.json', value => {
    value.version = version;
    value.packages[''].version = version;
  });
  for (const source of releaseFiles.slice(2)) {
    const content = await readFile(join(root, source), 'utf8');
    await put(root, source, content.replace(/^版本：v[^\s]+/m, `版本：v${version}`));
  }
}

test('patch increments use numeric components without losing integer precision', () => {
  assert.equal(nextPatch('0.0.0'), '0.0.1');
  assert.equal(nextPatch('0.1.9'), '0.1.10');
  assert.equal(nextPatch('12.34.99'), '12.34.100');
  assert.equal(nextPatch('9007199254740993.9007199254740995.9007199254740997'),
    '9007199254740993.9007199254740995.9007199254740998');
});

test('patch increments reject malformed or noncanonical simple SemVer', () => {
  for (const version of [undefined, null, 109, '', '0.1', '0.1.2.3', 'v0.1.9', '00.1.9',
    '0.01.9', '0.1.09', '-1.1.9', '0.1.-9', '0.1.9-beta.1', '0.1.9+build',
    ' 0.1.9', '0.1.9 ', '0.1.9\n', '0.1.9\r', '0.1.9suffix']) {
    assert.throws(() => nextPatch(version), `Invalid version accepted: ${String(version)}`);
  }
});

test('current Praxis package, lockfile and document versions agree', async () => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  assert.equal(await checkVersions(root), manifest.version);
});

test('patch bump synchronizes all five versions and preserves historical and independent bytes', async (t) => {
  const root = await fixture(t);
  const before = await snapshot(root);
  const summary = 'Synthetic numeric version correction';
  assert.equal(await checkVersions(root), '0.1.9');
  assert.equal(await bumpPatch(root, { summary, date: releaseDate }), '0.1.10');
  assert.equal(await checkVersions(root), '0.1.10');
  const after = await snapshot(root);
  assert.equal(after[0].toString(), before[0].toString().replace('"version": "0.1.9"', '"version": "0.1.10"'));
  assert.equal(after[1].toString(), before[1].toString()
    .replace('"version": "0.1.9"', '"version": "0.1.10"')
    .replace('"version": "0.1.9"', '"version": "0.1.10"'));
  const manifest = JSON.parse(after[0]);
  const lock = JSON.parse(after[1]);
  assert.equal(manifest.version, '0.1.10');
  assert.equal(lock.version, '0.1.10');
  assert.equal(lock.packages[''].version, '0.1.10');
  assert.equal(manifest.dependencies['synthetic-dependency'], '0.1.9');
  assert.equal(lock.packages['node_modules/synthetic-dependency'].version, '0.1.9');
  for (let index = 2; index < 4; index++) {
    const content = after[index].toString();
    assert.match(content, /^版本：v0\.1\.10 · 日期：2026-11-11 · Synthetic owner$/m);
    const newRows = content.split('\n').filter(line => line.startsWith('| v0.1.10 |'));
    assert.equal(newRows.length, 1);
    assert.ok(newRows[0].includes(`| ${releaseDate} |`));
    assert.ok(newRows[0].includes(summary));
    const originalHistoryRows = before[index].toString().split('\n').filter(line => line.startsWith('|'));
    for (const line of originalHistoryRows) assert.ok(content.includes(`${line}\n`), line);
    assert.ok(content.indexOf('| v0.1.0 |') < content.indexOf('| v0.1.10 |'));
    assert.ok(content.includes(`Historical v0.1.9 on ${previousDate} remains unchanged.`));
  }
  assert.deepEqual(after.slice(4), before.slice(4));
});

test('invalid summaries fail before any release file is written', async (t) => {
  for (const summary of [undefined, null, 17, '', '   ', 'Line one\nLine two', 'Line one\rLine two', 'A | B']) {
    await t.test(`rejects ${JSON.stringify(summary)}`, async (t) => {
      const root = await fixture(t);
      const before = await snapshot(root);
      await assert.rejects(bumpPatch(root, { summary, date: releaseDate }));
      assert.deepEqual(await snapshot(root), before);
    });
  }
});

test('invalid release dates fail before any release file is written', async (t) => {
  const root = await fixture(t);
  const before = await snapshot(root);
  for (const date of ['2026-02-30', '2026-1-02', 'not-a-date']) {
    await assert.rejects(bumpPatch(root, { summary: 'Synthetic correction', date }));
    assert.deepEqual(await snapshot(root), before);
  }
});

test('CLI validates arguments and reports the synchronized release in an isolated workspace', async (t) => {
  const root = await fixture(t);
  const script = join(root, 'scripts/version.mjs');
  await put(root, 'scripts/version.mjs', await readFile(new URL('../scripts/version.mjs', import.meta.url)));
  const before = await snapshot(root);
  for (const args of [['patch', '--summary'], ['patch', '--summary', 'Invalid | table value'], ['unknown']]) {
    await assert.rejects(runFile(process.execPath, [script, ...args], { cwd: root }), error => {
      assert.equal(error.code, 1);
      assert.match(error.stderr, /Version error:/);
      return true;
    });
    assert.deepEqual(await snapshot(root), before);
  }
  const result = await runFile(process.execPath, [script, 'patch', '--summary', 'Synthetic CLI correction'], { cwd: root });
  assert.match(result.stdout, /Version updated: v0\.1\.10/);
  assert.equal(await checkVersions(root), '0.1.10');
});

test('each inconsistent version source fails validation and leaves all bytes untouched', async (t) => {
  const cases = [
    ['package version', root => rewriteJson(root, 'package.json', value => { value.version = '0.1.8'; })],
    ['lockfile version', root => rewriteJson(root, 'package-lock.json', value => { value.version = '0.1.8'; })],
    ['lockfile root package version', root => rewriteJson(root, 'package-lock.json', value => { value.packages[''].version = '0.1.8'; })],
    ['missing lockfile root package', root => rewriteJson(root, 'package-lock.json', value => { delete value.packages['']; })],
    ['invalid package version', root => rewriteJson(root, 'package.json', value => { value.version = '0.1.09'; })],
    ...releaseFiles.slice(2).map(source => [source, async root => {
      const content = await readFile(join(root, source), 'utf8');
      await put(root, source, content.replace('版本：v0.1.9', '版本：v0.1.8'));
    }]),
  ];
  for (const [name, mutate] of cases) {
    await t.test(name, async (t) => {
      const root = await fixture(t);
      await mutate(root);
      const before = await snapshot(root);
      await assert.rejects(checkVersions(root));
      await assert.rejects(bumpPatch(root, { summary: 'Synthetic correction', date: releaseDate }));
      assert.deepEqual(await snapshot(root), before);
    });
  }
});

test('missing current headers or malformed history tables abort the entire bump before writes', async (t) => {
  const mutations = [
    ['current version header', content => content.replace(/^版本：.*\n/m, '')],
    ['version history header', content => content.replace(/^\| 版本 \| 日期 .*\n/m, '')],
    ['history separator', content => content.replace(/^\|---\|.*\n/m, '')],
    ['malformed history separator', content => content.replace(/^\|---\|.*\n/m, '| invalid | separator |\n')],
  ];
  for (const source of releaseFiles.slice(2)) {
    for (const [name, mutate] of mutations) {
      await t.test(`${source}: ${name}`, async (t) => {
        const root = await fixture(t);
        await put(root, source, mutate(await readFile(join(root, source), 'utf8')));
        const before = await snapshot(root);
        await assert.rejects(bumpPatch(root, { summary: 'Synthetic correction', date: releaseDate }));
        assert.deepEqual(await snapshot(root), before);
      });
    }
  }
});

test('clean Git workspaces pass release progress checks without any Git mutation', async (t) => {
  const root = await gitFixture(t);
  const head = await git(root, 'rev-parse', 'HEAD');
  const before = await snapshot(root);
  assert.equal(await checkReleaseProgress(root), '0.1.9');
  assert.equal(await git(root, 'status', '--porcelain'), '');
  assert.equal(await git(root, 'rev-parse', 'HEAD'), head);
  assert.deepEqual(await snapshot(root), before);
});

test('third-party and artifact changes do not require a Praxis release', async (t) => {
  const root = await gitFixture(t);
  await put(root, preservedFiles[0], '# Updated synthetic independent application\n');
  await put(root, preservedFiles[1], 'Updated synthetic artifact\n');
  await put(root, 'third_party/another-app/source.mjs', '// Synthetic third-party source\n');
  await put(root, 'artifacts/new-report.txt', 'Synthetic artifact\n');
  const status = await git(root, 'status', '--porcelain');
  assert.notEqual(status, '');
  assert.equal(await checkReleaseProgress(root), '0.1.9');
  assert.equal(await git(root, 'status', '--porcelain'), status);
});

test('unversioned Praxis source, documentation, test and configuration changes are rejected', async (t) => {
  const root = await gitFixture(t);
  const sources = ['src/synthetic.mjs', 'docs/synthetic.md', 'public/synthetic asset.txt',
    'scripts/synthetic.mjs', 'tests/synthetic.test.mjs', 'config/synthetic.json',
    'infra/synthetic.conf', 'skills/synthetic/SKILL.md', 'README.md', 'AGENTS.md',
    'paseo.json', '.gitignore', '.gitmodules', 'Dockerfile', 'Dockerfile.storage', 'compose.yaml', 'compose.storage.yaml', '.dockerignore'];
  for (const source of sources) {
    await t.test(source, async () => {
      await put(root, source, 'Synthetic root change\n');
      try {
        await assert.rejects(checkReleaseProgress(root));
      } finally {
        await rm(join(root, source));
      }
    });
  }
  for (const source of releaseFiles.slice(0, 2)) {
    await t.test(source, async () => {
      const original = await readFile(join(root, source));
      await put(root, source, `${original.toString()}\n`);
      try {
        await assert.rejects(checkReleaseProgress(root));
      } finally {
        await put(root, source, original);
      }
    });
  }
});

test('one patch bump satisfies staged changes while preserving HEAD and the index', async (t) => {
  const root = await gitFixture(t);
  await put(root, 'src/synthetic.mjs', '// Synthetic staged requirement\n');
  await git(root, 'add', 'src/synthetic.mjs');
  const head = await git(root, 'rev-parse', 'HEAD');
  const staged = await git(root, 'diff', '--cached', '--binary');
  await assert.rejects(checkReleaseProgress(root));
  assert.equal(await bumpPatch(root, { summary: 'Synthetic staged requirement', date: releaseDate }), '0.1.10');
  assert.equal(await checkReleaseProgress(root), '0.1.10');
  assert.equal(await checkReleaseProgress(root), '0.1.10');
  assert.equal(await git(root, 'rev-parse', 'HEAD'), head);
  assert.equal(await git(root, 'diff', '--cached', '--binary'), staged);
  assert.equal(await git(root, 'tag', '--list'), '');
});

test('release progress rejects skipped patches and all lower release versions', async (t) => {
  for (const version of ['0.1.11', '0.1.8', '0.0.10']) {
    await t.test(version, async (t) => {
      const root = await gitFixture(t);
      await setVersion(root, version);
      assert.equal(await checkVersions(root), version);
      await assert.rejects(checkReleaseProgress(root));
    });
  }
});

test('release progress allows explicitly planned minor or major versions', async (t) => {
  for (const version of ['0.2.0', '1.0.0']) {
    await t.test(version, async (t) => {
      const root = await gitFixture(t);
      await setVersion(root, version);
      assert.equal(await checkReleaseProgress(root), version);
    });
  }
});

test('paired release editions validate together and record the two supplied release notes', async t => {
  const root = await fixture(t);
  const english = '# English requirements\n\nVersion: v0.1.9 · Date: 2026-01-02\n\n| Version | Date | Change |\n| --- | --- | --- |\n| v0.1.9 | 2026-01-02 | Previous note |\n';
  await put(root, 'docs/PRD.en.md', english);
  await assert.rejects(checkVersions(root), /paired English/);
  await put(root, 'docs/ROADMAP.en.md', english);
  assert.equal(await bumpPatch(root, { summary: 'New controls', summaryZh: '新增控件', date: releaseDate }), '0.1.10');
  assert.equal(await checkVersions(root), '0.1.10');
  for (const name of ['PRD', 'ROADMAP']) {
    const en = await readFile(join(root, 'docs/' + name + '.en.md'), 'utf8');
    const zh = await readFile(join(root, 'docs/' + name + '.md'), 'utf8');
    assert.match(en, /Version: v0\.1\.10 · Date: 2026-11-11/);
    assert.match(en, /Previous note/);
    assert.match(en, /v0\.1\.10 \| 2026-11-11 \| New controls/);
    assert.match(zh, /新增控件/);
  }
});

test('restored bilingual headers without a v prefix retain their spelling and historical rows', async t => {
  const root = await fixture(t, '0.1.111');
  for (const name of ['PRD', 'ROADMAP']) {
    const file = 'docs/' + name + '.md';
    const text = await readFile(join(root, file), 'utf8');
    await put(root, file, text.replace('版本：v0.1.111', '版本：0.1.111'));
    await put(root, 'docs/' + name + '.en.md', '# Synthetic English ' + name + '\n\nVersion: 0.1.111 · [简体中文](' + name + '.md)\n\n| Version | Date | Change |\n| --- | --- | --- |\n| v0.1.0 | 2025-12-01 | Original release |\n');
  }
  assert.equal(await checkVersions(root), '0.1.111');
  assert.equal(await bumpPatch(root, { summary: 'Restore version synchronization', summaryZh: '恢复版本同步', date: releaseDate }), '0.1.112');
  for (const name of ['PRD', 'ROADMAP']) {
    const english = await readFile(join(root, 'docs/' + name + '.en.md'), 'utf8');
    const chinese = await readFile(join(root, 'docs/' + name + '.md'), 'utf8');
    assert.match(english, /Version: 0\.1\.112/);
    assert.match(chinese, /版本：0\.1\.112/);
    assert.match(english, /Original release/);
    assert.match(english, /v0\.1\.112 .*Restore version synchronization/);
    assert.match(chinese, /v0\.1\.112 .*恢复版本同步/);
  }
});
