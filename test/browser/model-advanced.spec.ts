import { test, expect } from '@playwright/test';
import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { startWeb } from '../../src/server/app.js';
import { ProviderProfiles } from '../../src/customization/provider-profiles.js';
import { ConfigStore } from '../../src/config/store.js';
import { temporary } from '../helpers.js';
import { readSession } from '../../src/journal.js';
import { sessionBinding } from '../../src/session/identity.js';

test('10.4 migration uses reviewed revision and preserves existing purpose choices without exposing secrets', async ({ page }) => {
  const workspace=await temporary(),home=await temporary(),profiles=new ProviderProfiles(home);
  await new ConfigStore(home).save('auth',{revision:0,apiKey:'migration-browser-secret'});
  await profiles.save({id:'existing',providerId:'deepseek',resourceId:'builtin:deepseek',model:'deepseek-v4-pro',baseUrl:'https://api.deepseek.com',paths:['/responses']},0);
  await profiles.select('create','existing',1);
  const app=await startWeb({workspace,home,naming:false,staticDir:resolve('dist/web-dist')});let migrations=0;
  page.on('request',request=>{if(request.method()==='POST'&&request.url().endsWith('/customization')&&request.postDataJSON().action==='provider-migrate')migrations++;});
  try {
    await page.goto(app.origin+'/work/models#token='+app.token);
    await page.getByRole('button',{name:'备份并迁移原 DeepSeek 配置',exact:true}).click();
    await page.getByRole('button',{name:'取消操作',exact:true}).click();expect(migrations).toBe(0);
    await page.getByRole('button',{name:'备份并迁移原 DeepSeek 配置',exact:true}).click();
    await profiles.select('work','existing',2);
    await page.getByRole('button',{name:'确认备份并迁移原 DeepSeek 配置',exact:true}).click();
    await expect(page.getByRole('dialog')).toContainText('迁移配置修订已变化');expect(migrations).toBe(1);
    await expect(page.getByRole('button',{name:'确认备份并迁移原 DeepSeek 配置',exact:true})).toBeDisabled();
    await page.getByRole('button',{name:'取消操作',exact:true}).click();
    await page.getByRole('button',{name:'备份并迁移原 DeepSeek 配置',exact:true}).click();
    await page.getByRole('button',{name:'确认备份并迁移原 DeepSeek 配置',exact:true}).click();
    await expect(page.getByText('已存在迁移配置，不能覆盖迁移。',{exact:true})).toBeVisible();
    expect((await profiles.list()).selection).toMatchObject({create:'existing',work:'existing',main:'legacy-deepseek'});
    expect(await page.locator('body').innerText()).not.toContain('migration-browser-secret');expect(migrations).toBe(2);
  } finally {await app.close();}
});
for(const mode of ['work','create'] as const) test(`10.4 ${mode} history branch explicit retry after lost response preserves target and creates once`,async({page})=>{
  const workspace=await temporary(),home=await temporary(),development=await temporary();let calls=0;
  const app=await startWeb({workspace,home,naming:false,staticDir:resolve('dist/web-dist'),runtime:{fetch:async()=>{calls++;throw Error('unexpected model call');}}});
  try {
    const source=await app.sessions.create('分支来源',{commandId:'branch-source',mode,...(mode==='create'?{target:{kind:'extension' as const,root:development,scope:'project' as const}}:{})});
    const before=await readFile(join(app.sessions.root,source.id,'journal.jsonl'));const commands:string[]=[];
    await page.route('**/api/v1/customization',async route=>{
      if(route.request().method()==='POST'&&route.request().postDataJSON().action==='history-branch') {
        commands.push(route.request().postDataJSON().commandId);
        if(commands.length===1){const response=await route.fetch();expect(response.ok()).toBe(true);await route.abort('failed');return;}
      }
      await route.continue();
    });
    await page.goto(app.origin+`/${mode}/session/${source.id}/models#token=`+app.token);
    await page.getByRole('button',{name:'创建跨 Provider 历史分支',exact:true}).click();
    await page.getByRole('button',{name:'取消分支',exact:true}).click();expect(commands).toHaveLength(0);
    await page.getByRole('button',{name:'创建跨 Provider 历史分支',exact:true}).click();
    await page.getByRole('button',{name:'确认创建历史分支',exact:true}).click();
    await expect(page.getByRole('dialog')).toContainText('创建未确认');expect(commands).toHaveLength(1);
    await page.getByRole('button',{name:'确认创建历史分支',exact:true}).click();
    await expect(page.getByRole('link',{name:'打开历史分支',exact:true})).toBeVisible();
    expect(commands).toHaveLength(2);expect(commands[0]).toBe(commands[1]);expect(await readdir(app.sessions.root)).toHaveLength(2);
    const events=(await readSession(join(app.sessions.root,commands[0]!))).events;
    expect(sessionBinding(events)?.target).toEqual(source.binding!.target);expect(sessionBinding(events)?.mode).toBe(mode);
    expect(await readFile(join(app.sessions.root,source.id,'journal.jsonl'))).toEqual(before);expect(calls).toBe(0);
    await page.getByRole('link',{name:'打开历史分支',exact:true}).click();await expect(page).toHaveURL(new RegExp(`/${mode}/session/${commands[0]}$`));
    await page.reload();expect(commands).toHaveLength(2);expect(calls).toBe(0);
  } finally {await app.close();}
});

test('10.4 reasoning conversion needs explicit consent and keeps original evidence', async ({page})=>{
  const workspace=await temporary(),home=await temporary();
  const app=await startWeb({workspace,home,naming:false,staticDir:resolve('dist/web-dist')});
  try {
    const source=await app.sessions.create('含推理证据');
    const {Journal}=await import('../../src/journal.js');
    const journal=await Journal.open(join(app.sessions.root,source.id));
    await journal.append('context.add',{source:'fixture',item:{type:'reasoning',id:'reasoning-fixture',summary:[{type:'summary_text',text:'Original reasoning evidence'}]}});await journal.close();
    await page.goto(app.origin+`/work/session/${source.id}/models#token=`+app.token);
    await page.getByRole('button',{name:'创建跨 Provider 历史分支',exact:true}).click();await page.getByRole('button',{name:'确认创建历史分支',exact:true}).click();
    await expect(page.getByRole('dialog')).toContainText('需要明确同意');expect(await readdir(app.sessions.root)).toHaveLength(1);
    await page.getByRole('checkbox',{name:'允许新分支省略供应商专属 reasoning，保留其原始证据',exact:true}).check();
    await page.getByRole('button',{name:'确认创建历史分支',exact:true}).click();await expect(page.getByRole('link',{name:'打开历史分支',exact:true})).toBeVisible();
    const target=(await readdir(app.sessions.root)).find(id=>id!==source.id)!;
    const branch=await readSession(join(app.sessions.root,target));
    expect(branch.events.filter(event=>event.type==='context.add').some(event=>(event.payload as any).item?.type==='reasoning')).toBe(false);
    const metadata=branch.events.find(event=>event.type==='branch.created')!.payload as any;
    expect(metadata.omittedReasoning).toBe(1);expect(metadata.omitReasoning).toBe(true);
    const {readArtifact}=await import('../../src/journal.js');expect((await readArtifact(join(app.sessions.root,target),metadata.sourceEvents)).toString()).toContain('Original reasoning evidence');
  } finally {await app.close();}
});
