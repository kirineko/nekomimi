import {test,expect} from '@playwright/test';
import {readFile,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {startWeb} from '../../src/server/app.js';
import {id,Journal,hash} from '../../src/journal.js';
import {contextView,assemblePrompt} from '../../src/context.js';
import {compactionSource,compactionJournalFacts} from '../../src/compaction-state.js';
import {canonicalContext} from '../../src/context-meta.js';
import {temporary,key,response,textItem} from '../helpers.js';
async function fixture(mode:'work'|'create'='work') {
  let calls=0;
  const app=await startWeb({workspace:await temporary(),home:await temporary(),apiKey:key,naming:false,staticDir:resolve('dist/web-dist'),runtime:{fetch:async()=>{calls++;return response([textItem('context fixture completed')]);}}});
  const session=await app.sessions.create('上下文检查',{commandId:id(),mode,...(mode==='create'?{target:{kind:'extension' as const,root:await temporary(),scope:'project' as const}}:{})});
  const directory=join(app.sessions.root,session.id),journal=await Journal.open(directory);
  for(let n=0;n<65;n++)await journal.append('context.add',{source:`fixture:${n}`,item:{role:'user',content:[{type:'input_text',text:`Long history message ${n}`} ]}});
  await journal.close();await app.sessions.submit(session.id,{version:1,commandId:id(),prompt:'inspect fixture'});await app.sessions.activeFor(session.id)?.done;
  // Display fixture only: no claim that this fabricated checkpoint tests compaction quality.
  const history=await Journal.open(directory),summary='Read-only summary fixture '.repeat(700),artifact=await history.artifact(summary);
  await history.append('compaction.failed',{error:'fixture failure'});
  await history.append('compaction.cancelled',{error:'fixture cancelled'});
  const prompt=(history.events.findLast(event=>event.type==='context.measured')!.payload as {prompt:ReturnType<typeof assemblePrompt>}).prompt;
  const view=contextView(history.events,prompt),source=compactionSource(history.events,view,{id:'deepseek-flash',provider:'deepseek',contextWindow:1000000,maxTokens:8192},'responses'),retention=compactionJournalFacts(history.events);
  const operation=id(),references=view.nodes.slice(0,55).map(({eventId,itemIndex,hash})=>({eventId,itemIndex,hash}));
  await history.append('compaction.started',{operation,source,sourceRevision:view.revision});
  await history.append('compaction.completed',{version:1,operation,summary,summaryHash:hash(summary),artifact,before:9000,after:4000,sourceRevision:view.revision,source,retention,factsHash:hash(JSON.stringify(canonicalContext(retention))),references});await history.close();
  return {app,session,directory,calls:()=>calls};
}
for(const mode of ['work','create'] as const)test(`10.5 ${mode} current projection, pinned selection, compaction sources and readonly attachments`,async({page})=>{
  const f=await fixture(mode);let writes=0;
  const priorCalls=f.calls(),before=await readFile(join(f.directory,'journal.jsonl'));
  page.on('request',request=>{if(request.method()==='POST'&&!request.url().endsWith('/connect'))writes++;});
  try {
    await page.goto(`${f.app.origin}/${mode}/session/${f.session.id}#token=${f.app.token}`);
    await page.getByLabel('任务草稿',{exact:true}).fill('保留未发送草稿');
    await page.getByRole('button',{name:/^上下文/}).click();const dialog=page.getByRole('dialog');
    await expect(dialog.getByRole('region',{name:'当前上下文统计'})).toContainText('估算');await expect(dialog).toContainText(f.session.binding!.target.id);
    await expect(dialog.getByLabel('请求选择清单')).toHaveText(/选入/);
    const measurement=await dialog.getByRole('region',{name:'当前上下文统计'}).innerText();
    await dialog.getByRole('button',{name:'下一页选择',exact:true}).click();await expect(dialog).toContainText('选择清单偏移 40');await expect(dialog.getByRole('region',{name:'当前上下文统计'})).toHaveText(measurement,{useInnerText:true});
    const pinned=await dialog.getByRole('combobox',{name:'请求快照',exact:true}).inputValue();expect(pinned).not.toBe('');
    await dialog.getByRole('combobox',{name:'选择结果',exact:true}).selectOption('exclude');await expect(dialog).toContainText('选择清单偏移 0');expect(await dialog.getByRole('combobox',{name:'请求快照',exact:true}).inputValue()).toBe(pinned);
    await dialog.getByText(/#\d+ · 已提交/).click();await expect(dialog).toContainText('原始节点引用 55 · 偏移 0');
    await dialog.getByRole('button',{name:'下一页压缩来源',exact:true}).click();await expect(dialog).toContainText('原始节点引用 55 · 偏移 40');await expect(dialog.getByRole('button',{name:'下一页压缩来源',exact:true})).toBeDisabled();
    await dialog.getByRole('button',{name:'读取完整摘要附件',exact:true}).click();await expect(dialog).toContainText('Read-only summary fixture');await dialog.getByRole('button',{name:'继续读取附件',exact:true}).click();await expect(dialog).toContainText('偏移 12000');
    await expect(dialog).toContainText('失败，未应用');await expect(dialog).toContainText('取消，未应用');
    await page.keyboard.press('Escape');await expect(page.getByRole('button',{name:/^上下文/})).toBeFocused();await expect(page.getByLabel('任务草稿',{exact:true})).toHaveJSProperty('textContent','保留未发送草稿');
    expect(writes).toBe(0);expect(f.calls()).toBe(priorCalls);expect(await readFile(join(f.directory,'journal.jsonl'))).toEqual(before);
  } finally {await f.app.close();}
});
test('10.5 unknown capacity at 360px, outside close, refresh and missing historical artifact diagnostics',async({page},info)=>{
  await page.setViewportSize({width:360,height:800});const f=await fixture();
  try {
    const settings=await f.app.sessions.config.describe();await f.app.sessions.config.save('settings',{...settings,model:'unknown-capacity'});
    await page.goto(`${f.app.origin}/work/session/${f.session.id}#token=${f.app.token}`);
    await page.getByRole('button',{name:'设置',exact:true}).click();await page.getByRole('menuitem',{name:'外观',exact:true}).click();await page.getByRole('button',{name:'深色',exact:true}).click();await page.getByRole('button',{name:'关闭外观',exact:true}).click();await page.getByLabel('任务草稿',{exact:true}).fill('窄屏草稿');const entry=page.getByRole('button',{name:/^上下文/});await entry.click();
    const dialog=page.getByRole('dialog'),current=dialog.getByRole('region',{name:'当前上下文统计'});
    await expect(current).toContainText('容量未知');await expect(current).toContainText('unknown-capacity');await expect(current).not.toContainText('%');
    expect(await dialog.evaluate(element=>element.scrollWidth<=element.clientWidth)).toBe(true);
    await page.evaluate(()=>document.documentElement.style.fontSize='20px');await page.screenshot({path:info.outputPath('context-narrow-zoom.png')});expect(await dialog.evaluate(element=>element.scrollWidth<=element.clientWidth)).toBe(true);
    await expect(dialog.getByRole('button',{name:'关闭详情',exact:true})).toHaveCSS('color','rgb(240, 244, 255)');
    const bounds=await dialog.boundingBox();expect(bounds!.x).toBeGreaterThanOrEqual(0);expect(bounds!.x+bounds!.width).toBeLessThanOrEqual(360);
    await page.mouse.click(2,2);await expect(dialog).not.toBeVisible();await expect(entry).toBeFocused();await expect(page.getByLabel('任务草稿',{exact:true})).toHaveJSProperty('textContent','窄屏草稿');
    await page.reload();await entry.click();await expect(current).toContainText('容量未知');
    const result=await page.request.get(f.app.origin+`/api/v1/sessions/${f.session.id}/context-details`);const data=await result.json();
    await rm(join(f.directory,'artifacts',data.snapshot.artifact.sha256));await dialog.getByRole('button',{name:'刷新只读详情',exact:true}).click();await expect(dialog.getByRole('alert')).toContainText('请求快照附件缺失');
  } finally {await f.app.close();}
});

test('10.5 late detail reads cannot replace another session projection',async({page})=>{
  const f=await fixture(),other=await f.app.sessions.create('空白目标会话');let release=()=>{};
  const delayed=new Promise<void>(resolve=>{release=resolve;});
  let started=false;
  try {
    await page.route(`**/sessions/${f.session.id}/context-details?*`,async route=>{const response=await route.fetch();started=true;await delayed;await route.fulfill({response}).catch(()=>{});});
    await page.goto(`${f.app.origin}/work/session/${f.session.id}#token=${f.app.token}`);
    await page.getByRole('button',{name:/^上下文/}).click();await expect.poll(()=>started).toBe(true);await page.keyboard.press('Escape');
    await page.locator(`a[href="/work/session/${other.id}"]`).click();await page.getByRole('button',{name:/^上下文/}).click();
    const dialog=page.getByRole('dialog');await expect(dialog).toContainText(other.id);await expect(dialog).toContainText('尚无可用的当前请求测量');release();
    await expect(dialog).not.toContainText(f.session.id);await expect(dialog).toContainText('尚无历史请求快照');
  }finally{release();await f.app.close();}
});
