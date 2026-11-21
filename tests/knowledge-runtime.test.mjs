import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DEFAULT_APP_REGISTRY } from '../src/default-app-registry.mjs';
const { resolveKnowledgeRuntime, knowledgeComposeService } = await import(pathToFileURL(join(DEFAULT_APP_REGISTRY.root, DEFAULT_APP_REGISTRY.getApp('knowledge').source, 'praxis/stack.mjs')).href);

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'praxis-knowledge-runtime-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const dataDir = join(root, 'data'), secrets = join(root, 'secrets');
  await mkdir(dataDir, { mode: 0o700 }); await mkdir(secrets, { mode: 0o700 });
  const keyFile = join(secrets, 'key'), businessConfigFile = join(secrets, 'mapping.json');
  await writeFile(keyFile, 'synthetic-key-material-32-bytes-long', { mode: 0o600 });
  await writeFile(businessConfigFile, JSON.stringify({ version: 1, spaces: ['synthetic-space'] }), { mode: 0o600 });
  const app = { url: 'http://127.0.0.1:14324/api/business', spaces: ['synthetic-space'], dataDir, keyFile, businessConfigFile };
  const options = { uid: process.getuid(), workspace: join(root, 'source') };
  return { root, app, options };
}

test('Knowledge mounts only its private directory and exact read-only control files', async t => {
  const f = await fixture(t), runtime = await resolveKnowledgeRuntime(f.app, f.options);
  const service = knowledgeComposeService(runtime);
  assert.equal(service.environment.KNOWLEDGE_MANAGED, '1');
  assert.equal(service.volumes.length, 3);
  assert.deepEqual(service.volumes.map(volume => volume.read_only), [false, true, true]);
  assert.equal(service.volumes.every(volume => volume.bind.create_host_path === false), true);
  assert.equal(JSON.stringify(service).includes(await readFile(f.app.keyFile, 'utf8')), false);
  assert.equal(await resolveKnowledgeRuntime(undefined, f.options), null);
});

test('Knowledge rejects wrong endpoints, mismatched spaces, shared data and unsafe controls', async t => {
  const f = await fixture(t);
  await assert.rejects(resolveKnowledgeRuntime({ ...f.app, url: 'http://remote.example/api/business' }, f.options));
  await assert.rejects(resolveKnowledgeRuntime({ ...f.app, spaces: ['different-space'] }, f.options), /match/);
  await assert.rejects(resolveKnowledgeRuntime(f.app, { ...f.options, protectedPaths: [f.app.dataDir] }), /separate/);
  await assert.rejects(resolveKnowledgeRuntime({ ...f.app, businessConfigFile: f.app.keyFile }, f.options), /separate/);
  await chmod(f.app.keyFile, 0o644);
  await assert.rejects(resolveKnowledgeRuntime(f.app, f.options), /mode600/);
  await chmod(f.app.keyFile, 0o600);
  const alias = join(f.root, 'alias'); await symlink(f.app.dataDir, alias);
  await assert.rejects(resolveKnowledgeRuntime({ ...f.app, dataDir: alias }, f.options), /mode700/);
  await chmod(f.app.dataDir, 0o755);
  await assert.rejects(resolveKnowledgeRuntime(f.app, f.options), /mode700/);
});

test('Knowledge content binding overrides image defaults and stays read-only', async t => {
  const f = await fixture(t), runtime = await resolveKnowledgeRuntime(f.app, f.options);
  const root = join(f.root, 'external-content');
  const service = knowledgeComposeService(runtime, { contentRoot: root });
  assert.equal(service.environment.KNOWLEDGE_CONTENT_ROOT, '/data/content');
  assert.equal(service.environment.KNOWLEDGE_STATIC_DIR, '/data/content/published');
  assert.deepEqual(service.volumes.at(-1), { type: 'bind', source: root, target: '/data/content', read_only: true, bind: { create_host_path: false } });
  assert.equal(service.volumes[0].source, f.app.dataDir);
});

test('attachment delivery mounts a dedicated inbox or a single source scoped to its library', async t => {
  const f = await fixture(t);
  const attachmentInbox = join(f.root, 'incoming'), file = join(f.root, 'book.epub');
  await mkdir(attachmentInbox, {mode: 0o700});
  await writeFile(file, 'synthetic');
  const sha256 = 'a'.repeat(64);
  const attachments = [{ file, sha256, resourceId: 'private', spaceId: 'synthetic-space' }];
  const runtime = await resolveKnowledgeRuntime({ ...f.app, attachments }, f.options);
  const service = knowledgeComposeService(runtime);
  assert.equal(service.environment.KNOWLEDGE_INBOX_ROOT, '/run/knowledge-inbox');
  assert.ok(service.volumes.some(v => v.read_only && v.source === file && v.target === '/run/knowledge-inbox/synthetic-space/private/' + sha256));
  const inboxService = knowledgeComposeService(await resolveKnowledgeRuntime({ ...f.app, attachmentInbox }, f.options));
  assert.ok(inboxService.volumes.some(v => v.read_only && v.source === attachmentInbox));
  await assert.rejects(resolveKnowledgeRuntime({ ...f.app, attachmentInbox: f.root }, f.options));
  await assert.rejects(resolveKnowledgeRuntime({ ...f.app, attachments: [{ ...attachments[0], spaceId: 'another' }] }, f.options));
});

const knowledgeSource = join(DEFAULT_APP_REGISTRY.root, DEFAULT_APP_REGISTRY.getApp('knowledge').source);
const publicAsset = async name => readFile(join(knowledgeSource, 'src/runtime/public', name), 'utf8');

test('the pinned Knowledge UI follows the workbench language preference with no in-app toggle', async () => {
  const html = await publicAsset('index.html');
  assert.doesNotMatch(html, /id="language"|data-language-preference|<button[^>]*>简体中文</);
  const script = await publicAsset('app.js');
  assert.doesNotMatch(script, /#language|data-language-preference|t\("Contents", "内容目录"\)/);
  assert.match(script, /praxis\.locale/);
  const styles = await publicAsset('styles.css');
  assert.doesNotMatch(styles, /#language/);
});

const browserEnabled = Boolean(process.env.PLAYWRIGHT_MODULE);
const knowledgeRuntime = await Promise.all([
  import(pathToFileURL(join(knowledgeSource, 'src/runtime/store.mjs')).href),
  import(pathToFileURL(join(knowledgeSource, 'src/runtime/server.mjs')).href),
]);

test('Chromium Knowledge overview has no stray contents label and follows the workbench locale', { skip: !browserEnabled, timeout: 60000 }, async t => {
  const { KnowledgeStore } = knowledgeRuntime[0], { createServer } = knowledgeRuntime[1];
  const root = await mkdtemp(join(tmpdir(), 'praxis-knowledge-ui-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = new KnowledgeStore(join(root, 'knowledge.db'), { basePath: '/' });
  t.after(() => store.close());
  const claims = { spaceId: 'local', action: 'create', resources: ['synthetic-library'], expiresAt: Date.now() + 60000, userId: 'synthetic', clientId: 'synthetic', grantId: 'synthetic', requestId: 'seed-1' };
  store.execute({ operation: 'create_library', spaceId: 'local', resourceId: 'synthetic-library', input: { name: 'Synthetic Library', description: 'Synthetic fixture' }, idempotencyKey: 'seed-create' }, claims);
  store.execute({ operation: 'add_source', spaceId: 'local', resourceId: 'synthetic-library', expectedRevision: '1', input: { id: 'synthetic-source', title: 'Synthetic source', kind: 'text', text: 'Synthetic source text.' }, idempotencyKey: 'seed-source' }, { ...claims, action: 'update', requestId: 'seed-2' });
  store.execute({ operation: 'set_entry', spaceId: 'local', resourceId: 'synthetic-library', expectedRevision: '2', input: { id: 'synthetic-entry', kind: 'note', title: 'Synthetic entry', status: 'published', body: '# Overview heading\n\nSynthetic body.\n\n## Details\n\nMore text.', tags: [], sourceRefs: [{ sourceId: 'synthetic-source', locator: 'p.1' }] }, idempotencyKey: 'seed-entry' }, { ...claims, action: 'update', requestId: 'seed-3' });
  const server = createServer({ store, localSpace: 'local', basePath: '/' });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const { chromium } = await import(process.env.PLAYWRIGHT_MODULE);
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE, args: ['--no-sandbox'] });
  t.after(async () => browser.close());
  for (const locale of ['zh', 'en']) for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    await context.addInitScript(value => localStorage.setItem('praxis.locale', value), locale);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(base + '/');
    await page.waitForSelector('#library-content:not([hidden])', { timeout: 10000 });
    assert.equal(await page.locator('#language,[data-language-preference]').count(), 0, 'no in-app language control');
    assert.equal(await page.evaluate(() => document.documentElement.lang), locale === 'zh' ? 'zh-CN' : 'en', 'follows the workbench preference');
    const sidebar = await page.locator('#libraries').innerText();
    assert.ok(sidebar.includes(locale === 'zh' ? '知识概览' : 'Library overview'), 'overview entry renders');
    assert.ok(!sidebar.includes('内容目录') && !sidebar.includes('Contents'), `no literal contents label at ${locale}`);
    assert.ok((await page.locator('#libraries .content-nav-entry').count()) >= 1, 'the content directory still lists entries');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true, `no horizontal overflow at ${width} px`);
    await page.locator('#libraries .content-nav-entry').first().click();
    await page.waitForSelector('#reader:not([hidden])', { timeout: 10000 });
    assert.equal(await page.locator('#reader-outline').isHidden(), false, 'the reading view keeps its page outline');
    await context.close();
    assert.deepEqual(errors, []);
  }
});
