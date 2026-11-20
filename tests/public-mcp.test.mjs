import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { PUBLIC_GUIDANCE_MCP_PATH, PUBLIC_GUIDANCE_TOOLS } from '../src/public-mcp.mjs';
import { createPraxisServer } from '../src/server.mjs';

test('the managed frontend serves public guidance before the private gateway without exposing business routes', async t => {
  let coreCalls=0;
  const core=http.createServer((request,response)=>{coreCalls++;response.writeHead(401,{'Content-Type':'application/json','WWW-Authenticate':'Bearer'});response.end('{"code":"UNAUTHENTICATED"}');});
  await new Promise(resolve=>core.listen(0,'127.0.0.1',resolve));
  let app;
  const frontend=http.createServer((request,response)=>app.emit('request',request,response));
  await new Promise(resolve=>frontend.listen(0,'127.0.0.1',resolve));
  const origin='http://127.0.0.1:'+frontend.address().port;
  app=createPraxisServer({webGateway:{enabled:true,canonicalUrl:origin,coreUrl:'http://127.0.0.1:'+core.address().port}});
  t.after(async()=>{app.close(()=>{});frontend.closeAllConnections();core.closeAllConnections();await Promise.all([new Promise(resolve=>frontend.close(resolve)),new Promise(resolve=>core.close(resolve))]);});
  const client=new Client({name:'synthetic-public-frontend',version:'1.0.0'});
  t.after(()=>client.close());
  await client.connect(new StreamableHTTPClientTransport(new URL(PUBLIC_GUIDANCE_MCP_PATH,origin)));
  assert.deepEqual((await client.listTools()).tools.map(tool=>tool.name),PUBLIC_GUIDANCE_TOOLS.map(tool=>tool.name));
  const guide=await client.callTool({name:'praxis_use_guide',arguments:{platform:'other'}});
  assert.equal(guide.structuredContent.homeScreen.automaticInstallation,false);
  assert.equal(coreCalls,0);
  for(const path of ['/api/apps','/apps/travel/']){
    const response=await fetch(origin+path,{redirect:'manual'});assert.equal(response.status,401);await response.body?.cancel();
  }
  const home=await fetch(origin+'/',{redirect:'manual'});assert.equal(home.status,200);assert.match(await home.text(),/A self-hosted workbench/);
  assert.equal(coreCalls,0);
  const protectedResponse=await fetch(origin+'/mcp',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/list'})});
  assert.equal(protectedResponse.status,401);await protectedResponse.body?.cancel();assert.equal(coreCalls,1);
});
