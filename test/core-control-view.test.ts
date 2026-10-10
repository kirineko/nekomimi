import { expect, it } from 'vitest';
import { join, resolve } from 'node:path';
import { readFile, readdir, realpath } from 'node:fs/promises';
import { CoreInstallation } from '../src/core/installation.js';
import { coreRecoveryView } from '../src/core/recovery-view.js';
import { CoreBuilds } from '../src/core/builds.js';
import { Journal } from '../src/journal.js';
import { startWeb } from '../src/server/app.js';
import { coreViewFixture } from './fixtures/core-view.js';
import { temporary } from './helpers.js';

it('reads retained selections without creating records, claiming a running process or executing recovery', async () => {
  const root = await temporary(), installation = await CoreInstallation.locate({entry:resolve('dist/cli.js'),registry:join(root,'registry')});
  const empty = await coreRecoveryView(installation);
  expect(empty).toMatchObject({running:'not-observed',applied:false,tasksReplayed:false,lastConfirmedSelection:null,launcher:{requiresBuild:false,executable:process.execPath,args:[resolve('dist/cli.js'),'core','recovery-info']}});
  expect(await readdir(root)).toEqual([]);
  const journal = await installation.acquire();
  await journal.append('core.launch.selected',{build:'a'.repeat(64),buildId:'old',artifactRevision:'b'.repeat(64),directory:'/retained-old'});
  await journal.append('core.launch.selected',{build:'c'.repeat(64),buildId:'new',artifactRevision:'d'.repeat(64),directory:'/retained-new'});
  await journal.append('core.switch.intent',{request:{commandId:'unknown-switch',planHash:'e'.repeat(64)}});
  await journal.append('core.launch.process.intent',{});
  await journal.close();
  const before = await readFile(join(installation.directory,'journal.jsonl'));
  const view = await coreRecoveryView(installation);
  expect(view).toMatchObject({running:'not-observed',applied:false,tasksReplayed:false,lastConfirmedSelection:{buildId:'new'},previousConfirmedSelection:{buildId:'old'},interrupted:[{commandId:'unknown-switch'}]});
  expect(view.unobservedProcesses).toHaveLength(1);
  expect(await readFile(join(installation.directory,'journal.jsonl'))).toEqual(before);
  const source = await CoreInstallation.locate({entry:resolve('src/cli.ts'),registry:join(root,'source-registry')});
  expect((await coreRecoveryView(source)).launcher).toEqual({requiresBuild:true});
});

it('binds read-only launch instructions to the session candidate and verifies the selected build before returning argv', async () => {
  const f = await coreViewFixture(), buildId='display-build', artifactRevision='a'.repeat(64);
  const journal = await Journal.open(join(f.home,'core-builds','journal'));
  await journal.append('core.build.intent',{buildId,candidateId:f.candidate.id},{candidateId:f.candidate.id}); await journal.close();
  const before = await readFile(join(f.home,'core-builds','journal','journal.jsonl'));
  const original = CoreBuilds.prototype.inspect;
  let inspections = 0, current = true;
  CoreBuilds.prototype.inspect = async function(id) {
    if (this.candidates.home !== f.home || id !== buildId) return original.call(this,id);
    inspections++; return {validForCurrent:current,result:{buildId,candidateId:f.candidate.id,artifact:{directory:resolve('.'),revision:artifactRevision}}} as any;
  };
  const app = await startWeb({workspace:f.workspace,home:f.home,naming:false});
  try {
    const core = await app.sessions.create('Scoped core',{commandId:'core',mode:'create',target:{kind:'core',root:f.candidate.directory}}), work=await app.sessions.create('work');
    const get = (id:string,build:string) => fetch(`${app.origin}/api/v1/sessions/${id}/core-launch-info?buildId=${build}`,{headers:{authorization:`Bearer ${app.token}`}});
    expect((await get(work.id,buildId)).status).toBe(403);
    expect((await get(core.id,'other-build')).status).toBe(404); expect(inspections).toBe(0);
    const response = await get(core.id,buildId); expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({buildId,artifactRevision,currentMode:'unmanaged',switchSupported:false,applied:false,manual:{executable:process.execPath,args:[resolve('dist/cli.js'),'web','--workspace',await realpath(f.workspace),'--home',f.home,'--no-open']}});
    current=false; const stale = await get(core.id,buildId); expect(stale.status).toBe(409); expect(await stale.json()).toMatchObject({error:{code:'core_conflict',message:'候选构建已失效，请重新构建后核验启动路径'}});
    expect(await readFile(join(f.home,'core-builds','journal','journal.jsonl'))).toEqual(before);
    const recovery=await fetch(app.origin+'/api/v1/core/recovery',{headers:{authorization:`Bearer ${app.token}`}});
    expect(await recovery.json()).toMatchObject({running:'not-observed',applied:false,launcher:{requiresBuild:true}});
  } finally { await app.close(); CoreBuilds.prototype.inspect=original; }
});
