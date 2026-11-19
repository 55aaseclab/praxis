// English is the source locale. Add its Simplified Chinese translation in the same change.
const key = 'praxis.locale';
const eventName = 'praxis-locale-change';
function readLocale() {
  const cookie = typeof document !== 'undefined' && /(?:^|;\s*)praxis_locale=(en|zh)(?:;|$)/.exec(document.cookie || '');
  if (cookie) return cookie[1];
  try { return localStorage.getItem(key) === 'zh' ? 'zh' : 'en'; } catch { return 'en'; }
}
let current = readLocale();

export const locale = () => current;
export const t = (english, chinese) => current === 'zh' ? chinese : english;
export function message(english, chinese, ...values) {
  return t(english, chinese).replace(/\{(\d+)\}/g, (_, index) => String(values[index]));
}
export function setLocale(next) {
  if (next !== 'en' && next !== 'zh') return;
  try { localStorage.setItem(key, next); } catch { /* In-memory choice still works. */ }
  try { document.cookie = `praxis_locale=${next}; Path=/; SameSite=Lax; Max-Age=31536000${location.protocol === 'https:' ? '; Secure' : ''}`; } catch {}
  window.dispatchEvent(new CustomEvent(eventName, { detail: next }));
}

let button;
export function mountLanguageControls() {
  if (button) return;
  button = document.querySelector('[data-language-switch]');
  if (!button && !document.body?.hasAttribute('data-praxis-i18n')) return;
  button?.addEventListener('click', () => setLocale(t('zh', 'en')));
  renderWorkbenchLanguage();
}
function renderWorkbenchLanguage() {
  if (!button && !document.body?.hasAttribute('data-praxis-i18n')) return;
  document.documentElement.lang = t('en', 'zh-CN');
  for (const node of document.querySelectorAll('[data-zh]')) {
    node.dataset.en ??= node.textContent;
    node.textContent = t(node.dataset.en, node.dataset.zh);
  }
  for (const node of document.querySelectorAll('[data-zh-label]')) {
    node.dataset.enLabel ??= node.getAttribute('aria-label');
    node.setAttribute('aria-label', t(node.dataset.enLabel, node.dataset.zhLabel));
  }
  if (!button) return;
  button.lang = t('zh-CN', 'en');
  button.textContent = t('简体中文', 'English');
}

if (typeof window !== 'undefined') {
  window.addEventListener(eventName, event => {
    current = event.detail === 'en' || event.detail === 'zh' ? event.detail : readLocale();
    renderWorkbenchLanguage();
  });
  window.addEventListener('storage', event => {
    if (event.key === key || event.key === null) window.dispatchEvent(new CustomEvent(eventName, { detail: readLocale() }));
  });
  if (document.body?.hasAttribute('data-praxis-i18n')) mountLanguageControls();
}
