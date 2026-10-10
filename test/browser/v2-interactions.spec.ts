import {test,expect} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {startWeb} from '../../src/server/app.js';
import {readSession} from '../../src/journal.js';
import {temporary,key} from '../helpers.js';

test('an extension form survives reload, isolates sessions and retries the same explicit answer',async({page})=>{
  const workspace=await temporary(),home=await temporary(),root=join(workspace,'.nekomimi/extensions/form');await mkdir(root,{recursive:true});
  await writeFile(join(root,'extension.json'),JSON.stringify({name:'form',sdkVersion:3,entry:'index.ts',requiredCapabilities:['commands','ui']}));
  await writeFile(join(root,'index.ts'),`import type {ExtensionFactory} from 'nekomimi/extensions';export default ((api)=>{api.registerCommand('inspect',{description:'Inspect',async handler(_args,ctx){const answer=await ctx.ui({kind:'form',title:'审查选项',text:'请选择范围',fields:[{name:'scope',label:'检查范围',required:true,options:['全部','当前文件']},{name:'note',label:'补充要求'}]});if(!answer||typeof answer!=='object'||Array.isArray(answer))throw Error('Invalid answer');return '已检查 '+answer.scope+' '+answer.note;}});}) satisfies ExtensionFactory;`);
  let models=0;
  const app=await startWeb({workspace,home,apiKey:key,naming:false,staticDir:resolve('dist/web-dist'),runtime:{fetch:async()=>{models++;throw Error('Unexpected model');}}});
  try{
    const host=app.sessions.customization,resource=(await host.catalog.discover()).find(r=>r.name==='form')!;
    await host.catalog.decide(resource.id,true,true,0);const reload=host.requestReload();await host.reload(reload);expect(reload.status,reload.error).toBe('activated');
    const session=await app.sessions.create('表单会话',{mode:'work',commandId:'form'}),other=await app.sessions.create('另一个会话',{mode:'work',commandId:'other'});
    await page.goto(`${app.origin}/work/session/${session.id}#token=${app.token}`);
    await page.getByLabel('任务草稿',{exact:true}).fill('/inspect');await page.getByRole('button',{name:'发送',exact:true}).click();
    await expect(page.getByRole('heading',{name:'审查选项',exact:true})).toBeVisible();
    await page.getByLabel('任务草稿',{exact:true}).fill('下一轮草稿');
    await page.locator(`a[href="/work/session/${other.id}"]`).click();await expect(page.getByLabel('检查范围')).toHaveCount(0);
    await page.locator(`a[href="/work/session/${session.id}"]`).click();await expect(page.getByLabel('检查范围')).toBeVisible();
    await page.reload();await page.getByLabel('检查范围').selectOption('全部');await page.getByLabel('补充要求').fill('<script>window.formExecuted=true</script>');
    const submitted:any[]=[];page.on('request',request=>{if(request.url().endsWith('/answer'))submitted.push(request.postDataJSON());});
    await page.route('**/answer',route=>route.fulfill({status:503,json:{error:{message:'回答暂不可达'}}}),{times:1});
    await page.getByRole('button',{name:'提交回答',exact:true}).click();await expect(page.getByRole('alert').filter({hasText:'回答暂不可达'})).toBeVisible();
    await expect(page.getByLabel('检查范围')).toHaveValue('全部');await expect(page.getByLabel('补充要求')).toHaveValue('<script>window.formExecuted=true</script>');
    await page.getByRole('button',{name:'提交回答',exact:true}).click();
    await expect(page.getByText('已检查 全部 <script>window.formExecuted=true</script>',{exact:true})).toBeVisible();
    expect(submitted).toHaveLength(2);expect(submitted[1]).toEqual(submitted[0]);
    await expect(page.getByLabel('检查范围')).toHaveCount(0);await expect(page.getByLabel('任务草稿',{exact:true})).toHaveJSProperty('textContent','下一轮草稿');
    expect(await page.evaluate(()=>(window as any).formExecuted)).toBeUndefined();expect(models).toBe(0);
    const events=(await readSession(join(app.sessions.root,session.id))).events;expect(events.filter(event=>event.type==='interaction.answered')).toHaveLength(1);
    await page.reload();await expect(page.getByLabel('检查范围')).toHaveCount(0);expect(submitted).toHaveLength(2);
    await page.getByLabel('任务草稿',{exact:true}).fill('/inspect');await page.getByRole('button',{name:'发送',exact:true}).click();
    await expect(page.getByLabel('检查范围')).toBeVisible();
    const waiting=app.sessions.interactions.list(session.id)[0]!;
    await page.getByRole('button',{name:'停止',exact:true}).click();await expect(page.getByLabel('检查范围')).toHaveCount(0);
    const stale=await page.evaluate(async({session,id})=>(await fetch(`/api/v1/sessions/${session}/answer`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id,commandId:'late-cancelled-answer',answer:{scope:'全部'}})})).status,{session:session.id,id:waiting.id});
    expect(stale).toBe(409);expect(models).toBe(0);
    const stopped=(await readSession(join(app.sessions.root,session.id))).events;
    expect(stopped.filter(event=>event.type==='interaction.answered')).toHaveLength(1);expect(stopped.some(event=>event.type==='interaction.cancelled')).toBe(true);
  }finally{await app.close();}
});

test('a create form answers only its own interaction and ignores late work polling',async({page})=>{
  const {Journal}=await import('../../src/journal.js');
  const app=await startWeb({workspace:await temporary(),home:await temporary(),naming:false,staticDir:resolve('dist/web-dist'),runtime:{fetch:async()=>{throw Error('Unexpected model');}}});
  const abort=new AbortController();let release=()=>{};
  const journals:Awaited<ReturnType<typeof Journal.open>>[]=[];const answers:Promise<unknown>[]=[];
  try {
    const work=await app.sessions.create('工作表单',{mode:'work',commandId:'work-form'}),create=await app.sessions.create('创造表单',{mode:'create',commandId:'create-form',target:{kind:'extension',root:await temporary()}});
    for(const [session,title] of [[work,'工作字段'],[create,'创造字段']] as const){
      const journal=await Journal.open(join(app.sessions.root,session.id));journals.push(journal);
      answers.push(app.sessions.interactions.ask(journal,'form-run','form-resource',{kind:'form',title,fields:[{name:'note',label:title,required:true}]},abort.signal).catch(error=>error));
    }
    await expect.poll(()=>app.sessions.interactions.pending().length).toBe(2);
    const gate=new Promise<void>(resolve=>{release=resolve;});let started=()=>{};const requested=new Promise<void>(resolve=>{started=resolve;});
    await page.route(`**/sessions/${work.id}/interactions`,async route=>{const response=await route.fetch();started();await gate;await route.fulfill({response});},{times:1});
    await page.goto(`${app.origin}/work/session/${work.id}#token=${app.token}`);await requested;
    await page.getByRole('link',{name:'创造',exact:true}).click();await page.locator(`a[href="/create/session/${create.id}"]`).click();
    await expect(page.getByLabel('创造字段',{exact:true})).toBeVisible();release();
    await expect(page.getByLabel('工作字段',{exact:true})).toHaveCount(0);
    await page.getByLabel('任务草稿',{exact:true}).fill('保留创造草稿');await page.getByLabel('创造字段',{exact:true}).fill('只回答创造');
    await page.getByRole('button',{name:'提交回答',exact:true}).click();
    expect(await answers[1]).toEqual({note:'只回答创造'});
    expect(app.sessions.interactions.list(work.id)).toHaveLength(1);expect(app.sessions.interactions.list(create.id)).toHaveLength(0);
    await expect(page.getByLabel('任务草稿',{exact:true})).toHaveJSProperty('textContent','保留创造草稿');
    await page.getByRole('link',{name:'工作',exact:true}).click();await page.locator(`a[href="/work/session/${work.id}"]`).click();
    await expect(page.getByLabel('工作字段',{exact:true})).toBeVisible();
  }finally{release();abort.abort();await Promise.all(answers);for(const journal of journals)await journal.close();await app.close();}
});
