import {chromium,expect} from '@playwright/test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const [installation,output]=process.argv.slice(2),root=join(resolve(installation),'node_modules/nekomimi');
const {startWeb,Journal}=await import(pathToFileURL(join(root,'dist/index.js')).href);
const {Candidates}=await import(pathToFileURL(join(root,'dist/customization/candidates.js')).href);
const {sessionBinding}=await import(pathToFileURL(join(root,'dist/session/identity.js')).href);
const workspace=await mkdtemp(join(tmpdir(),'nekomimi-browser-work-')),development=await mkdtemp(join(tmpdir(),'nekomimi-browser-create-')),home=await mkdtemp(join(tmpdir(),'nekomimi-browser-home-'));
const app=await startWeb({workspace,home,naming:false,apiKey:'offline-fixture',runtime:{fetch:async()=>{throw Error('No model calls in optional browser verification');}}});
const browser=await chromium.launch({channel:'chrome'}),page=await browser.newPage({viewport:{width:1440,height:1000}}),assets=new Set(),failures=[];
page.on('pageerror',error=>failures.push(String(error)));page.on('response',response=>{if(new URL(response.url()).pathname.startsWith('/assets/')){assets.add(new URL(response.url()).pathname);if(!response.ok())failures.push(response.status()+' '+response.url());}});
try{
 const work=await app.sessions.create('Installed optional fixture'),create=await app.sessions.create('Installed create fixture',{mode:'create',target:{kind:'extension',root:development},commandId:'installed-create'});
 const createEntry=await app.sessions.entry(create.id),binding=sessionBinding(createEntry.reader.events);
 const candidate=await new Candidates(binding.target.root).scaffold('installed-review','command',{session:binding,runId:'installed-origin'});
 const entry=await app.sessions.entry(work.id),journal=await Journal.open(entry.directory);
 await journal.append('context.add',{source:'fixture',items:[{type:'message',role:'assistant',content:[{type:'output_text',text:'## Installed rich content\n\n```ts\nconst installed = true;\n```'}]}]},{runId:'installed-run',attemptId:'installed-attempt'});await journal.close();
 const before=await readFile(join(entry.directory,'journal.jsonl'));
 const navigate=async path=>{await page.goto(app.origin+path+'#token='+app.token);};
 await navigate('/work/session/'+work.id);await expect(page.getByRole('heading',{name:'Installed rich content'})).toBeVisible();await expect(page.locator('[class*="syn-c"]').first()).toBeVisible();
 await page.getByRole('button',{name:'上下文详情',exact:true}).click();await expect(page.getByRole('button',{name:'刷新只读详情'})).toBeVisible();await page.getByRole('button',{name:'关闭详情'}).click();
 await page.getByRole('button',{name:'调用证据',exact:true}).first().click();await expect(page.getByRole('button',{name:'刷新只读证据'})).toBeVisible();await page.getByRole('button',{name:'关闭调用证据'}).click();
 await page.getByRole('tab',{name:'文件',exact:true}).click();await expect(page.getByRole('region',{name:'文件加载'})).toHaveCount(0);await expect(page.getByLabel('显示隐藏文件')).toBeVisible();
 await page.getByRole('tab',{name:'变更',exact:true}).click();await expect(page.getByRole('region',{name:'会话文件修改'})).toBeVisible();
 await page.getByRole('button',{name:'更多操作'}).click();await page.getByRole('menuitem',{name:'导出会话'}).click();const download=page.waitForEvent('download');await page.getByRole('button',{name:'下载 HTML',exact:true}).click();assert((await readFile(await (await download).path(),'utf8')).includes('Installed rich content'));await page.getByRole('button',{name:'关闭导出'}).click();
 await page.getByRole('button',{name:'版本恢复',exact:true}).click();await expect(page.getByRole('dialog',{name:'核心版本与恢复记录'})).toBeVisible();await page.getByRole('button',{name:'关闭恢复信息'}).click();
 const visited=[];
 for(const [route,heading] of [['/work/themes','主题与外观'],['/work/settings','基础设置'],['/work/models','模型用途与配置'],['/work/panels','面板管理'],['/work/workflows','持久工作流管理'],[`/create/session/${create.id}/resources`,'能力与权限'],[`/create/session/${create.id}/mcp`,'MCP 连接与授权'],[`/create/session/${create.id}/packages`,'能力包管理'],[`/create/session/${create.id}/panels`,'面板管理'],[`/create/session/${create.id}/workflows`,'持久工作流管理']]){await navigate(route);await expect(page.getByRole('heading',{level:1,name:heading,exact:true})).toBeVisible();visited.push(route);}
 await navigate(`/create/session/${create.id}/candidate/${candidate.id}`);await expect(page.getByRole('tab',{name:'内容差异'})).toBeVisible();await page.getByRole('tab',{name:'启用与导出'}).click();await expect(page.getByRole('tab',{name:'启用与导出'})).toHaveAttribute('aria-selected','true');
 assert.deepEqual(await readFile(join(entry.directory,'journal.jsonl')),before);assert.deepEqual(failures,[]);
 const result={node:process.version,platform:process.platform,browser:browser.version(),installedRoot:root,visited,assets:[...assets].sort(),runtimeErrors:failures,syntaxWorker:true,files:true,changes:true,contextDetails:true,inspection:true,export:true,recovery:true,candidate:true,realModelCalls:0,journalUnchanged:true};await writeFile(output,JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
}finally{await browser.close();await app.close();}
