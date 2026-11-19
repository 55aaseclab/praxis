import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

async function launchers(apps, origin, options = {}) {
  const groups = new Map([['#apps', []], ['#projects', []]]);
  const nodes = new Map(['#apps', '#projects', '#apps-section', '#projects-section', '#project-status', '#desktop-empty', '#load-error'].map(id => [id, { hidden: true, append: link => groups.get(id).push(link), replaceChildren: (...links) => groups.get(id)?.splice(0, Infinity, ...links) }]));
  const element = () => ({
    dataset: {}, attributes: {}, children: [],
    setAttribute(name, value) { this.attributes[name] = value; },
    append(...children) { this.children.push(...children); },
    addEventListener() {},
  });
  const source = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  const launcherSource = source.replace(/^import .* from '\.\/(?:experience|identity|i18n)\.js';\n/gm, '');
  const events = new Map(), requests = []; let identity = options.identity || null, enabled = true;
  const controls = { groups, events, setIdentity(value) { identity = value; }, end() { enabled = false; events.get('praxis-session-ended')?.(); } };
  await runInNewContext(`(async () => {${launcherSource}\n})()`, {
    URL, URLSearchParams, setTimeout, clearTimeout,
    setInterval(handler, milliseconds) { groups.interval = { handler, milliseconds }; return 0; },
    performance: { now: () => 0 },
    mountLanguageControls() {}, locale: () => "zh", t: (_en, zh) => zh,
    reportExperience() {},
    startExperienceObserver() {},
    identityReady: Promise.resolve(true),
    hasIdentity: () => enabled,
    getIdentity: () => identity,
    AbortController,
    location: { origin },
    fetch: async (path, init = {}) => {
      const body = init.body ? JSON.parse(init.body) : undefined;
      requests.push({ path, body, headers: init.headers });
      const value = path === '/api/apps' ? { apps } : await options.respond?.(path, body, controls);
      return { ok: value !== undefined, json: async () => value };
    },
    document: {
      createElement: element,
      addEventListener(name, handler) { events.set(name, handler); },
      querySelector: selector => nodes.get(selector),
    },
  });
  groups.requests = requests; groups.nodes = nodes; groups.events = events;
  return groups;
}

test('launcher uses configured app URLs and excludes static project records', async () => {
  const groups = await launchers([
    { id: 'knowledge', kind: 'app', name: 'Knowledge', description: 'Knowledge', path: '/', port: 4324, url: 'https://polaris.example.test/apps/knowledge/', icon: '/knowledge-icon.svg' },
    { id: 'reminder', kind: 'app', name: 'Reminder', description: 'Tasks', path: '/', port: 4322, url: 'https://reminder.example.test:8443/', icon: '/reminder-icon.svg' },
    { id: 'sample-project', kind: 'project', name: 'Example project', description: 'Reference', path: '/reference/', port: 4324, url: 'https://polaris.example.test/apps/knowledge/reference/', icon: '/project-icon.svg' },
  ], 'https://polaris.example.test');
  const apps = groups.get('#apps');
  assert.equal(apps[0].href, 'https://polaris.example.test/apps/knowledge/');
  assert.equal(apps[1].href, 'https://reminder.example.test:8443/');
  for (const app of apps) {
    assert.equal(app.target, undefined);
    assert.equal(app.rel, undefined);
    assert.doesNotMatch(app.attributes['aria-label'], /新标签页/);
  }
  assert.equal(groups.get('#projects').length, 0);
});

test('unmapped launcher entries retain the current host with their independent local ports', async () => {
  const groups = await launchers([
    { id: 'travel', kind: 'app', name: 'Travel', description: 'Plans', path: '/', port: 4323, icon: '/travel-icon.svg' },
  ], 'http://private.example.test:4321');
  const apps = groups.get('#apps');
  assert.equal(apps[0].href, 'http://private.example.test:4323/');
  assert.equal(apps[0].target, undefined);
});

test('Polaris opens in the administrator’s current tab and stays hidden on ordinary and unmanaged desktops', async () => {
  const origin = 'https://workbench.example.test';
  const polaris = { id: 'polaris', kind: 'app', name: 'Polaris', adminOnly: true, path: '/', icon: '/polaris-icon.svg', url: `${origin}/apps/polaris/` };
  const groups = await launchers([polaris], origin, { identity: { apps: [], platformAdmin: true } });
  const [link] = groups.get('#apps');
  assert.equal(link.href, polaris.url);
  assert.equal(link.target, undefined);
  assert.equal(link.children[0].src, '/polaris-icon.svg');
  for (const identity of [null, { apps: ['polaris'], platformAdmin: false }]) {
    const ordinary = await launchers([polaris], origin, { identity });
    assert.equal(ordinary.get('#apps').length, 0);
  }
});

const registeredProjects = { id: 'projects', kind: 'app', launcher: false, name: 'Projects', description: 'Project app', path: '/', port: 4327, icon: '/projects-icon.svg' };
const registeredTool = { id: 'tingproof', kind: 'app', name: '听校', description: 'Audio', path: '/', port: 5173, icon: '/tingproof-icon.svg' };
const summary = (id, name = id) => ({ id, resourceId: id, name, goal: '第一行目标\n第二行目标', owner: null, status: 'active', revision: '1', updatedAt: '2026-11-15T12:00:00.000Z' });
const projectIdentity = { username: 'synthetic-project-owner', csrfToken: 'synthetic-csrf-token', apps: ['projects', 'tingproof'] };
const directory = items => ({ spaces: [{ spaceId: 'team', items }], partial: false });

test('three authorized project summaries become separate same-tab icons through one hidden application', async () => {
  const groups = await launchers([registeredProjects, registeredTool], 'https://workbench.synthetic.example', {
    identity: projectIdentity,
    respond: () => directory([summary('alpha', '<项目甲>'), summary('beta', '项目乙'), summary('gamma', '项目丙')]),
  });
  assert.deepEqual(groups.get('#apps').map(node => node.dataset.app), ['tingproof']);
  const projects = groups.get('#projects'); assert.equal(projects.length, 3);
  assert.equal(new Set(projects.map(node => node.dataset.app)).size, 3);
  for (const node of projects) {
    assert.equal(node.dataset.appId, 'projects'); assert.equal(node.target, undefined);
    const url = new URL(node.href), hash = new URLSearchParams(url.hash.slice(1));
    assert.equal(url.origin, 'https://workbench.synthetic.example'); assert.equal(url.pathname, '/apps/projects/');
    assert.equal(hash.get('project'), node.dataset.projectId); assert.equal(hash.get('space'), 'team'); assert.equal(hash.get('view'), 'overview');
  }
  assert.equal(projects[0].children[1].textContent, '<项目甲>');
  assert.deepEqual(groups.requests.map(value => value.path), ['/api/apps', '/api/business/workbench/projects']);
});

test('same project IDs in different spaces have distinct icons and failed spaces preserve other entries', async () => {
  const groups = await launchers([registeredProjects, registeredTool], 'https://workbench.synthetic.example', {
    identity: projectIdentity,
    respond: () => ({
      spaces: ['team-a', 'team-b'].map(id => ({ spaceId: id, items: [summary('alpha', id)] })), partial: true,
    }),
  });
  assert.equal(groups.get('#apps').length, 1); assert.equal(groups.get('#projects').length, 2);
  assert.notEqual(groups.get('#projects')[0].dataset.app, groups.get('#projects')[1].dataset.app);
});

test('malformed or duplicate summaries fail closed within their space without hiding unrelated apps', async () => {
  for (const items of [[summary('alpha'), summary('alpha')], [{ ...summary('alpha'), resourceId: '../private' }], [{ ...summary('alpha'), workItems: [] }], [{ ...summary('alpha'), name: '\u0000private' }]]) {
    const groups = await launchers([registeredProjects, registeredTool], 'https://workbench.synthetic.example', { identity: projectIdentity, respond: () => directory(items) });
    assert.equal(groups.get('#apps').length, 1); assert.equal(groups.get('#projects').length, 0);
  }
});

test('unmanaged and ungranted workbenches neither launch nor discover the generic Projects application', async () => {
  for (const identity of [null, { ...projectIdentity, apps: ['tingproof'] }]) {
    const groups = await launchers([registeredProjects, registeredTool], 'https://workbench.synthetic.example', { identity });
    assert.deepEqual(groups.requests.map(value => value.path), ['/api/apps']);
    assert.deepEqual(groups.get('#apps').map(node => node.dataset.app), ['tingproof']);
    assert.equal(groups.get('#projects').length, 0);
  }
});

test('late summary responses cannot refill icons after identity termination', async () => {
  const groups = await launchers([registeredProjects, registeredTool], 'https://workbench.synthetic.example', {
    identity: projectIdentity,
    respond(path, body, controls) {
      controls.end(); return directory([summary('alpha')]);
    },
  });
  assert.equal(groups.get('#projects').length, 0); assert.equal(groups.get('#apps').length, 0);
});

const settle = async () => { for (let step = 0; step < 8; step++) await new Promise(resolve => setImmediate(resolve)); };
test('foreground revalidation supersedes a stale in-flight project summary without losing other apps', async () => {
  let calls = 0, release;
  const held = new Promise(resolve => { release = resolve; });
  const groups = await launchers([registeredProjects, registeredTool], 'https://workbench.synthetic.example', {
    identity: projectIdentity,
    async respond(path) {
      calls++;
      if (calls === 2) { await held; return directory([summary('alpha')]); }
      return directory(calls === 1 ? [summary('alpha')] : []);
    },
  });
  assert.equal(groups.get('#projects').length, 1);
  groups.events.get('visibilitychange')(); await settle(); assert.equal(calls, 2);
  assert.equal(groups.get('#projects').length, 1);
  groups.events.get('visibilitychange')(); await settle(); assert.equal(calls, 3);
  assert.equal(groups.get('#projects').length, 0);
  release(); await settle();
  assert.equal(groups.get('#projects').length, 0); assert.equal(groups.get('#apps').length, 1);
});

test('bounded project-only polling clears revoked resource summaries without rereading other apps', async () => {
  let allowed = true;
  const groups = await launchers([registeredProjects, registeredTool], 'https://workbench.synthetic.example', {
    identity: projectIdentity, respond: () => directory(allowed ? [summary('alpha')] : []),
  });
  assert.equal(groups.interval.milliseconds, 30000); assert.equal(groups.get('#projects').length, 1);
  allowed = false; groups.interval.handler(); await settle();
  assert.equal(groups.get('#projects').length, 0); assert.equal(groups.get('#apps').length, 1);
  assert.equal(groups.requests.filter(value => value.path === '/api/apps').length, 1);
});

test('an unconnected service has a translated status and no launch target', async () => {
  const result = await launchers([{ id: 'finance', kind: 'app', name: 'Finance', unavailable: 'managed' }], 'http://127.0.0.1:4321');
  const [entry] = result.get('#apps');
  assert.equal(entry.href, undefined);
  assert.equal(entry.children.at(-1).textContent, '需受管授权');
});
