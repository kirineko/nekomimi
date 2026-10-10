import { test, expect } from '@playwright/test';
import { resolve } from 'node:path';
import { startWeb } from '../../src/server/app.js';
import { ProviderProfiles } from '../../src/customization/provider-profiles.js';
import { temporary } from '../helpers.js';
async function fixture(overrides=false) {
  const workspace=await temporary(),home=await temporary();let calls=0;
  const app=await startWeb({workspace,home,naming:false,staticDir:resolve('dist/web-dist'),...(overrides?{apiKey:'runtime-only-secret',model:'runtime-model',baseUrl:'https://runtime.invalid'}:{}),runtime:{fetch:async()=>{calls++;throw Error('Settings must not call model');}}});
  return {app,home,calls:()=>calls};
}
test('10.4 settings preserve drafts across refresh and require explicit revision adoption after conflict',async({page})=>{
  const f=await fixture();let writes=0;
  page.on('request',request=>{if(request.method()==='POST'&&request.url().endsWith('/settings'))writes++;});
  try {
    await page.goto(f.app.origin+'/work/settings#token='+f.app.token);
    await page.getByLabel('默认模型',{exact:true}).fill('draft-model');await page.getByRole('switch',{name:'网页搜索：开启',exact:true}).click();
    await page.getByRole('button',{name:'刷新设置状态',exact:true}).click();await expect(page.getByLabel('默认模型',{exact:true})).toHaveValue('draft-model');expect(writes).toBe(0);
    await page.getByRole('button',{name:'审阅并保存设置',exact:true}).click();await page.keyboard.press('Escape');await expect(page.getByRole('button',{name:'审阅并保存设置',exact:true})).toBeFocused();expect(writes).toBe(0);
    await page.getByRole('button',{name:'审阅并保存设置',exact:true}).click();
    const initial=await f.app.sessions.config.describe();await f.app.sessions.config.save('settings',{...initial,revision:initial.revision,model:'other-window'});
    await page.getByRole('button',{name:'确认保存设置',exact:true}).click();await expect(page.getByRole('dialog')).toContainText('配置已更新');expect(writes).toBe(1);
    await expect(page.getByRole('button',{name:'确认保存设置',exact:true})).toBeDisabled();await page.getByRole('button',{name:'取消保存',exact:true}).click();
    await expect(page.getByLabel('默认模型',{exact:true})).toHaveValue('draft-model');await expect(page.getByRole('region',{name:'设置修订冲突',exact:true})).toContainText('other-window');
    await page.getByRole('button',{name:'保留草稿并采用最新修订',exact:true}).click();await page.getByRole('button',{name:'审阅并保存设置',exact:true}).click();await page.getByRole('button',{name:'确认保存设置',exact:true}).click();
    await expect(page.getByText('设置已保存。',{exact:true})).toBeVisible();expect(writes).toBe(2);
    expect(await f.app.sessions.config.describe()).toMatchObject({model:'draft-model',search:{enabled:false},autoCompact:true});
    await page.reload();await expect(page.getByLabel('默认模型',{exact:true})).toHaveValue('draft-model');expect(f.calls()).toBe(0);
  }finally{await f.app.close();}
});
test('10.4 uncertain credential writes clear and redact input; clearing local key does not clear runtime override',async({page})=>{
  const f=await fixture(true);let writes=0;const secret='browser-settings-secret';
  try{
    await page.route('**/api/v1/settings',async route=>{
      writes++;if(writes===1){const response=await route.fetch();expect(response.ok()).toBe(true);await route.fulfill({status:500,contentType:'application/json',body:JSON.stringify({error:{code:'injected',message:'response lost '+secret}})});return;}await route.continue();
    });
    await page.goto(f.app.origin+'/create/settings#token='+f.app.token);await expect(page.getByRole('region',{name:'运行时默认配置',exact:true})).toContainText('runtime-model');
    await page.getByLabel('默认 DeepSeek API key',{exact:true}).fill(secret);await page.getByRole('button',{name:'保存默认凭证',exact:true}).click();
    await expect(page.getByLabel('默认 DeepSeek API key',{exact:true})).toHaveValue('');await expect(page.getByRole('alert')).toContainText('[已隐藏凭证]');
    expect(await page.locator('body').innerText()).not.toContain(secret);expect(writes).toBe(1);
    await expect(page.getByRole('region',{name:'默认模型凭证',exact:true})).toContainText('本地保存：已配置');await expect(page.getByRole('button',{name:'保存默认凭证',exact:true})).toBeDisabled();
    await page.getByRole('button',{name:'清除本地默认凭证',exact:true}).click();await page.getByRole('button',{name:'取消清除',exact:true}).click();expect(writes).toBe(1);
    await page.getByRole('button',{name:'清除本地默认凭证',exact:true}).click();await page.getByRole('button',{name:'确认清除凭证',exact:true}).click();
    await expect(page.getByRole('region',{name:'默认模型凭证',exact:true})).toContainText('本地保存：未配置；运行时默认凭证：已配置');expect((await f.app.sessions.config.snapshot()).apiKey).toBeUndefined();
    expect((await f.app.sessions.settings()).apiKey).toBe('runtime-only-secret');expect(f.calls()).toBe(0);
    const config=await (await page.request.get(f.app.origin+'/api/v1/config')).json();expect(JSON.stringify(config)).not.toContain('runtime-only-secret');expect(config.storedCredentialConfigured).toBe(false);expect(config.runtimeDefault.overrides.credential).toBe(true);
    expect(await page.evaluate(()=>JSON.stringify([localStorage,sessionStorage]))).not.toContain(secret);
  }finally{await f.app.close();}
});
test('10.4 custom profile without a key does not imply a default credential; narrow settings remain usable',async({page})=>{
  const f=await fixture();const profiles=new ProviderProfiles(f.home);
  try{
    await profiles.save({id:'missing',providerId:'deepseek',resourceId:'builtin:deepseek',model:'fixture',baseUrl:'https://fixture.invalid',paths:['/responses'],credentialRef:'missing'},0);await profiles.select('work','missing',1);
    await page.setViewportSize({width:360,height:760});await page.goto(f.app.origin+'/work/settings#token='+f.app.token);
    await expect(page.getByRole('region',{name:'默认模型凭证',exact:true})).toContainText('本地保存：未配置；运行时默认凭证：未配置');
    await page.getByRole('switch',{name:'自动整理上下文：开启',exact:true}).click();await page.getByRole('button',{name:'审阅并保存设置',exact:true}).click();await page.getByRole('button',{name:'确认保存设置',exact:true}).click();
    await expect(page.getByText('设置已保存。',{exact:true})).toBeVisible();expect((await f.app.sessions.config.describe()).autoCompact).toBe(false);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect(f.calls()).toBe(0);
  }finally{await f.app.close();}
});
