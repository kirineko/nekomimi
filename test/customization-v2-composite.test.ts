import {it,expect} from 'vitest';
import {mkdir,writeFile,readFile,realpath} from 'node:fs/promises';
import {join} from 'node:path';
import {createServer} from 'node:http';
import {temporary,key,response,callItem,textItem} from './helpers.js';
import {reviewPackageFiles} from './fixtures/review-package.js';
import {oauthFixture} from './fixtures/oauth-server.js';
import {CustomizationHost} from '../src/customization/host.js';
import {Packages} from '../src/customization/packages.js';
import {ProviderProfiles} from '../src/customization/provider-profiles.js';
import {run} from '../src/runtime.js';
import {readSession,readArtifact,id} from '../src/journal.js';
it('generates, repairs and uses a complete review package through recorded tools, OAuth, custom models and durable panel answers',async()=>{
 const workspace=await realpath(await temporary()),home=await temporary(),oauth=await oauthFixture(true),source=join(workspace,'review-kit');
 const files=await reviewPackageFiles(oauth.resource.config!);await mkdir(join(workspace,'src'));await writeFile(join(workspace,'src/change.diff'),'diff --git a/src/a.ts b/src/a.ts\n-const x = 1;\n+const x = 2;\n');
 const requests:any[]=[];const model=createServer(async(req,res)=>{let raw='';for await(const chunk of req)raw+=chunk;requests.push(JSON.parse(raw));res.setHeader('content-type','application/json');res.end(JSON.stringify({choices:[{message:{role:'assistant',content:'Observed synthetic diff: x changes from 1 to 2.'},finish_reason:'stop'}]}));});
 await new Promise<void>(r=>model.listen(0,'127.0.0.1',r));
 let host=new CustomizationHost(workspace,home);const store=new Packages(workspace,home);let phase=0,brokenId='',fixedId='';
 try{
  const generated=await run({workspace,home,customization:host,session:join(workspace,'generation'),apiKey:key,prompt:'Build and validate a complete /review capability package using the installed SDK.',maxTurns:16,fetch:async()=>{
   switch(phase++){
    case 0:return response([callItem('customization_sdk',{entry:'contracts'},'sdk')]);
    case 1:return response(Object.entries(files).map(([path,content],i)=>callItem('write',{path:'review-kit/'+path,content:path==='index.ts'?'export default !!!':content},'file-'+i)));
    case 2:return response([callItem('customization_package',{action:'prepare',source:{kind:'local',path:source},bindings:{'review-rules':'src'}},'prepare-broken')]);
    case 3:brokenId=(await store.drafts())[0]!.id;return response([callItem('customization_package',{action:'inspect',id:brokenId},'check-broken')]);
    case 4:return response([callItem('write',{path:'review-kit/index.ts',content:files['index.ts']},'repair')]);
    case 5:return response([callItem('customization_package',{action:'prepare',source:{kind:'local',path:source},bindings:{'review-rules':'src'}},'prepare-fixed')]);
    case 6:fixedId=(await store.drafts()).find(c=>c.id!==brokenId)!.id;return response([callItem('customization_package',{action:'inspect',id:fixedId},'check-fixed')]);
    default:return response([textItem('Review kit ready for explicit authorization')]);
   }
  }});
  expect(generated.status,generated.error).toBe('completed');expect(fixedId,JSON.stringify((await readSession(generated.session)).events.filter(e=>e.type==='tool.execution_error').map(e=>e.payload))).not.toBe('');expect((await store.preview('project',brokenId)).passed).toBe(false);expect((await store.preview('project',fixedId)).passed).toBe(true);
  const candidate=await store.candidate('project',fixedId),resources=await store.resources(candidate),mcp=resources.find(r=>r.kind==='mcp')!,provider=resources.find(r=>r.kind==='provider')!;
  const started=await host.oauth.begin(mcp);expect((await fetch(started.authorizationUrl)).status).toBe(200);
  const receipt=await host.requestPackage(fixedId,'project',true);await host.reload(receipt);expect(receipt.status,receipt.error).toBe('activated');
  const profiles=new ProviderProfiles(home);await profiles.save({id:'review-model',providerId:'example-chat',resourceId:provider.id,model:'fixture-model',baseUrl:`http://127.0.0.1:${(model.address() as any).port}`,paths:['/chat/completions']},0);await profiles.select('auxiliary','review-model',1);
  const used=await run({workspace,home,customization:host,session:join(workspace,'review-command'),apiKey:key,prompt:'/review {"diffFile":"src/change.diff"}'});expect(used.status,used.error).toBe('completed');
  let [flow]=await host.workflows.list();expect(flow?.status,flow?.error).toBe('waiting');expect(requests.length).toBeGreaterThan(0);
  const assessment=requests.at(-1);expect(assessment.messages[0].content).toContain('SKILL_REVIEW');expect(assessment.messages[0].content).toContain('RULE_REVIEW');expect(assessment.messages[0].content).not.toContain('MCP_PROMPT');expect(JSON.stringify(assessment.messages)).toContain('MCP_CONTEXT');expect(JSON.stringify(assessment.messages)).toContain('MCP_PROMPT');expect(JSON.stringify(assessment.messages)).toContain(mcp.id);
  const journalPath=join(workspace,'.nekomimi/workflows',flow!.id),events=(await readSession(journalPath)).events;
  expect(events.some(e=>e.type==='skill.loaded')).toBe(true);expect(events.some(e=>e.type==='rule.loaded')).toBe(true);expect(events.some(e=>e.type==='extension.ui'&&(e.payload as any).kind==='panel')).toBe(true);expect(events.some(e=>e.type==='request.dispatched')).toBe(true);
  const updatedManifest=JSON.parse(files['nekomimi.json']);updatedManifest.version='2.0.0';await writeFile(join(source,'nekomimi.json'),JSON.stringify(updatedManifest));await writeFile(join(source,'index.ts'),files['index.ts'].replace('schemaVersion:1','schemaVersion:2'));
  const upgrade=await store.prepare({kind:'local',path:source},'project',{'review-rules':'src'}),updated=await host.requestPackage(upgrade.id,'project',false);await host.reload(updated);expect(updated.status,updated.error).toBe('activated');expect((await host.workflows.inspect(flow!.id)).definitionRevision).toBe(candidate.revision);
  const previous=await store.previous(candidate.packageId),rollback=await host.requestPackage(previous.id,'project',false);await host.reload(rollback);expect(rollback.status,rollback.error).toBe('activated');expect((await store.list())[0]!.revision).toBe(candidate.revision);
  await writeFile(join(source,'review-panel.ts'),"import {readFileSync} from 'node:fs';void readFileSync;\n"+files['review-panel.ts']);
  const failedBuild=await store.prepare({kind:'local',path:source},'project',{'review-rules':'src'});expect((await store.preview('project',failedBuild.id)).passed).toBe(true);
  const failedReceipt=await host.requestPackage(failedBuild.id,'project',false);await host.reload(failedReceipt);expect(failedReceipt.status).toBe('failed');expect(failedReceipt.error).toContain('external imports');expect((await store.list())[0]!.revision).toBe(candidate.revision);
  await host.close();host=new CustomizationHost(workspace,home);await host.acquire();await host.release();flow=await host.workflows.inspect(flow!.id);
  const panel=host.panels.catalog().find(p=>p.id==='review')!;const mounted=await host.panels.mount(panel.resourceId,panel.id,panel.revision,{items:['Observed review']},flow.id);
  const accepted=await host.panels.action(mounted.instanceId,1,'workflow.answer',{decision:'approve'});expect(accepted.status).toBe('ready');
  const ready=await host.workflows.inspect(flow.id);expect((await host.workflows.advance(flow.id,{expectedRevision:ready.revision})).status).toBe('completed');expect(await readFile(join(workspace,'review-result.json'),'utf8')).toContain('approve');
  const exported=await store.export(candidate.packageId,'review-kit.tgz');const second=await temporary(),secondHome=await temporary(),receiver=new Packages(second,secondHome);const imported=await receiver.prepare({kind:'local',path:exported.path},'project',{'review-rules':'different-src'});
  expect(imported.grants).toEqual([]);expect(imported.ruleBindings['review-rules']?.root).toBe('different-src');expect(imported.files).toEqual(candidate.files);
  const received=new CustomizationHost(second,secondHome);
  try {
    const parts=await receiver.resources(imported),remote=parts.find(r=>r.kind==='mcp')!,adapter=parts.find(r=>r.kind==='provider')!;
    const authorization=await received.oauth.begin(remote);expect((await fetch(authorization.authorizationUrl)).status).toBe(200);
    const install=await received.requestPackage(imported.id,'project',true);await received.reload(install);expect(install.status,install.error).toBe('activated');
    const choices=new ProviderProfiles(secondHome);await choices.save({id:'review-model',providerId:'example-chat',resourceId:adapter.id,model:'fixture-model',baseUrl:`http://127.0.0.1:${(model.address() as any).port}`,paths:['/chat/completions']},0);await choices.select('auxiliary','review-model',1);
    await mkdir(join(second,'different-src'));await writeFile(join(second,'different-src/change.diff'),'diff --git a/a.ts b/a.ts\n-old\n+new\n');
    const review=await run({workspace:second,home:secondHome,customization:received,session:join(second,'review'),apiKey:key,prompt:'/review {"diffFile":"different-src/change.diff"}'});expect(review.status,review.error).toBe('completed');
    const waiting=(await received.workflows.list())[0]!;expect(waiting.status,waiting.error).toBe('waiting');const answered=await received.workflows.answer(waiting.id,waiting.wait!.id,id(),{decision:'approve'},waiting.revision);expect((await received.workflows.advance(answered.id)).status).toBe('completed');expect(await readFile(join(second,'review-result.json'),'utf8')).toContain('approve');
  } finally {await received.close();}
  await store.collect('project',[brokenId,candidate.id]);expect((await store.resources(candidate)).length).toBe(5);
  const pendingRun=await run({workspace,home,customization:host,session:join(workspace,'pending-review'),apiKey:key,prompt:'/review {"diffFile":"src/change.diff"}'});expect(pendingRun.status,pendingRun.error).toBe('completed');const pending=(await host.workflows.list()).find(w=>w.status==='waiting')!;expect(pending).toBeDefined();
  const removal=await host.removePackage(candidate.packageId);await host.reload(removal);expect(removal.status).toBe('activated');expect(host.panels.catalog()).toEqual([]);
  const blocked=await host.workflows.answer(pending.id,pending.wait!.id,id(),{decision:'approve'},pending.revision);await expect(host.workflows.advance(blocked.id)).rejects.toThrow();await store.collect('project',[candidate.id]);expect((await store.resources(candidate)).length).toBe(5);const blockedState=await host.workflows.inspect(pending.id);expect((await host.workflows.cancel(pending.id,blockedState.revision)).status).toBe('cancelled');
  expect((await host.workflows.inspect(flow.id)).status).toBe('completed');const ui=events.find(e=>e.type==='extension.ui')!.payload as any;expect((await readArtifact(journalPath,ui.propsArtifact)).toString()).toContain('Observed synthetic diff');
  const generation=(await readSession(generated.session)).events;expect(generation.filter(e=>e.type==='tool.completed'&&(e.payload as any).name==='customization_package')).toHaveLength(4);
 }finally{await host.close();await oauth.close();model.closeAllConnections();await new Promise<void>(r=>model.close(()=>r()));}
},90000);
