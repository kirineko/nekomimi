import { expect, it } from 'vitest';
import { chmod, mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Candidates, type CandidateDelivery } from '../src/customization/candidates.js';
import { createSessionBinding } from '../src/session/identity.js';
import { hash, readSession } from '../src/journal.js';
import { temporary } from './helpers.js';

async function fixture() {
  const workspace = await temporary(), development = await temporary(), home = await temporary();
  const source = await createSessionBinding(workspace, 'creator', {commandId:'create',mode:'create',target:{kind:'extension',root:development}}, hash('create'),home);
  const target = await createSessionBinding(workspace, 'worker', {commandId:'work',mode:'work'}, hash('work'),home);
  const store = new Candidates(development), work = new Candidates(workspace);
  const candidate = await store.scaffold('review','command',{session:source,runId:'development'});
  const marker = join(workspace,'factory-ran');
  await writeFile(join(candidate.path,'index.ts'),`import {writeFileSync} from 'node:fs';writeFileSync(${JSON.stringify(marker)},'unexpected');export default (api:import('nekomimi/extensions').ExtensionAPI)=>{api.registerCommand('review',{description:'review',async handler(){return 'review-v1'}})};`);
  const binary = Buffer.from([137,80,78,71,13,10,26,10,255,0,128]);
  await writeFile(join(candidate.path,'result.png'),binary);
  const inspected = await store.inspect(candidate.id);
  expect(inspected.candidate.report.passed,JSON.stringify(inspected.candidate.report.diagnostics)).toBe(true);
  const delivery:CandidateDelivery = {source,target,handoffId:hash('handoff'),candidateId:candidate.id,contentHash:inspected.candidate.contentHash};
  return {workspace,development,home,store,work,candidate,marker,binary,delivery};
}

it('stages the exact project version with target identity, binary bytes and durable provenance without activation',async()=>{
  const f=await fixture();
  const original=await readFile(join(f.candidate.path,'index.ts'));
  const received=await f.work.stageDelivery(f.delivery,f.home);
  expect(received.id).not.toBe((await f.store.read(f.candidate.id)).id);
  expect(received.hash).toBe(f.delivery.contentHash);
  expect(received.scope).toBe('project');
  expect(received.root).toBe(join(f.work.base,'content',f.delivery.contentHash));
  expect(await readFile(join(received.root,'index.ts'))).toEqual(original);
  expect(await readFile(join(received.root,'result.png'))).toEqual(f.binary);
  expect(await readFile(join(f.candidate.path,'index.ts'))).toEqual(original);
  await expect(readFile(f.marker)).rejects.toMatchObject({code:'ENOENT'});
  expect(await f.work.active()).toEqual([]);
  const directory=join(f.work.base,'customization-journal');
  const before=await readFile(join(directory,'journal.jsonl'));
  expect((await readSession(directory)).events.filter(e=>e.type==='candidate.delivery.staged')).toEqual([expect.objectContaining({handoffId:f.delivery.handoffId,payload:expect.objectContaining({...f.delivery,resourceId:received.id})})]);
  expect((await f.work.stageDelivery(f.delivery,f.home)).id).toBe(received.id);
  expect(await readFile(join(directory,'journal.jsonl'))).toEqual(before);
  expect(await readdir(f.home)).toEqual([]);
});

it('rejects changed or invalid source code before writing the work project',async()=>{
  const f=await fixture();
  await writeFile(join(f.candidate.path,'index.ts'),'export default () => { broken syntax');
  await expect(f.work.stageDelivery(f.delivery,f.home)).rejects.toThrow('changed since validation');
  await expect(readdir(f.work.base)).rejects.toMatchObject({code:'ENOENT'});
  const changed=await f.store.read(f.candidate.id);
  await expect(f.work.stageDelivery({...f.delivery,contentHash:changed.hash},f.home)).rejects.toThrow('type validation failed');
  await expect(readdir(f.work.base)).rejects.toMatchObject({code:'ENOENT'});
  await expect(readFile(f.marker)).rejects.toMatchObject({code:'ENOENT'});
});

it('rejects foreign owners, user scope, replaced targets and unsupported destination storage',async()=>{
  const f=await fixture();
  await expect(f.work.stageDelivery({...f.delivery,source:{...f.delivery.source,ownerWorkspace:await temporary()}},f.home)).rejects.toThrow('身份无效');
  await expect(f.work.stageDelivery({...f.delivery,source:{...f.delivery.source,target:{...f.delivery.source.target,scope:'user'}}},f.home)).rejects.toThrow('身份无效');
  await expect(readdir(f.work.base)).rejects.toMatchObject({code:'ENOENT'});
  await mkdir(f.work.base,{recursive:true});
  const old=Buffer.from('{"version":1}');await writeFile(join(f.work.base,'active-customizations.json'),old);
  await expect(f.work.stageDelivery(f.delivery,f.home)).rejects.toThrow('格式不受支持');
  expect(await readdir(f.work.base)).toEqual(['active-customizations.json']);
  expect(await readFile(join(f.work.base,'active-customizations.json'))).toEqual(old);
  await rename(f.development,f.development+'-moved');await mkdir(f.development);
  await expect(f.work.stageDelivery(f.delivery,f.home)).rejects.toThrow('原目标目录');
  expect(await readFile(join(f.work.base,'active-customizations.json'))).toEqual(old);
});

it('does not repair tampered immutable delivery bytes or overwrite an existing active selection',async()=>{
  const f=await fixture(),received=await f.work.stageDelivery(f.delivery,f.home);
  await f.work.commit(received,['commands'],0);
  const pointer=await readFile(join(f.work.base,'active-customizations.json'));
  await chmod(join(received.root,'result.png'),0o644);
  await writeFile(join(received.root,'result.png'),Buffer.concat([f.binary,Buffer.from([1])]));
  await expect(f.work.stageDelivery(f.delivery,f.home)).rejects.toThrow('integrity');
  expect(await readFile(join(f.work.base,'active-customizations.json'))).toEqual(pointer);
  await expect(readFile(f.marker)).rejects.toMatchObject({code:'ENOENT'});
});
