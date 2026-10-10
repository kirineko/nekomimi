import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
const [directory,generation,output]=process.argv.slice(2);
if(!directory||!['baseline','current'].includes(generation)||!output)throw Error('usage: root baseline|current output.json');
const root=resolve(directory),{run,Journal,readSession,startWeb}=await import(pathToFileURL(join(root,'dist/index.js')).href);
const config={model:'deepseek-flash',maxOutputTokens:2048,tools:['read','write','edit','bash'],apiKey:'offline-fixture',naming:false};
const results=[];
for(const rows of [0,400])for(let repeat=0;repeat<3;repeat++){
 const workspace=await mkdtemp(join(tmpdir(),'nekomimi-perf-work-')),home=await mkdtemp(join(tmpdir(),'nekomimi-perf-home-'));
 let app=await startWeb({workspace,home,...config,runtime:{fetch:async()=>{throw Error('No server model calls');}}});
 const session=await app.sessions.create('Performance fixture'),entry=await app.sessions.entry(session.id);
 const sessionDirectory=entry.directory;await app.close();
 const journal=await Journal.open(sessionDirectory);
 for(let i=0;i<rows;i++)await journal.append('context.add',{source:'user',item:{role:'user',content:[{type:'input_text',text:`History ${i}: inspect src/main.ts and preserve existing output. `+'saved context '.repeat(20)}]}},{},false);
 await journal.close();
 const before=await readFile(join(sessionDirectory,'journal.jsonl'));
 global.gc?.();const memoryBefore=process.memoryUsage();let peakRss=memoryBefore.rss;const timer=setInterval(()=>{peakRss=Math.max(peakRss,process.memoryUsage().rss);},5);
 const requests=[];const started=performance.now();
 let result;
 try{result=await run({workspace,home,session:sessionDirectory,...config,prompt:'Review the saved requirements and explain the next safe change.',fetch:async(_url,init)=>{
  const body=JSON.parse(String(init.body));requests.push({prepareMs:performance.now()-started,wireBytes:Buffer.byteLength(String(init.body)),schemaBytes:Buffer.byteLength(JSON.stringify(body.tools??[])),inputBytes:Buffer.byteLength(JSON.stringify(body.input??[])),instructionsBytes:Buffer.byteLength(body.instructions??''),toolNames:(body.tools??[]).map(t=>t.name),model:body.model});
  const item={type:'message',id:'fixture-message',status:'completed',role:'assistant',content:[{type:'output_text',text:'Offline fixture complete.',annotations:[]}]};
  const events=[{type:'response.created',response:{id:'fixture-response',status:'in_progress'}},{type:'response.output_item.added',output_index:0,item:{...item,content:[]}},{type:'response.content_part.added',output_index:0,content_index:0,part:{type:'output_text',text:'',annotations:[]}},{type:'response.output_text.delta',output_index:0,content_index:0,delta:'Offline fixture complete.'},{type:'response.output_item.done',output_index:0,item},{type:'response.completed',response:{id:'fixture-response',status:'completed',output:[item],usage:{input_tokens:100,output_tokens:5,total_tokens:105}}}];
  return new Response(events.map(event=>`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''),{headers:{'content-type':'text/event-stream'}});
 }});}finally{clearInterval(timer);}
 assert.equal(result.status,'completed',result.error);assert.equal(requests.length,1,'Exactly one local fixture response');
 const elapsedMs=performance.now()-started,memoryAfter=process.memoryUsage(),saved=await readFile(join(sessionDirectory,'journal.jsonl'));
 const restartStart=performance.now();app=await startWeb({workspace,home,...config,runtime:{fetch:async()=>{throw Error('Read-only recovery must not dispatch');}}});
 try{
  const headers={authorization:'Bearer '+app.token,origin:app.origin};
  const load=async(query='')=>{const start=performance.now();const response=await fetch(`${app.origin}/api/v1/sessions/${session.id}/snapshot${query}`,{headers});assert.equal(response.status,200);const data=await response.json();return{ms:performance.now()-start,data};};
  const latest=await load(),recoveryMs=performance.now()-restartStart;assert(latest.data.rows.length<=60);
  const pages=[];let cursor=latest.data.before;const seen=new Set(latest.data.rows.map(row=>row.id));
  while(cursor!==undefined){const next=await load('?before='+cursor);assert(next.data.rows.length<=60);for(const row of next.data.rows)seen.add(row.id);pages.push({ms:next.ms,rows:next.data.rows.length,before:next.data.before});if(next.data.before===cursor)throw Error('Pagination did not advance');cursor=next.data.before;}
  const snapshot=await readSession(sessionDirectory);const originals=snapshot.events.filter(e=>e.type==='context.add'&&e.payload.source==='user');assert.equal(originals.length,rows+1);for(const event of originals)assert(seen.has(event.eventId),'Stable historical row anchor missing');
  assert.deepEqual(await readFile(join(sessionDirectory,'journal.jsonl')),saved,'Recovery and paging changed Journal');
  results.push({rows,repeat,requests,elapsedMs,memoryBefore,memoryAfter,peakRss,recoveryMs,latestMs:latest.ms,pages,visibleAnchorCount:seen.size,journalBytesBefore:before.length,journalBytesAfter:saved.length,readOnlyRecovery:true,stableAnchors:true});
 }finally{await app.close();}
}
const value={generation,root,node:process.version,platform:process.platform,arch:process.arch,config:{...config,apiKey:undefined},realModelCalls:0,fixtureResponseUsage:'synthetic; not cost or quality evidence',gc:!!global.gc,scriptSha256:createHash('sha256').update(await readFile(new URL(import.meta.url))).digest('hex'),results};await writeFile(output,JSON.stringify(value,null,2)+'\n');console.log(JSON.stringify({generation,samples:results.map(({rows,repeat,requests,elapsedMs,peakRss,recoveryMs,pages})=>({rows,repeat,requests,elapsedMs,peakRss,recoveryMs,pageCount:pages.length}))}));
