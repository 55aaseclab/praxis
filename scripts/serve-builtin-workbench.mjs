import { DEFAULT_APP_REGISTRY } from '../src/default-app-registry.mjs';
import { readFile } from 'node:fs/promises';
import { createPraxisServer } from '../src/server.mjs';

const installation = JSON.parse(await readFile('/config/installation.json', 'utf8'));
const server = createPraxisServer({
  publicUrlsFile: null,
  observationsFile: '/data/web/observations.db',
  consoleUpstream: 'http://127.0.0.1:4326',
  consoleHost: new URL(installation.origin).host,
  consoleOrigin: installation.origin,
  webGateway: {
    enabled: true, canonicalUrl: installation.origin, coreUrl: 'http://127.0.0.1:4326',
    originHost: 'localhost', privateDocumentOwnerId: installation.ownerId,
    privateDocumentRoots: Object.fromEntries(DEFAULT_APP_REGISTRY.apps.filter(app => app.integration.deployment?.privateDocuments).map(app => [app.id, app.integration.deployment.privateDocuments.directory])),
  },
});
server.on('error', error => { console.error(error.message); process.exitCode = 1; });
server.listen(4321, '0.0.0.0');
