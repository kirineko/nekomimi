import { test, expect, type Page } from '@playwright/test';
import { join, resolve } from 'node:path';
import { Journal } from '../../src/journal.js';
import { ApiError } from '../../src/shared/protocol.js';
import { startWeb } from '../../src/server/app.js';
import { CoreInstallation } from '../../src/core/installation.js';
import { CoreSwitches, type CoreSwitchRuntime } from '../../src/core/switches.js';
import { coreRecoveryView } from '../../src/core/recovery-view.js';
import { coreViewFixture } from '../fixtures/core-view.js';
import { temporary } from '../helpers.js';

async function fixture(page: Page) {
  const f = await coreViewFixture(), installation = await CoreInstallation.locate({entry:resolve('dist/cli.js'),registry:await temporary()});
  const journal = await installation.acquire(), validationId='validation-for-switch', buildId='build-for-switch';
  const validation = await Journal.open(join(f.home,'core-validations','journal'));
  await validation.append('core.validation.intent',{validationId,buildId,artifactRevision:'c'.repeat(64),commandId:'validate-fixture'},{candidateId:f.candidate.id,validationTaskId:validationId});
  await validation.append('core.validation.finished',{validationId,status:'passed',checks:['fixture admission only']},{candidateId:f.candidate.id,validationTaskId:validationId}); await validation.close();
  let current:ReturnType<CoreSwitchRuntime['current']>={identity:{version:'0.2.1',build:f.candidate.targetHost.build,entry:resolve('dist/cli.js'),requiresBuild:false},artifactRevision:'b'.repeat(64),buildId:'old'};
  let effects=0, blocked=false, fail=false, unknown=false, revision='c'.repeat(64), unavailable=false;
  const calls:string[]=[];
  const runtime:CoreSwitchRuntime={installationId:installation.identity.id,workspace:f.workspace,home:f.home,journal,current:()=>current,
    inspect:async id=>({validationId:id,buildId,candidateId:f.candidate.id,artifactRevision:revision,directory:f.candidate.directory,build:'d'.repeat(64)}),
    prepare:async token=>({ready:!blocked,token,blockers:blocked?[{kind:'approval',id:'busy'}]:[]}),release:async()=>{},
    replace:async candidate=>{effects++;if(fail)throw Error('Fixture candidate health failure; retained build remains available');current={identity:{version:'0.2.1',build:candidate.build,entry:'/candidate/dist/cli.js',requiresBuild:false},artifactRevision:candidate.artifactRevision,buildId:candidate.buildId};await journal.append('core.launch.selected',{...candidate,workspace:f.workspace,home:f.home,identity:current.identity});return current.identity;}};
  const switches=new CoreSwitches(runtime);
  const app=await startWeb({workspace:f.workspace,home:f.home,naming:false,staticDir:resolve('dist/web-dist'),coreControl:async(action,value={})=>{
    calls.push(action); if(unavailable)throw Error('Fixture control offline');
    if(action==='status')return{mode:'managed',phase:switches.busy?'switching':'running',installation:installation.identity,switchSupported:true,identity:current!.identity,blockers:blocked?[{kind:'approval',id:'busy',state:'waiting'}]:[]};
    if(action==='preview')return switches.preview(value.validationId as string);
    if(action==='receipt')return{receipt:switches.receipt(value.commandId as string)??null};
    if(action==='recovery')return coreRecoveryView(installation);
    if(action==='switch'){
      if(unknown){await journal.append('core.switch.intent',{request:value,plan:await switches.preview(value.validationId as string)});unknown=false;}
      return switches.switch(value as any);
    }
    throw new ApiError(400,'input','unsupported fixture control');
  }});
  const session=await app.sessions.create('核心切换目标',{mode:'create',commandId:'core-ui',target:{kind:'core',root:f.candidate.directory}});
  await page.goto(`${app.origin}/create/session/${session.id}/core#token=${app.token}`);
  await page.getByRole('tab',{name:'构建与验证记录',exact:true}).click();
  const review=async()=>{await page.getByLabel('切换目标验证',{exact:true}).selectOption(validationId);await page.getByRole('button',{name:'审阅版本切换计划',exact:true}).click();await expect(page.getByRole('dialog')).toBeVisible();};
  const confirm=async()=>{await page.getByLabel('我已核对目标构建、产物摘要和影响目录，授权本次切换',{exact:true}).check();await page.getByRole('button',{name:'确认切换核心版本',exact:true}).click();};
  return {...f,app,session,installation,journal,switches,calls,review,confirm,get effects(){return effects;},setBlocked(value:boolean){blocked=value;},setFailure(){fail=true;},setUnknown(){unknown=true;},changeRevision(){revision='e'.repeat(64);},setUnavailable(value:boolean){unavailable=value;},async close(){await app.close();await switches.settled();await journal.close();}};
}

test('10.8 explicit confirmation shows exact impact, waits for blockers, and rejects a changed plan',async({page})=>{
  const f=await fixture(page);
  try{
    expect(f.calls.filter(action=>['switch','preview'].includes(action))).toEqual([]);
    await f.review(); const dialog=page.getByRole('dialog');
    await expect(page.getByRole('button',{name:'取消切换',exact:true})).toBeFocused();
    await page.keyboard.press('Escape'); await expect(page.getByRole('button',{name:'审阅版本切换计划',exact:true})).toBeFocused(); await f.review();
    await expect(page.getByRole('button',{name:'确认切换核心版本',exact:true})).toBeDisabled();
    await expect(dialog).toContainText(f.workspace);await expect(dialog).toContainText(f.home);await expect(dialog).toContainText('d'.repeat(64));await expect(dialog).toContainText('c'.repeat(64));
    f.setBlocked(true);await expect(dialog.getByRole('region',{name:'切换阻碍'})).toBeVisible({timeout:6000});
    await page.getByLabel('我已核对目标构建、产物摘要和影响目录，授权本次切换',{exact:true}).check();
    await expect(page.getByRole('button',{name:'确认切换核心版本',exact:true})).toBeDisabled();expect(f.effects).toBe(0);
    f.setBlocked(false);await expect(page.getByRole('button',{name:'确认切换核心版本',exact:true})).toBeEnabled({timeout:6000});
    f.changeRevision();await page.getByRole('button',{name:'确认切换核心版本',exact:true}).click();
    await expect(page.getByText(/切换请求未确认/)).toContainText('候选或当前宿主已变化');expect(f.effects).toBe(0);
    await expect(page.getByRole('button',{name:'审阅另一次切换',exact:true})).toBeEnabled();
    await page.getByRole('button',{name:'审阅另一次切换',exact:true}).click();await f.review();await f.confirm();
    await expect(page.getByRole('heading',{name:'已确认运行目标构建',exact:true})).toBeVisible();expect(f.effects).toBe(1);
  }finally{await f.close();}
});

test('10.8 lost response recovers the durable receipt after reload without replaying the switch',async({page})=>{
  const f=await fixture(page);
  try{
    await page.route('**/api/v1/core/switch',async route=>{await route.fetch();await route.abort('connectionreset');});
    await f.review();await f.confirm();
    await expect.poll(()=>f.effects).toBe(1);await expect(page.getByRole('heading',{name:'已确认运行目标构建',exact:true})).toBeVisible();
    const intents=f.journal.events.filter(event=>event.type==='core.switch.intent');expect(intents).toHaveLength(1);
    // The old candidate binding may legitimately become invalid under the new host.
    await page.route('**/core-candidate',route=>route.fulfill({status:409,json:{error:{code:'host_changed',message:'创造版本已变化'}}}));
    await page.reload();await expect(page.getByRole('heading',{name:'核心候选不可读',exact:true})).toBeVisible();
    await page.getByRole('button',{name:'设置',exact:true}).click();await page.getByRole('menuitem',{name:'版本与恢复',exact:true}).click();
    await expect(page.getByRole('dialog').getByRole('heading',{name:'已确认运行目标构建',exact:true})).toBeVisible();
    await expect(page.getByRole('dialog')).toContainText((intents[0]!.payload as any).request.commandId);
    expect(f.effects).toBe(1);expect(f.calls.filter(action=>action==='switch')).toHaveLength(1);
    f.setUnavailable(true);await page.getByRole('button',{name:'重新读取版本与恢复记录',exact:true}).click();
    await expect(page.getByRole('dialog')).toContainText('运行身份待确认');await expect(page.getByRole('dialog').getByRole('heading',{name:'已确认运行目标构建',exact:true})).toHaveCount(0);
  }finally{await f.close();}
});

test('10.8 failed and unknown results remain distinct from the observed build and never auto-retry',async({page})=>{
  const f=await fixture(page);
  try{
    f.setFailure();await f.review();await f.confirm();
    await expect(page.getByRole('heading',{name:'切换失败',exact:true})).toBeVisible();
    await expect(page.getByRole('region',{name:'切换结果'})).toContainText(f.candidate.targetHost.build);
    await page.getByRole('button',{name:'审阅另一次切换',exact:true}).click();f.setUnknown();await f.review();await f.confirm();
    await expect(page.getByRole('heading',{name:'切换结果未知',exact:true})).toBeVisible();
    await expect(page.getByRole('button',{name:'重试同一切换命令',exact:true})).toHaveCount(0);
    await page.getByRole('button',{name:'重新读取切换结果',exact:true}).click();
    expect(f.effects).toBe(1);expect(f.calls.filter(action=>action==='switch')).toHaveLength(2);
    await page.setViewportSize({width:360,height:900});await page.getByRole('button',{name:'设置',exact:true}).click();await page.getByRole('menuitem',{name:'版本与恢复',exact:true}).click();
    await expect(page.getByRole('dialog')).toContainText('结果未知，不会自动重试');
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.screenshot({path:'/tmp/nekomimi-core-recovery-narrow.png'});
    await page.keyboard.press('Escape');await expect(page.getByRole('button',{name:'设置',exact:true})).toBeFocused();
  }finally{await f.close();}
});

test('10.8 a receipt for another command cannot become successful UI evidence',async({page})=>{
  const f=await fixture(page);
  try{
    await page.route('**/api/v1/core/switch',async route=>{await route.fetch();await route.abort('connectionreset');});
    await page.route('**/api/v1/core/receipt?*',async route=>{const response=await route.fetch();const data=await response.json();if(data.receipt)data.receipt.commandId='unrelated-command';await route.fulfill({response,json:data});});
    await f.review();await f.confirm();await expect.poll(()=>f.effects).toBe(1);
    await expect(page.getByRole('alert').filter({hasText:'回执暂不可读'})).toContainText('与确认命令不一致');
    await expect(page.getByRole('heading',{name:'已确认运行目标构建',exact:true})).toHaveCount(0);
    await page.unroute('**/api/v1/core/receipt?*');await page.getByRole('button',{name:'重新读取切换结果',exact:true}).click();
    await expect(page.getByRole('heading',{name:'已确认运行目标构建',exact:true})).toBeVisible();expect(f.effects).toBe(1);
  }finally{await f.close();}
});
