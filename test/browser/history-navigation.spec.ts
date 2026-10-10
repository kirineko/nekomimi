import {test,expect} from '@playwright/test';
import {join,resolve} from 'node:path';
import {temporary} from '../helpers.js';
import {Journal} from '../../src/journal.js';
import {startWeb} from '../../src/server/app.js';
import { createTask } from './fixtures/workbench.js';
test('bounded history reaches earliest and returns to latest with unchanged cursor',async({page})=>{
 const workspace=await temporary(),home=await temporary();
 const app=await startWeb({workspace,home,naming:false,staticDir:resolve('dist/web-dist')});
 const session=await app.sessions.create('长历史');
 const journal=await Journal.open(join(app.sessions.root,session.id));
 for(let i=0;i<450;i++)await journal.append('context.add',{source:'user',item:{role:'user',content:[{type:'input_text',text:`历史记录 ${i}`}] }},{},false);
 await journal.flush();await journal.close();
 const rowIds=new Map<string,string>();
 page.on('response',async response=>{if(response.url().includes('/snapshot')&&response.ok()){const data=await response.json();for(const row of data.rows ?? [])rowIds.set(row.text,row.id);}});
 try {
  await page.goto(`${app.origin}/work/session/${session.id}#token=${app.token}`);
  await expect(page.getByText('历史记录 449',{exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'返回最新',exact:true})).toHaveCount(0);
  await page.getByTestId('timeline').evaluate(el=>{el.dispatchEvent(new WheelEvent('wheel',{bubbles:true,deltaY:-100}));el.scrollTop=100;});
  await expect(page.getByRole('button',{name:'返回最新',exact:true})).toHaveCount(1);
  await page.getByTestId('timeline').evaluate(el=>{el.dispatchEvent(new WheelEvent('wheel',{bubbles:true,deltaY:100}));el.scrollTop=el.scrollHeight;});
  await expect(page.getByRole('button',{name:'返回最新',exact:true})).toHaveCount(0);
  for(let i=0;i<6;i++) {const older=page.getByRole('button',{name:'查看更早',exact:true});await older.click();await expect(older).toBeEnabled();}
  await page.getByTestId('timeline').evaluate(el=>{el.scrollTop=400;el.dispatchEvent(new Event('scroll'));});
  await page.getByTestId('timeline').evaluate(el=>new Promise<void>(resolve=>{let previous=el.scrollTop,stable=0;const sample=()=>{stable=Math.abs(el.scrollTop-previous)<0.1?stable+1:0;previous=el.scrollTop;if(stable>=8)resolve();else requestAnimationFrame(sample);};requestAnimationFrame(sample);}));
  const anchor=await page.getByTestId('timeline').evaluate(el=>{const top=el.getBoundingClientRect().top;const row=[...el.querySelectorAll<HTMLElement>('[data-row-id]')].find(r=>r.getBoundingClientRect().bottom>top+40)!;return {id:row.dataset.rowId!,offset:row.getBoundingClientRect().top-top};});
  await page.locator('[data-row-id]').first().evaluate(el=>{(el as HTMLElement).style.minHeight=`${el.getBoundingClientRect().height+240}px`;});
  await expect.poll(()=>page.getByTestId('timeline').evaluate((el,anchor)=>{const row=[...el.querySelectorAll<HTMLElement>('[data-row-id]')].find(r=>r.dataset.rowId===anchor.id)!;return Math.abs(row.getBoundingClientRect().top-el.getBoundingClientRect().top-anchor.offset);},anchor)).toBeLessThan(2);
  await page.getByRole('button',{name:'查看更早',exact:true}).click();
  await expect(page.getByRole('button',{name:'查看更早',exact:true})).toHaveCount(0);
  expect(await page.locator('[data-row-id]').count()).toBeLessThanOrEqual(180);
  await page.getByTestId('timeline').evaluate(el=>{el.dispatchEvent(new WheelEvent('wheel',{bubbles:true,deltaY:100}));el.scrollTop=el.scrollHeight;});
  await expect(page.getByRole('button',{name:'返回最新',exact:true})).toHaveCount(1);
  await expect.poll(()=>rowIds.get('历史记录 239')).toBeTruthy();
  const later=page.locator(`[data-row-id="${rowIds.get('历史记录 239')}"]`);
  await expect(later).toBeAttached();await later.scrollIntoViewIfNeeded();
  await expect(page.getByText('历史记录 239',{exact:true})).toBeInViewport();
  await expect(page.getByRole('button',{name:'查看较新',exact:true})).toBeAttached();
  await page.screenshot({path:'output/playwright/history-single-navigation.png'});
  // Reduced CSS viewport exercises narrow/short layout; this is not native zoom evidence.
  for(const [width,height] of [[360,900],[360,450]]){
   await page.setViewportSize({width:width!,height:height!});
   await expect(page.getByRole('button',{name:'返回最新',exact:true})).toBeInViewport();
   expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  }
  await page.setViewportSize({width:1440,height:1000});


  await page.getByRole('button',{name:'返回最新',exact:true}).click();
  await expect(page.getByText('历史记录 449',{exact:true})).toBeInViewport();
  await expect(page.getByRole('button',{name:'返回最新',exact:true})).toHaveCount(0);
  let release!:()=>void, finish!:()=>void, requests=0;
  const gate=new Promise<void>(resolve=>{release=resolve;}),done=new Promise<void>(resolve=>{finish=resolve;});
  await page.route('**/snapshot?before=*',async route=>{requests++;const response=await route.fetch();await gate;await route.fulfill({response});finish();});
  await page.getByRole('button',{name:'查看更早',exact:true}).click();
  await expect.poll(()=>requests).toBe(1);
  await expect(page.getByRole('button',{name:'查看更早',exact:true})).toBeDisabled();
  await page.getByRole('button',{name:'返回最新',exact:true}).click();
  await expect(page.getByText('历史记录 449',{exact:true})).toBeInViewport();
  release();await done;await page.unroute('**/snapshot?before=*');
  await expect(page.getByText('历史记录 449',{exact:true})).toBeInViewport();
  await expect(page.locator('[data-row-id]')).toHaveCount(60);
  await page.route('**/snapshot?before=*',route=>route.fulfill({status:503,json:{error:{message:'分页暂不可用'}}}),{times:1});
  await page.getByRole('button',{name:'查看更早',exact:true}).click();
  await expect(page.getByRole('button',{name:'重试查看更早',exact:true})).toBeEnabled();
  await expect(page.locator('[data-row-id]')).toHaveCount(60);
  await page.getByRole('button',{name:'重试查看更早',exact:true}).click();
  await expect(page.locator('[data-row-id]')).toHaveCount(120);
  let releaseSwitch!:()=>void,finishSwitch!:()=>void;
  const switchGate=new Promise<void>(resolve=>{releaseSwitch=resolve;}),switchDone=new Promise<void>(resolve=>{finishSwitch=resolve;});
  await page.route('**/snapshot?before=*',async route=>{await switchGate;await route.fulfill({status:503,json:{error:{message:'旧会话迟到错误'}}});finishSwitch();});
  await page.getByRole('button',{name:'查看更早',exact:true}).click();
  await createTask(page);
  await expect(page.locator('[data-row-id]')).toHaveCount(0);
  releaseSwitch();await switchDone;
  await expect(page.getByText('旧会话迟到错误',{exact:false})).toHaveCount(0);
  await expect(page.locator('[data-row-id]')).toHaveCount(0);
 } finally {await app.close();}
});
