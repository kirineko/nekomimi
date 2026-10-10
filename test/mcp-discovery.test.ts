import {expect,it} from 'vitest';
import {McpDiscovery,mcpToolName} from '../src/customization/mcp-discovery.js';
import type {McpConnection} from '../src/customization/mcp.js';

it('separates normalized names and stable server identities regardless of discovery order',()=>{
 const a={id:'project:one',name:'a-b'},b={id:'user:two',name:'a_b'};
 expect(mcpToolName(a,'search')).not.toBe(mcpToolName(b,'search'));
 expect(mcpToolName(a,'search')).toBe(mcpToolName({...a},'search'));
 expect(mcpToolName(a,'search')).not.toBe(mcpToolName(a,'other'));
 expect(mcpToolName({id:'long',name:'a'.repeat(100)},'x')).toHaveLength(57);
});
it('requires discovery and exact versions, validates schemas and rechecks authorization',async()=>{
 let allowed=true,calls=0;const connection={resource:{id:'server',name:'same',hash:'v1'},exposure:'deferred',tools:[{name:'search',inputSchema:{type:'object',required:['query'],properties:{query:{type:'string'}}}}],ready:async()=>{},call:async()=>{calls++;return {content:[],details:{ok:true}};}} as unknown as McpConnection;
 const discovery=new McpDiscovery([connection],async()=>{if(!allowed)throw Error('revoked');}),signal=new AbortController().signal;
 await expect(discovery.call('server','tool','none',{},signal,false)).rejects.toThrow('Discover');
 const page=await discovery.discover('server',signal);page.items[0]!.name='mutated response';
 await expect(discovery.call('server',page.items[0]!.id,'wrong',{query:'q'},signal,false)).rejects.toThrow('revision');
 await expect(discovery.call('server',page.items[0]!.id,page.revision,{query:1},signal,false)).rejects.toThrow('arguments');
 await discovery.call('server',page.items[0]!.id,page.revision,{query:'q'},signal,false);expect(calls).toBe(1);
 allowed=false;await expect(discovery.call('server',page.items[0]!.id,page.revision,{query:'q'},signal,false)).rejects.toThrow('revoked');expect(calls).toBe(1);
});
it('does not reveal hidden servers or permit direct calls to script-only servers',async()=>{
 let calls=0;const connection={resource:{id:'server',name:'script',hash:'v1'},exposure:'codemode',tools:[{name:'job',inputSchema:{type:'object'}}],ready:async()=>{},call:async()=>{calls++;return {content:[],details:{}};}} as unknown as McpConnection;
 const signal=new AbortController().signal,discovery=new McpDiscovery([connection],async()=>{}),page=await discovery.discover('server',signal);
 await expect(discovery.call('server',page.items[0]!.id,page.revision,{},signal,false)).rejects.toThrow('Codemode');
 await discovery.call('server',page.items[0]!.id,page.revision,{},signal,true);expect(calls).toBe(1);
 const hidden=new McpDiscovery([{...connection,exposure:'hidden'} as McpConnection],async()=>{});
 await expect(hidden.discover('server',signal)).rejects.toThrow('hidden');
});
it('routes normalized-name collisions by exact server identity and keeps schemas isolated',async()=>{
 const seen:string[]=[];
 const connections=[['project:one','a-b'],['user:two','a_b']].map(([id,name])=>({resource:{id,name,hash:'v1'},exposure:'deferred',tools:[{name:'search',inputSchema:{type:'object'}}],ready:async()=>{},call:async()=>{seen.push(id!);return {content:[],details:{server:id}};}} as unknown as McpConnection));
 const discovery=new McpDiscovery(connections,async()=>{}),signal=new AbortController().signal;
 const a=await discovery.discover('project:one',signal),b=await discovery.discover('user:two',signal);
 await expect(discovery.call('project:one',b.items[0]!.id,a.revision,{},signal,false)).rejects.toThrow('Unknown MCP tool');
 await discovery.call('user:two',b.items[0]!.id,b.revision,{},signal,false);
 await discovery.call('project:one',a.items[0]!.id,a.revision,{},signal,false);
 expect(seen).toEqual(['user:two','project:one']);
});
