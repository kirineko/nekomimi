import {expect,it} from 'vitest';
import {Journal} from '../src/journal.js';
import {McpDiscovery} from '../src/customization/mcp-discovery.js';
import type {McpConnection} from '../src/customization/mcp.js';
import {temporary} from './helpers.js';
function fixture(){
 let calls=0,waits=0,removed=false;
 const connection={resource:{id:'server',name:'fixture',hash:'config-1'},serverInfo:{name:'fixture',version:'1'},exposure:'deferred',tools:[{name:'search',inputSchema:{type:'object',properties:{query:{type:'string'}},required:['query']}}],ready:async()=>{waits++;},call:async()=>{calls++;return removed?{content:[{type:'text',text:'removed'}],details:{error:{code:-32601}},isError:true}:{content:[],details:{ok:true}};}} as unknown as McpConnection;
 return {connection,counts:()=>({calls,waits}),remove:()=>{removed=true;connection.tools=[];}};
}
it('persists complete discovery beyond a page and restores without connecting or executing',async()=>{
 const f=fixture(),directory=await temporary(),signal=new AbortController().signal;let journal=await Journal.open(directory);
 try{
  f.connection.tools.push({name:'second',inputSchema:{type:'object'}});
  const first=new McpDiscovery([f.connection],async()=>{},journal),page=await first.discover('server',signal,0,1);
  expect(page.items).toHaveLength(1);expect(page.total).toBe(2);expect(journal.events.filter(e=>e.type==='mcp.discovery.snapshot')).toHaveLength(1);
  await journal.close();journal=await Journal.open(directory);const before=f.counts();
  const restored=new McpDiscovery([f.connection],async()=>{},journal);await restored.restore();expect(f.counts()).toEqual(before);
  expect(restored.declarations()[0]).toMatchObject({revision:page.revision,requiresLiveVerification:true});expect(restored.declarations()[0]!.tools).toHaveLength(2);
  await restored.call('server',page.items[0]!.id,page.revision,{query:'q'},signal,false);expect(f.counts()).toEqual({calls:1,waits:2});
 }finally{await journal.close();}
});
it('rejects changed live schemas on restored calls and requires explicit rediscovery',async()=>{
 const f=fixture(),journal=await Journal.open(await temporary()),signal=new AbortController().signal;
 try{
  const first=new McpDiscovery([f.connection],async()=>{},journal),page=await first.discover('server',signal);
  f.connection.tools=[{name:'search',inputSchema:{type:'object',properties:{query:{type:'number'}},required:['query']}}];
  const restored=new McpDiscovery([f.connection],async()=>{},journal);await restored.restore();
  await expect(restored.call('server',page.items[0]!.id,page.revision,{query:'old'},signal,false)).rejects.toThrow('version changed');expect(f.counts().calls).toBe(0);
  const current=await restored.discover('server',signal);expect(current.revision).not.toBe(page.revision);
  await restored.call('server',current.items[0]!.id,current.revision,{query:1},signal,false);expect(f.counts().calls).toBe(1);
 }finally{await journal.close();}
});
it('retains the active snapshot and records a removed-tool error without selecting another name',async()=>{
 const f=fixture(),journal=await Journal.open(await temporary()),signal=new AbortController().signal;
 try{
  const discovery=new McpDiscovery([f.connection],async()=>{},journal),page=await discovery.discover('server',signal);f.remove();
  const still=await discovery.discover('server',signal);expect(still).toEqual(page);
  const result=await discovery.call('server',page.items[0]!.id,page.revision,{query:'old'},signal,false);expect(result).toMatchObject({isError:true,details:{raw:{error:{code:-32601}}}});expect(f.counts().calls).toBe(1);
  const next=new McpDiscovery([f.connection],async()=>{},journal);expect((await next.discover('server',signal)).items).toEqual([]);
 }finally{await journal.close();}
});
it('does not start disabled or hidden servers while restoring their saved discovery',async()=>{
 const f=fixture(),journal=await Journal.open(await temporary()),signal=new AbortController().signal;
 try{
  await new McpDiscovery([f.connection],async()=>{},journal).discover('server',signal);const counts=f.counts();
  for(const connections of [[],[{...f.connection,exposure:'hidden'} as McpConnection]]){
   const restored=new McpDiscovery(connections,async()=>{},journal);await restored.restore();expect(restored.declarations()).toEqual([]);expect(f.counts()).toEqual(counts);
  }
  expect(journal.events.filter(e=>e.type==='mcp.discovery.restore').every(e=>(e.payload as any).reason==='server-unavailable')).toBe(true);
 }finally{await journal.close();}
});
