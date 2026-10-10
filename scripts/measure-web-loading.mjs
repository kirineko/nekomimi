import { chromium, expect } from '@playwright/test';
import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
const [directory, generation, output] = process.argv.slice(2);
if (!directory || !['baseline','current'].includes(generation) || !output) throw Error('usage: root baseline|current output.json');
const root=resolve(directory),{startWeb,Journal}=await import(pathToFileURL(join(root,'dist/index.js')).href);
const workspace=await mkdtemp(join(tmpdir(),'nekomimi-loading-work-')),home=await mkdtemp(join(tmpdir(),'nekomimi-loading-home-'));
const app=await startWeb({workspace,home,naming:false,apiKey:'offline-fixture',staticDir:join(root,'dist/web-dist'),runtime:{fetch:async()=>{throw Error('Measurement must not call a model');}}});
const browser=await chromium.launch({channel:'chrome'}),results=[];
try {
 const empty=await app.sessions.create('Empty loading fixture'),populated=await app.sessions.create('Saved loading fixture');
 const entry=await app.sessions.entry(populated.id),journal=await Journal.open(entry.directory);
 await journal.append('context.add',{source:'user',item:{role:'user',content:[{type:'input_text',text:'Explain the saved fixture.'}]}});
 await journal.append('context.add',{source:'fixture',items:[{type:'message',role:'assistant',content:[{type:'output_text',text:'## Loading fixture\n\nSaved **rich** content with a table.\n\n| Key | Value |\n| --- | --- |\n| Fixture | Offline |'}]}]}, {runId:'fixture-run',attemptId:'fixture-attempt'});
 await journal.close();
 for(const fixture of ['home','empty','populated']) for(let repeat=0;repeat<3;repeat++) {
  const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage(),files=new Map(),pending=[];
  page.on('response',response=>{if(new URL(response.url()).pathname.endsWith('.js'))pending.push((async()=>{const body=await response.body();files.set(new URL(response.url()).pathname,{bytes:body.length,gzipBytes:gzipSync(body).length,sha256:createHash('sha256').update(body).digest('hex')});})());});
  const session=fixture==='empty'?empty:populated;
  const path=generation==='baseline'?(fixture==='home'?'/':`/?session=${session.id}`):(fixture==='home'?'/work':`/work/session/${session.id}`);
  const started=performance.now();await page.goto(app.origin+path+'#token='+app.token);
  if(generation==='current' && fixture==='home')await expect(page.getByRole('heading',{name:'专注当前项目',exact:true})).toBeVisible();
  else await expect(page.getByRole('textbox',{name:generation==='baseline'?'任务内容':'任务草稿',exact:true})).toBeVisible();
  if(fixture==='populated')await expect(page.getByRole('heading',{name:'Loading fixture',exact:true})).toBeVisible();
  const readyMs=performance.now()-started;
  // Fixed quiet observation window includes preload and delayed initial requests;
  // no optional feature is opened, no model is dispatched, each context is cold.
  await page.waitForTimeout(1500);await Promise.all(pending);
  results.push({fixture,repeat,readyMs,jsBytes:[...files.values()].reduce((n,v)=>n+v.bytes,0),gzipBytes:[...files.values()].reduce((n,v)=>n+v.gzipBytes,0),files:Object.fromEntries(files)});
  await context.close();
 }
 const chunks=[];for(const name of await readdir(join(root,'dist/web-dist/assets'))){if(name.endsWith('.js')){const bytes=await readFile(join(root,'dist/web-dist/assets',name));chunks.push({name,bytes:bytes.length,gzipBytes:gzipSync(bytes).length});}}
 const result={node:process.version,platform:process.platform,arch:process.arch,browser:browser.version(),root,generation,cache:'fresh browser context per sample',compression:'response decoded bytes and gzipSync default; server identity transfer',fixtureModelCalls:0,results,largestRawChunk:chunks.toSorted((a,b)=>b.bytes-a.bytes)[0],largestGzipChunk:chunks.toSorted((a,b)=>b.gzipBytes-a.gzipBytes)[0]};
 await writeFile(output,JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({generation,samples:results.map(({fixture,repeat,readyMs,jsBytes,gzipBytes})=>({fixture,repeat,readyMs,jsBytes,gzipBytes})),largestRawChunk:result.largestRawChunk}));
}finally{await browser.close();await app.close();}
