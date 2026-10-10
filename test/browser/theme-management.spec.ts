import {test,expect} from '@playwright/test';
import {mkdir,writeFile,copyFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {startWeb} from '../../src/server/app.js';
import {temporary} from '../helpers.js';
async function fixture(scoped=false){
  const workspace=await temporary(),home=await temporary(),development=scoped?await temporary():workspace,root=join(development,'.nekomimi/extensions/theme');
  await mkdir(root,{recursive:true});await copyFile(resolve('extension-docs/examples/sakura/demo.woff'),join(root,'demo.woff'));await copyFile(resolve('extension-docs/examples/sakura/sakura.png'),join(root,'sakura.png'));
  await writeFile(join(root,'extension.json'),JSON.stringify({name:'theme',sdkVersion:3,entry:'index.ts',requiredCapabilities:['themes']}));
  await writeFile(join(root,'index.ts'),`import type {ExtensionFactory3} from 'nekomimi/extensions';export default ((api)=>{api.registerTheme({id:'fixture',title:'主题样本',colors:{background:'#f4fff8',surface:'#e0f0e6',foreground:'#172b20',accent:'#286c43',border:'#608070'},typography:{font:'demo.woff',size:16,fallback:'sans-serif'},assets:{background:'sakura.png'},radii:{control:12},spacing:{controlPadding:8},motion:{preset:'float',duration:2000,intensity:3}});}) satisfies ExtensionFactory3;`);
  const app=await startWeb({workspace,home,naming:false,staticDir:resolve('dist/web-dist')});await app.sessions.waitInitialization();
  let sessionId:string|undefined;
  if(scoped){const session=await app.sessions.create('主题开发',{commandId:'theme-create',mode:'create',target:{kind:'extension',root:development,scope:'project'}});sessionId=session.id;const data=await app.sessions.describeCustomization(session.id),resource=data.resources.find(item=>item.name==='theme')!;await app.sessions.customizationAction({action:'authorize-version',sessionId:session.id,id:resource.id,contentHash:resource.hash,revision:data.settingsRevision});await expect.poll(async()=>(await app.sessions.runtimeUi(session.id)).runtimeUi.themes.length).toBe(1);}
  else{const resource=(await app.sessions.customization.catalog.discover()).find(item=>item.name==='theme')!;await app.sessions.customization.catalog.decide(resource.id,true,true,0);await app.sessions.customization.initialize();}
  return {app,sessionId,root};
}
test('10.4 theme preview cancels without writes; apply persists and recovery remains accessible',async({page})=>{
  const f=await fixture(),actions:string[]=[];page.on('request',request=>{if(request.method()==='POST'&&request.url().endsWith('/customization'))actions.push(request.postDataJSON().action);});
  try{
    await page.goto(f.app.origin+'/work/themes#token='+f.app.token);await page.getByRole('button',{name:'预览 主题样本',exact:true}).click();
    await expect(page.locator('html')).toHaveAttribute('data-workbench-theme','fixture');expect(actions).toEqual([]);
    await expect(page.getByRole('button',{name:'刷新主题目录',exact:true})).toHaveCSS('border-radius','12px');
    expect(await page.locator('html').evaluate(async()=>{await document.fonts.load('16px NekomimiWorkbenchTheme');return Array.from(document.fonts).some(font=>font.family==='NekomimiWorkbenchTheme'&&font.status==='loaded');})).toBe(true);
    await page.getByRole('button',{name:'取消主题预览',exact:true}).click();await expect(page.locator('html')).not.toHaveAttribute('data-workbench-theme');expect(actions).toEqual([]);
    await page.getByRole('button',{name:'预览 主题样本',exact:true}).click();await page.getByRole('button',{name:'应用已审阅风格',exact:true}).click();await page.getByRole('button',{name:'确认应用已审阅风格',exact:true}).click();
    await expect.poll(()=>actions.filter(action=>action==='theme-verify').length).toBe(1);expect(actions.filter(action=>action==='theme-select')).toHaveLength(1);
    await page.reload();await expect(page.locator('html')).toHaveAttribute('data-workbench-theme','fixture');expect(actions.filter(action=>action==='theme-verify')).toHaveLength(1);
    await page.emulateMedia({reducedMotion:'reduce'});await expect(page.locator('[data-theme-decoration]')).toHaveCSS('animation-name','none');
    await page.setViewportSize({width:360,height:760});await page.getByRole('button',{name:'设置',exact:true}).click();await page.getByRole('menuitem',{name:'外观',exact:true}).click();await page.getByRole('button',{name:'恢复默认界面',exact:true}).click();await expect(page.locator('html')).not.toHaveAttribute('data-workbench-theme');
    await expect.poll(async()=>(await f.app.sessions.customization.themes.preference('project')).selection).toBe(null);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  }finally{await f.app.close();}
});
test('10.4 theme revision conflict does not retry; revocation removes active stylesheet',async({page})=>{
  const f=await fixture();
  try{
    await page.goto(f.app.origin+'/work/themes#token='+f.app.token);await page.getByRole('button',{name:'预览 主题样本',exact:true}).click();await page.getByRole('button',{name:'应用已审阅风格',exact:true}).click();
    await f.app.sessions.customization.themes.select('project',null,0);
    await page.getByRole('button',{name:'确认应用已审阅风格',exact:true}).click();await expect(page.getByRole('dialog')).toContainText('主题偏好已变化');await expect(page.getByRole('button',{name:'确认应用已审阅风格',exact:true})).toBeDisabled();
    await page.getByRole('button',{name:'取消操作',exact:true}).click();await page.getByRole('button',{name:'刷新主题目录',exact:true}).click();
    await expect(page.getByText('偏好与资源版本',{exact:true})).toBeVisible();
    await page.getByRole('button',{name:'应用已审阅风格',exact:true}).click();await expect(page.getByRole('dialog')).toContainText('偏好修订：1');await page.getByRole('button',{name:'确认应用已审阅风格',exact:true}).click();
    await expect.poll(async()=>(await f.app.sessions.customization.themes.describe()).active?.id).toBe('fixture');
    const resource=(await f.app.sessions.customization.catalog.discover()).find(item=>item.name==='theme')!;await f.app.sessions.customization.catalog.decide(resource.id,false,false,(await f.app.sessions.customization.catalog.decisions()).revision);
    await page.getByRole('button',{name:'刷新主题目录',exact:true}).click();await expect(page.locator('html')).not.toHaveAttribute('data-workbench-theme');
    await expect(page.getByRole('alert')).toContainText('撤权');
  }finally{await f.app.close();}
});
test('10.4 create theme stays scoped; failed recovery uses persistent window fallback without false saved claim',async({page})=>{
  const f=await fixture(true);
  try{
    await page.goto(f.app.origin+`/create/session/${f.sessionId}/themes#token=`+f.app.token);await page.getByRole('button',{name:'预览 主题样本',exact:true}).click();await page.getByRole('button',{name:'应用已审阅风格',exact:true}).click();await page.getByRole('button',{name:'确认应用已审阅风格',exact:true}).click();
    await expect.poll(async()=>(await f.app.sessions.runtimeUi(f.sessionId)).runtimeUi.active?.id).toBe('fixture');expect((await f.app.sessions.customization.themes.preference('project')).selection).toBeUndefined();
    await page.route('**/api/v1/customization',async route=>{if(route.request().method()==='POST'&&route.request().postDataJSON().action==='theme-select'){await route.fulfill({status:409,contentType:'application/json',body:JSON.stringify({error:{code:'fixture',message:'fixture conflict'}})});return;}await route.continue();});
    await page.getByRole('button',{name:'设置',exact:true}).click();await page.getByRole('menuitem',{name:'外观',exact:true}).click();await page.getByRole('button',{name:'恢复默认界面',exact:true}).click();await expect(page.locator('html')).not.toHaveAttribute('data-workbench-theme');await expect(page.getByRole('alert')).toContainText('保存偏好失败');
    expect((await f.app.sessions.runtimeUi(f.sessionId)).runtimeUi.active?.id).toBe('fixture');await page.reload();await expect(page.getByRole('heading',{name:'主题与外观',exact:true})).toBeVisible();await expect(page.locator('html')).not.toHaveAttribute('data-workbench-theme');
  }finally{await f.app.close();}
});

test('10.4 project can explicitly follow user default; preview navigation cancels and bad font falls back',async({page})=>{
  const f=await fixture();const actions:string[]=[];
  page.on('request',request=>{if(request.method()==='POST'&&request.url().endsWith('/customization'))actions.push(request.postDataJSON().action);});
  try{
    const theme=(await f.app.sessions.customization.themes.catalog())[0]!;
    await f.app.sessions.customization.themes.select('user',{id:theme.id,resourceId:theme.resourceId,revision:theme.revision},0);
    await f.app.sessions.customization.themes.select('project',null,0);
    await page.goto(f.app.origin+'/work/themes#token='+f.app.token);
    await page.getByRole('button',{name:'预览 主题样本',exact:true}).click();await expect(page.locator('html')).toHaveAttribute('data-workbench-theme','fixture');
    await page.goto(f.app.origin+'/work/settings');await expect(page.locator('html')).not.toHaveAttribute('data-workbench-theme');expect(actions).toEqual([]);
    await page.goto(f.app.origin+'/work/themes');await page.getByRole('button',{name:'跟随用户默认',exact:true}).click();await page.getByRole('button',{name:'确认跟随用户默认',exact:true}).click();
    await expect(page.locator('html')).toHaveAttribute('data-workbench-theme','fixture');await expect.poll(()=>actions.filter(action=>action==='theme-verify').length).toBe(1);
    expect((await f.app.sessions.customization.themes.preference('project')).selection).toBeUndefined();
    await page.route('**/api/v1/runtime-ui',async route=>{const response=await route.fetch(),data=await response.json();for(const item of [...data.runtimeUi.themes,data.runtimeUi.active].filter(Boolean))item.assetsData.font='data:font/woff;base64,d09GRgAAAAAA';await route.fulfill({response,json:data});});
    await page.reload();await expect(page.getByRole('heading',{name:'主题与外观',exact:true})).toBeVisible();await expect(page.locator('html')).toHaveAttribute('data-workbench-theme','fixture');
    expect(await page.locator('html').evaluate(async()=>{try{await document.fonts.load('16px NekomimiWorkbenchTheme');return 'loaded';}catch{return 'fallback';}})).toBe('fallback');
    await expect(page.locator('html')).toHaveCSS('font-family','NekomimiWorkbenchTheme, sans-serif');
    await page.getByRole('button',{name:'设置',exact:true}).click();await page.getByRole('menuitem',{name:'外观',exact:true}).click();await page.getByRole('button',{name:'恢复默认界面',exact:true}).click();await expect(page.locator('html')).not.toHaveAttribute('data-workbench-theme');
  }finally{await f.app.close();}
});

test('10.9 appearance previews cancel on Escape or outside and nested confirmation closes first',async({page})=>{
  const f=await fixture(),actions:string[]=[];
  page.on('request',request=>{if(request.method()==='POST'&&request.url().endsWith('/customization'))actions.push(request.postDataJSON().action);});
  try {
    const session=await f.app.sessions.create('Appearance preview');
    await page.goto(`${f.app.origin}/work/session/${session.id}#token=${f.app.token}`);
    const more=page.getByRole('button',{name:'设置',exact:true});
    await page.getByLabel('任务草稿',{exact:true}).fill('Keep appearance draft');
    for(const dismissal of ['escape','outside']) {
      await more.click();await page.getByRole('menuitem',{name:'外观',exact:true}).click();
      await page.getByRole('button',{name:'预览 主题样本',exact:true}).click();await expect(page.locator('html')).toHaveAttribute('data-workbench-theme','fixture');
      await expect(page.getByLabel('主题应用范围',{exact:true})).not.toBeVisible();
      await page.getByRole('button',{name:'应用已审阅风格',exact:true}).click();await expect(page.getByRole('dialog',{name:'应用已审阅风格',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'取消操作',exact:true})).toBeFocused();await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog',{name:'应用已审阅风格',exact:true})).toHaveCount(0);
      await expect(page.getByRole('button',{name:'应用已审阅风格',exact:true})).toBeFocused();
      await expect(page.getByRole('dialog',{name:'外观',exact:true})).toBeVisible();await expect(page.locator('html')).toHaveAttribute('data-workbench-theme','fixture');
      if(dismissal==='escape')await page.keyboard.press('Escape');else await page.mouse.click(2,2);
      await expect(page.getByRole('dialog')).toHaveCount(0);await expect(more).toBeFocused();await expect(page.locator('html')).not.toHaveAttribute('data-workbench-theme');
    }
    await expect(page.getByLabel('任务草稿',{exact:true})).toHaveJSProperty('textContent','Keep appearance draft');expect(actions).toEqual([]);
  } finally {await f.app.close();}
});
