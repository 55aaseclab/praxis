import test from 'node:test';
import assert from 'node:assert/strict';
import { glob, lstat, readFile, mkdir, copyFile, mkdtemp, rm, symlink } from 'node:fs/promises';
import { dirname, join, resolve, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const root = fileURLToPath(new URL('../', import.meta.url));
const execute = promisify(execFile);

test('the filtered Storage runtime COPY closure loads both workers and the installed registry without asset builds', { timeout: 20000 }, async t => {
  const dockerfile = await readFile(join(root, 'Dockerfile.storage'), 'utf8');
  assert.doesNotMatch(dockerfile, /RUN[^\n]*(?:build-app-assets|vite|npm run build)/);
  assert.match(dockerfile, /PRAXIS_RESTIC_BINARY=\/usr\/local\/bin\/restic PRAXIS_RCLONE_BINARY=\/usr\/local\/bin\/rclone/);
  assert.match(dockerfile, /USER node\nCMD \["node", "scripts\/storage-worker.mjs", "run"\]/);
  const directory = await mkdtemp(join(tmpdir(), 'praxis-storage-image-closure-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  // Apply the release-context allowlist, excluding caches and Git metadata just
  // as its final deny rules do. Runtime COPY instructions select from this set.
  const files = new Set(), ignore = await readFile(join(root, '.dockerignore'), 'utf8');
  for (const pattern of ignore.split(/\r?\n/).filter(line => line.startsWith('!')).map(line => line.slice(1))) {
    for await (const path of glob(pattern, { cwd: root, exclude: ['**/node_modules/**', '**/.git/**', '**/.git'] })) {
      if (path.split('/').some(part => part === 'node_modules' || part === '.git')) continue;
      const info = await lstat(join(root, path));
      if (info.isFile() && !info.isSymbolicLink()) files.add(path);
    }
  }
  const runtime = dockerfile.slice(dockerfile.lastIndexOf('\nFROM '));
  for (const line of runtime.split(/\r?\n/).filter(line => line.startsWith('COPY '))) {
    const args = line.split(/\s+/).slice(1); if (args.some(value => value.startsWith('--from='))) continue;
    const operands = args.filter(value => !value.startsWith('--')), destination = operands.at(-1).replace(/^\.\//, '');
    for (const source of operands.slice(0, -1)) {
      const sourcePath = source.replace(/\/$/, ''), isDirectory = (await lstat(join(root, sourcePath))).isDirectory();
      const selected = isDirectory ? [...files].filter(path => path.startsWith(sourcePath + '/')) : files.has(sourcePath) ? [sourcePath] : [];
      assert.ok(selected.length, 'COPY source is absent from the reviewed context: ' + sourcePath);
      for (const path of selected) {
        const target = isDirectory ? join(directory, destination, path.slice(sourcePath.length + 1)) : join(directory, destination, basename(path));
        await mkdir(dirname(target), { recursive: true }); await copyFile(join(root, path), target);
      }
    }
  }
  // Dependencies are already locked/installed by Docker's npm-ci layer. Reuse
  // those same local dependencies to execute the selected source closure.
  await symlink(resolve(root, 'node_modules'), join(directory, 'node_modules'));
  const environment = { ...process.env }; delete environment.PRAXIS_APP_SOURCE_ROOT;
  const script = `
    await import('./scripts/storage-worker.mjs');
    await import('./scripts/business-sync-worker.mjs');
    const {DEFAULT_APP_REGISTRY: registry} = await import('./src/default-app-registry.mjs');
    if (registry.apps.length !== 11 || !registry.tools.length) throw Error('Incomplete installed declarations');
    console.log(JSON.stringify({apps:registry.apps.length,workers:2,registryLoaded:true}));
  `;
  const { stdout } = await execute(process.execPath, ['--input-type=module', '-e', script], { cwd: directory, env: environment, maxBuffer: 1024 * 1024 });
  assert.deepEqual(JSON.parse(stdout.trim()), { apps: 11, workers: 2, registryLoaded: true });
});
