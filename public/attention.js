import { getIdentity, identityReady } from './identity.js';
import { t } from './i18n.js';

const root = document.getElementById('attention-program');
const viewSwitch = document.getElementById('workbench-view-switch');
let program = 'apps',
  items = [],
  cursor = 0,
  state = '',
  request,
  owner = '';
const localDate = (date) =>
  [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0')
  ].join('-');
const idOf = (item) => JSON.stringify([item.appId, item.spaceId, item.resourceId, item.itemId]);
function priority(item, today) {
  const day = item.date?.slice(0, 10);
  if (day && day < today) return [0, t('Overdue', '已过期')];
  if (item.appId === 'projects' && day > today && !item.review) return [3, t('Assigned to you', '分配给你')];
  if (day === today) return [1, t('Due today', '今天到期')];
  if (item.review) return [2, t('Awaiting your review', '待你验收')];
  if (item.appId === 'projects' && !day) return [3, t('Assigned to you', '分配给你')];
  if (item.flagged) return [2, t('Flagged', '已加旗标')];
  return [4, t('Coming up', '即将到期')];
}
function element(tag, label) {
  const node = document.createElement(tag);
  if (label !== undefined) node.textContent = label;
  return node;
}
function button(label, handler) {
  const node = element('button', label);
  node.type = 'button';
  node.onclick = handler;
  return node;
}
function turn(step) {
  if (!items.length) return;
  cursor = (cursor + step + items.length) % items.length;
  render('card');
}
function render(focus) {
  if (!root) return;
  const identity = getIdentity();
  const available = Boolean(identity?.workbench && identity.apps.some(id => id === 'reminder' || id === 'projects'));
  if (!available) program = 'apps';
  root.hidden = !available || program !== 'attention';
  root.parentElement.classList.toggle('show-attention', !root.hidden);
  if (viewSwitch) {
    viewSwitch.hidden = !available;
    viewSwitch.dataset.view = program;
    const label = program === 'apps' ? t('Show For you', '切换到待关注') : t('Show apps', '切换到应用');
    viewSwitch.setAttribute('aria-label', label);
    viewSwitch.title = label;
    for (const icon of viewSwitch.querySelectorAll('[data-view-icon]')) {
      icon.toggleAttribute('hidden', icon.dataset.viewIcon === program);
    }
  }
  root.replaceChildren();
  if (root.hidden) return;
  if (program === 'attention') {
    const section = element('section');
    section.className = 'attention-deck';
    section.tabIndex = -1;
    if (state === 'partial')
      section.append(element('p', t('Some spaces could not be refreshed.', '部分空间暂时无法刷新。')));
    const item = items[cursor];
    if (item) {
      const today = localDate(new Date());
      section.append(element('small', priority(item, today)[1] + (item.appId === 'projects' ? ' · Projects' : ' · Reminder')), element('h2', item.title));
      if (item.date) section.append(element('p', item.date));
      const link = element('a', item.appId === 'projects' ? t('Open work item', '打开工作项') : t('Open reminder', '打开提醒'));
      link.href =
        item.appId === 'projects' ? '/apps/projects/#' + new URLSearchParams({ space: item.spaceId, project: item.resourceId, view: item.domain, item: item.itemId }) : '/business/reminder/?' + new URLSearchParams({ space: item.spaceId, item: item.resourceId });
      section.append(link);
      if (items.length > 1) {
        const controls = element('div');
        controls.className = 'card-controls';
        controls.append(
          button(t('Previous', '上一张'), () => turn(-1)),
          element('span', cursor + 1 + ' / ' + items.length),
          button(t('Next', '下一张'), () => turn(1))
        );
        section.append(controls);
      }
      let start = null;
      section.addEventListener('pointerdown', (e) => {
        if (!e.target.closest('a,button')) start = [e.clientX, e.clientY];
      });
      section.addEventListener('pointerup', (e) => {
        if (!start) return;
        const dx = e.clientX - start[0],
          dy = e.clientY - start[1];
        start = null;
        if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) turn(dx < 0 ? 1 : -1);
      });
      section.addEventListener('pointercancel', () => {
        start = null;
      });
      section.onkeydown = (e) => {
        if (['ArrowLeft', 'ArrowRight'].includes(e.key)) {
          e.preventDefault();
          turn(e.key === 'ArrowLeft' ? -1 : 1);
        }
      };
    } else {
      section.append(
        element(
          'p',
          state === 'error'
            ? t('Could not load your items.', '暂时无法读取事项。')
            : state === 'loading'
              ? t('Loading items…', '正在读取事项…')
              : t('No items need your attention.', '目前没有待关注的事项。')
        )
      );
    }
    if (state === 'error' || state === 'partial') section.append(button(t('Retry', '重试'), refresh));
    root.append(section);
    if (focus === 'card') section.focus();
  }
}
async function refresh() {
  const identity = getIdentity();
  const key =
    identity?.apps.some(id => id === 'reminder' || id === 'projects') && identity.workbench
      ? JSON.stringify([identity.username, identity.csrfToken, identity.apps.includes('reminder'), identity.apps.includes('projects')])
      : '';
  if (owner !== key) {
    owner = key;
    items = [];
    cursor = 0;
    program = 'apps';
    state = 'loading';
    request?.abort();
    request = null;
    render();
  }
  if (!key || request || document.hidden) return;
  const controller = new AbortController();
  request = controller;
  const timeout = setTimeout(() => controller.abort(), 7000);
  try {
    const response = await fetch('/api/business/workbench/attention', {
      cache: 'no-store',
      mode: 'same-origin',
      redirect: 'error',
      signal: controller.signal
    });
    if (!response.ok) throw Error();
    const result = await response.json();
    if (owner !== key || request !== controller) return;
    const now = new Date(),
      future = new Date(now);
    future.setDate(now.getDate() + 7);
    const limit = localDate(future),
      today = localDate(now);
    const current = items[cursor] && idOf(items[cursor]);
    items = result.items
      .filter((item) => item.appId === 'projects' || item.flagged || (item.date && item.date.slice(0, 10) <= limit))
      .sort(
        (a, b) =>
          priority(a, today)[0] - priority(b, today)[0] ||
          (a.date || '').localeCompare(b.date || '') ||
          idOf(a).localeCompare(idOf(b))
      );
    cursor = Math.max(
      0,
      items.findIndex((item) => idOf(item) === current)
    );
    state = result.partial ? 'partial' : '';
  } catch {
    if (owner !== key || request !== controller) return;
    items = [];
    cursor = 0;
    state = 'error';
  } finally {
    clearTimeout(timeout);
    if (request === controller) request = null;
  }
  const active = document.activeElement;
  if (!root.contains(active)) render();
  else {
    render('card');
  }
}
if (root) {
  viewSwitch?.addEventListener('click', () => {
    program = program === 'apps' ? 'attention' : 'apps';
    render();
  });
  document.addEventListener('praxis-identity-change', refresh);
  window.addEventListener('praxis-locale-change', () => render());
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) void refresh();
  });
  setInterval(refresh, 60000);
  void identityReady.then(refresh);
}
