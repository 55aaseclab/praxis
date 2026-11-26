import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createPublicMcpHandler, PUBLIC_GUIDANCE_MCP_PATH, PUBLIC_GUIDANCE_TOOLS } from '../src/public-mcp.mjs';
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
  for(const path of ['/api/apps','/apps/tingproof/']){
    const response=await fetch(origin+path,{redirect:'manual'});assert.equal(response.status,401);await response.body?.cancel();
  }
  const home=await fetch(origin+'/',{redirect:'manual'});assert.equal(home.status,200);assert.match(await home.text(),/A self-hosted workbench/);
  assert.equal(coreCalls,0);
  const protectedResponse=await fetch(origin+'/mcp',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/list'})});
  assert.equal(protectedResponse.status,401);await protectedResponse.body?.cancel();assert.equal(coreCalls,1);
});


test('real public MCP SDK guidance explains designated OAuth space and authenticated SDK fallback in both languages', async t => {
  let handler;
  const server = http.createServer((request, response) => handler(request, response));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  handler = createPublicMcpHandler({ origin });
  t.after(async () => { handler.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  for (const language of ['en', 'zh-CN']) {
    const client = new Client({ name: 'synthetic-public-space-guide', version: '1.0.0' });
    try {
      await client.connect(new StreamableHTTPClientTransport(new URL(PUBLIC_GUIDANCE_MCP_PATH, origin), {
        requestInit: { headers: { 'Accept-Language': language } },
      }));
      const tools = (await client.listTools()).tools;
      assert.deepEqual(tools.map(tool => tool.name), PUBLIC_GUIDANCE_TOOLS.map(tool => tool.name));
      const guide = (await client.callTool({ name: 'praxis_use_guide', arguments: { platform: 'other' } })).structuredContent;
      assert.match(guide.workflow[1].text, language === 'en' ? /native space dropdown.*explicitly select/ : /原生空间下拉框.*明确勾选/);
      assert.match(guide.workflow[1].text, language === 'en' ? /create one inline; creation grants no app or resource access/ : /内联创建，创建不授予应用或资源访问权限/);
      const instructions = guide.spaceInstructions.join('\n');
      for (const field of ['space_id', 'arguments.spaceId', 'tools/call', 'initialize', 'praxis_refresh_capabilities', 'spaces[].spaceId']) assert.ok(instructions.includes(field), `${language}: documented field ${field}`);
      assert.match(instructions, language === 'en' ? /strip or hide token extensions/ : /剥离或隐藏.*令牌扩展/);
      assert.match(instructions, language === 'en' ? /never guess an ID or choose the first space arbitrarily/ : /不猜测 ID，也不任取第一个空间/);
      assert.match(instructions, language === 'en' ? /Every tool call still checks space, app, action and resource access/ : /每次工具调用仍校验空间、应用、动作和资源权限/);
      assert.equal(Object.hasOwn(guide, 'spaces'), false, 'anonymous guidance exposes fixed instructions, not account catalog spaces');
      const resources = (await client.listResources()).resources;
      assert.equal(resources.length, 1);
      const skill = (await client.readResource({ uri: resources[0].uri })).contents.map(content => content.text || '').join('\n');
      for (const phrase of ['arguments.spaceId', 'spaces[].spaceId', 'token extension', '令牌扩展']) assert.ok(skill.includes(phrase), `companion skill includes ${phrase}`);
    } finally { await client.close(); }
  }
});
