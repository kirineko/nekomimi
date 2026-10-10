import {test,expect} from '@playwright/test';
import {resolve} from 'node:path';
import {startWeb} from '../../src/server/app.js';
import {temporary,key,response,textItem} from '../helpers.js';
test('context detail follows theme, supports keyboard/outside dismissal and keeps drafts across compact',async({page},info)=>{
 const app=await startWeb({workspace:await temporary(),home:await temporary(),apiKey:key,naming:false,staticDir:resolve('dist/web-dist'),runtime:{fetch:async()=>response([textItem('complete')])}});
 try{
  const session=await app.sessions.create('上下文验收');
  await page.goto(`${app.origin}/work/session/${session.id}#token=${app.token}`);
  const input=page.getByLabel('任务草稿',{exact:true}),trigger=page.getByRole('button',{name:/^上下文/}),dialog=page.getByRole('dialog',{name:'上下文详情',exact:true});
  await input.fill('hello');await page.getByRole('button',{name:'发送',exact:true}).click();await expect(page.getByText('complete',{exact:true})).toBeVisible();await expect(trigger).toHaveText(/^上下文 \d+%$/);
  await input.fill('保留草稿');await trigger.focus();await page.keyboard.press('Enter');
  const measurement=page.getByRole('region',{name:'当前上下文统计'});
  await expect(measurement).toContainText(/估算 [\d,]+ tokens/);await expect(measurement).toContainText(/\d+% \/ [\d,]+ tokens/);
  await expect(measurement.getByText('系统提示 / 工具 / 对话',{exact:true})).toBeVisible();
  // 默认概要不含预留/策略；展开“技术详情”后才可见
  await expect(measurement.getByText('输出 / 安全 / 工具结果预留',{exact:true})).toBeHidden();
  await measurement.getByText('技术详情',{exact:true}).click();await expect(measurement.getByText('输出 / 安全 / 工具结果预留',{exact:true})).toBeVisible();
  await page.keyboard.press('Escape');await expect(trigger).toBeFocused();await expect(trigger).toHaveAttribute('aria-expanded','false');await expect(input).toHaveJSProperty('textContent','保留草稿');
  await trigger.click();await expect(dialog).toBeVisible();await expect(page.getByRole('button',{name:'关闭详情',exact:true})).toBeFocused();await page.mouse.click(2,2);await expect(dialog).toHaveCount(0);await expect(trigger).toBeFocused();
  await page.goto(`${new URL(page.url()).origin}/work/settings`);
  const toggle=page.getByRole('switch',{name:/^自动整理上下文/});await expect(toggle).toHaveAttribute('aria-checked','true');await toggle.click();await expect(toggle).toHaveAttribute('aria-checked','false');
  await page.getByRole('button',{name:'审阅并保存设置',exact:true}).click();await page.getByRole('button',{name:'确认保存设置',exact:true}).click();await expect(page.getByText('设置已保存。',{exact:true})).toBeVisible();
  await page.locator(`[data-session-title][href="/work/session/${session.id}"]`).click();await expect(input).toHaveJSProperty('textContent','保留草稿');
  await input.fill('/comp');await expect(page.getByRole('option').filter({hasText:'/compact'})).toBeVisible();await input.press('Tab');await expect(input).toHaveJSProperty('textContent','/compact ');await input.press('Enter');
  await expect(page.getByText('暂无可压缩的早期内容',{exact:true})).toBeVisible();await expect(input).toBeFocused();
  await page.reload();await expect(trigger).toHaveText(/^上下文 \d+%$/);await expect(page.getByRole('button',{name:'发送',exact:true})).toBeInViewport({ratio:1});
  await page.screenshot({path:info.outputPath('composer-default.png')});await trigger.click();await expect(dialog).toContainText(/\d+% \/ [\d,]+ tokens/);await expect(dialog).not.toContainText(/~\d+%/);await page.screenshot({path:info.outputPath('context-default.png')});
  await page.evaluate(()=>{document.documentElement.style.setProperty('--brand','#d64286');document.documentElement.style.setProperty('--surface','#fff5f9');});
  await expect(page.locator('[role="meter"] > span')).toHaveCSS('background-color','rgb(214, 66, 134)');await expect(dialog).toHaveCSS('background-color','rgb(255, 245, 249)');
  await page.setViewportSize({width:360,height:740});const rect=await dialog.boundingBox();expect(rect!.x).toBeGreaterThanOrEqual(0);expect(rect!.x+rect!.width).toBeLessThanOrEqual(360);
  await page.evaluate(()=>document.documentElement.style.fontSize='20px');await page.screenshot({path:info.outputPath('context-theme-narrow.png')});expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
  await page.getByRole('button',{name:'关闭详情',exact:true}).click();await expect(trigger).toBeFocused();
 }finally{await app.close();}
});
