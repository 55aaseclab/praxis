import { locale, mountLanguageControls, t } from './i18n.js';
import { reportExperience, startExperienceObserver } from './experience.js';
import { identityReady, hasIdentity, getIdentity } from './identity.js';
import { setAppFacts, collectionEntries } from './app-registry.js';

mountLanguageControls();
startExperienceObserver();
let revision = 0, registryController, collectionController, identityTriggered = false;
let registry = null;
let collectionSources = new Map();
const collectionMessages = {
  partial: ['Some collections could not be loaded.', '部分集合暂时无法读取。'],
  unavailable: ['Couldn’t load collections. Try again later.', '暂时无法读取集合，请稍后重试。'],
  loading: ['Loading collections…', '正在读取集合…'],
};
const rendered = new Map();
function clearRegistry() {
  registry = null; collectionSources.clear(); rendered.clear();
  document.querySelector('#apps').replaceChildren(); document.querySelector('#projects').replaceChildren();
  for (const selector of ['#apps-section', '#projects-section', '#project-status', '#desktop-empty', '#load-error']) document.querySelector(selector).hidden = true;
}
function currentIdentity(current, identity) {
  const next = getIdentity();
  return current === revision && hasIdentity() && (!identity || next?.userId === identity.userId && next?.username === identity.username && next.csrfToken === identity.csrfToken);
}
function renderGroup(selector, entries) {
  const signature = locale() + JSON.stringify(entries);
  if (signature === rendered.get(selector)) return;
  rendered.set(selector, signature);
  const links = entries.map(app => {
    const link = document.createElement(app.unavailable ? 'div' : 'a');
    link.className = 'desktop-app workbench-app'; link.dataset.app = app.id;
    if (app.appId) link.dataset.appId = app.appId;
    if (app.resourceId) { link.dataset.resourceId = app.resourceId; if (app.kind === 'project') link.dataset.projectId = app.resourceId; }
    if (!app.unavailable) {
      const url = app.url ? new URL(app.url) : new URL(app.path, location.origin);
      if (!app.url && app.port !== undefined) url.port = String(app.port);
      link.href = url.href;
      link.addEventListener('click', () => reportExperience('app_open', { appId: app.appId || app.id }));
    }
    const appName = app.labels?.[locale()]?.name ?? app.name;
    const appDescription = app.labels?.[locale()]?.description ?? app.description;
    if (!app.unavailable) link.setAttribute('aria-label', t(`Open ${appName}`, `打开 ${appName}`));
    const icon = document.createElement('img'); icon.className = 'app-icon workbench-icon'; icon.src = app.icon; icon.alt = ''; icon.width = 80; icon.height = 80;
    const name = document.createElement('span'); name.className = 'app-name'; name.textContent = appName;
    const description = document.createElement('span'); description.className = 'app-description'; description.id = `app-description-${app.id}`; description.textContent = appDescription;
    link.setAttribute('aria-describedby', description.id); link.title = appDescription;
    link.append(icon, name, description);
    if (app.unavailable) {
      const status = document.createElement('small');
      status.textContent = app.unavailable === 'install' ? t('Installation required', '需安装应用') : t('Managed access required', '需受管授权');
      link.append(status);
    }
    return link;
  });
  document.querySelector(selector).replaceChildren(...links);
}
function renderRegistry() {
  const identity = getIdentity();
  const apps = (registry || []).filter(app => app.kind === 'app' && app.launcher !== false && (app.entry?.policy ? true : app.adminOnly ? identity?.platformAdmin === true : !identity || identity.apps.includes(app.id)));
  const collections = directoryApps(identity);
  const projects = collections.flatMap(app => collectionSources.get(app.id)?.entries || []);
  const statuses = collections.map(app => collectionSources.get(app.id)?.status).filter(Boolean);
  const statusKey = statuses.includes('unavailable') ? projects.length ? 'partial' : 'unavailable' : statuses.includes('partial') ? 'partial' : statuses.includes('loading') ? 'loading' : '';
  const status = statusKey ? t(...collectionMessages[statusKey]) : '';
  const heading = document.querySelector('#projects-heading');
  if (heading) heading.textContent = collections.length === 1 ? collections[0].entry.workbenchDirectory.title?.[locale()] || collections[0].name : t('Collections', '集合');
  renderGroup('#apps', apps);
  renderGroup('#projects', projects);
  const feedback = document.querySelector('#project-status');
  feedback.textContent = status; feedback.hidden = !status;
  document.querySelector('#apps-section').hidden = !apps.length;
  document.querySelector('#projects-section').hidden = !projects.length && !status;
  document.querySelector('#desktop-empty').hidden = registry === null || Boolean(apps.length || projects.length || status);
}
async function requestJson(path, controller) {
  const timeout = setTimeout(() => controller.abort(), 6000);
  try {
    const response = await fetch(path, { cache: 'no-store', credentials: 'same-origin', mode: 'same-origin', redirect: 'error', referrerPolicy: 'no-referrer', signal: controller.signal });
    if (!response.ok) throw new Error('Workbench request failed.');
    return await response.json();
  } finally { clearTimeout(timeout); }
}
function directoryApps(identity = getIdentity()) {
  if (!identity) return [];
  return (registry || []).filter(app => app.entry?.workbenchDirectory && (identity.platformAdmin || app.entry.policy !== 'grant' || identity.apps.includes(app.id)));
}
async function refreshCollections(force = false) {
  const identity = getIdentity(), apps = directoryApps(identity);
  if (!hasIdentity() || !apps.length) return;
  if (!force && (collectionController || document.visibilityState === 'hidden')) return;
  const current = revision;
  collectionController?.abort();
  const active = new AbortController(); collectionController = active;
  await Promise.all(apps.map(async app => {
    try {
      const path = app.entry.workbenchDirectory.path;
      if (typeof path !== 'string' || !/^\/api\/business\/workbench\/[a-z][a-z0-9/-]*$/.test(path) || path.includes('//') || path.includes('..')) throw new Error('Invalid registered collection path.');
      const result = collectionEntries(await requestJson(path, active), app, location.origin);
      if (collectionController !== active || !currentIdentity(current, identity)) return;
      collectionSources.set(app.id, { entries: result.entries, status: result.partial ? 'partial' : '' });
    } catch {
      if (collectionController !== active || !currentIdentity(current, identity)) return;
      collectionSources.set(app.id, { entries: [], status: 'unavailable' });
    }
  }));
  if (collectionController !== active || !currentIdentity(current, identity)) return;
  collectionController = undefined;
  if (registry !== null) renderRegistry();
}
async function loadRegistry() {
  const current = ++revision;
  registryController?.abort(); collectionController?.abort(); collectionController = undefined;
  clearRegistry();
  if (!hasIdentity()) return;
  const identity = getIdentity(), registryStartedAt = performance.now();
  registryController = new AbortController();
  const apps = requestJson('/api/apps', registryController);
  try {
    const result = await apps;
    if (!currentIdentity(current, identity)) return;
    registry = setAppFacts(result.apps);
    for (const app of directoryApps(identity)) collectionSources.set(app.id, { entries: [], status: 'loading' });
    renderRegistry();
    await refreshCollections(true);
  } catch {
    if (!currentIdentity(current, identity)) return;
    collectionController?.abort(); collectionController = undefined;
    clearRegistry();
    reportExperience('page_error'); document.querySelector('#load-error').hidden = false;
  } finally {
    if (current === revision) reportExperience('registry_load', { durationMs: Math.round(performance.now() - registryStartedAt) });
  }
}
globalThis.addEventListener?.('praxis-locale-change', () => { if (registry) renderRegistry(); });
document.addEventListener('praxis-identity-change', () => { identityTriggered = true; void loadRegistry(); });
document.addEventListener('praxis-session-ended', () => { revision++; registryController?.abort(); collectionController?.abort(); collectionController = undefined; clearRegistry(); });
document.addEventListener('visibilitychange', () => { if (document.visibilityState !== 'hidden') void refreshCollections(true); });
if (typeof globalThis.addEventListener === 'function') globalThis.addEventListener('focus', () => void refreshCollections(true));
if (typeof setInterval === 'function') setInterval(() => void refreshCollections(), 30000);
if (await identityReady && !identityTriggered) await loadRegistry();
