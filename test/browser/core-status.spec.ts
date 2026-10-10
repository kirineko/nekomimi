import { test, expect } from '@playwright/test';
import { startWeb } from '../../src/server/app.js';
import { temporary } from '../helpers.js';
import { resolve } from 'node:path';
import { enableDeveloperView, chooseSetting } from './fixtures/workbench.js';

test('shows the observed service build in the developer view and in 版本与恢复',async({page})=>{
  const app=await startWeb({workspace:await temporary(),home:await temporary(),naming:false,staticDir:resolve('dist/web-dist')});
  try{
    const actual=await(await fetch(app.origin+'/api/v1/core/status',{headers:{authorization:`Bearer ${app.token}`}})).json();
    // 默认视图：顶栏无运行版本，也无“版本恢复”常驻按钮
    await page.goto(`${app.origin}/work#token=${app.token}`);
    await expect(page.getByRole('button',{name:'发送',exact:true})).toHaveCount(0);
    await expect(page.getByTestId('core-running-version')).toHaveCount(0);
    await expect(page.getByRole('button',{name:'版本恢复',exact:true})).toHaveCount(0);

    // 版本与恢复：完整构建与启动方式诊断
    await chooseSetting(page,'版本与恢复');
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByRole('dialog')).toContainText(actual.identity.build);
    await page.keyboard.press('Escape');

    // 开发者视图：顶栏显示截断构建 hash
    await enableDeveloperView(page);
    await page.goto(`${app.origin}/work#token=${app.token}`);
    const badge=page.getByTestId('core-running-version');await expect(badge).toContainText(actual.identity.build.slice(0,8));
  }finally{await app.close();}
});
test('refreshes managed build identity and never labels cached identity current after a connection failure',async({page})=>{
  let build='a'.repeat(64),failed=false;
  const app=await startWeb({workspace:await temporary(),home:await temporary(),naming:false,staticDir:resolve('dist/web-dist'),coreControl:async()=>{if(failed)throw Error('Synthetic disconnect');return{mode:'managed',phase:'running',switchSupported:true,identity:{version:'0.2.1',build}};}});
  try{
    await enableDeveloperView(page);
    await page.goto(`${app.origin}/work#token=${app.token}`);await expect(page.getByTestId('core-running-version')).toContainText('aaaaaaaa');
    build='b'.repeat(64);await expect(page.getByTestId('core-running-version')).toContainText('bbbbbbbb',{timeout:10000});
    failed=true;await expect(page.getByText('版本待确认',{exact:true})).toBeVisible({timeout:10000});await expect(page.getByTestId('core-running-version')).toHaveCount(0);
    // 异常状态点击直达恢复
    await page.getByText('版本待确认',{exact:true}).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    failed=false;await expect(page.getByTestId('core-running-version')).toContainText('bbbbbbbb',{timeout:10000});
  }finally{await app.close();}
});
