import { afterEach, expect, it, vi } from 'vitest';
import { join } from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { startWeb } from '../src/server/app.js';
import { CustomizationHost } from '../src/customization/host.js';
import { ProviderProfiles } from '../src/customization/provider-profiles.js';
import { Candidates } from '../src/customization/candidates.js';
import { Journal, hash, readSession } from '../src/journal.js';
import { sessionBinding } from '../src/session/identity.js';
import { temporary } from './helpers.js';

const apps:Awaited<ReturnType<typeof startWeb>>[]=[];
afterEach(async()=>{vi.restoreAllMocks();for(const app of apps.splice(0))await app.close();});
async function fixture() {
  const workspace=await temporary(),development=await temporary(),home=await temporary();
  let calls=0;
  const app=await startWeb({workspace,home,naming:false,apiKey:'fixture',runtime:{fetch:async()=>{calls++;throw Error('Unexpected model request');}}});apps.push(app);
  const work=await app.sessions.create('原工作',{commandId:'work',mode:'work'});
  const create=await app.sessions.create('创造来源',{commandId:'create',mode:'create',target:{kind:'extension',root:development}});
  const store=new Candidates(development),binding=sessionBinding((await app.sessions.entry(create.id)).reader.events)!;
  const candidate=await store.scaffold('review','command',{session:binding,runId:'development-run'});
  const marker=join(workspace,'factory-effects');
  await writeFile(join(candidate.path,'index.ts'),`import {appendFileSync} from 'node:fs';appendFileSync(${JSON.stringify(marker)},'factory\\n');export default (api:import('nekomimi/extensions').ExtensionAPI)=>{api.registerCommand('review',{description:'Review',async handler(){return 'review-v1'}})};`);
  const inspected=await store.inspect(candidate.id);expect(inspected.candidate.report.passed).toBe(true);
  const request=async(value:Record<string,unknown>)=>{
    const response=await fetch(app.origin+'/api/v1/customization',{method:'POST',headers:{authorization:'Bearer '+app.token,origin:app.origin,'content-type':'application/json'},body:JSON.stringify(value)});
    return {status:response.status,data:await response.json()};
  };
  const selection={resourceId:inspected.resource.id,candidateId:candidate.id,revision:inspected.resource.hash,type:'commands',usage:'授权并安装此版本后使用 /review'};
  const draft={version:1 as const,goal:'交付项目审查命令',target:{sessionId:work.id},delivery:[selection]};
  const preview=await app.sessions.handoffPreview(create.id,draft);
  const receipt=await app.sessions.confirmHandoff(create.id,{version:1,confirmed:true,commandId:'handoff',payloadHash:preview.payloadHash,draft});
  const input={sessionId:create.id,targetSessionId:work.id,handoffId:receipt.handoffId,id:candidate.id,contentHash:inspected.resource.hash};
  return {app,workspace,development,home,work,create,store,candidate,marker,input,request,calls:()=>calls};
}

it('requires the committed project delivery and explicit reviewed authorization; duplicate application never reloads a factory',async()=>{
  const f=await fixture();
  const sourceBefore=await readFile(join(f.candidate.path,'index.ts'));
  const noHandoff=await f.request({...f.input,action:'candidate-delivery-preview',handoffId:hash('missing')});expect(noHandoff.status).toBe(409);
  const preview=await f.request({...f.input,action:'candidate-delivery-preview'});expect(preview.status).toBe(200);
  expect(preview.data.appliesTo).toBe(f.app.sessions.workspace);expect(preview.data.requiredCapabilities).toEqual(['commands']);
  expect(await new Candidates(f.workspace).active()).toEqual([]);await expect(readFile(f.marker)).rejects.toMatchObject({code:'ENOENT'});
  const apply={...f.input,action:'candidate-delivery-apply',planHash:preview.data.planHash,commandId:'install-review',authorize:true};
  expect((await f.request({...apply,authorize:false})).status).toBe(400);
  expect((await f.request({...apply,sessionId:f.work.id})).status).toBe(403);
  const result=await f.request(apply);expect(result.status,JSON.stringify(result.data)).toBe(200);expect(result.data.status,result.data.error).toBe('activated');
  expect(await readFile(f.marker,'utf8')).toBe('factory\n');
  expect((await f.app.sessions.commandCatalog(f.work.id)).commands.some(command=>command.name==='/review')).toBe(true);
  await f.app.sessions.submit(f.work.id,{version:1,commandId:'use-review',prompt:'/review'});await f.app.sessions.activeFor(f.work.id)?.done;
  expect((await readSession(join(f.app.sessions.root,f.work.id))).events.findLast(e=>e.type==='run.finished')?.payload).toMatchObject({status:'completed'});
  const deliveries=await f.app.sessions.deliveries(f.work.id);expect(deliveries.items[0]?.current[0]?.work?.phase).toBe('available');
  const effects=await readFile(f.marker);expect((await f.request(apply)).data).toEqual(result.data);expect(await readFile(f.marker)).toEqual(effects);
  expect((await f.request({...apply,planHash:hash('different')})).status).toBe(409);
  expect(await readFile(join(f.candidate.path,'index.ts'))).toEqual(sourceBefore);expect(f.calls()).toBe(0);
});

it('rejects changed review plans and source versions without changing the work selection',async()=>{
  const f=await fixture(),preview=await f.request({...f.input,action:'candidate-delivery-preview'});
  await f.app.sessions.customization.catalog.allowUserWrites(true,0);
  const apply={...f.input,action:'candidate-delivery-apply',planHash:preview.data.planHash,commandId:'stale-install',authorize:true};
  expect((await f.request(apply)).status).toBe(409);
  expect(await new Candidates(f.workspace).active()).toEqual([]);await expect(readFile(f.marker)).rejects.toMatchObject({code:'ENOENT'});
  await writeFile(join(f.candidate.path,'index.ts'),'export default ()=>{};');
  expect((await f.request({...f.input,action:'candidate-delivery-preview'})).status).toBe(409);
  expect(await new Candidates(f.workspace).active()).toEqual([]);
});

it('returns unknown for a durable intent without a terminal record before looking up or executing source code',async()=>{
  const f=await fixture(),preview=await f.request({...f.input,action:'candidate-delivery-preview'});
  const request={sourceSessionId:f.create.id,targetSessionId:f.work.id,handoffId:f.input.handoffId,candidateId:f.candidate.id,contentHash:f.input.contentHash,planHash:preview.data.planHash,commandId:'interrupted-install'};
  const directory=join(f.app.sessions.root,'..','candidate-deliveries');
  const journal=await Journal.open(directory);
  await journal.append('candidate.delivery.session',{formatVersion:2});
  await journal.append('candidate.delivery.intent',{commandId:request.commandId,requestHash:hash(JSON.stringify(request))});await journal.close();
  await writeFile(join(f.candidate.path,'index.ts'),'export default ()=>{throw Error("changed after interruption")};');
  const result=await f.request({...f.input,action:'candidate-delivery-apply',planHash:request.planHash,commandId:request.commandId,authorize:true});
  expect(result.status,JSON.stringify(result.data)).toBe(200);expect(result.data.status).toBe('unknown');
  await expect(readFile(f.marker)).rejects.toMatchObject({code:'ENOENT'});expect(await new Candidates(f.workspace).active()).toEqual([]);expect(f.calls()).toBe(0);
});


it.each([1, 99])('rejects delivery journal format %s before writes or factory execution',async(formatVersion)=>{
  const f=await fixture(),preview=await f.request({...f.input,action:'candidate-delivery-preview'});
  const directory=join(f.app.sessions.root,'..','candidate-deliveries');
  const journal=await Journal.open(directory);
  await journal.append('candidate.delivery.session',{formatVersion});await journal.close();
  const path=join(directory,'journal.jsonl'),before=await readFile(path);
  const result=await f.request({...f.input,action:'candidate-delivery-apply',planHash:preview.data.planHash,commandId:'old-format',authorize:true});
  expect(result.status).toBe(422);expect(await readFile(path)).toEqual(before);
  await expect(readFile(f.marker)).rejects.toMatchObject({code:'ENOENT'});expect(f.calls()).toBe(0);
});

it('redacts configured credentials from failed installation responses and durable receipts',async()=>{
  const f=await fixture(),secret='provider-private-delivery-key-91842';
  await new ProviderProfiles(f.home).saveCredential('delivery-test',secret);
  const preview=await f.request({...f.input,action:'candidate-delivery-preview'});
  vi.spyOn(CustomizationHost.prototype,'requestProjectDelivery').mockRejectedValueOnce(new Error('installation failure fixture '+secret));
  const input={...f.input,action:'candidate-delivery-apply',planHash:preview.data.planHash,commandId:'private-error',authorize:true};
  const result=await f.request(input);expect(result.status).toBe(200);expect(result.data.status).toBe('failed');
  expect(result.data.error).toContain('[REDACTED]');expect(JSON.stringify(result.data)).not.toContain(secret);expect(result.data.error).not.toContain('fixture');
  const journal=await readFile(join(f.app.sessions.root,'..','candidate-deliveries','journal.jsonl'),'utf8');
  expect(journal).not.toContain(secret);expect(journal).not.toContain('failure fixture');
  expect((await f.request(input)).data).toEqual(result.data);
  await expect(readFile(f.marker)).rejects.toMatchObject({code:'ENOENT'});expect(f.calls()).toBe(0);
});
