import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
const entry=pathToFileURL(resolve(process.argv[2]??'node_modules/nekomimi/dist/pi/codemode.js')).href;
const {ScriptSandbox,CODEMODE_LIMITS}=await import(entry);
const sandbox=new ScriptSandbox();
try {
 assert.deepEqual((await sandbox.execute('return [typeof process,typeof fetch,typeof require];')).value,['undefined','undefined','undefined']);
 assert.equal((await sandbox.execute('return 6*7;')).value,42);
 let hostResponsive=false;const timer=setTimeout(()=>{hostResponsive=true;},20);
 const result=await sandbox.execute('while(true){}',{timeoutMs:150});clearTimeout(timer);
 assert.equal(result.ok,false);assert.equal(result.error.kind,'timeout');assert.equal(hostResponsive,true);
 console.log(JSON.stringify({installedCodemode:true,worker:true,wasm:true,hostResponsive,limits:CODEMODE_LIMITS}));
} finally {await sandbox.close();}
