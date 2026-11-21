import { credentialFromRequest } from './auth.mjs';
import { requireAccountSession } from './admin.mjs';
import { businessError } from './bridge.mjs';

const safePath = value => typeof value === 'string' && value.startsWith('/') && !value.startsWith('//') && !/[\\\x00-\x20]/.test(value) && !value.split(/[?#]/,1)[0].split('/').some(part=>part==='.'||part==='..');
const safeHeaders = new Set(['accept','range','if-range','if-none-match','content-type','content-length']);

export function appHttpContext(request,{auth,bridge,config,registry,appId,fetchImpl=fetch}) {
  const app=registry.getApp(appId),adapter=registry.businessId(appId),web=app.integration.web;
  const native=()=>requireAccountSession(request,{auth});
  const token=()=>credentialFromRequest(request);
  const authorize=query=>{
    native();
    if(query.appId!==undefined&&query.appId!==adapter||!auth.appSpaceEnabled(adapter,query.spaceId,config.apps))throw businessError(403,'FORBIDDEN');
    return auth.authorize(token(),{...query,appId:adapter},{auditDenied:false});
  };
  return Object.freeze({issuer:auth.issuer,requireNative:native,
    catalog:()=>{native();return bridge.catalog(token()).filter(space=>space.apps.some(value=>value.id===adapter));},
    authorize,
    invoke:input=>{native();if(input.appId!==undefined&&input.appId!==adapter)throw businessError(403,'FORBIDDEN');return bridge.invoke(token(),{...input,appId:adapter},{source:'web'});},
    readNative:async query=>{
      const declaration=web.nativeReads?.find(value=>value.path===query.path&&value.resource===query.resourceId&&value.action===query.action);
      if(!declaration||!safePath(query.path))throw businessError(403,'FORBIDDEN');
      authorize({spaceId:query.spaceId,resourceId:query.resourceId,action:query.action});
      const target=new URL(config.webGateway?.appTargets?.[appId]||`http://127.0.0.1:${web.nativePort}`);
      if(target.protocol!=='http:'||!['127.0.0.1','localhost','[::1]'].includes(target.hostname)||target.username||target.password||target.pathname!=='/'||target.search||target.hash)throw businessError(500,'INVALID_APP_TARGET');
      const response=await fetchImpl(new URL(query.path,target),{method:'GET',headers:{Accept:'application/json'},redirect:'error',signal:AbortSignal.timeout(5000)});
      if(!response.ok||!response.headers.get('content-type')?.includes('application/json'))throw businessError(503,'NATIVE_SOURCE_UNAVAILABLE');
      const maximum=Math.min(declaration.maximumBytes||2*1024*1024,8*1024*1024);let length=0;const chunks=[];
      for await(const chunk of response.body){length+=chunk.length;if(length>maximum)throw businessError(502,'INVALID_APP_RESPONSE');chunks.push(chunk);}
      authorize({spaceId:query.spaceId,resourceId:query.resourceId,action:query.action});
      return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    },
  });
}

export function createAppHttpHandler({auth,bridge,config,registry,fetchImpl}) {
  const handlers=registry.apps.flatMap(app=>(app.integration.web.httpHandlers||[]).map(value=>({appId:app.id,...value,handler:value.createHandler()})));
  return async(request,response)=>{
    const url=new URL(request.url,config.issuer),entry=handlers.find(value=>url.pathname.startsWith(value.prefix));
    if(!entry)return false;
    requireAccountSession(request,{auth});
    if(!['GET','HEAD'].includes(request.method))auth.requireRequestCsrf(request);
    const safeRequest=Object.freeze({url:request.url,method:request.method,headers:Object.freeze(Object.fromEntries(Object.entries(request.headers).filter(([key])=>safeHeaders.has(key))))});
    return entry.handler(safeRequest,response,appHttpContext(request,{auth,bridge,config,registry,appId:entry.appId,fetchImpl}));
  };
}
