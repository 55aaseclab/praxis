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
    enabled: true, requireTingproofNativeScope: true, canonicalUrl: installation.origin, coreUrl: 'http://127.0.0.1:4326',
    originHost: 'localhost', privateDocumentOwnerId: installation.ownerId,
    privateDocumentRoots: { letters: '/data/letters/documents', profiles: '/data/profiles/documents' },
  },
});
server.on('error', error => { console.error(error.message); process.exitCode = 1; });
server.listen(4321, '0.0.0.0');
