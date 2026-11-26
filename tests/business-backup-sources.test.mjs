import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, chmod, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { withBusinessBackupSources } from '../src/business/backup-sources.mjs';
async function fixture(t) {
 const root=await mkdtemp(join(tmpdir(),'praxis-business-source-'));t.after(()=>rm(root,{recursive:true,force:true}));const owner=randomUUID(),workspaceId=randomUUID();
 const storage={schemaVersion:1,workspaceId,deviceId:owner,activeWriterDeviceId:owner,dataRoot:join(root,'data'),stateRoot:join(root,'staging'),repositories:[{id:'local',type:'local',path:join(root,'repository'),passwordFile:join(root,'password')}],appSources:[],coverage:{omitted:[]}};
 const database=join(root,'auth.db'),eventsDatabase=join(root,'events.db');for(const file of[database,eventsDatabase]){const db=new DatabaseSync(file);db.exec('CREATE TABLE marker(value TEXT)');db.close();}
 const metadata=new DatabaseSync(eventsDatabase);metadata.exec('CREATE TABLE source_cursors(app TEXT,space TEXT,cursor INTEGER);CREATE TABLE business_events(app TEXT,space TEXT)');metadata.close();
 const mapping=join(root,'spaces.json'), initialized=join(root,'initialized.json'), absent=join(root,'uninitialized.json');await writeFile(initialized,'{"version":2,"recurring":[],"plans":[],"pool":[],"history":[]}',{mode:0o600});await writeFile(mapping,JSON.stringify({spaces:{'initialized-space':initialized}}),{mode:0o600});
 return{root,storage,business:{database,eventsDatabase,apps:{slides:{spacesFile:mapping}}},mapping,initialized,absent,active(table,space){const db=new DatabaseSync(eventsDatabase);if(table==='source_cursors')db.prepare('INSERT INTO source_cursors VALUES(?,?,?)').run('slides',space,1);else db.prepare('INSERT INTO business_events VALUES(?,?)').run('slides',space);db.close();}};
}
test('app-owned recovery preserves initialized mapped sources without reading payloads',async t=>{
 const f=await fixture(t),result=await withBusinessBackupSources(f.storage,f.business),source=result.appSources.find(item=>item.id==='slides');
  assert.equal(source.source,f.initialized);assert.equal(source.target,'lattice.db');assert.equal(result.appSources.filter(item=>item.id==='praxis-business').length,2);
});
test('a mapped absent store fails closed even when other sources are healthy',async t=>{
 const f=await fixture(t);await writeFile(f.mapping,JSON.stringify({spaces:{'initialized-space':f.initialized,'absent-space':f.absent}}));
 await assert.rejects(withBusinessBackupSources(f.storage,f.business),{code:'MISSING_ACTIVE_DATA'});
});
test('app recovery retains private-config, source-target, symlink and backup-overlap guards',async t=>{
 const f=await fixture(t);await chmod(f.mapping,0o644);await assert.rejects(withBusinessBackupSources(f.storage,f.business),{code:'UNSAFE_CONFIG'});await chmod(f.mapping,0o600);
 const alias=join(f.root,'alias.json');await symlink(f.initialized,alias);await writeFile(f.mapping,JSON.stringify({spaces:{one:alias}}));await assert.rejects(withBusinessBackupSources(f.storage,f.business),{code:'UNSAFE_PATH'});
 const backup=join(f.root,'repository');await mkdir(backup);const inside=join(backup,'record.json');await writeFile(inside,'{}');await writeFile(f.mapping,JSON.stringify({spaces:{one:inside}}));await assert.rejects(withBusinessBackupSources(f.storage,f.business),{code:'UNSAFE_PATH'});
});
test('an extra app can register owned recovery sources through a config-only facade without a Core app branch',async t=>{
 const f=await fixture(t),source=join(f.root,'sample.db');const db=new DatabaseSync(source);db.exec('CREATE TABLE records(id TEXT)');db.close();let observed=false;
 const registry={apps:[{id:'workshop',integration:{business:{adapterId:'workshop-api'},storage:{rootId:'workshop',sourceId:'workshop-data',recovery:{configFields:['dataFile'],async collect(ctx){assert.deepEqual(Object.keys(ctx.config),['dataFile']);assert.equal(ctx.config.key,undefined);observed=true;await ctx.register({kind:'sqlite',source:ctx.config.dataFile,target:'records.db'});}}}}}]};
 const business={...f.business,apps:{'workshop-api':{dataFile:source,key:'SYNTHETIC_KEY_NOT_IN_FACADE'}}};const result=await withBusinessBackupSources(f.storage,business,{registry});assert.equal(observed,true);assert.equal(result.appSources.find(item=>item.id==='workshop-data').source,source);assert.ok(!JSON.stringify(result).includes('SYNTHETIC_KEY_NOT_IN_FACADE'));
});

test('worker mount discovery includes declared optional parents without claiming their files are backed up',async t=>{
 const f=await fixture(t),declared=[];const result=await withBusinessBackupSources(f.storage,f.business,{onDeclaredSource:source=>declared.push(source)});
 assert.ok(declared.some(source=>source.source===`${f.initialized}.blobs`));assert.ok(!result.appSources.some(source=>source.source===`${f.initialized}.blobs`));assert.ok(Object.isFrozen(declared[0]));
});
