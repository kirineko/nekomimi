import { expect, type Page } from '@playwright/test';
import { resolve } from 'node:path';
import { startWeb } from '../../src/server/app.js';
import { Journal } from '../../src/journal.js';
import type { Snapshot } from '../../src/shared/protocol.js';
import { temporary, key } from '../helpers.js';

export async function scrollFixture(page: Page) {
  const app = await startWeb({ workspace: await temporary(), home: await temporary(), apiKey: key,
    naming: false, staticDir: resolve(process.env.SCROLL_STATIC_DIR ?? 'dist/web-dist'), runtime: { fetch: async () => { throw Error('No model calls in scrolling fixture'); } } });
  const session = await app.sessions.create('滚动验收');
  const entry = await app.sessions.entry(session.id);
  const append = async (count: number, start = 0) => {
    const journal = await Journal.open(entry.directory);
    try {
      for (let i = start; i < start + count; i++) await journal.append('context.add', { items: [{type:'message', role:'assistant', content:[{type:'output_text', text: `记录 ${i}\n\n` + (i % 3 === 0 ? '一段用于滚动验收的长内容。\n\n'.repeat(8) + '\n```ts\nconst value = 42;\n' + '// long line '.repeat(30) + '\n```' : '普通会话内容。') }]}] }, {runId:`scroll-${i}`,attemptId:`scroll-${i}`}, false);
    } finally { await journal.close(); }
  };
  await append(240);
  let diffId='',panelId='';
  await page.route('**/snapshot*', async route => {
    const response = await route.fetch();
    if (!response.ok()) { await route.fulfill({ response }); return; }
    const snapshot = await response.json() as Snapshot;
    diffId=snapshot.rows[10]?.id ?? diffId;panelId=snapshot.rows[20]?.id ?? panelId;
    snapshot.rows = snapshot.rows.map((row, i) => i === 10 ? {...row, kind:'tool',title:'edit',status:'completed',details:{patch:{sha256:'fixture-patch'},path:'fixture.ts'}} : i === 20 ? {...row, details:{kind:'panel',resourceId:'fixture',resourceRevision:'one',panelId:'delayed',bundleHash:'fixture',props:{},fallback:'延迟面板'}} : row);
    await route.fulfill({ response, json:snapshot });
  });
  await page.route('**/runtime-ui?*',async route=>{const response=await route.fetch();const body=await response.json();await route.fulfill({response,json:{...body,panels:[{id:'delayed',resourceId:'fixture',revision:'one',bundleHash:'fixture',slot:'message-content',contractVersion:3,modes:['work'],targetScope:'current',resourceRevision:'one',match:{role:'fixture-only'},fallback:'延迟面板'}]}});});
  await page.route('**/diff/fixture-patch?*', route => route.fulfill({json:{lines:[{kind:'add',next:1,text:'const changed = true;'}],added:1,removed:0,total:1}}));
  await page.route('**/api/v1/customization', async route => {
    const body = route.request().postDataJSON();
    if (body.action === 'panel-mount') await route.fulfill({json:{instanceId:'scroll-panel',nonce:'scroll-nonce',url:'/api/v1/panels/scroll-panel/frame',fallback:'延迟面板'}});
    else if(body.action === 'panel-unmount') await route.fulfill({json:{}});
    else await route.continue();
  });
  await page.route('**/api/v1/panels/scroll-panel/frame', route => route.fulfill({contentType:'text/html',body:`<!doctype html><meta charset="utf-8"><body>延迟布局面板<button id="grow">展开</button><script>
    let port; addEventListener('message',e=>{if(e.data.kind==='connect'){port=e.ports[0];port.start();}});
    parent.postMessage({kind:'ready',version:1,nonce:'scroll-nonce',instanceId:'scroll-panel'},'*');
    document.querySelector('button').onclick=()=>setTimeout(()=>port.postMessage({kind:'resize',instanceId:'scroll-panel',height:500}),200);
    </script>`}));
  await page.goto(`${app.origin}/work/session/${session.id}#token=${app.token}`);
  await expect(page.locator('[data-row-id]')).toHaveCount(60);
  const conversation = page.getByTestId('timeline');
  await expect.poll(()=>conversation.evaluate(el=>el.scrollHeight-el.clientHeight-el.scrollTop)).toBeLessThan(3);
  await expect(conversation.locator('[class*="syn-c"]').first()).toBeVisible();
  await settleScroll(page);
  let next = 240;
  return { app, session, async show(kind:'diff'|'panel') {
    const id=kind==='diff'?diffId:panelId;
    await conversation.evaluate((el,id)=>{el.dispatchEvent(new WheelEvent('wheel',{bubbles:true,deltaY:-100}));const row=[...el.querySelectorAll<HTMLElement>('[data-row-id]')].find(row=>row.dataset.rowId===id)!;el.scrollTop+=row.getBoundingClientRect().top-el.getBoundingClientRect().top;},id);
    await expect(page.locator(`[data-row-id="${id}"] article`)).toBeVisible();
  }, finish: async(status:string)=>{
    const journal=await Journal.open(entry.directory);
    try {const runId=`finish-${status}`;await journal.append('run.started',{}, {runId});await journal.append('run.finished',{status},{runId});}
    finally {await journal.close();}
  }, append: (count=1)=>{ const start=next; next+=count; return append(count,start); }, conversation, async expand() {
    for(const count of [120,180]) {
      await page.getByRole('button',{name:'查看更早',exact:true}).click();
      await expect(page.locator('[data-row-id]')).toHaveCount(count);
    }
  }};
}

export async function sampleStart(page: Page) {
  await page.evaluate(()=>{
    const el=document.querySelector('[data-reading-surface]')!;
    const data={frames:[] as {t:number;top:number;height:number}[],long:[] as number[],running:true};
    (window as any).__scrollSample=data;
    const observer=new PerformanceObserver(list=>data.long.push(...list.getEntries().map(e=>e.duration)));
    observer.observe({type:'longtask'});
    const frame=(t:number)=>{if(!data.running){observer.disconnect();return;}data.frames.push({t,top:el.scrollTop,height:el.clientHeight});requestAnimationFrame(frame);};
    requestAnimationFrame(frame);
  });
}
export async function sampleStop(page:Page) {
  return page.evaluate(()=>{const data=(window as any).__scrollSample;data.running=false;return data as {frames:{t:number;top:number;height:number}[];long:number[]};});
}

/** Wait for native inertia and deferred virtual row measurement to finish. */
export async function settleScroll(page:Page) {
  await page.getByTestId('timeline').evaluate(el=>new Promise<void>(resolve=>{
    let top=el.scrollTop,height=el.scrollHeight,stable=0;
    const frame=()=>{stable=Math.abs(el.scrollTop-top)<.1&&el.scrollHeight===height?stable+1:0;top=el.scrollTop;height=el.scrollHeight;if(stable>=12)resolve();else requestAnimationFrame(frame);};requestAnimationFrame(frame);
  }));
}
