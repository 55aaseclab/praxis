#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_CONFIG_FILE, assertPrivateFile, initializeConfig, loadConfig, storageError } from '../src/storage/config.mjs';
import { StorageRepositories } from '../src/storage/repositories.mjs';

const HELP = `Praxis storage — encrypted application snapshots and independent replicas

Usage: node scripts/storage.mjs COMMAND [options]

Commands:
  init                     Create private configuration, recovery key and local repository
  status                   Show persisted per-target state (does not contact providers)
  snapshot                 Export consistent application state and create a local backup
  sync [--from ID] [--to ID] Copy immutable history to independent repositories
  check [--repository ID]  Read and verify all encrypted data in a repository
  restore --target DIR     Restore a snapshot into a new empty staging directory
          [--repository ID] [--snapshot ID]
  add-target --file PATH   Add a repository from a private JSON descriptor
  migrate --to ID          Copy, check and trial-restore before switching preferred target
          [--from ID]
  writer-handover --to-device UUID --source-stopped
                           Disable this writer after all replicas contain its latest snapshot
  watch                    Snapshot and retry replicas every configured interval

Common: --config PATH (or PRAXIS_STORAGE_CONFIG), --help
Init: --data-root DIR --repository-path DIR --password-file PATH
      --restic-binary PATH --rclone-binary PATH

Private application sources must be registered in storage.json before snapshot.
Restore never replaces active application data. No command prunes or deletes history.
`;

export function parseArguments(args) {
  const positional = [], options = {};
  const flags = new Set(['help', 'source-stopped']);
  const values = new Set(['config', 'data-root', 'repository-path', 'password-file', 'restic-binary', 'rclone-binary', 'repository', 'from', 'to', 'target', 'snapshot', 'file', 'to-device']);
  for (let index = 0; index < args.length; index++) {
    const value = args[index];
    if (!value.startsWith('--')) { positional.push(value); continue; }
    const key = value.slice(2);
    if (flags.has(key)) options[key] = true;
    else if (values.has(key) && args[index + 1] && !args[index + 1].startsWith('--')) options[key] = args[++index];
    else throw storageError('INVALID_ARGUMENT', 'Unknown option or missing option value');
  }
  if (positional.length > 1) throw storageError('INVALID_ARGUMENT', 'Only one command is accepted');
  return { command: positional[0] ?? 'help', options };
}

export async function main(args = process.argv.slice(2)) {
  const { command, options } = parseArguments(args);
  if (command === 'help' || options.help) { process.stdout.write(HELP); return; }
  const configFile = resolve(options.config ?? process.env.PRAXIS_STORAGE_CONFIG ?? DEFAULT_CONFIG_FILE);
  let config;
  if (command === 'init') {
    config = await initializeConfig({ configFile, dataRoot: options['data-root'], repositoryPath: options['repository-path'], passwordFile: options['password-file'], resticBinary: options['restic-binary'], rcloneBinary: options['rclone-binary'] });
  } else config = await loadConfig(configFile);
  const storage = new StorageRepositories(config, { configFile });
  let result;
  switch (command) {
    case 'init': result = await storage.initialize(); break;
    case 'status': result = await storage.status(); break;
    case 'snapshot': result = await storage.snapshot(); break;
    case 'sync': result = await storage.sync({ from: options.from, to: options.to }); break;
    case 'check': result = await storage.check({ repositoryId: options.repository }); break;
    case 'restore': result = await storage.restore({ repositoryId: options.repository, target: options.target, snapshotId: options.snapshot }); break;
    case 'add-target': {
      if (!options.file) throw storageError('INVALID_ARGUMENT', 'add-target requires --file');
      const file = resolve(options.file);
      await assertPrivateFile(file);
      let descriptor;
      try { descriptor = JSON.parse(await readFile(file, 'utf8')); } catch { throw storageError('INVALID_ARGUMENT', 'Target descriptor must contain valid JSON'); }
      result = await storage.addTarget(descriptor); break;
    }
    case 'migrate': result = await storage.migrate({ from: options.from, to: options.to }); break;
    case 'writer-handover': result = await storage.writerHandover({ toDeviceId: options['to-device'], sourceStopped: options['source-stopped'] }); break;
    case 'watch': {
      const controller = new AbortController();
      const stop = () => controller.abort();
      process.once('SIGINT', stop); process.once('SIGTERM', stop);
      try { await storage.watch({ signal: controller.signal, onResult: value => process.stdout.write(`${JSON.stringify(value)}\n`) }); }
      finally { process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop); }
      return;
    }
    default: throw storageError('INVALID_ARGUMENT', 'Unknown storage command; use --help');
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (command === 'sync' && result.results.some(target => target.status !== 'success')) process.exitCode = 2;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    const code = /^[A-Z_]+$/.test(error.code ?? '') ? error.code : 'STORAGE_FAILED';
    // Subprocess errors may embed arguments or provider output; never log them.
    process.stderr.write(`${code}: Storage operation failed. Source data and prior backups were preserved.\n`);
    process.exitCode = 1;
  });
}
