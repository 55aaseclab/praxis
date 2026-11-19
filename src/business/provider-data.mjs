import { constants } from 'node:fs';
import { open, realpath } from 'node:fs/promises';
import { resolve, dirname, basename, isAbsolute, sep } from 'node:path';

const object = value => value !== null && typeof value==='object' && !Array.isArray(value);
const safePath = value => typeof value==='string' && isAbsolute(value) && resolve(value)===value && !/[\x00-\x1f\x7f]/.test(value);
const within = (path,base) => path===base || path.startsWith(base+sep);
const unavailable = () => Object.assign(new Error('App data binding is unavailable.'),{code:'APP_DATA_BINDING_UNAVAILABLE'});
function mappedPath(path, locations) {
  const mappings = locations.flatMap(value => {
    if(!safePath(value.hostPath)||!safePath(value.containerPath))return [];
    const folder=['directory','docker-volume','source','cache'].includes(value.kind);
    return [{host:folder?value.hostPath:dirname(value.hostPath),container:folder?value.containerPath:dirname(value.containerPath),volume:value.volumeName}];
  }).sort((a,b)=>b.container.length-a.container.length);
  for(const mapping of mappings)if(within(path,mapping.container))return {applicationPath:path,containerPath:path,hostPath:resolve(mapping.host,path.slice(mapping.container.length).replace(/^\//,'')),...(mapping.volume?{volumeName:mapping.volume}:{})};
  for(const mapping of mappings)if(within(path,mapping.host))return {applicationPath:path,hostPath:path,containerPath:resolve(mapping.container,path.slice(mapping.host.length).replace(/^\//,'')),...(mapping.volume?{volumeName:mapping.volume}:{})};
  const same=locations.find(value=>value.hostPath===path||value.containerPath===path);
  if(same)return {applicationPath:path,...Object.fromEntries(['hostPath','containerPath','volumeName'].flatMap(key=>same[key]?[[key,same[key]]]:[]))};
  return {applicationPath:path};
}
async function readPathMap(file,key) {
  if(!safePath(file)||await realpath(file)!==file)throw unavailable();
  const handle=await open(file,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  try {
    const stat=await handle.stat();if(!stat.isFile()||stat.size>262144||stat.mode&0o077||typeof process.getuid==='function'&&stat.uid!==process.getuid())throw unavailable();
    const value=JSON.parse(await handle.readFile('utf8'));
    if(!object(value?.[key]))throw unavailable();
    const paths=Object.values(value[key]).flatMap(item=>typeof item==='string'?[item]:object(item)?[item.file,item.path,item.dataFile,item.dataDir].filter(Boolean):[]);
    if(paths.some(path=>!safePath(path)))throw unavailable();
    return [...new Set(paths)];
  }finally{await handle.close();}
}
export function createDataSourceResolver({config={},root,environment={}}={}) {
  return async (source,{app,descriptor,bindings})=>{
    const loc=source.location||{};
    const settings=config.apps?.[descriptor.adapterAppId||app.id]||{};
    const runtime=config.appProviders?.[app.id]?.runtime||{};
    const candidates=(runtime.bindings||[]).filter(binding=>!loc.serviceRole||binding.role===loc.serviceRole);
    const selected=loc.env?candidates.filter(binding=>typeof binding.environment?.[loc.env]==='string'):candidates;
    const environments=new Set(selected.map(binding=>binding.environment?.[loc.env]).filter(Boolean));
    const directories=new Set(selected.map(binding=>binding.workingDirectory).filter(Boolean));
    if(loc.kind==='working-directory'&&directories.size>1&&!(runtime.bindingSource==='installation-layout'&&runtime.workingDirectory))throw unavailable();
    const activeEnvironment=environments.values().next().value;
    const activeDirectory=directories.values().next().value;
    const runtimeRows=(selected.length?selected:candidates).flatMap(binding=>(binding.mounts||[]).map(mount=>({kind:mount.type==='volume'?'docker-volume':'directory',hostPath:mount.source,containerPath:mount.destination,volumeName:mount.name})));
    const rows=[...runtimeRows,...(bindings?.apps?.find(row=>row.id===app.id)?.locations||[])];
    if(['browser','browser-file','external','derived'].includes(source.kind)||['browser','browser-file'].includes(loc.kind))return {status:'ready',...(loc.storageKey?{storageKey:loc.storageKey}:{}),description:source.description||(['browser','browser-file'].includes(source.kind)?'This source belongs to the browser used for the app.':'This source is owned by the linked application or external service.')};
    let base;
    if(loc.kind==='working-directory')base=runtime.bindingSource==='installation-layout'?runtime.workingDirectory:activeDirectory||runtime.workingDirectory;
    if(loc.env){
      if(!/^[A-Z][A-Z0-9_]{1,100}$/.test(loc.env)||/(?:SECRET|PASSWORD|TOKEN|KEY)/.test(loc.env))throw unavailable();
      const suffix=loc.env.replace(/^[A-Z]+_/,''), camel=suffix.toLowerCase().replace(/_([a-z])/g,(_,c)=>c.toUpperCase());
      if(Object.hasOwn(settings.providerEnvironment||{},loc.env)&&settings.providerEnvironment[loc.env]===null)throw unavailable();
      const registered=settings[camel]||(/SPACES_FILE$/.test(loc.env)?settings.spacesFile:undefined)||(/DATA_DIR$/.test(loc.env)?settings.dataDir:undefined)||(/(?:DATA|DATA_FILE|DATABASE)$/.test(loc.env)?settings.dataFile:undefined);
      const applied=runtime.bindingSource==='installation-layout'?runtime.environment?.[loc.env]:undefined;
      if(environments.size>1&&!settings.providerEnvironment?.[loc.env]&&!applied&&!registered&&!runtime.pathMaps?.[loc.env])throw unavailable();
      base=settings.providerEnvironment?.[loc.env]||applied||registered||activeEnvironment||(runtime.status==='ready'?runtime.environment?.[loc.env]:undefined)||environment[loc.env];
      if(!base&&loc.relative){const known=rows.find(row=>[row.hostPath,row.containerPath].some(path=>safePath(path)&&basename(path)===basename(loc.relative)));if(known)base=dirname(known.containerPath||known.hostPath);}
      if(!base&&!loc.map){
        const candidates=rows.filter(row=>row.kind===source.kind||source.kind==='directory'&&row.kind==='sqlite');
        const known=candidates.find(row=>safePath(row.containerPath)||safePath(row.hostPath));
        if(known)base=loc.relative?dirname(known.containerPath||known.hostPath):known.containerPath||known.hostPath;
      }
    }
    if(loc.map){
      if(loc.map!=='spaces')throw unavailable();
      let paths=[];
      const declaredMap=runtime.pathMaps?.[loc.env];
      if(object(declaredMap))paths=Object.values(declaredMap).filter(safePath);
      try {if(!paths.length)paths=await readPathMap(base,loc.map);}catch {paths=rows.filter(row=>row.kind==='json'&&safePath(row.containerPath||row.hostPath)).map(row=>row.containerPath||row.hostPath);}
      if(!paths.length)throw unavailable();
      return paths.map(path=>mappedPath(path+(loc.suffix||''),rows));
    }
    if(loc.kind==='source'||loc.sourceRelative){
      const relative=loc.sourceRelative||loc.relative||'';
      if(typeof relative!=='string'||relative.split('/').includes('..'))throw unavailable();
      const known=rows.find(row=>row.kind==='source'&&safePath(row.hostPath));
      if(known)return {...mappedPath(known.hostPath,rows),status:'ready'};
      if(!root)throw unavailable();
      return {applicationPath:resolve(root,app.source,relative),status:'ready',description:source.description||'Bundled with the installed application source.'};
    }
    if(!safePath(base))throw unavailable();
    let path=base;
    if(loc.relative){if(typeof loc.relative!=='string'||isAbsolute(loc.relative)||loc.relative.split('/').includes('..'))throw unavailable();path=resolve(base,loc.relative);if(!within(path,base))throw unavailable();}
    if(loc.suffix){if(!/^[.a-zA-Z0-9_-]{1,40}$/.test(loc.suffix))throw unavailable();path+=loc.suffix;}
    return {...mappedPath(path,rows),status:'ready'};
  };
}

export async function readProviderRuntime(file) {
  if(!file)return null;
  let handle;
  try {
    if(!safePath(file)||await realpath(file)!==file)throw unavailable();
    handle=await open(file,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
    const stat=await handle.stat();if(!stat.isFile()||stat.mode&0o077||stat.size>1024*1024||typeof process.getuid==='function'&&stat.uid!==process.getuid())throw unavailable();
    const value=JSON.parse(await handle.readFile('utf8'));
    if(value?.schemaVersion!==1||!Array.isArray(value.apps)||value.apps.length>128||!Number.isFinite(Date.parse(value.generatedAt)))throw unavailable();
    return value;
  }catch{return null;}finally{await handle?.close();}
}

export function mergeProviderRuntime(saved, observed, generatedAt) {
  if(saved?.bindingSource==='installation-layout')return {...observed,...saved,
    bindings:observed.bindings??saved.bindings,mounts:observed.mounts??saved.mounts,observedAt:generatedAt,
    environment:{...(observed.environment||{}),...(saved.environment||{})},
    pathMaps:{...(observed.pathMaps||{}),...(saved.pathMaps||{})}};
  return {...saved,...observed,pathMaps:{...(saved?.pathMaps||{}),...(observed.pathMaps||{})}};
}
