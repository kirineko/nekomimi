// Real local build/startup acceptance. Never selects a production version or calls a model.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
const execute = promisify(execFile), source = resolve('.'), root = await mkdtemp(join(tmpdir(), 'nekomimi-core-smoke-'));
const owner = join(root, 'owner'), home = join(root, 'home'); await mkdir(owner);
const cli = async (action, input) => {
  const {stdout} = await execute(process.execPath, [join(source, 'dist/cli.js'), 'core', action, JSON.stringify(input), '--workspace', owner, '--home', home], {encoding:'utf8',timeout:1000000,maxBuffer:16*1024*1024});
  return JSON.parse(stdout);
};
console.log(JSON.stringify({phase:'prepare',root,node:process.version,platform:process.platform,arch:process.arch}));
const preview = await cli('preview',{source});
const candidate = await cli('prepare',{source,destination:join(root,'candidate'),sourceRevision:preview.source.revision,targetHostBuild:preview.targetHost.build});
const plan = await cli('build-plan',{candidateId:candidate.id});
console.log(JSON.stringify({phase:'build',candidateId:candidate.id,inputHash:plan.inputHash}));
const built = await cli('build',{candidateId:candidate.id,inputHash:plan.inputHash,commandId:'real-core-build',authorize:true});
assert.equal(built.status,'passed');
const input = {buildId:built.buildId,artifactRevision:built.artifact.revision,commandId:'real-core-validation',authorize:true};
console.log(JSON.stringify({phase:'validate',buildId:built.buildId,artifactRevision:built.artifact.revision}));
const validated = await cli('validate',input);
assert.equal(validated.status,'passed'); assert.equal(validated.applied,false); assert.equal(validated.hostIntegration,'not_run');
assert.deepEqual(await cli('validate',input),validated);
assert.equal((await cli('inspect-validation',{validationId:validated.validationId})).validForCurrent,true);
const receipt = {root,sourceRevision:preview.source.revision,built,validated,node:process.version,platform:process.platform,arch:process.arch,scope:'real isolated source build and startup; production host integration not run'};
await writeFile(join(root,'receipt.json'),JSON.stringify(receipt,null,2));
console.log(JSON.stringify({phase:'passed',receipt:join(root,'receipt.json'),validationId:validated.validationId,checks:validated.checks,ports:validated.ports}));
if (process.env.NEKOMIMI_MANAGED_SMOKE === '1' || process.env.NEKOMIMI_SWITCH_SMOKE === '1') {
  const {spawn}=await import('node:child_process');
  const {readFile}=await import('node:fs/promises');
  const osHome=join(root,'os-home'); await mkdir(osHome);
  const launch={validationId:validated.validationId,artifactRevision:built.artifact.revision,authorize:true};
  const args=[join(source,'dist/cli.js'),'core','launch',JSON.stringify(launch),'--workspace',owner,'--home',home];
  const env={...process.env,HOME:osHome};
  const child=spawn(process.execPath,args,{env,stdio:['ignore','pipe','pipe']});
  let output='',errors='';child.stdout.on('data',data=>output+=data);child.stderr.on('data',data=>errors+=data);
  const stopped=new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',(code,signal)=>resolve({code,signal}));});
  let ready;
  try {
    ready=await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(Error('Managed CLI readiness timeout')),120000);
      child.stdout.on('data',()=>{const first=output.split('\n')[0];try{const value=JSON.parse(first);if(value.mode==='managed'&&value.url){clearTimeout(timer);resolve(value);}}catch{}});
      void stopped.then(status=>{clearTimeout(timer);reject(Error(`Managed CLI stopped before readiness: ${JSON.stringify(status)} ${errors}`));});
    });
    assert.equal(ready.identity.build,validated.report.build);
    assert.equal((await fetch(ready.url)).status,200);
    await assert.rejects(execute(process.execPath,args,{env,encoding:'utf8',timeout:120000}),/busy/);
    const journalPath=join(osHome,'.nekomimi/installations',ready.installation.id,'journal.jsonl');
    const history=await readFile(journalPath,'utf8');
    assert(!history.includes(new URL(ready.url).hash.slice('#token='.length)));
    const info=await cli('launch-info',{buildId:built.buildId});assert.equal(info.switchSupported,false);assert.equal(info.managedLaunchSupported,true);
    console.log(JSON.stringify({phase:'managed-ready',launchId:ready.launchId,installation:ready.installation.id,identity:ready.identity,concurrentLaunch:'busy',browserTokenInJournal:false}));
    if (process.env.NEKOMIMI_SWITCH_SMOKE === '1') {
      const {chromium}=await import('@playwright/test');
      const browser=await chromium.launch({channel:'chrome',headless:true});
      const origin=new URL(ready.url).origin, token=new URL(ready.url).hash.slice('#token='.length);
      const headers={authorization:`Bearer ${token}`,origin,'content-type':'application/json'};
      const api=async(action,value)=>{
        const response=await fetch(origin+'/api/v1/core/'+action,{method:value?'POST':'GET',headers,...(value?{body:JSON.stringify(value)}:{})});
        if(!response.ok)throw Error(`Core API ${action}: ${response.status}`);return response.json();
      };
      try {
        const context=await browser.newContext();await context.addCookies([{name:'harness_'+new URL(origin).port,value:token,domain:'127.0.0.1',path:'/api/v1',httpOnly:true,sameSite:'Strict'}]);
        const page=await context.newPage();await page.goto(origin+'/work');
        await page.getByTestId('core-running-version').filter({hasText:ready.identity.build.slice(0,8)}).waitFor();
        const childCli=async(action,input)=>JSON.parse((await execute(process.execPath,[ready.identity.entry,'core',action,JSON.stringify(input),'--workspace',owner,'--home',home],{encoding:'utf8',timeout:1000000,maxBuffer:16*1024*1024})).stdout);
        const secondPreview=await childCli('preview',{source});
        const second=await childCli('prepare',{source,destination:join(root,'next-candidate'),sourceRevision:secondPreview.source.revision,targetHostBuild:secondPreview.targetHost.build});
        await writeFile(join(second.directory,'src/core/switch-smoke-identity.ts'),'export const isolatedSwitchFixture = "second-generation";\n');
        const secondPlan=await childCli('build-plan',{candidateId:second.id});
        console.log(JSON.stringify({phase:'switch-target-build',candidateId:second.id,inputHash:secondPlan.inputHash}));
        const secondBuild=await childCli('build',{candidateId:second.id,inputHash:secondPlan.inputHash,commandId:'switch-target-build',authorize:true});
        const secondValidation=await childCli('validate',{buildId:secondBuild.buildId,artifactRevision:secondBuild.artifact.revision,commandId:'switch-target-validation',authorize:true});
        assert(secondValidation.report.checks.includes('core-switch-control'));
        const preview=await api('preview',{validationId:secondValidation.validationId});
        const confirmation={commandId:'real-core-switch',validationId:secondValidation.validationId,artifactRevision:secondBuild.artifact.revision,planHash:preview.planHash,authorize:true};
        console.log(JSON.stringify({phase:'switch-confirm',from:ready.identity.build,to:secondValidation.report.build,planHash:preview.planHash}));
        // The old HTTP connection may disappear after the durable intent; retry the same receipt.
        await api('switch',confirmation).catch(()=>{});
        let receipt;
        for(let i=0;i<120;i++){
          try{const value=await api('receipt?commandId='+confirmation.commandId);if(value.receipt?.status==='applied'){receipt=value.receipt;break;}if(value.receipt?.status==='failed')throw Error(JSON.stringify(value.receipt));}catch{}
          await new Promise(resolve=>setTimeout(resolve,500));
        }
        assert.equal(receipt?.actualBuild,secondValidation.report.build);assert.notEqual(receipt.actualBuild,ready.identity.build);
        const beforeRepeat=(await readFile(journalPath,'utf8')).split('"type":"core.launch.process.started"').length;
        assert.deepEqual(await api('switch',confirmation),receipt);
        assert.equal((await readFile(journalPath,'utf8')).split('"type":"core.launch.process.started"').length,beforeRepeat);
        const actual=await api('status');assert.equal(actual.identity.build,receipt.actualBuild);
        await page.getByTestId('core-running-version').filter({hasText:receipt.actualBuild.slice(0,8)}).waitFor({timeout:15000});
        await page.getByTestId('core-running-version').locator('summary').click();
        assert.equal(await page.getByTestId('core-running-version').locator('code').textContent(),receipt.actualBuild);
        await page.screenshot({path:join(root,'switched-workbench.png'),fullPage:true});
        const evidence={phase:'switch-passed',from:ready.identity.build,to:actual.identity.build,receipt,secondBuild,secondValidation,browserIdentity:receipt.actualBuild,duplicateSpawn:false};
        await writeFile(join(root,'switch-receipt.json'),JSON.stringify(evidence,null,2));console.log(JSON.stringify({phase:evidence.phase,from:evidence.from,to:evidence.to,receipt:join(root,'switch-receipt.json')}));
      } finally {await browser.close();}
    }

  } finally { child.kill('SIGTERM'); }
  const termination=await stopped; assert.equal(termination.code,0);
  await assert.rejects(fetch(new URL(ready.url).origin));
  const safe={phase:'managed-passed',launchId:ready.launchId,identity:ready.identity,termination,portClosed:true};
  await writeFile(join(root,'managed-receipt.json'),JSON.stringify(safe,null,2));
  console.log(JSON.stringify({...safe,receipt:join(root,'managed-receipt.json')}));
}
