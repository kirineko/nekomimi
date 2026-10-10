import {chromium,expect} from '@playwright/test';
import {mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
const [directory,generation,output]=process.argv.slice(2),root=resolve(directory);
if(!['baseline','current'].includes(generation)||!output)throw Error('usage: root baseline|current output.json');
const {startWeb,Journal}=await import(pathToFileURL(join(root,'dist/index.js')).href);
const workspace=await mkdtemp(join(tmpdir(),'nekomimi-history-work-')),home=await mkdtemp(join(tmpdir(),'nekomimi-history-home-'));
const app=await startWeb({workspace,home,naming:false,apiKey:'offline-fixture',staticDir:join(root,'dist/web-dist'),runtime:{fetch:async()=>{throw Error('History cannot call a model');}}});
const browser=await chromium.launch({channel:'chrome'}),results=[];
try{
 const session=await app.sessions.create('History benchmark'),entry=await app.sessions.entry(session.id),journal=await Journal.open(entry.directory);
 for(let i=0;i<450;i++)await journal.append('context.add',{source:'user',item:{role:'user',content:[{type:'input_text',text:`历史记录 ${i}`}] }},{},false);
 await journal.close();const before=await readFile(join(entry.directory,'journal.jsonl'));
 for(let repeat=0;repeat<3;repeat++){
  const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage();
  const start=performance.now();await page.goto(app.origin+(generation==='baseline'?`/?session=${session.id}`:`/work/session/${session.id}`)+'#token='+app.token);
  await expect(page.getByText('历史记录 449',{exact:true})).toBeVisible();const readyMs=performance.now()-start;
  const surface=page.locator(generation==='baseline'?'.conversation':'[data-reading-surface]');const paging=[];
  for(let i=0;i<6;i++){const older=page.getByRole('button',{name:'查看更早',exact:true}),start=performance.now();await older.click();await expect(older).toBeEnabled();paging.push(performance.now()-start);}
  await surface.evaluate(el=>{el.dispatchEvent(new WheelEvent('wheel',{bubbles:true,deltaY:-100}));el.scrollTop=400;el.dispatchEvent(new Event('scroll'));});
  await surface.evaluate(el=>new Promise(resolve=>{let previous=el.scrollTop,stable=0;const sample=()=>{stable=Math.abs(el.scrollTop-previous)<0.1?stable+1:0;previous=el.scrollTop;if(stable>=8)resolve();else requestAnimationFrame(sample);};requestAnimationFrame(sample);}));
  const anchor=await surface.evaluate(el=>{const top=el.getBoundingClientRect().top;const row=[...el.querySelectorAll('[data-row-id]')].find(r=>r.getBoundingClientRect().bottom>top+40);return{id:row.dataset.rowId,offset:row.getBoundingClientRect().top-top};});
  const anchorStart=performance.now();await page.locator('[data-row-id]').first().evaluate(el=>{el.style.minHeight=`${el.getBoundingClientRect().height+240}px`;});
  const error=()=>surface.evaluate((el,anchor)=>{const row=[...el.querySelectorAll('[data-row-id]')].find(row=>row.dataset.rowId===anchor.id);return row?Math.abs(row.getBoundingClientRect().top-el.getBoundingClientRect().top-anchor.offset):Infinity;},anchor);
  await expect.poll(error).toBeLessThan(2);const anchorRecoveryMs=performance.now()-anchorStart;await page.waitForTimeout(250);const anchorErrorPx=await error();assert(anchorErrorPx<2);
  const retainedRows=await page.locator('[data-row-id]').count();assert(retainedRows<=180);
  const latestStart=performance.now();await page.getByRole('button',{name:'返回最新',exact:true}).click();await expect(page.getByText('历史记录 449',{exact:true})).toBeVisible();const latestMs=performance.now()-latestStart;
  const refreshStart=performance.now();await page.reload();await expect(page.getByText('历史记录 449',{exact:true})).toBeVisible();const refreshMs=performance.now()-refreshStart;
  results.push({repeat,readyMs,paging,anchorRecoveryMs,anchorErrorPx,retainedRows,latestMs,refreshMs});await context.close();
 }
 assert.deepEqual(await readFile(join(entry.directory,'journal.jsonl')),before);
 const result={generation,root,node:process.version,browser:browser.version(),platform:process.platform,arch:process.arch,rows:450,realModelCalls:0,journalUnchanged:true,results};await writeFile(output,JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
}finally{await browser.close();await app.close();}
