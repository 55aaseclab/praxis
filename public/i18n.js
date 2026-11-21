// English is the source locale. Add its Simplified Chinese translation in the same change.
const key = 'praxis.locale';
const eventName = 'praxis-locale-change';
export function cookieLocale(cookie = '') {
  return /(?:^|;\s*)praxis_locale=(en|zh)(?:;|$)/.exec(cookie)?.[1];
}
function readLocale() {
  const cookie = typeof document !== 'undefined' && cookieLocale(document.cookie || '');
  if (cookie) return cookie;
  const rendered = typeof document !== 'undefined' && document.documentElement.dataset.praxisLocale;
  if (rendered === 'en' || rendered === 'zh') return rendered;
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

let preference;
export function mountLanguageControls() {
  if (preference) return;
  preference = document.querySelector('[data-language-preference]');
  preference?.addEventListener('change', () => setLocale(preference.value));
  renderWorkbenchLanguage();
}
function renderWorkbenchLanguage() {
  if (!document.body?.hasAttribute('data-praxis-i18n')) return;
  document.documentElement.lang = t('en', 'zh-CN');
  for (const node of document.querySelectorAll('[data-zh]')) {
    node.dataset.en ??= node.textContent;
    const text = t(node.dataset.en, node.dataset.zh);
    if (node.textContent !== text) node.textContent = text;
  }
  for (const node of document.querySelectorAll('[data-zh-label]')) {
    node.dataset.enLabel ??= node.getAttribute('aria-label');
    const label = t(node.dataset.enLabel, node.dataset.zhLabel);
    if (node.getAttribute('aria-label') !== label) node.setAttribute('aria-label', label);
  }
  if (preference) preference.value = current;
}

if (typeof window !== 'undefined') {
  window.addEventListener(eventName, event => {
    current = event.detail === 'en' || event.detail === 'zh' ? event.detail : readLocale();
    renderWorkbenchLanguage();
  });
  window.addEventListener('pageshow', event => {
    if (event.persisted && readLocale() !== current) window.dispatchEvent(new CustomEvent(eventName, { detail: readLocale() }));
  });
  window.addEventListener('storage', event => {
    if (event.key === key || event.key === null) window.dispatchEvent(new CustomEvent(eventName, { detail: readLocale() }));
  });
  if (document.body?.hasAttribute('data-praxis-i18n')) mountLanguageControls();
}
