import {stream} from '@earendil-works/pi-ai/api/openai-responses';
import {writeFile,readFile} from 'node:fs/promises';
const model={id:'deepseek-flash',name:'DeepSeek',provider:'deepseek',api:'openai-responses',baseUrl:'https://api.deepseek.com',reasoning:true,input:['text','image'],cost:{input:0,output:0,cacheRead:0,cacheWrite:0},contextWindow:100000,maxTokens:4096,compat:{supportsDeveloperRole:false}};
const fixture=JSON.parse(await readFile(new URL('./live-auto-resume.json',import.meta.url)));
const input=structuredClone(fixture.request.input);
const captured=[];let wire;
const s=stream(model,{systemPrompt:'Reply briefly.',messages:[{role:'user',content:'probe',timestamp:1}]},{apiKey:process.env.DEEPSEEK_API_KEY,maxRetries:0,maxTokens:256,timeoutMs:30000,onPayload:p=>({...p,input,instructions:'Reply briefly.',tool_choice:'auto',tools:fixture.request.tools}),fetch:async(url,init)=>{
 wire=JSON.parse(init.body);
 const response=await fetch(url,init);
 if(!response.body)return response;
 const transform=new TransformStream({transform(chunk,c){captured.push(Buffer.from(chunk));c.enqueue(chunk);}});
 return new Response(response.body.pipeThrough(transform),{status:response.status,statusText:response.statusText,headers:response.headers});
}});
const types=[];for await(const e of s)types.push(e.type);const message=await s.result();
const result={test:'pi-live-responses-history',reason:message.stopReason,types,contentTypes:message.content.map(c=>c.type),usage:message.usage,rawBytes:Buffer.concat(captured).length,wireInputCount:wire?.input.length,error:message.errorMessage};
await writeFile(new URL('./pi-live-result.json',import.meta.url),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
