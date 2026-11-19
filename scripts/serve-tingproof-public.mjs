import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { register } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(process.env.PRAXIS_TINGPROOF_ROOT || fileURLToPath(new URL('../third_party/tingproof/', import.meta.url)));
const app = pathToFileURL(root + '/');
process.chdir(root);
const compiled = new URL('dist-server/main.js', app);
let entry = compiled;
if (!existsSync(fileURLToPath(compiled))) {
  process.env.PRAXIS_TINGPROOF_ROOT = root;
  register(new URL('./tingproof-ts-loader.mjs', import.meta.url));
  entry = new URL('server/main.ts', app);
}
const { startTingProofServer } = await import(entry);
const publicDist = new URL('dist-public/', app);
const distDir = process.env.TINGPROOF_DIST_DIR || fileURLToPath(existsSync(fileURLToPath(publicDist)) ? publicDist : new URL('dist/', app));
const port = Number(process.env.PORT || 15173);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be a valid port.');
startTingProofServer({ host: process.env.HOST || '0.0.0.0', port, distDir });
console.log('TingProof production profile listening on port ' + port);
