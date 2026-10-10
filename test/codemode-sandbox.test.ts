import {expect,it} from 'vitest';
import {CODEMODE_LIMITS,ScriptSandbox} from '../src/pi/codemode.js';

it('exposes only injected capabilities and starts a new VM for each script',async()=>{
 const sandbox=new ScriptSandbox();
 try{
  const result=await sandbox.execute('return [typeof process,typeof fetch,typeof require,typeof WebAssembly,typeof setTimeout];');
  expect(result).toMatchObject({ok:true,value:Array(5).fill('undefined')});
  expect(await sandbox.execute('return await import("node:fs");')).toMatchObject({ok:false});
  expect(await sandbox.execute('globalThis.secret=1; store("x",1); return load("x");')).toMatchObject({ok:true,value:1,storeWrites:{set:{x:1}}});
  expect(await sandbox.execute('return [typeof secret,load("x")??null];')).toMatchObject({ok:true,value:['undefined',null]});
 }finally{await sandbox.close();}
});
it('bounds CPU, memory and output failures and remains usable',async()=>{
 const sandbox=new ScriptSandbox();
 try{
  let responsive=false;const tick=setTimeout(()=>{responsive=true;},20);
  expect(await sandbox.execute('while(true) {}',{timeoutMs:150})).toMatchObject({ok:false,error:{kind:'timeout'}});
  clearTimeout(tick);expect(responsive).toBe(true);
  expect(await sandbox.execute('const a=[]; while(true) a.push(new Array(10000).fill(123));',{timeoutMs:2000})).toMatchObject({ok:false});
  const output=await sandbox.execute('text("prefix"); for(let i=0;i<100001;i++) text("");',{timeoutMs:5000});
  expect(output.ok).toBe(false);expect(output.output[0]).toEqual({type:'text',text:'prefix'});
  expect(output.output.length).toBeLessThanOrEqual(CODEMODE_LIMITS.outputItems);
  expect(await sandbox.execute('return 42;')).toMatchObject({ok:true,value:42});
 }finally{await sandbox.close();}
},15000);
it('cancels running code without blocking the host and rejects unbounded options',async()=>{
 const sandbox=new ScriptSandbox(),controller=new AbortController();
 try{
  const running=sandbox.execute('while(true) {}',{signal:controller.signal});
  setTimeout(()=>controller.abort(),100);
  expect(await running).toMatchObject({ok:false,error:{kind:'aborted'}});
  expect(await sandbox.execute('return 1',{timeoutMs:Infinity})).toMatchObject({ok:false});
  expect(await sandbox.execute('x'.repeat(CODEMODE_LIMITS.sourceBytes+1))).toMatchObject({ok:false,calls:[]});
  expect(await sandbox.execute('return 1',{store:{x:'x'.repeat(CODEMODE_LIMITS.storeValueChars+1)}})).toMatchObject({ok:false,calls:[]});
 }finally{await sandbox.close();}
});
