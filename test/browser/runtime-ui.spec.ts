import {test,expect} from '@playwright/test';
import {cp,mkdir,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {startWeb} from '../../src/server/app.js';
import {temporary,key} from '../helpers.js';
test('applies a complete theme and shows user content with stable panel interaction and readable history',async({page})=>{
 const workspace=await temporary(),home=await temporary();await mkdir(join(workspace,'.nekomimi/extensions'),{recursive:true});await cp(resolve('extension-docs/examples/sakura'),join(workspace,'.nekomimi/extensions/sakura'),{recursive:true});
 const app=await startWeb({workspace,home,apiKey:key,naming:false,staticDir:resolve('dist/web-dist')});
 let mounts=0;page.on('request',request=>{if(request.method()==='POST'&&request.url().endsWith('/customization')&&request.postDataJSON()?.action==='panel-mount')mounts++;});
 try {
  await page.goto(app.url);await page.getByRole('button',{name:'定制能力',exact:true}).click();await page.getByRole('tab',{name:/管理/}).click();await page.getByRole('button',{name:'信任并启用 sakura-studio'}).click();await expect(page.getByRole('dialog')).toContainText('已生效');await page.getByRole('button',{name:'关闭定制能力'}).click();
  await page.getByRole('button',{name:'更多操作'}).click();await page.getByRole('button',{name:'外观',exact:true}).click();await page.getByRole('button',{name:'樱花手记',exact:true}).click();await expect(page.locator('html')).toHaveAttribute('data-theme','custom');
  expect(await page.locator('html').evaluate(e=>getComputedStyle(e).getPropertyValue('--ui-font'))).toContain('NekomimiTheme');
  await expect(page.getByRole('button',{name:'新建会话'})).toHaveCSS('background-color','rgb(160, 79, 144)');
  await page.getByRole('button',{name:'应用风格'}).click();
  await page.getByLabel('任务内容').fill('/moe 小猫咪');await expect(page.getByRole('button',{name:'发送任务',exact:true})).toHaveCSS('background-color','rgb(160, 79, 144)');await page.getByRole('button',{name:'发送任务',exact:true}).click();
  const frame=page.frameLocator('iframe[title="面板 今日元气"]');await expect(frame.getByRole('heading')).toContainText('小猫咪');
  await expect(frame.locator('body')).toHaveCSS('font-size','15px');
  expect(await frame.locator('body').evaluate(async()=>{await document.fonts.load('15px NekomimiTheme');return document.fonts.check('15px NekomimiTheme')&&Array.from(document.fonts).some(f=>f.family==='NekomimiTheme'&&f.status==='loaded');})).toBe(true);
  await expect(page.locator('.row-text')).not.toContainText('bundleHash');await expect(page.locator('.row-panel')).not.toContainText('moe-panel');
  // Re-reading the newest snapshot must not execute the previously live panel again.
  await page.locator('.timeline').evaluate(el=>{el.style.paddingTop='1600px';});
  await page.locator('.conversation').evaluate(el=>{el.dispatchEvent(new WheelEvent('wheel',{bubbles:true,deltaY:-100}));el.scrollTop=100;});
  const beforeLatest=mounts;
  await page.getByRole('button',{name:'返回最新',exact:true}).click();
  await expect(page.getByRole('button',{name:'打开互动内容'})).toBeVisible();
  await expect(page.locator('iframe[title="面板 今日元气"]')).toHaveCount(0);
  expect(mounts).toBe(beforeLatest);
  await page.locator('.timeline').evaluate(el=>{el.style.paddingTop='';});
  await page.getByRole('button',{name:'打开互动内容'}).click();
  await expect(frame.getByRole('heading')).toContainText('小猫咪');
  expect(mounts).toBe(beforeLatest+1);
  await frame.getByLabel('面板便签').fill('保持输入');
  await page.getByRole('button',{name:'更多操作'}).click();await page.getByRole('button',{name:'外观',exact:true}).click();await page.getByRole('button',{name:'默认风格',exact:true}).click();await page.getByRole('button',{name:'取消预览'}).click();await expect(frame.getByLabel('面板便签')).toHaveValue('保持输入');
  await expect(frame.locator('body')).toHaveCSS('font-size','15px');
  await frame.locator('body').evaluate(async()=>{await document.fonts.ready;});
  await page.locator('.row-panel').evaluate(async el=>{await Promise.all(el.getAnimations().map(animation=>animation.finished));});
  await frame.getByRole('button',{name:'写入草稿'}).click();await expect(page.getByLabel('任务内容')).toHaveValue('保持输入');
  await frame.getByLabel('面板便签').fill('第二条');await frame.getByRole('button',{name:'已提供草稿'}).click();await expect(page.getByRole('dialog',{name:'保留当前草稿'})).toBeVisible();await page.getByRole('button',{name:'保留原草稿'}).click();await expect(page.getByLabel('任务内容')).toHaveValue('保持输入');
  const panel=page.getByRole('region',{name:'自定义面板 今日元气'});await panel.getByRole('button',{name:'收起',exact:true}).click();await expect(page.locator('iframe[title="面板 今日元气"]')).toHaveCount(0);await panel.getByRole('button',{name:'重新打开'}).click();await expect(frame.getByRole('heading')).toContainText('小猫咪');
  await page.getByRole('button',{name:'灵感便签',exact:true}).click();
  await expect(page.frameLocator('iframe[title="面板 灵感便签"]').getByRole('heading')).toContainText('灵感便签');
  await page.getByRole('button',{name:'灵感便签',exact:true}).click();
  await expect(page.locator('iframe[title="面板 灵感便签"]')).toHaveCount(0);
  await page.screenshot({path:'output/playwright/runtime-ui-sakura.png',fullPage:true});
  await page.getByRole('button',{name:'更多操作'}).click();await page.getByRole('button',{name:'外观',exact:true}).click();
  await expect(page.getByRole('switch',{name:'显示扩展内容'})).toHaveCSS('border-radius','12px');
  await expect(page.locator('.toggle-track')).toHaveCSS('background-color','rgb(160, 79, 144)');
  await page.screenshot({path:'output/playwright/header-theme-menu.png',fullPage:true});await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'更多操作'}).click();await page.getByRole('button',{name:'导出',exact:true}).click();
  await expect(page.locator('.export-dialog')).toHaveCSS('background-color','rgb(255, 250, 253)');
  await page.screenshot({path:'output/playwright/header-theme-export.png',fullPage:true});await page.getByRole('button',{name:'关闭导出'}).click();
  const originalUrl=page.url(),beforeSwitch=mounts;
  await page.getByRole('button',{name:'新建会话'}).click();
  await expect(page.locator('iframe[title="面板 今日元气"]')).toHaveCount(0);
  await page.getByRole('button',{name:/\/moe 小猫咪/}).first().click();
  await expect(page).toHaveURL(originalUrl);
  await expect(page.getByRole('button',{name:'打开互动内容'})).toBeVisible();
  await expect(page.locator('iframe[title="面板 今日元气"]')).toHaveCount(0);
  expect(mounts).toBe(beforeSwitch);
  await page.reload();await expect(page.getByText('小猫咪 · 今日份的元气已加载',{exact:true})).toBeVisible();await expect(page.locator('iframe[title="面板 今日元气"]')).toHaveCount(0);await page.getByRole('button',{name:'打开互动内容'}).click();await expect(frame.getByRole('heading')).toContainText('小猫咪');
  await page.emulateMedia({reducedMotion:'reduce'});expect(await page.locator('.row-panel').evaluate(e=>getComputedStyle(e).animationName)).toBe('none');
  await page.setViewportSize({width:620,height:900});await page.evaluate(()=>{document.documentElement.style.zoom='2';});await page.getByRole('button',{name:'更多操作'}).click();await page.getByRole('button',{name:'外观',exact:true}).click();await expect(page.getByRole('button',{name:'恢复默认界面'})).toBeVisible();await page.getByRole('button',{name:'恢复默认界面'}).focus();await page.keyboard.press('Enter');await expect(page.locator('html')).not.toHaveAttribute('data-theme','custom');
  const catalog=await page.evaluate(async()=>await (await fetch('/api/v1/runtime-ui')).json());
  await writeFile('output/playwright/runtime-ui-verification.json',JSON.stringify({stage:'host-integration',passed:true,resources:catalog.runtimeUi.themes.map((t:any)=>({id:t.id,resourceId:t.resourceId,revision:t.revision})),browser:'Chromium',checks:['theme','command','draft-conflict','stable-input','reopen','history','reduced-motion','narrow-200-percent','keyboard-recovery']},null,2));
 }finally{await app.close();}
});
test('combines ordered views, explicit renderers and pages, and releases subscriptions on close',async({page})=>{
 const {writeFile}=await import('node:fs/promises');const workspace=await temporary(),home=await temporary();
 for(const name of ['first','second']){
  const root=join(workspace,'.nekomimi/extensions',name);await mkdir(root,{recursive:true});
  await writeFile(join(root,'extension.json'),JSON.stringify({name,sdkVersion:2,entry:'index.ts',requiredCapabilities:['views','commands','ui','ui-state','ui-navigation','ui-command']}));
  await writeFile(join(root,'index.ts'),`import type {ExtensionFactory} from 'nekomimi/extensions';export default ((api)=>{
   for(const [id,slot] of [['header','session-header'],['side','sidebar-widget'],['message','message-content'],['page','page']] as const) api.registerView({id,title:'${name}-'+id,order:${name==='first'?2:1},uiVersion:1,entry:'view.ts',slot,match:slot==='message-content'?{role:'user'}:undefined,propsSchema:{type:'object'},actions:['state.subscribe','view.open','command.run'],fallback:'${name} fallback'});
   api.registerCommand('hello',{description:'hello',async handler(_a,ctx){await ctx.ui({kind:'card',title:'一次结果',text:'hello from ${name}'});}});
  }) satisfies ExtensionFactory;`);
  await writeFile(join(root,'view.ts'),`import type {PanelModule} from 'nekomimi/extensions';export default {mount(root,ctx){const p=document.createElement('p');p.textContent='${name} visible';root.append(p);const status=document.createElement('span');status.textContent='等待会话';root.append(status);const stop=ctx.subscribe?.(s=>{status.textContent=String((s as any).status)});const b=document.createElement('button');b.textContent='打开页面';b.onclick=()=>{void ctx.request('view.open',{viewId:'page'})};root.append(b);const run=document.createElement('button');run.textContent='运行命令';const commandId=crypto.randomUUID();run.onclick=()=>{void ctx.request('command.run',{commandId,command:'/${name}:hello'})};root.append(run);return()=>{stop?.();root.replaceChildren()}}} satisfies PanelModule;`);
 }
 const app=await startWeb({workspace,home,apiKey:key,naming:false,staticDir:resolve('dist/web-dist')});
 try{
  await page.goto(app.url);await page.getByRole('button',{name:'定制能力',exact:true}).click();await page.getByRole('tab',{name:/管理/}).click();
  for(const name of ['first','second']){await page.getByRole('button',{name:`信任并启用 ${name}`,exact:true}).click();await expect(page.getByRole('dialog')).toContainText('已生效');}
  await page.getByRole('button',{name:'关闭定制能力'}).click();await page.getByLabel('任务内容').fill('/first:hello');await page.getByRole('button',{name:'发送任务',exact:true}).click();await expect(page.getByText('hello from first',{exact:true})).toBeVisible();
  const header=page.locator('.conversation > .runtime-views').first();await expect(header.locator('iframe').first()).toHaveAttribute('title','面板 second-header');
  const first=page.frameLocator('iframe[title="面板 first-header"]');await expect(first.getByText('completed',{exact:true})).toBeVisible();
  await first.getByRole('button',{name:'运行命令'}).click();await first.getByRole('button',{name:'运行命令'}).click();await expect(page.getByText('hello from first',{exact:true})).toHaveCount(2);
  const renderer=page.locator('.timeline .runtime-views').filter({has:page.locator('summary')}).first();await renderer.getByText('选择结果展示',{exact:true}).click();await renderer.getByRole('button',{name:'first-message',exact:true}).click();await expect(renderer.locator('iframe')).toHaveCount(1);await renderer.getByRole('button',{name:'second-message',exact:true}).click();await expect(renderer.locator('iframe')).toHaveCount(1);await expect(renderer.locator('iframe')).toHaveAttribute('title','面板 second-message');
  await first.getByRole('button',{name:'打开页面'}).click();await expect(page.getByRole('region',{name:'扩展页面'})).toBeVisible();await expect(page.frameLocator('iframe[title="面板 first-page"]').getByText('first visible',{exact:true})).toBeVisible();await page.getByRole('button',{name:'返回会话'}).click();await expect(page.getByRole('region',{name:'扩展页面'})).toHaveCount(0);
  await header.getByRole('button',{name:'隐藏此挂件'}).first().click();await expect(header.locator('iframe')).toHaveCount(1);await page.getByRole('button',{name:'更多操作'}).click();await page.getByRole('button',{name:'外观',exact:true}).click();await page.getByRole('button',{name:'恢复默认界面'}).click();await expect(page.locator('iframe')).toHaveCount(0);
 }finally{await app.close();}
});
