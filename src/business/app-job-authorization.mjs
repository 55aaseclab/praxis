import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { readSigningKey, businessError } from './bridge.mjs';
const identifier=/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,199}$/;

export function createAppJobAuthorizationHandler({auth,config,registry}) {
  const endpoints=registry.apps.filter(app=>app.integration.web.jobAuthorization).map(app=>({adapterId:registry.businessId(app.id),...app.integration.web.jobAuthorization}));
  return async(request,response)=>{
    const endpoint=endpoints.find(value=>request.url===value.path);if(!endpoint)return false;
    const appId=endpoint.adapterId,settings=config.apps[appId];
    if(request.method!=='POST'||!settings)throw businessError(403,'FORBIDDEN');
    const chunks=[];let length=0;
    for await(const chunk of request){length+=chunk.length;if(length>Math.min(endpoint.maximumBytes||16384,65536))throw businessError(413,'REQUEST_TOO_LARGE');chunks.push(chunk);}
    const raw=Buffer.concat(chunks),assertion=request.headers['x-praxis-business-assertion'];
    if(typeof assertion!=='string'||assertion.length>8192)throw businessError(401,'INVALID_ASSERTION');
    const [payload,signature,extra]=assertion.split('.');if(!payload||!signature||extra)throw businessError(401,'INVALID_ASSERTION');
    const expected=createHmac('sha256',await readSigningKey(settings.keyFile)).update(payload).digest(),supplied=Buffer.from(signature,'base64url');
    if(supplied.length!==expected.length||!timingSafeEqual(supplied,expected))throw businessError(401,'INVALID_ASSERTION');
    let claims,job;try{claims=JSON.parse(Buffer.from(payload,'base64url').toString('utf8'));job=JSON.parse(raw.toString('utf8'));}catch{throw businessError(400,'INVALID_INPUT');}
    const now=Date.now();
    if(claims.v!==1||claims.appId!==appId||claims.method!=='POST'||claims.path!==endpoint.path||!Number.isSafeInteger(claims.expiresAt)||claims.expiresAt<=now||claims.expiresAt>now+30000||claims.bodyHash!==createHash('sha256').update(raw).digest('hex'))throw businessError(401,'INVALID_ASSERTION');
    if(!job||Object.keys(job).some(key=>!['spaceId','resourceId','userId','clientId','grantId','actions','expiresAt','firstPartyNative'].includes(key))||job.firstPartyNative!==undefined&&job.firstPartyNative!==true||!['spaceId','resourceId','userId','clientId','grantId'].every(key=>typeof job[key]==='string'&&identifier.test(job[key]))||!Array.isArray(job.actions)||!job.actions.length||job.actions.length>Math.min(endpoint.maximumActions||8,32)||job.actions.some(action=>typeof action!=='string'||!identifier.test(action))||!Number.isSafeInteger(job.expiresAt))throw businessError(400,'INVALID_INPUT');
    let authorized=false;
    try{
      if(!settings.spaces.includes(job.spaceId)||job.expiresAt<=now)throw businessError(403,'FORBIDDEN');
      const native=job.firstPartyNative===true&&job.clientId==='praxis-browser'&&job.grantId.startsWith('first-party-');
      const grant=native?null:auth.getGrant(job.grantId);
      if(grant&&(grant.userId!==job.userId||grant.clientId!==job.clientId||grant.expiresAt<job.expiresAt))throw businessError(403,'FORBIDDEN');
      authorized=job.actions.every(action=>{const resources=auth.userPermissions(job.userId,job.spaceId,appId,action);if(!resources.includes('*')&&!resources.includes(job.resourceId))return false;return native||grant.rules.some(rule=>rule.appId===appId&&rule.spaceId===job.spaceId&&rule.actions.includes(action)&&(rule.resources.includes('*')||rule.resources.includes(job.resourceId)));});
    }catch{authorized=false;}
    response.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});response.end(JSON.stringify({authorized}));return true;
  };
}
