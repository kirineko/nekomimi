import { describe, it, expect } from 'vitest';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { run } from '../src/runtime.js';
import { readSession, readArtifact, hash } from '../src/journal.js';
import { exportSession, inspectBundle, importBundle } from '../src/export.js';
import { temporary, response, callItem, textItem, reasoning, key, events, encode } from './helpers.js';

describe('application integration', () => {
  it('preserves wire evidence, tool pairs, reasoning and resumed history; exports without execution', async () => {
    const workspace = await temporary(); const session = join(workspace, 'session'); const bodies: any[] = [];
    const fetch: typeof globalThis.fetch = async (_url, init) => {
      bodies.push(JSON.parse(String(init?.body)));
      return bodies.length === 1 ? response([reasoning, callItem('write', { path: 'created.txt', content: 'hello' })]) : response([textItem('<script>alert(1)</script> private-word')]);
    };
    const options = { workspace, session, apiKey: key, fetch, tools: ['write'], prompt: 'Create hello' };
    expect((await run(options)).status).toBe('completed');
    expect(await readFile(join(workspace, 'created.txt'), 'utf8')).toBe('hello');
    expect(bodies[1].input).toContainEqual(reasoning);
    expect(bodies[1].input.some((x: any) => x.type === 'function_call_output' && x.call_id === 'call_1')).toBe(true);
    expect(bodies[0].tool_choice).toBe('auto'); expect(bodies[0].instructions).toBeTruthy();
    expect(bodies[0].input.some((x: any) => x.role === 'developer' || x.role === 'system')).toBe(false);
    expect(bodies[0].tools.map((x: any) => x.name)).toEqual(['write']);
    expect(bodies[0].tools[0].parameters.properties.path.type).toBe('string');
    expect(bodies[0].tools[0].parameters.required).toEqual(expect.arrayContaining(['path', 'content']));
    expect((await run({ ...options, prompt: 'Continue' })).status).toBe('completed');
    expect(bodies[2].input).toContainEqual(reasoning);
    const snapshot = await readSession(session);
    const nativeTasks = snapshot.events.filter(e => e.type === 'durable.commit').flatMap(e => (e.payload as { writes: Array<{ type: string; value: { id: number; kind?: string; state?: { status: string } } }> }).writes).filter(write => write.type === 'task');
    expect(nativeTasks.some(write => write.value.kind === 'pi.generation' && write.value.state?.status === 'terminal')).toBe(true);
    expect(nativeTasks.some(write => write.value.kind === 'pi.tool' && write.value.state?.status === 'terminal')).toBe(true);
    for (const event of snapshot.events.filter(e => ['request.dispatched', 'tool.intent', 'tool.completed', 'tool.result'].includes(e.type))) {
      expect(event.conversationId).toBe(1);
      expect(event.modelCallId).toBeTypeOf('string');
      expect(event.attemptId).toBeTypeOf('string');
      const task = nativeTasks.find(write => write.value.id === event.frameworkTaskId);
      expect(task?.value.kind).toBe(event.type === 'request.dispatched' ? 'pi.generation' : 'pi.tool');
    }
    const requests = snapshot.events.filter(e => e.type === 'request.dispatched');
    for (let i = 0; i < requests.length; i++) {
      const p = requests[i]!.payload as any; const bytes = await readArtifact(snapshot.directory, p.body);
      expect(JSON.parse(bytes.toString())).toEqual(bodies[i]); expect(hash(bytes)).toBe(p.bodyHash); expect(bytes.toString()).not.toContain(key);
    }
    const count = bodies.length; const before = await readFile(join(session, 'journal.jsonl'));
    await exportSession(session, { format: 'html', output: join(workspace, 'view.html'), redact: ['private-word'] });
    const html = await readFile(join(workspace, 'view.html'), 'utf8');
    expect(html).not.toContain('<script>'); expect(html).toContain('&lt;script&gt;'); expect(html).not.toContain('private-word'); expect(html).toContain("default-src 'none'");
    const bundle = join(workspace, 'bundle'); await exportSession(session, { format: 'bundle', output: bundle });
    expect((await inspectBundle(bundle)).manifest.resumable).toBe(true);
    await importBundle(bundle, join(workspace, 'imported')); expect(bodies.length).toBe(count);
    expect(await readFile(join(session, 'journal.jsonl'))).toEqual(before);
    const redacted = join(workspace, 'redacted'); await exportSession(session, { format: 'bundle', output: redacted, redact: ['private-word'] });
    expect(await readFile(join(redacted, 'view.json'), 'utf8')).not.toContain('private-word');
    await expect(importBundle(redacted, join(workspace, 'bad-import'))).rejects.toThrow('not resumable');
    await writeFile(join(bundle, 'durable.json'), '{}'); await expect(inspectBundle(bundle)).rejects.toThrow('integrity');
  });
  it('records unknown SSE events and independent rate-limit attempts', async () => {
    const workspace = await temporary(); let calls = 0;
    const result = await run({ workspace, session: join(workspace, 's'), prompt: 'hello', apiKey: key, tools: [], retryDelayMs: 1,
      fetch: async () => ++calls === 1 ? new Response('{"error":{"message":"rate limit"}}', { status: 429 }) : new Response(encode([{ type: 'future.event', value: 42 }, ...events([textItem()])]), { headers: { 'content-type': 'text/event-stream' } }) });
    expect(result.status).toBe('completed'); expect(calls).toBe(2);
    const s = await readSession(result.session); const attempts = s.events.filter(e => e.type === 'attempt.started');
    expect(new Set(attempts.map(e => e.attemptId)).size).toBe(2); expect(new Set(attempts.map(e => e.modelCallId)).size).toBe(1);
    const chunks = s.events.filter(e => e.type === 'response.chunk');
    const raw = (await Promise.all(chunks.map(e => readArtifact(s.directory, (e.payload as any).artifact)))).map(b => b.toString()).join('');
    expect(raw).toContain('future.event');
  });
  it.each(['incomplete', 'failed'])('blocks tools on %s responses', async terminal => {
    const workspace = await temporary(); let calls = 0;
    const result = await run({ workspace, session: join(workspace, 's'), prompt: 'write', apiKey: key,
      fetch: async () => { calls++; return response([callItem('write', { path: 'never', content: 'bad' })], terminal); } });
    expect(result.status).not.toBe('completed'); expect(calls).toBe(1);
    await expect(readFile(join(workspace, 'never'))).rejects.toThrow();
    expect((await readSession(result.session)).events.some(e => e.type === 'tool.intent')).toBe(false);
  });
  it.each([{ maxResponseBytes: 50 }, { maxResponseEvents: 1 }])('fails closed on response cap %j', async limit => {
    const workspace = await temporary();
    const result = await run({ workspace, session: join(workspace, 's'), prompt: 'hi', apiKey: key, ...limit, fetch: async () => response([textItem()]) });
    expect(result.status).toBe('failed'); expect(result.error).toContain('limit');
  });
  it('fails on truncated frames without retrying partial responses', async () => {
    const workspace = await temporary(); let calls = 0;
    const result = await run({ workspace, session: join(workspace, 's'), prompt: 'hi', apiKey: key, fetch: async () => { calls++; return new Response('data: {"type":', { headers: { 'content-type': 'text/event-stream' } }); } });
    expect(result.status).toBe('failed'); expect(calls).toBe(1);
  });
  it('does not wait for a stalled display observer', async () => {
    const workspace = await temporary();
    const result = await run({ workspace, session: join(workspace, 's'), prompt: 'hi', apiKey: key, fetch: async () => response([textItem()]), onProgress: () => new Promise(() => {}) });
    expect(result.status).toBe('completed');
  });
});

it('uses 128K by default and records the actual exhausted budget without retrying partial tools',async()=>{
 const workspace=await temporary();const bodies:any[]=[];
 const result=await run({workspace,session:join(workspace,'s'),apiKey:key,prompt:'write',fetch:async(_u,init)=>{bodies.push(JSON.parse(String(init?.body)));return response([callItem('write',{path:'never',content:'no'})],'incomplete');}});
 expect(bodies).toHaveLength(1);expect(bodies[0].max_output_tokens).toBe(131072);expect(result.error).toContain('128K');
 const s=await readSession(result.session);expect(s.events.some(e=>e.type==='tool.intent')).toBe(false);
 expect(s.events.find(e=>e.type==='attempt.finished')?.payload).toMatchObject({incompleteReason:'max_output_tokens',outputBudget:131072});
});
it('preserves an explicit output budget and explains content filtering without retry',async()=>{
 const workspace=await temporary();let calls=0;
 const result=await run({workspace,session:join(workspace,'s'),apiKey:key,prompt:'hello',maxOutputTokens:2048,fetch:async(_u,init)=>{
  calls++;expect(JSON.parse(String(init?.body)).max_output_tokens).toBe(2048);
  const e=events([],'incomplete');e.at(-1)!.response.incomplete_details.reason='content_filter';return new Response(encode(e),{headers:{'content-type':'text/event-stream'}});
 }});expect(calls).toBe(1);expect(result.error).toContain('过滤');
});
it('stops at 64 turns by default while respecting an explicit turn cap',async()=>{
 for(const cap of [undefined,2]){
  const workspace=await temporary();let calls=0;
  const result=await run({workspace,session:join(workspace,'s'),apiKey:key,prompt:'read',tools:['read'],maxTurns:cap,fetch:async()=>++calls<66?response([callItem('read',{path:'missing'},'c'+calls)]):response([textItem('done')])});
  expect(calls).toBe(cap??64);expect(result.status).toBe('failed');expect(result.error).toContain('轮数上限');
 }
},60000);


it('does not retry a model request whose network outcome is unknown', async () => {
 const workspace=await temporary();let calls=0;
 const result=await run({workspace,session:join(workspace,'unknown'),apiKey:key,prompt:'hi',maxAttempts:3,fetch:async()=>{calls++;throw new Error('fetch failed after remote dispatch');}});
 expect(result.status).toBe('failed');expect(calls).toBe(1);
 const snapshot=await readSession(result.session);expect(snapshot.events.filter(e=>e.type==='attempt.started')).toHaveLength(1);
});
it('retains a completed network attempt but does not publish a value cancelled during its commit', async () => {
 const workspace=await temporary(),session=join(workspace,'late'),controller=new AbortController();let cancelled=false;
 const result=await run({workspace,session,apiKey:key,prompt:'write',signal:controller.signal,fetch:async()=>response([callItem('write',{path:'never',content:'late'})]),journalOptions:{beforeIO:async operation=>{
  if(cancelled||operation!=='sync')return;
  const raw=await readFile(join(session,'journal.jsonl'),'utf8').catch(()=>'');const line=raw.trim().split('\n').at(-1);if(!line)return;const event=JSON.parse(line);
  if(event.type==='attempt.finished'&&event.payload.status==='completed'){cancelled=true;controller.abort();}
 }}});
 expect(cancelled).toBe(true);expect(result.status).toBe('cancelled');
 const snapshot=await readSession(session);expect(snapshot.events.filter(e=>e.type==='attempt.finished')).toHaveLength(1);
 expect(snapshot.events.find(e=>e.type==='attempt.finished')?.payload).toMatchObject({status:'completed'});
 expect(snapshot.events.some(e=>e.type==='tool.intent'||(e.type==='context.add'&&String((e.payload as any).source).startsWith('response:')))).toBe(false);
});
