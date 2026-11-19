import { t } from './i18n.js';
const hint = document.querySelector('#install-hint');
if (hint) {
  const help = document.querySelector('#install-help');
  const install = document.querySelector('#install-app');
  const dismiss = document.querySelector('#dismiss-install');
  const display = window.matchMedia('(display-mode: standalone)');
  const preference = 'praxis-install-dismissed-at';
  const week = 7 * 864e5;
  let nativePrompt, installed = false, busy = false, dismissed = false;
  try {
    const timestamp = Number(localStorage.getItem(preference));
    dismissed = timestamp > 0 && timestamp <= Date.now() && Date.now() - timestamp < week;
  } catch {}
  function instructions() {
    const ua = navigator.userAgent;
    if (/MicroMessenger/i.test(ua)) return t('Open this page in a browser from the ••• menu, then add Praxis to your home screen.', '右上角 ··· → 在浏览器中打开，再将 Praxis 添加到主屏幕。');
    if (!window.isSecureContext) return t('Open Praxis over HTTPS to install it or add it to the home screen.', '通过 HTTPS 打开 Praxis，再使用浏览器的安装或添加到主屏幕功能。');
    if (/iPad|iPhone|iPod/i.test(ua) || /Macintosh/i.test(ua) && navigator.maxTouchPoints > 1) return t('In the Share menu, choose Add to Home Screen and name it Praxis.', '分享 → 添加到主屏幕，名称选择 Praxis。');
    if (nativePrompt) return t('Install Praxis to open the workbench from your home screen.', '将 Praxis 保存到桌面，直接打开工作台。');
    if (/Macintosh/i.test(ua) && /Safari/i.test(ua) && !/Chrome|Chromium|Edg|OPR/i.test(ua)) return t('In Safari, choose File → Add to Dock and name it Praxis.', 'Safari：文件 → 添加到程序坞，名称选择 Praxis。');
    if (/Firefox/i.test(ua) && !/Android/i.test(ua)) return t('Open Praxis in Chrome, Edge or Safari to install the workbench.', '使用 Chrome、Edge 或 Safari 打开 Praxis，可将工作台保存到桌面。');
    return t('In the browser menu, choose Install app or Add to Home Screen and name it Praxis.', '浏览器菜单 → 安装应用或添加到主屏幕，名称选择 Praxis。');
  }
  function render() {
    hint.hidden = dismissed || installed || display.matches || navigator.standalone === true;
    help.textContent = instructions();
    install.hidden = !nativePrompt;
    install.disabled = busy;
  }
  window.addEventListener('praxis-locale-change', render);
  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault(); nativePrompt = event; render();
  });
  window.addEventListener('appinstalled', () => { installed = true; nativePrompt = null; render(); });
  display.addEventListener('change', render);
  dismiss.addEventListener('click', () => {
    dismissed = true;
    try { localStorage.setItem(preference, String(Date.now())); } catch {}
    render();
  });
  install.addEventListener('click', async () => {
    if (!nativePrompt || busy || hint.hidden) return;
    const prompt = nativePrompt; nativePrompt = null; busy = true; render();
    try {
      await prompt.prompt();
      const choice = await prompt.userChoice;
      if (choice.outcome === 'accepted') installed = true;
    } catch {} finally { busy = false; render(); }
  });
  render();
}
