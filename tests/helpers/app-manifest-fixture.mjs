import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export const SYNTHETIC_ICON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#21594d" d="M4 4h16v16H4z"/></svg>\n';
export function appManifest(app, overrides = {}) {
  const name = app.name ?? app.id, description = app.description ?? `Synthetic ${app.id} application`;
  const legacyIcon = typeof app.icon === 'string' && /^\/[a-z][a-z0-9-]*-icon\.svg$/.test(app.icon) ? app.icon : undefined;
  return {
    schemaVersion: 1, id: app.id, version: typeof app.version === 'string' ? app.version : '1.2.3', kind: 'app', name, description,
    labels: { en: app.labels?.en ?? { name, description }, zh: app.labels?.zh ?? { name: `合成 ${name}`, description: `合成 ${app.id} 应用` } },
    icon: 'public/praxis-icon.svg', ...(legacyIcon && { iconAliases: [legacyIcon] }), path: app.path ?? '/',
    documents: app.documents ?? { prd: { en: 'PRD.en.md', zh: 'PRD.md' } },
    ...Object.fromEntries(['port', 'launcher', 'adminOnly'].filter(key => app[key] !== undefined).map(key => [key, app[key]])),
    ...overrides,
  };
}
export async function writeAppManifestFixture(root, app, overrides = {}) {
  const source = app.source ?? `third_party/${app.id}`;
  if (!/^third_party\/[a-z][a-z0-9-]*$/.test(source)) throw new Error('Synthetic source must stay under third_party.');
  const directory = join(root, source); await mkdir(join(directory, 'public'), { recursive: true });
  const manifest = appManifest(app, overrides);
  await writeFile(join(directory, 'praxis-app.json'), JSON.stringify(manifest, null, 2) + '\n');
  await writeFile(join(directory, 'public/praxis-icon.svg'), SYNTHETIC_ICON);
  return { source, directory, manifest };
}
export async function writeInstalledAppsFixture(root, apps) {
  await mkdir(join(root, 'config'), { recursive: true });
  for (const app of apps) {
    const source = app.source ?? `third_party/${app.id}`;
    // Deliberately invalid binding tests can persist the invalid index without
    // following an arbitrary path or writing outside the synthetic workspace.
    if (/^third_party\/[a-z][a-z0-9-]*$/.test(source)) await writeAppManifestFixture(root, app);
  }
  const value = { schemaVersion: 1, apps: apps.map(app => ({ source: app.source ?? `third_party/${app.id}` })) };
  await writeFile(join(root, 'config/installed-apps.json'), JSON.stringify(value, null, 2) + '\n');
  return value;
}
