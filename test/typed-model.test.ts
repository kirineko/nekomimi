import { expect, it } from 'vitest';
import { Journal, readArtifact } from '../src/journal.js';
import { executeTypedModel, TypedModelError, type TypedModelRequest } from '../src/pi/typed-model.js';
import { temporary } from './helpers.js';
const model = {id:'same',name:'Fixture',provider:'fixture',baseUrl:'https://fixture.invalid/v1',input:['text' as const],cost:{input:0,output:0,cacheRead:0,cacheWrite:0}};
const classifier = ():TypedModelRequest => ({operation:'classifier',apiKey:'synthetic-secret',paths:['/v1/systemone'],revision:'v1',links:{toolCallId:'child',parentToolCallId:'script'},model:{...model,type:'classifier',api:'typesafe-system-one',contextWindow:8192},context:{state:{text:'fixture'},questions:{ready:{type:'bool',instructions:'ready?',criteria:{true:'ready',false:'not ready'}}}}});
const image = ():TypedModelRequest => ({operation:'image',apiKey:'synthetic-secret',paths:['/v1/chat/completions'],revision:'v1',links:{toolCallId:'image-child'},model:{...model,type:'image',api:'openrouter-images',output:['image','text']},context:{input:[{type:'text',text:'draw'}]}});
const boolResponse = {answers:{ready:{type:'noul',noul:0.9}},usage:{input_tokens:3,output_tokens:1}};

it('records actual non-streaming classifier bytes and typed answers with one attempt',async()=>{
 const journal=await Journal.open(await temporary());let calls=0;
 try{
  const result=await executeTypedModel(journal,{...classifier(),transport:{fetch:async(url,init)=>{calls++;expect(String(url)).toBe('https://fixture.invalid/v1/systemone');expect(JSON.parse(String(init?.body)).model).toBe('same');return Response.json(boolResponse);}}});
  expect(result.value).toMatchObject({answers:{ready:{type:'bool',probability:0.9}},usage:{input:3,output:1,cost:null}});
  expect(calls).toBe(1);expect(journal.events.filter(e=>e.type==='attempt.started')).toHaveLength(1);
  expect(journal.events.find(e=>e.type==='attempt.started')?.parentToolCallId).toBe('child');
  expect(journal.events.filter(e=>e.type==='context.add')).toHaveLength(0);
  expect(JSON.stringify(journal.events)).not.toContain('synthetic-secret');
 }finally{await journal.close();}
});
it('persists generated image bytes and keeps missing usage unknown',async()=>{
 const journal=await Journal.open(await temporary());
 try{
  const result=await executeTypedModel(journal,{...image(),transport:{fetch:async(_url,init)=>{expect(JSON.parse(String(init?.body)).stream).toBe(false);return Response.json({choices:[{message:{content:'caption',images:[{image_url:{url:'data:image/png;base64,aGVsbG8='}}]}}]});}}});
  expect(result.value.usage).toEqual({input:null,output:null,cost:null});
  expect(result.evidence.attachments).toHaveLength(1);
  expect((await readArtifact(journal.directory,result.evidence.attachments[0]!.artifact)).toString()).toBe('hello');
 }finally{await journal.close();}
});
it('preserves known usage on failed classification and never returns it as an answer',async()=>{
 const journal=await Journal.open(await temporary());let calls=0;
 try{
  const error=await executeTypedModel(journal,{...classifier(),transport:{fetch:async()=>{calls++;return Response.json({answers:{},usage:{input_tokens:4}});}}}).catch(e=>e);
  expect(error).toBeInstanceOf(TypedModelError);expect(error.evidence.usage).toEqual({input:4,output:null,cost:null});expect(calls).toBe(1);
  expect(journal.events.at(-1)?.payload).toMatchObject({outcome:'failed'});
 }finally{await journal.close();}
});
it('rejects unavailable credentials and unauthorized paths without transport or fallback',async()=>{
 const journal=await Journal.open(await temporary());let calls=0;
 try{
  const transport={fetch:async()=>{calls++;return Response.json(boolResponse);}};
  await expect(executeTypedModel(journal,{...classifier(),apiKey:'',transport})).rejects.toThrow('credential');
  await expect(executeTypedModel(journal,{...classifier(),paths:['/different'],transport})).rejects.toThrow('authorized paths');
  expect(calls).toBe(0);expect(journal.events.filter(e=>e.type==='request.dispatched')).toHaveLength(0);
 }finally{await journal.close();}
});
it('does not publish a late image when cancellation arrives during the result commit',async()=>{
 const controller=new AbortController();let cancel=false;
 const journal=await Journal.open(await temporary(),{beforeIO:async op=>{if(cancel&&op==='sync'&&journal.events.at(-1)?.type==='model.operation.result')controller.abort();}});
 try{
  cancel=true;
  const error=await executeTypedModel(journal,{...image(),signal:controller.signal,transport:{fetch:async()=>Response.json({choices:[{message:{content:'late',images:[{image_url:{url:'data:image/png;base64,aGVsbG8='}}]}}],usage:{prompt_tokens:2,completion_tokens:1}})}}).catch(e=>e);
  expect(error).toBeInstanceOf(TypedModelError);expect(error.message).toContain('cancelled');expect(error.evidence.attachments).toHaveLength(1);
  expect(journal.events.at(-1)?.payload).toMatchObject({outcome:'cancelled'});
  expect(journal.events.filter(e=>e.type==='request.dispatched')).toHaveLength(1);
 }finally{await journal.close();}
});
it('returns choice and score answers and rejects out-of-range probabilities',async()=>{
 const journal=await Journal.open(await temporary());
 try{
  const req=classifier();if(req.operation!=='classifier')throw new Error('fixture');
  req.context.questions={choice:{type:'choice',instructions:'choose',criteria:{yes:'yes',no:'no'}},score:{type:'score',instructions:'score',criteria:['low','high']}};
  const answer={choice:{type:'choice',choice:'yes',probabilities:{yes:0.8,no:0.2},confidence:0.8},score:{type:'score',score:0.75,confidence:0.9}};
  const result=await executeTypedModel(journal,{...req,transport:{fetch:async()=>Response.json({answers:answer})}});
  expect(result.value).toMatchObject({answers:answer});
  await expect(executeTypedModel(journal,{...classifier(),transport:{fetch:async()=>Response.json({answers:{ready:{type:'noul',noul:2}},usage:{input_tokens:1,output_tokens:0}})}})).rejects.toThrow('Invalid classifier answer');
  expect(journal.events.at(-1)?.payload).toMatchObject({outcome:'failed',usage:{input:1,output:0,cost:null}});
 }finally{await journal.close();}
});
it('does not retry HTTP rejection for either operation',async()=>{
 const journal=await Journal.open(await temporary());let calls=0;
 try{
  for(const request of [classifier(),image()])await expect(executeTypedModel(journal,{...request,transport:{fetch:async(_url,init)=>{expect(init?.redirect).toBe('error');calls++;return new Response('busy',{status:429});}}})).rejects.toBeInstanceOf(TypedModelError);
  expect(calls).toBe(2);expect(journal.events.filter(e=>e.type==='attempt.finished').every(e=>(e.payload as any).outcome==='failed')).toBe(true);
 }finally{await journal.close();}
});
