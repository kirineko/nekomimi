import {test,expect} from '@playwright/test';
import {readFile,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {startWeb} from '../../src/server/app.js';
import {Journal,id,hash} from '../../src/journal.js';
import {executeTypedModel} from '../../src/pi/typed-model.js';
import {Candidates} from '../../src/customization/candidates.js';
import {temporary,key,response,textItem} from '../helpers.js';
import { openEvidence } from './fixtures/workbench.js';
async function fixture(mode:'work'|'create'){
  const app=await startWeb({workspace:await temporary(),home:await temporary(),naming:false,staticDir:resolve('dist/web-dist')});
  const session=await app.sessions.create('调用检查',{commandId:id(),mode,...(mode==='create'?{target:{kind:'extension' as const,root:await temporary(),scope:'project' as const}}:{})});
  const directory=join(app.sessions.root,session.id),journal=await Journal.open(directory),runId='inspection-run';let calls=0;
  await journal.append('run.started',{}, {runId});await journal.append('tool.requested',{name:'codemode',args:{code:'fixture'}},{runId,toolCallId:'script'});
  await journal.append('tool.requested',{name:'write',args:{path:'kept.txt'}},{runId,toolCallId:'write',parentToolCallId:'script'});await journal.append('tool.completed',{name:'write'},{runId,toolCallId:'write',parentToolCallId:'script'});
  const common={id:'fixture',name:'fixture',provider:'fixture',baseUrl:'https://fixture.invalid/v1',input:['text'] as ['text'],cost:{input:0,output:0,cacheRead:0,cacheWrite:0}};
  const classifier=await executeTypedModel(journal,{operation:'classifier',apiKey:'test-credential',paths:['/v1/systemone'],revision:'test-revision',links:{runId,toolCallId:'script'},model:{...common,type:'classifier',api:'typesafe-system-one',contextWindow:8192},context:{state:{text:'source'},questions:{ready:{type:'bool',instructions:'ready?',criteria:{true:'yes',false:'no'}}}},transport:{fetch:async()=>{calls++;return Response.json({answers:{ready:{type:'noul',noul:0.9}},usage:{input_tokens:3,output_tokens:1}});}}});
  const image=await executeTypedModel(journal,{operation:'image',apiKey:'test-credential',paths:['/v1/chat/completions'],revision:'test-revision',links:{runId,toolCallId:'script'},model:{...common,type:'image',api:'openrouter-images',output:['image','text']},context:{input:[{type:'text',text:'draw'}]},transport:{fetch:async()=>{calls++;return Response.json({choices:[{message:{content:'saved caption',images:[{image_url:{url:'data:image/png;base64,'+(await readFile(resolve('extension-docs/examples/sakura/sakura.png'))).toString('base64')}}]}}],usage:{prompt_tokens:2,completion_tokens:1}});}}});
  await journal.append('tool.result',{name:'codemode',details:{usage:{input:5,output:2}}},{runId,toolCallId:'script'});await journal.append('codemode.finished',{status:'failed',error:'parent fixture failed'},{runId,toolCallId:'script'});
  const request=await journal.artifact('{"model":"physical-retry","input":"raw retry fixture"}');
  for(const [attemptId,status] of [['retry-1','failed'],['retry-2','completed']]){
    const links={runId,modelCallId:'retry',attemptId};await journal.append('attempt.started',{purpose:'work',model:'physical-retry',provider:'fixture'},links);await journal.append('request.dispatched',{body:request,bodyHash:request.sha256},links);
    await journal.append('attempt.finished',{status,...(status==='completed'?{usage:{input_tokens:7,output_tokens:2}}:{error:'rate limited'})},links);
    if(status==='failed')await journal.append('attempt.retry',{reason:'HTTP 429'},links);
  }
  await journal.append('run.finished',{status:'failed'},{runId});await journal.close();
  return {app,session,directory,classifier,image,request,calls:()=>calls};
}
for(const mode of ['work','create'] as const)test(`10.6 ${mode} nested statuses, typed results, images, raw attempts and partial usage remain readonly`,async({page})=>{
  const f=await fixture(mode),before=await readFile(join(f.directory,'journal.jsonl'));const writes:string[]=[];
  page.on('request',request=>{if(request.method()==='POST'&&!request.url().endsWith('/connect'))writes.push(request.url());});
  try{
    await page.goto(`${f.app.origin}/${mode}/session/${f.session.id}#token=${f.app.token}`);await page.getByLabel('任务草稿',{exact:true}).fill('检查后继续');await openEvidence(page);const dialog=page.getByRole('dialog');
    const usage=dialog.getByRole('region',{name:'运行用量汇总'});await expect(usage).toContainText('4 次模型尝试');await expect(usage).toContainText('已知输入 12 / 输出 4');await expect(usage).toContainText('输入 1 次');await expect(usage).toContainText('费用未知');
    await expect(dialog.getByRole('button',{name:'codemode · 失败',exact:true})).toBeVisible();await dialog.getByRole('button',{name:'展开子调用（3）',exact:true}).click();await expect(dialog.getByRole('button',{name:'write · 完成',exact:true})).toBeVisible();
    await dialog.getByRole('button',{name:'classifier · 完成',exact:true}).click();let selected=dialog.getByRole('region',{name:'所选调用证据'});await selected.getByText(/#\d+ · model.operation.result/).click();await expect(selected.getByRole('region',{name:'归一化分类结果'})).toContainText('0.9');
    await dialog.getByRole('button',{name:'image · 完成',exact:true}).click();selected=dialog.getByRole('region',{name:'所选调用证据'});await selected.getByText(/#\d+ · model.operation.result/).click();await selected.getByRole('button',{name:/查看保存的图片/}).click();await expect(selected.getByRole('img',{name:/保存的模型图片/})).toBeVisible();await expect.poll(()=>selected.getByRole('img').evaluate((element:HTMLImageElement)=>element.naturalWidth)).toBeGreaterThan(0);
    await dialog.getByRole('button',{name:'work · 完成',exact:true}).click();selected=dialog.getByRole('region',{name:'所选调用证据'});await selected.getByRole('combobox',{name:'网络尝试',exact:true}).selectOption('retry-1');await selected.getByText(/#\d+ · request.dispatched/).click();await selected.getByRole('button',{name:'读取原始附件 1',exact:true}).click();await expect(selected).toContainText('raw retry fixture');await expect(selected).toContainText(f.request.sha256);await expect(selected).toContainText('attempt.retry');
    await selected.getByRole('combobox',{name:'网络尝试',exact:true}).selectOption('retry-2');await expect(selected).not.toContainText('attempt.retry');
    await page.keyboard.press('Escape');await expect(page.getByRole('button',{name:'会话操作',exact:true})).toBeFocused();await expect(page.getByLabel('任务草稿',{exact:true})).toHaveJSProperty('textContent','检查后继续');expect(writes).toEqual([]);expect(f.calls()).toBe(2);expect(await readFile(join(f.directory,'journal.jsonl'))).toEqual(before);
  }finally{await f.app.close();}
});
test('10.6 missing attachments are explicit and 360px inspection remains reachable',async({page},info)=>{
  await page.setViewportSize({width:360,height:800});const f=await fixture('work');
  try{
    await rm(join(f.directory,'artifacts',f.image.evidence.attachments[0]!.artifact.sha256));
    await page.goto(`${f.app.origin}/work/session/${f.session.id}#token=${f.app.token}`);await openEvidence(page);const dialog=page.getByRole('dialog');
    await dialog.getByRole('button',{name:'展开子调用（3）',exact:true}).click();await dialog.getByRole('button',{name:'image · 完成',exact:true}).click();const selected=dialog.getByRole('region',{name:'所选调用证据'});await selected.getByText(/#\d+ · model.operation.result/).click();await selected.getByRole('button',{name:/查看保存的图片/}).click();await expect(selected.getByRole('alert')).toContainText('图片附件缺失');
    expect(await dialog.evaluate(element=>element.scrollWidth<=element.clientWidth)).toBe(true);await page.screenshot({path:info.outputPath('inspection-narrow.png')});await page.keyboard.press('Escape');await expect(page.getByRole('button',{name:'会话操作',exact:true})).toBeFocused();
  }finally{await f.app.close();}
});

test('10.6 historical request opens its exact context and delivery version; deleted sources stay missing',async({page})=>{
  let calls=0;const development=await temporary(),app=await startWeb({workspace:await temporary(),home:await temporary(),apiKey:key,naming:false,staticDir:resolve('dist/web-dist'),runtime:{fetch:async()=>{calls++;return response([textItem('received')]);}}});
  try{
    const work=await app.sessions.create('工作'),source=await app.sessions.create('交付来源',{commandId:id(),mode:'create',target:{kind:'extension',root:development}}),candidates=new Candidates(development),candidate=await candidates.scaffold('review'),resource=await candidates.read(candidate.id);
    const draft={version:1,goal:'inspect exact delivery',target:{sessionId:work.id},delivery:[{resourceId:resource.id,revision:resource.hash,candidateId:candidate.id,type:'commands',usage:'explicit use only'}]};
    const preview=await app.sessions.handoffPreview(source.id,draft),receipt=await app.sessions.confirmHandoff(source.id,{version:1,confirmed:true,commandId:'inspection-delivery',payloadHash:preview.payloadHash,draft});
    await app.sessions.submit(work.id,{version:1,commandId:'inspect-model',prompt:'read selected delivery',handoffIds:[receipt.handoffId]});await app.sessions.activeFor(work.id)?.done;
    const entry=await app.sessions.entry(work.id),captured=entry.reader.events.findLast(event=>event.type==='context.snapshot')!;
    const settings=await app.sessions.config.describe();await app.sessions.config.save('settings',{...settings,model:'new-current-model'});
    await page.goto(`${app.origin}/work/session/${work.id}#token=${app.token}`);await openEvidence(page);const inspection=page.getByRole('dialog',{name:'调用证据',exact:true});
    await inspection.getByRole('button',{name:'work · 完成',exact:true}).click();const selected=inspection.getByRole('region',{name:'所选调用证据'});await selected.getByRole('combobox',{name:'证据分组',exact:true}).selectOption('sources');await selected.getByText(/#\d+ · context.view/).click();await selected.getByRole('button',{name:'查看此请求的上下文',exact:true}).click();
    const context=page.getByRole('dialog',{name:'上下文详情',exact:true});await expect(context.getByRole('combobox',{name:'请求快照',exact:true})).toHaveValue(captured.eventId);await expect(context.getByRole('region',{name:'当前上下文统计'})).toContainText('new-current-model');
    const handoff=context.getByRole('region',{name:'此请求的交接来源'});await handoff.locator('summary').click();await expect(handoff.getByRole('link',{name:'查看交付版本 review',exact:true})).toHaveAttribute('href',new RegExp(candidate.id));await expect(handoff.getByRole('link',{name:'查看交接来源会话',exact:true})).toHaveAttribute('href',new RegExp(source.id));
    await page.keyboard.press('Escape');await expect(inspection).toBeVisible();await app.sessions.remove(source.id);await selected.getByRole('button',{name:'查看此请求的上下文',exact:true}).click();await context.getByRole('region',{name:'此请求的交接来源'}).locator('summary').click();await expect(context).toContainText('来源会话已删除或不可回溯');await expect(context.getByRole('link',{name:'查看交接来源会话',exact:true})).toHaveCount(0);expect(calls).toBe(1);
  }finally{await app.close();}
});
