import { t } from './i18n.js';
const appIdentity = value => typeof value === 'string' && /^[a-z][a-z0-9-]{0,79}$/.test(value);
const states = new Set(['ready', 'authorization-required', 'login-required']);

function mountNavigation() {
  const source = new URL(import.meta.url);
  if (source.origin !== location.origin || source.pathname !== '/praxis-nav.js' || document.querySelector('#praxis-system-navigation')) return;
  const marker = [...document.querySelectorAll('script[data-praxis-platform-nav]')].find(node => node.type === 'module' && node.src === source.href);
  if (!marker || !['app', 'business', 'admin', 'prds'].includes(marker.dataset.mode) || (['admin', 'prds'].includes(marker.dataset.mode) ? marker.dataset.appId !== undefined : !appIdentity(marker.dataset.appId))) return;
  const host = document.createElement('praxis-system-navigation'); host.id = 'praxis-system-navigation'; host.dataset.placement = 'fixed'; host.hidden = true;
  const root = host.attachShadow({ mode: 'open' });
  const stylesheet = document.createElement('link'); stylesheet.rel = 'stylesheet'; stylesheet.href = new URL('/praxis-nav.css', source).href;
  const navigation = document.createElement('nav');
  const home = document.createElement('a'); home.className = 'praxis-home'; home.href = new URL('/', location.origin).href;
  const glyph = document.createElementNS('http://www.w3.org/2000/svg', 'svg'), path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  for (const [name, value] of Object.entries({ width: '21', height: '21', viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.7', 'aria-hidden': 'true' })) glyph.setAttribute(name, value);
  path.setAttribute('d', 'm3.5 10 8.5-7 8.5 7v10a1 1 0 0 1-1 1H15v-7H9v7H4.5a1 1 0 0 1-1-1Z'); glyph.append(path); home.append(glyph);
  const panel = document.createElement('section'); panel.className = 'praxis-navigation-status'; panel.hidden = true;
  const message = document.createElement('p'); message.setAttribute('role', 'status');
  const action = document.createElement('a'); action.className = 'praxis-navigation-action'; panel.append(message, action);
  navigation.append(home, panel); root.append(stylesheet, navigation); document.documentElement.append(host);
  let state = 'ready';
  function updateState(value) {
    if (!states.has(value)) return;
    state = value;
    panel.hidden = value === 'ready';
    if (!panel.hidden) {
      const address = new URL(value === 'login-required' ? '/auth/login' : '/', location.origin);
      if (value === 'login-required') address.searchParams.set('return_to', `${location.pathname}${location.search}${location.hash}`);
      message.textContent = value === 'login-required' ? t('Your Praxis session expired. Sign in to continue.', 'Praxis 登录已失效，请重新登录后继续。') : t('No app actions are available. Contact your administrator to check access.', '目前没有可用的应用操作，请联系管理员确认权限。');
      action.textContent = value === 'login-required' ? t('Sign in to Praxis', '登录 Praxis') : t('Back to workbench', '回到工作台'); action.href = address.href;
    } else { message.textContent = ''; action.removeAttribute('href'); }
  }
  function renderLanguage() {
    host.lang = t('en', 'zh-CN');
    navigation.setAttribute('aria-label', t('Praxis navigation', 'Praxis 系统导航'));
    panel.setAttribute('aria-label', t('Praxis access status', 'Praxis 访问状态'));
    home.title = t('Back to workbench', '回到工作台');
    home.setAttribute('aria-label', home.title);
    updateState(state);
  }
  renderLanguage();
  window.addEventListener('praxis-locale-change', renderLanguage);
  document.addEventListener('praxis-navigation-state', event => updateState(event.detail?.state));
  document.dispatchEvent(new Event('praxis-navigation-ready'));
  const print = matchMedia('print');
  let loaded = false;
  const reveal = () => { host.hidden = !loaded || print.matches; };
  print.addEventListener('change', reveal);
  stylesheet.addEventListener('load', () => { loaded = true; reveal(); });
  stylesheet.addEventListener('error', () => {
    Object.assign(host.style, { position: 'fixed', left: 'calc(12px + env(safe-area-inset-left, 0px))', bottom: 'calc(12px + env(safe-area-inset-bottom, 0px))', width: '44px', height: '44px', zIndex: '2147483600' });
    Object.assign(home.style, { display: 'grid', placeItems: 'center', width: '44px', height: '44px', background: '#fafafa', color: '#3b536b', borderRadius: '13px' });
    Object.assign(panel.style, { position: 'absolute', bottom: '52px', left: '0', width: 'min(280px, calc(100vw - 24px))', background: '#fafafa', padding: '14px 16px' });
    loaded = true; reveal();
  });
}
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mountNavigation, { once: true });
  else mountNavigation();
}
