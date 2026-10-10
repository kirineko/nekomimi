import {test,expect,type Page} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {startWeb} from '../../src/server/app.js';
import {temporary,key,response,textItem} from '../helpers.js';
import { openDrawerTab, openEvidence } from './fixtures/workbench.js';

async function server(){return startWeb({workspace:await temporary(),home:await temporary(),apiKey:key,naming:false,staticDir:resolve('dist/web-dist'),runtime:{fetch:async()=>response([textItem('任务完成')])}});}
async function openSession(page:Page,app:Awaited<ReturnType<typeof server>>) {
 const session=await app.sessions.create('交互检查');
 await page.goto(`${app.origin}/work/session/${session.id}#token=${app.token}`);return session;
}
async function appearance(page:Page) {await page.getByRole('button',{name:'设置',exact:true}).click();await page.getByRole('menuitem',{name:'外观',exact:true}).click();}
test('optional features load on demand, cancel delayed load, retry network failure and keep draft',async({page})=>{
 const app=await server(),scripts:string[]=[];
 const manifest=JSON.parse(await readFile('dist/web-dist/assets/asset-manifest.json','utf8'));
 const entries=['v2/routes/themes.tsx','components/FileBrowser.tsx','components/Changes.tsx','v2/routes/inspection.tsx','v2/routes/session-export.tsx'];
 const files=entries.map(entry=>manifest[entry].file as string);
 page.on('request',r=>{if(new URL(r.url()).pathname.endsWith('.js'))scripts.push(r.url());});
 let release=()=>{};
 try{
  await openSession(page,app);const input=page.getByLabel('任务草稿',{exact:true});await input.fill('保留草稿');
  for(const file of files)expect(scripts.some(url=>url.includes(file))).toBe(false);
  const gate=new Promise<void>(resolve=>{release=resolve;});await page.route(`**/${files[0]}*`,async route=>{await gate;await route.continue();},{times:1});
  await appearance(page);await expect(page.getByRole('region',{name:'主题管理加载',exact:true}).getByRole('status')).toContainText('正在加载主题管理');await page.getByRole('button',{name:'关闭外观',exact:true}).click();
  const finished=page.waitForResponse(response=>response.url().includes(files[0]!));release();await finished;
  await expect(page.getByRole('button',{name:'设置',exact:true})).toBeFocused();await expect(page.getByRole('dialog')).toHaveCount(0);
  await appearance(page);await expect(page.getByRole('heading',{name:'主题与外观'})).toBeVisible();await page.keyboard.press('Escape');await expect(input).toHaveJSProperty('textContent','保留草稿');
  await page.route(`**/${files[1]}*`,route=>route.abort(),{times:1});await openDrawerTab(page,'文件');await expect(page.getByRole('alert')).toContainText('文件加载失败');
  await page.getByRole('button',{name:'重试加载'}).click();await expect(page.getByRole('tree',{name:'项目文件'})).toBeVisible();await expect(page.getByRole('alert')).toHaveCount(0);
  await page.getByRole('tab',{name:'变更',exact:true}).click();await expect(page.getByRole('tabpanel')).toContainText('暂无已确认的文件修改');
  await page.getByRole('tab',{name:'证据',exact:true}).click();await input.fill('测试调用');await page.getByRole('button',{name:'发送',exact:true}).click();
  await expect(page.getByText('任务完成',{exact:true})).toBeVisible();await openEvidence(page);await expect(page.getByRole('dialog',{name:'调用证据',exact:true})).toBeVisible();await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'设置',exact:true}).click();await page.getByRole('menuitem',{name:'导出当前会话',exact:true}).click();await expect(page.getByRole('button',{name:'下载 HTML'})).toBeVisible();await page.keyboard.press('Escape');
  for(const file of files)expect(scripts.some(url=>url.includes(file)),file).toBe(true);
 }finally{release();await app.close();}
});

test('submit restores focus for mouse and keyboard and failure retains draft',async({page})=>{
 const app=await server();try{
  const session=await openSession(page,app);const input=page.getByLabel('任务草稿',{exact:true});
  await input.fill('鼠标提交');await page.getByRole('button',{name:'发送',exact:true}).click();await expect(input).toBeFocused();await expect(input).toHaveJSProperty('textContent', '');
  await expect(page.getByText('任务完成',{exact:true})).toHaveCount(1);await app.sessions.activeFor(session.id)?.done;
  await expect(page.getByRole('button',{name:'发送',exact:true})).toBeVisible();await input.fill('键盘提交');await expect(page.getByRole('button',{name:'发送',exact:true})).toBeEnabled();await input.press('Enter');await expect(input).toBeFocused();await expect(input).toHaveJSProperty('textContent', '');
  await expect(page.getByRole('button',{name:'发送',exact:true})).toBeVisible();
  await expect(page.getByText('任务完成',{exact:true})).toHaveCount(2);await app.sessions.activeFor(session.id)?.done;
  await expect(page.getByRole('button',{name:'发送',exact:true})).toBeVisible();
  await page.route('**/submit',r=>r.fulfill({status:503,json:{error:{message:'稍后重试'}}}),{times:1});
  await input.fill('失败草稿');await expect(page.getByRole('button',{name:'发送',exact:true})).toBeEnabled();await page.getByRole('button',{name:'发送',exact:true}).click();await expect(input).toBeEnabled();await expect(input).toBeFocused();await expect(input).toHaveJSProperty('textContent', '失败草稿');
  await input.press('Shift+Enter');await expect(input).toHaveJSProperty('textContent', '失败草稿\n');
 }finally{await app.close();}
});

test('late submit never steals focus or clears a new context draft',async({page})=>{
 const app=await server();let release=()=>{};
 try{
  const original=await openSession(page,app),other=await app.sessions.create('另一个会话');
  const input=page.getByLabel('任务草稿',{exact:true}),send=page.getByRole('button',{name:'发送',exact:true});
  for(const target of ['modal','tab','session','blur']){
   const gate=new Promise<void>(resolve=>{release=resolve;});
   await page.route('**/submit',async route=>{await gate;await route.fulfill({status:503,json:{error:{message:'延迟失败'}}});},{times:1});
   await input.fill('等待 '+target);await expect(send).toBeEnabled();await send.click();await expect(send).toBeDisabled();
   await input.fill('较新的草稿 '+target);
   if(target==='modal'){await appearance(page);await expect(page.getByRole('dialog',{name:'外观',exact:true})).toBeVisible();}
   if(target==='tab'){await page.getByRole('button',{name:'设置',exact:true}).focus();await page.keyboard.press('Tab');}
   if(target==='session'){await page.getByRole('link',{name:'另一个会话',exact:true}).click();await expect(page).toHaveURL(new RegExp(other.id));await input.fill('其他会话的新草稿');await page.getByRole('button',{name:'设置',exact:true}).focus();}
   if(target==='blur')await page.evaluate(()=>{(document.activeElement as HTMLElement)?.blur();window.dispatchEvent(new Event('blur'));});
   const settled=page.waitForResponse(response=>response.url().endsWith('/submit'));release();await settled;
   if(target!=='session')await expect(page.getByText(/提交失败：延迟失败/)).toBeVisible();
   await expect(input).not.toBeFocused();await expect(input).toHaveJSProperty('textContent',target==='session'?'其他会话的新草稿':'较新的草稿 '+target);
   if(target==='modal')await page.keyboard.press('Escape');
   if(target==='session'){await page.getByRole('link',{name:'交互检查',exact:true}).click();await expect(page).toHaveURL(new RegExp(original.id));await expect(input).toHaveJSProperty('textContent','较新的草稿 session');}
  }
 }finally{release();await app.close();}
});

test('latest follows new messages and delayed layout, while deliberate history reading stays anchored',async({page})=>{
 const app=await startWeb({workspace:await temporary(),home:await temporary(),apiKey:key,naming:false,staticDir:resolve('dist/web-dist'),runtime:{fetch:async()=>response([textItem(Array.from({length:100},(_,i)=>`内容 ${i}\n\n`).join(''))])}});
 try{
  const session=await openSession(page,app);await page.getByLabel('任务草稿',{exact:true}).fill('长回复');await page.getByRole('button',{name:'发送',exact:true}).click();
  const conversation=page.getByTestId('timeline');
  const distance=()=>conversation.evaluate(el=>el.scrollHeight-el.clientHeight-el.scrollTop);
  await expect(page.getByText('内容 99',{exact:true})).toBeVisible();await expect.poll(distance).toBeLessThan(3);
  await expect(page.getByRole('button',{name:'返回最新',exact:true})).toHaveCount(0);
  await page.getByTestId('timeline').locator('[data-row-id]').filter({hasText:'内容 99'}).last().evaluate(el=>(el as HTMLElement).style.paddingBottom='480px');
  await expect.poll(distance).toBeLessThan(3);
  await conversation.hover();await page.mouse.wheel(0,-900);await expect(page.getByRole('button',{name:'返回最新',exact:true})).toHaveCount(1);
  const top=await conversation.evaluate(el=>el.scrollTop);
  const sessionId=session.id;
  const entry=await app.sessions.entry(sessionId);
  const {Journal}=await import('../../src/journal.js');
  await app.sessions.activeFor(session.id)?.done;
  let journal=await Journal.open(entry.directory);await journal.append('web.session',{title:'长回复'});await journal.close();
  await page.waitForTimeout(400);await expect(page.getByRole('button',{name:'返回最新',exact:true})).not.toContainText('有新消息');
  journal=await Journal.open(entry.directory);await journal.append('context.add',{items:[{type:'message',role:'assistant',content:[{type:'output_text',text:'新增消息一'}]}]},{runId:'follow-one',attemptId:'follow-one'});await journal.close();
  await expect(page.getByText('新增消息一',{exact:true})).toBeAttached();await expect(page.getByText('有新消息',{exact:false})).toHaveCount(0);expect(Math.abs(await conversation.evaluate(el=>el.scrollTop)-top)).toBeLessThan(3);
  await conversation.focus();await page.keyboard.press('End');await expect(page.getByText('新增消息一',{exact:true})).toBeInViewport();await expect(page.getByRole('button',{name:'返回最新',exact:true})).toHaveCount(0);
  journal=await Journal.open(entry.directory);await journal.append('context.add',{items:[{type:'message',role:'assistant',content:[{type:'output_text',text:'新增消息二'}]}]},{runId:'follow-two',attemptId:'follow-two'});await journal.close();
  await expect(page.getByText('新增消息二',{exact:true})).toBeInViewport();await expect.poll(distance).toBeLessThan(3);await expect(page.getByRole('button',{name:'返回最新',exact:true})).toHaveCount(0);
 }finally{await app.close();}
});

test('running task allows next draft without submitting it or clearing it at completion',async({page})=>{
 let release!:()=>void,calls=0;const gate=new Promise<void>(r=>release=r);
 const app=await startWeb({workspace:await temporary(),home:await temporary(),apiKey:key,naming:false,staticDir:resolve('dist/web-dist'),runtime:{fetch:async()=>{calls++;await gate;return response([textItem('完成后保留草稿')]);}}});
 try{
  const session=await openSession(page,app);const input=page.getByLabel('任务草稿',{exact:true});await input.fill('第一条');await input.press('Enter');
  await expect(page.getByRole('button',{name:'停止',exact:true})).toBeVisible();await expect(input).toBeFocused();await input.fill('下一条草稿');await input.press('Enter');await expect.poll(()=>calls).toBe(1);
  await appearance(page);await expect(page.getByRole('dialog',{name:'外观',exact:true})).toBeVisible();release();
  await expect(page.getByRole('button',{name:'发送',exact:true,includeHidden:true})).toBeAttached();await expect(input).toHaveJSProperty('textContent', '下一条草稿');await expect(input).not.toBeFocused();
  await page.keyboard.press('Escape');await expect(page.getByText('完成后保留草稿',{exact:true})).toBeVisible();expect(calls).toBe(1);
 }finally{release();await app.close();}
});
