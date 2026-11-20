import { t } from './i18n.js';
import { clearAppFacts } from './app-registry.js';
let identity = null;
let ended = false;
let controller;
let expiry;
let permissionExpiry;
let revision = 0;
let identityRevision = 0;
let pendingRefresh;
export function validIdentityApps(apps) {
  return Array.isArray(apps) && apps.length <= 128 && new Set(apps).size === apps.length && apps.every(id => typeof id === 'string' && /^[a-z][a-z0-9-]{0,79}$/.test(id));
}
const node = typeof document !== 'undefined' ? document.querySelector('#account') : null;

export function hasIdentity() { return node ? Boolean(identity && !ended && identity.expiresAt > Date.now()) : typeof document !== 'undefined' && document.body?.dataset.websiteAuth === 'unmanaged'; }
export function getIdentity() { return hasIdentity() ? identity : null; }
function clearRegistry() {
  clearAppFacts();
  document.querySelector('#apps')?.replaceChildren(); document.querySelector('#projects')?.replaceChildren();
  for (const selector of ['#apps-section', '#projects-section', '#desktop-empty', '#load-error']) { const element = document.querySelector(selector); if (element) element.hidden = true; }
}
function notify() { document.dispatchEvent(new CustomEvent('praxis-identity-change', { detail: { revision: ++identityRevision } })); }
function showNavigation() {
  for (const link of document.querySelectorAll('[data-prd-nav]')) link.hidden = identity?.prds !== true;
  for (const link of document.querySelectorAll('[data-admin-nav]')) link.hidden = !hasIdentity();
}
function permissionsExpired() {
  if (!identity || ended) return;
  identity = Object.freeze({ ...identity, apps: Object.freeze([]), prds: false, permissionsExpireAt: null });
  clearRegistry(); showNavigation(); notify(); void refresh();
}
function clear(status = 401) {
  revision++; ended = true; identity = null; clearTimeout(expiry); clearTimeout(permissionExpiry); controller?.abort();
  clearRegistry();
  for (const link of document.querySelectorAll('[data-private-nav]')) link.hidden = true;
  notify(); document.dispatchEvent(new Event('praxis-session-ended'));
  if (!node) return;
  node.replaceChildren();
  const message = document.createElement('span'); message.textContent = status === 403 ? t('Access denied', '当前账号没有访问权限') : status >= 500 ? t('Couldn’t check your session.', '暂时无法确认登录状态。') : t('Your session expired.', '登录已失效');
  const link = document.createElement('a'); link.href = '/auth/login?return_to=%2F'; link.textContent = t('Sign in', '登录'); link.className = 'header-link';
  if (status >= 500) {
    link.href = '/'; link.textContent = t('Retry', '重新读取');
  }
  node.append(message, link);
}
function closeAccount(restoreFocus = false) {
  const toggle = node?.querySelector('#account-toggle'), menu = node?.querySelector('#account-menu');
  if (!menu || menu.hidden) return;
  menu.hidden = true; toggle.setAttribute('aria-expanded', 'false');
  if (restoreFocus) toggle.focus();
}
function renderAccount() {
  if (!node || !identity) return;
  let toggle = node.querySelector('#account-toggle');
  if (!toggle) {
    toggle = document.createElement('button'); toggle.id = 'account-toggle'; toggle.type = 'button'; toggle.setAttribute('aria-haspopup', 'menu'); toggle.setAttribute('aria-expanded', 'false'); toggle.setAttribute('aria-controls', 'account-menu');
    const menu = document.createElement('div'); menu.id = 'account-menu'; menu.className = 'account-menu'; menu.hidden = true; menu.setAttribute('role', 'menu'); menu.setAttribute('aria-label', t('Account menu', '账户菜单'));
    const info = document.createElement('div'); info.className = 'account-info'; info.setAttribute('role', 'presentation');
    const heading = document.createElement('span'); heading.textContent = t('Account', '账户'); const context = document.createElement('span'); context.id = 'account-context'; info.append(heading, context);
    const logout = document.createElement('button'); logout.id = 'account-logout'; logout.type = 'button'; logout.textContent = t('Sign out', '退出'); logout.setAttribute('role', 'menuitem'); logout.tabIndex = -1;
    logout.addEventListener('click', () => {
      if (!hasIdentity()) return;
      const csrf = identity.csrfToken;
      clear();
      const status = document.createElement('span'); status.setAttribute('role', 'status');
      const retry = document.createElement('button'); retry.type = 'button'; retry.textContent = t('Retry sign-out', '重试退出');
      const reload = document.createElement('a'); reload.href = '/'; reload.className = 'header-link'; reload.textContent = t('Reload account', '重新读取账号');
      node.replaceChildren(status, retry, reload);
      async function signOut() {
        retry.disabled = true; retry.hidden = true; reload.hidden = true;
        status.textContent = t('Signing out…', '正在退出…');
        const request = new AbortController();
        const timeout = setTimeout(() => request.abort(), 8000);
        try {
          const response = await fetch('/auth/logout', { method: 'POST', credentials: 'same-origin', mode: 'same-origin', redirect: 'error', referrerPolicy: 'same-origin', signal: request.signal, headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }, body: '{}' });
          if (!response.ok && response.status !== 401) throw new Error('Logout was not confirmed.');
          location.assign('/');
        } catch {
          status.textContent = t('Sign-out was not confirmed. Try again.', '尚未确认退出，请重试。');
          retry.hidden = false; retry.disabled = false; reload.hidden = false; retry.focus();
        } finally { clearTimeout(timeout); }
      }
      retry.addEventListener('click', signOut); void signOut();
    });
    menu.append(info, logout); node.replaceChildren(toggle, menu);
    toggle.addEventListener('click', () => {
      if (!hasIdentity()) return;
      const open = menu.hidden; menu.hidden = !open; toggle.setAttribute('aria-expanded', String(open));
      if (open) logout.focus();
    });
    node.addEventListener('keydown', event => {
      if (event.key === 'Escape') { event.preventDefault(); closeAccount(true); return; }
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault(); menu.hidden = false; toggle.setAttribute('aria-expanded', 'true');
      const actions = [logout], index = actions.indexOf(document.activeElement);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? actions.length - 1 : event.key === 'ArrowDown' ? (index + 1) % actions.length : index <= 0 ? actions.length - 1 : index - 1;
      actions[next].focus();
    });
    node.addEventListener('focusout', event => { if (!node.contains(event.relatedTarget)) closeAccount(); });
  }
  node.querySelector('#account-menu').setAttribute('aria-label', t('Account menu', '账户菜单'));
  node.querySelector('.account-info span').textContent = t('Account', '账户');
  node.querySelector('#account-logout').textContent = t('Sign out', '退出');
  toggle.textContent = identity.username;
  node.querySelector('#account-context').textContent = identity.platformAdmin ? t('Platform administrator', '平台管理员') : t('Praxis account', 'Praxis 账户');
}
function refresh() {
  if (!pendingRefresh) pendingRefresh = readIdentity().finally(() => { pendingRefresh = null; });
  return pendingRefresh;
}
async function readIdentity() {
  const current = ++revision;
  controller?.abort(); controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch('/api/business/web-access', { cache: 'no-store', credentials: 'same-origin', mode: 'same-origin', redirect: 'error', referrerPolicy: 'no-referrer', signal: controller.signal, headers: { Accept: 'application/json' } });
    if (current !== revision) return false;
    if (!response.ok) { clear(response.status); return false; }
    const value = await response.json();
    if (current !== revision) return false;
    if (ended || typeof value.username !== 'string' || !Number.isSafeInteger(value.expiresAt) || value.expiresAt <= Date.now() || typeof value.csrfToken !== 'string' || !validIdentityApps(value.apps) || value.documentOwners !== undefined && !validIdentityApps(value.documentOwners) || value.permissionsExpireAt !== null && value.permissionsExpireAt !== undefined && !Number.isSafeInteger(value.permissionsExpireAt)) { clear(); return false; }
    const permissionsCurrent = value.permissionsExpireAt == null || value.permissionsExpireAt > Date.now();
    const next = Object.freeze({ ...value, apps: Object.freeze(permissionsCurrent ? [...value.apps] : []), prds: permissionsCurrent && value.prds === true, canViewPlatform: value.canViewPlatform === true, platformAdmin: value.platformAdmin === true, permissionsExpireAt: permissionsCurrent ? value.permissionsExpireAt ?? null : null });
    const changed = !identity || JSON.stringify([identity.userId, identity.username, identity.csrfToken, identity.apps, identity.prds, identity.platformAdmin, identity.documentOwner, identity.documentOwners, identity.canViewPlatform, identity.permissionsExpireAt]) !== JSON.stringify([next.userId, next.username, next.csrfToken, next.apps, next.prds, next.platformAdmin, next.documentOwner, next.documentOwners, next.canViewPlatform, next.permissionsExpireAt]);
    identity = next; showNavigation();
    if (changed) { clearRegistry(); notify(); }
    renderAccount();
    clearTimeout(expiry); expiry = setTimeout(clear, Math.max(1, Math.min(value.expiresAt - Date.now(), 2147483647)));
    clearTimeout(permissionExpiry);
    if (identity.permissionsExpireAt !== null) permissionExpiry = setTimeout(permissionsExpired, Math.max(1, Math.min(identity.permissionsExpireAt - Date.now(), 2147483647)));
    return true;
  } catch { if (current === revision) clear(503); return false; }
  finally { clearTimeout(timeout); }
}
export const identityReady = node ? refresh() : Promise.resolve(hasIdentity());
if (node) {
  window.addEventListener('praxis-locale-change', renderAccount);
  document.addEventListener('pointerdown', event => { if (!node.contains(event.target)) closeAccount(); });
  setInterval(() => { if (!ended && document.visibilityState !== 'hidden') void refresh(); }, 30000);
  document.addEventListener('visibilitychange', () => { if (!ended && document.visibilityState !== 'hidden') void refresh(); });
  addEventListener('pageshow', event => { if (event.persisted) { clear(); location.reload(); } });
}
