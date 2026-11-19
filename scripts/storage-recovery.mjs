import { cp, lstat, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadConfig, DEFAULT_CONFIG_FILE, assertOutsideWorkspace, assertPrivateFile, isWithin } from '../src/storage/config.mjs';

async function canonicalPath(path) {
  let existing = resolve(path);
  const suffix = [];
  while (!(await lstat(existing).catch(error => { if (error.code === 'ENOENT') return null; throw error; }))) {
    suffix.unshift(basename(existing)); existing = dirname(existing);
  }
  const { realpath } = await import('node:fs/promises');
  return resolve(await realpath(existing), ...suffix);
}

export async function exportRecoveryKit(config, destination) {
  destination = resolve(destination);
  assertOutsideWorkspace(destination, 'Recovery kit');
  if (await lstat(destination).catch(() => null)) throw new Error('Recovery destination must not exist');
  const canonicalDestination = await canonicalPath(destination);
  assertOutsideWorkspace(canonicalDestination, 'Recovery kit');
  const protectedPaths = [config.dataRoot, config.stateRoot, ...(config.appSources ?? []).map(source => source.source), ...(config.sourceRepos ?? []).map(source => source.path), ...config.repositories.filter(repository => repository.type === 'local').map(repository => repository.path)].filter(Boolean);
  for (const path of protectedPaths) {
    const canonical = await canonicalPath(path);
    if (isWithin(canonical, canonicalDestination) || isWithin(canonicalDestination, canonical)) throw new Error('Recovery keys must be stored separately from application data, source repositories, backup repositories and coordinator state');
  }
  await mkdir(destination, { mode: 0o700 });
  try {
    const exported = structuredClone(config), copied = new Map();
    for (const repository of exported.repositories) {
      for (const field of ['passwordFile', 'credentialsFile', 'rcloneConfigFile']) {
        const source = repository[field];
        if (!source) continue;
        await assertPrivateFile(source);
        if (!copied.has(source)) {
          const filename = `${copied.size + 1}-${basename(source)}`;
          await cp(source, join(destination, filename), { errorOnExist: true, force: false });
          copied.set(source, filename);
        }
        repository[field] = copied.get(source);
      }
    }
    await writeFile(join(destination, 'storage.template.json'), `${JSON.stringify(exported, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
    await writeFile(join(destination, 'README.txt'), 'Praxis 私有恢复材料\n\n此目录含解密密钥和可能的云端凭据，请放到独立、受保护的设备或密码管理器，不能放到公开仓库，也不能只保留在原机器上。\n\n恢复时先安装 Node 22、restic、rclone；把模板中的密钥文件名改为新机器上的绝对路径，dataRoot/stateRoot/本地仓库路径改为新目录；保留 workspaceId，并为新机器生成 deviceId。不要自行把 activeWriterDeviceId 改成新设备来绕过交接。\n\n源机器正常换机时先停止旧 writer、完成最终快照并执行 writer-handover；然后从副本恢复到空目录，验证快照，再恢复源码和应用工作集。旧机损坏时保留所有副本与分支，显式灾难恢复后旧机不可重新写入；初版不自动抢占。\n\n源码在快照 source/<repo>/repository.bundle；clone 后应用 working.patch，再复制 untracked/。按 manifest 的精确提交恢复各子仓并核对路径，不以远程已有提交代替本地未推送版本。浏览器导出、音频关联及原网关凭据按覆盖清单单独恢复。\n', { mode: 0o600, flag: 'wx' });
    return { files: copied.size + 2 };
  } catch (error) { await rm(destination, { recursive: true, force: true }); throw error; }
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const args = process.argv.slice(2), configIndex = args.indexOf('--config');
  let configFile = process.env.PRAXIS_STORAGE_CONFIG || DEFAULT_CONFIG_FILE;
  if (configIndex >= 0) { configFile = resolve(args[configIndex + 1]); args.splice(configIndex, 2); }
  try {
    if (args.length !== 1) throw new Error('Usage: storage-recovery.mjs [--config PATH] NEW_PRIVATE_DIRECTORY');
    const result = await exportRecoveryKit(await loadConfig(configFile), args[0]);
    console.log(`Recovery kit exported (${result.files} private files). Store it independently before relying on cloud recovery.`);
  } catch (error) { console.error(`Recovery kit error: ${error.code || error.message}`); process.exitCode = 1; }
}
