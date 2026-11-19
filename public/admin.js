import { message as t, locale } from './i18n.js';
const language = locale() === 'en' ? 'en' : 'zh-CN';
const base = '/api/business/admin', accountBase = '/api/business/account';
const appNames = { reminder: 'Reminder', travel: 'Travel', knowledge: 'Knowledge', memo: 'Memo', 'lattice-slides': 'Slides', tingproof: t("TingProof", "听校"), projects: 'Projects', finance: 'Finance', intelligence: 'Intelligence', 'matrix-reader': 'Matrix Reader', calendar: 'Calendar' };
const actionNames = { read: t("Read", "读取"), create: t("Create", "新增"), update: t("Update", "修改"), complete: t("Complete", "完成"), delete: t("Delete", "删除"), submit: t("Submit corrections", "提交校正"), assign: t("Assign tasks", "分配任务"), manage_members: t("Manage members", "管理成员"), manage_sharing: t("Manage sharing", "管理共享"), manage_delegation: t("Manage delegations", "管理委托") };
const titles = { overview: t("Overview", "状态概览"), data: t("Data management", "数据管理"), mcp: 'MCP', users: t("Users", "用户"), access: t("App access", "入口权限"), grants: t("Agent delegations", "智能体委托") };
const errorNames = { INVALID_INPUT: t("Check the form fields.", "请检查输入内容。"), READ_TIMEOUT: t("Read timed out. Try again.", "读取超时，请重试。"), WRITE_TIMEOUT: t("Request timed out. Refresh to check whether it was saved.", "请求超时，尚未确认是否保存。请先刷新核对结果。"), INVALID_REQUEST: t("Check the form fields.", "请检查输入内容。"), NOT_FOUND: t("This record no longer exists. Refresh to continue.", "这条记录已不存在，请刷新。"), CONFLICT: t("Account already exists or its state changed. Check and try again.", "账号已存在或状态已变化，请检查后重试。"), LAST_ADMIN_REQUIRED: t("Keep at least one active platform administrator.", "至少需要保留一名启用的平台管理员。"), POLICY_BUSY: t("Authorization is being updated. Try again shortly.", "授权正在更新，请稍后重试。"), CSRF_REJECTED: t("Session changed. Sign in again.", "登录状态已变化，请重新登录。"), UNAVAILABLE: t("Service unavailable. Try again later.", "服务暂时不可用，请稍后重试。"), DATA_INVENTORY_UNAVAILABLE: t("Could not load data locations. Refresh to retry.", "暂时无法读取数据位置，请稍后刷新。"), ADMIN_DEFAULT_ACCESS: t("Platform administrators have access to all app entries.", "平台管理员默认拥有全部入口，无需单独授权。") };
const content = document.querySelector('#content'), notice = document.querySelector('#notice');
let session = null, users = [], nextCursor = null, selectedId = null, view = null, epoch = 0, ended = false, writing = false, createOpen = false;
let expiryTimer, accessTimer, overview, overviewLoading, mcpView, mcpLoading, dataView, dataLoading, booting = false, bootRevision = 0, usersLoaded = false;
const controllers = new Set();
const selected = () => users.find(user => user.id === selectedId);
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
    if (session.user.id !== value.user.id) view = null;
    epoch++; for (const controller of controllers) controller.abort(); overview?.clear();
    users = []; nextCursor = null; selectedId = null; usersLoaded = false; createOpen = false; content.replaceChildren();
  }
  session = value; clearTimeout(expiryTimer); clearTimeout(accessTimer);
  if (!view || !value.platformAdmin && !['access', 'grants'].includes(view)) view = value.platformAdmin ? 'overview' : 'access';
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
function button(text, className, handler) { const node = el('button', className, text); node.type = 'button'; node.addEventListener('click', handler); return node; }
function message(text = '', kind = '') { notice.replaceChildren(document.createTextNode(text)); notice.className = `notice ${kind}`; }
function time(value) { if (value === null || value === undefined) return t("No expiry", "未设置期限"); const date = new Date(value); return Number.isNaN(date.valueOf()) ? t("Time unconfirmed", "时间待确认") : date.toLocaleString(language, { hour12: false }); }
function terminal(status, text) {
  if (ended) return;
  ended = true; epoch++; clearTimeout(expiryTimer); clearTimeout(accessTimer); session = null; users = []; nextCursor = null; selectedId = null;
  for (const controller of controllers) controller.abort();
  overview?.clear(); document.querySelector('#overview-controls').hidden = true;
  content.replaceChildren(); content.setAttribute('aria-busy', 'false');
  document.querySelector('#account-name').textContent = '';
  document.querySelector('#create-user').hidden = true;
  for (const node of document.querySelectorAll('[data-admin-only],[data-shared-view]')) node.hidden = true;
  for (const node of document.querySelectorAll('#navigation button, #refresh')) node.disabled = true;
  message(text || (status === 401 ? t("Your session expired. Sign in again.", "登录已失效，请重新登录。") : t("You do not have access to management.", "当前账号没有管理界面的查看权限。")), 'error');
  const link = el('a', '', status === 401 ? t("Sign in", "登录") : t("Back to workbench", "回到工作台")); link.href = status === 401 ? '/auth/login?return_to=%2Fadmin%2F' : '/'; notice.append(link);
}
async function api(path, { method = 'GET', body } = {}) {
  const requestEpoch = epoch;
  const controller = new AbortController(); controllers.add(controller);
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(path.startsWith('/api/') ? path : base + path, { method, cache: 'no-store', mode: 'same-origin', credentials: 'same-origin', redirect: 'error', referrerPolicy: 'same-origin', signal: controller.signal, headers: { Accept: 'application/json', ...(method === 'GET' ? {} : { 'Content-Type': 'application/json', 'X-CSRF-Token': session?.csrfToken || '' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    let value; try { value = await response.json(); } catch {}
    if ([401, 403].includes(response.status)) { if (requestEpoch === epoch) terminal(response.status); throw Object.assign(new Error('Management session rejected.'), { stale: requestEpoch !== epoch }); }
    if (!response.ok) throw Object.assign(new Error('Administration request failed.'), { code: value?.code, stale: requestEpoch !== epoch });
    return value;
  } catch (error) {
    if (error.name === 'AbortError' && requestEpoch === epoch && !ended) throw Object.assign(new Error('Management request timed out.'), { code: method === 'GET' ? 'READ_TIMEOUT' : 'WRITE_TIMEOUT' });
    throw error;
  } finally { clearTimeout(timeout); controllers.delete(controller); }
}
function report(error) { if (!ended && !error.stale && error.name !== 'AbortError') message(errorNames[error.code] || t("Could not complete this operation. Try again.", "暂时无法完成操作，请稍后重试。"), 'error'); }
function setBusy(value) { writing = value; for (const node of content.querySelectorAll('button, input, select')) node.disabled = value; document.querySelector('#create-user').disabled = value; document.querySelector('#refresh').disabled = value; }
async function mutate(path, options, success) {
  if (writing || ended || !session?.platformAdmin) return;
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
function confirmAction(parent, text, action) {
  parent.querySelector('.confirm-box')?.remove();
  const box = el('div', 'confirm-box'); box.setAttribute('role', 'group'); box.setAttribute('aria-label', t("Confirm action", "确认操作"));
  const trigger = document.activeElement;
  const cancel = () => { box.remove(); if (trigger?.isConnected) trigger.focus(); };
  const actions = el('div', 'actions'), cancelButton = button(t("Cancel", "取消"), 'quiet-button', cancel);
  actions.append(button(t("Confirm", "确认"), 'danger-button', action), cancelButton);
  box.addEventListener('keydown', event => { if (event.key === 'Escape' && !writing) { event.preventDefault(); cancel(); } });
  box.append(el('p', '', text), actions); parent.append(box); cancelButton.focus();
}
function userPath(user, suffix = '') { return `/users/${encodeURIComponent(user.id)}${suffix}`; }
function updateUser(user) { const index = users.findIndex(value => value.id === user.id); if (index >= 0) users[index] = user; else users.push(user); }
function picker() {
  const root = el('label', 'user-picker'), select = el('select'); select.id = 'selected-user';
  root.append(el('span', '', t("Current user", "当前用户")), select);
  for (const user of users) { const option = el('option', '', `${user.username}${user.enabled ? '' : t(" (disabled)", "（已停用）")}`); option.value = user.id; select.append(option); }
  select.value = selectedId;
  select.addEventListener('change', () => { selectedId = select.value; void render(); }); return root;
}
function createForm() {
  const panel = el('section', 'editor form-panel'); panel.setAttribute('aria-label', t("New user", "新增用户"));
  const heading = el('div', 'form-heading'); heading.append(el('h2', '', t("New user", "新增用户")), button(t("Cancel", "取消"), 'link-button', () => { createOpen = false; void render(); }));
  const form = el('form'), fields = el('div', 'form-grid');
  const username = field(t("Account", "账号"), 'username'), password = field(t("Initial password", "初始密码"), 'password', 'password');
  username.input.required = true; username.input.maxLength = 200; username.input.autocomplete = 'off';
  password.input.required = true; password.input.minLength = 12; password.input.maxLength = 1024; password.input.autocomplete = 'new-password';
  fields.append(username.root, password.root); const submit = el('button', 'primary', t("Create user", "创建用户")); submit.type = 'submit';
  form.append(fields, el('p', 'section-note', t("Set app access, business permissions and administrator privileges separately after creating a user.", "新用户默认没有平台管理、应用入口或业务数据权限。创建后再分别授权。")), submit);
  form.addEventListener('submit', event => {
    event.preventDefault(); const body = { username: username.input.value.trim(), password: password.input.value };
    void mutate('/users', { method: 'POST', body }, value => { updateUser(value.user); selectedId = value.user.id; createOpen = false; renderUsers(); message(t("User created. Set their app access as needed.", "用户已创建，请按需设置入口权限。"), 'success'); });
  }); panel.append(heading, form); return panel;
}
function accountEditor(user) {
  const panel = el('section', 'editor form-panel'); panel.setAttribute('aria-label', t("Account settings", "账号设置"));
  panel.append(el('h2', '', user.username), el('p', 'section-note', t("Administrators can open all apps. Business records still require access to their space and resources.", "平台管理员默认拥有全部应用入口；业务记录仍按所属空间与当前授权范围访问。")));
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
  passwordForm.append(el('h3', '', t("Reset password", "重置密码")), password.root, el('p', 'section-note', t("Use at least 12 characters. The user must sign in again after a reset.", "至少12个字符。重置后，该用户需要重新登录。")), submit);
  passwordForm.addEventListener('submit', event => { event.preventDefault(); const body = { password: password.input.value }; void mutate(userPath(user, '/password'), { method: 'POST', body }, () => { renderUsers(); message(t("Password reset.", "密码已重置。"), 'success'); }); });
  panel.append(passwordForm); return panel;
}
function renderUsers() {
  content.replaceChildren();
  if (createOpen) content.append(createForm());
  content.append(el('p', 'section-note', t("Manage sign-in accounts and administrators. Configure app access and agent delegations separately.", "管理登录账号与平台管理员身份。应用入口和智能体委托分别设置。")));
  const list = el('ul', 'user-list');
  for (const user of users) {
    const row = el('li', 'user-row'); row.dataset.user = user.id; if (selectedId === user.id) row.setAttribute('aria-current', 'true');
    const summary = el('div', 'user-summary'); summary.append(el('strong', 'user-name', user.username), el('span', 'meta', `${user.enabled ? t("Enabled", "已启用") : t("Disabled", "已停用")}${user.platformAdmin ? t(" · Administrator", " · 平台管理员") : ''}${session?.user.id === user.id ? t(" · Current account", " · 当前账号") : ''}`));
    const manage = button(t("Manage", "管理"), 'quiet-button', () => { selectedId = user.id; createOpen = false; renderUsers(); content.querySelector('.editor')?.scrollIntoView({ block: 'nearest', behavior: 'auto' }); }); manage.setAttribute('aria-label', t("Manage {0}", "管理 {0}", user.username));
    row.append(summary, manage); list.append(row);
  }
  content.append(users.length ? list : el('p', 'empty', t("No users.", "暂无用户。")));
  if (nextCursor) content.append(button(t("Load more users", "加载更多用户"), 'quiet-button pagination', async () => { const current = epoch; try { const value = await api(`/users?limit=50&after=${encodeURIComponent(nextCursor)}`); if (ended || current !== epoch || view !== 'users') return; for (const user of value.users) updateUser(user); nextCursor = value.nextCursor; renderUsers(); } catch (error) { report(error); } }));
  const user = selected(); if (user) content.append(accountEditor(user));
}
function check(label, name, value) {
  const root = el('label', 'check-field'), input = el('input'); input.type = 'checkbox'; input.name = name; input.checked = value === true; root.append(input, el('span', '', label)); return { root, input };
}
function localDate(value) { if (value === null || value === undefined) return ''; const date = new Date(value); return new Date(date.valueOf() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16); }
function renderAccess(user, access) {
  if (access.source === 'administrator') {
    content.append(el('p', 'section-note', t("Platform administrators can open every app, the workbench and product documents.", "平台管理员默认拥有全部应用、工作台与 PRD集合入口，无需单独授权。")), el('p', 'access-status', t("Apps: {0}", "应用：{0}", Object.values(appNames).join('、'))));
    const link = el('a', 'inline-link', t("Open workbench", "打开工作台")); link.href = '/'; content.append(link); return;
  }
  content.append(el('p', 'section-note', t("Each signed-in user has a workbench. These settings control which apps and documents they can open. Business resource access and agent delegations are separate.", "每位用户登录后都有自己的工作台。这里设置可打开的应用与文档，不授予业务记录权限，也不代替智能体委托。")));
  content.append(el('p', 'access-status', access.configured ? t("Access expires: {0}", "授权期限：{0}", access.expiresAt === null ? t("No expiry", "不设期限") : time(access.expiresAt)) : t("No app or document entries configured.", "尚未配置应用或文档入口。")));
  const form = el('form', 'form-panel'), apps = el('fieldset', 'access-group'), appGrid = el('div', 'checkbox-grid'); apps.append(el('legend', '', t("Apps", "应用")));
  const checks = Object.keys(appNames).map(id => { const entry = check(appNames[id], id, access.apps?.includes(id)); appGrid.append(entry.root); return [id, entry.input]; }); apps.append(appGrid);
  const workspace = el('fieldset', 'access-group'), workspaceGrid = el('div', 'checkbox-grid'); workspace.append(el('legend', '', t("Documents", "文档")));
  const prds = check(t("Product documents", "PRD集合"), 'prds', access.prds); workspaceGrid.append(prds.root); workspace.append(workspaceGrid);
  const expiry = field(t("Expires on", "有效期至"), 'expiresAt', 'datetime-local'); expiry.root.classList.add('access-expiry'); expiry.input.value = localDate(access.expiresAt); expiry.root.append(el('small', '', t("Leave blank for access without an expiry date.", "留空表示不设期限。")));
  const submit = el('button', 'primary', t("Save app access", "保存入口权限")); submit.type = 'submit'; form.append(apps, workspace, expiry.root, submit);
  form.addEventListener('submit', event => {
    event.preventDefault(); const expiresAt = expiry.input.value ? new Date(expiry.input.value).valueOf() : null;
    if (expiresAt !== null && (!Number.isSafeInteger(expiresAt) || expiresAt <= Date.now())) { message(t("Choose a future expiration date.", "请选择未来的有效期。"), 'error'); return; }
    void mutate(userPath(user, '/web-access'), { method: 'PUT', body: { apps: checks.filter(([, input]) => input.checked).map(([id]) => id), workbench: true, prds: prds.input.checked, expiresAt } }, async () => { await render(); message(t("App access saved.", "入口权限已保存。"), 'success'); });
  }); content.append(form);
}
function renderOwnAccess() {
  const access = session.access;
  const panel = el('section', 'own-access'); panel.id = 'own-access';
  panel.append(el('p', 'section-note', t("Here are your app entries and agent capabilities. Contact an administrator to change your app access.", "这里展示当前账号的应用入口与智能体能力。变更应用入口请联系管理员。")));
  panel.append(el('p', 'access-status', t("Product documents: {0}{1}", "PRD集合：{0}{1}", access.prds ? t("Available", "可访问") : t("Not granted", "未获准"), access.apps.length || access.prds ? t("; expires: {0}", "；入口期限：{0}", access.expiresAt === null ? t("No expiry", "不设期限") : time(access.expiresAt)) : '')));
  const apps = session.capabilities.filter(app => access.apps.includes(app.appId));
  if (!apps.length) { panel.append(el('p', 'empty', t("No app access. Contact an administrator to request access.", "当前账号暂无应用访问权限，请联系管理员按需开通。"))); content.append(panel); return; }
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
  const list = el('ul', 'grant-list');
  for (const grant of value.grants) {
    const row = el('li', 'grant-row'), heading = el('div', 'grant-heading'); row.dataset.grant = grant.id;
    const revoked = grant.revokedAt != null, expired = grant.expiresAt <= Date.now();
    const status = grant.status || (revoked ? 'revoked' : expired ? 'expired' : 'current'); row.dataset.status = status;
    heading.append(el('strong', '', grant.client.name), el('span', 'grant-status', ({ current: t("Unexpired", "未到期"), restricted: t("Scope restricted", "范围已受限"), expired: t("Expired", "已到期"), revoked: t("Revoked", "已撤销") })[status] || t("Status unconfirmed", "状态待确认")));
    row.append(heading, el('span', 'meta', t("Expires {0}", "有效期至 {0}", time(grant.expiresAt))));
    if (own && ['expired', 'revoked'].includes(status)) row.append(el('p', 'meta', t("Historical grant scope; current permissions may differ.", "以下为历史授权范围，不代表当前可用权限。")));
    if (own && status === 'restricted') row.append(el('p', 'meta', t("App or resource access changed. The list shows the actions currently available.", "应用或资源权限已变化，当前可用操作以所列范围为准。")));
    const scopes = el('ul', 'grant-scopes');
    for (const scope of grant.scopes) { const actions = scope.actions.map(action => actionNames[action] || t("Other capabilities", "其他能力")).join('、'); const resources = scope.allResources ? t("Permitted resources in scope", "范围内获准资源") : Number.isSafeInteger(scope.resourceCount) ? t("Resources: {0}", "{0}项资源", scope.resourceCount) : t("Resource scope unconfirmed", "资源范围待确认"); scopes.append(el('li', '', t("{0}: {1}; scopes: {2}, {3}", "{0}：{1}；{2}个范围，{3}", appNames[scope.appId] || t("Other apps", "其他应用"), actions, scope.spaceCount, resources))); }
    row.append(grant.scopes.length ? scopes : el('p', 'meta', own && !['expired', 'revoked'].includes(status) ? t("No actions currently available.", "当前暂无可用操作。") : t("No recorded scopes.", "暂无范围记录。")));
    if (!revoked && !expired && ['current', 'restricted'].includes(status)) row.append(button(t("Revoke delegation", "撤销委托"), 'danger-button', () => confirmAction(row, t("Revoke this delegation for {0}?", "撤销 {0} 的这份委托？", grant.client.name), () => own ? void revokeOwnGrant(grant.id) : void mutate(`/grants/${encodeURIComponent(grant.id)}`, { method: 'DELETE' }, async () => { await render(); message(t("Delegation revoked.", "委托已撤销。"), 'success'); }))));
    list.append(row);
  }
  content.append(value.grants.length ? list : el('p', 'empty', t("No agent delegations.", "暂无智能体委托。")));
  if (value.nextCursor) content.append(button(t("Load more delegations", "加载更多委托"), 'quiet-button pagination', async () => { const current = epoch; try { const more = await api(own ? `${accountBase}/grants?limit=50&after=${encodeURIComponent(value.nextCursor)}` : userPath(user, `/grants?limit=50&after=${encodeURIComponent(value.nextCursor)}`)); if (ended || current !== epoch || !own && selectedId !== user.id || view !== 'grants') return; const combined = { grants: [...value.grants, ...more.grants], nextCursor: more.nextCursor }; content.replaceChildren(); if (!own) content.append(picker()); renderGrants(user, combined, own); } catch (error) { report(error); } }));
}
async function render() {
  if (ended || !session) return;
  if (!session.platformAdmin && !['access', 'grants'].includes(view)) view = 'access';
  overview?.clear();
  document.querySelector('#overview-controls').hidden = view !== 'overview' || ended;
  document.querySelector('#refresh').hidden = view === 'overview';
  content.hidden = view === 'overview';
  const current = ++epoch; content.replaceChildren(); content.setAttribute('aria-busy', 'true');
  document.querySelector('#heading').textContent = titles[view]; document.querySelector('#create-user').hidden = view !== 'users' || ended || !session.platformAdmin;
  for (const node of document.querySelectorAll('[data-view]')) { if (node.dataset.view === view) node.setAttribute('aria-current', 'page'); else node.removeAttribute('aria-current'); }
  if (view === 'overview') {
    try { const controller = await ensureOverview(); if (!ended && current === epoch && session?.platformAdmin && view === 'overview') controller?.updateAccess(); }
    catch { if (!ended && current === epoch) message(t("Could not read the overview. Refresh to retry.", "暂时无法读取状态概览，请稍后刷新。"), 'error'); }
    finally { if (current === epoch) content.setAttribute('aria-busy', 'false'); }
    return;
  }
  if (!session.platformAdmin) {
    if (view === 'access') { renderOwnAccess(); content.setAttribute('aria-busy', 'false'); return; }
    content.append(el('p', 'loading', t("Loading…", "正在读取…")));
    try { const value = await api(`${accountBase}/grants?limit=50`); if (ended || current !== epoch || session.platformAdmin) return; content.replaceChildren(); renderGrants(session.user, value, true); }
    catch (error) { if (current === epoch && !ended) { content.querySelector('.loading')?.remove(); report(error); } }
    finally { if (current === epoch) content.setAttribute('aria-busy', 'false'); }
    return;
  }
  if (view === 'data') {
    content.append(el('p', 'loading', t("Loading…", "正在读取…")));
    try {
      const [module, value] = await Promise.all([ensureData(), api('/api/business/console/data')]);
      if (ended || current !== epoch || !session?.platformAdmin || view !== 'data') return;
      module?.renderDataManagement(content, value);
    } catch (error) { if (current === epoch && !ended) { content.querySelector('.loading')?.remove(); report(error); } }
    finally { if (current === epoch) content.setAttribute('aria-busy', 'false'); }
    return;
  }
  if (view === 'mcp') {
    content.append(el('p', 'loading', t("Loading…", "正在读取…")));
    try {
      const [module, value] = await Promise.all([ensureMcp(), api('/mcp')]);
      if (ended || current !== epoch || !session?.platformAdmin || view !== 'mcp') return;
      module?.renderMcpManagement(content, value);
    } catch (error) { if (current === epoch && !ended) { content.querySelector('.loading')?.remove(); report(error); } }
    finally { if (current === epoch) content.setAttribute('aria-busy', 'false'); }
    return;
  }
  if (view === 'users') { renderUsers(); content.setAttribute('aria-busy', 'false'); return; }
  if (!selected()) selectedId = users[0]?.id || null;
  const user = selected();
  if (!user) { content.append(el('p', 'empty', t("Create a user first.", "请先新增用户。"))); content.setAttribute('aria-busy', 'false'); return; }
  content.append(picker(), el('p', 'loading', t("Loading…", "正在读取…")));
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
  let current = ++epoch; content.replaceChildren(); content.setAttribute('aria-busy', 'true'); message(t("Loading…", "正在读取…"));
  try {
    const metadata = await api(`${accountBase}/session`); if (ended || current !== epoch) return;
    if (!setSession(metadata)) return; current = epoch;
    document.querySelector('#account-name').textContent = session.user.username;
    if (session.platformAdmin && !['overview', 'mcp', 'data'].includes(view)) {
      const result = await api('/users?limit=50'); if (ended || current !== epoch) return;
      users = result.users; nextCursor = result.nextCursor; usersLoaded = true; if (!selected()) selectedId = null;
    }
    message(); await render();
  } catch (error) { report(error); if (!ended) content.setAttribute('aria-busy', 'false'); }
  finally {
    if (loading === bootRevision) {
      booting = false;
      if (!ended) for (const node of document.querySelectorAll('#navigation button, #create-user, #refresh')) node.disabled = writing;
    }
  }
}
for (const node of document.querySelectorAll('[data-view]')) node.addEventListener('click', () => { if (booting || writing || ended || !session || ['overview', 'users', 'mcp', 'data'].includes(node.dataset.view) && !session.platformAdmin) return; view = node.dataset.view; createOpen = false; message(); if (session.platformAdmin && !['overview', 'mcp', 'data'].includes(view) && !usersLoaded) void boot(); else void render(); });
document.querySelector('#create-user').addEventListener('click', () => { if (booting || writing || ended || !session?.platformAdmin) return; createOpen = !createOpen; renderUsers(); content.querySelector('input')?.focus(); });
document.querySelector('#refresh').addEventListener('click', () => void boot());
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
