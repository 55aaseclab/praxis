import { t } from './i18n.js';
const errors = () => ({ CONFLICT: t("Content changed. Review the latest version.", '内容已更新，请先查看最新版本。'), REVISION_CONFLICT: t("Content changed. Review the latest version.", '内容已更新，请先查看最新版本。'), FORBIDDEN: t("You do not have permission for this action.", '你没有此操作的权限。'), NOT_FOUND: t("This content is unavailable.", '内容不存在或已无法访问。'), UNAUTHENTICATED: t("Your session expired. Sign in again.", '登录已失效，请重新登录。'), APP_UNAVAILABLE: t("Couldn’t connect. Try again later.", '暂时无法连接，请稍后重试。'), OUTCOME_UNKNOWN: t("The save was not confirmed. Reload before trying again.", '暂时无法确认保存结果，请先重新读取，避免重复提交。'), AUTHORIZATION_CHANGED_AFTER_COMMIT: t("Content was saved and access has expired. Request access again to view it.", '内容已保存，当前授权已失效。重新授权后可查看结果。') });

export function createAppTransport(appId, { onChange = () => {}, onRevoked = () => {}, onStatus = () => {} } = {}) {
  let session, contexts = [], context, source, navigationState = 'ready';
  function navigation(value) { navigationState = value; document.dispatchEvent(new CustomEvent('praxis-navigation-state', { detail: { state: value } })); }
  document.addEventListener('praxis-navigation-ready', () => navigation(navigationState));
  async function api(path, body) {
    const response = await fetch(path, { method: body ? 'POST' : 'GET', cache: 'no-store', credentials: 'same-origin', mode: 'same-origin', redirect: 'error', headers: body ? { 'Content-Type': 'application/json', 'X-CSRF-Token': session?.csrfToken || '' } : {}, ...(body ? { body: JSON.stringify(body) } : {}) });
    let value; try { value = await response.json(); } catch {}
    if (!response.ok) {
      if (response.status === 401) navigation('login-required');
      throw Object.assign(new Error(errors()[value?.code] || t("The action could not be completed. Try again.", '操作未完成，请稍后重试。')), { status: response.status, code: value?.code });
    }
    return value;
  }
  function disconnect() { source?.close(); source = null; }
  function subscribe() {
    disconnect();
    if (!context) return;
    const current = new EventSource(`/api/business/events?${new URLSearchParams({ spaceId: context.id, appId })}`); source = current;
    const change = () => { if (source === current) onChange(); };
    current.addEventListener('ready', () => { if (source === current) { onStatus(t("Connected", '已连接')); change(); } });
    current.addEventListener('change', change); current.addEventListener('reset', change);
    current.addEventListener('unavailable', () => { if (source === current) onStatus(t("Updates unavailable", '更新暂不可用')); });
    current.addEventListener('revoked', () => { if (source !== current) return; disconnect(); context = null; onStatus(t("Access changed", '访问权限已变化')); onRevoked(); });
    current.onerror = () => { if (source === current) onStatus(navigator.onLine ? t("Reconnecting", '正在重新连接') : t("Offline", '离线')); };
  }
  async function initialize() {
    session = await api('/auth/session'); navigation('ready');
    if (!['administrator', 'native'].includes(session.authorizationMode) && !session.delegated) { navigation('authorization-required'); return { authorized: false, contexts: [] }; }
    const catalog = await api('/api/business/catalog');
    contexts = catalog.spaces.map(value => ({ ...value, apps: value.apps.filter(app => app.id === appId) })).filter(value => value.apps.length);
    const requested = new URLSearchParams(location.search).get('space');
    context = requested ? contexts.find(value => value.id === requested) || null : contexts[0] || null;
    if (requested && !context) throw Object.assign(new Error(t('The selected scope is unavailable.', '所选范围不可访问。')), { status: 403, code: 'FORBIDDEN' });
    return { authorized: true, contexts };
  }
  function selectContext(id) {
    const next = contexts.find(value => value.id === id);
    if (!next) throw new Error('The selected context is unavailable.');
    disconnect(); context = next;
  }
  function invoke(operation, fields = {}) {
    if (!context) return Promise.reject(Object.assign(new Error(t("No accessible content.", '目前没有可访问的内容。')), { status: 403, code: 'FORBIDDEN' }));
    return api('/api/business/invoke', { appId, spaceId: context.id, operation, ...fields });
  }
  return { initialize, invoke, selectContext, subscribe, disconnect, get context() { return context; } };
}

export function populateContexts(contexts, appId) {
  const picker = document.querySelector('#context-picker'), select = document.querySelector('#space');
  const types = appId === 'reminder' ? { personal: t("Personal reminders", '个人提醒'), family: t("Family reminders", '家庭提醒'), company: t("Team reminders", '团队提醒') } : { personal: t("Personal tasks", '个人任务'), family: t("Family tasks", '家庭任务'), company: t("Team tasks", '团队任务') };
  select.replaceChildren();
  for (const context of contexts) { const option = document.createElement('option'); option.value = context.id; option.textContent = context.name || types[context.type] || (appId === 'reminder' ? t("Reminder lists", '提醒列表') : t("Task scope", '任务范围')); select.append(option); }
  picker.hidden = contexts.length < 2;
}
