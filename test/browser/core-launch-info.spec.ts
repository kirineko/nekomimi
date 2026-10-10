import { test, expect } from '@playwright/test';
import { join, resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import { CoreBuilds } from '../../src/core/builds.js';
import { Journal } from '../../src/journal.js';
import { startWeb } from '../../src/server/app.js';
import { coreViewFixture } from '../fixtures/core-view.js';

test('10.8 unmanaged source host exposes only verified launch instructions and explicit recovery diagnostics',async({page})=>{
  const f=await coreViewFixture(),buildId='launch-info-build',revision='a'.repeat(64);
  const journal=await Journal.open(join(f.home,'core-builds','journal'));
  const links={candidateId:f.candidate.id,validationTaskId:buildId};
  await journal.append('core.build.intent',{buildId,commandId:'display-build',candidateId:f.candidate.id,plan:{sourceRevision:f.candidate.source.revision}},links);
  await journal.append('core.build.finished',{buildId,status:'passed',artifact:{directory:resolve('.'),revision},processes:[],applied:false,hostIntegration:'not_run'},links);await journal.close();
  const before=await readFile(join(f.home,'core-builds','journal','journal.jsonl'));
  const original=CoreBuilds.prototype.inspect;let valid=true;
  // Admission fixture only; the route still checks session/candidate ownership.
  CoreBuilds.prototype.inspect=async function(id){if(this.candidates.home!==f.home||id!==buildId)return original.call(this,id);return{validForCurrent:valid,result:{buildId,candidateId:f.candidate.id,artifact:{directory:resolve('.'),revision}}} as any;};
  const app=await startWeb({workspace:f.workspace,home:f.home,naming:false,staticDir:resolve('dist/web-dist')});
  const posts:string[]=[];page.on('request',request=>{if(request.method()==='POST'&&!request.url().endsWith('/connect'))posts.push(request.url());});
  try{
    const session=await app.sessions.create('手动启动目标',{commandId:'manual-core',mode:'create',target:{kind:'core',root:f.candidate.directory}});
    await page.goto(`${app.origin}/create/session/${session.id}/core#token=${app.token}`);await page.getByRole('tab',{name:'构建与验证记录',exact:true}).click();
    const instructions=page.getByRole('region',{name:'手动启动指引',exact:true});
    await expect(instructions).toContainText('当前启动方式不支持托管切换');await expect(page.getByRole('button',{name:'审阅版本切换计划',exact:true})).toHaveCount(0);
    await page.getByLabel('手动启动的构建',{exact:true}).selectOption(buildId);await page.getByRole('button',{name:'核验手动启动路径',exact:true}).click();
    await expect(instructions).toContainText('尚未启动或应用');await expect(instructions.locator('pre')).toContainText(resolve('dist/cli.js'));await expect(instructions.locator('pre')).toContainText(f.workspace);await expect(instructions.locator('pre')).toContainText(f.home);
    valid=false;await page.getByRole('button',{name:'核验手动启动路径',exact:true}).click();await expect(instructions.getByRole('alert')).toContainText('候选构建已失效，请重新构建');await expect(instructions.locator('pre')).toHaveCount(0);
    await page.getByRole('button',{name:'设置',exact:true}).click();await page.getByRole('menuitem',{name:'版本与恢复',exact:true}).click();await expect(page.getByRole('dialog')).toContainText('当前为源码入口');
    await expect(page.getByRole('dialog')).toContainText('core recover-plan');await expect(page.getByRole('heading',{name:'已确认运行目标构建',exact:true})).toHaveCount(0);
    expect(posts).toEqual([]);expect(await readFile(join(f.home,'core-builds','journal','journal.jsonl'))).toEqual(before);
  }finally{await app.close();CoreBuilds.prototype.inspect=original;}
});
