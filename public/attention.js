import { getIdentity, identityReady } from './identity.js';
import { t, locale } from './i18n.js';
import { localizedText, validateCardEnvelope, validatePreferences, personalCardState, laterTime, readBrowserProviders } from './app-providers.js';
import { appFact, loadAppFacts, setAppFacts } from './app-registry.js';

const root = typeof document === 'undefined' ? null : document.getElementById('attention-program');
const viewSwitch = typeof document === 'undefined' ? null : document.getElementById('workbench-view-switch');
const returnKey = 'praxis.workbench.card-return.v1';
let program = 'attention', items = [], sources = [], selected = '', state = 'loading', partial = false;
let owner = '', deniedOwner = '', request, preferenceRequest, preferences = null, pendingCards = null;
let opened = new Set(), menu = '', mutation = null, lastAction = null, personalError = '', restoring = null;
let listDialog, toast, timer;
const origin = () => location.origin;
const hasTextSelection = () => document.getSelection?.()?.isCollapsed === false;
const identityKey = value => value?.workbench && (value?.apps?.length || value.documentOwner === true || value.platformAdmin === true)
  ? JSON.stringify([value.userId || value.username, value.csrfToken, value.apps, value.documentOwner === true, value.documentOwners || []]) : '';
const label = value => localizedText(value, locale());
const visibleItems = () => items.filter(item => !preferences || personalCardState(item, preferences) === 'visible');
const currentItem = () => visibleItems().find(item => item.id === selected) || visibleItems()[0];
const contentArea = () => document.querySelector('main.desktop') || root?.parentElement;
function element(tag, className = '', text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function icon(name) {
  const paths = { list: '<path d="M8 6h12M8 12h12M8 18h12M3 6h.01M3 12h.01M3 18h.01"/>', left: '<path d="m14 6-6 6 6 6"/>', right: '<path d="m10 6 6 6-6 6"/>', more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>', close: '<path d="m6 6 12 12M6 18 18 6"/>' };
  const node = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  node.setAttribute('viewBox', '0 0 24 24'); node.setAttribute('fill', 'none'); node.setAttribute('stroke', 'currentColor');
  node.setAttribute('stroke-width', '1.6'); node.setAttribute('stroke-linecap', 'round'); node.setAttribute('stroke-linejoin', 'round'); node.setAttribute('aria-hidden', 'true');
  node.innerHTML = paths[name]; return node;
}
function button(text, action, { id, className = '', iconName, disabled = false } = {}) {
  const node = element('button', className); node.type = 'button'; if (id) node.id = id;
  if (iconName) node.append(icon(iconName));
  if (text) node.append(element('span', '', text));
  node.disabled = disabled; node.addEventListener('click', action); return node;
}
function dateText(value) {
  if (!value) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split('-').map(Number);
    return new Intl.DateTimeFormat(locale() === 'zh' ? 'zh-CN' : 'en', { year: 'numeric', month: 'long', day: 'numeric' }).format(new Date(year, month - 1, day));
  }
  return value;
}
function describeUntil(value) {
  return new Intl.DateTimeFormat(locale() === 'zh' ? 'zh-CN' : 'en', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
}
function saveReturn(item) {
  const identity = getIdentity();
  if (!identity?.userId) return;
  try { sessionStorage.setItem(returnKey, JSON.stringify({ userId: identity.userId, cardId: item.id, evidenceOpen: opened.has(item.id), scrollTop: contentArea()?.scrollTop || 0, cardScrollTop: root?.querySelector('#result-card')?.scrollTop || 0 })); } catch {}
}
function readReturn(identity) {
  let value;
  try { value = JSON.parse(sessionStorage.getItem(returnKey) || 'null'); sessionStorage.removeItem(returnKey); } catch { return null; }
  return value?.userId === identity?.userId && typeof value.cardId === 'string' && Number.isFinite(value.scrollTop) && value.scrollTop >= 0 && (value.cardScrollTop === undefined || Number.isFinite(value.cardScrollTop) && value.cardScrollTop >= 0) ? value : null;
}
function clearReturn() { try { sessionStorage.removeItem(returnKey); } catch {} }
function reset(value) {
  request?.abort(); preferenceRequest?.abort(); request = null; preferenceRequest = null;
  owner = identityKey(value); deniedOwner = ''; items = []; sources = []; selected = ''; program = 'attention';
  preferences = null; pendingCards = null; mutation = null; lastAction = null; personalError = ''; partial = false; state = 'loading'; opened.clear(); menu = '';
  restoring = value ? readReturn(value) : null;
  if (!value) clearReturn();
  if (listDialog?.open) listDialog.close();
  if (toast) { toast.replaceChildren(); toast.hidden = true; }
  render();
}
function accessLost(key) { reset(null); deniedOwner = key; owner = key; state = 'error'; render(); }
function sourceNotice() {
  const failed = sources.filter(source => ['unavailable', 'partial'].includes(source.status));
  if (!partial && !failed.length) return null;
  const notice = element('div', 'attention-notice'); notice.setAttribute('role', 'status');
  const messages = failed.map(source => label(source.message)).filter(Boolean);
  notice.append(element('span', '', messages.length ? [...new Set(messages)].join(' ') : t('Some items could not be refreshed. These are the available ones.', '部分事项暂时无法刷新，这里显示已能读取的内容。')));
  notice.append(button(t('Retry', '重试'), () => void refresh(), { className: 'attention-quiet' })); return notice;
}
function preservePosition() {
  const active = document.activeElement;
  return { focus: root?.contains(active) && (active.id || active.dataset.focus), scrollTop: contentArea()?.scrollTop || 0, cardScrollTop: root?.querySelector('#result-card')?.scrollTop || 0 };
}
function restorePosition(previous) {
  if (previous.focus) {
    const node = document.getElementById(previous.focus) || [...root.querySelectorAll('[data-focus]')].find(value => value.dataset.focus === previous.focus);
    node?.focus({ preventScroll: true });
  }
  const area = contentArea(); if (area) area.scrollTop = previous.scrollTop;
  const card = root?.querySelector('#result-card'); if (card) card.scrollTop = previous.cardScrollTop || 0;
}
function render({ preserve = false, focusCard = false } = {}) {
  if (!root) return;
  const previous = preserve ? preservePosition() : null;
  const available = Boolean(identityKey(getIdentity()) && deniedOwner !== identityKey(getIdentity()));
  if (!available) program = 'apps';
  root.hidden = !available || program !== 'attention'; root.parentElement.classList.toggle('show-attention', !root.hidden);
  if (viewSwitch) {
    viewSwitch.hidden = !available; viewSwitch.dataset.view = program;
    const text = program === 'apps' ? t('Show For you', '切换到待关注') : t('Show apps', '切换到应用');
    viewSwitch.setAttribute('aria-label', text); viewSwitch.title = text;
    for (const node of viewSwitch.querySelectorAll('[data-view-icon]')) node.toggleAttribute('hidden', node.dataset.viewIcon === program);
  }
  root.replaceChildren();
  if (root.hidden) return;
  const heading = element('div', 'attention-heading'); heading.append(element('h1', '', t('For you', '待关注')));
  if (!['loading', 'error'].includes(state)) {
    const showList = button(t('List', '列表'), openList, { id: 'show-list', className: 'attention-quiet', iconName: 'list' });
    showList.setAttribute('aria-haspopup', 'dialog'); heading.append(showList);
  }
  root.append(heading);
  const sourceState = sourceNotice(); if (sourceState) root.append(sourceState);
  if (pendingCards) {
    const notice = element('div', 'attention-notice'); notice.setAttribute('role', 'status');
    notice.append(element('span', '', t('Updates are available for these cards.', '这些卡片有可查看的更新。')));
    notice.append(button(t('Show updates', '查看更新'), () => { applyPending(); render({ preserve: true, focusCard: true }); }, { id: 'attention-updates', className: 'attention-quiet' })); root.append(notice);
  }
  if (personalError) {
    const notice = element('div', 'attention-notice'); notice.setAttribute('role', 'status'); notice.append(element('span', '', personalError));
    notice.append(button(t('Retry', '重试'), () => mutation ? void writePreference(mutation) : void refresh(), { className: 'attention-quiet', disabled: Boolean(preferenceRequest) })); root.append(notice);
  }
  const shown = visibleItems(), item = currentItem(); if (item) selected = item.id;
  if (state === 'loading') {
    const card = element('section', 'attention-deck'); card.setAttribute('role', 'status'); card.append(element('span', 'attention-sr', t('Loading cards', '正在读取卡片')));
    const skeleton = element('div', 'attention-skeleton'); skeleton.setAttribute('aria-hidden', 'true'); for (let index = 0; index < 4; index++) skeleton.append(element('span'));
    card.append(skeleton); root.append(card);
  } else if (state === 'error') {
    const card = element('section', 'attention-empty'); card.append(element('h2', '', t('Couldn’t load your cards.', '暂时无法读取卡片。')), element('p', '', t('Your saved work stays in its app. Try again, or open an app directly.', '已保存的工作仍在所属应用里。可以重试，或直接打开应用。')));
    card.append(button(t('Retry', '重试'), () => void refresh(), { className: 'attention-primary' }), button(t('Open apps', '打开应用'), showApps)); root.append(card);
  } else if (!item) {
    const card = element('section', 'attention-empty'); card.append(element('h2', '', t('There is nothing new here.', '这里暂时没有新内容。')));
    card.append(element('p', '', preferences?.items.some(value => items.some(card => card.id === value.cardId) && ['later', 'hidden'].includes(value.state)) ? t('The cards you set aside are available in the list.', '你暂时放下的卡片可以在列表中找回。') : t('You can still open any of your apps.', '你仍然可以直接打开应用。')));
    card.append(button(t('Open apps', '打开应用'), showApps, { className: 'attention-primary' })); root.append(card);
  } else {
    root.append(renderCard(item));
    const index = shown.findIndex(value => value.id === item.id), controls = element('nav', 'card-controls'); controls.setAttribute('aria-label', t('Card navigation', '卡片导航'));
    controls.append(button(t('Previous', '上一张'), () => turn(-1), { id: 'previous', iconName: 'left', disabled: index === 0 }), element('span', 'attention-position', `${index + 1} ${t('of', '/')} ${shown.length}`), button(t('Next', '下一张'), () => turn(1), { id: 'next', iconName: 'right', disabled: index === shown.length - 1 })); root.append(controls);
  }
  if (previous) restorePosition(previous);
  if (focusCard) root.querySelector('.attention-deck')?.focus({ preventScroll: true });
}
function renderCard(item) {
  const card = element('article', 'attention-deck'); card.id = 'result-card'; card.tabIndex = 0; card.setAttribute('aria-labelledby', 'card-title'); card.dataset.card = item.id;
  const top = element('div', 'attention-card-top'), source = element('div', 'attention-source');
  const image = element('img'); image.src = appFact(item.appId)?.icon || '/praxis.svg'; image.alt = ''; image.width = 25; image.height = 25;
  source.append(image, element('span', '', item.source.name));
  const version = element('span', 'attention-version', t('Version ', '版本 ') + (item.revision.length > 12 ? item.revision.slice(0, 8) + '…' : item.revision)); version.title = item.revision;
  top.append(source, version); card.append(top, element('p', 'attention-reason', label(item.reason)));
  const title = element('h2', '', item.title); title.id = 'card-title'; card.append(title);
  if (item.preview) card.append(element('p', 'attention-preview', item.preview));
  if (item.date) card.append(element('p', 'attention-date', dateText(item.date)));
  if (item.evidence.length) {
    const evidence = element('details', 'attention-evidence'); evidence.id = 'source-details'; evidence.open = opened.has(item.id);
    const summary = element('summary'); summary.append(icon('right'), element('span', '', t('Source details', '查看来源'))); evidence.append(summary);
    item.evidence.forEach((entry, index) => {
      const note = element('div', 'attention-source-note');
      if (entry.href) {
        const link = element('a', '', label(entry.label)); link.href = entry.href; link.dataset.focus = `evidence-${index}`; link.addEventListener('click', () => saveReturn(item)); note.append(link);
      } else note.append(element('strong', '', label(entry.label)));
      if (entry.revision) note.append(element('p', 'attention-locator', t('Version ', '版本 ') + entry.revision));
      if (entry.excerpt) note.append(element('p', '', entry.excerpt)); evidence.append(note);
    });
    evidence.addEventListener('toggle', () => evidence.open ? opened.add(item.id) : opened.delete(item.id)); card.append(evidence);
  }
  const actions = element('div', 'attention-actions'), open = element('a', 'attention-primary', label(item.primaryAction.label));
  open.id = 'open-item'; open.href = item.primaryAction.href; open.addEventListener('click', () => saveReturn(item)); actions.append(open);
  const later = menuControl('later', t('Later', '稍后看'), [
    { text: t('Later today', '今天晚些时候'), run: () => choosePreference(item, 'later', laterTime('today')) },
    { text: t('Tomorrow', '明天'), run: () => choosePreference(item, 'later', laterTime('tomorrow')) },
  ]);
  const more = menuControl('more', t('More options', '更多选项'), [{ text: t('Hide this version', '隐藏这个版本'), run: () => choosePreference(item, 'hidden') }]);
  more.classList.add('attention-overflow'); actions.append(later, more); card.append(actions);
  let start;
  card.addEventListener('pointerdown', event => {
    start = null;
    if (event.pointerType !== 'touch' || !event.isPrimary || hasTextSelection() || event.target.closest('a,button,summary,input,select,textarea,[contenteditable]')) return;
    start = { id: event.pointerId, x: event.clientX, y: event.clientY };
  });
  card.addEventListener('pointerup', event => {
    const gesture = start; start = null;
    if (!gesture || event.pointerType !== 'touch' || event.pointerId !== gesture.id || hasTextSelection()) return;
    const dx = event.clientX - gesture.x, dy = event.clientY - gesture.y;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) turn(dx < 0 ? 1 : -1);
  });
  card.addEventListener('pointercancel', () => { start = null; });
  card.addEventListener('lostpointercapture', () => { start = null; }); return card;
}
function menuControl(name, text, entries) {
  const wrap = element('div', 'attention-menu-wrap'), toggle = button(name === 'more' ? '' : text, () => {
    menu = menu === name ? '' : name; render({ preserve: true });
    if (menu) root.querySelector(`#${name}-menu button`)?.focus({ preventScroll: true });
    else document.getElementById(name)?.focus({ preventScroll: true });
  }, { id: name, className: 'attention-secondary', iconName: name === 'more' ? 'more' : undefined, disabled: Boolean(preferenceRequest) || !preferences });
  toggle.setAttribute('aria-label', text); toggle.setAttribute('aria-haspopup', 'menu'); toggle.setAttribute('aria-expanded', String(menu === name)); toggle.setAttribute('aria-controls', `${name}-menu`);
  const panel = element('div', 'attention-popup'); panel.id = `${name}-menu`; panel.hidden = menu !== name; panel.setAttribute('role', 'menu');
  for (const entry of entries) { const choice = button(entry.text, entry.run); choice.setAttribute('role', 'menuitem'); panel.append(choice); }
  wrap.append(toggle, panel); return wrap;
}
function applyPending() { if (pendingCards) { items = pendingCards; pendingCards = null; } }
function showApps() { applyPending(); program = 'apps'; menu = ''; render(); viewSwitch?.focus({ preventScroll: true }); }
function turn(step) {
  applyPending(); const shown = visibleItems(), index = shown.findIndex(item => item.id === selected), next = Math.max(0, Math.min(shown.length - 1, index + step));
  if (!shown[next] || next === index) return; selected = shown[next].id; menu = ''; render({ focusCard: true });
}
function ensureList() {
  if (listDialog) return;
  listDialog = element('dialog', 'attention-list-dialog'); listDialog.id = 'list-dialog'; listDialog.setAttribute('aria-labelledby', 'attention-list-title');
  document.body.append(listDialog);
}
function openList() { ensureList(); renderList(); listDialog.showModal(); }
function renderList() {
  if (!listDialog) return; listDialog.replaceChildren();
  const heading = element('div', 'attention-dialog-heading'), title = element('h2', '', t('Cards', '卡片列表')); title.id = 'attention-list-title';
  const close = button('', () => listDialog.close(), { iconName: 'close' }); close.setAttribute('aria-label', t('Close', '关闭')); heading.append(title, close); listDialog.append(heading);
  const shown = visibleItems(), list = element('ul', 'attention-list');
  for (const item of shown) {
    const row = element('li'), choice = button('', () => { applyPending(); selected = item.id; listDialog.close(); render({ focusCard: true }); }, { className: 'attention-list-choice' });
    choice.dataset.card = item.id; choice.setAttribute('aria-current', String(selected === item.id));
    choice.append(element('strong', '', item.title), element('span', '', item.source.name)); row.append(choice); list.append(row);
  }
  if (shown.length) listDialog.append(list); else listDialog.append(element('p', 'attention-list-note', t('No cards in view.', '当前没有展示的卡片。')));
  for (const kind of ['later', 'hidden']) {
    const remaining = items.filter(item => preferences && personalCardState(item, preferences) === kind);
    if (!remaining.length) continue;
    listDialog.append(element('h3', 'attention-list-group', kind === 'later' ? t('Later', '稍后看') : t('Hidden versions', '已隐藏的版本')));
    for (const item of remaining) {
      const row = element('div', 'attention-deferred-row'), text = element('span'); text.append(element('span', '', item.title));
      const preference = preferences.items.find(value => value.cardId === item.id);
      if (kind === 'later') text.append(element('small', '', describeUntil(preference.until)));
      row.append(text, button(t('Bring back', '放回卡片'), () => choosePreference(item, 'visible'), { disabled: Boolean(preferenceRequest) })); listDialog.append(row);
    }
  }
  const unavailable = sources.filter(source => ['unavailable', 'browser', 'unsupported', 'partial'].includes(source.status));
  if (unavailable.length) {
    listDialog.append(element('h3', 'attention-list-group', t('Sources', '来源')));
    for (const source of unavailable) listDialog.append(element('p', 'attention-list-note', label(source.message) || source.appId));
  }
}
function showToast(message, allowUndo = true) {
  if (!toast) { toast = element('div', 'attention-toast'); toast.id = 'attention-toast'; toast.setAttribute('role', 'status'); toast.setAttribute('aria-live', 'polite'); document.body.append(toast); }
  toast.replaceChildren(element('span', '', message));
  if (allowUndo && lastAction) toast.append(button(t('Undo', '撤销'), undoPreference, { id: 'undo', disabled: Boolean(preferenceRequest) }));
  const close = button('×', () => { toast.hidden = true; }); close.setAttribute('aria-label', t('Dismiss message', '关闭消息')); toast.append(close); toast.hidden = false;
}
function choosePreference(item, personalState, until) {
  if (!preferences || preferenceRequest) return;
  const key = globalThis.crypto?.randomUUID?.() || `card-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const previous = preferences.items.find(value => value.cardId === item.id);
  const intent = { cardId: item.id, cardRevision: item.revision, state: personalState, ...(until && { until }), expectedRevision: preferences.revision, idempotencyKey: key, previous: previous && { ...previous }, undo: false };
  menu = ''; void writePreference(intent);
}
async function undoPreference() {
  if (!lastAction || !preferences || preferenceRequest) return;
  const previous = lastAction.previous;
  void writePreference({ cardId: lastAction.cardId, cardRevision: previous?.cardRevision || lastAction.cardRevision, state: previous?.state || 'visible', ...(previous?.until && { until: previous.until }), expectedRevision: preferences.revision, idempotencyKey: globalThis.crypto?.randomUUID?.() || `undo-${Date.now()}`, previous: null, undo: true });
}
async function writePreference(intent) {
  if (preferenceRequest || !preferences) return;
  const identity = getIdentity(), key = identityKey(identity);
  if (!key || key !== owner || !identity.csrfToken) return;
  const controller = new AbortController(); preferenceRequest = controller; mutation = intent; personalError = ''; render({ preserve: true });
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const body = Object.fromEntries(['cardId', 'cardRevision', 'state', 'until', 'expectedRevision', 'idempotencyKey'].filter(name => intent[name] !== undefined).map(name => [name, intent[name]]));
    const response = await fetch('/api/business/workbench/preferences', { method: 'POST', credentials: 'same-origin', mode: 'same-origin', redirect: 'error', cache: 'no-store', signal: controller.signal, headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': identity.csrfToken }, body: JSON.stringify(body) });
    const value = await response.json();
    if (owner !== key || identityKey(getIdentity()) !== key || preferenceRequest !== controller) return;
    if (response.status === 401 || response.status === 403) { accessLost(key); return; }
    if (response.status === 409) {
      if (value.current) preferences = validatePreferences(value.current);
      mutation = null; personalError = t('Your card settings changed. Review the card and try again.', '卡片设置已发生变化，请查看当前卡片后再试。');
      return;
    }
    if (!response.ok) throw new Error('Personal preference was not confirmed.');
    preferences = validatePreferences(value); mutation = null;
    if (intent.undo) { selected = intent.cardId; lastAction = null; if (toast) toast.hidden = true; }
    else {
      lastAction = { cardId: intent.cardId, cardRevision: intent.cardRevision, previous: intent.previous };
      if (!visibleItems().some(item => item.id === selected)) selected = visibleItems()[0]?.id || '';
      const message = intent.state === 'hidden' ? t('This version is hidden from your cards.', '这个版本已从你的卡片中隐藏。') : intent.state === 'later' ? t('Set aside until ', '已放到 ') + describeUntil(intent.until) + t('. The original date stays unchanged.', '，原定日期不变。') : t('The card is back in view.', '卡片已放回当前视图。');
      showToast(message);
    }
  } catch {
    if (owner === key && identityKey(getIdentity()) === key && preferenceRequest === controller) personalError = t('Couldn’t confirm your card setting. Retry to check it safely.', '尚未确认卡片设置是否保存，可以安全重试核对。');
  } finally {
    clearTimeout(timeout);
    if (preferenceRequest === controller) { preferenceRequest = null; render({ preserve: true }); const undo = toast?.querySelector('#undo'); if (undo) undo.disabled = false; if (listDialog?.open) renderList(); }
  }
}
function combineBrowser(server, results) {
  const cards = [...server.items], byId = new Set(cards.map(item => item.id)), mergedSources = new Map(server.sources.map(source => [source.appId, source]));
  for (const provider of results) {
    if (['ready', 'empty', 'partial'].includes(provider.status)) for (const item of provider.items) {
      if (byId.has(item.id)) continue; cards.push(item); byId.add(item.id);
    }
    mergedSources.set(provider.appId, { appId: provider.appId, status: provider.status, ...(provider.message !== undefined && { message: provider.message }) });
  }
  return { items: cards, sources: [...mergedSources.values()], partial: server.partial || results.some(value => ['partial', 'unavailable'].includes(value.status)) };
}
async function refresh() {
  const identity = getIdentity(), key = identityKey(identity);
  if (key !== owner) reset(identity);
  if (!key || deniedOwner === key || request || document.hidden) return;
  const controller = new AbortController(); request = controller;
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const options = { credentials: 'same-origin', mode: 'same-origin', redirect: 'error', cache: 'no-store', signal: controller.signal };
    const [response, preferenceResponse] = await Promise.all([fetch('/api/business/workbench/attention', options), fetch('/api/business/workbench/preferences', options), loadAppFacts({ signal: controller.signal })]);
    if (owner !== key || request !== controller || identityKey(getIdentity()) !== key) return;
    if ([response.status, preferenceResponse.status].some(status => status === 401 || status === 403)) { accessLost(key); return; }
    if (!response.ok || !preferenceResponse.ok) throw new Error('Cards could not be refreshed.');
    const [raw, rawPreferences] = await Promise.all([response.json(), preferenceResponse.json()]);
    if (owner !== key || request !== controller || identityKey(getIdentity()) !== key) return;
    if (raw.apps !== undefined) setAppFacts(raw.apps);
    const projection = validateCardEnvelope(raw, origin()), nextPreferences = validatePreferences(rawPreferences);
    let browser = [];
    try { browser = await readBrowserProviders({ kind: 'cards', identity, signal: controller.signal, origin: origin() }); }
    catch (error) {
      if (controller.signal.aborted) throw error;
      browser = projection.sources.filter(source => source.status === 'browser').map(source => ({ appId: source.appId, status: 'unavailable', items: [], message: { en: 'This browser source could not be refreshed.', zh: '此浏览器来源暂时无法刷新。' } }));
    }
    if (owner !== key || request !== controller || identityKey(getIdentity()) !== key) return;
    const next = combineBrowser(projection, browser), previous = currentItem();
    if (!preferences || !preferenceRequest && nextPreferences.revision >= preferences.revision) preferences = nextPreferences;
    sources = next.sources; partial = next.partial; state = '';
    const replacement = previous && next.items.find(item => item.id === previous.id);
    if (program === 'attention' && previous && replacement && replacement.revision !== previous.revision) pendingCards = next.items;
    else { items = next.items; pendingCards = null; }
    if (restoring) {
      selected = visibleItems().some(item => item.id === restoring.cardId) ? restoring.cardId : visibleItems()[0]?.id || '';
      program = 'attention'; const position = restoring.scrollTop, cardPosition = restoring.cardScrollTop || 0;
      if (selected === restoring.cardId && restoring.evidenceOpen === true) opened.add(selected);
      restoring = null; render();
      requestAnimationFrame(() => { if (owner !== key) return; if (contentArea()) contentArea().scrollTop = position; const card = root?.querySelector('#result-card'); if (card) card.scrollTop = cardPosition; });
    } else render({ preserve: true });
    if (listDialog?.open) renderList();
  } catch (error) {
    if (owner !== key || request !== controller || identityKey(getIdentity()) !== key) return;
    if ([401, 403].includes(error.status)) { accessLost(key); return; }
    items = []; pendingCards = null; sources = []; state = 'error'; render({ preserve: true });
  } finally { clearTimeout(timeout); if (request === controller) request = null; }
}
if (root) {
  viewSwitch?.addEventListener('click', () => { if (program === 'apps') { applyPending(); program = 'attention'; } else program = 'apps'; menu = ''; render(); viewSwitch.focus({ preventScroll: true }); });
  document.addEventListener('praxis-identity-change', () => { if (identityKey(getIdentity()) !== owner) reset(getIdentity()); void refresh(); });
  document.addEventListener('praxis-session-ended', () => reset(null));
  window.addEventListener('praxis-locale-change', () => { render({ preserve: true }); if (listDialog?.open) renderList(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) void refresh(); });
  window.addEventListener('praxis-app-directory-change', () => void refresh());
  window.addEventListener('storage', () => void refresh());
  document.addEventListener('pointerdown', event => { if (menu && !event.target.closest('.attention-menu-wrap')) { menu = ''; render({ preserve: true }); } });
  document.addEventListener('keydown', event => {
    if (menu) {
      const current = menu, choices = [...root.querySelectorAll(`#${current}-menu button`)];
      if (event.key === 'Escape') { event.preventDefault(); menu = ''; render({ preserve: true }); document.getElementById(current)?.focus({ preventScroll: true }); return; }
      if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        event.preventDefault(); const index = choices.indexOf(document.activeElement);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? choices.length - 1 : event.key === 'ArrowDown' ? (index + 1) % choices.length : (index - 1 + choices.length) % choices.length;
        choices[next]?.focus(); return;
      }
    }
    if (program !== 'attention' || listDialog?.open || !root.contains(event.target) || event.target.closest('a,button,summary,input,select,textarea')) return;
    if (event.defaultPrevented || event.shiftKey || event.ctrlKey || event.altKey || event.metaKey || hasTextSelection()) return;
    if (['ArrowLeft', 'ArrowRight'].includes(event.key)) { event.preventDefault(); turn(event.key === 'ArrowLeft' ? -1 : 1); }
  });
  timer = setInterval(refresh, 60000);
  void identityReady.then(() => { if (identityKey(getIdentity()) !== owner) reset(getIdentity()); return refresh(); });
}
