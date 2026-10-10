import { expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Journal } from '../src/journal.js';
import { prepareDataHome } from '../src/storage/format.js';
import { coreOperationBlockers, reserveCoreOperations } from '../src/core/operation-fence.js';
import { temporary } from './helpers.js';
it('observes an empty home without creating operation journals',async()=>{
  const home=await temporary();await prepareDataHome(home);const before=await readdir(home);
  expect(await coreOperationBlockers(home)).toEqual([]);expect(await readdir(home)).toEqual(before);
});
it('holds the exact build and validation writers against independent processes, then releases both',async()=>{
  const home=await temporary();await prepareDataHome(home);const fence=await reserveCoreOperations(home);
  try {
    for(const root of ['core-builds','core-validations']){
      const path=join(home,root,'journal');
      const code=`const {Journal}=await import(${JSON.stringify(pathToFileURL(resolve('dist/journal.js')).href)});try{const j=await Journal.open(${JSON.stringify(path)});await j.close();process.exitCode=9;}catch(e){if(!String(e).includes('busy'))throw e;}`;
      await promisify(execFile)(process.execPath,['--input-type=module','-e',code],{timeout:10000});
    }
    expect(await coreOperationBlockers(home)).toEqual([{kind:'core-build',state:'writer-lease'},{kind:'core-validation',state:'writer-lease'}]);fence.check();
  } finally {await fence.release();}
  expect(await coreOperationBlockers(home)).toEqual([]);
  for(const root of ['core-builds','core-validations']){const writer=await Journal.open(join(home,root,'journal'));await writer.close();}
},15000);
it('refuses a live validation writer and releases the build reservation acquired before it',async()=>{
  const home=await temporary();await prepareDataHome(home);const active=await Journal.open(join(home,'core-validations/journal'));
  try {
    await expect(reserveCoreOperations(home)).rejects.toMatchObject({code:'core_busy'});
    const build=await Journal.open(join(home,'core-builds/journal'));await build.close();
  } finally {await active.close();}
});
it('blocks accepted tasks without a terminal and unknown outcomes without rewriting or replaying them',async()=>{
  const home=await temporary();await prepareDataHome(home);const path=join(home,'core-builds/journal'),writer=await Journal.open(path);
  try {await writer.append('core.build.intent',{buildId:'unfinished'});await writer.append('core.build.intent',{buildId:'unknown'});await writer.append('core.build.finished',{buildId:'unknown',status:'unknown'});} finally {await writer.close();}
  const before=await readFile(join(path,'journal.jsonl'));
  expect(await coreOperationBlockers(home)).toEqual([{kind:'core-build',id:'unfinished',state:'unfinished'},{kind:'core-build',id:'unknown',state:'unknown'}]);
  await expect(reserveCoreOperations(home)).rejects.toThrow('尚无确定终态');
  expect(await readFile(join(path,'journal.jsonl'))).toEqual(before);
});
it('treats a failed terminal with an unclosed port or missing started-process cleanup as unresolved',async()=>{
  const home=await temporary();await prepareDataHome(home);const writer=await Journal.open(join(home,'core-validations/journal'));
  try {
    await writer.append('core.validation.intent',{validationId:'port-open'});
    await writer.append('core.validation.finished',{validationId:'port-open',status:'failed',process:{pid:123,cleanup:'confirmed'},ports:[{port:10000,closed:false}]});
    await writer.append('core.validation.intent',{validationId:'lost-process'});
    await writer.append('core.validation.process.started',{pid:456},{validationTaskId:'lost-process'});
    await writer.append('core.validation.finished',{validationId:'lost-process',status:'failed'});
  } finally {await writer.close();}
  expect(await coreOperationBlockers(home)).toEqual([{kind:'core-validation',id:'port-open',state:'unknown'},{kind:'core-validation',id:'lost-process',state:'unknown'}]);
  await expect(reserveCoreOperations(home)).rejects.toMatchObject({code:'core_busy'});
});
