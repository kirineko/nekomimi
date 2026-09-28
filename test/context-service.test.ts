import {expect,it} from 'vitest';
import {startWeb} from '../src/server/app.js';
import {temporary,key,response,textItem} from './helpers.js';
import {id,Journal} from '../src/journal.js';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
it('snapshot measurement is read-only, cached, session-scoped and independent of history pages',async()=>{
 const workspace=await temporary(),home=await temporary();let calls=0;
 const options={workspace,home,apiKey:key,naming:false,runtime:{fetch:async()=>{calls++;return response([textItem('done')]);}}};let app=await startWeb(options);
 try{
 const session=await app.sessions.create('stats');const other=await app.sessions.create('other');
 await app.sessions.submit(session.id,{version:1,commandId:id(),prompt:'hello'});await app.sessions.active?.done;
 let entry=await app.sessions.entry(session.id);const first=await app.sessions.context(entry);expect(first.context?.totalTokens).toBeGreaterThan(0);expect(first.context?.contextWindow).toBe(1000000);
 const text=await readFile(join(entry.directory,'journal.jsonl'),'utf8');const before=calls;expect(await app.sessions.context(entry)).toBe(first);expect((await app.sessions.context(await app.sessions.entry(other.id))).context).toBeUndefined();expect(calls).toBe(before);expect(await readFile(join(entry.directory,'journal.jsonl'),'utf8')).toBe(text);
 const req=async(query='')=>(await fetch(app.origin+`/api/v1/sessions/${session.id}/snapshot${query}`,{headers:{authorization:`Bearer ${app.token}`}})).json();
 expect((await req('?before=2')).context).toEqual(first.context);expect((await req()).context).toEqual(first.context);
 const settings=await app.sessions.config.describe();await app.sessions.config.save('settings',{...settings,model:'unknown'});expect((await app.sessions.context(entry)).context?.contextWindow).toBeUndefined();
 await app.close();app=await startWeb(options);await app.sessions.customization.initialize();entry=await app.sessions.entry(session.id);expect((await app.sessions.context(entry)).context?.model).toBe('unknown');expect(calls).toBe(before);
 }finally{await app.close();}
});
it('manual compact deduplicates receipts, refuses busy and does not name an empty session',async()=>{
 let calls=0;const app=await startWeb({workspace:await temporary(),home:await temporary(),apiKey:key,runtime:{fetch:async()=>{calls++;return response([textItem()]);}}});
 try{const session=await app.sessions.create('empty'),command={version:1 as const,commandId:id(),prompt:'/compact'};const receipt=await app.sessions.submit(session.id,command);await app.sessions.active?.done;const again=await app.sessions.submit(session.id,command);expect(again.runId).toBe(receipt.runId);expect(calls).toBe(0);
 const entry=await app.sessions.entry(session.id);expect(entry.reader.events.filter(e=>e.type==='run.started')).toHaveLength(1);
 const interrupted=await Journal.open(entry.directory);await interrupted.append('compaction.started',{operation:'crashed'},{runId:'crashed'});await interrupted.close();expect((await app.sessions.context(await app.sessions.entry(session.id))).compacting).toBe(false);expect(calls).toBe(0);
 }finally{await app.close();}
});

it('refuses compact while a task is active and preserves the existing receipt',async()=>{
 let arrived!:()=>void;const ready=new Promise<void>(r=>arrived=r);
 const app=await startWeb({workspace:await temporary(),home:await temporary(),apiKey:key,naming:false,runtime:{fetch:async(_url,init)=>{arrived();return new Promise<Response>((_,reject)=>init!.signal!.addEventListener('abort',()=>reject(init!.signal!.reason),{once:true}));}}});
 try{const session=await app.sessions.create('busy');const command={version:1 as const,commandId:id(),prompt:'work'};const receipt=await app.sessions.submit(session.id,command);await ready;
 await expect(app.sessions.submit(session.id,{version:1,commandId:id(),prompt:'/compact'})).rejects.toThrow();expect((await app.sessions.submit(session.id,command)).runId).toBe(receipt.runId);await app.sessions.cancel(session.id,receipt.runId);await app.sessions.active?.done;
 }finally{await app.close();}
});
