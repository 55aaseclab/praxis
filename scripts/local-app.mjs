import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { createPraxisServer, WORKSPACE_ROOT } from '../src/server.mjs';
import { readApps } from '../src/apps.mjs';

export function developmentApps(manifests, official) {
  const ids = new Set(official.map((app) => app.id));
  if (!Array.isArray(manifests)) throw new Error('Expected a JSON array of local apps.');
  return manifests.map((app) => {
    if (!app || typeof app.id !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(app.id) || ids.has(app.id))
      throw new Error('Local app IDs must be unique and must not replace an official app.');
    ids.add(app.id);
    const url = new URL(app.url);
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      throw new Error('Use a loopback app URL without credentials, query or fragment.');
    for (const field of ['name', 'description']) {
      if (
        ['en', 'zh'].some(
          (lang) =>
            typeof app[field]?.[lang] !== 'string' ||
            !app[field][lang].trim() ||
            app[field][lang].length > 160
        )
      )
        throw new Error('Provide English and Simplified Chinese names and descriptions.');
    }
    return {
      id: app.id,
      kind: 'app',
      name: app.name.en,
      description: app.description.en,
      labels: {
        en: { name: app.name.en, description: app.description.en },
        zh: { name: app.name.zh, description: app.description.zh }
      },
      url: url.href,
      icon: '/projects-icon.svg'
    };
  });
}
async function main() {
  const [file, portArg = '4180'] = process.argv.slice(2);
  const port = Number(portArg);
  if (!file || !Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error('Usage: npm run apps:dev -- apps.json [port]');
  const apps = developmentApps(
    JSON.parse(await readFile(resolve(file), 'utf8')),
    await readApps(WORKSPACE_ROOT)
  );
  const server = createPraxisServer({ developmentApps: apps });
  server.once('error', (error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
  server.listen(port, '127.0.0.1', () => console.log('Local workbench: http://127.0.0.1:' + port + '/'));
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
