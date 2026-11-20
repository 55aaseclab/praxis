import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn,execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import { mkdtemp,mkdir,writeFile,readFile,stat,rm,cp } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join,resolve } from 'node:path';
import { demoDeclaration,demoEnvironment } from '../scripts/demo-app.mjs';
import { writeInstalledAppsFixture } from './helpers/app-manifest-fixture.mjs';
const execute=promisify(execFile);
const git=(cwd,...args)=>execute('git',['-C',cwd,...args]);
async function setupGit(dir){await git(dir,'init','-q','-b','main');await git(dir,'config','user.name','Synthetic demo maintainer');await git(dir,'config','user.email','synthetic@example.test');}

test('an additional pinned app owns its demo seed/command while the runner isolates environment and cleans up after a signal', {timeout:20000},async t=>{
 const area=await mkdtemp(join(tmpdir(),'praxis-demo-owned-test-'));t.after(()=>rm(area,{recursive:true,force:true}));const origin=join(area,'origin'),root=join(area,'platform');await mkdir(origin);await mkdir(root);await setupGit(origin);await setupGit(root);
 // Write the ordinary app manifest once, then let a real local submodule carry it.
 const holder=join(area,'holder');await writeInstalledAppsFixture(holder,[{id:'sample-notebook',name:'Synthetic notebook'}]);await cp(join(holder,'third_party/sample-notebook'),origin,{recursive:true});
 await mkdir(join(origin,'praxis'));await writeFile(join(origin,'praxis-integration.mjs'),`import{createDemoIntegration}from'./praxis/demo.mjs';export function createIntegration(){return {schemaVersion:1,appId:'sample-notebook',web:{slug:'notebook',policy:'grant',kind:'proxy',nativePort:45125},deployment:{demo:createDemoIntegration()}}}`);
 await writeFile(join(origin,'praxis/demo.mjs'),`import{join}from'node:path';export function createDemoIntegration(){return {supported:true,module:'praxis/demo.mjs',plan({dataDir}){return {steps:[{command:'node',args:['seed.mjs'],environment:{NOTEBOOK_DEMO_DATA:dataDir}}],server:{args:['server.mjs'],environment:{NOTEBOOK_DEMO_DATA:dataDir}}}}}}`);
 await writeFile(join(origin,'seed.mjs'),`import{writeFile}from'node:fs/promises';if(process.env.SYNTHETIC_PRIVATE_TOKEN)throw Error('Inherited private token');await writeFile(process.env.NOTEBOOK_DEMO_DATA+'/notes.json','{"synthetic":true}');`);
 await writeFile(join(origin,'server.mjs'),`import{createServer}from'node:http';import{readFile}from'node:fs/promises';createServer(async(req,res)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify({home:process.env.HOME,tmp:process.env.TMPDIR,host:process.env.HOST,privateToken:process.env.SYNTHETIC_PRIVATE_TOKEN||null,fixture:JSON.parse(await readFile(process.env.NOTEBOOK_DEMO_DATA+'/notes.json','utf8')),entry:'pinned'}))}).listen(Number(process.env.PORT),'127.0.0.1');`);
 await git(origin,'add','.');await git(origin,'commit','-qm','Synthetic pinned app');
 await git(root,'-c','protocol.file.allow=always','submodule','add','-q',origin,'third_party/sample-notebook');await mkdir(join(root,'config'));await writeFile(join(root,'config/installed-apps.json'),JSON.stringify({schemaVersion:1,apps:[{source:'third_party/sample-notebook'}]}));await git(root,'add','.');await git(root,'commit','-qm','Synthetic installed selection');
 // A dirty working source must not enter the archived demo.
 await writeFile(join(root,'third_party/sample-notebook/server.mjs'),'throw Error("Unpinned working source was used");');
 const reservation=createServer();reservation.listen(0,'127.0.0.1');await once(reservation,'listening');const port=reservation.address().port;await new Promise(r=>reservation.close(r));
 const child=spawn(process.execPath,[resolve('scripts/demo-app.mjs'),'sample-notebook',String(port)],{env:{PATH:process.env.PATH,PRAXIS_APP_SOURCE_ROOT:root,SYNTHETIC_PRIVATE_TOKEN:'synthetic-must-not-pass'},stdio:['ignore','pipe','pipe']});let stopped=false;t.after(()=>{if(!stopped)child.kill('SIGTERM');});const lines=createInterface({input:child.stdout}),errors=[];child.stderr.setEncoding('utf8').on('data',part=>errors.push(part));
 const base=await Promise.race([new Promise(resolve=>{lines.on('line',line=>{if(line.startsWith('Demo workbench: '))resolve(line.slice('Demo workbench: '.length));});}),once(child,'close').then(([code])=>{throw Error('Demo exited early '+code+': '+errors.join(''));})]);
 const listed=await(await fetch(new URL('/api/apps',base))).json(),entry=listed.apps.find(app=>app.id==='sample-notebook');assert.ok(entry);assert.equal(entry.launcher,true);const body=await(await fetch(entry.url)).json();assert.equal(body.entry,'pinned');assert.deepEqual(body.fixture,{synthetic:true});assert.equal(body.privateToken,null);assert.equal(body.host,'127.0.0.1');assert.equal(body.home,join(body.tmp,'home'));assert.equal((await stat(body.tmp)).mode&0o777,0o700);assert.ok(!body.home.startsWith(root));
 const closing=once(child,'close');child.kill('SIGTERM');const [code]=await closing;stopped=true;assert.equal(code,143);await assert.rejects(stat(body.tmp),{code:'ENOENT'});await assert.rejects(fetch(entry.url));
});

test('unsupported apps do not acquire a fake demo, and app environment cannot replace isolated process controls',()=>{
 assert.throws(()=>demoDeclaration('static-reader',{getApp:()=>({integration:{deployment:{}}})}),/does not declare/);
 for(const name of ['HOME','PATH','TMPDIR','HOST','PORT','NODE_OPTIONS','PRAXIS_APP_SOURCE_ROOT'])assert.throws(()=>demoEnvironment({HOME:'/synthetic/home'},{[name]:'not-allowed'}));
 assert.deepEqual(demoEnvironment({HOME:'/synthetic/home'},{NOTEBOOK_DEMO_DATA:'/synthetic/data'}),{HOME:'/synthetic/home',NOTEBOOK_DEMO_DATA:'/synthetic/data'});
});
