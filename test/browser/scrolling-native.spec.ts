import {test,expect} from '@playwright/test';
import {scrollFixture} from './scroll-fixture.js';
test.use({launchOptions:{ignoreDefaultArgs:['--hide-scrollbars']}});
test('touch inertia and a held native scrollbar remain manual beyond 600ms',async({page})=>{
  const fixture=await scrollFixture(page);
  try {
    const {conversation}=fixture;
    const cdp=await page.context().newCDPSession(page);
    await cdp.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:1});
    const box=(await conversation.boundingBox())!;
    const x=box.x+box.width/2,y=box.y+box.height/2;
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
    await page.waitForTimeout(700);
    for(let i=1;i<=6;i++) {await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:y+i*25}]});await page.waitForTimeout(20);}
    await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    await page.waitForTimeout(350);
    await expect(page.locator('.history-latest')).toBeVisible();
    expect(await conversation.evaluate(el=>el.scrollHeight-el.clientHeight-el.scrollTop)).toBeGreaterThan(50);
    await cdp.send('Emulation.setTouchEmulationEnabled',{enabled:false});
    // Force a visible native scrollbar even on macOS with overlay scrollbars.
    await page.evaluate(()=>{document.styleSheets[0]!.insertRule('.conversation::-webkit-scrollbar {width:18px;}');document.styleSheets[0]!.insertRule('.conversation::-webkit-scrollbar-thumb {background:#777;}');});
    await page.locator('.history-latest').click();await expect(page.locator('.history-latest')).toHaveCount(0);
    const b=(await conversation.boundingBox())!;
    const geometry=await conversation.evaluate(el=>({ratio:el.clientHeight/el.scrollHeight,track:el.clientHeight}));
    const thumb=Math.max(20,geometry.track*geometry.ratio);
    const sx=b.x+b.width-9,sy=b.y+b.height-thumb/2;
    await page.mouse.move(sx,sy);await page.mouse.down();await page.waitForTimeout(750);
    await page.mouse.move(sx,sy-120,{steps:12});await page.mouse.up();
    await expect(page.locator('.history-latest')).toBeVisible();
    const top=await conversation.evaluate(el=>el.scrollTop);await page.waitForTimeout(250);
    expect(Math.abs(await conversation.evaluate(el=>el.scrollTop)-top)).toBeLessThanOrEqual(2);
  }finally{await fixture.app.close();}
});
