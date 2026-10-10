import {test,expect} from '@playwright/test';
import {mkdir,writeFile,cp,readFile,realpath} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createPatch} from 'diff';
import {startWeb} from '../../src/server/app.js';
import {Journal,readSession} from '../../src/journal.js';
import {temporary,textItem} from '../helpers.js';
import { openDrawerTab } from './fixtures/workbench.js';

async function fixture() {
  const workspace=await temporary(),home=await temporary(),opened:string[]=[];
  await mkdir(join(workspace,'src'));await writeFile(join(workspace,'src/result.ts'),'current file differs\n');await writeFile(join(workspace,'.hidden'),'hidden');
  const root=join(workspace,'.nekomimi/extensions/sakura');await mkdir(root,{recursive:true});await cp(resolve('extension-docs/examples/sakura'),root,{recursive:true});
  const app=await startWeb({workspace,home,naming:false,staticDir:resolve('dist/web-dist'),openFile:async path=>{opened.push(path);},runtime:{fetch:async()=>{throw new Error('History is read only');}}});
  const host=app.sessions.customization,resource=(await host.catalog.discover()).find(item=>item.name==='sakura-studio')!;
  await host.catalog.decide(resource.id,true,true,0);const receipt=host.requestReload();await host.reload(receipt);expect(receipt.status,receipt.error).toBe('activated');
  const session=await app.sessions.create('Rich saved history'),entry=await app.sessions.entry(session.id),journal=await Journal.open(entry.directory);
  const patch=await journal.artifact(createPatch('src/result.ts','const before = 1;\n','const after = 2;\n'));
  await journal.append('context.add',{items:[textItem('## Saved answer\n\n[Documentation](https://example.org/docs)\n\n```typescript\nconst greeting = "hello";\n```\n\n| Key | Value |\n| --- | --- |\n| Result | Saved |\n\n<script>forbidden()</script>\n\n![remote](https://example.org/never-load.png)')]},{attemptId:'saved-attempt'});
  await journal.append('tool.requested',{name:'edit',args:{path:'src/result.ts'}},{runId:'saved-run',toolCallId:'saved-tool'});
  await journal.append('tool.result',{source:'tool:edit',item:{output:[{type:'output_text',text:'Recorded edit complete'}]},details:{path:'src/result.ts',patch}},{runId:'saved-run',toolCallId:'saved-tool'});
  const panel=host.panels.catalog().find(item=>item.id==='moe')!;
  await journal.append('extension.ui',{kind:'panel',title:'Saved panel',resourceId:resource.id,resourceRevision:resource.hash,panelId:'moe',slot:panel.slot,bundleHash:panel.bundleHash,fallback:'Saved fallback',summary:'Saved interactive result',props:{name:'Persisted props'}});
  await journal.close();return {app,workspace,session,opened,entry};
}

test('10.9 rich history and file diff remain readable without legacy styles or replay',async({page})=>{
  const f=await fixture();const writes:string[]=[];page.on('request',req=>{if(req.method()==='POST')writes.push(req.url());});
  try {
    await page.goto(f.app.origin+`/work/session/${f.session.id}#token=`+f.app.token);
    const timeline=page.getByTestId('timeline');await expect(timeline.getByRole('heading',{name:'Saved answer'})).toBeVisible();
    await expect(timeline.getByRole('link',{name:/Documentation/})).toHaveAttribute('rel','noopener noreferrer');
    await expect(timeline.locator('[data-rich-content] pre')).toContainText('const greeting');await expect(timeline.getByRole('table')).toContainText('Saved');
    await expect(timeline.locator('script,img,iframe')).toHaveCount(0);
    await expect(timeline.locator('[class*="syn-c"]').first()).toBeVisible();
    expect(await page.locator('link[rel="stylesheet"]').evaluateAll(nodes=>nodes.map(node=>(node as HTMLLinkElement).href).some(url=>/workbench-|styles-|customization-|runtime-ui-|navigation-/.test(url)))).toBe(false);
    await timeline.getByText('查看工具详情',{exact:true}).click();await expect(timeline).toContainText('Recorded edit complete');
    const diff=timeline.getByRole('region',{name:'文件差异'});await expect(diff).toContainText('const after = 2;');
    await page.getByLabel('任务草稿',{exact:true}).fill('Keep this draft');
    await diff.getByRole('button',{name:'定位文件'}).click();
    await expect(page.getByRole('treeitem',{name:/result.ts/})).toHaveAttribute('aria-selected','true');
    expect(f.opened).toEqual([]);
    await page.getByRole('treeitem',{name:/result.ts/}).dblclick();await expect.poll(()=>f.opened.length).toBe(1);
    expect(f.opened[0]).toBe(await realpath(join(f.workspace,'src/result.ts')));
    await page.getByRole('tab',{name:'变更',exact:true}).click();await expect(page.getByRole('region',{name:'会话文件修改'})).toContainText('const after = 2;');
    await openDrawerTab(page,'文件');await page.getByLabel('显示隐藏文件',{exact:true}).check();await expect(page.getByRole('treeitem',{name:'.hidden',exact:true})).toBeVisible();
    await expect(page.getByLabel('任务草稿',{exact:true})).toHaveJSProperty('textContent','Keep this draft');
    expect(writes.filter(url=>url.endsWith('/submit'))).toHaveLength(0);
    expect(await readFile(join(f.workspace,'src/result.ts'),'utf8')).toBe('current file differs\n');
    await page.setViewportSize({width:360,height:900});await page.emulateMedia({reducedMotion:'reduce'});
    await expect(page.getByLabel('任务草稿',{exact:true})).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  } finally {await f.app.close();}
});

test('10.9 historical panel opens only its saved revision and props, and reload returns to saved text',async({page})=>{
  const f=await fixture();let mounts=0;page.on('request',req=>{if(req.method()==='POST'&&req.url().endsWith('/customization')&&req.postDataJSON().action==='panel-mount')mounts++;});
  try {
    await page.goto(f.app.origin+`/work/session/${f.session.id}#token=`+f.app.token);
    await expect(page.getByText('Saved interactive result',{exact:true})).toBeVisible();await expect(page.locator('iframe')).toHaveCount(0);expect(mounts).toBe(0);
    await page.getByRole('button',{name:'打开互动内容',exact:true}).click();await expect(page.frameLocator('iframe').getByRole('heading',{name:/Persisted props/})).toBeVisible();expect(mounts).toBe(1);
    await page.getByRole('button',{name:'关闭互动内容',exact:true}).click();await expect(page.locator('iframe')).toHaveCount(0);
    await page.reload();await expect(page.getByRole('button',{name:'打开互动内容',exact:true})).toBeEnabled();await expect(page.locator('iframe')).toHaveCount(0);expect(mounts).toBe(1);
    expect((await readSession(f.entry.directory)).events.filter(event=>event.type==='tool.result')).toHaveLength(1);
  } finally {await f.app.close();}
});

test('10.9 explicit HTML and diagnostic exports preserve journal and redact requested text',async({page})=>{
  const f=await fixture();
  try {
    const before=await readFile(join(f.entry.directory,'journal.jsonl'),'utf8');
    await page.goto(f.app.origin+`/work/session/${f.session.id}#token=`+f.app.token);
    await page.getByRole('button', { name:'设置',exact:true }).click();await page.getByRole('menuitem', { name:'导出当前会话',exact:true}).click();
    await page.getByText('隐私与脱敏',{exact:true}).click();
    await page.getByLabel('需要脱敏的文本（每行一项）',{exact:true}).fill('Recorded edit complete');
    await page.route('**/export',route=>route.fulfill({status:503,json:{error:{message:'synthetic export failure'}}}),{times:1});
    await page.getByRole('button',{name:'下载 HTML',exact:true}).click();await expect(page.getByRole('alert')).toContainText('synthetic export failure');
    await expect(page.getByLabel('需要脱敏的文本（每行一项）',{exact:true})).toHaveValue('Recorded edit complete');
    const htmlDownload=page.waitForEvent('download');await page.getByRole('button',{name:'下载 HTML',exact:true}).click();
    const html=await readFile((await (await htmlDownload).path())!,'utf8');
    expect(html).toContain('Saved answer');expect(html).not.toContain('Recorded edit complete');expect(html).not.toMatch(/<script\b|<iframe\b/);expect(html).not.toContain(f.app.token);
    const bundleDownload=page.waitForEvent('download');await page.getByRole('button',{name:'下载诊断包',exact:true}).click();
    const file=(await (await bundleDownload).path())!,entries:string[]=[];
    const {list}=await import('tar');const contents:Record<string,string>={};
    await list({file,onReadEntry:entry=>{entries.push(entry.path);const chunks:Buffer[]=[];entry.on('data',chunk=>chunks.push(Buffer.from(chunk)));entry.on('end',()=>{contents[entry.path]=Buffer.concat(chunks).toString('utf8');});}});
    expect(entries.some(path=>path.split('/').some(part=>part.startsWith('._')))).toBe(false);
    expect(entries.some(path=>/(^|\/)view\.json$/.test(path))).toBe(true);expect(entries.some(path=>/(^|\/)journal\.jsonl$/.test(path))).toBe(false);
    const manifest=JSON.parse(contents[entries.find(path=>/(^|\/)manifest\.json$/.test(path))!]!);expect(manifest).toMatchObject({redacted:true,resumable:false});
    expect(contents[entries.find(path=>/(^|\/)view\.json$/.test(path))!]!).not.toContain('Recorded edit complete');
    await page.getByLabel('需要脱敏的文本（每行一项）',{exact:true}).fill('');
    const fullDownload=page.waitForEvent('download');await page.getByRole('button',{name:'下载诊断包',exact:true}).click();
    const fullFile=(await (await fullDownload).path())!,fullEntries:string[]=[];
    await list({file:fullFile,onReadEntry:entry=>{fullEntries.push(entry.path);expect(entry.uname??'').toBe('');expect(entry.gname??'').toBe('');expect(entry.mtime).toBeUndefined();}});expect(fullEntries.some(path=>/(^|\/)journal\.jsonl$/.test(path))).toBe(true);
    expect(fullEntries.some(path=>path.split('/').some(part=>part.startsWith('._')))).toBe(false);
    expect(await readFile(join(f.entry.directory,'journal.jsonl'),'utf8')).toBe(before);
    await page.getByRole('button',{name:'完成',exact:true}).click();await expect(page.getByRole('button', { name:'设置',exact:true })).toBeFocused();
    await page.getByRole('button', { name:'设置',exact:true }).click();await page.getByRole('menuitem', { name:'导出当前会话',exact:true}).click();await page.getByText('隐私与脱敏',{exact:true}).click();await expect(page.getByLabel('需要脱敏的文本（每行一项）',{exact:true})).toHaveValue('');
  } finally {await f.app.close();}
});
