import { TOOL_RESULT_POLICY } from './context-budget.js';
import { hash, type Artifact, type Journal } from './journal.js';
import type { RuntimeToolResult } from './tool-contracts.js';
import type { Content } from './customization/types.js';
export function utf8Prefix(text:string,bytes:number) {
 const buffer=Buffer.from(text);let end=Math.min(Math.max(0,bytes),buffer.length);
 while(end>0&&end<buffer.length&&(buffer[end]!&0xc0)===0x80)end--;
 return buffer.subarray(0,end).toString('utf8');
}
function encodedPrefix(text:string,bytes:number) {
 let low=0,high=Math.min(Buffer.byteLength(text),Math.max(0,bytes));
 while(low<high){const middle=Math.ceil((low+high)/2),candidate=utf8Prefix(text,middle);
  if(Buffer.byteLength(JSON.stringify({type:'text',text:candidate}))<=bytes)low=middle;else high=middle-1;}
 return utf8Prefix(text,low);
}
/** Evidence stays complete; only the model-visible result is selected here. */
export function projectToolResult(value:RuntimeToolResult & {isError?:boolean},full:Artifact) {
 const raw=JSON.stringify(value),policy=TOOL_RESULT_POLICY;
 const textBytes=value.content.filter((item):item is Extract<Content,{type:'text'}>=>item.type==='text').reduce((size,item)=>size+Buffer.byteLength(item.text),0);
 const imageBytes=value.content.filter((item):item is Extract<Content,{type:'image'}>=>item.type==='image').reduce((size,item)=>size+Buffer.byteLength(item.data),0);
 const imageCount=value.content.filter(item=>item.type==='image').length;
 if(Buffer.byteLength(raw)<=policy.textBytes&&imageBytes<=policy.imageBytes&&imageCount<=policy.imageCount&&!value.isError)return {result:value,changed:false};
 const content:Content[]=[],retained:Array<{index:number;type:string;bytes:number;hash:string}>=[];
 let usedText=0,usedEncoded=0,usedImages=0,keptImages=0,textBlocks=0,omittedImages=0;
 // Reserve room for the continuation and small, useful paging/file metadata.
 const allowance=policy.textBytes-4096;
 value.content.forEach((item,index)=>{
  if(item.type==='text'){
   const text=textBlocks<32?encodedPrefix(item.text,Math.max(0,allowance-usedEncoded)):'';
   if(text){content.push({type:'text',text});usedText+=Buffer.byteLength(text);usedEncoded+=Buffer.byteLength(JSON.stringify({type:'text',text}));textBlocks++;retained.push({index,type:'text',bytes:Buffer.byteLength(text),hash:hash(text)});}
  }else{
   const bytes=Buffer.byteLength(item.data);
   if(!value.isError&&keptImages<policy.imageCount&&usedImages+bytes<=policy.imageBytes){content.push({...item});usedImages+=bytes;keptImages++;retained.push({index,type:'image',bytes,hash:hash(item.data)});}
   else omittedImages++;
  }
 });
 const originalDetails=value.details&&typeof value.details==='object'&&!Array.isArray(value.details)&&Buffer.byteLength(JSON.stringify(value.details))<=2048?value.details as Record<string,unknown>:{};
 const omittedTextBytes=Math.max(0,textBytes-usedText);
 const note=`[${omittedTextBytes||omittedImages?'Truncated. ':''}Full tool result: artifact:${full.sha256}. Continue with read({path:"artifact:${full.sha256}",offset,limit}); image entries use read({path:"artifact:${full.sha256}",imageIndex:<original content index>}). Omitted text: ${omittedTextBytes} bytes; omitted images: ${omittedImages}.]`;
 const firstText=content.find((item):item is Extract<Content,{type:'text'}>=>item.type==='text');
 if(firstText)firstText.text+='\n'+note;else content.push({type:'text',text:note});
 const result:RuntimeToolResult & {isError?:boolean}={content,details:{...(omittedTextBytes?{}:originalDetails),artifact:omittedTextBytes?full:originalDetails.artifact??full,
  ...(omittedTextBytes?{sourceDetails:originalDetails}:{}),fullResult:full,resume:{path:`artifact:${full.sha256}`,offset:0},truncated:!!(omittedTextBytes||omittedImages),projectionVersion:policy.version},
  ...(value.usage?{usage:value.usage}:{}),...(value.addedToolNames?{addedToolNames:value.addedToolNames}:{}),...(value.terminate!==undefined?{terminate:value.terminate}:{}),...(value.isError!==undefined?{isError:value.isError}:{})};
 return {result,changed:true,metadata:{version:policy.version,policy,full,retained,continuation:{source:'host:tool-result-continuation:v2',hash:hash(note),contentIndex:content.findIndex(item=>item.type==='text')},omittedTextBytes,omittedImages,imageBytes:usedImages,textBytes:usedText,detailsOmitted:Object.keys(originalDetails).length===0&&value.details!==undefined}};
}
export async function saveToolProjection(journal:Journal,value:RuntimeToolResult & {isError?:boolean},full:Artifact) {
 const projected=projectToolResult(value,full);
 if(projected.changed)await journal.append('tool.projection',{...projected.metadata,projected:await journal.artifact(JSON.stringify(projected.result))});
 return projected.result;
}
