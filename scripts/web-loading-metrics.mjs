import { chromium } from '@playwright/test';
import { startWeb } from '../dist/index.js';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, basename } from 'node:path';
import { gzipSync } from 'node:zlib';
const root=await mkdtemp(join(tmpdir(),'nekomimi-loading-'));
const app=await startWeb({workspace:root,home:join(root,'home'),naming:false,staticDir:resolve('dist/web-dist')});
const browser=await chromium.launch({channel:'chrome'});
try {
 const page=await browser.newPage();const requests=new Set();
 page.on('request',r=>{if(new URL(r.url()).pathname.endsWith('.js'))requests.add(basename(r.url()));});
 await page.goto(app.url);await page.getByRole('button',{name:'定制能力',exact:true}).waitFor();await page.waitForTimeout(500);
 const files=await Promise.all((await readdir('dist/web-dist/assets')).filter(f=>f.endsWith('.js')).map(async name=>{const bytes=await readFile(join('dist/web-dist/assets',name));return {name,bytes:bytes.length,gzip:gzipSync(bytes).length};}));
 const initial=files.filter(f=>requests.has(f.name));
 console.log(JSON.stringify({largest:files.sort((a,b)=>b.bytes-a.bytes)[0],initial,initialBytes:initial.reduce((n,f)=>n+f.bytes,0),initialGzip:initial.reduce((n,f)=>n+f.gzip,0)},null,2));
}finally{await browser.close();await app.close();await rm(root,{recursive:true,force:true});}
