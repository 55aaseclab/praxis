#!/usr/bin/env node
import { mkdir, readFile, writeFile, lstat, access } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { homedir } from 'node:os';
import { randomBytes, randomUUID } from 'node:crypto';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { AuthStore, WEB_APP_IDS } from '../src/business/auth.mjs';
import { loadBusinessConfig, DEFAULT_BUSINESS_CONFIG } from '../src/business/config.mjs';
import { assertOutsideWorkspace } from '../src/storage/config.mjs';

async function privateWrite(file, value) {
  file = resolve(file); assertOutsideWorkspace(file);
  await mkdir(dirname(file), { recursive: true, mode: 0o700 });
  await writeFile(file, typeof value === 'string' || Buffer.isBuffer(value) ? value : `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
  return file;
}
export async function initializeBusiness({ file = DEFAULT_BUSINESS_CONFIG, issuer, reminderData, stateRoot = resolve(homedir(), '.local/share/praxis/business'), username = 'owner' }) {
  file = resolve(file); stateRoot = resolve(stateRoot); assertOutsideWorkspace(file); assertOutsideWorkspace(stateRoot);
  try { await access(file); throw new Error('Business configuration already exists; nothing was overwritten.'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const url = new URL(issuer); if (url.pathname !== '/' || url.search || url.hash) throw new Error('Issuer must be an origin without a path.');
  if (!reminderData || !resolve(reminderData).startsWith('/')) throw new Error('An explicit Reminder data mapping is required.');
  const ownerId = randomUUID(), spaceId = randomUUID(), password = randomBytes(24).toString('base64url');
  const secretRoot = resolve(dirname(file), 'secrets');
  const reminderKey = resolve(secretRoot, 'business-reminder.key'), tingproofKey = resolve(secretRoot, 'business-tingproof.key');
  const spacesFile = resolve(dirname(file), 'reminder-business-spaces.json');
  await mkdir(stateRoot, { recursive: true, mode: 0o700 });
  const config = {
    issuer: url.origin, database: resolve(stateRoot, 'auth.db'), eventsDatabase: resolve(stateRoot, 'events.db'),
    allowedHosts: ['127.0.0.1:4326', 'localhost:4326'],
    apps: { reminder: { url: 'http://127.0.0.1:4322/api/business', keyFile: reminderKey, spacesFile, spaces: [spaceId] } },
  };
  // Validate the issuer before creating credentials or any account metadata.
  const auth = new AuthStore({ file: config.database, issuer: config.issuer });
  try {
    auth.createUser({ id: ownerId, username, password }); auth.createSpace({ id: spaceId, type: 'personal', ownerId });
    auth.setPlatformAdmin({ userId: ownerId, enabled: true });
    auth.setWebAccess({ userId: ownerId, apps: [...WEB_APP_IDS], workbench: true, prds: true });
    auth.grantResource({ userId: ownerId, spaceId, appId: 'reminder', resources: ['*'], actions: ['read', 'create', 'update', 'complete', 'delete'] });
  } finally { auth.close(); }
  await privateWrite(reminderKey, randomBytes(48)); await privateWrite(tingproofKey, randomBytes(48));
  await privateWrite(spacesFile, { spaces: { [spaceId]: resolve(reminderData) } });
  await privateWrite(resolve(dirname(file), 'reminder-managed.json'), { REMINDER_MANAGED: '1', REMINDER_BUSINESS_KEY_FILE: reminderKey, REMINDER_BUSINESS_SPACES_FILE: spacesFile });
  await privateWrite(resolve(secretRoot, 'business-owner.json'), { username, password, loginUrl: `${config.issuer}/auth/login` });
  await privateWrite(file, config);
  return { configFile: file, credentialsFile: resolve(secretRoot, 'business-owner.json'), ownerId, spaceId };
}
export async function administerBusiness({ command, configFile, specFile, outputFile }) {
  const config = await loadBusinessConfig(configFile), store = new AuthStore({ file: config.database, issuer: config.issuer });
  try {
    let spec = {};
    if (specFile) { const info = await lstat(specFile); if (!info.isFile() || info.isSymbolicLink() || info.mode & 0o077) throw new Error('Administration specs must be private regular files.'); spec = JSON.parse(await readFile(specFile, 'utf8')); }
    const methods = { 'user-create': 'createUser', 'space-create': 'createSpace', 'member-set': 'setMembership', 'permission-grant': 'grantResource', 'client-create': 'createClient', 'grant-create': 'createGrant', 'web-access': 'setWebAccess' };
    if (Object.hasOwn(methods, command)) { if (!specFile) throw new Error('A private --spec file is required.'); const result = store[methods[command]](spec); return { command, id: result?.id, status: 'ok' }; }
    if (command === 'grant-revoke') { store.revokeGrant(spec.grantId); return { status: 'ok' }; }
    if (command === 'token-issue') { if (!outputFile) throw new Error('A private --out file is required for tokens.'); await privateWrite(outputFile, store.issueToken(spec)); return { status: 'ok', outputFile: resolve(outputFile) }; }
    if (command === 'status') return { status: 'ok', policyVersion: store.policyVersion, issuer: config.issuer };
    throw new Error('Unknown business administration command.');
  } finally { store.close(); }
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    const { values, positionals } = parseArgs({ allowPositionals: true, options: { config: { type: 'string', default: process.env.PRAXIS_BUSINESS_CONFIG }, issuer: { type: 'string' }, 'reminder-data': { type: 'string' }, 'state-root': { type: 'string' }, username: { type: 'string' }, spec: { type: 'string' }, out: { type: 'string' } } });
    if (!values.config) throw new Error('Pass --config with a private configuration path.');
    const result = positionals[0] === 'init' ? await initializeBusiness({ file: values.config, issuer: values.issuer, reminderData: values['reminder-data'], stateRoot: values['state-root'], username: values.username }) : await administerBusiness({ command: positionals[0], configFile: values.config, specFile: values.spec, outputFile: values.out });
    console.log(JSON.stringify(result));
  } catch (error) { console.error(`Business administration failed: ${error.code || 'INVALID_INPUT'}`); process.exitCode = 1; }
}
