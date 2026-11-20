import { assertAppBindings, resolveAppPaths } from '../src/storage/app-paths.mjs';
import { constants } from 'node:fs';
import { open, lstat, realpath, mkdir, chmod, writeFile, rename } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { validateDataInventory } from '../src/business/data-inventory.mjs';
import { readApps } from '../src/apps.mjs';

const repository = fileURLToPath(new URL('../', import.meta.url)).replace(/\/$/, '');
const exec = promisify(execFile);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const inside = (parent, child) => child === parent || child.startsWith(parent + '/');
const canonical = value => typeof value === 'string' && isAbsolute(value) && resolve(value) === value && !/[\\\x00-\x1f\x7f?#]/.test(value);
const safePath = value => canonical(value) && !/(?:^|\/)(?:\.env(?:\.[^/]*)?|auth\.json|(?:credentials|secrets?|passwords?|tokens?)(?:\.[^/]*)?|\.git|\.ssh|\.gnupg|\.aws|\.kube|\.docker|\.codex|id_rsa|id_ed25519)(?:\/|$)|\.(?:pem|key|p12|pfx|kdbx)$/i.test(value);
const paths = mapping => object(mapping?.spaces) ? Object.values(mapping.spaces).filter(safePath) : [];

/** Project configured locations only; never open application records or databases. */
export function createDataInventory({ registry = [], business = {}, storage = {}, reminderSpaces, slidesSpaces, polaris, financeMounts = [], financeProjectName, intelligenceRuntime, sourceRoot = repository, now = Date.now() } = {}) {
  const applications = Array.isArray(registry) ? registry.filter(app => app?.kind === 'app').map(({ id, name, source }) => ({ id, name, source })) : [];
  if (object(polaris) && !applications.some(app => app.id === 'polaris')) applications.push({ id: 'polaris', name: 'Polaris' });
  if (!applications.some(app => app.id === 'praxis')) applications.push({ id: 'praxis', name: 'Praxis' });
  const workspaceId = typeof storage.workspaceId === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(storage.workspaceId) ? storage.workspaceId : null;
  const working = storage.workingData ? resolveAppPaths(storage) : null;
  const sources = Array.isArray(storage.appSources) ? storage.appSources : [];
  const configuredApps = object(business.apps) ? business.apps : {};
  const apps = applications.map(app => {
    const id = app.id === 'lattice-slides' ? 'slides' : app.id;
    const config = object(configuredApps[id]) ? configuredApps[id] : {};
    const locations = [];
    const add = location => {
      if (location.hostPath !== undefined && !safePath(location.hostPath)) return;
      if (locations.some(item => item.kind === location.kind && item.hostPath === location.hostPath && item.containerPath === location.containerPath && item.storageKey === location.storageKey && item.volumeName === location.volumeName)) return;
      locations.push(location);
    };
    const file = (label, kind, hostPath, description) => { if (safePath(hostPath)) add({ label, kind, hostPath, ...(description ? { description } : {}) }); };
    const source = (label, suffix, description) => {
      const root = typeof app.source === 'string' && !isAbsolute(app.source) ? resolve(sourceRoot, app.source) : null;
      if (root && inside(sourceRoot, root)) file(label, 'source', join(root, suffix), description);
    };
    if (id === 'intelligence') {
      if (intelligenceRuntime?.preview === true) source('只读预览材料', 'fixtures/preview.json', '应用自带合成材料，用于界面预览；正式业务文件尚未启用。');
      else if (intelligenceRuntime?.preview === false && safePath(intelligenceRuntime.hostPath)) add({ label: '情报集与材料', kind: 'json', hostPath: join(intelligenceRuntime.hostPath, 'data.json'), containerPath: '/data/intelligence/data.json' });
      else add({ label: '情报数据', kind: 'unknown', description: '运行模式或正式数据挂载尚未核验。' });
    } else if (id === 'reminder') {
      for (const path of paths(reminderSpaces)) file('业务空间任务', 'json', path);
    } else if (['knowledge', 'projects', 'memo'].includes(id)) {
      if (safePath(config.dataDir)) file(id === 'memo' ? '记录、照片与场景指南' : id === 'knowledge' ? '笔记与版本' : '项目记录', 'sqlite', join(config.dataDir, `${id}.db`));
    } else if (id === 'travel') file('行程记录', 'directory', config.dataDir);
    else if (id === 'tingproof') file('听校数据库', 'sqlite', config.dataFile);
    else if (id === 'slides') {
      file('文稿、版本、素材与导出', 'directory', config.dataDir);
      for (const path of paths(slidesSpaces)) file('业务空间文稿', 'json', path);
    } else if (id === 'polaris' && object(polaris)) {
      if (safePath(polaris.observationsFile)) file('Read-only workspace observations', 'json', polaris.observationsFile);
      if (safePath(polaris.dataRoot)) {
        file('业务数据根', 'directory', polaris.dataRoot);
        file('当前控制数据库', 'sqlite', join(polaris.dataRoot, 'control/state/control.sqlite'));
        if (workspaceId) file('工作区运行配置与 Vault 定义', 'directory', join(polaris.dataRoot, 'control/workspaces', workspaceId));
        file('采集断点和快照', 'directory', join(polaris.dataRoot, 'collection-jobs'));
        file('工作区与执行数据', 'directory', join(polaris.dataRoot, 'vault-data'));
      }
      file('浏览器资料与状态', 'directory', polaris.browserProfiles);
      file('浏览器二进制缓存', 'cache', polaris.browserCache, '缓存不等同于业务事实数据。');
      file('独立工具会话', 'directory', polaris.codexHome);
    } else if (id === 'praxis') {
      file('用户、权限与授权', 'sqlite', business.database);
      file('事件与同步元数据', 'sqlite', business.eventsDatabase);
      file('体验与性能日志', 'sqlite', business.observationsFile);
    }
    for (const record of sources.filter(item => item?.id === id && id !== 'finance')) {
      const kind = ['json', 'sqlite', 'directory'].includes(record.kind) ? record.kind : 'unknown';
      const label = id === 'slides' && record.target === 'decks' ? '原生文稿目录' : id === 'slides' && record.target === '.lattice' ? '原生编辑与素材状态' : '已登记数据';
      file(label, kind, record.source);
    }
    if (id === 'finance' && !locations.length) {
      const mount = Array.isArray(financeMounts) && financeMounts.find(item => item?.Destination === '/data' && ['volume', 'bind'].includes(item.Type) && safePath(item.Source));
      if (mount) {
        add({ label: '收支、预算与资产', kind: mount.Type === 'volume' ? 'docker-volume' : 'json', hostPath: join(mount.Source, 'finance.json'), containerPath: '/data/finance.json', ...(mount.Type === 'volume' && typeof mount.Name === 'string' ? { volumeName: mount.Name } : {}) });
      } else if (working) {
        add({ label: '收支、预算与资产', kind: 'json', hostPath: working.finance, containerPath: '/data/finance.json', description: '生效配置中的位置；当前容器挂载尚未核验。' });
      } else {
        const project = financeProjectName || (typeof storage.workspaceId === 'string' ? `praxis-${storage.workspaceId.toLowerCase().replace(/[^a-z0-9_-]/g, '-')}` : null);
        add({ label: '收支、预算与资产', kind: 'docker-volume', containerPath: '/data/finance.json', ...(project ? { volumeName: `${project}_finance-data` } : {}), description: '容器位置已登记，宿主持久卷位置暂未核验。' });
      }
    }
    if (id === 'memo') {
      add({ label: working ? '旧设备待导入记录' : '凭证与照片', kind: 'browser', storageKey: 'memo.records.v1', description: working ? '旧设备记录会在成功连接后受控导入；尚未打开的浏览器仍保留待导入副本。' : '保存在实际使用的设备、浏览器与站点来源中，使用Memo的完整JSON导出恢复；服务器卷不包含它。' });
      add({ label: '偏好与流程', kind: 'browser', storageKey: 'memo.prefs.v1 / memo.flow.v1', description: '浏览器本地状态，随原有完整JSON备份迁移。' });
    }
    if (id === 'knowledge' && !working) {
      source('发布基线文档', 'src/content/docs', '原稿属于版本化源码；受控编辑与历史版本在上方数据库中。');
      source('发布图片与参考页面', 'public');
    }
    if (id === 'travel' && !working) {
      source('静态照片', 'public', '源码静态资源，不替代当前受控行程目录。');
      source('初始路线与历史基线', 'data');
      add({ label: '旧冰岛清单状态', kind: 'browser', storageKey: 'iceland-check-*', description: '仅适用于曾使用旧页面的浏览器；并非当前行程主存储。' });
    }
    if (id === 'tingproof') {
      add({ label: '音频文件句柄', kind: 'browser', storageKey: 'IndexedDB: tingproof', description: '本机浏览器保存文件关联，换浏览器后需要重新关联。' });
      add({ label: '原始音频', kind: 'unknown', description: '位于用户选择的原文件位置，服务器未登记其路径；听校数据库不包含媒体。' });
    }
    if (!locations.length) add({ label: '数据位置', kind: 'unknown', description: '尚未登记可核实的数据位置。' });
    return { id: app.id, name: app.name, locations };
  });
  const workspaceRoot = workspaceId && safePath(storage.dataRoot) ? join(storage.dataRoot, 'workspaces', workspaceId) : null;
  return validateDataInventory({ schemaVersion: 1, generatedAt: new Date(typeof now === 'function' ? now() : now).toISOString(), ...(workspaceRoot && safePath(workspaceRoot) ? { workspaceRoot } : {}), apps });
}

async function readMetadata(file, { optional = false, privateFile = true, maximum = 262144 } = {}) {
  let handle;
  try {
    if (!canonical(file) || await realpath(dirname(file)) !== dirname(file)) throw new Error('Metadata paths must be canonical.');
    handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
    const info = await handle.stat();
    if (!info.isFile() || info.nlink !== 1 || info.size > maximum || privateFile && (info.uid !== (process.getuid?.() ?? 1000) || info.mode & 0o077)) throw new Error('Metadata requires bounded private regular files.');
    const bytes = Buffer.alloc(maximum + 1); let size = 0;
    while (size < bytes.length) { const part = await handle.read(bytes, size, bytes.length - size, null); if (!part.bytesRead) break; size += part.bytesRead; }
    if (size > maximum) throw new Error('Metadata exceeds its size limit.');
    return JSON.parse(bytes.subarray(0, size).toString('utf8'));
  } catch (error) { if (optional && error.code === 'ENOENT') return undefined; throw error; }
  finally { await handle?.close(); }
}

async function dockerOutput(args) {
  const { stdout } = await exec('docker', args, { encoding: 'utf8', timeout: 5000, maxBuffer: 262144 });
  return stdout;
}
export async function inspectFinanceMounts(storage, runDocker = dockerOutput) {
  const project = process.env.PRAXIS_COMPOSE_PROJECT || (typeof storage?.workspaceId === 'string' ? `praxis-${storage.workspaceId.toLowerCase().replace(/[^a-z0-9_-]/g, '-')}` : null);
  if (!project || !/^[a-z0-9][a-z0-9_-]{0,120}$/.test(project)) return [];
  try {
    const ids = String(await runDocker(['ps', '--all', '--filter', `label=com.docker.compose.project=${project}`, '--filter', 'label=com.docker.compose.service=finance', '--format', '{{.ID}}'])).trim().split(/\s+/).filter(Boolean);
    if (ids.length !== 1 || !/^[a-f0-9]{12,64}$/.test(ids[0])) return [];
    const value = JSON.parse(await runDocker(['inspect', '--format', '{{json .Mounts}}', ids[0]]));
    return Array.isArray(value) ? value : [];
  } catch { return []; }
}

export async function inspectIntelligenceRuntime(storage, runDocker = dockerOutput) {
  const project = process.env.PRAXIS_COMPOSE_PROJECT || (typeof storage?.workspaceId === 'string' ? `praxis-${storage.workspaceId.toLowerCase().replace(/[^a-z0-9_-]/g, '-')}` : null);
  if (!project || !/^[a-z0-9][a-z0-9_-]{0,120}$/.test(project)) return undefined;
  try {
    const ids = String(await runDocker(['ps', '--all', '--filter', `label=com.docker.compose.project=${project}`, '--filter', 'label=com.docker.compose.service=intelligence', '--format', '{{.ID}}'])).trim().split(/\s+/).filter(Boolean);
    if (ids.length !== 1 || !/^[a-f0-9]{12,64}$/.test(ids[0])) return undefined;
    const metadata = JSON.parse(await runDocker(['inspect', '--format', '{"environment":{{json .Config.Env}},"mounts":{{json .Mounts}}}', ids[0]]));
    if (!Array.isArray(metadata.environment) || !Array.isArray(metadata.mounts)) return undefined;
    const modes = metadata.environment.filter(value => typeof value === 'string' && value.startsWith('INTELLIGENCE_PREVIEW='));
    if (modes.length !== 1 || !['INTELLIGENCE_PREVIEW=0', 'INTELLIGENCE_PREVIEW=1'].includes(modes[0])) return undefined;
    if (modes[0].endsWith('=1')) return { preview: true };
    const mount = metadata.mounts.find(item => item.Type === 'bind' && item.Destination === '/data/intelligence' && item.RW === false && safePath(item.Source));
    return mount ? { preview: false, hostPath: mount.Source } : undefined;
  } catch { return undefined; }
}

async function publish(file, value, { sourceRoot, inputFiles }) {
  if (!safePath(file) || inside(sourceRoot, file) || !/^[a-z][a-z0-9-]{0,63}\.json$/.test(file.split('/').at(-1))) throw new Error('Inventory requires a private JSON destination outside source.');
  const directory = dirname(file);
  const protectedPaths = [...inputFiles, ...value.apps.flatMap(app => app.locations.filter(item => item.hostPath).map(item => ['directory', 'source', 'cache'].includes(item.kind) ? item.hostPath : dirname(item.hostPath)))];
  if (['/', '/tmp', '/home', '/var', '/opt', homedir()].includes(directory) || protectedPaths.some(path => canonical(path) && (inside(path, directory) || inside(directory, path)))) throw new Error('Inventory output must remain separate from source, inputs and live data.');
  let ancestor = directory;
  while (!await lstat(ancestor).catch(error => { if (error.code === 'ENOENT') return null; throw error; })) ancestor = dirname(ancestor);
  if (await realpath(ancestor) !== ancestor || !(await lstat(ancestor)).isDirectory()) throw new Error('Inventory directories cannot use aliases.');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const parent = await lstat(directory);
  if (!parent.isDirectory() || parent.isSymbolicLink() || parent.uid !== (process.getuid?.() ?? 1000) || parent.mode & 0o077 || await realpath(directory) !== directory) throw new Error('Inventory directory must be private and owner controlled.');
  const existing = await lstat(file).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
  if (existing && (!existing.isFile() || existing.isSymbolicLink() || existing.nlink !== 1 || existing.uid !== parent.uid || existing.mode & 0o077)) throw new Error('Inventory output must be a private regular file.');
  const temporary = `${file}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(value) + '\n', { mode: 0o600, flag: 'wx' });
  await chmod(temporary, 0o600); await rename(temporary, file);
}

export async function main(args = [], options = {}) {
  const [command = 'publish', ...flags] = args;
  if (command !== 'publish') throw new Error('Usage: data-inventory.mjs publish [--config PATH] [--storage-config PATH] [--polaris-config PATH] [--output PATH]');
  const parsed = {};
  for (let i = 0; i < flags.length; i += 2) {
    if (!['--config', '--storage-config', '--polaris-config', '--output'].includes(flags[i]) || !flags[i + 1] || parsed[flags[i]]) throw new Error('Inventory options require unique configuration paths.');
    parsed[flags[i]] = flags[i + 1];
  }
  const sourceRoot = resolve(options.sourceRoot || repository), base = join(options.home || homedir(), '.config/praxis');
  const businessFile = parsed['--config'] || options.businessConfigFile || join(base, 'business.json');
  const business = await readMetadata(businessFile, { optional: true }) || {};
  const storageFile = parsed['--storage-config'] || options.storageConfigFile || business.console?.storageConfigFile || join(base, 'storage.json');
  const polarisFile = parsed['--polaris-config'] || options.polarisConfigFile || join(base, 'polaris.json');
  const registryFile = join(sourceRoot, 'config/installed-apps.json');
  const registry = await readApps(sourceRoot, { publicUrlsFile: null });
  const storage = await readMetadata(storageFile, { optional: true }) || {};
  const polaris = await readMetadata(polarisFile, { optional: true });
  const reminderFile = business.apps?.reminder?.spacesFile, slidesFile = business.apps?.slides?.spacesFile;
  const reminderSpaces = reminderFile ? await readMetadata(reminderFile) : undefined;
  const slidesSpaces = slidesFile ? await readMetadata(slidesFile) : undefined;
  const financeMounts = registry.some(app => app.id === 'finance') ? await inspectFinanceMounts(storage, options.runDocker) : [];
  if (storage.workingData) assertAppBindings(storage, business, { reminderSpaces: reminderSpaces?.spaces, slidesSpaces: slidesSpaces?.spaces, polaris });
  const intelligenceRuntime = registry.some(app => app.id === 'intelligence') ? await inspectIntelligenceRuntime(storage, options.runDocker) : undefined;
  const value = createDataInventory({ registry, business, storage, reminderSpaces, slidesSpaces, polaris, financeMounts, intelligenceRuntime, financeProjectName: process.env.PRAXIS_COMPOSE_PROJECT, sourceRoot, ...(options.now ? { now: options.now } : {}) });
  const outputFile = parsed['--output'] || options.outputFile || business.console?.dataInventoryFile || join(base, 'data-inventory/locations.json');
  const protectedInputs = [businessFile, storageFile, polarisFile, registryFile, reminderFile, slidesFile,
    business.console?.storageStatusFile, storage.stateRoot,
    ...Object.values(object(business.apps) ? business.apps : {}).flatMap(config => object(config) ? [config.keyFile, config.spacesFile, config.businessConfigFile] : []),
    ...(Array.isArray(storage.repositories) ? storage.repositories : []).flatMap(config => object(config) ? [config.path, config.passwordFile, config.credentialsFile, config.rcloneConfigFile] : []),
  ].filter(value => typeof value === 'string');
  await publish(outputFile, value, { sourceRoot, inputFiles: protectedInputs });
  const result = { published: true, apps: value.apps.length, generatedAt: value.generatedAt };
  (options.print || console.log)(JSON.stringify(result)); return result;
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) main(process.argv.slice(2)).catch(() => { console.error('Data inventory publication failed.'); process.exitCode = 1; });
