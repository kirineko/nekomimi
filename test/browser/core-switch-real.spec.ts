import { test, expect } from '@playwright/test';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, relative, resolve } from 'node:path';
import { CoreInstallation } from '../../src/core/installation.js';
import { CoreBuilds } from '../../src/core/builds.js';
import { CoreValidations } from '../../src/core/validations.js';
import { launchManagedCore, type ManagedCoreHandle } from '../../src/core/managed.js';
import { coreTreeManifest } from '../../src/core/manifest.js';
import { portClosed } from '../../src/core/validation.js';
import { temporary } from '../helpers.js';

async function identity(directory: string) {
  const root=join(directory,'dist'),digest=createHash('sha256');
  const walk=async(path:string):Promise<void>=>{for(const item of (await readdir(path,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){const file=join(path,item.name);if(item.isDirectory())await walk(file);else if(item.name!=='build-identity.json')digest.update(relative(root,file)).update('\0').update(await readFile(file)).update('\0');}};
  await walk(root);const build=digest.digest('hex');await writeFile(join(root,'build-identity.json'),JSON.stringify({version:1,sha256:build}));return build;
}

test('10.8 browser confirmation replaces real compiled Web children and restores the receipt independently of the old candidate page',async({page})=>{
  const root=await temporary(),workspace=join(root,'workspace'),home=join(root,'home');await mkdir(workspace);await mkdir(home);
  await mkdir(resolve('node_modules/.cache'),{recursive:true});const directory=await mkdtemp(resolve('node_modules/.cache/core-ui-'));
  const old=join(directory,'old'),next=join(directory,'next');
  for(const path of [old,next]){await mkdir(path);await cp(resolve('dist'),join(path,'dist'),{recursive:true});await cp(resolve('package.json'),join(path,'package.json'));}
  await writeFile(join(next,'dist','ui-switch-fixture.txt'),'distinct immutable build for browser identity verification');
  const nextBuild=await identity(next),oldRevision=(await coreTreeManifest(old)).revision,nextRevision=(await coreTreeManifest(next)).revision;
  const installation=await CoreInstallation.locate({entry:resolve('dist/cli.js'),registry:join(root,'registry')});
  // Only source/build/isolated-validation admission and the display catalogue are fixtures.
  // Both Web processes, authenticated HTTP/IPC, gates, port reuse, identity,
  // durable switch receipts and installation recovery observations are real.
  const builds={candidates:{ownerWorkspace:workspace,home},inspect:async()=>({validForCurrent:true,result:{buildId:'old-build',candidateId:'old-candidate',artifact:{directory:old,revision:oldRevision}}})} as unknown as CoreBuilds;
  const validations={builds,inspect:async()=>({validForCurrent:true,result:{buildId:'old-build',candidateId:'old-candidate',artifactRevision:oldRevision}})} as unknown as CoreValidations;
  const inspectBuild=CoreBuilds.prototype.inspect,inspectValidation=CoreValidations.prototype.inspect;
  CoreBuilds.prototype.inspect=async function(id){if(this.candidates.home!==home)return inspectBuild.call(this,id);return{validForCurrent:true,result:{buildId:'next-build',candidateId:'next-candidate',artifact:{directory:next,revision:nextRevision}}} as any;};
  CoreValidations.prototype.inspect=async function(id){if(this.builds.candidates.home!==home)return inspectValidation.call(this,id);return{validForCurrent:true,result:{buildId:'next-build',candidateId:'next-candidate',artifactRevision:nextRevision,report:{checks:['core-switch-control']}}} as any;};
  let managed:ManagedCoreHandle|undefined;
  try{
    managed=await launchManagedCore(validations,{validationId:'initial',artifactRevision:oldRevision,authorize:true},{installation});
    const oldBuild=managed.identity.build,origin=managed.origin,token=new URL(managed.url).hash.slice('#token='.length);
    const response=await fetch(origin+'/api/v1/sessions',{method:'POST',headers:{authorization:`Bearer ${token}`,origin,'content-type':'application/json'},body:JSON.stringify({version:1,title:'切换观察会话',mode:'work',commandId:'observe'})});
    expect(response.status).toBe(201);const session=await response.json() as {id:string};
    await page.route('**/core-operations',route=>route.fulfill({json:[]}));
    await page.route('**/core-candidate',route=>managed!.identity.build!==oldBuild?route.fulfill({status:409,json:{error:{code:'host_changed',message:'旧目标绑定已变化'}}}):route.fulfill({json:{id:'next-candidate',directory:next,sourceRoot:root,baselineRevision:'a'.repeat(64),currentRevision:'a'.repeat(64),target:{host:{build:oldBuild}},hostMatches:true,preparedAt:new Date().toISOString(),packageVersion:'0.2.1',lockHash:'b'.repeat(64),buildCommand:'fixture admission',files:[],excluded:[],historyErrors:[],omittedTasks:0,tasks:[{id:'next-validation',commandId:'validation-fixture',kind:'validation',status:'passed',buildId:'next-build',artifactRevision:nextRevision,startedAt:new Date().toISOString(),checks:[],logs:[],omittedLogs:0}]}}));
    await page.goto(`${origin}/create/session/${session.id}/core#token=${token}`);
    await page.getByRole('tab',{name:'构建与验证记录',exact:true}).click();
    await page.getByLabel('切换目标验证',{exact:true}).selectOption('next-validation');
    await page.getByRole('button',{name:'审阅版本切换计划',exact:true}).click();
    await expect(page.getByRole('dialog')).toContainText(nextBuild);await expect(page.getByRole('dialog')).toContainText(nextRevision);
    await page.getByLabel('我已核对目标构建、产物摘要和影响目录，授权本次切换',{exact:true}).check();
    await page.getByRole('button',{name:'确认切换核心版本',exact:true}).click();
    await expect(page.getByRole('heading',{name:'已确认运行目标构建',exact:true})).toBeVisible({timeout:20000});
    expect(managed.identity.build).toBe(nextBuild);expect(managed.origin).toBe(origin);
    await page.reload();await expect(page.getByRole('heading',{name:'核心候选不可读',exact:true})).toBeVisible();
    await page.getByRole('button',{name:'设置',exact:true}).click();await page.getByRole('menuitem',{name:'版本与恢复',exact:true}).click();
    await expect(page.getByRole('dialog').getByRole('heading',{name:'已确认运行目标构建',exact:true})).toBeVisible();
    await expect(page.getByRole('dialog')).toContainText(oldBuild);await expect(page.getByRole('dialog')).toContainText(nextBuild);
    const events=(await installation.read()).events;
    expect(events.filter(event=>event.type==='core.switch.intent')).toHaveLength(1);
    expect(events.filter(event=>event.type==='core.switch.finished')).toEqual([expect.objectContaining({payload:expect.objectContaining({status:'applied',actualBuild:nextBuild})})]);
    const pids=events.filter(event=>event.type==='core.launch.process.started').map(event=>(event.payload as {pid:number}).pid);expect(new Set(pids).size).toBe(2);
    expect(JSON.stringify(events)).not.toContain(token);
    await managed.stop();expect(await portClosed(Number(new URL(origin).port))).toBe(true);
  }finally{await managed?.stop();CoreBuilds.prototype.inspect=inspectBuild;CoreValidations.prototype.inspect=inspectValidation;await rm(directory,{recursive:true,force:true});}
});
