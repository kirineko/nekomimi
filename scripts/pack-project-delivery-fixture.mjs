// Runs against a supplied compiled/installed entry; all application data is isolated.
import assert from 'node:assert/strict';
import { mkdir,readFile,writeFile,realpath } from 'node:fs/promises';
import { join,relative } from 'node:path';
import { pathToFileURL } from 'node:url';
const [entryPath,directory]=process.argv.slice(2);
const entry=entryPath.startsWith('file:')?entryPath:pathToFileURL(entryPath).href;
const {startWeb,readSession}=await import(entry);
const {Candidates}=await import(new URL('./customization/candidates.js',entry).href);
await mkdir(directory,{recursive:true});
for(const name of ['work','development','home'])await mkdir(join(directory,name));
const workspace=await realpath(join(directory,'work')),development=await realpath(join(directory,'development')),home=await realpath(join(directory,'home'));
await writeFile(join(workspace,'review-target.txt'),'Actual work project evidence');
const store=new Candidates(development),effects=join(workspace,'review-effects');
const bodies=[];let steps=[],modelCalls=0;
const text=value=>({type:'message',id:'message',status:'completed',role:'assistant',content:[{type:'output_text',text:value,annotations:[]}]});
const call=(name,args)=>({type:'function_call',id:'item-'+modelCalls,call_id:'call-'+modelCalls,name,arguments:JSON.stringify(args),status:'completed'});
function respond(item) {
  const events=[{type:'response.created',response:{id:'response',status:'in_progress'}},{type:'response.output_item.added',output_index:0,item:{...item,...(item.content?{content:[]}: {})}}];
  if(item.type==='message')events.push({type:'response.content_part.added',output_index:0,content_index:0,part:{type:'output_text',text:'',annotations:[]}},{type:'response.output_text.delta',output_index:0,content_index:0,delta:item.content[0].text});
  events.push({type:'response.output_item.done',output_index:0,item},{type:'response.completed',response:{id:'response',status:'completed',output:[item],usage:{input_tokens:10,output_tokens:5,total_tokens:15}}});
  return new Response(events.map(event=>'data: '+JSON.stringify(event)+'\n\n').join(''),{headers:{'content-type':'text/event-stream'}});
}
const fetcher=async(_url,init)=>{modelCalls++;bodies.push(JSON.parse(String(init.body)));return respond(steps.length?await steps.shift()():text('仅报告观察到的结果'));};
const options={workspace,home,apiKey:'fixture-not-real',naming:false,runtime:{fetch:fetcher}};
let app=await startWeb(options),restartCount=0;
const request=async(path,value)=>{
  const response=await fetch(app.origin+'/api/v1'+path,{method:value===undefined?'GET':'POST',headers:{authorization:'Bearer '+app.token,origin:app.origin,'content-type':'application/json'},...(value===undefined?{}:{body:JSON.stringify(value)})});
  const data=await response.json();assert.ok(response.ok,JSON.stringify({status:response.status,data}));return data;
};
const execute=async(sessionId,commandId,prompt)=>{
  const receipt=await request(`/sessions/${sessionId}/submit`,{version:1,commandId,prompt});
  await app.sessions.activeFor(sessionId)?.done;
  const journal=await readSession(join(app.sessions.root,sessionId));
  const finished=journal.events.findLast(event=>event.type==='run.finished'&&event.runId===receipt.runId);
  assert.equal(finished?.payload.status,'completed',JSON.stringify(finished));return journal;
};
const handoff=async(source,draft,commandId)=>{
  const preview=await request(`/sessions/${source}/handoff-preview`,draft);
  return request(`/sessions/${source}/handoff-confirm`,{version:1,confirmed:true,commandId,payloadHash:preview.payloadHash,draft});
};
const sourceCode=version=>`import {appendFileSync} from 'node:fs';export default (api:import('nekomimi/extensions').ExtensionAPI)=>{
 api.registerTool({name:'review_evidence',description:'PROJECT_REVIEW_GUIDE: inspect observed project evidence',promptSnippet:'PROJECT_REVIEW_GUIDE',promptGuidelines:['PROJECT_REVIEW_GUIDE: never claim unobserved results'],parameters:{type:'object',properties:{}},async execute(){return {content:[{type:'text',text:'review checklist'}]}}});
 api.registerCommand('review',{description:'Review this project',async handler(_args,ctx){const evidence=await ctx.callTool('read',{path:'review-target.txt'});appendFileSync(${JSON.stringify(effects)},'${version}\\n');await ctx.ui({kind:'card',title:'审查 ${version}',text:evidence.content.filter(c=>c.type==='text').map(c=>c.text).join('')});return 'review-${version}';}});
};`;
try {
  const work=await app.sessions.create('原工作',{commandId:'work',mode:'work'});
  await execute(work.id,'request-review','需要 /review 审查能力，请在独立创造会话开发');
  const created=await handoff(work.id,{version:1,goal:'开发项目审查命令',target:{title:'创造审查',creation:{commandId:'create-review',mode:'create',target:{kind:'extension',root:development}}}},'request-create');
  const createId=created.targetSessionId;
  let candidate;
  const read=name=>async()=>call('read',{path:relative(development,join(candidate.path,name))});
  const write=(name,content)=>async()=>call('write',{path:relative(development,join(candidate.path,name)),content});
  const inspect=async()=>call('customization_candidate',{action:'inspect',id:candidate.id});
  const discover=async()=>{const ids=await store.list();assert.equal(ids.length,1);candidate={id:ids[0],path:(await store.read(ids[0])).root};return call('read',{path:relative(development,join(candidate.path,'extension.json'))});};
  steps=[async()=>call('customization_candidate',{action:'create',name:'review'}),discover,write('extension.json',JSON.stringify({name:'review',sdkVersion:3,entry:'index.ts',requiredCapabilities:['commands','tools','ui']})),read('index.ts'),write('index.ts','export default () => { invalid syntax'),inspect];
  const failedDevelopment=await execute(createId,'develop-broken','创建候选并报告类型错误');
  assert.equal(steps.length,0);assert.equal((await store.inspect(candidate.id)).candidate.report.passed,false);
  assert.equal((await app.sessions.commandCatalog(work.id)).commands.some(c=>c.name==='/review'),false);
  const repair=async(version,broken=false)=>{
    steps=[read('index.ts'),write('index.ts',broken?'export default () => { invalid syntax':sourceCode(version)),inspect];
    await execute(createId,`develop-${version}${broken?'-broken':''}`,broken?'验证失败必须保留原工作版本':'修复并校验当前候选');assert.equal(steps.length,0);
    assert.equal((await store.inspect(candidate.id)).candidate.report.passed,!broken);
  };
  const deliver=async(label)=>{
    const resource=await store.read(candidate.id);
    const receipt=await handoff(createId,{version:1,goal:'交付 '+label,target:{sessionId:work.id},delivery:[{candidateId:candidate.id,resourceId:resource.id,revision:resource.hash,type:'commands',usage:'明确审阅安装后使用 /review'}]},'deliver-'+label);
    const input={sessionId:createId,targetSessionId:work.id,handoffId:receipt.handoffId,id:candidate.id,contentHash:resource.hash};
    const plan=await request('/customization',{...input,action:'candidate-delivery-preview'});
    const result=await request('/customization',{...input,action:'candidate-delivery-apply',authorize:true,commandId:'install-'+label,planHash:plan.planHash});
    return {receipt,input,plan,result};
  };
  await repair('v1');const first=await deliver('v1');assert.equal(first.result.status,'activated',first.result.error);
  await execute(work.id,'use-v1','/review');assert.equal(await readFile(effects,'utf8'),'v1\n');
  await execute(work.id,'observe-enabled','说明现在可用的审查能力');assert.ok(JSON.stringify(bodies.at(-1)).includes('PROJECT_REVIEW_GUIDE'));
  await repair('v2',true);const failed=await deliver('broken-v2');assert.equal(failed.result.status,'failed');
  assert.equal((await new Candidates(workspace).active())[0].revision,first.input.contentHash);
  await execute(work.id,'use-retained-v1','/review');assert.equal(await readFile(effects,'utf8'),'v1\nv1\n');
  await repair('v2');const second=await deliver('v2');assert.equal(second.result.status,'activated',second.result.error);assert.notEqual(second.input.contentHash,first.input.contentHash);
  await execute(work.id,'use-v2','/review');assert.equal(await readFile(effects,'utf8'),'v1\nv1\nv2\n');
  const root=app.sessions.root,workBefore=await readFile(join(root,work.id,'journal.jsonl')),createBefore=await readFile(join(root,createId,'journal.jsonl'));
  await app.close();app=await startWeb(options);restartCount++;
  assert.deepEqual(await readFile(join(root,work.id,'journal.jsonl')),workBefore);assert.deepEqual(await readFile(join(root,createId,'journal.jsonl')),createBefore);
  await execute(work.id,'use-restarted-v2','/review');assert.equal(await readFile(effects,'utf8'),'v1\nv1\nv2\nv2\n');
  const installed=(await new Candidates(workspace).active())[0],host=app.sessions.customization;
  const disabled=await request('/customization',{sessionId:work.id,action:'set',id:installed.resourceId,contentHash:installed.revision,enabled:false,trusted:false,revision:(await host.catalog.decisions()).revision});
  const deadline=Date.now()+10000;
  while(host.receipts.find(r=>r.id===disabled.id)?.status==='pending'){assert.ok(Date.now()<deadline,'disable timeout');await new Promise(resolve=>setTimeout(resolve,10));}
  assert.equal((await app.sessions.commandCatalog(work.id)).commands.some(c=>c.name==='/review'),false);
  await execute(work.id,'observe-disabled','说明现在可用的能力');assert.ok(!JSON.stringify(bodies.at(-1)).includes('PROJECT_REVIEW_GUIDE'));
  assert.ok(!JSON.stringify(bodies.at(-1).input).includes('invalid syntax'),'Creation source history leaked into work input');
  const lifecycle=(await readSession(join(development,'.nekomimi/lifecycle-journal'))).events;
  assert.ok(lifecycle.filter(e=>e.type==='customization.lifecycle'&&e.payload.stage==='static'&&e.payload.passed===false).length>=2,'Missing recorded validation failures');
  const workEvents=(await readSession(join(root,work.id))).events,createEvents=(await readSession(join(root,createId))).events;
  assert.ok(workEvents.some(e=>e.type==='extension.ui'));assert.ok(workEvents.some(e=>e.type==='tool.completed'));
  assert.ok(createEvents.some(e=>e.type==='tool.completed'));assert.ok(failedDevelopment.events.some(e=>e.type==='tool.completed'));
  for(const event of workEvents.filter(e=>e.type==='tool.intent'))assert.equal(event.mode,'work');
  assert.ok(!workEvents.some(e=>e.type==='tool.intent'&&JSON.stringify(e.payload).includes('customization_candidate')));
  assert.equal(await readFile(join(workspace,'review-target.txt'),'utf8'),'Actual work project evidence');
  assert.equal(await readFile(effects,'utf8'),'v1\nv1\nv2\nv2\n');
  console.log(JSON.stringify({fixture:'project-delivery-roundtrip',node:process.version,platform:process.platform,entry,realModelCalls:0,fixtureModelCalls:modelCalls,restarts:restartCount,recordedDevelopment:true,failedCandidatePreservesVersion:true,projectApplication:true,workCommandVersions:['v1','v1','v2','v2'],disabledCommandAndPrompt:true,independentHistories:true,browserDraft:'covered separately by project-delivery.spec.ts'}));
} finally {await app.close();}
