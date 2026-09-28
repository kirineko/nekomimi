import {test,expect} from '@playwright/test';
import {resolve} from 'node:path';
import {startWeb} from '../../src/server/app.js';
import {temporary,key,response,textItem} from '../helpers.js';

async function server(){return startWeb({workspace:await temporary(),home:await temporary(),apiKey:key,naming:false,staticDir:resolve('dist/web-dist'),runtime:{fetch:async()=>response([textItem('任务完成')])}});}
test('optional features load on demand, cancel delayed load, retry network failure and keep draft',async({page})=>{
 const app=await server();const scripts:string[]=[];page.on('request',r=>{if(r.url().endsWith('.js'))scripts.push(r.url());});
 try{
  await page.goto(app.url);const input=page.getByRole('textbox',{name:'任务内容'});await input.fill('保留草稿');
  expect(scripts.some(s=>/\/(Customization|FileBrowser|Changes|Inspector|ExportDialog)-/.test(s))).toBe(false);
  let release!:()=>void;const gate=new Promise<void>(r=>release=r);
  await page.route('**/Customization-*.js',async route=>{await gate;await route.continue();},{times:1});
  await page.getByRole('button',{name:'定制能力',exact:true}).click();
  await expect(page.getByRole('status')).toContainText('正在准备');await page.getByRole('button',{name:'关闭定制能力'}).click();
  release();await expect(page.getByRole('button',{name:'定制能力',exact:true})).toBeFocused();
  await page.getByRole('button',{name:'定制能力',exact:true}).click();await expect(page.getByRole('tab',{name:/我的定制/})).toBeVisible();await page.keyboard.press('Escape');await expect(input).toHaveValue('保留草稿');
  await page.route('**/FileBrowser-*.js',route=>route.abort(),{times:1});
  await page.getByRole('button',{name:'打开工作区面板'}).click();await expect(page.getByRole('alert')).toContainText('暂时无法打开');
  await page.getByRole('button',{name:'重试加载'}).click();await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.locator('.file-browser')).toBeVisible();await expect(page.getByRole('alert')).toHaveCount(0);
  await page.getByRole('tab',{name:'变更',exact:true}).click();await expect(page.getByRole('tabpanel')).toContainText('暂无已确认的文件修改');
  await page.getByRole('button',{name:'关闭工作区面板'}).click();await input.fill('测试调用');await input.press('Enter');
  await expect(page.getByText('任务完成',{exact:true})).toBeVisible();await page.getByRole('button',{name:'检查调用'}).first().click();
  await expect(page.locator('.inspector')).toBeVisible();await page.getByRole('button',{name:'关闭工作区面板'}).click();
  await page.getByRole('button',{name:'更多操作'}).click();await page.getByRole('button',{name:'导出',exact:true}).click();await expect(page.getByRole('button',{name:'下载 HTML'})).toBeVisible();await page.keyboard.press('Escape');
  for(const name of ['Customization','FileBrowser','Changes','Inspector','ExportDialog'])expect(scripts.some(s=>s.includes('/'+name+'-'))).toBe(true);
 }finally{await app.close();}
});

test('submit restores focus for mouse and keyboard and failure retains draft',async({page})=>{
 const app=await server();try{
  await page.goto(app.url);const input=page.getByRole('textbox',{name:'任务内容'});
  await input.fill('鼠标提交');await page.getByRole('button',{name:'发送任务'}).click();await expect(input).toBeFocused();await expect(input).toHaveValue('');
  await expect(page.getByText('任务完成',{exact:true})).toHaveCount(1);await app.sessions.active?.done;
  await expect(page.getByRole('button',{name:'发送任务'})).toBeVisible();await input.fill('键盘提交');await input.press('Enter');await expect(input).toBeFocused();await expect(input).toHaveValue('');
  await expect(page.getByRole('button',{name:'发送任务'})).toBeVisible();
  await expect(page.getByText('任务完成',{exact:true})).toHaveCount(2);await app.sessions.active?.done;
  await expect(page.getByRole('button',{name:'发送任务'})).toBeVisible();
  await page.route('**/submit',r=>r.fulfill({status:503,json:{error:{message:'稍后重试'}}}),{times:1});
  await input.fill('失败草稿');await page.getByRole('button',{name:'发送任务'}).click();await expect(input).toBeEnabled();await expect(input).toBeFocused();await expect(input).toHaveValue('失败草稿');
  await input.press('Shift+Enter');await expect(input).toHaveValue('失败草稿\n');
 }finally{await app.close();}
});

test('late submit never steals focus or clears a new context draft',async({page})=>{
 const app=await server();try{
  await page.goto(app.url);const input=page.getByRole('textbox',{name:'任务内容'});
  await input.fill('建立会话');await input.press('Enter');await expect(page.getByText('任务完成',{exact:true})).toBeVisible();
  for(const target of ['modal','tab','session','blur']){
   let release!:()=>void;const gate=new Promise<void>(r=>release=r);
   await page.route('**/submit',async route=>{await gate;await route.fulfill({status:503,json:{error:{message:'延迟失败'}}});},{times:1});
   await input.fill('等待 '+target);await page.getByRole('button',{name:'发送任务'}).click();await expect(input).toBeDisabled();
   if(target==='modal'){await page.getByRole('button',{name:'定制能力',exact:true}).click();await page.getByRole('tab',{name:/我的定制/}).waitFor();}
   if(target==='tab'){await page.getByRole('button',{name:'定制能力',exact:true}).focus();await page.keyboard.press('Tab');}
   if(target==='session')await page.getByRole('button',{name:/新建会话/}).click();
   if(target==='blur')await page.evaluate(()=>window.dispatchEvent(new Event('blur')));
   release();await expect(input).toBeEnabled();await expect(input).not.toBeFocused();await expect(input).toHaveValue('等待 '+target);
   if(target==='modal')await page.keyboard.press('Escape');
  }
 }finally{await app.close();}
});

test('latest follows new messages and delayed layout, while deliberate history reading stays anchored',async({page})=>{
 const app=await startWeb({workspace:await temporary(),home:await temporary(),apiKey:key,naming:false,staticDir:resolve('dist/web-dist'),runtime:{fetch:async()=>response([textItem(Array.from({length:100},(_,i)=>`内容 ${i}\n\n`).join(''))])}});
 try{
  await page.goto(app.url);await page.getByRole('textbox',{name:'任务内容'}).fill('长回复');await page.getByRole('button',{name:'发送任务'}).click();
  const conversation=page.locator('.conversation');
  const distance=()=>conversation.evaluate(el=>el.scrollHeight-el.clientHeight-el.scrollTop);
  await expect(page.getByText('内容 99',{exact:true})).toBeVisible();await expect.poll(distance).toBeLessThan(3);
  await expect(page.locator('.history-latest')).toHaveCount(0);
  await page.locator('.row-assistant').last().evaluate(el=>(el as HTMLElement).style.paddingBottom='480px');
  await expect.poll(distance).toBeLessThan(3);
  await conversation.hover();await page.mouse.wheel(0,-900);await expect(page.locator('.history-latest')).toHaveCount(1);
  const top=await conversation.evaluate(el=>el.scrollTop);
  const sessionId=new URL(page.url()).searchParams.get('session')!;
  const entry=await app.sessions.entry(sessionId);
  const {Journal}=await import('../../src/journal.js');
  await app.sessions.active?.done;
  let journal=await Journal.open(entry.directory);await journal.append('web.session',{title:'长回复'});await journal.close();
  await page.waitForTimeout(400);await expect(page.locator('.history-latest')).not.toContainText('有新消息');
  journal=await Journal.open(entry.directory);await journal.append('context.add',{items:[{type:'message',role:'assistant',content:[{type:'output_text',text:'新增消息一'}]}]},{runId:'follow-one',attemptId:'follow-one'});await journal.close();
  await expect(page.locator('.history-latest')).toContainText('有新消息');expect(Math.abs(await conversation.evaluate(el=>el.scrollTop)-top)).toBeLessThan(3);
  await page.locator('.history-latest').click();await expect(page.getByText('新增消息一',{exact:true})).toBeInViewport();await expect(page.locator('.history-latest')).toHaveCount(0);
  journal=await Journal.open(entry.directory);await journal.append('context.add',{items:[{type:'message',role:'assistant',content:[{type:'output_text',text:'新增消息二'}]}]},{runId:'follow-two',attemptId:'follow-two'});await journal.close();
  await expect(page.getByText('新增消息二',{exact:true})).toBeInViewport();await expect.poll(distance).toBeLessThan(3);await expect(page.locator('.history-latest')).toHaveCount(0);
 }finally{await app.close();}
});

test('running task allows next draft without submitting it or clearing it at completion',async({page})=>{
 let release!:()=>void,calls=0;const gate=new Promise<void>(r=>release=r);
 const app=await startWeb({workspace:await temporary(),home:await temporary(),apiKey:key,naming:false,staticDir:resolve('dist/web-dist'),runtime:{fetch:async()=>{calls++;await gate;return response([textItem('完成后保留草稿')]);}}});
 try{
  await page.goto(app.url);const input=page.getByRole('textbox',{name:'任务内容'});await input.fill('第一条');await input.press('Enter');
  await expect(page.getByRole('button',{name:'停止任务'})).toBeVisible();await expect(input).toBeFocused();await input.fill('下一条草稿');await input.press('Enter');await expect.poll(()=>calls).toBe(1);
  await page.getByRole('button',{name:'定制能力',exact:true}).click();await page.getByRole('tab',{name:/我的定制/}).waitFor();release();
  await expect(page.getByRole('button',{name:'发送任务'})).toBeAttached();await expect(input).toHaveValue('下一条草稿');await expect(input).not.toBeFocused();
  await page.keyboard.press('Escape');await expect(page.getByText('完成后保留草稿',{exact:true})).toBeVisible();expect(calls).toBe(1);
 }finally{release();await app.close();}
});
