#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { publishStorageStatus, readPrivateMetadata } from '../src/storage/status.mjs';

export async function runStorageStatusPublisher(options, { signal, intervalMs = 30000, output = value => console.log(JSON.stringify(value)) } = {}) {
  do {
    try { await publishStorageStatus(options); output({ event: 'storage-status', state: 'published' }); }
    catch { output({ event: 'storage-status', state: 'unavailable' }); }
    if (signal?.aborted) break;
    try { await delay(intervalMs, undefined, { signal }); } catch (error) { if (error.name !== 'AbortError') throw error; }
  } while (!signal?.aborted);
}
export async function main(args = process.argv.slice(2)) {
  const { values, positionals } = parseArgs({ args, allowPositionals: true, options: { config: { type: 'string' }, 'metadata-directory': { type: 'string' }, output: { type: 'string' } } });
  if (!values.output || positionals.length > 1 || !['run', 'once', 'health'].includes(positionals[0] || 'run')) throw new Error('Use storage-status-publisher.mjs run|once|health --output PATH [--config PATH --metadata-directory PATH].');
  if (positionals[0] === 'health') {
    const value = (await readPrivateMetadata(values.output, 65536)).value, now = Date.now();
    if (value.schemaVersion !== 1 || !Number.isFinite(Date.parse(value.generatedAt)) || Date.parse(value.generatedAt) > now + 5000 || now - Date.parse(value.generatedAt) > 90000) throw new Error('Storage status publisher is stale.');
    return;
  }
  if (!values.config) throw new Error('The publisher requires an explicit private storage configuration.');
  const options = { configFile: values.config, metadataDirectory: values['metadata-directory'], outputFile: values.output };
  if (positionals[0] === 'once') { await publishStorageStatus(options); return; }
  const controller = new AbortController();
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => controller.abort());
  await runStorageStatusPublisher(options, { signal: controller.signal });
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) main().catch(() => { console.error('STORAGE_STATUS_UNAVAILABLE: Metadata projection could not be published.'); process.exitCode = 1; });
