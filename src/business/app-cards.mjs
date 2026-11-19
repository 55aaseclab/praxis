import { AppProviderRegistry, normalizeProviderCard, validateProviderResult } from './app-providers.mjs';
import { OPERATIONS } from './bridge.mjs';
const denied=()=>Object.assign(new Error('App projection access is unavailable.'),{status:403,code:'FORBIDDEN'});
export function canReadAppCards(access,appId,config={}) {
  if(!access?.workbench||appId==='polaris')return false;
  if(['letters','profiles'].includes(appId))return access.platformAdmin===true&&typeof access.userId==='string'&&config.appProviders?.[appId]?.ownerId===access.userId;
  return access.apps.includes(appId);
}
async function boundedJson(response) {
  if(!response.ok)throw new Error('App source unavailable.');
  const chunks=[];let size=0;
  for await(const chunk of response.body){size+=chunk.length;if(size>16*1024*1024){await response.body.cancel?.().catch(()=>{});throw new Error('App source is too large.');}chunks.push(chunk);}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
export class AppCards {
  constructor({auth,bridge,config,registry=new AppProviderRegistry(),fetchImpl=fetch,clock=Date.now}) {Object.assign(this,{auth,bridge,config,registry,fetch:fetchImpl,clock});}
  async get(token) {
    const session=this.auth.requireNativeSession(token),initial=this.auth.getWebAccess(token);
    if(!initial.workbench)throw denied();
    const providers=await this.registry.providers();
    const results=await Promise.all(providers.filter(provider=>canReadAppCards(initial,provider.app.id,this.config)).map(async provider=>{
      const appId=provider.app.id;
      if(provider.error)return{appId,status:'unavailable',items:[],code:provider.error};
      const {descriptor,module}=provider;
      if(!descriptor.cards.supported)return{appId,status:'unsupported',items:[]};
      if(descriptor.cards.execution==='browser')return{appId,status:'browser',items:[]};
      const adapterId=descriptor.adapterAppId||appId;
      if(descriptor.resourceMode!=='native-view'&&!this.config.apps?.[adapterId])return{appId,status:'unavailable',items:[],code:'APP_SOURCE_NOT_CONFIGURED'};
      const spaces=(this.config.apps?.[adapterId]?.spaces||[]).filter(spaceId=>this.auth.userPermissions(session.user.id,spaceId,adapterId,'read').length>0);
      const current=()=>{const access=this.auth.getWebAccess(token);if(!canReadAppCards(access,appId,this.config))throw denied();};
      try {
        current();
        const value=validateProviderResult(await module.getCards({
          spaces,actor:{userId:session.user.id,username:session.user.username},
          invoke:async request=>{
            current();
            if(!request||Object.keys(request).some(key=>!['spaceId','operation','resourceId','input'].includes(key))||!spaces.includes(request.spaceId)||!descriptor.readOperations?.includes(request.operation)||(OPERATIONS[adapterId]?.[request.operation]!=='read'||['cancel_job','retry_job'].includes(request.operation)))throw denied();
            const result=await this.bridge.invokeProjection(token,{...request,appId:adapterId});current();return result;
          },
          readNative:async request=>{
            current();
            if(descriptor.resourceMode!=='native-view'||!descriptor.nativeReads?.includes(request?.path)||request.resourceId!==descriptor.nativeResourceId)throw denied();
            const configured=this.config.appProviders?.[appId]?.url;
            if (!configured) throw new Error('Native card source is not configured.');
            const target=new URL(configured);
            if(!['http:','https:'].includes(target.protocol)||target.username||target.password||target.search||target.hash||target.pathname!=='/'||target.protocol==='http:'&&!['127.0.0.1','localhost','[::1]'].includes(target.hostname))throw denied();
            const data=await boundedJson(await this.fetch(new URL(request.path,target),{method:'GET',headers:{Accept:'application/json'},redirect:'error',signal:AbortSignal.timeout(7000)}));
            current();return data;
          }
        }));
        if(['unsupported','unavailable'].includes(value.status)&&value.items.length)throw new Error('Invalid unavailable cards.');
        let malformed = 0;
        const projected = [];
        for (const card of value.items) { try { projected.push(normalizeProviderCard(appId,card)); } catch { malformed++; } }
        const items=projected.filter(card=>{
          try {current();if(descriptor.resourceMode!=='native-view'){if(!card.spaceId||!card.resourceId)return false;this.auth.authorize(token,{appId:adapterId,spaceId:card.spaceId,resourceId:card.resourceId,action:'read'},{auditDenied:false});}return true;}catch{return false;}
        });
        return {appId,status:malformed?'partial':value.status==='ready'&&!items.length?'empty':value.status,items,...(malformed?{code:'INVALID_CARD_RECORD'}:{})};
      }catch(error){if(error.status===401)throw error;return {appId,status:error.status===403?'denied':'unavailable',items:[],code:error.status===403?'FORBIDDEN':'APP_SOURCE_UNAVAILABLE'};}
    }));
    const access=this.auth.getWebAccess(token);
    const allowed=results.filter(value=>canReadAppCards(access,value.appId,this.config));
    const items=allowed.flatMap(value=>value.items).filter(card=>{
      const provider=providers.find(value=>value.app.id===card.appId);
      try{if(provider.descriptor.resourceMode!=='native-view')this.auth.authorize(token,{appId:provider.descriptor.adapterAppId||card.appId,spaceId:card.spaceId,resourceId:card.resourceId,action:'read'},{auditDenied:false});return true;}catch{return false;}
    });
    return {schemaVersion:1,generatedAt:new Date(this.clock()).toISOString(),items:[...new Map(items.map(card=>[card.id,card])).values()],sources:allowed.map(({appId,status,code})=>({appId,status,...(code?{code}:{})})),partial:allowed.some(value=>['unavailable','partial'].includes(value.status))};
  }
}
