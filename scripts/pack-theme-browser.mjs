// Explicit browser acceptance against the clean installation produced by pack-smoke.
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { mkdir } from 'node:fs/promises';
const installation=resolve(process.argv[2]);
const { startWeb }=await import(pathToFileURL(join(installation,'node_modules/nekomimi/dist/index.js')).href);
const app=await startWeb({workspace:join(installation,'candidate-assets-workspace'),home:join(installation,'candidate-assets-home'),naming:false});
const browser=await chromium.launch({channel:'chrome'});
try {
 const page=await browser.newPage({viewport:{width:1280,height:900}});
 await page.goto(app.url);
 await page.waitForFunction(()=>document.documentElement.dataset.theme==='custom');
 await page.evaluate(()=>document.fonts.ready);
 const values=await page.evaluate(()=>({accent:getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(),font:document.fonts.check('16px NekomimiTheme'),background:getComputedStyle(document.documentElement).getPropertyValue('--ui-background')}));
 assert.equal(values.accent,'#a04f90');assert.equal(values.font,true);assert.match(values.background,/data:image\/png;base64/);
 const evidence=await app.sessions.customization.lifecycle.catalog();
 assert(evidence.some(a=>a.phase==='applied'));
 await page.getByRole('button',{name:'定制能力',exact:true}).click();
 await page.getByRole('tab',{name:/我的定制/}).waitFor();
 await mkdir('output/playwright',{recursive:true});
 await page.screenshot({path:'output/playwright/installed-customization-theme.png'});
 console.log(JSON.stringify({installedBrowser:true,fontLoaded:true,imageEmbedded:true,themeApplied:true}));
}finally{await browser.close();await app.close();}
