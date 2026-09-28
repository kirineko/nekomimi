import { expect,test } from 'vitest';
import { mkdir,writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { temporary } from './helpers.js';
import { CustomizationHost } from '../src/customization/host.js';
import { sdkCatalog } from '../src/customization/sdk.js';
test('lifecycle keeps missing theme permissions visible and binds evidence to revision',async()=>{
 const workspace=await temporary(),home=await temporary(),root=join(workspace,'.nekomimi/extensions/sample');await mkdir(root,{recursive:true});
 const manifest={name:'sample',entry:'index.ts',sdkVersion:2,requiredCapabilities:['commands']};
 await writeFile(join(root,'extension.json'),JSON.stringify(manifest));await writeFile(join(root,'index.ts'),'export default ()=>{}');
 let host=new CustomizationHost(workspace,home);
 try {
  const resource=(await host.catalog.discover()).find(r=>r.name==='sample')!;
  await host.catalog.decide(resource.id,true,true,0);
  await host.lifecycle.record(resource,'created',{sessionId:'source-session',runId:'source-run'});
  await host.lifecycle.record(resource,'static',{passed:true});
  await writeFile(join(root,'extension.json'),JSON.stringify({...manifest,requiredCapabilities:['commands','themes']}));
  const revision=(await host.catalog.decisions()).revision;
  const items=await host.lifecycle.catalog(),theme=items.find(a=>a.type==='themes')!;
  expect(theme.phase).toBe('authorization');expect(theme.missing).toEqual(['themes']);expect(theme.evidence).toEqual([]);expect(theme.source?.sessionId).toBe('source-session');
  expect((await host.catalog.decisions()).revision).toBe(revision);expect(host.active).toBeUndefined();
  host.requestReload();while(host.receipts.some(r=>r.status==='pending'))await new Promise(resolve=>setTimeout(resolve,10));
  expect(host.receipts.at(-1)?.status).toBe('failed');
  expect((await host.lifecycle.catalog()).find(a=>a.type==='themes')?.phase).toBe('authorization');
  await expect(host.catalog.decide(resource.id,true,true,revision,undefined,resource.hash)).rejects.toThrow('conflict');
  await host.close();host=new CustomizationHost(workspace,home);
  expect((await host.lifecycle.catalog()).find(a=>a.type==='themes')?.source?.sessionId).toBe('source-session');
  const sdk=await sdkCatalog();expect(sdk.host.build).toMatch(/^[a-f0-9]{64}$/);expect(sdk.host.entry).toContain('cli.ts');
 } finally {await host.close();}
});
test('activated candidates appear once and permissions do not become user-facing abilities',async()=>{
 const workspace=await temporary(),home=await temporary(),host=new CustomizationHost(workspace,home);
 const {Candidates}=await import('../src/customization/candidates.js');
 const store=new Candidates(workspace),draft=await store.scaffold('single','theme');
 try {
  const inspected=await store.inspect(draft.id);
  await host.requestCandidate(draft.id,inspected.candidate.contentHash,true);
  while(host.receipts.some(r=>r.status==='pending'))await new Promise(resolve=>setTimeout(resolve,10));
  expect(host.receipts.at(-1)?.status).toBe('activated');
  const items=(await host.lifecycle.catalog()).filter(a=>a.resourceId===inspected.resource.id);
  expect(items).toHaveLength(1);expect(items[0]?.phase).toBe('apply');expect(items[0]?.candidateId).toBeUndefined();
 } finally {await host.close();}
},30000);

test('loaded evidence excludes unauthorized, disabled and shadowed extensions', async () => {
 const workspace=await temporary(),home=await temporary(),host=new CustomizationHost(workspace,home);
 for(const [base,name] of [[join(workspace,'.nekomimi'),'pending'],[join(workspace,'.nekomimi'),'disabled'],[join(workspace,'.nekomimi'),'shared'],[home,'shared']]){
  const root=join(base!,'extensions',name!);await mkdir(root,{recursive:true});
  await writeFile(join(root,'extension.json'),JSON.stringify({name,sdkVersion:1,entry:'index.ts'}));
  await writeFile(join(root,'index.ts'),'export default () => {}');
 }
 try {
  const resources=(await host.catalog.discover()).filter(r=>r.manifest);
  for(const r of resources.filter(r=>r.name!=='pending')){
   await host.catalog.decide(r.id,r.name!=='disabled',true,(await host.catalog.decisions()).revision);
  }
  await host.initialize();
  expect(host.active?.extensions).toHaveLength(1);
  expect(host.active?.extensions[0]?.resource.scope).toBe('project');
  const loaded=(await host.lifecycle.evidence()).filter(e=>e.stage==='loaded');
  expect(loaded.map(e=>[e.resourceId,e.revision])).toEqual(host.active!.extensions.map(e=>[e.resource.id,e.resource.hash]));
  expect(loaded.every(e=>e.passed)).toBe(true);
 } finally {await host.close();}
},30000);
