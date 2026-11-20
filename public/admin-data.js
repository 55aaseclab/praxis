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
const copyControls = new WeakMap(), renderedInventories = new WeakMap();
let activePreview = null, previewId = 0;
const copyIcons = {
  idle: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/>',
  copying: '<path d="M5 12h.01M12 12h.01M19 12h.01" stroke-width="3"/>',
  copied: '<path d="m5 12 4 4L19 6"/>',
  error: '<path d="M12 5v9m0 4h.01"/>',
};
function copyValueControl(value, displayed = value, label = '') {
  const wrapper = el('span', 'data-copy-value'), button = el('button', 'data-path-copy');
  const mark = el('span', 'data-copy-mark'), tooltip = el('span', 'data-value-tooltip');
  const full = el('code', 'data-value-full', value), note = el('span', 'data-copy-note');
  const announcement = el('span', 'data-copy-announcement');
  button.type = 'button'; button.dataset.dataPath = value; button.dataset.dataLabel = label;
  button.setAttribute('aria-label', t('Copy full value: ', '复制完整内容：') + displayed);
  tooltip.id = 'data-value-preview-' + ++previewId; tooltip.hidden = true; tooltip.setAttribute('role', 'tooltip');
  button.setAttribute('aria-describedby', tooltip.id); mark.setAttribute('aria-hidden', 'true');
  announcement.setAttribute('role', 'status'); announcement.setAttribute('aria-live', 'polite'); announcement.setAttribute('aria-atomic', 'true');
  note.hidden = true; tooltip.append(full, note); button.append(el('code', 'data-path', displayed), mark); wrapper.append(button, tooltip, announcement);
  let busy = false, resetTimer, hideTimer, dismissed = false, listening = false;
  function state(value) {
    if (button.dataset.copyState === value) return;
    button.dataset.copyState = value;
    mark.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' + copyIcons[value] + '</svg>';
  }
  function position() {
    if (tooltip.hidden) return;
    if (!button.isConnected) { hide(); return; }
    const edge = 12, gap = 6, anchor = button.getBoundingClientRect();
    if (anchor.bottom < 0 || anchor.top > innerHeight) { hide(); return; }
    tooltip.style.maxWidth = Math.max(1, Math.min(576, innerWidth - edge * 2)) + 'px';
    tooltip.style.maxHeight = Math.max(1, innerHeight - edge * 2) + 'px';
    const bounds = tooltip.getBoundingClientRect();
    const below = anchor.bottom + gap, above = anchor.top - gap - bounds.height;
    const top = below + bounds.height <= innerHeight - edge || above < edge ? below : above;
    tooltip.style.left = Math.max(edge, Math.min(anchor.left, innerWidth - edge - bounds.width)) + 'px';
    tooltip.style.top = Math.max(edge, Math.min(top, innerHeight - edge - bounds.height)) + 'px';
  }
  function escape(event) { if (event.key === 'Escape') { dismissed = true; hide(); } }
  function outside(event) { if (!wrapper.contains(event.target)) { dismissed = true; hide(); } }
  function hide() {
    clearTimeout(hideTimer); tooltip.hidden = true;
    if (activePreview === hide) activePreview = null;
    if (listening) { window.removeEventListener('resize', position); window.removeEventListener('scroll', position, true); document.removeEventListener('keydown', escape); document.removeEventListener('pointerdown', outside); listening = false; }
  }
  function show() {
    clearTimeout(hideTimer); if (dismissed || !button.isConnected) return;
    if (activePreview && activePreview !== hide) activePreview();
    activePreview = hide; tooltip.hidden = false; position();
    if (!listening) { window.addEventListener('resize', position); window.addEventListener('scroll', position, true); document.addEventListener('keydown', escape); document.addEventListener('pointerdown', outside); listening = true; }
  }
  wrapper.addEventListener('pointerenter', () => { dismissed = false; show(); });
  tooltip.addEventListener('pointerenter', () => clearTimeout(hideTimer));
  wrapper.addEventListener('pointerleave', () => {
    dismissed = false;
    hideTimer = setTimeout(() => { if (!wrapper.contains(document.activeElement)) hide(); }, 120);
  });
  wrapper.addEventListener('focusin', () => { dismissed = false; show(); });
  wrapper.addEventListener('focusout', event => { if (!wrapper.contains(event.relatedTarget)) { dismissed = false; hide(); } });
  button.addEventListener('click', async () => {
    if (busy) return;
    busy = true; clearTimeout(resetTimer); dismissed = false; show();
    button.setAttribute('aria-busy', 'true'); announcement.textContent = '';
    if (button.dataset.copyState !== 'copied') state('copying');
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(value);
      else {
        const input = document.createElement('textarea'); input.value = value;
        input.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;opacity:0;pointer-events:none';
        document.body.append(input);
        try { input.focus({ preventScroll: true }); input.select(); if (!document.execCommand('copy')) throw new Error('Clipboard unavailable.'); }
        finally { input.remove(); if (button.isConnected) button.focus({ preventScroll: true }); }
      }
      if (!button.isConnected) return;
      note.hidden = true; note.textContent = ''; state('copied'); announcement.textContent = t('Value copied', '内容已复制');
      resetTimer = setTimeout(() => { state('idle'); }, 1800);
    } catch {
      if (!button.isConnected) return;
      state('error'); note.textContent = t('Could not copy. Select this full value and copy it manually.', '复制未完成，可选择此完整内容手动复制。'); note.hidden = false;
      announcement.textContent = note.textContent;
      if (!dismissed && (wrapper.matches(':hover') || wrapper.contains(document.activeElement))) show();
    } finally { busy = false; button.removeAttribute('aria-busy'); position(); }
  });
  copyControls.set(button, () => { clearTimeout(resetTimer); hide(); });
  state('idle'); return wrapper;
}
function disposeCopyControls(container) {
  for (const button of container.querySelectorAll?.('.data-path-copy') || []) copyControls.get(button)?.();
}
function pathLine(label, value, workspaceRoot) {
  const line = el('div', 'data-location');
  const displayed = label === t('Host', '宿主机') ? formatDataPath(value, workspaceRoot) : value;
  line.append(el('span', 'data-location-label', label), copyValueControl(value, displayed, label));
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
  const fingerprint = JSON.stringify([locale(), { ...value, generatedAt: undefined }]), previous = renderedInventories.get(container);
  if (previous?.fingerprint === fingerprint && previous.node === container.firstChild && previous.node?.parentNode === container) {
    if (previous.time) { previous.time.dateTime = value.generatedAt; previous.time.textContent = new Date(value.generatedAt).toLocaleString(locale() === 'en' ? 'en' : 'zh-CN', { hour12: false }); }
    return;
  }
  const focusedPath = container.contains?.(document.activeElement) ? document.activeElement?.dataset?.dataPath : null;
  const panel = container.closest?.('main'), panelTop = panel?.scrollTop;
  const pageTop = document.scrollingElement?.scrollTop;
  const fragment = document.createDocumentFragment();
  fragment.append(el('p', 'section-note', t('Browse application data locations. Browser data stays in the browser used for that app.', '查看各应用的数据位置。浏览器本地数据保存在使用该应用的浏览器中。')));
  if (value.workspaceRoot) { const hint = el('p', 'meta data-workspace-hint'); hint.append(copyValueControl(value.workspaceRoot, '$WORKSPACE', 'workspace'), document.createTextNode(t(' is the current workspace. Hover or focus a value to see it in full; click to copy.', ' 表示当前工作区。悬停或聚焦可查看完整内容，点击可复制。'))); fragment.append(hint); }
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
  disposeCopyControls(container);
  container.replaceChildren(fragment);
  renderedInventories.set(container, { fingerprint, node: container.firstChild, time });
  if (focusedPath) [...container.querySelectorAll('.data-path-copy')].find(button => button.dataset.dataPath === focusedPath)?.focus({ preventScroll: true });
  if (panel && panelTop !== undefined) panel.scrollTop = panelTop;
  if (document.scrollingElement && pageTop !== undefined) document.scrollingElement.scrollTop = pageTop;
}
export function mountDataManagement(container, { initial, load, getIdentity, intervalMs = 30000, fetchImpl = fetch, importModule } = {}) {
  let destroyed = false, running = false, request, generation = 0;
  const owner = getIdentity()?.userId;
  renderedInventories.delete(container);
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
  return { refresh, destroy() { destroyed = true; generation++; disposeCopyControls(container); renderedInventories.delete(container); request?.abort(); clearInterval(interval); document.removeEventListener('visibilitychange', resume); window.removeEventListener('praxis-app-directory-change', resume); window.removeEventListener('storage', resume); } };
}
