import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {startWeb} from '../../src/server/app.js';
import {temporary,key,response,textItem} from '../helpers.js';

for(const mode of ['work','create'] as const)test(`${mode}: failure continuation prepares a scoped draft without rerunning`,async({page})=>{
  let calls=0;
  const app=await startWeb({workspace:await temporary(),home:await temporary(),apiKey:key,naming:false,staticDir:resolve('dist/web-dist'),runtime:{fetch:async()=>++calls===1?response([],'incomplete'):response([textItem('已根据草稿继续')])}});
  try{
    const session=await app.sessions.create('失败恢复',{mode,commandId:'recovery',...(mode==='create'?{target:{kind:'extension' as const,root:await temporary()}}:{})});
    await page.goto(`${app.origin}/${mode}/session/${session.id}#token=${app.token}`);
    const input=page.getByLabel('任务草稿',{exact:true});await input.fill('尝试任务');await page.getByRole('button',{name:'发送',exact:true}).click();
    const timeline=page.getByTestId(mode==='work'?'timeline':'create-timeline'),resume=timeline.getByRole('button',{name:'继续任务',exact:true});
    await expect(resume).toBeVisible();await expect(timeline).not.toContainText('Response incomplete');expect(calls).toBe(1);
    await input.fill('保留当前的想法');await resume.click();await expect(page.getByRole('dialog',{name:'保留当前草稿'})).toBeVisible();await expect(page.getByRole('button',{name:'保留原草稿'})).toBeFocused();
    await page.getByRole('button',{name:'保留原草稿'}).click();await expect(input).toHaveJSProperty('textContent','保留当前的想法');await expect(resume).toBeFocused();expect(calls).toBe(1);
    await resume.click();await page.getByRole('button',{name:'追加到草稿'}).click();await expect(input).toContainText('保留当前的想法');await expect(input).toContainText('结果未知的操作先核对');await expect(input).toBeFocused();expect(calls).toBe(1);
    await page.reload();await expect(input).toContainText('保留当前的想法');expect(calls).toBe(1);
    await resume.click();await page.getByRole('button',{name:'替换草稿'}).click();await expect(input).not.toContainText('保留当前的想法');await expect(input).toContainText('不要自动重跑');expect(calls).toBe(1);
    await page.getByRole('button',{name:'发送',exact:true}).click();await expect(page.getByText('已根据草稿继续',{exact:true})).toBeVisible();expect(calls).toBe(2);
  }finally{await app.close();}
});

test('diagnostic metadata updates without a new durable event and downloads read-only evidence',async({page})=>{
  const app=await startWeb({workspace:await temporary(),home:await temporary(),apiKey:key,naming:false,staticDir:resolve('dist/web-dist'),runtime:{fetch:async()=>{throw Error('No model calls allowed');}}});
  try{
    const session=await app.sessions.create('诊断测试',{mode:'work',commandId:'diagnostic'});
    await page.goto(`${app.origin}/work/session/${session.id}#token=${app.token}`);await expect(page.getByLabel('任务草稿',{exact:true})).toBeVisible();
    const entry=await app.sessions.entry(session.id),before=entry.reader.cursor.seq;
    entry.diagnostics.push({version:1,id:'diagnostic-fixture',timestamp:new Date().toISOString(),sessionId:session.id,operation:'watermark.rename',code:'EPERM',category:'storage',platform:'win32',nodeVersion:'v22.19.0',seq:before+1,durableSeq:before});
    const summary=page.getByText(/检测到运行异常.*watermark.rename/);await expect(summary).toBeVisible();await summary.click();
    await page.route('**/diagnostics',route=>route.fulfill({status:503,json:{error:{message:'diagnostic unavailable'}}}),{times:1});
    await page.getByRole('button',{name:'下载诊断'}).click();await expect(page.getByRole('alert').filter({hasText:'诊断下载失败'})).toBeVisible();
    const downloaded=page.waitForEvent('download');await page.getByRole('button',{name:'下载诊断'}).click();
    const data=JSON.parse(await readFile((await (await downloaded).path())!,'utf8'));expect(data.authoritative).toBe(false);expect(data.diagnostics[0].code).toBe('EPERM');expect(JSON.stringify(data)).not.toContain(key);expect(entry.reader.cursor.seq).toBe(before);
  }finally{await app.close();}
});

test('button submission restores editor focus immediately and a late reply does not steal dialog focus',async({page})=>{
  const app=await startWeb({workspace:await temporary(),home:await temporary(),apiKey:key,naming:false,staticDir:resolve('dist/web-dist'),runtime:{fetch:async()=>response([textItem('已完成')])}});let release=()=>{};
  try{
    const session=await app.sessions.create('焦点检查',{mode:'work',commandId:'focus'});await page.goto(`${app.origin}/work/session/${session.id}#token=${app.token}`);
    const input=page.getByLabel('任务草稿',{exact:true}),send=page.getByRole('button',{name:'发送',exact:true});
    for(const via of ['mouse','keyboard']){
      await input.fill('提交方式 '+via);await expect(send).toBeEnabled();if(via==='mouse')await send.click();else{await send.focus();await page.keyboard.press('Enter');}
      await expect(input).toBeFocused();await expect(input).toHaveJSProperty('textContent','');await expect(send).toBeDisabled();await app.sessions.activeFor(session.id)?.done;
    }
    const gate=new Promise<void>(resolve=>{release=resolve;});await page.route('**/submit',async route=>{await gate;await route.fulfill({status:503,json:{error:{message:'延迟提交失败'}}});},{times:1});
    await input.fill('等待响应');await expect(send).toBeEnabled();await send.focus();await page.keyboard.press('Enter');await expect(input).toBeFocused();
    await input.fill('收到旧响应之前的新草稿');await page.getByRole('button', { name:'设置',exact:true }).click();await page.getByRole('menuitem', { name:'导出当前会话',exact:true}).click();const dialog=page.getByRole('dialog',{name:'导出对话'});await expect(dialog).toBeVisible();
    const focused=await page.evaluate(()=>document.activeElement?.textContent);release();await expect(page.getByText(/延迟提交失败/)).toBeVisible();
    expect(await page.evaluate(()=>document.activeElement?.textContent)).toBe(focused);await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');await expect(input).toHaveJSProperty('textContent','收到旧响应之前的新草稿');
  }finally{release();await app.close();}
});
