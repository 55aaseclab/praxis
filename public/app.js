import { locale, mountLanguageControls, t } from './i18n.js';
import { reportExperience, startExperienceObserver } from './experience.js';
import { identityReady, hasIdentity, getIdentity } from './identity.js';

mountLanguageControls();
startExperienceObserver();
let revision = 0, registryController, projectController, identityTriggered = false;
let registry = null, projectEntries = [], projectStatus = '';
const projectMessages = {
  partial: ['Some projects could not be loaded.', '部分项目暂时无法读取。'],
  unavailable: ['Couldn’t load projects. Try again later.', '暂时无法读取项目，请稍后重试。'],
  loading: ['Loading projects…', '正在读取项目…'],
};
const rendered = new Map();
const identifier = value => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,199}$/.test(value);
const projectId = value => typeof value === 'string' && /^[a-z0-9][a-z0-9-]{0,79}$/.test(value);
const text = (value, maximum) => typeof value === 'string' && value.length > 0 && value.length <= maximum && value === value.trim() && !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value);
function clearRegistry() {
  registry = null; projectEntries = []; projectStatus = ''; rendered.clear();
  document.querySelector('#apps').replaceChildren(); document.querySelector('#projects').replaceChildren();
  for (const selector of ['#apps-section', '#projects-section', '#project-status', '#desktop-empty', '#load-error']) document.querySelector(selector).hidden = true;
}
function currentIdentity(current, identity) {
  const next = getIdentity();
  return current === revision && hasIdentity() && (!identity || next?.username === identity.username && next.csrfToken === identity.csrfToken);
}
function renderGroup(selector, entries) {
  const signature = locale() + JSON.stringify(entries);
  if (signature === rendered.get(selector)) return;
  rendered.set(selector, signature);
  const links = entries.map(app => {
    const link = document.createElement('a');
    link.className = 'desktop-app workbench-app'; link.dataset.app = app.id;
    if (app.appId) link.dataset.appId = app.appId;
    if (app.resourceId) link.dataset.projectId = app.resourceId;
    const url = app.url ? new URL(app.url) : new URL(app.path, location.origin);
    if (!app.url && app.port !== undefined) url.port = String(app.port);
    link.href = url.href;
    link.addEventListener('click', () => reportExperience('app_open', { appId: app.appId || app.id }));
    const appName = app.labels?.[locale()]?.name ?? app.name;
    const appDescription = app.labels?.[locale()]?.description ?? app.description;
    link.setAttribute('aria-label', t(`Open ${appName}`, `打开 ${appName}`));
    const icon = document.createElement('img'); icon.className = 'app-icon workbench-icon'; icon.src = app.icon; icon.alt = ''; icon.width = 80; icon.height = 80;
    const name = document.createElement('span'); name.className = 'app-name'; name.textContent = appName;
    const description = document.createElement('span'); description.className = 'app-description'; description.id = `app-description-${app.id}`; description.textContent = appDescription;
    link.setAttribute('aria-describedby', description.id); link.title = appDescription;
    link.append(icon, name, description);
    return link;
  });
  document.querySelector(selector).replaceChildren(...links);
}
function renderRegistry() {
  const identity = getIdentity();
  const apps = (registry || []).filter(app => app.kind === 'app' && app.launcher !== false && (app.adminOnly ? identity?.platformAdmin === true : !identity || identity.apps.includes(app.id)));
  const showProjects = identity?.apps.includes('projects') && registry?.some(app => app.id === 'projects');
  const projects = showProjects ? projectEntries : [];
  const status = showProjects && projectStatus ? t(...projectMessages[projectStatus]) : '';
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
function summaries(value, spaceId) {
  if (!value || !Array.isArray(value.items) || value.items.length > 200) throw new Error('Invalid project summaries.');
  const seen = new Set(), allowed = ['resourceId', 'id', 'name', 'goal', 'owner', 'status', 'revision', 'updatedAt'];
  return value.items.map(item => {
    if (!item || Object.keys(item).some(key => !allowed.includes(key)) || !projectId(item.resourceId) || item.id !== undefined && item.id !== item.resourceId || seen.has(item.resourceId) || !text(item.name, 160) || !text(item.goal, 2000) || !['active', 'paused', 'completed'].includes(item.status) || typeof item.revision !== 'string' || !/^[1-9]\d{0,14}$/.test(item.revision) || !Number.isSafeInteger(Number(item.revision)) || item.owner !== null && item.owner !== undefined && !text(item.owner, 160) || typeof item.updatedAt !== 'string' || item.updatedAt.length > 40 || !Number.isFinite(Date.parse(item.updatedAt))) throw new Error('Invalid project summary.');
    seen.add(item.resourceId);
    const encoded = [...JSON.stringify([spaceId, item.resourceId])].map(char => char.charCodeAt(0).toString(16).padStart(2, '0')).join('');
    const url = new URL('/apps/projects/', location.origin);
    url.hash = new URLSearchParams({ project: item.resourceId, space: spaceId, view: 'overview' });
    return { id: 'project-' + encoded, appId: 'projects', resourceId: item.resourceId, kind: 'project', name: item.name, description: item.goal, icon: '/projects-icon.svg', url: url.href };
  });
}
function projectDirectory(value) {
  if (!value || !Array.isArray(value.spaces) || value.spaces.length > 100 || typeof value.partial !== 'boolean') throw new Error('Invalid project directory.');
  const seen = new Set(), entries = [];
  let partial = value.partial;
  for (const space of value.spaces) {
    if (!space || !identifier(space.spaceId) || seen.has(space.spaceId)) throw new Error('Invalid project space.');
    seen.add(space.spaceId);
    try { entries.push(...summaries(space, space.spaceId)); }
    catch { partial = true; }
  }
  return { entries, partial };
}
async function refreshProjects(force = false) {
  const identity = getIdentity();
  if (!hasIdentity() || !identity?.apps.includes('projects') || (registry && !registry.some(app => app.id === 'projects'))) return;
  if (!force && (projectController || document.visibilityState === 'hidden')) return;
  const current = revision;
  projectController?.abort();
  const active = new AbortController();
  projectController = active;
  try {
    const result = projectDirectory(await requestJson('/api/business/workbench/projects', active));
    if (projectController !== active || !currentIdentity(current, identity)) return;
    projectEntries = result.entries;
    projectStatus = result.partial ? 'partial' : '';
  } catch {
    if (projectController !== active || !currentIdentity(current, identity)) return;
    projectEntries = [];
    projectStatus = 'unavailable';
  } finally {
    if (projectController === active) projectController = undefined;
  }
  if (registry !== null) renderRegistry();
}
async function loadRegistry() {
  const current = ++revision;
  registryController?.abort(); projectController?.abort(); projectController = undefined;
  clearRegistry();
  if (!hasIdentity()) return;
  const identity = getIdentity(), registryStartedAt = performance.now();
  registryController = new AbortController();
  const apps = requestJson('/api/apps', registryController);
  if (identity?.apps.includes('projects')) projectStatus = 'loading';
  const projects = refreshProjects(true);
  try {
    const result = await apps;
    if (!currentIdentity(current, identity)) return;
    registry = result.apps; renderRegistry();
    await projects;
  } catch {
    if (!currentIdentity(current, identity)) return;
    projectController?.abort(); projectController = undefined;
    clearRegistry();
    reportExperience('page_error'); document.querySelector('#load-error').hidden = false;
  } finally {
    if (current === revision) reportExperience('registry_load', { durationMs: Math.round(performance.now() - registryStartedAt) });
  }
}
globalThis.addEventListener?.('praxis-locale-change', () => { if (registry) renderRegistry(); });
document.addEventListener('praxis-identity-change', () => { identityTriggered = true; void loadRegistry(); });
document.addEventListener('praxis-session-ended', () => { revision++; registryController?.abort(); projectController?.abort(); projectController = undefined; clearRegistry(); });
document.addEventListener('visibilitychange', () => { if (document.visibilityState !== 'hidden') void refreshProjects(true); });
if (typeof globalThis.addEventListener === 'function') globalThis.addEventListener('focus', () => void refreshProjects(true));
if (typeof setInterval === 'function') setInterval(() => void refreshProjects(), 30000);
if (await identityReady && !identityTriggered) await loadRegistry();
