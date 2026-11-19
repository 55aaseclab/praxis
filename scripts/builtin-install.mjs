import { randomBytes, randomUUID } from 'node:crypto';
import { access, chown, chmod, copyFile, lstat, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { AuthStore } from '../src/business/auth.mjs';
import { readApps } from '../src/apps.mjs';

const WORKSPACE_ROOT = fileURLToPath(new URL('../', import.meta.url));

const adapters = {
  reminder: 4322, knowledge: 14324, travel: 4323, projects: 4327,
  memo: 4325, tingproof: 15173, slides: 4328,
};
const apps = ['reminder', 'knowledge', 'travel', 'projects', 'memo', 'tingproof', 'slides', 'finance', 'intelligence', 'polaris', 'letters', 'profiles', 'web', 'slides-decks', 'slides-state', 'slides-exports'];

async function exists(file) {
  try { await access(file); return true; }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}
async function privateJson(file, value) {
  if (await exists(file)) {
    const info = await lstat(file);
    if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.mode & 0o077) throw new Error('A private runtime file is unsafe.');
    return JSON.parse(await readFile(file, 'utf8'));
  }
  await writeFile(file, JSON.stringify(value, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  return value;
}
async function mirrorKey(app, complete) {
  const core = '/config/keys/' + app + '.key';
  const native = '/app-config/' + app + '/key';
  let key;
  if (await exists(core)) key = await readFile(core);
  else if (await exists(native)) key = await readFile(native);
  else {
    if (complete) throw new Error('A service key is missing. Restore the private configuration backup.');
    key = randomBytes(48);
  }
  if (key.length < 32) throw new Error('Invalid service key.');
  for (const file of [core, native]) {
    if (await exists(file)) {
      if (!(await readFile(file)).equals(key)) throw new Error('Service keys differ. Restore a consistent configuration.');
    } else await writeFile(file, key, { mode: 0o600, flag: 'wx' });
  }
}
async function prepareVolumes() {
  const uid = Number(process.env.PRAXIS_UID || 1000), gid = Number(process.env.PRAXIS_GID || 1000);
  if (![uid, gid].every(id => Number.isSafeInteger(id) && id > 0 && id <= 2147483647)) throw new Error('Use a non-root service account UID and GID.');
  const roots = ['/config', '/data/core', ...apps.map(app => '/data/' + app),
    ...['web', ...Object.keys(adapters), 'finance', 'intelligence', 'polaris'].map(app => '/app-config/' + app)];
  for (const root of roots) {
    await mkdir(root, { recursive: true, mode: 0o700 });
    const info = await lstat(root);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('A runtime volume is invalid.');
    if (process.getuid?.() === 0 && info.uid === 0) {
      if ((await readdir(root)).length) throw new Error('A root-owned volume contains existing data. Use the recovery workflow.');
      await chown(root, uid, gid);
    } else if (info.uid !== uid || info.gid !== gid) throw new Error('A volume has another service owner. Restore the correct UID and GID.');
  }
  if (process.getuid?.() === 0) { process.setgid(gid); process.setuid(uid); }
}
export async function initializeBuiltins({ origin = process.env.PRAXIS_CANONICAL_URL || 'http://127.0.0.1:' + (process.env.PRAXIS_PORT || '4321'), username = process.env.PRAXIS_OWNER_USERNAME || 'owner' } = {}) {
  const url = new URL(origin);
  if (url.origin !== origin || url.username || url.password || !['http:', 'https:'].includes(url.protocol)
      || url.protocol === 'http:' && !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) {
    throw new Error('Use an HTTPS origin or a loopback HTTP origin.');
  }
  await prepareVolumes();
  const complete = await exists('/config/initialized.json');
  if (!await exists('/config/installation.json')) {
    for (const app of ['core', ...apps]) {
      if ((await readdir('/data/' + app)).length) throw new Error('Existing application data needs its original installation configuration. Restore it before startup.');
    }
    if ((await readdir('/config')).length) throw new Error('Existing private configuration requires recovery.');
  }
  if (!await exists('/config/core.json') && await exists('/config/business.json')) {
    await copyFile('/config/business.json', '/config/core.json');
    await chmod('/config/core.json', 0o600);
  }
  if (complete) {
    for (const file of ['/config/installation.json', '/config/owner.json', '/config/core.json']) {
      if (!await exists(file)) throw new Error('Installation configuration is missing. Restore the private backup.');
    }
  }
  const installation = await privateJson('/config/installation.json', {
    version: 1, origin, ownerId: randomUUID(), spaceId: randomUUID(), workspaceId: randomUUID(),
  });
  if (installation.version !== 1 || installation.origin !== origin) throw new Error('The installation origin changed. Use the documented migration procedure.');
  await mkdir('/config/keys', { recursive: true, mode: 0o700 });
  if (complete) {
    const required = ['/app-config/web/installation.json'];
    for (const app of [...Object.keys(adapters), 'finance', 'intelligence', 'polaris']) required.push('/app-config/' + app + '/runtime.json');
    for (const app of ['reminder', 'knowledge', 'projects', 'travel', 'slides']) required.push('/app-config/' + app + '/spaces.json');
    for (const file of required) if (!await exists(file)) throw new Error('Application configuration is missing. Restore the private backup.');
  }
  const credentials = await privateJson('/config/owner.json', {
    username, password: randomBytes(24).toString('base64url'), loginUrl: origin + '/auth/login',
  });
  const { spaceId, ownerId, workspaceId } = installation;
  for (const app of ['core', ...apps]) {
    const marker = '/data/' + app + '/.praxis-volume.json';
    if (complete && !await exists(marker)) throw new Error('An application volume is missing. Restore its original data.');
    const binding = await privateJson(marker, { workspaceId, app });
    if (binding.workspaceId !== workspaceId || binding.app !== app) throw new Error('A volume belongs to another installation.');
  }
  const config = {
    issuer: origin, database: '/data/core/auth.db', eventsDatabase: '/data/core/events.db',
    observationsFile: '/data/core/observations.db',
    allowedHosts: [url.host, '127.0.0.1:4326', 'localhost:4326'],
    allowedOrigins: [origin], webGateway: { enabled: true, originHost: 'localhost' },
    apps: Object.fromEntries(Object.entries(adapters).map(([app, port]) => [app, {
      url: 'http://127.0.0.1:' + port + '/api/business',
      keyFile: '/config/keys/' + app + '.key', spaces: [spaceId], managed: true,
    }])),
  };
  for (const app of Object.keys(adapters)) await mirrorKey(app, complete);
  await privateJson('/config/core.json', config);
  await privateJson('/app-config/web/installation.json', installation);
  const runtime = {
    reminder: { REMINDER_MANAGED: '1', REMINDER_BUSINESS_KEY_FILE: '/config/key', REMINDER_BUSINESS_SPACES_FILE: '/config/spaces.json', REMINDER_BUSINESS_UI_URL: origin + '/business/reminder/' },
    knowledge: { KNOWLEDGE_MANAGED: '1', KNOWLEDGE_ADAPTER_KEY_FILE: '/config/key', KNOWLEDGE_BUSINESS_CONFIG: '/config/spaces.json', KNOWLEDGE_DATA_DIR: '/data/knowledge', KNOWLEDGE_INBOX_ROOT: '/data/knowledge/inbox', KNOWLEDGE_BASE_PATH: '/apps/knowledge/' },
    travel: { TRAVEL_DATA_DIR: '/data/travel', TRAVEL_BUSINESS_KEY_FILE: '/config/key', TRAVEL_BUSINESS_CONFIG_FILE: '/config/spaces.json' },
    projects: { PROJECTS_MANAGED: '1', PROJECTS_BUSINESS_KEY_FILE: '/config/key', PROJECTS_BUSINESS_CONFIG_FILE: '/config/spaces.json', PROJECTS_DATA_DIR: '/data/projects', PROJECTS_KNOWLEDGE_BASE_URL: '/apps/knowledge/' },
    memo: { MEMO_DATA_DIR: '/data/memo', MEMO_BUSINESS_KEY_FILE: '/config/key', MEMO_SPACE_IDS: spaceId },
    tingproof: { TINGPROOF_LEGACY_SPACE_ID: spaceId, TINGPROOF_MANAGED: '0', TINGPROOF_BUSINESS_KEY_FILE: '/config/key', TINGPROOF_DATA_DIR: '/data/tingproof' },
    finance: { FINANCE_DATA: '/data/finance/finance.json', FINANCE_ALLOWED_ORIGINS: origin },
    intelligence: { INTELLIGENCE_DATA_DIR: '/data/intelligence', INTELLIGENCE_PREVIEW: '0' },
    polaris: { POLARIS_OBSERVATIONS_FILE: '/data/polaris/observations.json', PRAXIS_WORKSPACE_ID: workspaceId },
    slides: { HOME: '/data/slides/home', XDG_CACHE_HOME: '/data/slides/cache', SLIDES_BUSINESS_KEY_FILE: '/config/key', SLIDES_BUSINESS_SPACES_FILE: '/config/spaces.json', SLIDES_BUSINESS_AUTHORIZATION_URL: 'http://127.0.0.1:4326/api/business/slides/authorize-job', SLIDES_BUSINESS_AUTHORIZATION_HOST: url.host },
  };
  const maps = {
    reminder: { spaces: { [spaceId]: '/data/reminder/checklist.json' } },
    knowledge: { version: 1, spaces: [spaceId] },
    projects: { version: 1, spaces: [spaceId] },
    travel: { version: 1, webSpace: spaceId, spaces: { [spaceId]: [] } },
    slides: { version: 1, spaces: { [spaceId]: '/data/slides/slides.json' } },
  };
  for (const [app, env] of Object.entries(runtime)) {
    await privateJson('/app-config/' + app + '/runtime.json', env);
    if (maps[app]) await privateJson('/app-config/' + app + '/spaces.json', maps[app]);
  }
  for (const app of ['letters', 'profiles']) {
    const directory = '/data/' + app + '/documents';
    if (complete && !await exists(directory)) throw new Error('A private document directory is missing. Restore its original data.');
    await mkdir(directory, { recursive: true, mode: 0o700 });
  }
  for (const file of ['/data/intelligence/data.json', '/data/polaris/observations.json']) {
    if (complete && !await exists(file)) throw new Error('Application data is missing. Restore its original snapshot.');
  }
  await privateJson('/data/intelligence/data.json', {
    schemaVersion: 1, preview: false, updatedAt: new Date().toISOString(),
    collections: [{ id: 'inbox', title: 'Inbox', description: 'Incoming materials', domain: 'mixed', monitoringState: 'not_configured' }],
    materials: [], objects: [], events: [],
  });
  await privateJson('/data/polaris/observations.json', { workspaceId, packs: [], runs: [], graphs: [], events: {} });
  if (!complete) {
    const auth = new AuthStore({ file: config.database, issuer: origin });
    try {
      const user = auth.db.prepare('SELECT id FROM auth_users WHERE id=?').get(ownerId);
      if (!user) auth.createUser({ id: ownerId, username: credentials.username, password: credentials.password });
      const space = auth.db.prepare('SELECT id FROM auth_spaces WHERE id=?').get(spaceId);
      if (!space) auth.createSpace({ id: spaceId, type: 'personal', ownerId });
      auth.setPlatformAdmin({ userId: ownerId, enabled: true });
      const catalog = await readApps(WORKSPACE_ROOT, { publicUrlsFile: null });
      auth.setWebAccess({ userId: ownerId, apps: catalog.map(app => app.id).filter(id => !['letters', 'profiles', 'polaris'].includes(id)), workbench: true, prds: true });
    } finally { auth.close(); }
    await privateJson('/config/initialized.json', { version: 1, initializedAt: new Date().toISOString() });
  }
  return { workspaceId, status: 'ready' };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (process.argv[2] === 'credentials') console.log(await readFile('/config/owner.json', 'utf8'));
    else console.log(JSON.stringify(await initializeBuiltins()));
  } catch (error) {
    console.error('Installation initialization failed: ' + error.message);
    process.exitCode = 1;
  }
}
