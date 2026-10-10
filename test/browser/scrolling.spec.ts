import { test, expect } from '@playwright/test';
import { scrollFixture, sampleStart, sampleStop, settleScroll } from './scroll-fixture.js';
import { createTask } from './fixtures/workbench.js';

test('scroll trajectory and performance sample', async ({page}, info)=>{
  const fixture=await scrollFixture(page);
  try {
    const {conversation}=fixture;
    const cdp=await page.context().newCDPSession(page);
    await cdp.send('Performance.enable');
    for(const count of [60,180]) {
      if(count===180) await fixture.expand();
      await conversation.hover();
      // Warm up syntax workers before measuring interaction, not initial loading.
      await page.waitForTimeout(500);
      const before=await cdp.send('Performance.getMetrics');
      await sampleStart(page);
      for(const delta of [-300,-300,240,240,-180,180]) {await page.mouse.wheel(0,delta);await page.waitForTimeout(120);}
      const sample=await sampleStop(page);
      const after=await cdp.send('Performance.getMetrics');
      const intervals=sample.frames.slice(1).map((f,i)=>f.t-sample.frames[i]!.t).sort((a,b)=>a-b);
      const metrics=Object.fromEntries(after.metrics.filter(m=>['ScriptDuration','LayoutDuration','RecalcStyleDuration'].includes(m.name)).map(m=>[m.name,m.value-(before.metrics.find(b=>b.name===m.name)?.value??0)]));
      const summary={count,p95:intervals[Math.floor(intervals.length*.95)],longTasks:sample.long,metrics,browser:page.context().browser()?.version(),viewport:page.viewportSize()};
      console.log(JSON.stringify(summary));
      await info.attach(`scroll-current-${count}`,{body:JSON.stringify({summary,sample}),contentType:'application/json'});
    }
  } finally {await fixture.app.close();}
});

test('bottom boundary and return control do not move the viewport',async({page},info)=>{
  const fixture=await scrollFixture(page);
  try {
    const {conversation}=fixture;
    const height=await conversation.evaluate(el=>el.clientHeight);
    await conversation.hover();await sampleStart(page);
    await page.mouse.wheel(0,-300);await page.waitForTimeout(200);
    const historyHeight=await conversation.evaluate(el=>el.clientHeight);
    const distance=await conversation.evaluate(el=>el.scrollHeight-el.clientHeight-el.scrollTop);
    await page.mouse.wheel(0,distance-30);await page.waitForTimeout(200);
    const remaining=await conversation.evaluate(el=>el.scrollHeight-el.clientHeight-el.scrollTop);
    const sample=await sampleStop(page);
    await info.attach('bottom-boundary',{body:JSON.stringify({height,historyHeight,remaining,sample}),contentType:'application/json'});
    console.log(JSON.stringify({height,historyHeight,remaining}));
    expect(Math.abs(height-historyHeight)).toBeLessThanOrEqual(1);expect(remaining).toBeGreaterThan(20);
  }finally{await fixture.app.close();}
});

test('repeated wheel reversals preserve the current position and keyboard can reach latest',async({page})=>{
  const fixture=await scrollFixture(page);
  try {
    const {conversation}=fixture;
    await conversation.hover();
    // This trajectory asserts unchanged geometry. Measure the nearby virtual
    // rows first; asynchronous growth has a separate anchor-preservation test.
    await page.mouse.wheel(0,-1000);await settleScroll(page);
    await page.getByRole('button',{name:'返回最新',exact:true}).click();
    await expect.poll(()=>conversation.evaluate(el=>el.scrollHeight-el.clientHeight-el.scrollTop)).toBeLessThan(3);await settleScroll(page);
    await conversation.hover();
    for(const delta of [-260,210,-110,160,-70,70,-160]) {
      const before=await conversation.evaluate(el=>({top:el.scrollTop,max:el.scrollHeight-el.clientHeight}));
      await sampleStart(page);await page.mouse.wheel(0,delta);await page.waitForTimeout(230);
      const sample=await sampleStop(page);
      const tops=[before.top,...sample.frames.map(f=>f.top)];
      for(let i=1;i<tops.length;i++) expect((tops[i]!-tops[i-1]!)*Math.sign(delta)).toBeGreaterThanOrEqual(-2);
      expect(Math.abs(tops.at(-1)!-Math.max(0,Math.min(before.max,before.top+delta)))).toBeLessThanOrEqual(2);
    }
    await conversation.focus();await page.keyboard.press('End');
    await expect.poll(()=>conversation.evaluate(el=>el.scrollHeight-el.clientHeight-el.scrollTop)).toBeLessThan(3);
    await expect(page.getByRole('button',{name:/^(返回最新|重试返回最新)$/})).toHaveCount(0);
    await page.keyboard.press('PageUp');await expect(page.getByRole('button',{name:/^(返回最新|重试返回最新)$/})).toBeVisible();
  }finally{await fixture.app.close();}
});

test('layout growth preserves the current anchor including movement in the same frame',async({page})=>{
  const fixture=await scrollFixture(page);
  try {
    const {conversation}=fixture;
    await conversation.hover();await page.mouse.wheel(0,-500);await page.waitForTimeout(200);
    const anchor=await conversation.evaluate(el=>{
      const top=el.getBoundingClientRect().top;
      const row=Array.from(el.querySelectorAll<HTMLElement>('[data-row-id]')).find(r=>r.getBoundingClientRect().bottom>top+40)!;
      return {id:row.dataset.rowId!,offset:row.getBoundingClientRect().top-top};
    });
    await page.locator('[data-row-id]').first().evaluate(el=>(el as HTMLElement).style.paddingBottom='350px');
    const offset=()=>page.locator(`[data-row-id="${anchor.id}"]`).evaluate(el=>el.getBoundingClientRect().top-document.querySelector('[data-reading-surface]')!.getBoundingClientRect().top);
    await expect.poll(async()=>Math.abs(await offset()-anchor.offset)).toBeLessThanOrEqual(2);
    // Deterministically interleave a layout mutation and a user scroll before
    // observer delivery. Real wheel trajectories are exercised above.
    await conversation.evaluate(el=>{
      el.dispatchEvent(new WheelEvent('wheel',{bubbles:true,deltaY:-90}));
      (el.querySelector('[data-row-id]') as HTMLElement).style.paddingBottom='550px';
      el.scrollTop-=90;el.dispatchEvent(new Event('scroll'));
    });
    await expect.poll(async()=>Math.abs(await offset()-(anchor.offset+90))).toBeLessThanOrEqual(2);
    await fixture.append();await expect(page.getByText('记录 240',{exact:true})).toBeAttached();await expect(page.getByRole('button',{name:/^(返回最新|重试返回最新)$/})).toContainText('返回最新');await expect(page.getByText('有新消息',{exact:false})).toHaveCount(0);
    expect(Math.abs(await offset()-(anchor.offset+90))).toBeLessThanOrEqual(2);
  }finally{await fixture.app.close();}
});

test('new manual browsing cancels a delayed return-to-latest and retry keeps its position',async({page})=>{
  const fixture=await scrollFixture(page);
  let release=()=>{};
  try {
    const {conversation}=fixture;
    await conversation.hover();await page.mouse.wheel(0,-500);await page.waitForTimeout(200);
    const gate=new Promise<void>(resolve=>{release=resolve;});
    await page.route('**/snapshot',async route=>{await gate;await route.fallback();},{times:1});
    await page.getByRole('button',{name:/^(返回最新|重试返回最新)$/}).click();
    await conversation.hover();await page.mouse.wheel(0,-150);await page.waitForTimeout(200);
    const top=await conversation.evaluate(el=>el.scrollTop);
    release();await page.waitForTimeout(300);
    expect(Math.abs(await conversation.evaluate(el=>el.scrollTop)-top)).toBeLessThanOrEqual(2);
    await expect(page.getByRole('button',{name:/^(返回最新|重试返回最新)$/})).toBeVisible();
    const height=await conversation.evaluate(el=>el.clientHeight);
    await page.route('**/snapshot',route=>route.fulfill({status:503,json:{error:{message:'失败'}}}),{times:1});
    await page.getByRole('button',{name:/^(返回最新|重试返回最新)$/}).click();await expect(page.getByRole('navigation',{name:'历史导航'}).getByRole('status')).toBeVisible();
    expect(await conversation.evaluate(el=>el.clientHeight)).toBe(height);
    expect(Math.abs(await conversation.evaluate(el=>el.scrollTop)-top)).toBeLessThanOrEqual(2);
    await page.getByRole('button',{name:/^(返回最新|重试返回最新)$/}).click();await expect(page.getByRole('button',{name:/^(返回最新|重试返回最新)$/})).toHaveCount(0);
  }finally{release();await fixture.app.close();}
});

test('fixture supports a delayed panel and diff without model or tool execution',async({page})=>{
  const fixture=await scrollFixture(page);
  try {
    await fixture.show('diff');await expect(page.getByRole('region',{name:'文件差异'})).toContainText('const changed = true;');
    await fixture.show('panel');await page.getByRole('button',{name:'打开互动内容'}).click();
    const frame=page.locator('iframe[title^="面板"]');
    await expect(frame).toBeVisible();
    await frame.contentFrame().getByRole('button',{name:'展开'}).click();
    await expect(frame).toHaveCSS('height','500px');
    await fixture.expand();await fixture.append();
    await expect(page.getByRole('button',{name:'查看较新',exact:true})).toBeAttached();
    await expect(page.getByRole('button',{name:/^(返回最新|重试返回最新)$/})).toContainText('返回最新');await expect(page.getByText('有新消息',{exact:false})).toHaveCount(0);
  }finally{await fixture.app.close();}
});

test('narrow and zoomed history controls stay bounded without overlapping the reading surface',async({page},info)=>{
  const fixture=await scrollFixture(page);
  try {
    for(const width of [390,900]) {
      await page.setViewportSize({width,height:900});
      await page.evaluate(()=>document.documentElement.style.fontSize='20px');
      await fixture.conversation.hover();await page.mouse.wheel(0,-300);await page.waitForTimeout(200);
      await expect(page.getByRole('button',{name:/^(返回最新|重试返回最新)$/})).toBeVisible();
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
      const nav=await page.getByRole('navigation',{name:'历史导航'}).boundingBox();
      const surface=await fixture.conversation.boundingBox();
      expect(nav!.y+nav!.height).toBeLessThanOrEqual(surface!.y+1);
      await page.getByRole('button',{name:/^(返回最新|重试返回最新)$/}).focus();await expect(page.getByRole('button',{name:/^(返回最新|重试返回最新)$/})).toBeFocused();
      await page.screenshot({path:info.outputPath(`scroll-overlay-${width}.png`)});
    }
  }finally{await fixture.app.close();}
});

test('streaming history performance sample',async({page},info)=>{
  const fixture=await scrollFixture(page);
  try {
    await fixture.expand();await fixture.conversation.hover();await page.mouse.wheel(0,600);await page.waitForTimeout(300);
    const cdp=await page.context().newCDPSession(page);await cdp.send('Performance.enable');
    const before=await cdp.send('Performance.getMetrics');await sampleStart(page);
    for(let i=0;i<6;i++){await fixture.append();await page.mouse.wheel(0,i%2?-160:160);await page.waitForTimeout(280);}
    const sample=await sampleStop(page);const after=await cdp.send('Performance.getMetrics');
    const intervals=sample.frames.slice(1).map((f,i)=>f.t-sample.frames[i]!.t).sort((a,b)=>a-b);
    const metrics=Object.fromEntries(after.metrics.filter(m=>['ScriptDuration','LayoutDuration','RecalcStyleDuration'].includes(m.name)).map(m=>[m.name,m.value-(before.metrics.find(b=>b.name===m.name)?.value??0)]));
    const summary={count:180,streaming:true,p95:intervals[Math.floor(intervals.length*.95)],longTasks:sample.long,metrics};
    console.log(JSON.stringify(summary));await info.attach('streaming-sample',{body:JSON.stringify({summary,sample}),contentType:'application/json'});
    await expect(page.getByRole('button',{name:/^(返回最新|重试返回最新)$/})).toContainText('返回最新');await expect(page.getByText('有新消息',{exact:false})).toHaveCount(0);
  }finally{await fixture.app.close();}
});

test('pagination keeps surviving anchors, old window bottom stays historical, and session switch clears pending navigation',async({page})=>{
  const fixture=await scrollFixture(page);let release=()=>{};
  try {
    await fixture.expand();
    await page.getByRole('button',{name:'查看更早',exact:true}).click();
    await expect(page.getByRole('button',{name:'查看较新',exact:true})).toBeAttached();
    const {conversation}=fixture;
    await conversation.evaluate(el=>{el.scrollTop=el.scrollHeight;});await page.waitForTimeout(250);
    await expect(page.getByRole('button',{name:/^(返回最新|重试返回最新)$/})).toBeVisible();
    const newerAnchor=await conversation.evaluate(el=>{const top=el.getBoundingClientRect().top;const row=Array.from(el.querySelectorAll<HTMLElement>('[data-row-id]')).find(r=>r.getBoundingClientRect().bottom>top+40)!;return {id:row.dataset.rowId,offset:row.getBoundingClientRect().top-top};});
    await page.getByRole('button',{name:'查看较新',exact:true}).click();
    await expect(page.getByRole('button',{name:'查看较新',exact:true})).toHaveCount(0);
    await expect.poll(()=>page.locator(`[data-row-id="${newerAnchor.id}"]`).evaluate(el=>el.getBoundingClientRect().top-document.querySelector('[data-reading-surface]')!.getBoundingClientRect().top).then(offset=>Math.abs(offset-newerAnchor.offset))).toBeLessThanOrEqual(2);
    await expect(page.locator('[data-row-id]')).toHaveCount(180);
    await page.getByRole('button',{name:/^(返回最新|重试返回最新)$/}).click();await expect(page.getByRole('button',{name:/^(返回最新|重试返回最新)$/})).toHaveCount(0);
    await conversation.hover();await page.mouse.wheel(0,-400);await page.waitForTimeout(200);
    await page.route('**/snapshot?before=*',route=>route.fulfill({status:503,json:{error:{message:'失败'}}}),{times:1});
    await page.getByRole('button',{name:'查看更早',exact:true}).click();
    await expect(page.getByRole('button',{name:'重试查看更早',exact:true})).toBeVisible();
    // Read the anchor after the error layout and its ResizeObserver correction.
    await conversation.evaluate(()=>new Promise<void>(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r()))));
    const anchor=await conversation.evaluate(el=>{const top=el.getBoundingClientRect().top;const row=Array.from(el.querySelectorAll<HTMLElement>('[data-row-id]')).find(r=>r.getBoundingClientRect().bottom>top+40)!;return {id:row.dataset.rowId,offset:row.getBoundingClientRect().top-top};});
    await page.getByRole('button',{name:'重试查看更早',exact:true}).click();await expect(page.locator('[data-row-id]')).toHaveCount(120);
    // Only visible rows mount; independent diff loads remain covered by the fixture test.
    // New page diffs resolve independently of the snapshot. Observe the final
    // compensated geometry, not the DOM mutation before ResizeObserver runs.
    await expect.poll(()=>page.locator(`[data-row-id="${anchor.id}"]`).evaluate(el=>el.getBoundingClientRect().top-document.querySelector('[data-reading-surface]')!.getBoundingClientRect().top).then(offset=>Math.abs(offset-anchor.offset))).toBeLessThanOrEqual(2);
    const gate=new Promise<void>(r=>{release=r;});
    await page.route('**/snapshot',async route=>{await gate;await route.fallback();},{times:1});
    await page.getByRole('button',{name:/^(返回最新|重试返回最新)$/}).click();
    await createTask(page);
    await expect(page.getByRole('heading',{name:'未命名任务',exact:true})).toHaveText('未命名任务');
    release();await page.waitForTimeout(300);
    await expect(page.locator('[data-row-id]')).toHaveCount(0);await expect(page.getByRole('button',{name:/^(返回最新|重试返回最新)$/})).toHaveCount(0);
    expect(await conversation.evaluate(el=>el.scrollTop)).toBe(0);
  }finally{release();await fixture.app.close();}
});

test('horizontal code scrolling does not leave latest mode',async({page})=>{
  const fixture=await scrollFixture(page);
  try {
    const code=page.locator('pre.syntax').last();
    await code.hover();
    const top=await fixture.conversation.evaluate(el=>el.scrollTop);
    await page.mouse.wheel(180,0);await page.waitForTimeout(200);
    expect(await code.evaluate(el=>el.scrollLeft)).toBeGreaterThan(0);
    expect(await fixture.conversation.evaluate(el=>el.scrollTop)).toBe(top);
    await expect(page.getByRole('button',{name:/^(返回最新|重试返回最新)$/})).toHaveCount(0);
  }finally{await fixture.app.close();}
});

test('completion failure and cancellation do not pull history to the bottom',async({page})=>{
  const fixture=await scrollFixture(page);
  try {
    await fixture.conversation.hover();await page.mouse.wheel(0,-350);await page.waitForTimeout(200);
    const top=await fixture.conversation.evaluate(el=>el.scrollTop);
    for(const status of ['completed','failed','cancelled']) {
      await fixture.finish(status!);
      const label=status==='completed'?'已完成':status==='failed'?'失败':'已停止';
      await expect(page.getByText(label,{exact:true}).first()).toBeVisible();
      expect(Math.abs(await fixture.conversation.evaluate(el=>el.scrollTop)-top)).toBeLessThanOrEqual(2);
      await expect(page.getByRole('button',{name:/^(返回最新|重试返回最新)$/})).toBeVisible();
    }
  }finally{await fixture.app.close();}
});


test('new content is readable by scrolling, including a full historical window',async({page})=>{
  const fixture=await scrollFixture(page);
  try {
    const {conversation}=fixture;
    await conversation.hover();await page.mouse.wheel(0,-500);await page.waitForTimeout(200);
    const top=await conversation.evaluate(el=>el.scrollTop);
    await fixture.append();
    await expect(page.getByText('记录 240',{exact:true})).toBeAttached();
    expect(Math.abs(await conversation.evaluate(el=>el.scrollTop)-top)).toBeLessThanOrEqual(2);
    await expect(page.getByText('有新消息',{exact:false})).toHaveCount(0);
    await conversation.focus();await page.keyboard.press('End');
    await expect(page.getByText('记录 240',{exact:true})).toBeInViewport();
    await expect(page.getByRole('button',{name:/^(返回最新|重试返回最新)$/})).toHaveCount(0);
    await page.mouse.wheel(0,-200);await page.getByRole('button',{name:/^(返回最新|重试返回最新)$/}).click();await expect(page.locator('[data-row-id]')).toHaveCount(60);
    await fixture.expand();await fixture.append();
    await expect(page.getByRole('button',{name:'查看较新',exact:true})).toBeAttached();
    await conversation.focus();await page.keyboard.press('End');
    await expect(page.getByText('记录 241',{exact:true})).toBeAttached();
    expect(await page.locator('[data-row-id]').count()).toBeLessThanOrEqual(180);
    await page.keyboard.press('End');
    await expect(page.getByText('记录 241',{exact:true})).toBeInViewport();
    await expect(page.getByRole('button',{name:/^(返回最新|重试返回最新)$/})).toHaveCount(0);
  }finally{await fixture.app.close();}
});
