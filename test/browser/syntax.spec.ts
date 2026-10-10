import {test,expect} from '@playwright/test';
import {startWeb} from '../../src/server/app.js';
import {temporary,key,response,textItem,callItem,events,encode,delay} from '../helpers.js';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import { createTask } from './fixtures/workbench.js';
let app:Awaited<ReturnType<typeof startWeb>>;
test.afterEach(async()=>{await app?.close();});
const code='/*\ncomment\n*/\nconst greeting: string = "cat";\n';
test('production CSP highlights Markdown and historical diff; exported HTML works offline',async({page,context},info)=>{
  let calls=0;
  app=await startWeb({workspace:await temporary(),home:await temporary(),naming:false,apiKey:key,staticDir:resolve('dist/web-dist'),runtime:{fetch:async()=>++calls===1?response([callItem('write',{path:'example.ts',content:code})]):response([textItem('```ts\n'+code+'```\n\n```diff-ts\n@@ -1 +1 @@\n-const x = 1;\n+const x = "cat";\n```\n\n```unknown\n<script>window.hacked=true</script>\n```')])}});
  const errors:string[]=[];const requests:string[]=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>requests.push(r.url()));
  await page.addInitScript(()=>{Object.defineProperty(navigator,'clipboard',{value:{writeText:async(text:string)=>{(window as any).copiedDiff=text;}}});(window as any).syntaxJobs=0;const send=Worker.prototype.postMessage;Worker.prototype.postMessage=function(...args:any[]){if(args[0]?.language)(window as any).syntaxJobs++;return (send as any).apply(this,args);};(window as any).violations=[];document.addEventListener('securitypolicyviolation',e=>(window as any).violations.push(e.violatedDirective));});
  const session=await app.sessions.create('语法高亮验收');
  await page.goto(`${app.origin}/work/session/${session.id}#token=${app.token}`);
  await expect(page.getByRole('heading',{name:'语法高亮验收',exact:true})).toBeVisible();
  await page.getByRole('textbox',{name:'任务草稿'}).fill('write code');
  await page.getByRole('button',{name:'发送',exact:true}).click();
  await expect(page.locator('[data-rich-content] pre').first().locator('[class*="syn-c"]').first()).toBeVisible({timeout:15000});
  await expect(page.locator('[data-change-kind="add"] [class*="syn-c"]').first()).toBeVisible({timeout:15000});
  await expect(page.locator('[data-rich-content] .syn-add').first()).toBeVisible();
  const copy=page.getByRole('button',{name:'复制这段',exact:true});
  await copy.focus();await copy.press('Enter');
  await expect.poll(()=>page.evaluate(()=>(window as any).copiedDiff)).toBe(' @@ -1,0 +1,4 @@\n+'+code.trimEnd().replace(/\n/g,'\n+'));
  await page.getByRole('button',{name:'查看文件 diff',exact:false}).click();
  await expect(page.locator('[data-change-kind="add"] [class*="syn-c"]').first()).toBeVisible();
  await page.getByRole('button',{name:'收起差异',exact:true}).click();
  const color=await page.locator('[data-rich-content] pre').first().locator('[class*="syn-c"]').first().evaluate(e=>getComputedStyle(e).color);
  expect(color).not.toBe('rgb(68, 61, 81)');
  const webColors=await page.locator('[data-rich-content] [class*="syn-c"]').evaluateAll(nodes=>Object.fromEntries(nodes.map(node=>[node.className,getComputedStyle(node).color])));
  expect(await page.evaluate(()=>(window as any).violations)).toEqual([]);
  expect(requests.some(u=>u.includes('syntax-worker-'))).toBe(true);
  expect(requests.some(u=>u.includes('/typescript-'))).toBe(true);
  expect(requests.filter(u=>!u.startsWith(new URL(app.url).origin))).toEqual([]);
  const jobs=await page.evaluate(()=>(window as any).syntaxJobs);
  const cacheStart=Date.now();
  // Repeat the saved code in this syntax scope: a new message must reuse the
  // bounded cache, and unrelated conversation updates must not retokenize it.
  await page.getByRole('textbox',{name:'任务草稿'}).fill('repeat code');
  await page.getByRole('button',{name:'发送',exact:true}).click();
  await expect(page.locator('[data-row-kind="assistant"]')).toHaveCount(2);
  await expect(page.locator('[data-row-kind="assistant"]').last().locator('[class*="syn-c"]').first()).toBeVisible();
  expect(await page.evaluate(()=>(window as any).syntaxJobs)).toBe(jobs);
  console.log(JSON.stringify({browser:info.project.name,cacheViewMs:Date.now()-cacheStart,workerJobs:jobs}));
  await page.setViewportSize({width:390,height:844});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:info.outputPath('syntax-narrow.png'),fullPage:true});
  await page.setViewportSize({width:1440,height:1000});
  await page.screenshot({path:info.outputPath('syntax-wide.png'),fullPage:true});
  await page.reload();
  await expect(page.locator('[data-row-kind="assistant"]')).toHaveCount(2);
  await expect(page.locator('[data-rich-content] [class*="syn-c"]').first()).toBeVisible();
  expect(calls).toBe(3); // Reload rebuilds saved presentation without executing.
  await page.getByRole('button',{name:'设置',exact:true}).click();
  await page.getByRole('menuitem',{name:'导出当前会话',exact:true}).click();
  const downloaded=page.waitForEvent('download');
  await page.getByRole('button',{name:'下载 HTML'}).click();
  const download=await downloaded;const path=info.outputPath('session.html');await download.saveAs(path);
  const html=await readFile(path,'utf8');expect(html).toContain('syn-c');expect(html).not.toContain('<script>');
  const offline=await context.newPage();const remote:string[]=[];offline.on('request',r=>{if(/^https?:/.test(r.url()))remote.push(r.url());});
  // WebKit's offline emulation also rejects file://; deny every HTTP request instead.
  await offline.route(/^https?:/,route=>route.abort());
  if(info.project.name!=='webkit')await context.setOffline(true);
  await offline.goto(pathToFileURL(path).href);
  await expect(offline.locator('.markdown .syntax [class*="syn-c"]').first()).toBeVisible();
  expect(await offline.locator('.markdown pre').first().locator('[class*="syn-c"]').first().evaluate(e=>getComputedStyle(e).color)).toBe(color);
  const offlineColors=await offline.locator('.markdown [class*="syn-c"]').evaluateAll(nodes=>Object.fromEntries(nodes.map(node=>[node.className,getComputedStyle(node).color])));
  for(const [token,value] of Object.entries(webColors))expect(offlineColors[token]).toBe(value);
  await expect(offline.locator('code.syntax [class*="syn-c"]').first()).toBeVisible();
  expect(remote).toEqual([]);expect(await offline.evaluate(()=>(window as any).hacked)).toBeUndefined();expect(errors).toEqual([]);
});
test('streaming code stays interactive and stale highlighting cannot cross sessions',async({page},info)=>{
  const source100='const value: string = "hello"; // comment\n'.repeat(100);
  const source1000='const value: string = "hello"; // comment\n'.repeat(1000);
  const huge='x'.repeat(262145);
  const text='```ts\n'+source100+'```\n\n```ts\n'+source1000+'```\n\n```ts\n'+huge+'\n```';
  app=await startWeb({workspace:await temporary(),home:await temporary(),naming:false,apiKey:key,staticDir:resolve('dist/web-dist'),runtime:{fetch:async()=>{
    const all=events([textItem(text)]);const deltaIndex=all.findIndex(e=>e.type==='response.output_text.delta');
    return new Response(new ReadableStream({async start(controller){
      try {
        for(const e of all.slice(0,deltaIndex))controller.enqueue(new TextEncoder().encode(encode([e])));
        for(let offset=0;offset<text.length;offset+=5000){controller.enqueue(new TextEncoder().encode(encode([{...all[deltaIndex],delta:text.slice(offset,offset+5000)}])));await delay(25);}
        await delay(300);
        for(const e of all.slice(deltaIndex+1))controller.enqueue(new TextEncoder().encode(encode([e])));
        controller.close();
      }catch{}
    }}),{headers:{'content-type':'text/event-stream'}});
  }}});
  const session=await app.sessions.create('语法高亮验收');
  await page.goto(`${app.origin}/work/session/${session.id}#token=${app.token}`);
  await expect(page.getByRole('heading',{name:'语法高亮验收',exact:true})).toBeVisible();await page.getByRole('textbox',{name:'任务草稿'}).fill('stream');await page.getByRole('button',{name:'发送',exact:true}).click();
  const started=Date.now();
  await expect(page.locator('[data-rich-content] pre').first().locator('[class*="syn-c"]').first()).toBeVisible({timeout:15000});
  const firstMs=Date.now()-started;
  const inputStart=Date.now();await page.getByRole('textbox',{name:'任务草稿'}).fill('still responsive');const inputMs=Date.now()-inputStart;
  await expect(page.locator('[data-rich-content] pre').nth(1).locator('[class*="syn-c"]').first()).toBeVisible({timeout:15000});
  await expect(page.getByText('已完成',{exact:true}).first()).toBeVisible();
  await expect(page.locator('[data-rich-content] pre').nth(2).locator('[class*="syn-c"]')).toHaveCount(0);
  console.log(JSON.stringify({browser:info.project.name,first100LinesMs:firstMs,inputFillDuringStreamMs:inputMs}));
  await createTask(page);
  await expect(page.locator('[data-rich-content]')).toHaveCount(0);
  await page.waitForTimeout(1200);await expect(page.locator('[data-rich-content]')).toHaveCount(0);
  await page.getByRole('textbox',{name:'任务草稿'}).fill('cancel stream');
  await page.getByRole('button',{name:'发送',exact:true}).click();
  await expect(page.locator('[data-rich-content] pre').first().locator('[class*="syn-c"]').first()).toBeVisible();
  await page.getByRole('button',{name:'停止',exact:true}).click();
  await expect(page.getByText('已停止',{exact:true}).first()).toBeVisible();
  await createTask(page);
  await page.waitForTimeout(1200);await expect(page.locator('[data-rich-content]')).toHaveCount(0);
});
