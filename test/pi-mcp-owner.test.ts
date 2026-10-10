import {expect,it} from 'vitest';
import {createServer} from 'node:http';
import {McpConnection} from '../src/customization/mcp.js';
import type {Resource} from '../src/customization/resources.js';
import {temporary} from './helpers.js';

it('shares one connection owner and preserves initialization, pages and protocol errors',async()=>{
 let initializes=0,toolPages=0,calls=0;const methods:string[]=[];
 const server=createServer(async(req,res)=>{
  if(req.method!=='POST'){res.writeHead(405).end();return;}
  let raw='';for await(const chunk of req)raw+=chunk;const m=JSON.parse(raw);methods.push(m.method);
  if(m.id===undefined){res.writeHead(202).end();return;}
  let result:unknown,error:unknown;
  if(m.method==='initialize'){initializes++;result={protocolVersion:'2025-11-25',capabilities:{tools:{}},serverInfo:{name:'owner',version:'1'},instructions:'remote data only',_meta:{fixture:'kept'}};}
  else if(m.method==='tools/list'){toolPages++;result={tools:[{name:m.params?.cursor?'second':'first',inputSchema:{type:'object',properties:{}},_meta:{page:toolPages}}],...(m.params?.cursor?{}:{nextCursor:'second'})};}
  else{calls++;error={code:-32010,message:'structured rejection',data:{reason:'conflict',version:7}};}
  res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({jsonrpc:'2.0',id:m.id,...(error?{error}:{result})}));
 });
 await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 const connection=new McpConnection({id:'mcp:owner',name:'owner',config:{transport:'http',url:`http://127.0.0.1:${(server.address() as any).port}/mcp`}} as Resource,await temporary());
 try{
  await Promise.all([connection.connect(),connection.connect(),connection.connect()]);await connection.connect();
  expect(initializes).toBe(1);expect(toolPages).toBe(2);expect(connection.tools.map(t=>t.name)).toEqual(['first','second']);
  expect(connection.catalog().initialization).toMatchObject({instructions:'remote data only',_meta:{fixture:'kept'}});
  const value=await connection.call('first',{},new AbortController().signal);expect(value).toMatchObject({isError:true,details:{error:{code:-32010,message:'structured rejection',data:{reason:'conflict',version:7}}}});
  expect(calls).toBe(1);expect(connection.stale).toBe(false);expect(methods.filter(m=>m==='initialize')).toHaveLength(1);
 }finally{await connection.close();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
