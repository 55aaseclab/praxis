import test from 'node:test';import assert from 'node:assert/strict';
import{mkdtemp,writeFile,readFile,mkdir,rm,lstat}from'node:fs/promises';import{join}from'node:path';import{tmpdir}from'node:os';import{createHash}from'node:crypto';
import{builtinProviderDefaults,mergeMissingProviderConfiguration,upgradeBuiltinProviderConfiguration}from'../scripts/builtin-install.mjs';
import{AuthStore}from'../src/business/auth.mjs';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
test('existing provider URLs, disabled overrides and data bindings survive filling new defaults',()=>{
 const config={issuer:'https://praxis.example',database:'/synthetic/auth.db',apps:{reminder:{keyFile:'/synthetic/key',spaces:['stable-space']}},appProviders:{finance:{url:'https://configured.example',runtime:{environment:{FINANCE_DATA:'/custom/ledger.json'}}},intelligence:{url:null}}};
 const before=structuredClone(config),defaults={finance:{url:'http://127.0.0.1:4329',runtime:{status:'ready',environment:{FINANCE_DATA:'/default/ledger.json'}}},intelligence:{url:'http://127.0.0.1:4330'},polaris:{url:'http://127.0.0.1:18787'}};
 const updated=mergeMissingProviderConfiguration(config,defaults);assert.deepEqual(config,before);assert.deepEqual(updated.apps,config.apps);assert.equal(updated.database,config.database);assert.equal(updated.appProviders.finance.url,'https://configured.example');assert.equal(updated.appProviders.finance.runtime.environment.FINANCE_DATA,'/custom/ledger.json');assert.equal(updated.appProviders.intelligence.url,null);assert.equal(updated.appProviders.polaris.url,'http://127.0.0.1:18787');
});
test('saved bootstrap target and port metadata determine origins instead of overriding deployment choices',()=>{
 const defaults=builtinProviderDefaults({providers:[],runtime:{finance:{PORT:'24329'},intelligence:{INTELLIGENCE_PORT:'24330'},polaris:{PORT:'28787'}},appTargets:{finance:'http://127.0.0.1:34329'}});
 assert.equal(defaults.finance.url,'http://127.0.0.1:34329');assert.equal(defaults.intelligence.url,'http://127.0.0.1:24330');assert.equal(defaults.polaris.url,'http://127.0.0.1:28787');
});
test('provider-only upgrade preserves account, identity, key and record bytes plus a private exact config rollback copy',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'praxis-provider-upgrade-'));t.after(()=>rm(directory,{recursive:true,force:true}));await mkdir(join(directory,'keys'));
 const untouched={'owner.json':'{"username":"synthetic-owner","password":"fictional-password"}\n','installation.json':'{"workspaceId":"stable-workspace","ownerId":"stable-owner","spaceId":"stable-space"}\n','keys/app.key':'fictional-service-key-bytes','records.json':'{"date":"2026-11-20","revision":"7","done":false}\n'};
 const digests={};for(const[name,bytes]of Object.entries(untouched)){await writeFile(join(directory,name),bytes,{mode:0o600});digests[name]=hash(Buffer.from(bytes));}
 const database=join(directory,'auth.db'),auth=new AuthStore({file:database,issuer:'http://127.0.0.1:14326'});auth.createUser({id:'stable-owner',username:'synthetic-owner',password:'Synthetic-test-password-2026'});auth.setPlatformAdmin({userId:'stable-owner',enabled:true});const session=auth.login({username:'synthetic-owner',password:'Synthetic-test-password-2026'});auth.close();digests['auth.db']=hash(await readFile(database));
 const file=join(directory,'core.json'),original=Buffer.from('{ "issuer":"https://praxis.example", "database":"/stable/auth.db", "apps":{"reminder":{"keyFile":"/stable/key","spaces":["stable-space"]}} }\n');await writeFile(file,original,{mode:0o600});
 const defaults={finance:{url:'http://127.0.0.1:4329'},intelligence:{url:'http://127.0.0.1:4330'},polaris:{url:'http://127.0.0.1:18787'}};
 const result=await upgradeBuiltinProviderConfiguration(file,defaults);assert.equal(result.changed,true);assert.equal(hash(await readFile(result.backupFile)),hash(original));assert.equal((await lstat(result.backupFile)).mode&0o777,0o600);assert.equal((await lstat(file)).mode&0o777,0o600);
 const updated=JSON.parse(await readFile(file,'utf8'));const baseline=JSON.parse(original);delete updated.appProviders;assert.deepEqual(updated,baseline);
 for(const[name,digest]of Object.entries(digests))assert.equal(hash(await readFile(join(directory,name))),digest,name);
 const committed=await readFile(file);assert.deepEqual(await upgradeBuiltinProviderConfiguration(file,defaults),{changed:false,backupFile:null});assert.equal(hash(await readFile(file)),hash(committed));
 const reopened=new AuthStore({file:database,issuer:'http://127.0.0.1:14326'});try{assert.equal(reopened.requirePlatformAdminSession(session.sessionToken).user.id,'stable-owner');}finally{reopened.close();}
});
test('invalid existing configuration fails closed without echoing its content or replacing bytes',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'praxis-provider-upgrade-invalid-'));t.after(()=>rm(directory,{recursive:true,force:true}));const file=join(directory,'core.json'),bytes=Buffer.from('PRIVATE_CONFIG_BODY');await writeFile(file,bytes,{mode:0o600});
 await assert.rejects(upgradeBuiltinProviderConfiguration(file,{finance:{url:'http://127.0.0.1:4329'}}),error=>!error.message.includes('PRIVATE_CONFIG_BODY')&&error.message.includes('configuration file is invalid'));
 assert.equal(hash(await readFile(file)),hash(bytes));
});

test('private reader defaults bind both providers to the web installation document owner',()=>{
 const webInstallation={ownerId:'synthetic-document-owner'};
 const providers=['letters','profiles'].map(id=>({app:{id},descriptor:{dataSources:[{id:'originals',location:{env:'PRAXIS_'+id.toUpperCase()+'_DIR'}}]}}));
 const defaults=builtinProviderDefaults({providers,runtime:{letters:{PRAXIS_LETTERS_DIR:'/synthetic/letters/documents'},profiles:{PRAXIS_PROFILES_DIR:'/synthetic/profiles/documents'}},ownerId:webInstallation.ownerId});
 for(const app of ['letters','profiles']){assert.equal(defaults[app].ownerId,webInstallation.ownerId);assert.equal(defaults[app].runtime.bindingSource,'installation-layout');}
 assert.throws(()=>builtinProviderDefaults({providers:[],runtime:{},ownerId:'invalid/owner'}),/private document owner/);
 assert.throws(()=>builtinProviderDefaults({providers:[],runtime:{},ownerId:''}),/private document owner/);
 const absent=builtinProviderDefaults({providers:[],runtime:{}});assert.equal(absent.letters,undefined);assert.equal(absent.profiles,undefined);
});
test('private reader owner upgrade adds only missing metadata, preserves overrides and is retry-idempotent',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'praxis-private-owner-upgrade-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const webInstallation={version:1,ownerId:'synthetic-web-owner',workspaceId:'unchanged-workspace'},webFile=join(directory,'web-installation.json');
 await writeFile(webFile,JSON.stringify(webInstallation),{mode:0o600});const webBytes=await readFile(webFile);
 const defaults=builtinProviderDefaults({providers:[],runtime:{},ownerId:JSON.parse(webBytes).ownerId});
 const file=join(directory,'core.json'),config={issuer:'https://praxis.example',database:'/stable/auth.db',apps:{},appProviders:{letters:{ownerId:'explicit-reader-owner',runtime:{environment:{PRAXIS_LETTERS_DIR:'/custom/letters'}}},profiles:{runtime:{environment:{PRAXIS_PROFILES_DIR:'/custom/profiles'}}}}};
 await writeFile(file,JSON.stringify(config),{mode:0o600});const original=await readFile(file);
 const upgraded=await upgradeBuiltinProviderConfiguration(file,defaults);assert.equal(upgraded.changed,true);assert.equal(hash(await readFile(upgraded.backupFile)),hash(original));
 const saved=JSON.parse(await readFile(file,'utf8'));assert.equal(saved.appProviders.letters.ownerId,'explicit-reader-owner');assert.equal(saved.appProviders.profiles.ownerId,webInstallation.ownerId);assert.equal(saved.appProviders.letters.runtime.environment.PRAXIS_LETTERS_DIR,'/custom/letters');assert.equal(saved.appProviders.profiles.runtime.environment.PRAXIS_PROFILES_DIR,'/custom/profiles');assert.deepEqual(saved.apps,config.apps);assert.equal(saved.database,config.database);
 assert.equal(hash(await readFile(webFile)),hash(webBytes));assert.deepEqual(await upgradeBuiltinProviderConfiguration(file,defaults),{changed:false,backupFile:null});
});
