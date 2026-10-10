import { expect, it } from 'vitest';
import { join } from 'node:path';
import { rename, readdir } from 'node:fs/promises';
import { Journal, hash, readArtifact } from '../src/journal.js';
import { assemblePrompt, contextView } from '../src/context.js';
import { compactContext, planCompaction } from '../src/compaction.js';
import { createSessionBinding, checkSessionTarget } from '../src/session/identity.js';
import { temporary } from './helpers.js';
import { CustomizationHost } from '../src/customization/host.js';
async function history(mode:'work'|'create'='work', unknown=false) {
  const owner=await temporary(),target=mode==='create'?await temporary():owner;
  const journal=await Journal.open(join(await temporary(),'session'));
  const binding=await createSessionBinding(owner,journal.sessionId,{commandId:'compaction-source',mode,...(mode==='create'?{target:{kind:'extension',root:target} as const}:{})},hash('source'));
  await journal.append('session.created',{binding});
  for(let i=0;i<7;i++) {
    await journal.append('context.add',{source:'user',item:{role:'user',content:'task '+i+' 中'.repeat(1300)}});
    if(unknown&&i===0) {
      await journal.append('context.add',{item:{type:'function_call',call_id:'unknown-call',name:'write',arguments:'{}'}});
      await journal.append('tool.intent',{name:'write'},{toolCallId:'unknown-tool'});
      await journal.append('recovery.tool_unknown',{item:{type:'function_call_output',call_id:'unknown-call',output:'UNKNOWN; do not repeat'}},{toolCallId:'unknown-tool'});
    }
    await journal.append('context.add',{item:{role:'assistant',content:'answer'}});
  }
  const prompt=assemblePrompt([],[],mode),model={id:'fixture',provider:'test',contextWindow:20000,maxTokens:2000};
  return {journal,binding,prompt,model,protocol:'responses',runId:'compact-run',signal:new AbortController().signal,manual:true,notify:()=>{},summarize:async()=> 'Preserve task goals and remaining work.'};
}
it('retains create stages, pending authorization and UNKNOWN as independent sourced data without touching work history',async()=>{
  const create=await history('create',true),work=await history(),raw=contextView(create.journal.events,create.prompt,true).nodes;
  const workRevision=contextView(work.journal.events,work.prompt).revision;
  const waiting=await create.journal.append('interaction.opened',{id:'grant',value:{title:'Apply candidate?',fields:[]}});
  const development={candidateId:'review-draft',revision:hash('candidate'),activeRevision:hash('older'),stage:'preview',passed:true,applied:false,pendingAuthorization:['tools'],host:create.binding.target.host};
  try {
    let calls=0;
    await compactContext({...create,retention:async()=>development,summarize:async events=>{
      calls++; const data=JSON.stringify(events[0]!.payload);
      expect(data).toContain('review-draft');expect(data).toContain('UNKNOWN');expect(data).toContain(waiting.eventId);
      return 'Candidate preview succeeded; pending application and UNKNOWN remain.';
    }});
    const event=create.journal.events.find(e=>e.type==='compaction.completed')!,checkpoint=event.payload as any;
    expect(calls).toBe(1);expect(checkpoint.source).toMatchObject({mode:'create',target:create.binding.target,model:create.model});
    expect(checkpoint.retention.development).toEqual(development);
    expect(checkpoint.retention.journal.unknown).toContainEqual(expect.objectContaining({state:'UNKNOWN',repeatsAuthorized:false}));
    expect(checkpoint.retention.journal.pendingAuthorization[0].eventId).toBe(waiting.eventId);
    expect(checkpoint.summary).toContain('"applied":false');expect(checkpoint.summary).toContain('模型摘要不得覆盖');
    expect((await readArtifact(create.journal.directory,checkpoint.artifact)).toString()).toBe(checkpoint.summary);
    expect(contextView(create.journal.events,create.prompt,true).nodes).toEqual(raw);
    expect(contextView(work.journal.events,work.prompt).revision).toBe(workRevision);
    expect(create.journal.events.filter(e=>e.type==='tool.intent')).toHaveLength(1);
    for(const tamper of ['identity','facts'] as const){
      const altered=structuredClone(create.journal.events),p=altered.find(e=>e.type==='compaction.completed')!.payload as any;
      if(tamper==='identity')p.source.mode='work';else p.retention.development.applied=true;
      expect(()=>contextView(altered,create.prompt)).toThrow('身份或保留事实');
    }
  } finally {await create.journal.close();await work.journal.close();}
});
for(const mutation of ['model','capability','authorization','retention','target','queue-authorization','queue-cancel','microtask-cancel'] as const)it(`refuses a late ${mutation} change even when conversation nodes are unchanged`,async()=>{
  const f=await history(),original=contextView(f.journal.events,f.prompt).revision;let authorized=true,state={stage:'preview',applied:false};
  const abort=new AbortController();
  const appendIf=f.journal.appendIf.bind(f.journal);
  if(mutation==='queue-authorization'||mutation==='queue-cancel'||mutation==='microtask-cancel')f.journal.appendIf=(type,payload,condition,links,guard)=>{
    if(type==='compaction.completed'){
      if(mutation==='microtask-cancel')return appendIf(type,payload,async()=>{const accepted=await condition();queueMicrotask(()=>abort.abort());return accepted;},links,guard);
      if(mutation==='queue-cancel')abort.abort();else authorized=false;
    }
    return appendIf(type,payload,condition,links,guard);
  };
  try {
    await expect(compactContext({...f,signal:abort.signal,revalidate:async()=>{await checkSessionTarget(f.binding);if(!authorized)throw Error('authorization revoked');},retention:async()=>state,summarize:async()=>{
      if(mutation==='model')f.model.id='changed';
      if(mutation==='capability')await f.journal.append('capabilities.effective',{capabilityRevision:'changed'},{runId:f.runId});
      if(mutation==='authorization')authorized=false;
      if(mutation==='retention')state={stage:'applied',applied:true};
      if(mutation==='target')await rename(f.binding.target.root,f.binding.target.root+'-moved');
      return 'small summary';
    }})).rejects.toThrow();
    expect(f.journal.events.some(e=>e.type==='compaction.completed')).toBe(false);
    expect(contextView(f.journal.events,f.prompt).revision).toBe(original);
    expect(f.journal.events.filter(e=>e.type===(mutation==='queue-cancel'||mutation==='microtask-cancel'?'compaction.cancelled':'compaction.failed'))).toHaveLength(1);
    expect(f.journal.failure.signal.aborted).toBe(false);
    await f.journal.append('observer.read',{});
  } finally {await f.journal.close();}
});
it('rejects recursive compaction while permitting one successful outer checkpoint',async()=>{
  const f=await history();try {
    await compactContext({...f,summarize:async()=>{await expect(compactContext(f)).rejects.toThrow('递归');return 'small summary';}});
    expect(f.journal.events.filter(e=>e.type==='compaction.started')).toHaveLength(1);
    expect(f.journal.events.filter(e=>e.type==='compaction.completed')).toHaveLength(1);
  }finally{await f.journal.close();}
});
it('refuses orphan results or overlapping call identities before any summary call',async()=>{
  for(const bad of ['output','duplicate'] as const){const f=await history();try{
    const items=bad==='output'?[{type:'function_call_output',call_id:'orphan',output:'done'}]:[{type:'function_call',call_id:'same'},{type:'function_call',call_id:'same'}];
    await f.journal.append('context.add',{items});
    expect(()=>planCompaction(contextView(f.journal.events,f.prompt),0,'responses')).toThrow();
    await expect(compactContext({...f,summarize:async()=>{throw Error('must not call');}})).rejects.toThrow();
    expect(f.journal.events.some(e=>e.type==='compaction.started')).toBe(false);
  }finally{await f.journal.close();}}
});
it('preserves a parallel tool group across a user boundary until all outputs arrive',async()=>{
  const f=await history();try{
    await f.journal.append('context.add',{items:[{type:'reasoning',id:'r'},{type:'function_call',call_id:'a'},{type:'function_call',call_id:'b'}]});
    await f.journal.append('context.add',{item:{type:'function_call_output',call_id:'a',output:'done'}});
    await f.journal.append('context.add',{item:{role:'user',content:'latest request'}});
    const plan=planCompaction(contextView(f.journal.events,f.prompt),0,'responses');
    expect(plan.tail.some(n=>n.item.call_id==='b')).toBe(true);expect(plan.tail.some(n=>n.item.call_id==='a'&&n.item.type==='function_call_output')).toBe(true);
    expect(plan.prefix.some(n=>n.item.call_id==='a'||n.item.call_id==='b')).toBe(false);
    await compactContext(f);expect(contextView(f.journal.events,f.prompt).nodes.some(n=>n.item.call_id==='b')).toBe(true);
  }finally{await f.journal.close();}
});
it('reads development stages and theme defaults without creating host or project data',async()=>{
  const workspace=await temporary(),home=await temporary(),host=new CustomizationHost(workspace,home);
  try{
    expect(await host.lifecycle.catalog()).toEqual([]);
    expect((await host.themes.describe()).project).toEqual({version:1,revision:0});
    expect(await readdir(workspace)).toEqual([]);expect(await readdir(home)).toEqual([]);
  }finally{await host.close();}
});
