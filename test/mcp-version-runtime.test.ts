import {expect,it} from 'vitest';
import {createServer} from 'node:http';
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {CustomizationHost} from '../src/customization/host.js';
import {mcpToolName} from '../src/customization/mcp-discovery.js';
import {readSession,readArtifact,hash} from '../src/journal.js';
import {run} from '../src/runtime.js';
import {temporary,key,response,callItem,textItem} from './helpers.js';

it('keeps active request schemas fixed after notification and adopts the next list at the run boundary',async()=>{
 const workspace=await temporary(),home=await temporary();let changed=false,calls=0,initializes=0;const bodies:any[]=[];
 const server=createServer(async(req,res)=>{
  if(req.method!=='POST'){res.writeHead(405).end();return;}let raw='';for await(const chunk of req)raw+=chunk;const m=JSON.parse(raw);
  if(m.id===undefined){res.writeHead(202).end();return;}
  if(m.method==='tools/call'){
   calls++;changed=true;res.writeHead(200,{'content-type':'text/event-stream'}).end(`data: ${JSON.stringify({jsonrpc:'2.0',method:'notifications/tools/list_changed'})}\n\ndata: ${JSON.stringify({jsonrpc:'2.0',id:m.id,error:{code:-32601,message:'old tool removed',data:{oldSchema:true}}})}\n\n`);return;
  }
  const result=m.method==='initialize'?(initializes++,{protocolVersion:'2025-11-25',capabilities:{tools:{listChanged:true}},serverInfo:{name:'versioned',version:'1'}}):{tools:[{name:'search',inputSchema:{type:'object',properties:{query:{type:changed?'number':'string'}},required:['query']}}]};
  res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({jsonrpc:'2.0',id:m.id,result}));
 });
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));await mkdir(join(workspace,'.nekomimi'));
 await writeFile(join(workspace,'.nekomimi/mcp.json'),JSON.stringify({version:1,servers:{versioned:{transport:'http',url:`http://127.0.0.1:${(server.address() as any).port}/mcp`}}}));
 const host=new CustomizationHost(workspace,home);
 try{
  const resource=(await host.catalog.discover()).find(r=>r.kind==='mcp')!;await host.catalog.decide(resource.id,true,true,0);const tool=mcpToolName(resource,'search');
  const result=await run({workspace,home,session:join(workspace,'session'),customization:host,apiKey:key,prompt:'call once',tools:[tool],fetch:async(_url,init)=>{bodies.push(JSON.parse(String(init?.body)));return response(bodies.length===1?[callItem(tool,{query:'old'})]:[textItem()]);}});
  expect(result.status,result.error).toBe('completed');expect(calls).toBe(1);expect(bodies).toHaveLength(2);
  for(const body of bodies)expect(body.tools[0].parameters.properties.query.type).toBe('string');
  const saved=await readSession(result.session),declarations=saved.events.filter(e=>e.type==='mcp.request.declarations');expect(declarations).toHaveLength(2);
  for(const event of declarations){const data=JSON.parse((await readArtifact(result.session,(event.payload as any).artifact)).toString());expect(data.declared).toEqual(bodies[0].tools);expect((event.payload as any).schemaHash).toBe(hash(JSON.stringify(bodies[0].tools)));}
  const failed=saved.events.find(e=>e.type==='tool.completed'&&(e.payload as any).name===tool)!;
  expect(JSON.parse((await readArtifact(result.session,(failed.payload as any).artifact)).toString())).toMatchObject({isError:true,details:{error:{code:-32601,data:{oldSchema:true}}}});
  await run({workspace,home,session:join(workspace,'next'),customization:host,apiKey:key,prompt:'new run',tools:[tool],fetch:async(_url,init)=>{expect(JSON.parse(String(init?.body)).tools[0].parameters.properties.query.type).toBe('number');return response([textItem()]);}});
  expect(initializes).toBe(2);expect(calls).toBe(1);
 }finally{await host.close();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
