#!/usr/bin/env node
import { setTimeout as delay } from 'node:timers/promises';
import { resolve, dirname } from 'node:path';
import { readFile, lstat } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { BusinessEvents } from '../src/business/events.mjs';
import { loadBusinessConfig } from '../src/business/config.mjs';
import { processReplicaJob } from '../src/business/replicas.mjs';
import { loadConfig, DEFAULT_CONFIG_FILE, writePrivateJson, assertPrivateFile } from '../src/storage/config.mjs';
import { StorageRepositories } from '../src/storage/repositories.mjs';
import { withBusinessBackupSources } from '../src/business/backup-sources.mjs';

export async function runBusinessSyncWorker({ businessConfigFile, storageConfigFile = process.env.PRAXIS_STORAGE_CONFIG || DEFAULT_CONFIG_FILE, signal, clock = () => Date.now(), intervalMs = 1000, repositoriesFactory = (config, options) => new StorageRepositories(config, options), output = value => console.log(JSON.stringify(value)) }) {
  const business = await loadBusinessConfig(businessConfigFile);
  const configuredStorage = await loadConfig(storageConfigFile);
  const events = new BusinessEvents(business.eventsDatabase, { clock });
  const inventoryFile = resolve(dirname(business.eventsDatabase), 'backup-coverage.json');
  const periodicMs = configuredStorage.intervalSeconds * 1000;
  let nextPeriodicAt = 0;
  async function prepareRepositories() {
    let knownActiveSources = [];
    const inventoryExists = await lstat(inventoryFile).then(() => true).catch(error => { if (error.code !== 'ENOENT') throw error; return false; });
    if (inventoryExists) { await assertPrivateFile(inventoryFile); knownActiveSources = JSON.parse(await readFile(inventoryFile, 'utf8')).sources; if (!Array.isArray(knownActiveSources)) throw new Error('Invalid backup coverage inventory.'); }
    const currentBusiness = await loadBusinessConfig(businessConfigFile);
    const storage = await withBusinessBackupSources(await loadConfig(storageConfigFile), currentBusiness, { knownActiveSources });
    await writePrivateJson(inventoryFile, { version: 1, sources: [...new Set([...knownActiveSources, ...storage.appSources.map(source => source.source)])] });
    return repositoriesFactory(storage, { configFile: storageConfigFile });
  }
  try {
    while (!signal?.aborted) {
      if (clock() >= nextPeriodicAt) { events.requestPeriodicSync(); nextPeriodicAt = clock() + periodicMs; }
      const result = await processReplicaJob({ events, prepareRepositories, signal });
      output({ event: 'business-cycle', status: result.processed ? result.state === 'synced' ? 'success' : 'partial' : result.state === 'retry' ? 'partial' : 'idle', ...result });
      try { await delay(intervalMs, undefined, { signal }); } catch (error) { if (error.name !== 'AbortError') throw error; }
    }
  } finally { events.close(); }
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const controller = new AbortController();
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => controller.abort());
  await runBusinessSyncWorker({ signal: controller.signal });
}
