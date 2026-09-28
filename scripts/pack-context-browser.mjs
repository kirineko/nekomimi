import {chromium,expect} from '@playwright/test';
import assert from 'node:assert/strict';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
const installation=resolve(process.argv[2]),entry=join(installation,'node_modules/nekomimi');
const {startWeb,Journal,readArtifact}=await import(pathToFileURL(join(entry,'dist/index.js')).href);
const {CustomizationHost}=await import(pathToFileURL(join(entry,'dist/customization/host.js')).href);
const {ProviderProfiles}=await import(pathToFileURL(join(entry,'dist/customization/provider-profiles.js')).href);
const suffix=Date.now(),workspace=join(installation,'context-workspace-'+suffix),home=join(installation,'context-home-'+suffix),root=join(workspace,'.nekomimi/extensions/provider');
await mkdir(root,{recursive:true});
await writeFile(join(root,'extension.json'),JSON.stringify({name:'provider',sdkVersion:2,entry:'index.ts',requiredCapabilities:['providers']}));
await writeFile(join(root,'index.ts'),(await readFile(join(entry,'extension-docs/http-providers.ts'),'utf8')).replace('contextWindow: 128000','contextWindow: 20000').replace('maxOutputTokens: 4096','maxOutputTokens: 2000'));
const setup=new CustomizationHost(workspace,home),resource=(await setup.catalog.discover()).find(r=>r.kind==='extension');await setup.catalog.decide(resource.id,true,true,0);
const profiles=new ProviderProfiles(home);await profiles.save({id:'fixture',providerId:'example-responses',resourceId:resource.id,model:'fixture-model',baseUrl:'https://fixture.invalid',paths:['/responses']},0);await profiles.select('main','fixture',1);await setup.close();
const requests=[];let hold=false;
const app=await startWeb({workspace,home,naming:false,runtime:{fetch:async(_url,init)=>{
 const body=JSON.parse(String(init.body));requests.push(body);const summary=JSON.stringify(body).includes('Conversation data:');
 if(hold && summary)await new Promise((_,reject)=>{if(init.signal.aborted)reject(init.signal.reason);else init.signal.addEventListener('abort',()=>reject(init.signal.reason),{once:true});});
 return Response.json({status:'completed',output:[{type:'message',role:'assistant',content:[{type:'output_text',text:summary?'保留目标、文件与待办。':'安装包上下文任务完成'}]}]});
}}});
const browser=await chromium.launch({channel:'chrome'});
async function seed(directory,n=8){const journal=await Journal.open(directory);try{for(let i=0;i<n;i++){await journal.append('context.add',{source:'user',item:{role:'user',content:[{type:'input_text',text:'历史任务 '+i+' 中'.repeat(1500)}]}});await journal.append('context.add',{source:'fixture',item:{role:'assistant',content:[{type:'output_text',text:'完成'}]}});}}finally{await journal.close();}}
try{
 const session=await app.sessions.create('上下文安装包验收');let record=await app.sessions.entry(session.id);await seed(record.directory);
 const page=await browser.newPage({viewport:{width:1280,height:900}});await page.goto(app.url);await page.getByText('上下文安装包验收',{exact:true}).first().click();
 const input=page.getByRole('textbox',{name:'任务内容'}),meter=page.getByRole('button',{name:'上下文占用明细'});
 await input.fill('继续任务');await page.getByRole('button',{name:'发送任务'}).click();await expect(page.getByText('安装包上下文任务完成',{exact:true})).toBeVisible();await app.sessions.active?.done;
 assert(requests.length>1);assert(JSON.stringify(requests.at(-1)).includes('历史摘要'));assert(JSON.stringify(requests.at(-1)).length<20000);
 await expect(meter).toContainText('%');await meter.click();await expect(page.getByRole('region',{name:'上下文占用'})).toContainText('20K');
 await mkdir('output/playwright',{recursive:true});await page.screenshot({path:'output/playwright/installed-context-default.png'});await page.keyboard.press('Escape');
 record=await app.sessions.entry(session.id);const initial=record.reader.events.filter(e=>e.type==='compaction.completed').length;assert.equal(initial,1);
 await seed(record.directory,4);await input.fill('/compact 保留文件');await page.getByRole('button',{name:'发送任务'}).click();await expect(page.getByText(/上下文已整理，约/)).toBeVisible();await app.sessions.active?.done;
 record=await app.sessions.entry(session.id);assert.equal(record.reader.events.filter(e=>e.type==='compaction.completed').length,2);
 const sent=record.reader.events.filter(e=>e.type==='request.dispatched');for(let i=0;i<sent.length;i++)assert.deepEqual(JSON.parse((await readArtifact(record.directory,sent[i].payload.body)).toString()),requests[i]);
 await seed(record.directory,4);hold=true;await input.fill('/compact');await page.getByRole('button',{name:'发送任务'}).click();await expect(meter).toContainText('整理中');
 await input.fill('取消后保留草稿');await page.getByRole('button',{name:'停止任务'}).click();await expect(meter).not.toContainText('整理中');await app.sessions.active?.done;await expect(input).toHaveValue('取消后保留草稿');await expect(input).not.toBeFocused();hold=false;
 record=await app.sessions.entry(session.id);assert.equal(record.reader.events.filter(e=>e.type==='compaction.completed').length,2);
 const journal=await Journal.open(record.directory);for(let i=0;i<85;i++)await journal.append('context.add',{source:'user',item:{role:'user',content:[{type:'input_text',text:'历史分页 '+i}]}},{},false);await journal.close();
 await page.reload();await expect(meter).toContainText('%');const percentage=await meter.innerText();await page.getByRole('button',{name:'查看更早',exact:true}).click();await expect(meter).toHaveText(percentage);await page.locator('.history-latest').click();await expect(page.getByText('历史分页 84',{exact:true})).toBeInViewport();
 await page.evaluate(()=>{document.documentElement.style.setProperty('--accent','#d64286');document.documentElement.style.setProperty('--surface','#fff5f9');});await page.setViewportSize({width:360,height:740});await meter.click();await expect(page.locator('.context-ring')).toHaveCSS('stroke','rgb(214, 66, 134)');await page.screenshot({path:'output/playwright/installed-context-theme-mobile.png'});
 assert.match(await readFile(join(entry,'extension-docs/context.md'),'utf8'),/compaction/);assert.match(await readFile(join(entry,'dist/index.d.ts'),'utf8'),/ContextOccupancy/);
 const evidence={installed:true,auto:true,manual:true,cancel:true,history:true,refresh:true,customProvider:true,requests:requests.map(r=>({bytes:Buffer.byteLength(JSON.stringify(r)),summary:JSON.stringify(r).includes('Conversation data:'),outputLimit:r.max_output_tokens}))};await writeFile('output/playwright/installed-context-evidence.json',JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence));
}finally{await browser.close();await app.close();}
