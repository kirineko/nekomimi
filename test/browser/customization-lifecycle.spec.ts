import {test,expect} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {temporary} from '../helpers.js';
import {startWeb} from '../../src/server/app.js';
import {CustomizationHost} from '../../src/customization/host.js';
test('compact capability catalog, local feedback, permissions and theme preview',async({page})=>{
 const workspace=await temporary(),home=await temporary(),root=join(workspace,'.nekomimi/extensions/pink');await mkdir(root,{recursive:true});
 await writeFile(join(root,'extension.json'),JSON.stringify({name:'pink',entry:'index.ts',sdkVersion:2,requiredCapabilities:['themes']}));
 await writeFile(join(root,'index.ts'),`export default (api:import('nekomimi/extensions').ExtensionAPI)=>{api.registerTheme({id:'pink',title:'粉白主题',colors:{accent:'#fbd',surface:'#fff',foreground:'#334'}});}`);
 await mkdir(join(home,'skills/shared'),{recursive:true});await writeFile(join(home,'skills/shared/SKILL.md'),'---\nname: shared\ndescription: shared skill\n---\nRead current files.');
 const app=await startWeb({workspace,home,naming:false,staticDir:resolve('dist/web-dist')});
 try {
  await page.goto(app.url);await page.getByRole('button',{name:'定制能力',exact:true}).click();
  await expect(page.getByRole('tab',{name:/我的定制/})).toHaveAttribute('aria-selected','true');
  await page.getByRole('button',{name:'用户级',exact:true}).click();await expect(page.locator('.ability-card')).toContainText('用户级 · 跨项目可用');await expect(page.locator('.ability-card')).toContainText('shared');await page.getByRole('button',{name:'当前项目',exact:true}).click();
  await page.getByRole('button',{name:'查看所需权限'}).click();await expect(page.getByText(/此资源新增：themes/)).toBeVisible();
  await page.getByRole('button',{name:'取消',exact:true}).click();await page.getByRole('tab',{name:/管理/}).click();
  await page.getByRole('button',{name:'静态校验 pink'}).click();await expect(page.getByRole('status').filter({hasText:'静态校验通过'})).toBeVisible();
  await page.getByRole('tab',{name:/模型/}).click();await expect(page.getByRole('status').filter({hasText:'静态校验通过'})).not.toBeVisible();
  await page.getByRole('tab',{name:/我的定制/}).click();await page.getByRole('button',{name:'查看所需权限'}).click();await page.getByRole('button',{name:'确认授权',exact:true}).click();
  await expect(page.getByRole('button',{name:'预览与应用'})).toBeVisible({timeout:20000});
  await page.getByRole('button',{name:'预览与应用'}).click();await expect(page.getByRole('button',{name:'应用风格',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'取消预览'}).click();await expect(page.locator('html')).not.toHaveAttribute('data-theme','custom');
  await page.getByRole('button',{name:'定制能力',exact:true}).click();await page.setViewportSize({width:360,height:780});
  await expect(page.getByRole('button',{name:'关闭定制能力'})).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:'test-results/customization-lifecycle-mobile.png'});
  await page.getByRole('button',{name:'关闭定制能力'}).click();
  const writes:string[]=[];page.on('request',r=>{if(r.method()==='POST'&&r.url().endsWith('/customization'))writes.push(r.postDataJSON().action);});
  await page.evaluate(()=>window.dispatchEvent(new CustomEvent('nekomimi-customization-open',{detail:{resourceId:'removed-resource',revision:'obsolete'}})));
  await expect(page.getByRole('status').filter({hasText:'历史版本已更新或不可用'})).toBeVisible();
  expect(writes).toEqual([]);
 }finally{await app.close();}
});
