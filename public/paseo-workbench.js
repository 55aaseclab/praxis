import { getIdentity, identityReady } from './identity.js';
import { t } from './i18n.js';

const appUrl = 'https://app.paseo.sh/';

function mountPaseo(container) {
  const shell = container.closest('.launcher-shell');
  if (!shell) return;
  const desktop = window.matchMedia('(min-width: 900px)');
  const policyFeatures = document.featurePolicy?.features() ?? [];
  const canEmbed = 'credentialless' in HTMLIFrameElement.prototype && policyFeatures.includes('loopback-network');
  let pane;
  let toggle;
  let owner;

  function externalLink(label) {
    const link = document.createElement('a');
    link.className = 'header-link';
    link.href = appUrl;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = label;
    return link;
  }

  function close(restoreFocus = true) {
    pane?.remove();
    pane = undefined;
    toggle?.setAttribute('aria-expanded', 'false');
    if (restoreFocus) toggle?.focus();
  }

  function translatePane() {
    if (!pane) return;
    pane.querySelector('a').textContent = t('Open in new tab', '在新标签页打开');
    pane.querySelector('button').textContent = t('Close', '关闭');
  }

  function open() {
    const identity = getIdentity();
    if (!identity || !desktop.matches || !canEmbed) return;
    if (pane) { close(); return; }
    if (owner && owner !== identity.username) {
      location.reload();
      return;
    }
    owner = identity.username;
    pane = document.createElement('aside');
    pane.id = 'paseo-workbench-pane';
    pane.setAttribute('aria-label', 'Paseo Web');
    const header = document.createElement('header');
    const name = document.createElement('strong');
    name.textContent = 'Paseo';
    const dismiss = document.createElement('button');
    dismiss.type = 'button';
    dismiss.addEventListener('click', () => close());
    const frame = document.createElement('iframe');
    frame.title = 'Paseo Web';
    frame.credentialless = true;
    frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms');
    frame.allow = "local-network 'none'; loopback-network 'none'; local-network-access 'none'";
    frame.referrerPolicy = 'no-referrer';
    frame.src = appUrl;
    header.append(name, externalLink(''), dismiss);
    pane.append(header, frame);
    shell.prepend(pane);
    translatePane();
    toggle.setAttribute('aria-expanded', 'true');
    dismiss.focus();
  }

  function refresh() {
    const identity = getIdentity();
    if (!identity || (owner && owner !== identity.username) || !desktop.matches) close(false);
    container.hidden = !identity;
    if (!identity) return;
    const embed = desktop.matches && canEmbed;
    if (embed && !toggle) {
      toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'header-link';
      toggle.setAttribute('aria-controls', 'paseo-workbench-pane');
      toggle.setAttribute('aria-expanded', 'false');
      toggle.addEventListener('click', open);
      toggle.textContent = 'Paseo';
      container.replaceChildren(toggle);
    } else if (!embed) {
      toggle = undefined;
      if (!container.querySelector('a')) container.replaceChildren(externalLink('Paseo ↗'));
    }
    translatePane();
  }

  document.addEventListener('praxis-identity-change', refresh);
  document.addEventListener('praxis-session-ended', () => close(false));
  desktop.addEventListener('change', refresh);
  window.addEventListener('praxis-locale-change', refresh);
  window.addEventListener('pagehide', () => close(false));
  void identityReady.then(refresh);
}

const container = document.getElementById('paseo-workbench');
if (container) mountPaseo(container);
