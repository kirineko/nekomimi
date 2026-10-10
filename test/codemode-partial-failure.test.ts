import { mcpToolName } from "../src/customization/mcp-discovery.js";
import {expect,it} from 'vitest';
import {createServer} from 'node:http';
import {mkdir,writeFile,readFile,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {CustomizationHost} from '../src/customization/host.js';
import {ProviderProfiles} from '../src/customization/provider-profiles.js';
import {readSession,readArtifact,hash} from '../src/journal.js';
import {readScriptState} from '../src/codemode-state.js';
import {run} from '../src/runtime.js';
import {temporary,key,response,callItem,textItem} from './helpers.js';

it('keeps write success, classifier failure and cancelled remote unknown independent across restart',async()=>{
 const workspace=await temporary(),home=await temporary(),session=join(workspace,'session'),controller=new AbortController();
 const root=join(workspace,'.nekomimi/extensions/classifier');await mkdir(root,{recursive:true});
 await writeFile(join(root,'extension.json'),JSON.stringify({name:'classifier',sdkVersion:3,entry:'index.ts',requiredCapabilities:['providers']}));
 await writeFile(join(root,'index.ts'),`export default (api:import('nekomimi/extensions').ExtensionAPI)=>api.registerProvider({id:'classifier',models:[{id:'fixture',name:'fixture',operation:'classifier',credentialRequired:true,protocol:'typesafe-system-one',historyCompatibility:'fixture',contextWindow:8192,maxOutputTokens:0,capabilities:{tools:false,images:false,reasoning:false}}],serialize(){throw Error('not chat')},parse(){throw Error('not chat')}});`);
 let remoteEffects=0,classifications=0,mainCalls=0;
 const server=createServer(async(req,res)=>{
  if(req.method!=='POST'){res.writeHead(405).end();return;}
  let raw='';for await(const part of req)raw+=part;const message=JSON.parse(raw);
  if(message.method==='tools/call'){remoteEffects++;controller.abort(new Error('cancel after remote effect'));return;}
  if(message.id===undefined){res.writeHead(202).end();return;}
  const result=message.method==='initialize'?{protocolVersion:'2025-11-25',capabilities:{tools:{}},serverInfo:{name:'fixture',version:'1'}}:message.method==='tools/list'?{tools:[{name:'job',description:'long remote job',inputSchema:{type:'object',properties:{}}}]}:{};
  res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({jsonrpc:'2.0',id:message.id,result}));
 });
 await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 await writeFile(join(workspace,'.nekomimi/mcp.json'),JSON.stringify({version:1,servers:{fixture:{transport:'http',url:`http://127.0.0.1:${(server.address() as any).port}/mcp`}}}));
 const host=new CustomizationHost(workspace,home);let reopened:CustomizationHost|undefined;
 try{
  const resources=await host.catalog.discover();let revision=0;
  for(const resource of resources.filter(r=>['extension','mcp'].includes(r.kind)))revision=await host.catalog.decide(resource.id,true,true,revision);
  const provider=resources.find(r=>r.kind==='extension')!,profiles=new ProviderProfiles(home);
  await profiles.saveCredential('classifier-key','classifier-secret');await profiles.save({id:'classifier',operation:'classifier',providerId:'classifier',resourceId:provider.id,model:'fixture',baseUrl:'https://classifier.invalid/v1',paths:['/systemone'],credentialRef:'classifier-key'},0);await profiles.select('classifier','classifier',1);
  const remoteName=mcpToolName(resources.find(r=>r.kind==='mcp')!,'job');
  const script=`store('uncommitted',99); await tools.write({path:'success.txt',content:'written once'}); const failed=await tools.model_classify({state:{text:'input'},questions:{ready:{type:'bool',instructions:'ready?',criteria:{true:'yes',false:'no'}}}}); if(!failed.isError)throw Error('classification unexpectedly succeeded'); await tools.${remoteName}({});`;
  const result=await run({workspace,home,session,customization:host,signal:controller.signal,apiKey:key,prompt:'partial failure',tools:['codemode','write','model_classify',remoteName],fetch:async url=>{
   if(String(url).includes('classifier.invalid')){classifications++;return Response.json({answers:{},usage:{input_tokens:4,output_tokens:1}});}
   mainCalls++;return response([callItem('codemode',{code:script})]);
  }});
  expect(result.status,result.error).toBe('cancelled');expect({mainCalls,classifications,remoteEffects}).toEqual({mainCalls:1,classifications:1,remoteEffects:1});
  expect(await readFile(join(workspace,'success.txt'),'utf8')).toBe('written once');const fileBefore=await stat(join(workspace,'success.txt'));
  const saved=await readSession(session),events=saved.events;
  expect(events.filter(e=>e.type==='tool.completed'&&(e.payload as any).name==='write')).toHaveLength(1);
  const failed=events.find(e=>e.type==='attempt.finished'&&(e.payload as any).operation==='classifier')!;expect(failed.payload).toMatchObject({outcome:'failed',usage:{input:4,output:1,cost:null}});
  const remoteIntent=events.find(e=>e.type==='tool.intent'&&(e.payload as any).name===remoteName)!;expect(remoteIntent).toBeDefined();
  expect(events.some(e=>e.type==='tool.execution_error'&&e.toolCallId===remoteIntent.toolCallId&&(e.payload as any).unknown)).toBe(true);
  expect(events.find(e=>e.type==='tool.completed'&&(e.payload as any).name==='write')!.seq).toBeLessThan(failed.seq);
  expect(failed.seq).toBeLessThan(remoteIntent.seq);
  expect(events.find(e=>e.type==='codemode.finished')?.payload).toMatchObject({status:'cancelled'});
  expect(remoteIntent.parentToolCallId).toBe(events.find(e=>e.type==='tool.intent'&&(e.payload as any).name==='write')?.parentToolCallId);
  expect((await readScriptState(result.session,events)).state).toEqual({});
  const raw=events.find(e=>e.type==='model.operation.result')!;expect(JSON.parse((await readArtifact(result.session,(raw.payload as any).result)).toString()).stopReason).toBe('error');
  await host.close();reopened=new CustomizationHost(workspace,home);
  await reopened.acquire();await reopened.release();await readSession(session);
  expect({classifications,remoteEffects}).toEqual({classifications:1,remoteEffects:1});
  const resumed=await run({workspace,home,session,customization:reopened,apiKey:key,prompt:'inspect saved facts only',tools:[],fetch:async()=>{mainCalls++;return response([textItem('Partial effects remain recorded.')]);}});
  expect(resumed.status,resumed.error).toBe('completed');expect({classifications,remoteEffects}).toEqual({classifications:1,remoteEffects:1});
  expect((await stat(join(workspace,'success.txt'))).mtimeMs).toBe(fileBefore.mtimeMs);
  const final=await readSession(session);expect(final.events.filter(e=>e.type==='tool.intent'&&(e.payload as any).name===remoteName)).toHaveLength(1);expect((await readScriptState(result.session,final.events)).state).toEqual({});
 }finally{controller.abort();await host.close();await reopened?.close();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
},30000);
