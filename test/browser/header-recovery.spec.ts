import {test,expect} from '@playwright/test';
import {resolve} from 'node:path';
import {startWeb} from '../../src/server/app.js';
import {temporary,response,key} from '../helpers.js';
test('keeps failure readable, continues through draft, and uses compact dismissible header controls',async({page})=>{
 let calls=0;
 const app=await startWeb({workspace:await temporary(),home:await temporary(),apiKey:key,naming:false,staticDir:resolve('dist/web-dist'),runtime:{fetch:async(_u,init)=>{calls++;expect(JSON.parse(String(init?.body)).max_output_tokens).toBe(131072);return response([],'incomplete');}}});
 try{
  await page.goto(app.url);
  const more=page.getByRole('button',{name:'更多操作'});
  await expect(page.locator('.topbar').getByRole('button')).toHaveCount(3); // visible desktop actions
  await page.getByLabel('任务内容').fill('继续开发');await page.getByRole('button',{name:'发送任务'}).click();
  await expect(page.locator('.run-recovery')).toContainText('128K');await expect(page.locator('.run-recovery')).toHaveCount(1);expect(calls).toBe(1);
  await expect(page.locator('.timeline')).not.toContainText('Response incomplete');
  await page.getByLabel('任务内容').fill('保留的草稿');await page.getByRole('button',{name:'继续任务',exact:true}).click();
  await expect(page.getByRole('dialog',{name:'保留当前草稿'})).toBeVisible();await page.getByRole('button',{name:'保留原草稿'}).click();expect(calls).toBe(1);
  await more.click();await expect(page.getByRole('button',{name:'导出',exact:true})).toBeVisible();await page.keyboard.press('Escape');await expect(more).toBeFocused();
  await more.click();await page.getByLabel('任务内容').click();await expect(more).toHaveAttribute('aria-expanded','false');
  await more.click();await page.getByRole('button',{name:'外观',exact:true}).click();await expect(page.getByRole('button',{name:'恢复扩展视图'})).toHaveCount(0);
  await page.getByRole('switch',{name:'显示扩展内容'}).click();await expect(page.getByRole('switch',{name:'显示扩展内容'})).toHaveAttribute('aria-checked','false');await page.getByRole('switch',{name:'显示扩展内容'}).click();await expect(page.getByRole('button',{name:'全局默认'})).not.toBeVisible();
  await page.keyboard.press('Escape');await more.click();await page.getByRole('button',{name:'导出',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'导出对话'});await expect(dialog).toBeVisible();await expect(page.getByLabel('需要脱敏的文本（每行一项）')).not.toBeVisible();
  await page.route('**/api/v1/sessions/*/export',route=>route.fulfill({status:500,contentType:'application/json',body:JSON.stringify({error:{message:'导出测试失败'}})}));
  await page.getByRole('button',{name:'下载 HTML'}).click();await expect(dialog.getByRole('alert')).toBeVisible();await page.unroute('**/api/v1/sessions/*/export');
  await dialog.getByText('隐私与脱敏').click();await page.getByLabel('需要脱敏的文本（每行一项）').fill('private');
  await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);await expect(more).toBeFocused();
  await page.screenshot({path:'output/playwright/header-compact.png',fullPage:true});
  await page.setViewportSize({width:620,height:900});await page.evaluate(()=>{document.documentElement.style.zoom='2';});await more.click();await page.getByRole('button',{name:'外观',exact:true}).click();await expect(page.getByRole('button',{name:'恢复默认界面'})).toBeVisible();await page.getByRole('button',{name:'恢复默认界面'}).focus();await page.keyboard.press('Enter');await expect(more).toHaveAttribute('aria-expanded','false');
  await more.click();await page.getByRole('button',{name:'导出',exact:true}).click();await expect(dialog).toBeVisible();await page.getByRole('button',{name:'关闭导出'}).click();await expect(dialog).toHaveCount(0);
 }finally{await app.close();}
});
