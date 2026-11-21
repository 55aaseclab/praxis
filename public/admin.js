import { appNames, loadAppFacts, grantApps, entryApps, clearAppFacts } from './app-registry.js';
import { message as t, locale } from './i18n.js';
const language = locale() === 'en' ? 'en' : 'zh-CN';
const base = '/api/business/admin', accountBase = '/api/business/account';
const actionNames = { read: t("Read", "读取"), create: t("Create", "新增"), update: t("Update", "修改"), complete: t("Complete", "完成"), delete: t("Delete", "删除"), submit: t("Submit corrections", "提交校正"), assign: t("Assign tasks", "分配任务"), manage_members: t("Manage members", "管理成员"), manage_sharing: t("Manage sharing", "管理共享"), manage_delegation: t("Manage delegations", "管理委托") };
const titles = { spaces: t('Spaces', '空间'), general: t('General', '通用'), overview: t("Overview", "状态概览"), data: t("Data management", "数据管理"), mcp: 'MCP', users: t("Users", "用户"), access: t("App access", "入口权限"), grants: t("Agent delegations", "智能体委托") };
const errorNames = { INVALID_INPUT: t("Check the form fields.", "请检查输入内容。"), READ_TIMEOUT: t("Read timed out. Try again.", "读取超时，请重试。"), WRITE_TIMEOUT: t("Request timed out. Refresh to check whether it was saved.", "请求超时，尚未确认是否保存。请先刷新核对结果。"), INVALID_REQUEST: t("Check the form fields.", "请检查输入内容。"), NOT_FOUND: t("This record no longer exists. Refresh to continue.", "这条记录已不存在，请刷新。"), FORBIDDEN: t("This action is no longer permitted. Refresh to check your space access.", "当前无权执行此操作，请刷新核对空间权限。"), CONFLICT: t("Account already exists or its state changed. Check and try again.", "账号已存在或状态已变化，请检查后重试。"), LAST_ADMIN_REQUIRED: t("Keep at least one active platform administrator.", "至少需要保留一名启用的平台管理员。"), POLICY_BUSY: t("Authorization is being updated. Try again shortly.", "授权正在更新，请稍后重试。"), CSRF_REJECTED: t("Session changed. Sign in again.", "登录状态已变化，请重新登录。"), UNAVAILABLE: t("Service unavailable. Try again later.", "服务暂时不可用，请稍后重试。"), DATA_INVENTORY_UNAVAILABLE: t("Could not load data locations. Refresh to retry.", "暂时无法读取数据位置，请稍后刷新。"), ADMIN_DEFAULT_ACCESS: t("Platform administrators have access to all app entries.", "平台管理员默认拥有全部入口，无需单独授权。") };
errorNames.CONFIRMATION_REQUIRED = t('Type the displayed confirmation exactly to delete.', '请准确输入所显示的确认内容以删除。');
errorNames.SELF_DELETION_FORBIDDEN = t('You cannot delete your own account.', '不能删除自己的账号。');
errorNames.PERSONAL_SPACE_REQUIRED = t('Automatically created personal spaces cannot be deleted.', '自动创建的个人空间不能删除。');
const content = document.querySelector('#content'), notice = document.querySelector('#notice');
let session = null, users = [], nextCursor = null, selectedId = null, selectedGrantId = null, view = Object.hasOwn(titles, new URLSearchParams(location.search).get('view')) ? new URLSearchParams(location.search).get('view') : null, epoch = 0, ended = false, writing = false;
const initialRoute = new URLSearchParams(location.search);
let userDetailId = initialRoute.get('user');
document.querySelector('#create-user').remove();
let selectedSpaceId = initialRoute.get('space'), selectedAppId = initialRoute.get('app'), selectedSpaceUserId = null;
const spacesNavigation = document.createElement('button');
spacesNavigation.type = 'button'; spacesNavigation.className = 'nav-entry'; spacesNavigation.dataset.view = 'spaces'; spacesNavigation.dataset.sharedView = ''; spacesNavigation.hidden = true;
spacesNavigation.append(document.querySelector('[data-view="access"] .nav-icon').cloneNode(true), document.createTextNode(t('Spaces', '空间')));
document.querySelector('#navigation').append(spacesNavigation);
let expiryTimer, accessTimer, overview, overviewLoading, mcpView, mcpLoading, dataView, dataLoading, dataController, booting = false, bootRevision = 0, usersLoaded = false;
const controllers = new Set();
let writeFocus;
const knownUsers = new Map();
let closeConfirmation = () => {};
let pickerLoading = false;
const contextSelectionId = () => view === 'spaces' ? selectedSpaceUserId : selectionId();
const pickerUsers = () => {
  if (!session) return [];
  const own = users.find(user => user.id === session.user.id) || { ...session.user, enabled: true };
  const chosen = knownUsers.get(contextSelectionId());
  return [own, ...(chosen && chosen.id !== own.id && !users.some(user => user.id === chosen.id) ? [chosen] : []), ...users.filter(user => user.id !== own.id)];
};
const selectionId = () => view === 'grants' ? selectedGrantId : selectedId;
const selected = () => pickerUsers().find(user => user.id === selectionId());
function loadOverviewAsset(path, kind) {
  return new Promise(resolve => {
    const node = document.createElement(kind === 'style' ? 'link' : 'script');
    if (kind === 'style') { node.rel = 'stylesheet'; node.href = path; } else node.src = path;
    const timer = setTimeout(resolve, 5000), done = () => { clearTimeout(timer); resolve(); };
    node.addEventListener('load', done, { once: true }); node.addEventListener('error', done, { once: true });
    document.head.append(node);
  });
}
async function ensureOverview() {
  if (overview || ended || !session?.platformAdmin || view !== 'overview') return overview;
  if (!overviewLoading) overviewLoading = (async () => {
    await Promise.all([loadOverviewAsset('/platform.css', 'style'), loadOverviewAsset('/vendor/chartjs-4.6.1.umd.min.js', 'script')]);
    if (ended || !session?.platformAdmin || view !== 'overview') return null;
    let timer;
    const module = await Promise.race([import('./platform.js'), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Overview module unavailable.')), 5000); })]).finally(() => clearTimeout(timer));
    if (ended || !session?.platformAdmin || view !== 'overview') return null;
    overview = module.startPlatformOverview({ getIdentity: () => !ended && session?.platformAdmin && view === 'overview' ? session : null, onSessionRejected: status => terminal(status) });
    return overview;
  })().finally(() => { overviewLoading = null; });
  return overviewLoading;
}
async function ensureMcp() {
  if (mcpView || ended || !session?.platformAdmin || view !== 'mcp') return mcpView;
  if (!mcpLoading) mcpLoading = (async () => {
    await loadOverviewAsset('/admin-mcp.css', 'style');
    if (ended || !session?.platformAdmin || view !== 'mcp') return null;
    const module = await import('./admin-mcp.js');
    if (ended || !session?.platformAdmin || view !== 'mcp') return null;
    mcpView = module; return module;
  })().finally(() => { mcpLoading = null; });
  return mcpLoading;
}
async function ensureData() {
  if (dataView || ended || !session?.platformAdmin || view !== 'data') return dataView;
  if (!dataLoading) dataLoading = import('./admin-data.js').then(module => {
    if (ended || !session?.platformAdmin || view !== 'data') return null;
    dataView = module; return module;
  }).finally(() => { dataLoading = null; });
  return dataLoading;
}
function setSession(value) {
  if (typeof value?.platformAdmin !== 'boolean' || !value.user || typeof value.csrfToken !== 'string' || !value.access || !Array.isArray(value.access.apps) || !Array.isArray(value.capabilities)) { terminal(403); return false; }
  if (!Number.isSafeInteger(value.expiresAt) || value.expiresAt <= Date.now()) { terminal(401); return false; }
  if (session && (session.platformAdmin !== value.platformAdmin || session.user.id !== value.user.id)) {
    clearAppFacts();
    if (session.user.id !== value.user.id) view = null;
    epoch++; for (const controller of controllers) controller.abort(); overview?.clear();
    closeConfirmation(); users = []; knownUsers.clear(); nextCursor = null; selectedId = null; selectedGrantId = null; selectedSpaceId = null; selectedAppId = null; selectedSpaceUserId = null; usersLoaded = false; userDetailId = null; content.replaceChildren();
  }
  session = value; clearTimeout(expiryTimer); clearTimeout(accessTimer);
  if (!view || !value.platformAdmin && !['general', 'spaces', 'access', 'grants'].includes(view)) view = 'general';
  for (const node of document.querySelectorAll('[data-admin-only]')) node.hidden = !value.platformAdmin;
  for (const node of document.querySelectorAll('[data-shared-view]')) node.hidden = false;
  expiryTimer = setTimeout(() => terminal(401), Math.max(1, Math.min(value.expiresAt - Date.now(), 2147483647)));
  if (!value.platformAdmin && Number.isSafeInteger(value.access.expiresAt) && value.access.expiresAt > Date.now()) accessTimer = setTimeout(() => {
    epoch++; for (const controller of controllers) controller.abort();
    session = { ...session, access: { apps: [], prds: false, expiresAt: null }, capabilities: [] }; content.replaceChildren(); void boot();
  }, Math.min(value.access.expiresAt - Date.now(), 2147483647));
  return true;
}
function el(tag, className = '', text) { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node; }
function controlRow(...controls) { const row = el('div', 'control-row'); row.append(...controls); return row; }
function button(text, className, handler) { const node = el('button', className, text); node.type = 'button'; node.addEventListener('click', handler); return node; }
function message(text = '', kind = '') {
  if (kind === 'success') {
    if (!ended && !notice.classList.contains('error')) window.alert(text);
    return;
  }
  notice.replaceChildren(document.createTextNode(text)); notice.className = `notice ${kind}`;
}
function spaceHref(appId = null) {
  const query = new URLSearchParams({ view: 'spaces' });
  if (selectedSpaceId) query.set('space', selectedSpaceId);
  if (appId) query.set('app', appId);
  return `/admin/?${query}`;
}
function spaceLink(label, appId, className = 'quiet-button') {
  const link = el('a', className, label); link.href = spaceHref(appId);
  link.addEventListener('click', event => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    if (booting || writing || ended) return;
    selectedAppId = appId; history.pushState(null, '', link.href); void render().then(() => document.querySelector('#heading').focus());
  });
  return link;
}
function time(value) { if (value === null || value === undefined) return t("No expiry", "未设置期限"); const date = new Date(value); return Number.isNaN(date.valueOf()) ? t("Time unconfirmed", "时间待确认") : date.toLocaleString(language, { hour12: false }); }
function terminal(status, text) {
  if (ended) return;
  clearAppFacts();
  closeConfirmation();
  ended = true; epoch++; clearTimeout(expiryTimer); clearTimeout(accessTimer); session = null; users = []; knownUsers.clear(); nextCursor = null; selectedId = null; selectedGrantId = null;
  for (const controller of controllers) controller.abort();
  overview?.clear(); dataController?.destroy(); dataController = null; document.querySelector('#overview-controls').hidden = true;
  document.querySelector('#general-view').hidden = true;
  content.replaceChildren(); content.setAttribute('aria-busy', 'false');
  document.querySelector('#account-name').textContent = '';
  for (const node of document.querySelectorAll('[data-admin-only],[data-shared-view]')) node.hidden = true;
  for (const node of document.querySelectorAll('#navigation button, #refresh')) node.disabled = true;
  message(text || (status === 401 ? t("Your session expired. Sign in again.", "登录已失效，请重新登录。") : t("You do not have access to Settings.", "当前账号无权访问设置。")), 'error');
  const link = el('a', '', status === 401 ? t("Sign in", "登录") : t("Back to workbench", "回到工作台")); link.href = status === 401 ? '/auth/login?return_to=%2Fadmin%2F' : '/'; notice.append(link);
}
async function api(path, { method = 'GET', body } = {}) {
  const requestEpoch = epoch;
  const controller = new AbortController(); controllers.add(controller);
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(path.startsWith('/api/') ? path : base + path, { method, cache: 'no-store', mode: 'same-origin', credentials: 'same-origin', redirect: 'error', referrerPolicy: 'same-origin', signal: controller.signal, headers: { Accept: 'application/json', ...(method === 'GET' ? {} : { 'Content-Type': 'application/json', 'X-CSRF-Token': session?.csrfToken || '' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    let value; try { value = await response.json(); } catch {}
    if (response.status === 401 || response.status === 403 && !path.startsWith(`${accountBase}/spaces`)) { if (requestEpoch === epoch) terminal(response.status); throw Object.assign(new Error('Management session rejected.'), { stale: requestEpoch !== epoch }); }
    if (!response.ok) throw Object.assign(new Error('Administration request failed.'), { code: value?.code, status: response.status, stale: requestEpoch !== epoch, ownedSpaces: value?.ownedSpaces });
    return value;
  } catch (error) {
    if (error.name === 'AbortError' && requestEpoch === epoch && !ended) throw Object.assign(new Error('Management request timed out.'), { code: method === 'GET' ? 'READ_TIMEOUT' : 'WRITE_TIMEOUT' });
    throw error;
  } finally { clearTimeout(timeout); controllers.delete(controller); }
}
function report(error) {
  if (!ended && !error.stale && error.code === 'OWNED_SPACES_REQUIRED') {
    message(t('Delete the owned spaces first, then retry deleting this user: {0}', '请先删除以下自有空间，再重试删除此用户：{0}', (error.ownedSpaces || []).map(space => space.id).join(', ')), 'error'); return;
  }
  if (!ended && !error.stale && error.name !== 'AbortError') message(errorNames[error.code] || t("Could not complete this operation. Try again.", "暂时无法完成操作，请稍后重试。"), 'error'); }
function setBusy(value) {
  if (value) {
    const active = document.activeElement;
    writeFocus = content.contains(active) ? { node: active, tag: active.tagName, name: active.name, text: active.textContent, scope: [view, selectedSpaceId, selectedAppId, selectionId()].join('/') } : null;
  }
  writing = value; for (const node of content.querySelectorAll('button, input, select')) node.disabled = value; document.querySelector('#refresh').disabled = value;
  if (!value && writeFocus) {
    if (writeFocus.scope === [view, selectedSpaceId, selectedAppId, selectionId()].join('/')) {
      const target = writeFocus.node.isConnected ? writeFocus.node : [...content.querySelectorAll('button,input,select,a')].find(node => node.tagName === writeFocus.tag && (writeFocus.name ? node.name === writeFocus.name : node.textContent === writeFocus.text));
      target?.focus({ preventScroll: true });
    }
    writeFocus = null;
  }
}
async function mutate(path, options, success) {
  if (booting || writing || ended || !session?.platformAdmin) return;
  const current = epoch;
  setBusy(true); message();
  try {
    const value = await api(path, options);
    if (ended || current !== epoch) return;
    if (value?.sessionInvalidated) { terminal(401, t("Account updated. Sign in again.", "账号状态已更新，请重新登录。")); return; }
    await success(value);
  } catch (error) { report(error); }
  finally { if (!ended) setBusy(false); }
}
function field(label, name, type = 'text') {
  const root = el('label', 'field'), input = el('input'); input.name = name; input.type = type;
  root.append(el('span', '', label), input); return { root, input };
}
function openConfirmation(box, label, initialFocus) {
  closeConfirmation();
  const trigger = document.activeElement, dialog = el('dialog', 'confirm-dialog');
  dialog.setAttribute('aria-label', label);
  dialog.append(box); document.body.append(dialog);
  const close = () => {
    dialog.close(); dialog.remove();
    if (trigger?.isConnected) trigger.focus({ preventScroll: true });
    if (closeConfirmation === close) closeConfirmation = () => {};
  };
  closeConfirmation = close;
  dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
  dialog.addEventListener('keydown', event => {
    if (event.key !== 'Tab') return;
    const controls = [...dialog.querySelectorAll('button,input,select,a[href]')].filter(node => !node.disabled && node.getClientRects().length);
    const first = controls[0], last = controls.at(-1);
    if (event.shiftKey && document.activeElement === first || !event.shiftKey && document.activeElement === last) {
      event.preventDefault(); (event.shiftKey ? last : first)?.focus({ preventScroll: true });
    }
  });
  const outside = event => {
    const rect = dialog.getBoundingClientRect();
    return event.target === dialog && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom);
  };
  let backdropPressed = false;
  dialog.addEventListener('pointerdown', event => { backdropPressed = outside(event); });
  dialog.addEventListener('click', event => { if (backdropPressed && outside(event)) close(); });
  const position = [scrollX, scrollY];
  initialFocus.autofocus = true;
  dialog.showModal(); initialFocus.focus({ preventScroll: true });
  scrollTo(...position);
  return close;
}
function confirmAction(parent, text, action) {
  const box = el('div', 'confirm-box'), actions = el('div', 'actions');
  const cancelButton = button(t("Cancel", "取消"), 'quiet-button', () => close());
  actions.append(button(t("Confirm", "确认"), 'danger-button', () => { const current = parent.isConnected; close(); if (current) action(); }), cancelButton);
  box.append(el('p', '', text), actions);
  const close = openConfirmation(box, t("Confirm action", "确认操作"), cancelButton);
}
function userPath(user, suffix = '') { return `/users/${encodeURIComponent(user.id)}${suffix}`; }
function updateUser(user) { knownUsers.set(user.id, user); const index = users.findIndex(value => value.id === user.id); if (index >= 0) users[index] = user; else users.push(user); }
function forgetUser(id) {
  users = users.filter(user => user.id !== id); knownUsers.delete(id);
  if (selectedId === id) selectedId = null;
  if (selectedGrantId === id) selectedGrantId = null;
  if (selectedSpaceUserId === id) selectedSpaceUserId = null;
}
function picker(options = pickerUsers(), value = selectionId(), change = id => { if (view === 'grants') selectedGrantId = id; else selectedId = id; void render(); }) {
  const root = el('div', 'user-context'), label = el('label', 'user-picker'), select = el('select'); select.id = 'selected-user';
  label.append(el('span', '', t("Current user", "当前用户")), select); root.append(label);
  for (const user of options) {
    const option = el('option', '', `${user.username}${user.enabled === false ? t(" (disabled)", "（已停用）") : ''}`); option.value = user.id; select.append(option);
  }
  select.value = value;
  select.addEventListener('change', () => { if (!writing && !booting && !ended && !pickerLoading) change(select.value); else select.value = value; });
  if (nextCursor && ['spaces', 'grants'].includes(view)) root.append(button(t('Load more users', '加载更多用户'), 'quiet-button pagination', async () => {
    if (writing || booting || ended || pickerLoading) return;
    const current = epoch, activeView = view;
    pickerLoading = true; content.setAttribute('aria-busy', 'true');
    for (const control of root.querySelectorAll('button,select')) control.disabled = true;
    try {
      const result = await api(`/users?limit=50&after=${encodeURIComponent(nextCursor)}`);
      if (ended || current !== epoch || activeView !== view) return;
      for (const user of result.users) updateUser(user); nextCursor = result.nextCursor;
      await render();
    } catch (error) { report(error); }
    finally {
      pickerLoading = false;
      for (const control of root.querySelectorAll('button,select')) control.disabled = writing;
      if (current === epoch) content.setAttribute('aria-busy', 'false');
    }
  }));
  return root;
}
function userHref(id = null) {
  const query = new URLSearchParams({ view: 'users' });
  if (id) query.set('user', id);
  return `/admin/?${query}`;
}
function userLink(label, id = null, className = 'quiet-button') {
  const link = el('a', className, label); link.href = userHref(id);
  link.addEventListener('click', event => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    if (booting || writing || ended) return;
    userDetailId = id; history.pushState(null, '', link.href);
    void render().then(() => document.querySelector('#heading').focus());
  });
  return link;
}
function createForm() {
  const panel = el('section', 'editor form-panel'); panel.setAttribute('aria-label', t('New user', '新用户'));
  const form = el('form'), fields = controlRow();
  const username = field(t("Account", "账号"), 'username'), password = field(t("Initial password", "初始密码"), 'password', 'password');
  username.input.required = true; username.input.maxLength = 200; username.input.autocomplete = 'off';
  password.input.required = true; password.input.minLength = 12; password.input.maxLength = 1024; password.input.autocomplete = 'new-password';
  fields.append(username.root, password.root); const submit = el('button', 'primary', t("Create user", "创建用户")); submit.type = 'submit';
  fields.append(submit);
  form.append(fields, el('p', 'section-note', t("Set app access, business permissions and administrator privileges separately after creating a user.", "新用户默认没有平台管理、应用入口或业务数据权限。创建后再分别授权。")));
  form.addEventListener('submit', event => {
    event.preventDefault(); const body = { username: username.input.value.trim(), password: password.input.value };
    void mutate('/users', { method: 'POST', body }, value => {
      updateUser(value.user); userDetailId = value.user.id; history.pushState(null, '', userHref(userDetailId)); renderUsers();
      document.querySelector('#heading').focus(); message(t("User created. Set their app access as needed.", "用户已创建，请按需设置入口权限。"), 'success');
    });
  }); panel.append(el('h2', '', t('New user', '新用户')), form); return panel;
}
function confirmUserDeletion(parent, user) {
  const box = el('form', 'confirm-box user-delete-confirm');
  box.append(el('p', '', t('Permanently delete this user? This cannot be undone. Their sessions, agent delegations and consent scopes, memberships, resource permissions and app entry policy will be removed.', '永久删除此用户？此操作无法撤销，将移除其登录会话、智能体委托与授权范围、成员关系、资源权限及应用入口配置。')),
    el('p', '', t('Their automatically created personal space will also be removed. App data files remain for operator cleanup. Other owned spaces must be deleted first in Spaces.', '自动创建的个人空间将随账号移除，应用数据文件保留，由运维另行清理。其他自有空间须先在空间管理中删除。')),
    el('p', 'user-identity', user.username));
  const confirmation = field(t('Type the exact username to confirm', '输入准确的用户名以确认'), 'confirmUsername');
  confirmation.input.autocomplete = 'off'; confirmation.input.spellcheck = false; confirmation.input.required = true;
  const submit = el('button', 'danger-button', t('Delete user permanently', '永久删除用户')); submit.type = 'submit'; submit.disabled = true;
  confirmation.input.addEventListener('input', () => { submit.disabled = writing || confirmation.input.value !== user.username; });
  box.append(controlRow(confirmation.root, submit), button(t('Cancel', '取消'), 'quiet-button', () => close()));
  box.addEventListener('submit', event => {
    event.preventDefault(); if (confirmation.input.value !== user.username || !parent.isConnected) return;
    close();
    void mutate(userPath(user), { method: 'DELETE', body: { confirmUsername: confirmation.input.value } }, async () => {
      forgetUser(user.id);
      selectedSpaceId = null; selectedAppId = null; userDetailId = null;
      history.replaceState(null, '', userHref()); renderUsers();
      const value = await api('/users?limit=50');
      users = value.users; for (const current of users) knownUsers.set(current.id, current); nextCursor = value.nextCursor;
      renderUsers(); document.querySelector('#heading').focus(); message(t('User deleted.', '用户已删除。'), 'success');
    });
  });
  const close = openConfirmation(box, t('Confirm user deletion', '确认删除用户'), confirmation.input);
}
function accountEditor(user) {
  const panel = el('section', 'editor form-panel'); panel.setAttribute('aria-label', t("Account settings", "账号设置"));
  panel.append(el('h2', '', t('Account details', '账号详情')), el('p', 'user-identity', t('User ID: {0}', '用户 ID：{0}', user.id)), el('p', 'section-note', t("Administrators can open all apps. Business records still require access to their space and resources.", "平台管理员默认拥有全部应用入口；业务记录仍按所属空间与当前授权范围访问。")));
  for (const type of ['enabled', 'platformAdmin']) {
    const row = el('div', 'account-setting'), description = el('div');
    description.append(el('strong', '', type === 'enabled' ? t("Account status", "账号状态") : t("Platform administrator", "平台管理员")), el('span', 'meta', type === 'enabled' ? user.enabled ? t("Enabled", "已启用") : t("Disabled", "已停用") : user.platformAdmin ? t("Yes", "是") : t("No", "否")));
    const label = type === 'enabled' ? user.enabled ? t("Disable account", "停用账号") : t("Enable account", "启用账号") : user.platformAdmin ? t("Remove administrator role", "移除管理员") : t("Grant administrator role", "设为管理员");
    const action = () => void mutate(userPath(user, type === 'platformAdmin' ? '/platform-admin' : ''), { method: type === 'platformAdmin' ? 'PUT' : 'PATCH', body: { enabled: !user[type] } }, value => { updateUser(value.user); renderUsers(); message(t("Account settings updated.", "账号设置已更新。"), 'success'); });
    row.append(description, button(label, user[type] ? 'danger-button' : 'quiet-button', () => confirmAction(panel, `${label}：${user.username}。${type === 'enabled' && user.enabled ? t("This user will lose access to sign-in and delegated operations.", "该用户将无法继续登录或使用其授权。") : type === 'platformAdmin' ? t("Platform management and business permissions are separate.", "平台管理权限与业务权限分别生效。") : ''}`, action))); panel.append(row);
  }
  const passwordForm = el('form', 'password-form'), password = field(t("New password", "新密码"), 'password', 'password');
  password.input.required = true; password.input.minLength = 12; password.input.maxLength = 1024; password.input.autocomplete = 'new-password';
  const submit = el('button', 'quiet-button', t("Reset password", "重置密码")); submit.type = 'submit';
  passwordForm.append(el('h3', '', t("Reset password", "重置密码")), controlRow(password.root, submit), el('p', 'section-note', t("Use at least 12 characters. The user must sign in again after a reset.", "至少12个字符。重置后，该用户需要重新登录。")));
  passwordForm.addEventListener('submit', event => { event.preventDefault(); const body = { password: password.input.value }; void mutate(userPath(user, '/password'), { method: 'POST', body }, () => { renderUsers(); message(t("Password reset.", "密码已重置。"), 'success'); }); });
  panel.append(passwordForm);
  const deletion = el('section', 'editor user-deletion'); deletion.append(el('h3', '', t('Delete user', '删除用户')));
  if (user.id === session.user.id) deletion.append(el('p', 'section-note', t('You cannot delete your own account.', '不能删除自己的账号。')));
  else deletion.append(el('p', 'section-note', t('Deleting this account immediately withdraws its access. This cannot be undone.', '删除账号后将立即撤销其访问权限，此操作无法撤销。')), button(t('Delete user', '删除用户'), 'danger-button', () => confirmUserDeletion(panel, user)));
  panel.append(deletion); return panel;
}
function renderUsers() {
  content.replaceChildren();
  if (userDetailId) {
    const user = knownUsers.get(userDetailId);
    content.append(userLink(t('Back to users', '返回用户列表')));
    document.querySelector('#heading').textContent = user?.username || titles.users;
    if (user) content.append(accountEditor(user));
    return;
  }
  document.querySelector('#heading').textContent = titles.users;
  content.append(createForm());
  const section = el('section', 'editor user-collection');
  section.append(el('h2', '', t('Registered users', '已注册用户')), el('p', 'section-note', t("Manage sign-in accounts and administrators. Configure app access and agent delegations separately.", "管理登录账号与平台管理员身份。应用入口和智能体委托分别设置。")));
  const list = el('ul', 'user-list');
  for (const user of users) {
    const row = el('li', 'user-row'); row.dataset.user = user.id;
    const summary = el('div', 'user-summary'); summary.append(el('strong', 'user-name', user.username), el('span', 'meta', `${user.enabled ? t("Enabled", "已启用") : t("Disabled", "已停用")}${user.platformAdmin ? t(" · Administrator", " · 平台管理员") : ''}${session?.user.id === user.id ? t(" · Current account", " · 当前账号") : ''}`));
    const manage = userLink(t('Manage', '管理'), user.id); manage.setAttribute('aria-label', t('Manage {0}', '管理 {0}', user.username));
    row.append(summary, manage); list.append(row);
  }
  section.append(users.length ? list : el('p', 'empty', t("No users.", "暂无用户。")));
  if (nextCursor) section.append(button(t("Load more users", "加载更多用户"), 'quiet-button pagination', async () => { const current = epoch; try { const value = await api(`/users?limit=50&after=${encodeURIComponent(nextCursor)}`); if (ended || current !== epoch || view !== 'users' || userDetailId) return; for (const user of value.users) updateUser(user); nextCursor = value.nextCursor; renderUsers(); } catch (error) { report(error); } }));
  content.append(section);
}
function check(label, name, value) {
  const root = el('label', 'check-field'), input = el('input'); input.type = 'checkbox'; input.name = name; input.checked = value === true; root.append(input, el('span', '', label)); return { root, input };
}
function localDate(value) { if (value === null || value === undefined) return ''; const date = new Date(value); return new Date(date.valueOf() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16); }
function renderAccess(user, access) {
  if (access.source === 'administrator') {
    content.append(el('p', 'section-note', t("Platform administrators can open every app, the workbench and product documents.", "平台管理员默认拥有全部应用、工作台与 PRD集合入口，无需单独授权。")), el('p', 'access-status', t("Apps: {0}", "应用：{0}", entryApps().map(app => appNames[app.id] || app.name).join('、'))));
    const link = el('a', 'inline-link', t("Open workbench", "打开工作台")); link.href = '/'; content.append(link); return;
  }
  content.append(el('p', 'section-note', t("Each signed-in user has a workbench. These settings control which apps and documents they can open. Business resource access and agent delegations are separate.", "每位用户登录后都有自己的工作台。这里设置可打开的应用与文档，不授予业务记录权限，也不代替智能体委托。")));
  content.append(el('p', 'access-status', access.configured ? t("Access expires: {0}", "授权期限：{0}", access.expiresAt === null ? t("No expiry", "不设期限") : time(access.expiresAt)) : t("No app or document entries configured.", "尚未配置应用或文档入口。")));
  const form = el('form', 'form-panel'), apps = el('fieldset', 'access-group'), appGrid = el('div', 'checkbox-grid'); apps.append(el('legend', '', t("Apps", "应用")));
  const checks = grantApps().map(app => { const id = app.id; const entry = check(appNames[id] || app.name, id, access.apps?.includes(id)); appGrid.append(entry.root); return [id, entry.input]; }); apps.append(appGrid);
  const workspace = el('fieldset', 'access-group'), workspaceGrid = el('div', 'checkbox-grid'); workspace.append(el('legend', '', t("Documents", "文档")));
  const prds = check(t("Product documents", "PRD集合"), 'prds', access.prds); workspaceGrid.append(prds.root); workspace.append(workspaceGrid);
  const expiry = field(t("Expires on", "有效期至"), 'expiresAt', 'datetime-local'); expiry.input.value = localDate(access.expiresAt);
  const submit = el('button', 'primary', t("Save app access", "保存入口权限")); submit.type = 'submit'; form.append(apps, workspace, controlRow(expiry.root, submit), el('p', 'section-note', t("Leave blank for access without an expiry date.", "留空表示不设期限。")));
  form.addEventListener('submit', event => {
    event.preventDefault(); const expiresAt = expiry.input.value ? new Date(expiry.input.value).valueOf() : null;
    if (expiresAt !== null && (!Number.isSafeInteger(expiresAt) || expiresAt <= Date.now())) { message(t("Choose a future expiration date.", "请选择未来的有效期。"), 'error'); return; }
    void mutate(userPath(user, '/web-access'), { method: 'PUT', body: { apps: checks.filter(([, input]) => input.checked).map(([id]) => id), workbench: true, prds: prds.input.checked, expiresAt } }, async () => { await render(); message(t("App access saved.", "入口权限已保存。"), 'success'); });
  }); content.append(form);
}
function renderOwnAccess() {
  const access = session.access;
  const panel = el('section', 'own-access'); panel.id = 'own-access';
  panel.append(el('p', 'section-note', t("Here are your app entries and agent capabilities. Manage space apps and resource permissions in Spaces.", "这里展示当前账号的应用入口与智能体能力。空间应用与资源权限可在“空间”中管理。")));
  panel.append(el('p', 'access-status', t("Product documents: {0}{1}", "PRD集合：{0}{1}", access.prds ? t("Available", "可访问") : t("Not granted", "未获准"), access.apps.length || access.prds ? t("; expires: {0}", "；入口期限：{0}", access.expiresAt === null ? t("No expiry", "不设期限") : time(access.expiresAt)) : '')));
  const apps = session.capabilities.filter(app => access.apps.includes(app.appId));
  if (!apps.length) { panel.append(el('p', 'empty', t("No app access yet. Create a space and enable an app in Spaces, or ask your space owner for resource permissions.", "当前暂无应用访问权限。可在“空间”中创建空间并启用应用，或请空间所有者授予资源权限。"))); content.append(panel); return; }
  const table = el('table', 'own-access-table'); table.id = 'own-access-table';
  const head = el('thead'), row = el('tr');
  for (const title of [t("Apps", "应用"), t("Current permissions", "当前权限")]) { const cell = el('th', '', title); cell.scope = 'col'; row.append(cell); }
  head.append(row); table.append(head); const body = el('tbody');
  for (const app of apps) {
    const row = el('tr'); row.dataset.app = app.appId;
    const name = el('th', '', app.name || appNames[app.appId] || t("Other apps", "其他应用")); name.scope = 'row';
    const cell = el('td'); cell.append(el('span', 'permission-line', t("Web: accessible", "网页：可访问")), el('span', 'permission-line', t("Agent: {0}", "智能体：{0}", ({ available: t("Available for delegation", "可授权"), unsupported: t("Agent actions unavailable", "暂未提供智能体操作"), no_resources: t("No resources available to delegate", "暂无可授权资源"), unavailable: t("Integration unavailable for delegation", "能力尚未接入，暂不可授权") })[app.availability] || t("Status unconfirmed", "状态待确认"))));
    if (app.availability === 'available') {
      const actions = app.actions.map(action => actionNames[action] || t("Other operations", "其他操作")).join('、');
      const spaces = Number.isSafeInteger(app.spaceCount) && app.spaceCount >= 0 ? t("Scopes: {0}", "{0}个授权范围", app.spaceCount) : t("Scope count unconfirmed", "范围数量待确认");
      const resources = app.allResources ? t("All permitted resources in scope", "范围内全部获准资源") : Number.isSafeInteger(app.resourceCount) && app.resourceCount >= 0 ? t("Resources: {0}", "{0}项资源", app.resourceCount) : t("Resource count unconfirmed", "资源数量待确认");
      cell.append(el('span', 'meta', actions || t("No actions available to delegate", "暂无可授权操作")), el('span', 'meta', `${spaces}；${resources}`));
    }
    row.append(name, cell); body.append(row);
  }
  table.append(body); panel.append(table); content.append(panel);
}
async function revokeOwnGrant(id) {
  if (ended || writing || !session || session.platformAdmin) return;
  const current = epoch; setBusy(true); message();
  try { await api(`${accountBase}/grants/${encodeURIComponent(id)}`, { method: 'DELETE' }); if (!ended && current === epoch) { await render(); message(t("Delegation revoked.", "委托已撤销。"), 'success'); } }
  catch (error) { report(error); }
  finally { if (!ended) setBusy(false); }
}
function renderGrants(user, value, own = false) {
  content.append(el('p', 'section-note', own ? t("View delegations granted to external agents. Current permissions are checked on every action; a grant alone does not establish a successful connection.", "这里展示你授予外部智能体的委托。授权记录不代表已经连接或成功调用；每次操作仍受你当前的应用与数据权限限制。") : t("Agents receive a delegation through OAuth and user consent. Current business permissions apply. Revocation stops further use of the grant.", "智能体通过 OAuth 登录与用户确认获得委托；委托范围仍受当前业务权限限制。撤销后，该智能体不能继续使用这份委托。")));
  content.append(grantList(value.grants, own));
  if (value.nextCursor) content.append(button(t("Load more delegations", "加载更多委托"), 'quiet-button pagination', async () => { const current = epoch; try { const more = await api(own ? `${accountBase}/grants?limit=50&after=${encodeURIComponent(value.nextCursor)}` : userPath(user, `/grants?limit=50&after=${encodeURIComponent(value.nextCursor)}`)); if (ended || current !== epoch || !own && selectionId() !== user.id || view !== 'grants') return; const combined = { grants: [...value.grants, ...more.grants], nextCursor: more.nextCursor }; content.replaceChildren(); if (!own) content.append(picker()); renderGrants(user, combined, own); } catch (error) { report(error); } }));
}
function grantList(grants, own = false, scoped = false) {
  const list = el('ul', 'grant-list');
  for (const grant of grants) {
    const row = el('li', 'grant-row'), summary = el('div', 'control-summary'), controls = controlRow(summary), heading = el('div', 'grant-heading');
    row.dataset.grant = grant.id;
    const revoked = grant.revokedAt != null, expired = grant.expiresAt <= Date.now();
    const status = grant.status || (revoked ? 'revoked' : expired ? 'expired' : 'current'); row.dataset.status = status;
    heading.append(el('strong', '', grant.client.name), el('span', 'grant-status', ({ current: t("Unexpired", "未到期"), restricted: t("Scope restricted", "范围已受限"), expired: t("Expired", "已到期"), revoked: t("Revoked", "已撤销") })[status] || t("Status unconfirmed", "状态待确认")));
    const identifiers = el('div', 'grant-identifiers meta');
    const addIdentifier = (label, value, className) => {
      const line = el('div'); line.append(el('span', '', label + ': '), el('code', className, value)); identifiers.append(line);
    };
    addIdentifier(t('Delegation ID', '委托 ID'), grant.id, 'grant-id');
    const spaceIds = grant.spaceIds;
    for (const spaceId of spaceIds) addIdentifier(t('Space ID', '空间 ID'), spaceId, 'grant-space-id');
    if (!spaceIds.length) identifiers.append(el('span', '', t('No recorded spaces.', '暂无空间记录。')));
    row.append(heading, identifiers, controls);
    if (scoped) summary.append(el('strong', '', grant.username || grant.userId));
    summary.append(el('span', 'meta', t("Expires {0}", "有效期至 {0}", time(grant.expiresAt))));
    if (scoped) summary.append(el('p', 'meta', t('Recorded scope in this app and space; current permissions apply on every action.', '此应用在本空间内的已记录范围；每次操作仍受当前权限限制。')));
    if (own && ['expired', 'revoked'].includes(status)) summary.append(el('p', 'meta', t("Historical grant scope; current permissions may differ.", "以下为历史授权范围，不代表当前可用权限。")));
    if (own && status === 'restricted') summary.append(el('p', 'meta', t("App or resource access changed. The list shows the actions currently available.", "应用或资源权限已变化，当前可用操作以所列范围为准。")));
    const scopes = el('ul', 'grant-scopes');
    for (const scope of grant.scopes) { const actions = scope.actions.map(action => actionNames[action] || t("Other capabilities", "其他能力")).join('、'); const resources = scope.allResources ? t("Permitted resources in scope", "范围内获准资源") : Number.isSafeInteger(scope.resourceCount) ? t("Resources: {0}", "{0}项资源", scope.resourceCount) : t("Resource scope unconfirmed", "资源范围待确认"); scopes.append(el('li', '', t("{0}: {1}; scopes: {2}, {3}", "{0}：{1}；{2}个范围，{3}", appNames[scope.appId] || t("Other apps", "其他应用"), actions, scope.spaceCount, resources))); }
    summary.append(grant.scopes.length ? scopes : el('p', 'meta', own && !['expired', 'revoked'].includes(status) ? t("No actions currently available.", "当前暂无可用操作。") : t("No recorded scopes.", "暂无范围记录。")));
    if (!revoked && (!scoped || grant.canRevoke)) controls.append(button(t("Revoke delegation", "撤销委托"), 'danger-button', () => confirmAction(row, t("Revoke this entire delegation for {0}? Access through it will stop across all apps and spaces.", "撤销 {0} 的整份委托？通过此委托访问的全部应用与空间权限都将停止。", grant.client.name), () => session.platformAdmin ? void mutate(`/grants/${encodeURIComponent(grant.id)}`, { method: 'DELETE' }, async () => { await render(); message(t("Delegation revoked.", "委托已撤销。"), 'success'); }) : void revokeOwnGrant(grant.id))));
    list.append(row);
  }
  return grants.length ? list : el('p', 'empty', t("No agent delegations.", "暂无智能体委托。"));
}
function appAccessSummary(app) {
  const actions = app.availableActions || [];
  return actions.length ? t('Available actions: {0}. Resources: {1}', '可用操作：{0}。资源：{1}', actions.map(action => actionNames[action] || action).join(', '), (app.availableResources || []).join(', ')) : t('No business resource access.', '无业务资源访问权限。');
}

const spaceTypeName = type => ({ personal: t('Personal', '个人'), family: t('Family', '家庭'), company: t('Team', '团队') })[type] || t('Space', '空间');
const spaceLabel = space => `${spaceTypeName(space.type)} · ${space.id.slice(0, 8)}`;
const spacePath = suffix => `${accountBase}/spaces/${encodeURIComponent(selectedSpaceId)}${suffix}`;
function confirmSpaceDeletion(parent, space) {
  const box = el('form', 'confirm-box space-delete-confirm');
  box.dataset.spaceId = space.id; box.setAttribute('aria-label', t('Confirm space deletion', '确认删除空间'));
  box.append(el('p', '', t('Permanently delete this space? This cannot be undone. Access to this space stops immediately. The following will be removed:', '永久删除此空间？此操作无法撤销，空间访问将立即停止。以下内容将被移除：')));
  const removed = el('ul', 'space-delete-effects');
  for (const text of [t('All space memberships and resource permissions', '全部空间成员关系与资源权限'), t('Agent delegation rules and consent scopes referencing this space', '引用此空间的智能体委托规则与授权范围'), t('App enrollments and the web entries granted by this space', '空间应用启用记录及其授予的网页入口')]) removed.append(el('li', '', text));
  box.append(removed, el('p', '', t('App data files are retained for operator cleanup. Other spaces, accounts and independent permissions are preserved.', '应用数据文件保留，由运维另行清理。其他空间、账号及独立权限将保留。')));
  const confirmation = field(t('Type the full space ID to confirm', '输入完整空间 ID 以确认'), 'confirmSpaceId');
  confirmation.input.autocomplete = 'off'; confirmation.input.spellcheck = false; confirmation.input.required = true;
  const identity = el('p', 'space-delete-id', space.id); box.append(identity);
  const submit = el('button', 'danger-button', t('Delete space permanently', '永久删除空间')); submit.type = 'submit'; submit.disabled = true;
  confirmation.input.addEventListener('input', () => { submit.disabled = writing || confirmation.input.value !== space.id; });
  box.append(controlRow(confirmation.root, submit), button(t('Cancel', '取消'), 'quiet-button', () => close()));
  box.addEventListener('submit', event => {
    event.preventDefault(); if (confirmation.input.value !== space.id || !parent.isConnected) return;
    close();
    void mutateSpace(`${accountBase}/spaces/${encodeURIComponent(space.id)}`, { method: 'DELETE', body: { confirmSpaceId: confirmation.input.value } }, t('Space deleted.', '空间已删除。'), () => {
      selectedSpaceId = null; selectedAppId = null; history.replaceState(null, '', spaceHref()); content.replaceChildren();
    }).then(() => {
      if (!ended && view === 'spaces' && !notice.classList.contains('error')) (content.querySelector('select[name=space]') || document.querySelector('#heading')).focus();
    });
  });
  const close = openConfirmation(box, t('Confirm space deletion', '确认删除空间'), confirmation.input);
}
function selectField(label, name, choices) {
  const root = el('label', 'field'), input = el('select'); input.name = name;
  for (const choice of choices) { const option = el('option', '', choice.label); option.value = choice.value; input.append(option); }
  root.append(el('span', '', label), input); return { root, input };
}
async function mutateSpace(path, options, text, after) {
  if (booting || writing || ended || !session || view !== 'spaces') return;
  const current = epoch; setBusy(true); message();
  try {
    const value = await api(path, options);
    if (ended || current !== epoch) return;
    after?.(value); const rendered = epoch + 1; await render();
    if (!ended && epoch === rendered && !notice.classList.contains('error')) message(text, 'success');
  } catch (error) { report(error); }
  finally { if (!ended) setBusy(false); }
}
async function renderSpaces(current, preserve) {
  if (session.platformAdmin && !selectedSpaceUserId) selectedSpaceUserId = session.user.id;
  const contextUserId = selectedSpaceUserId;
  const contextPicker = () => picker(pickerUsers(), selectedSpaceUserId, id => {
    selectedSpaceUserId = id; selectedSpaceId = null; selectedAppId = null;
    history.replaceState(null, '', spaceHref()); void render();
  });
  const displayQuery = session.platformAdmin ? `?contextUserId=${encodeURIComponent(contextUserId)}` : '';
  if (!preserve) {
    if (session.platformAdmin) content.append(contextPicker());
    content.append(el('p', 'loading', t('Loading spaces…', '正在读取空间…')));
  }
  const value = await api(`${accountBase}/spaces${displayQuery}`);
  if (ended || current !== epoch || view !== 'spaces') return;
  const spaces = value.spaces;
  if (!spaces.some(space => space.id === selectedSpaceId)) {
    selectedSpaceId = spaces[0]?.id || null; selectedAppId = null;
    history.replaceState(null, '', spaceHref());
  }
  let detail = selectedSpaceId ? await api(spacePath('') + (session.platformAdmin && contextUserId !== session.user.id ? `?contextUserId=${encodeURIComponent(contextUserId)}` : '')) : null;
  if (ended || current !== epoch || view !== 'spaces') return;
  // Keep the acting session's capabilities separate from the display projection.
  const capabilities = { canDelete: Boolean(detail?.space.canDelete), canManage: detail?.space.ownerId === session.user.id, displayContext: session.platformAdmin && contextUserId !== session.user.id };
  content.replaceChildren();
  let displayedUserId = session.user.id;
  if (session.platformAdmin) {
    const context = detail?.userContext || detail?.userContexts?.find(context => context.user.id === selectedSpaceUserId);
    displayedUserId = selectedSpaceUserId;
    if (detail && displayedUserId !== session.user.id && context?.user.id !== displayedUserId) throw Object.assign(new Error('Display context unavailable.'), { code: 'UNAVAILABLE' });
    if (context) detail = context;
    content.append(contextPicker());
    if (displayedUserId !== session.user.id) content.append(el('p', 'section-note', t('Viewing {0}. Actions still use your signed-in account’s permissions.', '正在查看 {0} 的视图。操作仍使用你登录账号的权限。', context?.user.username || knownUsers.get(displayedUserId)?.username || displayedUserId)));
  }
  if (detail && selectedAppId) { renderSpaceApp(detail, capabilities); return; }
  const create = el('form', 'editor form-panel'), type = selectField(t('Space type', '空间类型'), 'type', ['personal', 'family', 'company'].map(value => ({ value, label: spaceTypeName(value) })));
  const submit = el('button', 'primary', t('Create space', '创建空间')); submit.type = 'submit';
  create.append(el('h2', '', t('New space', '新空间')), el('p', 'section-note', t('Enable apps and grant resource permissions after creating a space. Personal spaces have no other members.', '创建后再启用应用并授予资源权限。个人空间不能添加其他成员。')), controlRow(type.root, submit));
  create.addEventListener('submit', event => {
    event.preventDefault();
    void mutateSpace(`${accountBase}/spaces`, { method: 'POST', body: { type: type.input.value } }, t('Space created. Enable apps to continue.', '空间已创建，请按需启用应用。'), result => { selectedSpaceId = result.id; selectedAppId = null; history.replaceState(null, '', spaceHref()); });
  });
  content.append(create);
  if (detail) {
    const { space, apps, members } = detail;
    const panel = el('section', 'space-overview'), context = el('div', 'space-section');
    const picker = selectField(t('Current space', '当前空间'), 'space', spaces.map(space => ({ value: space.id, label: spaceLabel(space) })));
    picker.input.value = selectedSpaceId;
    picker.input.addEventListener('change', () => { selectedSpaceId = picker.input.value; selectedAppId = null; history.pushState(null, '', spaceHref()); void render(); });
    const selection = controlRow(picker.root);
    if (capabilities.canDelete) selection.append(button(t('Delete space', '删除空间'), 'danger-button space-delete', () => confirmSpaceDeletion(context, space)));
    context.append(selection);
    if (space.deletionProtected) context.append(el('p', 'section-note', t('Automatically created personal spaces cannot be deleted.', '自动创建的个人空间不能删除。')));
    panel.append(context);
    const memberSection = el('section', 'space-section'); memberSection.append(el('h2', '', t('Members', '成员')));
    const memberList = el('ul', 'user-list');
    for (const member of members) {
      const row = el('li', 'user-row'), description = el('div', 'user-summary'); row.dataset.member = member.userId;
      description.append(el('strong', 'user-name', member.username || member.userId), el('span', 'meta', member.userId === space.ownerId ? t('Owner', '所有者') : t('Member', '成员'))); row.append(description);
      if (capabilities.canManage && member.userId !== space.ownerId) row.append(button(t('Remove', '移除'), 'danger-button', () => confirmAction(row, t('Remove this member and their access to this space?', '移除此成员及其空间权限？'), () => void mutateSpace(spacePath(`/members/${encodeURIComponent(member.userId)}`), { method: 'DELETE' }, t('Member removed.', '成员已移除。')))));
      memberList.append(row);
    }
    memberSection.append(memberList);
    if (capabilities.canManage && space.type !== 'personal') {
      const form = el('form', 'form-panel'), username = field(t('Registered username', '已注册的用户名'), 'username'); username.input.required = true; username.input.maxLength = 64; username.input.autocomplete = 'off';
      const add = el('button', 'quiet-button', t('Add member', '添加成员')); add.type = 'submit';
      form.append(controlRow(username.root, add), el('p', 'section-note', t('Adding a member grants no resource permissions. Enabled web-entry-only apps are available to space members.', '添加成员不会自动授予资源权限。成员可打开已启用的仅网页入口应用。')));
      form.addEventListener('submit', event => { event.preventDefault(); void mutateSpace(spacePath('/members'), { method: 'POST', body: { username: username.input.value.trim(), role: 'member' } }, t('Member added. Grant permissions as needed.', '成员已添加，请按需授予权限。')); }); memberSection.append(form);
    }
    panel.append(memberSection);
    const appSection = el('section', 'space-section'); appSection.append(el('h2', '', t('Space apps', '空间应用')));
    appSection.append(el('p', 'section-note', !capabilities.canManage && capabilities.displayContext ? t('All installed apps are listed. Open an app to view its enrollment and resource permissions.', '这里列出全部已安装应用。打开应用可查看启用状态与资源权限。') : t('All installed apps are listed. Manage each app’s enrollment and permissions separately.', '这里列出全部已安装应用。进入管理页，分别设置应用的启用状态与权限。')));
    for (const app of apps) {
      const row = el('div', 'account-setting space-app-row'), description = el('div'); row.dataset.app = app.id;
      description.append(el('strong', '', app.name || app.id), el('span', 'meta', app.enabled ? t('Enabled', '已启用') : t('Disabled', '未启用')), el('span', 'meta app-capability', app.supportsBusinessActions ? t('Agent business actions supported', '支持智能体业务操作') : t('Web entry only · No agent business actions', '仅网页入口 · 不支持智能体业务操作')));
      if (app.supportsBusinessActions) description.append(el('span', 'meta app-user-access', appAccessSummary(app)));
      const manage = spaceLink(t('Manage', '管理'), app.id); manage.setAttribute('aria-label', t('Manage {0}', '管理 {0}', app.name || app.id));
      row.append(description, manage); appSection.append(row);
    }
    if (!apps.length) appSection.append(el('p', 'empty', t('No installed apps available.', '暂无可启用的已安装应用。')));
    panel.append(appSection); content.append(panel);
  }
  if (!detail) content.append(el('p', 'empty', t('No spaces yet.', '暂无空间。')));
}
function renderSpaceApp({ space, apps, members, permissions, delegations = [] }, { canManage, displayContext }) {
  const app = apps.find(app => app.id === selectedAppId);
  const context = el('div', 'space-app-context'); context.append(spaceLink(t('Back to Spaces', '返回空间'), null, 'link-button space-back'), el('p', 'meta', spaceLabel(space))); content.append(context);
  if (!app) { content.append(el('p', 'empty', t('This app is no longer installed. Return to Spaces to choose another app.', '此应用已不再安装，请返回空间选择其他应用。'))); return; }
  document.querySelector('#heading').textContent = app.name || app.id;
  const enrollment = el('section', 'editor'); enrollment.dataset.app = app.id;
  enrollment.append(el('h2', '', t('App enrollment', '应用启用状态')));
  const row = el('div', 'account-setting'), description = el('div');
  description.append(el('strong', '', app.name || app.id), el('span', 'meta', app.enabled ? t('Enabled', '已启用') : t('Disabled', '未启用'))); row.append(description);
  if (canManage && app.enrollmentAllowed !== false) {
    const change = () => void mutateSpace(spacePath(`/apps/${encodeURIComponent(app.id)}`), { method: 'PUT', body: { enabled: !app.enabled } }, app.enabled ? t('App disabled for this space.', '已停用此空间的应用。') : app.supportsBusinessActions ? t('App enabled. Grant resource permissions as needed.', '应用已启用，请按需授予资源权限。') : t('App enabled. Space members can open its web entry.', '应用已启用，空间成员可打开网页入口。'));
    row.append(button(app.enabled ? t('Disable', '停用') : t('Enable', '启用'), app.enabled ? 'danger-button' : 'quiet-button', () => app.enabled ? confirmAction(row, t('Disable this app for the space? Its current access and delegations will stop.', '停用此空间的应用？当前访问和委托将停止。'), change) : change()));
  }
  enrollment.append(row);
  let note = app.supportsBusinessActions ? t('Agent business actions supported. Enrollment and resource permissions are separate; grant only the required actions below.', '支持智能体业务操作。启用应用与资源授权分开进行，请在下方仅授予所需操作。') : t('Web entry only. Enabling this app lets space members open it; it grants no agent business actions.', '仅网页入口。启用后空间成员可打开此应用，不授予智能体业务操作。');
  if (app.supportsBusinessActions && !canManage && displayContext) note = t('Agent business actions supported. App enrollment and resource permissions are shown separately.', '支持智能体业务操作。应用启用状态与资源权限分开展示。');
  if (app.enrollmentAllowed === false) note = app.entryPolicy === 'document-owner' ? t('Web entry only. This app is restricted to its configured document owner; space enrollment cannot grant entry.', '仅网页入口。此应用仅限配置的文档所有者，空间启用不能授予入口。') : app.entryPolicy === 'platform-admin' ? t('Web entry only. This app requires a platform administrator; space enrollment cannot grant entry.', '仅网页入口。此应用需要平台管理员身份，空间启用不能授予入口。') : t('Agent business actions are declared, but this installation has no configured business adapter. Enrollment is unavailable.', '应用声明支持智能体业务操作，但当前安装尚未配置业务适配，暂不能启用。');
  enrollment.append(el('p', 'section-note', note)); content.append(enrollment);
  if (!app.supportsBusinessActions) return;
  enrollment.append(el('p', 'meta app-user-access', appAccessSummary(app)));
  const delegationSection = el('section', 'editor space-delegations');
  delegationSection.append(el('h2', '', t('Agent delegations', '智能体委托')), grantList(delegations.filter(grant => grant.scopes.some(scope => scope.appId === app.id)).map(grant => ({ ...grant, scopes: grant.scopes.filter(scope => scope.appId === app.id) })), !session.platformAdmin, true));
  content.append(delegationSection);
  const permissionSection = el('section', 'editor'); permissionSection.append(el('h2', '', t('Resource permissions', '资源权限')));
  const scopedPermissions = permissions.filter(permission => permission.appId === app.id), permissionList = el('ul', 'grant-list');
  for (const permission of scopedPermissions) {
    const memberName = members.find(member => member.userId === permission.userId)?.username || permission.userId;
    const item = el('li', 'grant-row'), summary = el('div', 'control-summary'), controls = controlRow(summary); item.append(controls); item.dataset.permission = permission.id;
    summary.append(el('strong', '', memberName), el('span', 'meta', permission.actions.map(action => actionNames[action] || action).join(', ')), el('span', 'meta', permission.resources.includes('*') ? t('All resources in this app and space', '此应用在本空间内的所有资源') : t('Resources: {0}', '资源：{0}', permission.resources.join(', '))));
    if (canManage) controls.append(button(t('Revoke permission', '撤销权限'), 'danger-button', () => confirmAction(item, t('Revoke this resource permission?', '撤销此资源权限？'), () => void mutateSpace(spacePath(`/permissions/${encodeURIComponent(permission.id)}`), { method: 'DELETE' }, t('Permission revoked.', '权限已撤销。')))));
    permissionList.append(item);
  }
  permissionSection.append(scopedPermissions.length ? permissionList : el('p', 'empty', t('No resource permissions granted.', '尚未授予资源权限。'))); content.append(permissionSection);
  if (!canManage || !app.enabled || app.businessAvailable === false) return;
  const grantSection = el('section', 'editor'); grantSection.append(el('h2', '', t('Grant permission', '授予权限')));
  const form = el('form', 'form-panel'), person = selectField(t('Member', '成员'), 'userId', members.map(member => ({ value: member.userId, label: member.username || member.userId })));
  const resources = field(t('Resource IDs (comma-separated, or * for all)', '资源 ID（逗号分隔，* 表示全部）'), 'resources'); resources.input.required = true; resources.input.maxLength = 8000;
  const actions = el('fieldset', 'access-group'); actions.append(el('legend', '', t('Allowed actions', '允许的操作'))); const checks = el('div', 'checkbox-grid'); actions.append(checks);
  for (const action of app.actions) checks.append(check(actionNames[action] || action, action, false).root);
  const grant = el('button', 'primary', t('Grant resource permission', '授予资源权限')); grant.type = 'submit';
  form.append(person.root, actions, controlRow(resources.root, grant));
  form.addEventListener('submit', event => {
    event.preventDefault(); const selectedActions = [...checks.querySelectorAll('input:checked')].map(input => input.name), selectedResources = [...new Set(resources.input.value.split(',').map(value => value.trim()).filter(Boolean))];
    if (!selectedActions.length || !selectedResources.length) { message(t('Choose at least one action and resource.', '请至少选择一项操作并填写资源。'), 'error'); return; }
    void mutateSpace(spacePath('/permissions'), { method: 'POST', body: { userId: person.input.value, appId: app.id, resources: selectedResources, actions: selectedActions } }, t('Resource permission granted.', '资源权限已授予。'));
  });
  grantSection.append(form); content.append(grantSection);
}
async function render({ preserve = writing && content.childElementCount > 0 } = {}) {
  const position = preserve ? { x: scrollX, y: scrollY } : null;
  try { await renderView(preserve); }
  finally { if (position && !ended) scrollTo(position.x, position.y); }
}
async function renderView(preserve) {
  closeConfirmation();
  if (ended || !session) return;
  if (!session.platformAdmin && !['general', 'spaces', 'access', 'grants'].includes(view)) view = 'general';
  overview?.clear(); dataController?.destroy(); dataController = null;
  document.querySelector('#overview-controls').hidden = view !== 'overview' || ended;
  document.querySelector('#refresh').hidden = view === 'overview' || view === 'general';
  document.querySelector('#general-view').hidden = view !== 'general';
  content.hidden = view === 'overview' || view === 'general';
  const current = ++epoch; if (!preserve) content.replaceChildren(); content.setAttribute('aria-busy', 'true');
  if (!preserve || view !== 'spaces' || !selectedAppId) document.querySelector('#heading').textContent = titles[view]; document.querySelector('#heading').tabIndex = -1;
  for (const node of document.querySelectorAll('[data-view]')) { if (node.dataset.view === view) node.setAttribute('aria-current', 'page'); else node.removeAttribute('aria-current'); }
  if (view === 'general') { content.setAttribute('aria-busy', 'false'); return; }
  if (view === 'overview') {
    try { const controller = await ensureOverview(); if (!ended && current === epoch && session?.platformAdmin && view === 'overview') controller?.updateAccess(); }
    catch { if (!ended && current === epoch) message(t("Could not read the overview. Refresh to retry.", "暂时无法读取状态概览，请稍后刷新。"), 'error'); }
    finally { if (current === epoch) content.setAttribute('aria-busy', 'false'); }
    return;
  }
  if (view === 'spaces') {
    try { await renderSpaces(current, preserve); }
    catch (error) { if (current === epoch && !ended) { content.querySelector('.loading')?.remove(); report(error); } }
    finally { if (current === epoch) content.setAttribute('aria-busy', 'false'); }
    return;
  }
  if (!session.platformAdmin) {
    if (view === 'access') { renderOwnAccess(); content.setAttribute('aria-busy', 'false'); return; }
    if (!preserve) content.append(el('p', 'loading', t("Loading…", "正在读取…")));
    try { const value = await api(`${accountBase}/grants?limit=50`); if (ended || current !== epoch || session.platformAdmin) return; content.replaceChildren(); renderGrants(session.user, value, true); }
    catch (error) { if (current === epoch && !ended) { content.querySelector('.loading')?.remove(); report(error); } }
    finally { if (current === epoch) content.setAttribute('aria-busy', 'false'); }
    return;
  }
  if (view === 'data') {
    if (!preserve) content.append(el('p', 'loading', t("Loading…", "正在读取…")));
    try {
      const [module, value] = await Promise.all([ensureData(), api('/api/business/console/data')]);
      if (ended || current !== epoch || !session?.platformAdmin || view !== 'data') return;
      dataController = module?.mountDataManagement(content, { initial: value, load: () => api('/api/business/console/data'), getIdentity: () => !ended && session?.platformAdmin && view === 'data' ? { userId: session.user.id, username: session.user.username } : null });
    } catch (error) { if (current === epoch && !ended) { content.querySelector('.loading')?.remove(); report(error); } }
    finally { if (current === epoch) content.setAttribute('aria-busy', 'false'); }
    return;
  }
  if (view === 'mcp') {
    if (!preserve) content.append(el('p', 'loading', t("Loading…", "正在读取…")));
    try {
      const [module, value] = await Promise.all([ensureMcp(), api('/mcp')]);
      if (ended || current !== epoch || !session?.platformAdmin || view !== 'mcp') return;
      module?.renderMcpManagement(content, value);
    } catch (error) { if (current === epoch && !ended) { content.querySelector('.loading')?.remove(); report(error); } }
    finally { if (current === epoch) content.setAttribute('aria-busy', 'false'); }
    return;
  }
  if (view === 'users') {
    try {
      if (userDetailId) {
        const id = userDetailId, value = await api(userPath({ id }));
        if (ended || current !== epoch || view !== 'users' || userDetailId !== id) return;
        knownUsers.set(id, value.user);
      }
      renderUsers();
    } catch (error) {
      if (!ended && current === epoch) { if (error.status === 404) forgetUser(userDetailId); else knownUsers.delete(userDetailId); renderUsers(); report(error); }
    } finally { if (current === epoch) content.setAttribute('aria-busy', 'false'); }
    return;
  }
  if (!selected()) { if (view === 'grants') selectedGrantId = session.user.id; else selectedId = users[0]?.id || session.user.id; }
  const user = selected();
  if (!user) { content.append(el('p', 'empty', t("Create a user first.", "请先新增用户。"))); content.setAttribute('aria-busy', 'false'); return; }
  if (!preserve) content.append(picker(), el('p', 'loading', t("Loading…", "正在读取…")));
  try {
    const value = await api(userPath(user, view === 'access' ? '/web-access' : '/grants?limit=50'));
    if (ended || current !== epoch || !session.platformAdmin) return;
    content.replaceChildren(picker()); if (view === 'access') renderAccess(user, value.webAccess); else renderGrants(user, value);
  } catch (error) { if (current === epoch && !ended) { content.querySelector('.loading')?.remove(); report(error); } }
  finally { if (current === epoch) content.setAttribute('aria-busy', 'false'); }
}
async function boot() {
  if (writing || ended) return;
  const loading = ++bootRevision; booting = true;
  for (const node of document.querySelectorAll('#navigation button, #create-user, #refresh')) node.disabled = true;
  overview?.clear();
  let current = ++epoch; if (!session) content.replaceChildren(); content.setAttribute('aria-busy', 'true'); if (!content.childElementCount && !notice.classList.contains('error')) message(t("Loading…", "正在读取…"));
  try {
    const metadata = await api(`${accountBase}/session`); if (ended || current !== epoch) return;
    if (!setSession(metadata)) return; current = epoch;
    await loadAppFacts(); if (ended || current !== epoch) return;
    document.querySelector('#account-name').textContent = session.user.username;
    if (session.platformAdmin && ['users', 'access', 'grants', 'spaces'].includes(view)) {
      const result = await api('/users?limit=50'); if (ended || current !== epoch) return;
      users = result.users; knownUsers.clear(); for (const user of users) knownUsers.set(user.id, user); nextCursor = result.nextCursor;
      // Revalidate retained off-page selections: another administrator may have
      // deleted an account since this page last loaded.
      for (const id of new Set([selectedId, selectedGrantId, selectedSpaceUserId].filter(id => id && !knownUsers.has(id)))) {
        try {
          const value = await api(userPath({ id }));
          if (ended || current !== epoch) return;
          knownUsers.set(id, value.user);
        } catch (error) {
          if (ended || current !== epoch) return;
          if (error.status !== 404) throw error;
          forgetUser(id);
        }
      }
      usersLoaded = true; if (!selected()) { if (view === 'grants') selectedGrantId = null; else selectedId = null; }
    }
    if (!notice.classList.contains('error')) message(); await render({ preserve: content.childElementCount > 0 });
  } catch (error) { if ([401, 403].includes(error.status)) terminal(error.status); else report(error); if (!ended) content.setAttribute('aria-busy', 'false'); }
  finally {
    if (loading === bootRevision) {
      booting = false;
      if (!ended) for (const node of document.querySelectorAll('#navigation button, #create-user, #refresh')) node.disabled = writing;
    }
  }
}
for (const node of document.querySelectorAll('[data-view]')) node.addEventListener('click', () => { if (booting || writing || ended || !session || ['overview', 'users', 'mcp', 'data'].includes(node.dataset.view) && !session.platformAdmin) return; view = node.dataset.view; userDetailId = null; selectedAppId = null; history.pushState(null, '', `/admin/?view=${view}`); if (session.platformAdmin && ['users', 'access', 'grants', 'spaces'].includes(view) && !usersLoaded) void boot(); else void render(); });
document.querySelector('#refresh').addEventListener('click', () => { message(); void boot(); });
addEventListener('popstate', () => {
  if (writing || ended || !session) return;
  const route = new URLSearchParams(location.search);
  view = Object.hasOwn(titles, route.get('view')) ? route.get('view') : 'general';
  selectedSpaceId = route.get('space'); selectedAppId = route.get('app'); userDetailId = route.get('user');
  if (session.platformAdmin && ['users', 'access', 'grants', 'spaces'].includes(view) && !usersLoaded) void boot(); else void render();
});
content.addEventListener('input', event => {
  if (event.target.form) event.target.form.dataset.edited = 'true';
});
async function resumeView() {
  if (ended || writing || document.visibilityState === 'hidden') return;
  if (!session || !content.querySelector('form[data-edited="true"]')) return boot();
  const current = epoch, previous = session;
  try {
    const value = await api(accountBase + '/session');
    if (ended || current !== epoch) return;
    if (!setSession(value)) return;
    if (previous.user.id !== session.user.id || previous.csrfToken !== session.csrfToken || previous.platformAdmin !== session.platformAdmin) await boot();
  } catch (error) {
    if (!ended && current === epoch) await boot();
  }
}
document.addEventListener('visibilitychange', () => void resumeView());
addEventListener('pageshow', event => { if (event.persisted && !ended) void boot(); });
setInterval(async () => { if (ended || writing || document.visibilityState === 'hidden') return; const current = epoch; try { const value = await api(`${accountBase}/session`); if (!ended && current === epoch) { const wasAdmin = session?.platformAdmin, wasUser = session?.user.id; if (setSession(value)) { if (wasAdmin !== session.platformAdmin || wasUser !== session.user.id) void boot(); else if (!session.platformAdmin && view === 'access') void render(); } } } catch (error) { report(error); } }, 30000);
void boot();

document.querySelector('[data-language-preference]').addEventListener('change', () => location.reload());
