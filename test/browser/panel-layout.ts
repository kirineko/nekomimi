import {expect,type Locator} from '@playwright/test';

/** Frame content and host layout settle on different event loops. */
export async function waitForPanelLayout(iframe:Locator) {
  await iframe.scrollIntoViewIfNeeded();
  const root=iframe.contentFrame().locator('#panel-root');
  await root.evaluate(async()=>{await document.fonts.ready;});
  await expect.poll(async()=>{
    const expected=await root.evaluate(el=>Math.max(80,Math.min(900,el.getBoundingClientRect().height+24)));
    const actual=await iframe.evaluate(el=>parseFloat((el as HTMLIFrameElement).style.height));
    return Math.abs(actual-expected);
  }).toBeLessThan(1);
  // Let the host's resize/scroll observers consume the new frame geometry.
  await iframe.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
}
