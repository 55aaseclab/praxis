import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const settings = JSON.parse(await readFile('/config/runtime.json', 'utf8'));
for (const [name, value] of Object.entries(settings)) {
  if (!/^[A-Z][A-Z0-9_]*$/.test(name) || typeof value !== 'string' || /[\0\r\n]/.test(value)) {
    throw new Error('Invalid application runtime configuration.');
  }
  process.env[name] = value;
}
const args = process.argv.slice(2);
if (args.shift() !== 'node' || !args[0]) throw new Error('A native Node entry point is required.');
process.argv = [process.execPath, ...args];
await import(pathToFileURL(resolve(args[0])).href);
