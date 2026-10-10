import {test,expect} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {startWeb} from '../../src/server/app.js';
import {Journal} from '../../src/journal.js';
import {temporary} from '../helpers.js';
import { openDetails } from './fixtures/workbench.js';

async function extension(workspace:string,label:string) {
  const root=join(workspace,'.nekomimi/extensions/slots');await mkdir(root,{recursive:true});
  await writeFile(join(root,'extension.json'),JSON.stringify({name:'slots',sdkVersion:3,entry:'index.ts',requiredCapabilities:['views','ui-draft','ui-navigation','ui-state']}));
  await writeFile(join(root,'index.ts'),`import type {ExtensionFactory} from 'nekomimi/extensions';export default ((api)=>{
    for(const [id,slot,order] of [['header','session-header',0],['side','sidebar-widget',0],['toolbar','composer-toolbar',0],['first','message-content',2],['second','message-content',1],['page','page',0],['broken','sidebar-widget',1]] as const)
      api.registerView({id,title:'${label} '+id,slot,order,uiVersion:1,contractVersion:3,modes:['work','create'],targetScope:'current',entry:id==='broken'?'broken.ts':'panel.ts',match:slot==='message-content'?{role:'user'}:undefined,propsSchema:{type:'object'},actions:['draft.set','view.open','state.subscribe'],fallback:'${label} saved '+id});
    api.registerView({id:'createonly',title:'${label} createonly',slot:'sidebar-widget',uiVersion:1,contractVersion:3,modes:['create'],targetScope:'current',entry:'panel.ts',propsSchema:{type:'object'},actions:[],fallback:'create only'});
  }) satisfies ExtensionFactory;`);
  await writeFile(join(root,'broken.ts'),`export default {mount(){throw new Error('isolated failure')}};`);
  await writeFile(join(root,'panel.ts'),`import type {PanelModule} from 'nekomimi/extensions';export default {mount(root,ctx){
    const p=document.createElement('p');p.textContent='${label} mounted';root.append(p);
    const status=document.createElement('p');status.textContent='waiting';root.append(status);
    const stop=ctx.subscribe?.(s=>{status.textContent='bound '+(s as {sessionId:string}).sessionId;});
    for(const [title,action,value] of [['填写草稿','draft.set',{text:'${label} draft'}],['打开页面','view.open',{viewId:'page'}]] as const) {
      const button=document.createElement('button');button.textContent=title;button.onclick=()=>void ctx.request(action,value).catch(e=>{status.textContent=String(e)});root.append(button);
    }
    const concurrent=document.createElement('button');concurrent.textContent='并发请求';concurrent.onclick=()=>{void Promise.all([ctx.request('draft.set',{text:'Concurrent draft'}),ctx.request('state.subscribe')]).then(()=>{p.textContent='Concurrent success'}).catch(error=>{p.textContent='Concurrent failed '+String(error)});};root.append(concurrent);
    return ()=>{stop?.();root.replaceChildren()};
  }} satisfies PanelModule;`);
}
async function fixture() {
  const workspace=await temporary(),home=await temporary();await extension(workspace,'Work');
  const app=await startWeb({workspace,home,naming:false,staticDir:resolve('dist/web-dist'),runtime:{fetch:async()=>{throw new Error('No model calls allowed');}}});
  const host=app.sessions.customization,resource=(await host.catalog.discover()).find(r=>r.name==='slots')!;
  await host.catalog.decide(resource.id,true,true,0);const reload=host.requestReload();await host.reload(reload);expect(reload.status,reload.error).toBe('activated');
  const session=await app.sessions.create('Slot task',{commandId:'slot-session',mode:'work'});
  const entry=await app.sessions.entry(session.id),journal=await Journal.open(entry.directory);
  await journal.append('context.add',{source:'user',item:{role:'user',content:[{type:'input_text',text:'Saved message remains readable'}]}});await journal.close();
  return {app,session};
}

test('10.9 scoped slots support draft conflicts, page bridge and explicit remount',async({page})=>{
  const {app,session}=await fixture();const actions:Record<string,unknown>[]=[];
  page.on('request',req=>{if(req.method()==='POST'&&req.url().endsWith('/customization'))actions.push(req.postDataJSON());});
  try {
    await page.goto(app.origin+`/work/session/${session.id}#token=`+app.token);
    await expect(page.getByRole('button',{name:'打开Work toolbar',exact:true})).toBeEnabled();
    await expect(page.locator('iframe')).toHaveCount(0);
    await expect(page.getByRole('button',{name:'打开Work createonly',exact:true})).toHaveCount(0);
    await page.getByRole('button',{name:'打开Work toolbar',exact:true}).click();
    const frame=page.frameLocator('iframe[title="面板 Work toolbar"]');
    await expect(frame.getByText('bound '+session.id,{exact:true})).toBeVisible();
    await frame.getByRole('button',{name:'填写草稿'}).click();
    await expect(page.getByLabel('任务草稿',{exact:true})).toHaveJSProperty('textContent','Work draft');
    await page.getByLabel('任务草稿',{exact:true}).fill('Keep me');
    await frame.getByRole('button',{name:'填写草稿'}).click();
    await expect(page.getByRole('button',{name:'保留原草稿',exact:true})).toBeFocused();
    await page.keyboard.press('Escape');await expect(page.getByLabel('任务草稿',{exact:true})).toHaveJSProperty('textContent','Keep me');
    await expect(page.getByRole('dialog',{name:'如何处理面板草稿？',exact:true})).toHaveCount(0);
    await expect(page.locator('iframe[title="面板 Work toolbar"]')).toBeFocused();
    await frame.getByRole('button',{name:'填写草稿'}).click();await page.getByRole('button',{name:'追加到草稿',exact:true}).click();
    await expect(page.getByLabel('任务草稿',{exact:true})).toHaveJSProperty('textContent','Keep me\nWork draft');
    await frame.getByRole('button',{name:'打开页面'}).click();
    await expect(page.getByRole('dialog')).toContainText('Work page');
    await expect(page.frameLocator('iframe[title="面板 Work page"]').getByText('Work mounted',{exact:true})).toBeVisible();
    await page.getByRole('button',{name:'关闭扩展页面',exact:true}).click();
    await expect(page.locator('iframe')).toHaveCount(1);
    await page.setViewportSize({width:360,height:900});await page.emulateMedia({reducedMotion:'reduce'});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.getByRole('button',{name:'关闭Work toolbar',exact:true}).click();await expect(page.locator('iframe')).toHaveCount(0);
    await page.reload();await expect(page.getByRole('button',{name:'打开Work toolbar',exact:true})).toBeEnabled();
    await expect(page.locator('iframe')).toHaveCount(0);await expect(page.getByLabel('任务草稿',{exact:true})).toHaveJSProperty('textContent','Keep me\nWork draft');
    expect(actions.filter(action=>action.action==='panel-mount')).toHaveLength(2);
    expect(actions.filter(action=>String(action.action).startsWith('panel-')).every(action=>action.sessionId===session.id)).toBe(true);
  } finally {await app.close();}
});

test('10.9 renderers remain opt-in and exclusive; crashes and target navigation preserve host controls',async({page})=>{
  const {app,session}=await fixture();
  try {
    await page.goto(app.origin+`/work/session/${session.id}#token=`+app.token);
    await expect(page.getByText('Saved message remains readable',{exact:true})).toBeVisible();
    const renderers=page.getByRole('region',{name:'扩展区域 message-content'});
    await expect(renderers.getByRole('button').first()).toHaveText('打开Work second');
    await renderers.getByRole('button',{name:'打开Work first',exact:true}).click();await expect(renderers.locator('iframe')).toHaveCount(1);
    await renderers.getByRole('button',{name:'打开Work second',exact:true}).click();await expect(renderers.locator('iframe')).toHaveCount(1);
    await expect(renderers.locator('iframe')).toHaveAttribute('title','面板 Work second');
    await renderers.getByRole('button',{name:'保留默认展示',exact:true}).click();await expect(renderers.locator('iframe')).toHaveCount(0);
    await expect(page.getByText('Saved message remains readable',{exact:true})).toBeVisible();
    // sidebar-widget 位于详情抽屉（默认收起）：先打开详情
    await openDetails(page);
    await page.getByRole('button',{name:'打开Work broken',exact:true}).click();
    await expect(page.getByRole('region',{name:'自定义面板 Work broken'})).toContainText('暂时无法显示互动内容');
    await page.getByLabel('任务草稿',{exact:true}).fill('Host stays usable');
    const development=await temporary();await extension(development,'Create');
    const create=await app.sessions.create('Scoped create',{commandId:'slot-create',mode:'create',target:{kind:'extension',root:development,scope:'project'}});
    const data=await app.sessions.describeCustomization(create.id),resource=data.resources.find(r=>r.name==='slots')!;
    await app.sessions.customizationAction({action:'authorize-version',sessionId:create.id,id:resource.id,contentHash:resource.hash,revision:data.settingsRevision});
    await expect.poll(async()=>(await app.sessions.describeCustomization(create.id)).panels.length).toBe(8);
    await page.goto(app.origin+`/create/session/${create.id}`);
    await expect(page.getByRole('button',{name:'打开Create toolbar',exact:true})).toBeEnabled();
    await expect(page.getByRole('button',{name:'打开Work toolbar',exact:true})).toHaveCount(0);
    await page.getByRole('button',{name:'打开Create toolbar',exact:true}).click();
    const frame=page.frameLocator('iframe[title="面板 Create toolbar"]');await frame.getByRole('button',{name:'填写草稿'}).click();
    await expect(page.getByLabel('任务草稿',{exact:true})).toHaveJSProperty('textContent','Create draft');
    await page.goto(app.origin+`/work/session/${session.id}`);await expect(page.getByLabel('任务草稿',{exact:true})).toHaveJSProperty('textContent','Host stays usable');
    await expect(page.locator('iframe')).toHaveCount(0);
  } finally {await app.close();}
});

test('10.9 leaving a pending draft conflict cancels the old instance without changing either session draft',async({page})=>{
  const {app,session}=await fixture();
  try {
    const other=await app.sessions.create('Other task',{commandId:'slot-other',mode:'work'});
    await page.goto(app.origin+`/work/session/${session.id}#token=`+app.token);
    await page.getByLabel('任务草稿',{exact:true}).fill('Original draft');
    await page.getByRole('button',{name:'打开Work toolbar',exact:true}).click();
    await page.frameLocator('iframe[title="面板 Work toolbar"]').getByRole('button',{name:'填写草稿'}).click();
    await expect(page.getByRole('dialog')).toContainText('如何处理面板草稿');
    await page.goto(app.origin+`/work/session/${other.id}`);
    await expect(page.getByRole('dialog')).toHaveCount(0);await expect(page.getByLabel('任务草稿',{exact:true})).toHaveJSProperty('textContent','');
    await page.goto(app.origin+`/work/session/${session.id}`);
    await expect(page.getByLabel('任务草稿',{exact:true})).toHaveJSProperty('textContent','Original draft');
    await expect(page.locator('iframe')).toHaveCount(0);
  } finally {await app.close();}
});

test('10.9 bridge requests retain instance sequence under delayed HTTP delivery',async({page})=>{
  const {app,session}=await fixture();
  try {
    await page.goto(app.origin+`/work/session/${session.id}#token=`+app.token);
    await page.getByRole('button',{name:'打开Work toolbar',exact:true}).click();
    const frame=page.frameLocator('iframe[title="面板 Work toolbar"]');await expect(frame.getByText('bound '+session.id,{exact:true})).toBeVisible();
    await page.route('**/customization',async route=>{
      const value=route.request().postDataJSON();
      if(value?.action==='panel-action'&&value.method==='draft.set')await new Promise(resolve=>setTimeout(resolve,300));
      await route.continue();
    });
    await frame.getByRole('button',{name:'并发请求',exact:true}).click();
    await expect(frame.getByText('Concurrent success',{exact:true})).toBeVisible();
    await expect(page.getByLabel('任务草稿',{exact:true})).toHaveJSProperty('textContent','Concurrent draft');
  } finally {await app.close();}
});

test('10.9 hiding extensions unmounts open slots and restoring visibility never remounts',async({page})=>{
  const {app,session}=await fixture();
  const mounts:string[]=[];page.on('request',request=>{if(request.method()==='POST'&&request.url().endsWith('/customization')&&request.postDataJSON().action==='panel-mount')mounts.push(request.url());});
  try {
    await page.goto(`${app.origin}/work/session/${session.id}#token=${app.token}`);
    await page.getByLabel('任务草稿',{exact:true}).fill('Preserved host draft');
    await page.getByRole('button',{name:'打开Work toolbar',exact:true}).click();
    await page.getByRole('button',{name:'打开Work first',exact:true}).click();
    await expect(page.locator('iframe')).toHaveCount(2);
    await page.getByRole('button',{name:'设置',exact:true}).click();await page.getByRole('menuitem',{name:'外观',exact:true}).click();
    const toggle=page.getByRole('switch',{name:'显示扩展内容',exact:true});await expect(toggle).toHaveAttribute('aria-checked','true');
    await toggle.focus();await page.keyboard.press('Space');await expect(toggle).toHaveAttribute('aria-checked','false');await expect(page.locator('iframe')).toHaveCount(0);
    await page.keyboard.press('Escape');await expect(page.getByRole('button',{name:'设置',exact:true})).toBeFocused();
    await expect(page.getByText('Saved message remains readable',{exact:true})).toBeVisible();
    await page.reload();await expect(page.getByLabel('任务草稿',{exact:true})).toHaveJSProperty('textContent','Preserved host draft');await expect(page.locator('iframe')).toHaveCount(0);
    await page.getByRole('button',{name:'设置',exact:true}).click();await page.getByRole('menuitem',{name:'外观',exact:true}).click();await expect(toggle).toHaveAttribute('aria-checked','false');await toggle.click();await page.keyboard.press('Escape');
    await expect(page.getByRole('button',{name:'打开Work toolbar',exact:true})).toBeEnabled();await expect(page.locator('iframe')).toHaveCount(0);expect(mounts).toHaveLength(2);
    await page.getByRole('button',{name:'打开Work toolbar',exact:true}).click();await expect(page.locator('iframe')).toHaveCount(1);
    await page.getByRole('button',{name:'设置',exact:true}).click();await page.getByRole('menuitem',{name:'外观',exact:true}).click();await page.getByRole('button',{name:'恢复默认界面',exact:true}).click();await expect(page.locator('iframe')).toHaveCount(0);
    await expect(page.getByLabel('任务草稿',{exact:true})).toHaveJSProperty('textContent','Preserved host draft');
  } finally {await app.close();}
});
