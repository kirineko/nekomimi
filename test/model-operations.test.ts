import {expect,it} from 'vitest';
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {CustomizationHost} from '../src/customization/host.js';
import {ProviderProfiles} from '../src/customization/provider-profiles.js';
import {readSession,readArtifact} from '../src/journal.js';
import {run} from '../src/runtime.js';
import {temporary,key,response,callItem,textItem} from './helpers.js';
const context={state:{text:'ready'},questions:{ready:{type:'bool',instructions:'ready?',criteria:{true:'ready',false:'not ready'}}}};
const png='iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAF0lEQVR4nGP4z8BAEiJN9aiGUQ1DSgMAkPn/Afnh+ngAAAAASUVORK5CYII=';
async function fixture(){
 const workspace=await temporary(),home=await temporary(),root=join(workspace,'.nekomimi/extensions/typed');await mkdir(root,{recursive:true});
 await writeFile(join(root,'extension.json'),JSON.stringify({name:'typed',sdkVersion:3,entry:'index.ts',requiredCapabilities:['providers']}));
 await writeFile(join(root,'index.ts'),`import type { ExtensionFactory3 } from 'nekomimi/extensions'; const extension: ExtensionFactory3 = api=>api.registerProvider({id:'typed',models:(['classifier','image'] as const).map(operation=>({id:'same',name:operation,operation,credentialRequired:true,protocol:operation==='classifier'?'typesafe-system-one':'openrouter-images',historyCompatibility:'typed-v1',contextWindow:8192,maxOutputTokens:0,capabilities:{tools:false,images:true,reasoning:false}})),serialize(){throw new Error('chat serializer must not run')},parse(){throw new Error('chat parser must not run')}}); export default extension;`);
 const host=new CustomizationHost(workspace,home),resource=(await host.catalog.discover()).find(r=>r.kind==='extension')!;await host.catalog.decide(resource.id,true,true,0);
 const profiles=new ProviderProfiles(home);await profiles.saveCredential('typed-key','typed-secret');
 for(const [i,operation] of (['classifier','image'] as const).entries())await profiles.save({id:operation,providerId:'typed',resourceId:resource.id,model:'same',operation,baseUrl:'https://typed.invalid/v1',paths:[operation==='classifier'?'/systemone':'/chat/completions'],credentialRef:'typed-key'},i);
 await profiles.select('classifier','classifier',2);await profiles.select('image','image',3);
 return {workspace,home,host,resource,profiles};
}
for(const script of [false,true])it(`calls the configured classifier through ${script?'Codemode':'a native tool'} with one child charge`,async()=>{
 const f=await fixture();let main=0,child=0;
 try{
  const result=await run({...f,customization:f.host,session:join(f.workspace,'session'),apiKey:key,prompt:'classify',tools:['codemode','model_classify'],fetch:async(url,init)=>{
   if(String(url).includes('typed.invalid')){child++;expect(new Headers(init?.headers).get('authorization')).toBe('Bearer typed-secret');return Response.json({answers:{ready:{type:'noul',noul:0.9}},usage:{input_tokens:3,output_tokens:1}});}
   return response(++main===1?[callItem(script?'codemode':'model_classify',script?{code:`const value = await tools.model_classify(${JSON.stringify(context)}); text(value);`}:context)]:[textItem()]);
  }});
  expect(result.status,result.error).toBe('completed');expect(child).toBe(1);expect(main).toBe(2);
  const saved=await readSession(result.session),finished=saved.events.filter(e=>e.type==='attempt.finished'&&(e.payload as any).operation==='classifier');expect(finished).toHaveLength(1);expect(finished[0]?.parentToolCallId).toBeTruthy();
  expect(finished[0]?.payload).toMatchObject({usage:{input:3,output:1,cost:null}});
  for(const event of saved.events.filter(e=>e.type==='tool.completed')){const value=JSON.parse((await readArtifact(result.session,(event.payload as any).artifact)).toString());expect(value.usage).toBeUndefined();}
  expect(JSON.stringify(saved.events)).not.toContain('typed-secret');
 }finally{await f.host.close();}
});
it('returns image content and persistent attachment references through the tool',async()=>{
 const f=await fixture();let main=0;
 try{
  const result=await run({...f,customization:f.host,session:join(f.workspace,'session'),apiKey:key,prompt:'draw',tools:['model_image'],fetch:async url=>String(url).includes('typed.invalid')?Response.json({choices:[{message:{content:'image',images:[{image_url:{url:`data:image/png;base64,${png}`}}]}}]}):response(++main===1?[callItem('model_image',{input:[{type:'text',text:'draw'}]})]:[textItem()])});
  expect(result.status,result.error).toBe('completed');
  const saved=await readSession(result.session),event=saved.events.find(e=>e.type==='tool.completed'&&(e.payload as any).name==='model_image')!;
  const value=JSON.parse((await readArtifact(result.session,(event.payload as any).artifact)).toString());expect(value.content).toContainEqual({type:'image',data:png,mimeType:'image/png'});
  expect((await readArtifact(result.session,value.details.attachments[0].artifact)).toString('base64')).toBe(png);
 }finally{await f.host.close();}
});
it('rechecks credentials before dispatch without falling back to the main model',async()=>{
 const f=await fixture();let main=0,child=0,revoked=false;
 try{
  const result=await run({...f,customization:f.host,session:join(f.workspace,'session'),apiKey:key,prompt:'classify',tools:['model_classify'],beforeDispatch:async()=>{if(main===1&&!revoked){revoked=true;await f.profiles.saveCredential('typed-key',null);}},fetch:async url=>{
   if(String(url).includes('typed.invalid')){child++;return Response.json({});}
   return response(++main===1?[callItem('model_classify',context)]:[textItem()]);
  }});
  expect(result.status,result.error).toBe('completed');expect(revoked).toBe(true);expect(child).toBe(0);
  const saved=await readSession(result.session);expect(saved.events.some(e=>e.type==='request.blocked')).toBe(true);expect(saved.events.some(e=>e.type==='tool.failed')).toBe(true);
 }finally{await f.host.close();}
});
it('stops an image tool after a late cancellation without another main request',async()=>{
 const f=await fixture(),controller=new AbortController();let main=0,cancelled=false;const session=join(f.workspace,'session');
 try{
  const result=await run({...f,customization:f.host,session,signal:controller.signal,apiKey:key,prompt:'draw',tools:['model_image'],journalOptions:{beforeIO:async operation=>{
   if(cancelled||operation!=='sync')return;
   const {readFile}=await import('node:fs/promises');const rows=(await readFile(join(session,'journal.jsonl'),'utf8').catch(()=>'')).trim().split('\n');
   if(rows.at(-1)&&JSON.parse(rows.at(-1)!).type==='model.operation.result'){cancelled=true;controller.abort();}
  }},fetch:async url=>String(url).includes('typed.invalid')?Response.json({choices:[{message:{content:'late',images:[{image_url:{url:`data:image/png;base64,${png}`}}]}}]}):response(++main===1?[callItem('model_image',{input:[{type:'text',text:'draw'}]})]:[textItem()])});
  expect(result.status).toBe('cancelled');expect(cancelled).toBe(true);expect(main).toBe(1);
  const saved=await readSession(session),operation=saved.events.find(e=>e.type==='model.operation.result')!;
  expect((operation.payload as any).attachments).toHaveLength(1);
  expect(saved.events.filter(e=>e.type==='attempt.finished'&&(e.payload as any).operation==='image')).toHaveLength(1);
 }finally{await f.host.close();}
});
it('rejects a revoked provider grant at the model dispatch boundary',async()=>{
 const f=await fixture();let main=0,child=0,revoked=false;
 try{
  await run({...f,customization:f.host,session:join(f.workspace,'session'),apiKey:key,prompt:'classify',tools:['model_classify'],beforeDispatch:async()=>{if(main===1&&!revoked){revoked=true;const catalog=await f.host.catalog.decisions();await f.host.catalog.decide(f.resource.id,false,false,catalog.revision);}},fetch:async url=>{
   if(String(url).includes('typed.invalid')){child++;return Response.json({});}
   return response(++main===1?[callItem('model_classify',context)]:[textItem()]);
  }});
  expect(revoked).toBe(true);expect(child).toBe(0);
  expect((await readSession(join(f.workspace,'session'))).events.some(e=>e.type==='request.blocked')).toBe(true);
 }finally{await f.host.close();}
});
it('enforces the selected classifier context budget before any auxiliary dispatch',async()=>{
 const f=await fixture();let main=0,child=0;
 try{
  const result=await run({...f,customization:f.host,session:join(f.workspace,'session'),apiKey:key,prompt:'classify',tools:['model_classify'],fetch:async url=>{
   if(String(url).includes('typed.invalid')){child++;return Response.json({});}
   return response(++main===1?[callItem('model_classify',{...context,state:{text:'x'.repeat(30000)}})]:[textItem()]);
  }});
  expect(result.status,result.error).toBe('completed');expect(child).toBe(0);
  const events=(await readSession(result.session)).events;expect(events.some(e=>e.type==='model.operation.budget'&&(e.payload as any).inputEstimate>8192)).toBe(true);
  expect(events.some(e=>e.type==='tool.failed'&&JSON.stringify(e.payload).includes('context budget'))).toBe(true);
 }finally{await f.host.close();}
});
