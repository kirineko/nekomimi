import { test, expect, type Page } from '@playwright/test';
import { mkdir, writeFile, symlink } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { startWeb } from '../../src/server/app.js';
import { temporary, key, response, textItem, callItem } from '../helpers.js';
const mime='application/x-nekomimi-references+json';
async function fixture(page: Page) {
  const workspace=await temporary(),home=await temporary();
  await mkdir(join(workspace,'src'));await mkdir(join(workspace,'my docs'));
  await writeFile(join(workspace,'src','main.ts'),'export const answer = 42;');
  await writeFile(join(workspace,'my docs','中文 "note".md'),'notes');
  await writeFile(join(workspace,'.hidden'),'hidden');
  const requests:any[]=[];
  const app=await startWeb({workspace,home,apiKey:key,naming:false,staticDir:resolve('dist/web-dist'),runtime:{fetch:async(_url,init)=>{
    const body=JSON.parse(String(init?.body));requests.push(body);
    return response(requests.length===1?[callItem('read',{path:'src/main.ts'})]:[textItem('已读取引用文件')]);
  }}});
  await page.goto(app.url);await expect(page.getByText('已连接',{exact:true})).toBeVisible();
  const input=page.getByRole('textbox',{name:'任务内容'});
  return {app,workspace,input,requests};
}
test('reference chips choose files and whole directories, drill, edit and send path-only context',async({page})=>{
  const f=await fixture(page);const submissions:{url:string;body:any}[]=[];
  page.on('request',r=>{if(r.url().endsWith('/submit'))submissions.push({url:r.url(),body:r.postDataJSON()});});
  try {
    await f.input.fill('查看 @src');
    await expect(page.getByRole('option',{name:'src/ 目录 src',exact:true})).toBeVisible();
    await f.input.press('ArrowRight');await expect(f.input).toHaveJSProperty('textContent','查看 @src/');await expect(page.getByRole('option',{name:/main.ts/})).toBeVisible();
    await f.input.press('Enter');await expect(page.locator('.reference-chip')).toHaveCount(1);
    await expect(page.locator('.reference-chip')).toHaveAttribute('data-path','src/main.ts');
    await f.input.pressSequentially('以及 @src');await expect(page.getByRole('option',{name:'src/ 目录 src',exact:true})).toBeVisible();await f.input.press('Enter');
    await expect(page.locator('.reference-chip')).toHaveCount(2);
    await expect(page.locator('.reference-chip').last()).toHaveAttribute('aria-label','目录 src');
    expect(f.requests).toHaveLength(0);
    await f.input.press('Enter');await expect(page.getByText('已读取引用文件',{exact:true})).toBeVisible();
    expect(f.requests).toHaveLength(2);
    expect(JSON.stringify(f.requests[0])).toContain('@src/main.ts');expect(JSON.stringify(f.requests[0])).toContain('@src/');
    expect(JSON.stringify(f.requests[0])).not.toContain('export const answer = 42');
    expect(JSON.stringify(f.requests[1])).toContain('export const answer = 42');
    const duplicate=await page.evaluate(async request=>{const send=(body:unknown)=>fetch(request.url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});return {same:(await send(request.body)).status,changed:(await send({...request.body,prompt:request.body.prompt+' changed'})).status};},submissions[0]!);
    expect(duplicate.same).toBe(202);expect(duplicate.changed).toBe(409);expect(f.requests).toHaveLength(2);
    await page.reload();await expect(page.getByText('已读取引用文件',{exact:true})).toBeVisible();expect(f.requests).toHaveLength(2);
  }finally{await f.app.close();}
});
test('clipboard preserves special paths, atomic deletion, undo and untrusted paste fallback',async({page})=>{
  const f=await fixture(page);
  try {
    await f.input.fill('@"my docs/');await expect(page.getByRole('option',{name:/note/})).toBeVisible();await f.input.press('Enter');
    await expect(page.locator('.reference-chip')).toHaveCount(1);
    await f.input.press('ControlOrMeta+a');
    const clip=await f.input.evaluate((el,mime)=>{const data=new DataTransfer();el.dispatchEvent(new ClipboardEvent('copy',{clipboardData:data,bubbles:true,cancelable:true}));return {text:data.getData('text/plain'),raw:data.getData(mime)};},mime);
    expect(clip.text).toBe('@"my docs/中文 \\"note\\".md" '.replaceAll('\\\\','\\'));
    await f.input.press('Backspace');await expect(page.locator('.reference-chip')).toHaveCount(0);
    await f.input.press('ControlOrMeta+z');await expect(page.locator('.reference-chip')).toHaveCount(1);
    await f.input.press('ControlOrMeta+a');
    await f.input.evaluate((el,{clip,mime})=>{const data=new DataTransfer();data.setData('text/plain',clip.text);data.setData(mime,clip.raw);el.dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));},{clip,mime});
    await expect(page.locator('.reference-chip')).toHaveCount(1);
    await f.input.press('End');await f.input.pressSequentially(' 后面');
    await page.getByRole('button',{name:/移除引用/}).click();await expect(page.locator('.reference-chip')).toHaveCount(0);await expect(f.input).toContainText('后面');
    await f.input.press('ControlOrMeta+z');await expect(page.locator('.reference-chip')).toHaveCount(1);
    await f.input.press('ControlOrMeta+a');
    await f.input.evaluate((el,mime)=>{const d=new DataTransfer();d.setData('text/plain','@../outside');d.setData('text/html','<img src=x onerror=alert(1)>');d.setData(mime,JSON.stringify({version:1,segments:[{type:'reference',path:'../outside',kind:'file'}]}));el.dispatchEvent(new ClipboardEvent('paste',{clipboardData:d,bubbles:true,cancelable:true}));},mime);
    await expect(f.input).toHaveJSProperty('textContent','@../outside');await expect(page.getByText('无法恢复引用块，已保留纯文本。')).toBeVisible();await expect(f.input.locator('img')).toHaveCount(0);
  }finally{await f.app.close();}
});
test('query cancellation, IME, errors and responsive chips preserve the draft',async({page},info)=>{
  const f=await fixture(page);let release=()=>{};
  try {
    await f.input.fill('mail@example.com');await expect(page.getByRole('listbox',{name:'文件与目录'})).toHaveCount(0);
    await f.input.fill('`@src`');await expect(page.getByRole('listbox',{name:'文件与目录'})).toHaveCount(0);
    await f.input.fill('@src');await f.input.dispatchEvent('compositionstart');await f.input.dispatchEvent('keydown',{key:'Enter',isComposing:true,keyCode:229});expect(f.requests).toHaveLength(0);await expect(f.input).toHaveJSProperty('textContent','@src');await f.input.dispatchEvent('compositionend');await page.waitForTimeout(80);
    await expect(page.getByRole('option',{name:'src/ 目录 src',exact:true})).toBeVisible();await f.input.press('Enter');
    await page.route('**/submit',r=>r.fulfill({status:503,json:{error:{message:'重试任务'}}}),{times:1});
    await page.getByRole('button',{name:'发送任务'}).click();await expect(page.getByText(/重试任务/)).toBeVisible();await expect(page.locator('.reference-chip')).toHaveCount(1);await expect(f.input).toBeFocused();
    for(const width of [390,900]) {await page.setViewportSize({width,height:800});await page.evaluate(()=>document.documentElement.style.fontSize='20px');await expect(page.getByRole('button',{name:'发送任务'})).toBeInViewport();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:info.outputPath(`references-${width}.png`)});}
    const gate=new Promise<void>(r=>{release=r;});
    await page.route('**/workspace/references?query=slow',async r=>{await gate;await r.fulfill({json:{entries:[{path:'slow',name:'slow',kind:'file'}],revision:'old',limited:false}});});
    await f.input.fill('@slow');await page.waitForTimeout(200);await f.input.fill('@src');await expect(page.getByRole('option',{name:'src/ 目录 src',exact:true})).toBeVisible();release();await page.waitForTimeout(100);await expect(page.getByRole('option',{name:/slow/})).toHaveCount(0);
    await f.input.press('Escape');await expect(page.getByRole('listbox',{name:'文件与目录'})).toHaveCount(0);
  }finally{release();await f.app.close();}
});
test('reference APIs authenticate, bound directories and reject external symlinks',async({page})=>{
  const f=await fixture(page);
  try {
    const outside=await temporary();await symlink(outside,join(f.workspace,'outside'));
    const unauthorized=await fetch(f.app.origin+'/api/v1/workspace/references?query=src');expect(unauthorized.status).toBe(401);
    const originDenied=await fetch(f.app.origin+'/api/v1/workspace/references?query=src',{headers:{authorization:`Bearer ${f.app.token}`,origin:'https://example.invalid'}});expect(originDenied.status).toBe(403);
    for(const path of ['../secret','outside','/tmp']) {
      const status=await page.evaluate(async path=>(await fetch('/api/v1/workspace/references?mode=resolve&path='+encodeURIComponent(path))).status,path);expect(status).toBeGreaterThanOrEqual(400);
    }
    for(let i=0;i<25;i++)await writeFile(join(f.workspace,'src',`extra-${i}.txt`),'x');
    await f.input.fill('@src/');await expect(page.getByRole('option')).toHaveCount(20);await page.getByRole('button',{name:'加载更多路径'}).click();await expect(page.getByRole('option')).toHaveCount(26);
    expect(f.requests).toHaveLength(0);
  }finally{await f.app.close();}
});

test('native composition, adjacent chip deletion and cancelled selection preserve editing',async({page})=>{
  const f=await fixture(page);let release=()=>{};
  try {
    const cdp=await page.context().newCDPSession(page);
    await f.input.fill('请 ');
    await cdp.send('Input.imeSetComposition',{text:'zhong',selectionStart:5,selectionEnd:5});
    await cdp.send('Input.imeSetComposition',{text:'中文',selectionStart:2,selectionEnd:2});
    await cdp.send('Input.insertText',{text:'中文'});
    await expect(f.input).toHaveJSProperty('textContent','请 中文');expect(f.requests).toHaveLength(0);
    await f.input.press('ControlOrMeta+z');await expect(f.input).toHaveJSProperty('textContent','请 ');
    await f.input.pressSequentially('@src');await expect(page.getByRole('option',{name:'src/ 目录 src',exact:true})).toBeVisible();await f.input.press('Enter');
    await expect(page.locator('.reference-chip')).toHaveCount(1);
    await f.input.press('Backspace');await f.input.press('Backspace');await expect(page.locator('.reference-chip')).toHaveCount(0);await expect(f.input).toHaveJSProperty('textContent','请 ');
    await f.input.press('ControlOrMeta+z');await expect(page.locator('.reference-chip')).toHaveCount(1);
    await f.input.fill('@src');await expect(page.getByRole('option',{name:'src/ 目录 src',exact:true})).toBeVisible();
    const gate=new Promise<void>(r=>{release=r;});
    await page.route('**/workspace/references?mode=resolve&path=src',async route=>{await gate;await route.fallback();},{times:1});
    await f.input.press('Enter');await f.input.press('Escape');release();await page.waitForTimeout(200);
    await expect(page.locator('.reference-chip')).toHaveCount(0);await expect(f.input).toHaveJSProperty('textContent','@src');
  }finally{release();await f.app.close();}
});

test('large workspace discovery is bounded and input stays responsive during lookup',async({page},info)=>{
  const f=await fixture(page);
  try {
    for(let d=0;d<10;d++) {await mkdir(join(f.workspace,`bench-${d}`));await Promise.all(Array.from({length:500},(_,i)=>writeFile(join(f.workspace,`bench-${d}`,`record-${i}.txt`),'fixture')));}
    const sample=await page.evaluate(async()=>{
      const measure=async(refresh:boolean)=>{const start=performance.now();const response=await fetch('/api/v1/workspace/references?query=record-499'+(refresh?'&refresh=true':''));return {duration:performance.now()-start,page:await response.json()};};
      return {cold:await measure(true),warm:await measure(false)};
    });
    expect(sample.cold.page.entries.length).toBeLessThanOrEqual(20);expect(sample.warm.page.entries.length).toBeGreaterThan(0);
    await f.input.fill('@record');const start=Date.now();await f.input.pressSequentially(' more typing');const inputMs=Date.now()-start;
    await expect(f.input).toHaveJSProperty('textContent','@record more typing');
    console.log(JSON.stringify({referenceSearch:sample,inputMs,browser:page.context().browser()?.version()}));
    await info.attach('reference-search-performance',{body:JSON.stringify({entries:5000,coldMs:sample.cold.duration,warmMs:sample.warm.duration,inputMs,browser:page.context().browser()?.version(),viewport:page.viewportSize()}),contentType:'application/json'});
  }finally{await f.app.close();}
});

test('long mixed references and candidate controls fit a keyboard-sized viewport',async({page},info)=>{
  const f=await fixture(page);
  try {
    const name='长名称-'+ 'segment-'.repeat(20)+'.txt';await writeFile(join(f.workspace,name),'fixture');
    await page.setViewportSize({width:390,height:480});await page.evaluate(()=>document.documentElement.style.fontSize='20px');
    await f.input.fill('@长名称');await expect(page.getByRole('option',{name:new RegExp(name)})).toBeVisible();await f.input.press('Enter');await expect(page.locator('.reference-chip')).toHaveCount(1);
    await f.input.pressSequentially(' @src');await expect(page.getByRole('option',{name:'src/ 目录 src',exact:true})).toBeVisible();
    await expect(page.getByRole('button',{name:'发送任务'})).toBeInViewport();
    const popup=await page.locator('.reference-popup').boundingBox();expect(popup!.y).toBeGreaterThanOrEqual(0);expect(popup!.x+popup!.width).toBeLessThanOrEqual(390);
    await page.screenshot({path:info.outputPath('references-long-narrow.png')});
    await f.input.press('Enter');await expect(page.locator('.reference-chip')).toHaveCount(2);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.getByRole('button',{name:`移除引用 ${name}`,exact:true}).focus();await page.keyboard.press('Enter');await expect(page.locator('.reference-chip')).toHaveCount(1);
  }finally{await f.app.close();}
});

test('removing a chip after native IME insertion preserves adjacent prose and undo',async({page})=>{
  const f=await fixture(page);
  try {
    await f.input.fill('前文 @src');await expect(page.getByRole('option',{name:'src/ 目录 src',exact:true})).toBeVisible();await f.input.press('Enter');
    await expect(page.locator('.reference-chip')).toHaveCount(1);await f.input.pressSequentially('后文');
    await f.input.evaluate(el=>{const range=document.createRange();range.setStart(el.firstChild!,3);range.collapse(true);const selection=window.getSelection()!;selection.removeAllRanges();selection.addRange(range);});
    const cdp=await page.context().newCDPSession(page);
    await cdp.send('Input.imeSetComposition',{text:'新增中文',selectionStart:4,selectionEnd:4});
    await cdp.send('Input.insertText',{text:'新增中文'});
    await expect(f.input).toContainText('前文 新增中文');
    await page.getByRole('button',{name:'移除引用 src',exact:true}).click();
    await expect(page.locator('.reference-chip')).toHaveCount(0);await expect(f.input).toHaveJSProperty('textContent','前文 新增中文 后文');
    await f.input.press('ControlOrMeta+z');await expect(page.locator('.reference-chip')).toHaveCount(1);await expect(f.input).toContainText('前文 新增中文');await expect(f.input).toContainText('后文');
    await f.input.press('ControlOrMeta+Shift+z');await expect(f.input).toHaveJSProperty('textContent','前文 新增中文 后文');
  }finally{await f.app.close();}
});

test('late clipboard validation cannot replace active native IME input',async({page})=>{
  const f=await fixture(page);let release=()=>{};
  try {
    const gate=new Promise<void>(r=>{release=r;});let started=()=>{};const requested=new Promise<void>(r=>{started=r;});
    await page.route('**/workspace/references?mode=resolve&path=src',async route=>{started();await gate;await route.fulfill({json:{path:'src',name:'src',kind:'directory'}});});
    await f.input.fill('前文 ');
    await f.input.evaluate((el,mime)=>{const data=new DataTransfer();data.setData('text/plain','@src/ ');data.setData(mime,JSON.stringify({version:1,segments:[{type:'reference',path:'src',kind:'directory'},{type:'text',text:' '}]}));el.dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));},mime);
    await requested;
    const cdp=await page.context().newCDPSession(page);
    await cdp.send('Input.imeSetComposition',{text:'中文',selectionStart:2,selectionEnd:2});
    await expect(f.input).toHaveJSProperty('textContent','前文 @src/ 中文');
    release();await page.waitForTimeout(200);
    await expect(f.input).toHaveJSProperty('textContent','前文 @src/ 中文');await expect(page.locator('.reference-chip')).toHaveCount(0);
    await cdp.send('Input.insertText',{text:'中文'});
    await expect(f.input).toHaveJSProperty('textContent','前文 @src/ 中文');
    await expect(page.getByText('无法恢复引用块，已保留纯文本。')).toHaveCount(0);
    await f.input.press('ControlOrMeta+z');await expect(f.input).toHaveJSProperty('textContent','前文 @src/ ');
    await f.input.press('ControlOrMeta+z');await expect(f.input).toHaveJSProperty('textContent','前文 ');
    expect(f.requests).toHaveLength(0);
  }finally{release();await f.app.close();}
});
