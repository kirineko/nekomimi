import { test,expect } from '@playwright/test';
import { join,resolve } from 'node:path';
import { readFile,writeFile } from 'node:fs/promises';
import { startWeb } from '../../src/server/app.js';
import { Candidates } from '../../src/customization/candidates.js';
import { temporary } from '../helpers.js';
import { setDeveloperView } from './fixtures/workbench.js';

test('project delivery reviews and authorizes the exact candidate, preserves the work draft and does not repeat a lost-response installation',async({page})=>{
  const workspace=await temporary(),home=await temporary(),development=await temporary();
  const app=await startWeb({workspace,home,apiKey:"fixture",naming:false,staticDir:resolve('dist/web-dist'),runtime:{fetch:async()=>{throw Error('No model calls');}}});
  try {
    const work=await app.sessions.create('原工作'),create=await app.sessions.create('开发审查',{commandId:'create-review',mode:'create',target:{kind:'extension',root:development}});
    const store=new Candidates(development),candidate=await store.scaffold('review');
    const marker=join(workspace,'factory-effects');
    await writeFile(join(candidate.path,'index.ts'),`import {appendFileSync} from 'node:fs';appendFileSync(${JSON.stringify(marker)},'loaded\\n');export default (api:import('nekomimi/extensions').ExtensionAPI)=>{api.registerCommand('review',{description:'review',async handler(){return 'installed project review'}})};`);
    const checked=await store.inspect(candidate.id);
    const draft={version:1 as const,goal:'交付原项目审查',target:{sessionId:work.id},delivery:[{candidateId:candidate.id,resourceId:checked.resource.id,revision:checked.resource.hash,type:'commands',usage:'审阅后安装到原项目，使用 /review'}]};
    const preview=await app.sessions.handoffPreview(create.id,draft);
    const delivered=await app.sessions.confirmHandoff(create.id,{version:1,confirmed:true,commandId:'deliver-review',payloadHash:preview.payloadHash,draft});
    await page.goto(`${app.origin}/work/session/${work.id}#token=${app.token}`);
    await page.getByLabel('任务草稿',{exact:true}).fill('保留原工作的下一步草稿');
    const card=page.getByRole('article',{name:`交付 ${delivered.handoffId}`,exact:true});
    await card.getByRole('link',{name:'查看交付版本候选',exact:true}).click();
    await page.getByRole('button',{name:'审阅项目安装',exact:true}).click();
    const install=page.getByRole('region',{name:'安装到工作项目',exact:true});
    await expect(install).toContainText(app.sessions.workspace);
    await expect(readFile(marker)).rejects.toThrow();
    await install.getByRole('button',{name:'授权并安装到工作项目',exact:true}).click();
    await page.getByRole('button',{name:'取消操作',exact:true}).click();await expect(readFile(marker)).rejects.toThrow();
    const commandIds:string[]=[];
    await page.route('**/api/v1/customization',async route=>{
      const request=route.request();
      if(request.method()==='POST'&&request.postDataJSON()?.action==='candidate-delivery-apply') {
        commandIds.push(request.postDataJSON().commandId);
        if(commandIds.length===1){await route.fetch();await route.abort('failed');return;}
      }
      await route.continue();
    });
    await install.getByRole('button',{name:'授权并安装到工作项目',exact:true}).click();
    await page.getByRole('button',{name:'确认授权并安装到工作项目',exact:true}).click();
    await expect(page.getByRole('alert').filter({hasText:'操作未确认'})).toBeVisible();
    await expect.poll(()=>readFile(marker,'utf8')).toBe('loaded\n');
    await page.getByRole('button',{name:'取消操作',exact:true}).click();
    await install.getByRole('button',{name:'授权并安装到工作项目',exact:true}).click();
    await page.getByRole('button',{name:'确认授权并安装到工作项目',exact:true}).click();
    await expect(install.getByRole('status')).toContainText('activated');
    expect(commandIds).toHaveLength(2);expect(commandIds[1]).toBe(commandIds[0]);expect(await readFile(marker,'utf8')).toBe('loaded\n');
    await page.getByRole('link',{name:'返回工作交付位置',exact:true}).click();
    await expect(page.getByLabel('任务草稿',{exact:true})).toHaveJSProperty('textContent','保留原工作的下一步草稿');
    await setDeveloperView(page, true); await page.getByRole('button',{name:'刷新交接记录',exact:true}).click();await expect(card).toContainText('当前工作状态：可用');
    await page.getByLabel('任务草稿',{exact:true}).fill('/review');await page.getByRole('button',{name:'发送',exact:true}).click();
    await expect(page.getByText('installed project review',{exact:true})).toBeVisible();
  } finally {await app.close();}
});
