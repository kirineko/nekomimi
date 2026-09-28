import {test,expect} from '@playwright/test';
import {resolve} from 'node:path';
import {startWeb} from '../../src/server/app.js';
import {temporary,key,response,textItem} from '../helpers.js';
test('context detail follows theme, supports keyboard/outside dismissal and keeps drafts across compact',async({page},info)=>{
 const app=await startWeb({workspace:await temporary(),home:await temporary(),apiKey:key,naming:false,staticDir:resolve('dist/web-dist'),runtime:{fetch:async()=>response([textItem('complete')])}});
 try{
 await page.goto(app.url);const input=page.getByRole('textbox',{name:'任务内容'}),trigger=page.getByRole('button',{name:'上下文占用明细'});
 await input.fill('hello');await page.getByRole('button',{name:'发送任务'}).click();await expect(page.getByText('complete',{exact:true})).toBeVisible();await expect(trigger).toContainText('%');
 await input.fill('保留草稿');await trigger.focus();await page.keyboard.press('Enter');await expect(page.getByRole('region',{name:'上下文占用'})).toBeVisible();await expect(page.getByText('系统提示词',{exact:true})).toBeVisible();await expect(page.getByText('工具定义',{exact:true})).toBeVisible();await expect(page.getByText('对话消息',{exact:true})).toBeVisible();
 await page.keyboard.press('Escape');await expect(trigger).toBeFocused();await expect(trigger).toHaveAttribute('aria-expanded','false');await expect(input).toHaveValue('保留草稿');
 await trigger.click();await input.click({position:{x:8,y:8}});await expect(trigger).toHaveAttribute('aria-expanded','false');
 await page.getByRole('button',{name:'设置',exact:true}).click();const toggle=page.getByRole('switch',{name:'自动整理上下文'});await expect(toggle).toHaveAttribute('aria-checked','true');await toggle.click();await expect(toggle).toHaveAttribute('aria-checked','false');await page.keyboard.press('Escape');await expect(input).toHaveValue('保留草稿');
 await input.fill('/comp');await expect(page.getByRole('option').filter({hasText:'/compact'})).toBeVisible();await input.press('Tab');await expect(input).toHaveValue('/compact ');await input.press('Enter');await expect(page.getByText('暂无可压缩的早期内容',{exact:true})).toBeVisible();await expect(input).toBeFocused();
 await page.reload();await expect(trigger).toContainText('%');await trigger.click();await page.screenshot({path:info.outputPath('context-default.png')});
 await page.evaluate(()=>{document.documentElement.style.setProperty('--accent','#d64286');document.documentElement.style.setProperty('--surface','#fff5f9');});await expect(page.locator('.context-ring')).toHaveCSS('stroke','rgb(214, 66, 134)');await expect(page.locator('.context-popover')).toHaveCSS('background-color','rgb(255, 245, 249)');
 await page.setViewportSize({width:360,height:740});await trigger.click();if(await trigger.getAttribute('aria-expanded')==='false')await trigger.click();const rect=await page.locator('.context-popover').boundingBox();expect(rect!.x).toBeGreaterThanOrEqual(0);expect(rect!.x+rect!.width).toBeLessThanOrEqual(360);
 await page.evaluate(()=>document.documentElement.style.fontSize='20px');await page.screenshot({path:info.outputPath('context-theme-narrow.png')});expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
 }finally{await app.close();}
});
