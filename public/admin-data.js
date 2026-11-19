import { message as t, locale } from './i18n.js';
const language = locale() === 'en' ? 'en' : 'zh-CN';
const kindNames = { json: t("JSON file", "JSON 文件"), sqlite: t("SQLite database", "SQLite 数据库"), directory: t("Directory", "目录"), browser: t("Browser storage", "浏览器本地存储"), 'docker-volume': t("Docker volume", "Docker 数据卷"), source: t("Stored with the app source", "随应用源码保存"), cache: t("Cache", "缓存"), unknown: t("Unregistered", "未登记") };
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
  if (location.hostPath) cell.append(pathLine(t("Host", "宿主机"), location.hostPath, workspaceRoot));
  if (location.containerPath) cell.append(pathLine(t("Container", "容器"), location.containerPath));
  if (location.volumeName) cell.append(pathLine(t("Volume", "数据卷"), location.volumeName));
  if (location.storageKey) cell.append(pathLine(t("Storage key", "存储键"), location.storageKey));
  if (!cell.children.length) cell.append(el('span', 'meta', t("Unregistered location", "未登记位置")));
  if (location.description) cell.append(el('p', 'data-description', location.description));
  return cell;
}
export function renderDataManagement(container, value) {
  if (value?.workspaceRoot !== undefined && typeof value.workspaceRoot !== 'string') throw new Error('Invalid workspace root.');
  if (value?.schemaVersion !== 1 || typeof value.generatedAt !== 'string' || Number.isNaN(Date.parse(value.generatedAt)) || !Array.isArray(value.apps) || value.apps.length > 64) throw new Error('Invalid data inventory projection.');
  for (const app of value.apps) {
    if (typeof app.id !== 'string' || typeof app.name !== 'string' || !Array.isArray(app.locations) || app.locations.length > 32) throw new Error('Invalid data inventory application.');
    for (const location of app.locations) if (!location || typeof location.label !== 'string' || !Object.hasOwn(kindNames, location.kind) || ['hostPath', 'containerPath', 'volumeName', 'storageKey', 'description'].some(key => location[key] !== undefined && typeof location[key] !== 'string')) throw new Error('Invalid data inventory location.');
  }
  const fragment = document.createDocumentFragment();
  fragment.append(el('p', 'section-note', t("Browse application data locations. Browser data stays in the browser used for that app.", "查看各应用的数据位置。浏览器本地数据保存在使用该应用的浏览器中。")));
  if (value.workspaceRoot) { const hint = el('p', 'meta data-workspace-hint', t("$WORKSPACE is the current workspace. Click a path to copy its full address.", "$WORKSPACE 表示当前工作区，点击路径可复制完整地址。")); hint.title = value.workspaceRoot; fragment.append(hint); }
  const updated = el('p', 'meta data-updated');
  updated.append(document.createTextNode(t("Updated ", "更新于 ")));
  const time = el('time', '', new Date(value.generatedAt).toLocaleString(language, { hour12: false })); time.dateTime = value.generatedAt; updated.append(time); fragment.append(updated);
  if (!value.apps.length) { fragment.append(el('p', 'empty', t("No application data locations registered.", "尚未登记应用数据位置。"))); container.replaceChildren(fragment); return; }
  const table = el('table', 'own-access-table data-table');
  table.append(el('caption', '', t("Application data locations", "应用数据位置")));
  const head = el('thead'), headings = el('tr');
  for (const text of [t("App", "应用"), t("Data", "数据"), t("Location", "位置")]) { const cell = el('th', '', text); cell.scope = 'col'; headings.append(cell); }
  head.append(headings); table.append(head);
  for (const app of value.apps) {
    const body = el('tbody'); body.dataset.dataApp = app.id;
    const locations = app.locations.length ? app.locations : [{ label: t("Business data", "业务数据"), kind: 'unknown' }];
    locations.forEach((location, index) => {
      const row = el('tr');
      if (!index) { const name = el('th', 'data-app-name', app.name); name.scope = 'rowgroup'; name.rowSpan = locations.length; row.append(name); }
      const label = el('td'); label.append(el('span', 'data-item-label', location.label), el('span', 'meta', kindNames[location.kind]));
      row.append(label, locationCell(location, value.workspaceRoot)); body.append(row);
    });
    table.append(body);
  }
  fragment.append(table); container.replaceChildren(fragment);
}
