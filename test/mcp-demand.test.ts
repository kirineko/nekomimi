import {expect,it} from 'vitest';
import {createServer} from 'node:http';
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {CustomizationHost} from '../src/customization/host.js';
import {McpConnection} from '../src/customization/mcp.js';
import type {Resource} from '../src/customization/resources.js';
import {run} from '../src/runtime.js';
import {temporary,key,response,textItem} from './helpers.js';

it.each(['deferred','codemode','hidden'] as const)('does not wait for a %s server before the first ordinary request',async exposure=>{
 const workspace=await temporary(),home=await temporary();let initializes=0,models=0;
 const server=createServer(async(req,res)=>{if(req.method!=='POST'){res.writeHead(405).end();return;}let raw='';for await(const part of req)raw+=part;const m=JSON.parse(raw);if(m.method==='initialize'){initializes++;return;}res.writeHead(202).end();});
 await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 await mkdir(join(workspace,'.nekomimi'));await writeFile(join(workspace,'.nekomimi/mcp.json'),JSON.stringify({version:1,servers:{slow:{exposure,transport:'http',url:`http://127.0.0.1:${(server.address() as any).port}/mcp`}}}));
 const host=new CustomizationHost(workspace,home);
 try{
  const resource=(await host.catalog.discover()).find(r=>r.kind==='mcp')!;await host.catalog.decide(resource.id,true,true,0);
  const result=await run({workspace,home,customization:host,session:join(workspace,'session'),apiKey:key,prompt:'ordinary work',tools:[],fetch:async()=>{models++;return response([textItem()]);}});
  expect(result.status,result.error).toBe('completed');expect(models).toBe(1);
  if(exposure==='hidden')expect(initializes).toBe(0);
 }finally{await host.close();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
},5000);

it('bounds and cancels explicit waits without spawning another owner',async()=>{
 const workspace=await temporary();let initializes=0;
 const server=createServer(async(req,res)=>{if(req.method!=='POST'){res.writeHead(405).end();return;}let raw='';for await(const part of req)raw+=part;if(JSON.parse(raw).method==='initialize')initializes++;else res.writeHead(202).end();});
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 const connection=new McpConnection({id:'slow',name:'slow',config:{exposure:'deferred',transport:'http',url:`http://127.0.0.1:${(server.address() as any).port}/mcp`}} as Resource,workspace);
 try{
  await expect(connection.ready(undefined,100)).rejects.toThrow();
  const abort=new AbortController(),pending=connection.ready(abort.signal);abort.abort(new Error('explicit cancellation'));await expect(pending).rejects.toThrow('explicit cancellation');
  expect(initializes).toBe(1);expect(connection.state).toBe('connecting');
 }finally{await connection.close();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
for(const exposure of ['deferred','codemode'] as const)it(`discovers and calls a ${exposure} server through the recorded script bridge`,async()=>{
 const workspace=await temporary(),home=await temporary();let calls=0,models=0,initializes=0;
 const server=createServer(async(req,res)=>{
  if(req.method!=='POST'){res.writeHead(405).end();return;}let raw='';for await(const chunk of req)raw+=chunk;const m=JSON.parse(raw);
  if(m.id===undefined){res.writeHead(202).end();return;}
  const result=m.method==='initialize'?(initializes++,{protocolVersion:'2025-11-25',capabilities:{tools:{}},serverInfo:{name:'demand',version:'1'}}):m.method==='tools/list'?{tools:[{name:'search',inputSchema:{type:'object',properties:{query:{type:'string'}},required:['query']}}]}:(calls++,{content:[{type:'text',text:'found'}],structuredContent:{query:m.params.arguments.query}});
  res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({jsonrpc:'2.0',id:m.id,result}));
 });
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));await mkdir(join(workspace,'.nekomimi'));
 await writeFile(join(workspace,'.nekomimi/mcp.json'),JSON.stringify({version:1,servers:{demand:{exposure,transport:'http',url:`http://127.0.0.1:${(server.address() as any).port}/mcp`}}}));
 const host=new CustomizationHost(workspace,home);
 try{
  const resource=(await host.catalog.discover()).find(r=>r.kind==='mcp')!;await host.catalog.decide(resource.id,true,true,0);
  const {callItem}=await import('./helpers.js'),{readSession,readArtifact}=await import('../src/journal.js');
  const code=`const page=await tools.mcp_discover({server:${JSON.stringify(resource.id)}}); const result=await tools.mcp_call({server:${JSON.stringify(resource.id)},tool:page.details.items[0].id,revision:page.details.revision,args:{query:'needle'}}); return result.details.raw.structuredContent;`;
  const result=await run({workspace,home,session:join(workspace,'session'),customization:host,apiKey:key,prompt:'use script',tools:['codemode','mcp_discover','mcp_call'],fetch:async()=>response(++models===1?[callItem('codemode',{code})]:[textItem()])});
  expect(result.status,result.error).toBe('completed');expect(calls).toBe(1);
  const saved=await readSession(result.session);expect(saved.events.filter(e=>e.type==='mcp.discovery')).toHaveLength(1);
  const event=saved.events.find(e=>e.type==='tool.completed'&&(e.payload as any).name==='codemode')!;
  expect(JSON.parse((await readArtifact(result.session,(event.payload as any).artifact)).toString()).details.result).toMatchObject({ok:true,value:{query:'needle'}});
  await host.catalog.decide(resource.id,false,false,(await host.catalog.decisions()).revision);await host.close();
  const restarted=new CustomizationHost(workspace,home);
  try{
    const resumed=await run({workspace,home,session:result.session,customization:restarted,apiKey:key,prompt:'inspect history',tools:[],fetch:async()=>response([textItem()])});
    expect(resumed.status,resumed.error).toBe('completed');expect(calls).toBe(1);expect(initializes).toBe(1);
    expect((await readSession(result.session)).events.findLast(e=>e.type==='mcp.discovery.restore')?.payload).toMatchObject({server:resource.id,restored:false,reason:'server-unavailable'});
  }finally{await restarted.close();}

 }finally{await host.close();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
