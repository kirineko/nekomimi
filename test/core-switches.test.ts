import { expect, it } from 'vitest';
import { join } from 'node:path';
import { Journal } from '../src/journal.js';
import { prepareDataHome } from '../src/storage/format.js';
import { CoreSwitches, type CoreSwitchRuntime } from '../src/core/switches.js';
import { temporary } from './helpers.js';
async function fixture() {
  const root=await temporary(),home=join(root,'data');await prepareDataHome(home);
  const journal=await Journal.open(join(root,'installation'));
  let current:ReturnType<CoreSwitchRuntime['current']>={identity:{version:'0.2.1',build:'a'.repeat(64),entry:'/old/dist/cli.js',requiresBuild:false},artifactRevision:'b'.repeat(64),buildId:'old-build'};
  let revision='c'.repeat(64),effects=0,releases=0;
  const runtime:CoreSwitchRuntime={installationId:'installation',workspace:root,home,journal,current:()=>current,
    inspect:async validationId=>({validationId,buildId:'next-build',candidateId:'candidate',artifactRevision:revision,directory:'/next',build:'d'.repeat(64)}),
    prepare:async token=>({ready:true,token,blockers:[]}),release:async()=>{releases++;},
    replace:async candidate=>{effects++;current={identity:{version:'0.2.1',build:candidate.build,entry:'/next/dist/cli.js',requiresBuild:false},artifactRevision:candidate.artifactRevision,buildId:candidate.buildId};return current.identity;},
  };
  const switches=new CoreSwitches(runtime),plan=await switches.preview('validation');
  const request={commandId:'switch-one',validationId:'validation',artifactRevision:plan.candidate.artifactRevision,planHash:plan.planHash,authorize:true};
  return {root,home,journal,runtime,switches,plan,request,get effects(){return effects;},get releases(){return releases;},change(){revision='e'.repeat(64);}};
}
it('binds explicit authorization to the candidate, current host and complete impact preview',async()=>{
  const f=await fixture();try{
    expect(f.plan).toMatchObject({impact:{home:f.home,workspace:f.root,activeInstallationFilesChanged:false},from:{buildId:'old-build'},contracts:{api:1,sdk:3,data:2}});
    await expect(f.switches.switch({...f.request,authorize:false})).rejects.toMatchObject({code:'core_authorization'});
    await expect(f.switches.switch({...f.request,planHash:'0'.repeat(64)})).rejects.toMatchObject({code:'core_conflict'});
    await expect(f.switches.switch({...f.request,commandId:undefined as any})).rejects.toMatchObject({code:'input'});
    expect(f.effects).toBe(0);expect(f.journal.events).toHaveLength(0);
  }finally{await f.journal.close();}
});
it('deduplicates concurrent and completed confirmations without starting replacement twice',async()=>{
  const f=await fixture();let enter!:()=>void,release!:()=>void;
  const entered=new Promise<void>(resolve=>enter=resolve),hold=new Promise<void>(resolve=>release=resolve),replace=f.runtime.replace;
  f.runtime.replace=async(candidate,token)=>{enter();await hold;return replace(candidate,token);};
  try{
    const first=f.switches.switch(f.request);await entered;
    const duplicate=f.switches.switch({...f.request});expect(duplicate).toBe(first);
    await expect(f.switches.switch({...f.request,artifactRevision:'f'.repeat(64)})).rejects.toMatchObject({code:'command_conflict'});
    await expect(f.switches.switch({...f.request,commandId:'other'})).rejects.toMatchObject({code:'core_busy'});
    release();const receipt=await first;expect(receipt).toMatchObject({status:'applied',actualBuild:'d'.repeat(64),applied:true});
    const count=f.journal.events.length;expect(await f.switches.switch(f.request)).toEqual(receipt);expect(f.journal.events).toHaveLength(count);expect(f.effects).toBe(1);
  }finally{release();await f.switches.settled();await f.journal.close();}
});
it('does not accept busy confirmations and releases cross-process reservations for retry',async()=>{
  const f=await fixture();f.runtime.prepare=async()=>({ready:false,blockers:[{kind:'approval',id:'pending'}]});
  try{
    await expect(f.switches.switch(f.request)).rejects.toMatchObject({code:'core_busy'});expect(f.journal.events).toHaveLength(0);expect(f.effects).toBe(0);
    const writer=await Journal.open(join(f.home,'core-builds/journal'));await writer.close();
    f.runtime.prepare=async token=>({ready:true,token,blockers:[]});expect(await f.switches.switch(f.request)).toMatchObject({status:'applied'});
  }finally{await f.journal.close();}
});
it('rechecks the candidate after freezing and releases the fence on a stale preview',async()=>{
  const f=await fixture();f.runtime.prepare=async token=>{f.change();return{ready:true,token,blockers:[]};};
  try{await expect(f.switches.switch(f.request)).rejects.toMatchObject({code:'core_conflict'});expect(f.effects).toBe(0);expect(f.releases).toBe(1);expect(f.journal.events).toHaveLength(0);}finally{await f.journal.close();}
});
it('blocks an actual validation writer before freezing or dispatching replacement',async()=>{
  const f=await fixture(),active=await Journal.open(join(f.home,'core-validations/journal'));
  try{await expect(f.switches.switch(f.request)).rejects.toMatchObject({code:'core_busy'});expect(f.effects).toBe(0);expect(f.journal.events).toHaveLength(0);}finally{await active.close();await f.journal.close();}
});
it('returns unknown for an accepted command without a terminal and never retries it',async()=>{
  const f=await fixture();try{
    await f.journal.append('core.switch.intent',{request:f.request,plan:f.plan});
    expect(await f.switches.switch(f.request)).toMatchObject({status:'unknown',applied:false});expect(f.effects).toBe(0);expect(f.journal.events).toHaveLength(1);
    await expect(f.switches.switch({...f.request,planHash:'f'.repeat(64)})).rejects.toMatchObject({code:'command_conflict'});
  }finally{await f.journal.close();}
});
it('persists replacement failure and returns the same failure without repeating the effect',async()=>{
  const f=await fixture();let attempts=0;f.runtime.replace=async()=>{attempts++;throw Error('candidate health failed');};
  try{const receipt=await f.switches.switch(f.request);expect(receipt).toMatchObject({status:'failed',applied:false,actualBuild:'a'.repeat(64)});expect(await f.switches.switch(f.request)).toEqual(receipt);expect(attempts).toBe(1);expect(f.releases).toBe(1);}finally{await f.journal.close();}
});
