import { afterEach, expect, it } from 'vitest';
import { join } from 'node:path';
import { request as httpRequest } from 'node:http';
import { readdir } from 'node:fs/promises';
import { CoreSwitchGate } from '../src/core/switch-gate.js';
import { startWeb } from '../src/server/app.js';
import { Journal, readSession } from '../src/journal.js';
import { temporary, key, response, textItem, delay } from './helpers.js';
const apps: Awaited<ReturnType<typeof startWeb>>[] = [];
afterEach(async()=>{for(const app of apps.splice(0)) await app.close();});
async function setup(fetch?: typeof globalThis.fetch) {
  const workspace=await temporary(),home=await temporary();
  const app=await startWeb({workspace,home,naming:false,apiKey:key,runtime:{fetch:fetch??(async()=>response([textItem()]))}});apps.push(app);
  const headers={authorization:`Bearer ${app.token}`,origin:app.origin,'content-type':'application/json'};
  for(let i=0;i<100;i++){const result=await app.prepareCoreSwitch('initial-ready');if(result.ready){await app.releaseCoreSwitch('initial-ready');break;}await delay(5);}
  return {app,workspace,home,headers,post:(path:string,value:unknown)=>globalThis.fetch(app.origin+'/api/v1'+path,{method:'POST',headers,body:JSON.stringify(value)})};
}
it('closes the async readiness race and deduplicates an in-flight fence without declaring it ready early',async()=>{
  const gate=new CoreSwitchGate();let release!:(value:any)=>void,calls=0;
  const inspect=()=>{calls++;return new Promise<any>(resolve=>release=resolve);};
  const a=gate.prepare('switch-one',inspect),b=gate.prepare('switch-one',inspect);
  await Promise.resolve();expect(calls).toBe(1);
  expect(()=>gate.enter('new task')).toThrow('暂不接受');expect(()=>gate.release('switch-one')).toThrow('等待');
  expect(await gate.prepare('switch-two',inspect)).toMatchObject({ready:false,blockers:[{kind:'switch'}]});
  release({ready:false,blockers:[{kind:'approval'}]});expect(await a).toEqual(await b);
  gate.enter('allowed again')();
});
it('fences actual HTTP and direct session admission until the matching switch releases it',async()=>{
  const f=await setup(),before=(await f.app.sessions.list(0,100)).sessions.length;
  expect(await f.app.prepareCoreSwitch('switch-one')).toMatchObject({ready:true});
  expect((await f.post('/sessions',{version:1,title:'blocked',commandId:'blocked',mode:'work'})).status).toBe(409);
  await expect(f.app.sessions.create('blocked direct',{commandId:'direct',mode:'work'})).rejects.toMatchObject({code:'core_switching'});
  await expect(f.app.releaseCoreSwitch('wrong-owner')).rejects.toThrow('不属于');
  await f.app.releaseCoreSwitch('switch-one');
  expect((await f.app.sessions.list(0,100)).sessions).toHaveLength(before);
  expect((await f.post('/sessions',{version:1,title:'allowed',commandId:'allowed',mode:'work'})).status).toBe(201);
});
it('reports an in-flight body as busy instead of switching across a request that has not dispatched yet',async()=>{
  const f=await setup();
  const request=httpRequest(f.app.origin+'/api/v1/sessions',{method:'POST',headers:f.headers});
  const completed=new Promise<number|undefined>((resolve,reject)=>{request.once('response',res=>{res.resume();res.once('end',()=>resolve(res.statusCode));});request.once('error',reject);});
  request.write('{');
  let busy=false;
  try {
    for(let i=0;i<100;i++){const status=await f.app.coreSwitchStatus();if(status.blockers.some(b=>b.kind==='request')){busy=true;break;}await delay(5);}
    expect(await f.app.prepareCoreSwitch('slow-body')).toMatchObject({ready:false,blockers:expect.arrayContaining([{kind:'request',id:expect.any(String),state:'POST /api/v1/sessions'}])});
    expect(busy).toBe(true);
  } finally {request.end('"version":1,"title":"slow","commandId":"slow","mode":"work"}');}
  expect(await completed).toBe(201);
});
it('reports a real pending model task and allows switching only after its cancellation settles',async()=>{
  let started!:()=>void;const ready=new Promise<void>(resolve=>started=resolve);
  const f=await setup(async(_url,init)=>new Promise<Response>((_resolve,reject)=>{started();init!.signal!.addEventListener('abort',()=>reject(Error('cancelled fixture')),{once:true});}));
  const session=await f.app.sessions.create('work',{commandId:'work-create',mode:'work'});
  const receipt=await(await f.post(`/sessions/${session.id}/submit`,{version:1,commandId:'run-one',prompt:'fixture'})).json();await ready;
  const active=f.app.sessions.activeFor(session.id)!;
  expect(await f.app.prepareCoreSwitch('run-switch')).toMatchObject({ready:false,blockers:expect.arrayContaining([{kind:'run',id:receipt.runId,sessionId:session.id,target:expect.any(String),state:'running'}])});
  await f.post(`/sessions/${session.id}/cancel`,{version:1,runId:receipt.runId});await active.done;
  expect(await f.app.prepareCoreSwitch('run-switch')).toMatchObject({ready:true});await f.app.releaseCoreSwitch('run-switch');
});
it('blocks live approvals and parked workflow waits without loading their factories or creating workflow storage on inspection',async()=>{
  const f=await setup(),before=await readdir(f.workspace);
  expect(await f.app.sessions.customization.workflows.listReadonly()).toEqual([]);expect(await readdir(f.workspace)).toEqual(before);
  const session=await f.app.sessions.create('approval',{commandId:'approval-create',mode:'work'}),journal=await Journal.open(join(f.app.sessions.root,session.id)),controller=new AbortController();
  const pending=f.app.sessions.interactions.ask(journal,'run-approval','fixture',{kind:'form',title:'Approve',fields:[]},controller.signal);
  const rejected=expect(pending).rejects.toThrow('cancelled');
  try {
    for(let i=0;i<100&&!f.app.sessions.interactions.pending().length;i++)await delay(5);
    expect(await f.app.prepareCoreSwitch('approval-switch')).toMatchObject({ready:false,blockers:expect.arrayContaining([{kind:'approval',id:expect.any(String),sessionId:session.id}])});
  } finally {controller.abort();await rejected;await journal.close();}
  const flow=await Journal.open(join(f.workspace,'.nekomimi/workflows/11111111-1111-4111-a111-111111111111'));
  try {
    await flow.append('workflow.created',{id:'11111111-1111-4111-a111-111111111111',resourceId:'fixture',definitionId:'paused',definitionRevision:'fixture',schemaVersion:1,entry:'wait',input:{},snapshot:{definition:{},resources:[]}});
    const outcome=await flow.artifact(JSON.stringify({kind:'wait',step:'wait',input:{},form:{kind:'form',title:'Approve'}}));
    await flow.append('workflow.step.completed',{step:'wait',waitId:'approval',outcome});
  } finally {await flow.close();}
  const history=(await readSession(flow.directory)).events;
  expect(await f.app.sessions.customization.workflows.listReadonly()).toMatchObject([{id:'11111111-1111-4111-a111-111111111111',status:'waiting'}]);
  expect(await f.app.prepareCoreSwitch('workflow-switch')).toMatchObject({ready:false,blockers:expect.arrayContaining([{kind:'workflow',id:'11111111-1111-4111-a111-111111111111',target:expect.any(String),state:'waiting'}])});
  expect((await readSession(flow.directory)).events).toEqual(history);
});
