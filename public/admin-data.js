import { message as t, locale } from './i18n.js';
import { localizedText, readBrowserProviders } from './app-providers.js';
const language = locale() === 'en' ? 'en' : 'zh-CN';
const kindNames = () => ({ json: t("JSON file", "JSON 文件"), sqlite: t("SQLite database", "SQLite 数据库"), directory: t("Directory", "目录"), browser: t("Browser storage", "浏览器本地存储"), 'docker-volume': t("Docker volume", "Docker 数据卷"), source: t("Stored with the app source", "随应用源码保存"), cache: t("Cache", "缓存"), derived: t("Derived data", "派生数据"), external: t("External source", "外部来源"), 'browser-file': t("Browser-selected file", "浏览器选择的文件"), unknown: t("Unregistered", "未登记") });
function el(tag, className = '', text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
export function formatDataPath(value, workspaceRoot) {
  return workspaceRoot && workspaceRoot !== '/' && (value === workspaceRoot || value.startsWith(workspaceRoot + '/')) ? '$WORKSPACE' + value.slice(workspaceRoot.length) : value;
}
async function copyPath(value, button, feedback) {
  try {
    if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(value);
    else {
      const input = document.createElement('textarea'); input.value = value;
      input.style.cssText = 'position:fixed;left:-9999px;top:0';
      document.body.append(input);
      try { input.select(); if (!document.execCommand('copy')) throw new Error('Clipboard unavailable.'); }
      finally { input.remove(); button.focus(); }
    }
    feedback.textContent = t("Full path copied", "已复制完整路径");
    button.title = t("Full path copied", "已复制完整路径");
    setTimeout(() => { button.title = value; }, 1800);
  } catch { feedback.textContent = t("Copy failed. Copy this path manually: ", "复制未完成，可手动复制：") + value; }
}
function pathLine(label, value, workspaceRoot) {
  const line = el('div', 'data-location');
  const displayed = label === t("Host", "宿主机") ? formatDataPath(value, workspaceRoot) : value;
  const code = el('code', 'data-path', displayed); code.title = value;
  if (label === t("Host", "宿主机")) {
    const button = el('button', 'data-path-copy'); button.type = 'button'; button.title = value;
    button.setAttribute('aria-label', t("Copy full path: ", "复制完整路径：") + displayed);
    const feedback = el('span', 'meta data-copy-feedback');
    feedback.setAttribute('role', 'status');
    button.append(code); button.addEventListener('click', () => copyPath(value, button, feedback));
    line.append(el('span', 'data-location-label', label), button, feedback);
  } else line.append(el('span', 'data-location-label', label), code);
  return line;
}
function locationCell(location, workspaceRoot) {
  const cell = el('td');
  if (location.kind === 'browser') cell.append(el('span', 'data-place', t("Current browser", "当前浏览器")));
  if (location.kind === 'browser-file') cell.append(el('span', 'data-place', t('Selected in this browser; reselect the original file when needed', '由此浏览器选择，需要时重新关联原始文件')));
  if (location.kind === 'derived') cell.append(el('span', 'data-place', t('Derived from authorized source records', '从获授权的原始记录派生')));
  if (location.kind === 'external') cell.append(el('span', 'data-place', t('Stored by the external service', '由外部服务保存')));
  if (location.applicationPath && location.applicationPath !== location.hostPath && location.applicationPath !== location.containerPath) cell.append(pathLine(t("App", "应用内"), location.applicationPath, workspaceRoot));
  if (location.hostPath) cell.append(pathLine(t("Host", "宿主机"), location.hostPath, workspaceRoot));
  if (location.containerPath) cell.append(pathLine(t("Container", "容器"), location.containerPath));
  if (location.volumeName) cell.append(pathLine(t("Volume", "数据卷"), location.volumeName));
  if (location.storageKey) cell.append(pathLine(t("Storage key", "存储键"), location.storageKey));
  if (location.status && location.status !== 'ready') cell.append(el('span', 'meta', statusText(location.status)));
  if (!cell.children.length) cell.append(el('span', 'meta', t("Unregistered location", "未登记位置")));
  if (location.description) cell.append(el('p', 'data-description', location.description));
  return cell;
}
const statusText = status => ({ ready: t('Available', '可读取'), empty: t('No locations reported', '暂无位置清单'), unavailable: t('Could not refresh', '暂时无法刷新'), browser: t('Provided by this browser', '由当前浏览器提供'), denied: t('Access unavailable', '当前不可访问'), unsupported: t('Not provided', '未提供'), partial: t('Partly refreshed', '部分已刷新') })[status] || '';
const translated = value => localizedText(value, locale());
const validText = value => typeof value === 'string' || value && typeof value.en === 'string' && typeof value.zh === 'string';
export function validateDataManagement(value) {
  if (value?.workspaceRoot !== undefined && typeof value.workspaceRoot !== 'string') throw new Error('Invalid workspace root.');
  if (value?.schemaVersion !== 1 || typeof value.generatedAt !== 'string' || Number.isNaN(Date.parse(value.generatedAt)) || !Array.isArray(value.apps) || value.apps.length > 64) throw new Error('Invalid data inventory projection.');
  const ids = new Set();
  for (const app of value.apps) {
    if (typeof app.id !== 'string' || ids.has(app.id) || !validText(app.name) || !Array.isArray(app.locations) || app.locations.length > 32 || app.status !== undefined && !['ready', 'empty', 'unavailable', 'browser', 'denied', 'unsupported', 'partial'].includes(app.status) || app.message !== undefined && !validText(app.message)) throw new Error('Invalid data inventory application.');
    ids.add(app.id);
    for (const location of app.locations) if (!location || !validText(location.label) || !Object.hasOwn(kindNames(), location.kind) || ['hostPath', 'containerPath', 'volumeName', 'storageKey'].some(key => location[key] !== undefined && typeof location[key] !== 'string') || location.description !== undefined && !validText(location.description)) throw new Error('Invalid data inventory location.');
  }
  if (value.sources !== undefined && (!Array.isArray(value.sources) || value.sources.some(source => typeof source?.appId !== 'string' || !['ready', 'empty', 'unavailable', 'browser', 'denied', 'unsupported', 'partial'].includes(source.status) || source.message !== undefined && !validText(source.message)))) throw new Error('Invalid data inventory source.');
  return value;
}
export function mergeBrowserInventory(value, providers) {
  validateDataManagement(value);
  const apps = new Map(value.apps.map(app => [app.id, { ...app, locations: [...app.locations] }]));
  const sources = new Map((value.sources || []).map(source => [source.appId, { ...source }]));
  for (const provider of providers) {
    const existing = apps.get(provider.appId);
    const app = { id: provider.appId, name: existing?.name || provider.appId, locations: ['ready', 'empty', 'partial'].includes(provider.status) ? provider.items : [], status: provider.status, ...(provider.message !== undefined && { message: provider.message }) };
    validateDataManagement({ schemaVersion: 1, generatedAt: value.generatedAt, apps: [app] });
    apps.set(provider.appId, app); sources.set(provider.appId, { appId: provider.appId, status: provider.status, ...(provider.message !== undefined && { message: provider.message }) });
  }
  return { ...value, apps: [...apps.values()], sources: [...sources.values()] };
}
export function renderDataManagement(container, value) {
  validateDataManagement(value);
  const focusedPath = container.contains?.(document.activeElement) ? document.activeElement?.dataset?.dataPath : null;
  const panel = container.closest?.('main'), panelTop = panel?.scrollTop;
  const pageTop = document.scrollingElement?.scrollTop;
  const fragment = document.createDocumentFragment();
  fragment.append(el('p', 'section-note', t('Browse application data locations. Browser data stays in the browser used for that app.', '查看各应用的数据位置。浏览器本地数据保存在使用该应用的浏览器中。')));
  if (value.workspaceRoot) { const hint = el('p', 'meta data-workspace-hint', t('$WORKSPACE is the current workspace. Click a path to copy its full address.', '$WORKSPACE 表示当前工作区，点击路径可复制完整地址。')); hint.title = value.workspaceRoot; fragment.append(hint); }
  const updated = el('p', 'meta data-updated'); updated.append(document.createTextNode(t('Updated ', '更新于 ')));
  const time = el('time', '', new Date(value.generatedAt).toLocaleString(locale() === 'en' ? 'en' : 'zh-CN', { hour12: false })); time.dateTime = value.generatedAt; updated.append(time); fragment.append(updated);
  const sourceStates = new Map((value.sources || []).map(source => [source.appId, source]));
  if (!value.apps.length) fragment.append(el('p', 'empty', t('No application data locations reported.', '暂无可展示的应用数据位置。')));
  else {
    const table = el('table', 'own-access-table data-table'); table.append(el('caption', '', t('Application data locations', '应用数据位置')));
    const head = el('thead'), headings = el('tr');
    for (const text of [t('App', '应用'), t('Data', '数据'), t('Location', '位置')]) { const cell = el('th', '', text); cell.scope = 'col'; headings.append(cell); }
    head.append(headings); table.append(head);
    for (const app of value.apps) {
      const body = el('tbody'); body.dataset.dataApp = app.id;
      const status = app.status || sourceStates.get(app.id)?.status;
      const message = app.message || sourceStates.get(app.id)?.message;
      const name = el('th', 'data-app-name', translated(app.name)); name.scope = 'rowgroup'; name.rowSpan = Math.max(1, app.locations.length);
      if (status) name.append(el('span', 'meta', statusText(status)));
      if (app.locations.length) app.locations.forEach((location, index) => {
        const row = el('tr'); if (!index) row.append(name);
        const label = el('td'); label.append(el('span', 'data-item-label', locale() === 'zh' && typeof location.labels?.zh === 'string' ? location.labels.zh : translated(location.label)), el('span', 'meta', kindNames()[location.kind]));
        row.append(label, locationCell({ ...location, description: location.description === undefined ? undefined : translated(location.description) }, value.workspaceRoot)); body.append(row);
      });
      else {
        const row = el('tr'), reason = el('td', 'meta', translated(message) || statusText(status) || t('No data locations reported.', '暂无可展示的数据位置。')); reason.colSpan = 2; row.append(name, reason); body.append(row);
      }
      table.append(body);
    }
    fragment.append(table);
  }
  const unavailable = (value.sources || []).filter(source => !value.apps.some(app => app.id === source.appId) && ['unavailable', 'partial', 'browser', 'unsupported'].includes(source.status));
  for (const source of unavailable) fragment.append(el('p', 'meta data-source-status', translated(source.message) || statusText(source.status)));
  container.replaceChildren(fragment);
  for (const button of container.querySelectorAll?.('.data-path-copy') || []) button.dataset.dataPath = button.title;
  if (focusedPath) [...container.querySelectorAll('.data-path-copy')].find(button => button.dataset.dataPath === focusedPath)?.focus({ preventScroll: true });
  if (panel && panelTop !== undefined) panel.scrollTop = panelTop;
  if (document.scrollingElement && pageTop !== undefined) document.scrollingElement.scrollTop = pageTop;
}
export function mountDataManagement(container, { initial, load, getIdentity, intervalMs = 30000, fetchImpl = fetch, importModule } = {}) {
  let destroyed = false, running = false, request, generation = 0;
  const owner = getIdentity()?.userId;
  const current = () => !destroyed && Boolean(getIdentity()) && getIdentity()?.userId === owner;
  async function refresh(projection) {
    if (!current() || running || document.hidden) return;
    running = true; const serial = ++generation, controller = new AbortController(); request = controller;
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const value = validateDataManagement(projection || await load());
      let providers;
      try { providers = await readBrowserProviders({ kind: 'data', identity: getIdentity(), signal: controller.signal, fetchImpl, importModule, origin: location.origin }); }
      catch (error) {
        if (controller.signal.aborted) throw error;
        providers = (value.sources || []).filter(source => source.status === 'browser').map(source => ({ appId: source.appId, status: 'unavailable', items: [], message: { en: 'This browser source could not be refreshed.', zh: '此浏览器来源暂时无法刷新。' } }));
      }
      if (!current() || serial !== generation || request !== controller) return;
      renderDataManagement(container, mergeBrowserInventory(value, providers));
    } catch {
      if (!current() || serial !== generation || request !== controller) return;
      container.replaceChildren(el('p', 'section-note', t('Could not refresh data locations. Try again.', '暂时无法刷新数据位置，请重试。')));
      const retry = el('button', 'quiet-button', t('Retry', '重试')); retry.type = 'button'; retry.addEventListener('click', () => void refresh()); container.append(retry);
    } finally { clearTimeout(timeout); if (request === controller) request = null; running = false; }
  }
  const resume = () => { if (!document.hidden) void refresh(); };
  const interval = setInterval(resume, intervalMs);
  document.addEventListener('visibilitychange', resume); window.addEventListener('praxis-app-directory-change', resume); window.addEventListener('storage', resume);
  renderDataManagement(container, initial); void refresh(initial);
  return { refresh, destroy() { destroyed = true; generation++; request?.abort(); clearInterval(interval); document.removeEventListener('visibilitychange', resume); window.removeEventListener('praxis-app-directory-change', resume); window.removeEventListener('storage', resume); } };
}
