import {expect,it} from 'vitest';
import {join} from 'node:path';
import {ProviderRegistry,defaultModel,validateProvider,type RegisteredProvider} from '../src/customization/provider-registry.js';
import {ProviderProfiles} from '../src/customization/provider-profiles.js';
import {modelCatalog} from '../src/customization/model-catalog.js';
import {run} from '../src/runtime.js';
import {temporary,key,response,textItem,callItem} from './helpers.js';
import {readSession,readArtifact} from '../src/journal.js';

it('keeps same-id operation entries distinct and isolates catalog snapshots',()=>{
 const models=(['chat','classifier','image'] as const).map(operation=>({...defaultModel,id:'same',operation,...(operation==='chat'?{}:{contextWindow:0,maxOutputTokens:0})}));
 const provider={id:'typed',models,resource:{id:'extension:typed',hash:'v1',status:'enabled'}} as RegisteredProvider;
 const registry=new ProviderRegistry([provider]);models[0]!.name='changed after capture';
 const catalog=registry.catalog().find(p=>p.id==='typed')!;expect(catalog.models).toHaveLength(3);expect(catalog.models[0]!.name).not.toBe('changed after capture');
 catalog.models[0]!.id='mutated';expect(registry.catalog().find(p=>p.id==='typed')!.models[0]!.id).toBe('same');
 expect(()=>validateProvider({id:'typed',models:[models[0]!,models[0]!]})).toThrow('Invalid Provider model');
});
it('reports credentials and unconfigured operations without exposing secrets',async()=>{
 const store=new ProviderProfiles(await temporary());
 const model={...defaultModel,id:'same',operation:'image' as const},resource={id:'extension:typed',hash:'v1',status:'enabled'} as RegisteredProvider['resource'];
 const registry=new ProviderRegistry([{id:'typed',models:[model],resource} as RegisteredProvider]);
 await store.save({id:'picture',providerId:'typed',resourceId:resource.id,model:'same',operation:'image',baseUrl:'https://fixture.invalid',paths:['/images'],credentialRef:'secret'},0);
 const profile=await store.list();
 let catalog=modelCatalog(registry,profile,{},false,[resource]);
 expect(catalog.find(p=>p.id==='typed')!.models[0]).toMatchObject({operation:'image',available:false,credentialStatus:'missing',unavailableReason:'credential-not-configured'});
 catalog=modelCatalog(registry,profile,{secret:'PRIVATE_VALUE'},false,[resource]);
 expect(catalog.find(p=>p.id==='typed')!.models[0]).toMatchObject({configured:true,available:false,unavailableReason:'unsupported-operation-protocol'});
 expect(JSON.stringify(catalog)).not.toContain('PRIVATE_VALUE');
 const anonymous=new ProviderRegistry([{id:'typed',models:[{...model,credentialRequired:false}],resource} as RegisteredProvider]);
 expect(modelCatalog(anonymous,{...profile,entries:{}},{},false,[resource]).find(p=>p.id==='typed')!.models[0]).toMatchObject({credentialStatus:'not-required',available:false,unavailableReason:'profile-not-configured'});
 expect(catalog.find(p=>p.id==='deepseek')!.models[0]).toMatchObject({available:false,credentialStatus:'missing'});
 await expect(store.select('work','picture',1)).rejects.toThrow('operation');
 await store.select('image','picture',1);
 await expect(store.resolve('work','picture')).rejects.toThrow('operation');
 await expect(store.resolve('image')).rejects.toThrow('credential');
});
it('selects create independently and dispatches the selected work and create models',async()=>{
 const home=await temporary(),workspace=await temporary(),development=await temporary(),store=new ProviderProfiles(home);
 await store.saveCredential('key',key);
 for(const [index,id] of ['work','create','naming'].entries())await store.save({id,providerId:'deepseek',resourceId:'builtin:deepseek',model:`${id}-model`,baseUrl:'https://fixture.invalid',paths:['/responses'],credentialRef:'key'},index);
 await store.select('work','work',3);await store.select('naming','naming',4);
 const before=await store.list();await store.select('create','create',before.revision);
 expect((await store.list()).selection).toEqual({work:'work',naming:'naming',create:'create'});
 const bodies:any[]=[];
 for(const mode of ['work','create'] as const){
  const root=mode==='work'?workspace:development;
  const result=await run({workspace:root,ownerWorkspace:workspace,home,session:join(root,'session'),mode,...(mode==='create'?{target:{kind:'extension' as const,root}}:{}),apiKey:'',prompt:'continue',tools:[],fetch:async(_url,init)=>{bodies.push(JSON.parse(String(init?.body)));return response([textItem()]);}});
  expect(result.status,result.error).toBe('completed');
 }
 expect(bodies.map(b=>b.model)).toEqual(['work-model','create-model']);
 expect((await store.resolve('session-title'))!.profile.id).toBe('naming');
});
it('rejects missing credentials and a wrong operation before transport',async()=>{
 const home=await temporary(),workspace=await temporary(),store=new ProviderProfiles(home);let requests=0;
 const options={workspace,home,apiKey:'',prompt:'continue',tools:[],fetch:async()=>{requests++;return response([textItem()]);}};
 const missing=await run({...options,session:join(workspace,'missing')});expect(missing.status).toBe('failed');expect(missing.error).toContain('credential');expect(requests).toBe(0);
 await store.save({id:'picture',providerId:'typed',resourceId:'extension:typed',model:'same',operation:'image',baseUrl:'https://fixture.invalid',paths:['/images']},0);
 await expect(run({...options,session:join(workspace,'wrong'),providerProfile:'picture'})).rejects.toThrow('operation');expect(requests).toBe(0);
});
it('exposes a filtered read-only catalog through the recorded SDK tool path',async()=>{
 const home=await temporary(),workspace=await temporary();let requests=0;
 const result=await run({workspace,home,session:join(workspace,'catalog'),apiKey:key,prompt:'list models',tools:['model_catalog'],fetch:async()=>response(++requests===1?[callItem('model_catalog',{operation:'chat',limit:1})]:[textItem()])});
 expect(result.status,result.error).toBe('completed');expect(requests).toBe(2);
 const observed=await readSession(result.session),completed=observed.events.find(e=>e.type==='tool.completed'&&(e.payload as any).name==='model_catalog')!;
 const value=JSON.parse((await readArtifact(result.session,(completed.payload as any).artifact)).toString());
 expect(value.details.items).toHaveLength(1);expect(value.details.items[0]).toMatchObject({operation:'chat',available:true,credentialStatus:'configured'});
 expect(JSON.stringify(value)).not.toContain(key);
 expect(observed.events.filter(e=>e.type==='request.dispatched')).toHaveLength(2);
});

it('reports credential availability separately for profiles of the same model',async()=>{
 const store=new ProviderProfiles(await temporary()),resource={id:'extension:typed',hash:'v1',status:'enabled'} as RegisteredProvider['resource'];
 const registry=new ProviderRegistry([{id:'typed',models:[{...defaultModel,id:'shared'}],resource} as RegisteredProvider]);
 for(const [revision,id] of ['ready','missing'].entries()) await store.save({id,providerId:'typed',resourceId:resource.id,model:'shared',baseUrl:'https://fixture.invalid',paths:['/responses'],credentialRef:id},revision);
 const catalog=modelCatalog(registry,await store.list(),{ready:'NEVER_EXPOSE'},false,[resource]);
 expect(catalog.find(provider=>provider.id==='typed')!.models[0]!.profileStates).toEqual([
  {id:'ready',available:true,credentialStatus:'configured'},
  {id:'missing',available:false,credentialStatus:'missing',unavailableReason:'credential-not-configured'}
 ]);
 expect(JSON.stringify(catalog)).not.toContain('NEVER_EXPOSE');
});
