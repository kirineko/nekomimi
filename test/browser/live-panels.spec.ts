import {test,expect} from '@playwright/test';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {startWeb} from '../../src/server/app.js';
import {Journal} from '../../src/journal.js';
import {temporary,key} from '../helpers.js';
for(const mode of ['work','create'] as const)test(`${mode}: only fresh live panel results mount automatically once`,async({page})=>{
 const workspace=await temporary(),home=await temporary(),target=mode==='work'?workspace:await temporary();
 const root=join(target,'.nekomimi/extensions/live-panel'),effects=join(target,'command-effects');
 await mkdir(root,{recursive:true});
 await writeFile(join(root,'extension.json'),JSON.stringify({name:'live-panel',sdkVersion:3,entry:'index.ts',requiredCapabilities:['commands','panels','ui']}));
 await writeFile(join(root,'index.ts'),`import {appendFileSync} from 'node:fs';import type {ExtensionFactory3} from 'nekomimi/extensions';export default ((api)=>{
 api.registerPanel({id:'live',title:'实时结果',uiVersion:1,contractVersion:3,modes:['work','create'],targetScope:'current',entry:'panel.ts',slot:'tool-result',propsSchema:{type:'object'},actions:[],fallback:'已保存结果'});
 api.registerCommand('live',{description:'live panel fixture',async handler(args,ctx){appendFileSync(${JSON.stringify(effects)},args+'\\n');await ctx.ui({kind:'panel',title:'实时结果',panelId:'live',summary:'已保存 '+args,props:{label:args}});}});
 }) satisfies ExtensionFactory3;`);
 await writeFile(join(root,'panel.ts'),`import type {PanelModule} from 'nekomimi/extensions';export default {mount(root,ctx){const p=document.createElement('p');p.textContent='interactive '+(ctx.props as {label:string}).label;root.append(p);return()=>root.replaceChildren();}} satisfies PanelModule;`);
 const app=await startWeb({workspace,home,apiKey:key,naming:false,staticDir:resolve('dist/web-dist'),runtime:{fetch:async()=>{throw Error('No model calls allowed');}}});let mounts=0;
 page.on('request',r=>{if(r.method()==='POST'&&r.url().endsWith('/customization')&&r.postDataJSON().action==='panel-mount')mounts++;});
 try{
  const session=await app.sessions.create('实时面板',{mode,commandId:'live-panel',...(mode==='create'?{target:{kind:'extension' as const,root:target}}:{})});
  if(mode==='create'){
   const catalog=await app.sessions.describeCustomization(session.id),resource=catalog.resources.find(r=>r.name==='live-panel')!;
   await app.sessions.customizationAction({action:'authorize-version',sessionId:session.id,id:resource.id,contentHash:resource.hash,revision:catalog.settingsRevision});
  }else{
   await app.sessions.waitInitialization();const host=app.sessions.customization,resource=(await host.catalog.discover()).find(r=>r.name==='live-panel')!;
   await host.catalog.decide(resource.id,true,true,(await host.catalog.decisions()).revision);const receipt=host.requestReload();await host.reload(receipt);expect(receipt.status,receipt.error).toBe('activated');
  }
  const entry=await app.sessions.entry(session.id),journal=await Journal.open(entry.directory);
  for(let i=0;i<100;i++)await journal.append('context.add',{source:'user',item:{role:'user',content:'旧记录 '+i+'\n'+'保留历史内容。'.repeat(40)}},{},false);
  await journal.close();
  await page.goto(`${app.origin}/${mode}/session/${session.id}#token=${app.token}`);
  const timeline=page.getByTestId(mode==='work'?'timeline':'create-timeline'),input=page.getByLabel('任务草稿',{exact:true});
  await input.fill('/live first');await page.getByRole('button',{name:'发送',exact:true}).click();
  const frame=page.frameLocator('iframe[title="面板 实时结果"]');
  await expect(frame.getByText('interactive first',{exact:true})).toBeVisible();expect(mounts).toBe(1);
  await expect(timeline.getByText('已保存 first',{exact:true})).toHaveCount(0);
  await input.fill('保留草稿');
  await timeline.evaluate(el=>{el.dispatchEvent(new WheelEvent('wheel',{bubbles:true,deltaY:-100}));el.scrollTop=0;});
  await expect(page.locator('iframe')).toHaveCount(0);
  await timeline.evaluate(el=>{el.dispatchEvent(new WheelEvent('wheel',{bubbles:true,deltaY:100}));el.scrollTop=el.scrollHeight;});
  await expect(timeline.getByText('已保存 first',{exact:true})).toBeVisible();await expect(page.locator('iframe')).toHaveCount(0);expect(mounts).toBe(1);
  await timeline.getByRole('button',{name:'打开互动内容',exact:true}).click();await expect(frame.getByText('interactive first',{exact:true})).toBeVisible();expect(mounts).toBe(2);
  await page.reload();await expect(timeline.getByText('已保存 first',{exact:true})).toBeVisible();await expect(page.locator('iframe')).toHaveCount(0);expect(mounts).toBe(2);
  await expect(input).toHaveJSProperty('textContent','保留草稿');
  // An event saved while disconnected is history on reconnection, not a fresh offer.
  await page.context().setOffline(true);
  await app.sessions.submit(session.id,{version:1,commandId:'offline-panel',prompt:'/live offline'});await app.sessions.activeFor(session.id)?.done;
  await page.context().setOffline(false);
  await expect(timeline.getByText('已保存 offline',{exact:true})).toBeVisible();await expect(page.locator('iframe')).toHaveCount(0);expect(mounts).toBe(2);
  await page.getByRole('button',{name:'设置',exact:true}).click();await page.getByRole('menuitem',{name:'外观',exact:true}).click();
  await page.getByRole('switch',{name:'显示扩展内容',exact:true}).click();await page.getByRole('button',{name:'关闭外观',exact:true}).click();
  await input.fill('/live hidden');await page.getByRole('button',{name:'发送',exact:true}).click();
  await expect(timeline.getByText('已保存 hidden',{exact:true})).toBeVisible();expect(mounts).toBe(2);
  await page.getByRole('button',{name:'设置',exact:true}).click();await page.getByRole('menuitem',{name:'外观',exact:true}).click();
  await page.getByRole('switch',{name:'显示扩展内容',exact:true}).click();await page.getByRole('button',{name:'关闭外观',exact:true}).click();
  await expect(page.locator('iframe')).toHaveCount(0);expect(mounts).toBe(2);
  expect(await readFile(effects,'utf8')).toBe('first\noffline\nhidden\n');
 }finally{await page.context().setOffline(false);await app.close();}
});
