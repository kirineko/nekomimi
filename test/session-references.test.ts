import {expect,it} from 'vitest';
import {writeFile,rename,symlink,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {startWeb} from '../src/server/app.js';
import {temporary,key,response,textItem} from './helpers.js';

it('scopes discovery and resolve to the bound session and refuses a missing target without fallback',async()=>{
  const workspace=await temporary(),development=await temporary(),home=await temporary();let calls=0;
  await writeFile(join(workspace,'work-only.txt'),'private work contents');
  await writeFile(join(development,'create-only.txt'),'private development contents');
  await symlink(workspace,join(development,'escape'));
  const app=await startWeb({workspace,home,apiKey:key,naming:false,runtime:{fetch:async()=>{calls++;return response([textItem()]);}}});
  try{
    const work=await app.sessions.create('work',{mode:'work',commandId:'work'});
    const create=await app.sessions.create('create',{mode:'create',commandId:'create',target:{kind:'extension',root:development}});
    const read=(id:string,params:Record<string,string>)=>fetch(`${app.origin}/api/v1/workspace/references?${new URLSearchParams({session:id,...params})}`,{headers:{authorization:`Bearer ${app.token}`}});
    const workPage=await (await read(work.id,{query:'.txt'})).json();
    const createPage=await (await read(create.id,{query:'.txt'})).json();
    expect(workPage.entries.map((entry:any)=>entry.path)).toEqual(['work-only.txt']);
    expect(createPage.entries.map((entry:any)=>entry.path)).toEqual(['create-only.txt']);
    expect(JSON.stringify([workPage,createPage])).not.toContain('private');
    expect((await read(create.id,{mode:'resolve',path:'create-only.txt'})).status).toBe(200);
    for(const path of ['work-only.txt','escape/work-only.txt','../work-only.txt'])expect((await read(create.id,{mode:'resolve',path})).status).toBeGreaterThanOrEqual(400);
    const journal=join(app.sessions.root,create.id,'journal.jsonl'),before=await readFile(journal,'utf8');
    await rename(development,development+'-moved');
    expect((await read(create.id,{query:'.txt'})).status).toBeGreaterThanOrEqual(400);
    expect((await read('missing-session',{query:'.txt'})).status).toBeGreaterThanOrEqual(400);
    expect(await readFile(journal,'utf8')).toBe(before);expect(calls).toBe(0);
  }finally{await app.close();}
});
