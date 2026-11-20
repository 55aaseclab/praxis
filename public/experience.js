import { appFact } from './app-registry.js';
const eventNames = new Set(['page_load', 'registry_load', 'app_open', 'page_error']);
let observing = false;
let pageLoadReported = false;

export async function reportExperience(eventName, options = {}) {
  try {
    if (!eventNames.has(eventName) || !options || typeof options !== 'object' || Array.isArray(options)) return false;
    const { durationMs, appId } = options;
    const event = { event_name: eventName };
    if (durationMs !== undefined) {
      if (typeof durationMs !== 'number' || !Number.isFinite(durationMs) || durationMs < 0 || durationMs > 600000) return false;
      event.duration_ms = Math.round(durationMs);
    }
    if (appId !== undefined) {
      if (!appFact(appId)) return false;
      event.app_id = appId;
    }
    const response = await globalThis.fetch('/api/observations', {
      method: 'POST',
      mode: 'same-origin',
      credentials: 'same-origin',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
      keepalive: true,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(event),
      ...(globalThis.AbortSignal?.timeout && { signal: globalThis.AbortSignal.timeout(3000) }),
    });
    return response.ok === true;
  } catch {
    return false;
  }
}

function reportPageLoad() {
  if (pageLoadReported) return;
  pageLoadReported = true;
  let durationMs;
  try {
    const navigation = globalThis.performance?.getEntriesByType?.('navigation')?.[0];
    const measured = navigation?.duration || navigation?.loadEventEnd;
    if (typeof measured === 'number' && measured > 0 && measured <= 600000) durationMs = measured;
  } catch {}
  void reportExperience('page_load', durationMs === undefined ? {} : { durationMs });
}

export function startExperienceObserver() {
  if (observing || !globalThis.document || typeof globalThis.addEventListener !== 'function') return;
  observing = true;
  const reportError = () => { void reportExperience('page_error'); };
  globalThis.addEventListener('error', reportError);
  globalThis.addEventListener('unhandledrejection', reportError);
  const afterLoad = () => { globalThis.setTimeout(reportPageLoad, 0); };
  if (globalThis.document.readyState === 'complete') afterLoad();
  else globalThis.addEventListener('load', afterLoad, { once: true });
}
