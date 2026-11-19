import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { readSigningKey, businessError } from './bridge.mjs';

const path = '/api/business/slides/authorize-job';
const identifier = /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,199}$/;

export function createSlidesJobAuthorizationHandler({ auth, config }) {
  return async (request, response) => {
    if (request.url !== path) return false;
    if (request.method !== 'POST' || !config.apps.slides) throw businessError(403, 'FORBIDDEN');
    const chunks = []; let length = 0;
    for await (const chunk of request) { length += chunk.length; if (length > 16384) throw businessError(413, 'REQUEST_TOO_LARGE'); chunks.push(chunk); }
    const raw = Buffer.concat(chunks);
    const assertion = request.headers['x-praxis-business-assertion'];
    if (typeof assertion !== 'string' || assertion.length > 8192) throw businessError(401, 'INVALID_ASSERTION');
    const [payload, signature, extra] = assertion.split('.');
    if (!payload || !signature || extra) throw businessError(401, 'INVALID_ASSERTION');
    const expected = createHmac('sha256', await readSigningKey(config.apps.slides.keyFile)).update(payload).digest();
    const supplied = Buffer.from(signature, 'base64url');
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) throw businessError(401, 'INVALID_ASSERTION');
    let claims, job;
    try { claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')); job = JSON.parse(raw.toString('utf8')); }
    catch { throw businessError(400, 'INVALID_INPUT'); }
    const now = Date.now();
    if (claims.v !== 1 || claims.appId !== 'slides' || claims.method !== 'POST' || claims.path !== path || !Number.isSafeInteger(claims.expiresAt) || claims.expiresAt <= now || claims.expiresAt > now + 30000 || claims.bodyHash !== createHash('sha256').update(raw).digest('hex')) throw businessError(401, 'INVALID_ASSERTION');
    if (!job || Object.keys(job).some(key => !['spaceId', 'resourceId', 'userId', 'clientId', 'grantId', 'actions', 'expiresAt', 'firstPartyNative'].includes(key)) || job.firstPartyNative !== undefined && job.firstPartyNative !== true || !['spaceId', 'resourceId', 'userId', 'clientId', 'grantId'].every(key => typeof job[key] === 'string' && identifier.test(job[key])) || !Array.isArray(job.actions) || !job.actions.length || job.actions.length > 8 || job.actions.some(action => typeof action !== 'string' || !identifier.test(action)) || !Number.isSafeInteger(job.expiresAt)) throw businessError(400, 'INVALID_INPUT');
    let authorized = false;
    try {
      if (!config.apps.slides.spaces.includes(job.spaceId) || job.expiresAt <= now) throw businessError(403, 'FORBIDDEN');
      const native = job.firstPartyNative === true && job.clientId === 'praxis-browser' && job.grantId.startsWith('first-party-');
      const grant = native ? null : auth.getGrant(job.grantId);
      if (grant && (grant.userId !== job.userId || grant.clientId !== job.clientId || grant.expiresAt < job.expiresAt)) throw businessError(403, 'FORBIDDEN');
      authorized = job.actions.every(action => {
        const resources = auth.userPermissions(job.userId, job.spaceId, 'slides', action);
        if (!resources.includes('*') && !resources.includes(job.resourceId)) return false;
        return native || grant.rules.some(rule => rule.appId === 'slides' && rule.spaceId === job.spaceId && rule.actions.includes(action) && (rule.resources.includes('*') || rule.resources.includes(job.resourceId)));
      });
    } catch { authorized = false; }
    response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    response.end(JSON.stringify({ authorized }));
    return true;
  };
}
