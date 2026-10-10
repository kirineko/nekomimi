import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview'], { stdio: ['ignore', 'pipe', 'pipe'] });
let browser;
try {
  await new Promise((resolve, reject) => { const timer = setTimeout(() => reject(Error('server timeout')), 10000); server.stdout.on('data', b => { if (b.toString().includes('4178')) { clearTimeout(timer); resolve(); } }); server.once('exit', () => { clearTimeout(timer); reject(Error('server exited')); }); });
  browser = await chromium.launch({ channel: 'chrome', headless: true }); const page = await browser.newPage({ viewport: { width: 360, height: 960 } });
  await page.route('**/delayed.svg', route => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="180"><rect width="400" height="180" fill="#e4ede6"/></svg>' }));
  await page.goto('http://127.0.0.1:4178/create');
  const layout = await page.evaluate(() => ({ headers: document.querySelectorAll('.topbar').length, viewport: [innerWidth, innerHeight], scroll: [scrollX, scrollY], elements: ['body','.topbar','.mobile-layout','.conversation','.timeline','.composer','summary'].map(selector => { const el = document.querySelector(selector); const r = el.getBoundingClientRect(); const style = getComputedStyle(el); return { selector, bounds: { x:r.x,y:r.y,width:r.width,height:r.height }, position: style.position, overflow: style.overflow }; }) }));
  console.log(JSON.stringify(layout,null,2)); await writeFile('layout.json',JSON.stringify(layout,null,2)); await page.screenshot({ path: 'layout-viewport.png' }); await page.screenshot({ path:'layout-fullpage.png',fullPage:true });
} finally { await browser?.close(); server.kill('SIGTERM'); }
