import { expect, it } from 'vitest';
import { join, resolve } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { Journal } from '../src/journal.js';
import { startManagedChild } from '../src/core/managed-child.js';
import { coreDistIdentity, portClosed } from '../src/core/validation.js';
import { ApiError } from '../src/shared/protocol.js';
import { temporary } from './helpers.js';
it('keeps the same authenticated origin across real child replacement and opens new writes only after the fence is released',async()=>{
  const root=await temporary(),workspace=join(root,'workspace'),home=join(root,'data');await mkdir(workspace);await mkdir(home);
  const journal=await Journal.open(join(root,'journal')),browserToken='b'.repeat(64),controller=new AbortController();
  const options={directory:resolve('.'),workspace,home,expectedBuild:await coreDistIdentity(resolve('.')),browserToken,journal,candidateId:'fixture',signal:controller.signal,secrets:[],control:async(action:string)=>{if(action==='preview')throw new ApiError(409,'core_busy','Synthetic busy');return{action,mode:'managed'};}};
  let child=await startManagedChild({...options,port:0});const origin=child.ready.origin,headers={authorization:`Bearer ${browserToken}`,origin,'content-type':'application/json'};
  try{
    expect(await(await fetch(origin+'/api/v1/core/status',{headers})).json()).toEqual({action:'status',mode:'managed'});
    const busy=await fetch(origin+'/api/v1/core/preview',{method:'POST',headers,body:'{}'});expect(busy.status).toBe(409);expect((await busy.json()).error.code).toBe('core_busy');
    const first=await child.stop();expect(first.cleanup).toBe('confirmed');
    child=await startManagedChild({...options,port:Number(new URL(origin).port),initialCoreFence:'switch-fixture'});
    expect(child.ready.origin).toBe(origin);expect(child.ready.switchSupported).toBe(true);
    const create=()=>fetch(origin+'/api/v1/sessions',{method:'POST',headers,body:JSON.stringify({version:1,title:'After switch',commandId:'create-after',mode:'work'})});
    expect((await create()).status).toBe(409);
    await child.command('release',{token:'switch-fixture'});expect((await create()).status).toBe(201);
    const stopped=await child.stop();expect(stopped.pid).not.toBe(first.pid);expect(await portClosed(Number(new URL(origin).port))).toBe(true);
    expect(JSON.stringify(journal.events)).not.toContain(browserToken);
  }finally{await child.stop();await journal.close();}
},30000);
