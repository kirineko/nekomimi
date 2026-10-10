import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {startWeb} from '../../src/server/app.js';
import {Journal} from '../../src/journal.js';
import {temporary,key} from '../helpers.js';
for(const mode of ['work','create'] as const)test(`${mode}: readable turns retain failures and expose auxiliary evidence without replay`,async({page},info)=>{
 const app=await startWeb({workspace:await temporary(),home:await temporary(),apiKey:key,naming:false,staticDir:resolve('dist/web-dist'),runtime:{fetch:async()=>{throw Error('No replay model calls');}}});
 try{
  const session=await app.sessions.create('轮次阅读',{commandId:'turns',mode,...(mode==='create'?{target:{kind:'extension' as const,root:await temporary()}}:{})});
  const entry=await app.sessions.entry(session.id),journal=await Journal.open(entry.directory);
  for(const status of ['completed','incomplete','cancelled','unknown']){
   const runId='turn-'+status,attemptId='call-'+status;
   await journal.append('run.started',{}, {runId});
   await journal.append('attempt.started',{purpose:'work',model:'saved-model',attempt:1},{runId,attemptId,modelCallId:attemptId});
   await journal.append('context.add',{items:[{type:'message',role:'assistant',content:[{type:'output_text',text:'回答 '+status}]}]},{runId,attemptId});
   await journal.append('attempt.finished',{status,error:status==='incomplete'?'Response incomplete':undefined},{runId,attemptId,modelCallId:attemptId});
   await journal.append('run.finished',{status,error:status==='incomplete'?'Response incomplete':undefined},{runId});
   if(status==='completed'){
    await journal.append('attempt.started',{purpose:'session-title',model:'saved-model',attempt:1},{runId,attemptId:'naming',modelCallId:'naming'});
    await journal.append('attempt.finished',{status:'completed'},{runId,attemptId:'naming',modelCallId:'naming'});
   }
  }
  await journal.append('attempt.started',{purpose:'work',model:'saved-model',attempt:1},{runId:'partial',attemptId:'partial',modelCallId:'partial'});
  await journal.append('attempt.finished',{status:'completed'},{runId:'partial',attemptId:'partial',modelCallId:'partial'});
  await journal.close();const before=await readFile(join(entry.directory,'journal.jsonl')),writes:string[]=[];
  page.on('request',r=>{if(r.method()==='POST'&&!r.url().endsWith('/connect'))writes.push(r.url());});
  await page.goto(`${app.origin}/${mode}/session/${session.id}#token=${app.token}`);
  const timeline=page.getByTestId(mode==='work'?'timeline':'create-timeline');
  await expect(timeline.locator('[data-turn-id]')).toHaveCount(5);
  const completed=timeline.locator('[data-turn-id]').filter({hasText:'回答 completed'});
  await completed.scrollIntoViewIfNeeded();await expect(completed.locator('[data-row-kind="status"]')).toHaveCount(0);
  await expect(completed.getByText('会话命名 · 已完成',{exact:true})).toBeHidden();
  await completed.getByText('全部调用 · 2',{exact:true}).click();await expect(completed.getByText('会话命名 · 已完成',{exact:true})).toBeVisible();
  await completed.getByRole('button',{name:'查看证据',exact:true}).click();await expect(page.getByRole('dialog',{name:'调用证据'})).toContainText('session-title');await page.keyboard.press('Escape');
  await expect(timeline.getByText('本次回复未完整生成。可以继续任务；具体原因可在调用证据中查看。',{exact:true})).toHaveCount(1);
  await expect(timeline).not.toContainText('Response incomplete');
  await expect(timeline.locator('[data-row-kind="status"]').filter({hasText:'已停止'})).toHaveCount(1);
  await expect(timeline.locator('[data-row-kind="status"]').filter({hasText:'结果未知'})).toHaveCount(1);
  const partial=timeline.locator('[data-turn-id="partial"]');
  await partial.scrollIntoViewIfNeeded();await expect(partial.locator('header')).toContainText('当前记录未包含任务结束状态');
  await expect(partial.locator('header > span').filter({hasText:'已完成'})).toHaveCount(0);
  await page.screenshot({path:info.outputPath('readable-turns-'+mode+'.png')});
  await page.reload();await expect(timeline.locator('[data-turn-id]')).toHaveCount(5);
  expect(writes).toEqual([]);expect(await readFile(join(entry.directory,'journal.jsonl'))).toEqual(before);
 }finally{await app.close();}
});
