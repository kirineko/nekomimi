import { useState,useId } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { InspectionView,InspectionNode,InspectionEvent } from '../../../shared/inspection';
import { api,request } from '../../api';
import { Button } from '../../ui/Button';
import { Select } from '../../ui/Input';
import { ArtifactReader } from './artifact-reader';
import { ContextDetailsButton } from './context-details-button';
const status=(value:string)=>({completed:'完成',failed:'失败',cancelled:'取消',aborted:'取消',unknown:'结果未知',running:'运行中',interrupted:'中断'} as Record<string,string>)[value]??value;
const amount=(value:number|null|undefined)=>value===null||value===undefined?'未知':value.toLocaleString();
function Json({value}:{value:unknown}){return <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-all text-xs">{JSON.stringify(value,null,2)}</pre>;}
const key=(sessionId:string)=>['v2',location.host,sessionId,'inspection'];
function useInspection(sessionId:string,params:Record<string,string|number|undefined>){
  const search=new URLSearchParams(Object.entries(params).filter(([,value])=>value!==undefined&&value!=='').map(([name,value])=>[name,String(value)]));
  return useQuery({queryKey:[...key(sessionId),search.toString()],queryFn:({signal})=>api<InspectionView>(`/sessions/${sessionId}/inspection?${search}`,undefined,signal),retry:false});
}
function SavedImage({sessionId,image}:{sessionId:string;image:InspectionEvent['images'][number]}){
  const [open,setOpen]=useState(false),[decodeError,setDecodeError]=useState(false);
  const query=useQuery({queryKey:[...key(sessionId),'image',image.artifact.sha256],enabled:open,gcTime:0,retry:false,queryFn:async({signal})=>{
    const response=await request(`/sessions/${sessionId}/inspection-image/${image.artifact.sha256}`,{signal}),blob=await response.blob();
    return new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=()=>reject(Error('图片读取失败'));reader.readAsDataURL(blob);});
  }});
  return <div className="space-y-2"><Button variant="outline" size="sm" onClick={()=>setOpen(!open)}>{open?'收起':'查看'}保存的图片 {image.index+1}</Button>{open&&<>{query.isPending&&<p role="status">读取已保存图片…</p>}{query.isError&&<p role="alert">{query.error.message}</p>}{decodeError&&<p role="alert">保存的图片无法解码，可检查原始附件。</p>}{query.data&&!decodeError&&<img src={query.data} alt={`保存的模型图片 ${image.index+1}`} className="h-auto max-w-full rounded-md border border-line" onError={()=>setDecodeError(true)} />}</>}</div>;
}
function ClassifierResult({sessionId,hash}:{sessionId:string;hash:string}){
  const query=useQuery({queryKey:[...key(sessionId),'classifier',hash],queryFn:({signal})=>api<{text:string;next?:number}>(`/sessions/${sessionId}/artifacts/${hash}?limit=65536`,undefined,signal),retry:false});
  if(query.isPending)return <p role="status">读取归一化分类结果…</p>;
  if(query.isError)return <p role="alert">分类结果不可读：{query.error.message}</p>;
  if(query.data.next!==undefined)return <p>归一化结果超过预览范围，请使用原始附件续读。</p>;
  let value:{answers?:Record<string,unknown>;stopReason?:string};try{value=JSON.parse(query.data.text);}catch{return <p>结果不是支持的 JSON 格式，请检查原始附件。</p>;}
  return <section aria-label="归一化分类结果"><h4>归一化分类结果 · {value.stopReason??'未记录终态'}</h4>{value.answers?Object.entries(value.answers).map(([question,answer])=><details key={question} open><summary className="break-all">{question}</summary><Json value={answer} /></details>):<p>未记录可展示的分类答案。</p>}</section>;
}
function EvidenceEvent({sessionId,event}:{sessionId:string;event:InspectionEvent}){
  const [open,setOpen]=useState(false),payload=event.payload as Record<string,any>;
  return <details onToggle={e=>setOpen(e.currentTarget.open)}><summary className="break-all">#{event.seq} · {event.type}</summary>{open&&<div className="space-y-3 py-2"><p className="text-xs">{event.timestamp}</p><Json value={{eventId:event.eventId,links:event.links,payload:event.payload}} />
    {event.type==='model.operation.result'&&payload.operation==='classifier'&&typeof payload.result?.sha256==='string'&&<ClassifierResult sessionId={sessionId} hash={payload.result.sha256} />}
    {(event.type==='context.snapshot'||typeof payload.contextSnapshot?.eventId==='string')&&<ContextDetailsButton sessionId={sessionId} initialSnapshot={event.type==='context.snapshot'?event.eventId:payload.contextSnapshot.eventId} label="查看此请求的上下文" />}
    {event.images.map(image=><SavedImage key={`${image.index}:${image.artifact.sha256}`} sessionId={sessionId} image={image} />)}
    {event.artifacts.map((artifact,index)=><ArtifactReader key={`${artifact.sha256}:${index}`} sessionId={sessionId} hash={artifact.sha256} label={`原始附件 ${index+1}`} />)}
  </div>}</details>;
}
function TreeNode({sessionId,run,node,select,depth}:{sessionId:string;run:string;node:InspectionNode;select:(node:string)=>void;depth:number}){
  const [open,setOpen]=useState(false),metaId=useId();
  return <li className="space-y-2 border-l border-line pl-2"><div className="flex flex-wrap items-center gap-2"><Button variant="outline" size="sm" className="h-auto min-h-8 max-w-full whitespace-normal break-all text-left" aria-describedby={metaId} onClick={()=>select(node.id)}>{node.label} · {status(node.status)}</Button>{node.children>0&&<Button variant="ghost" size="sm" aria-expanded={open} onClick={()=>setOpen(!open)}>{open?'收起':'展开'}子调用（{node.children}）</Button>}</div><p id={metaId} className="break-all text-xs text-muted">#{node.seq} · {node.kind==='model'?node.model??'模型未记录':node.toolCallId}</p>{node.parentMissing&&<p className="text-xs text-warning">父引用缺失或循环：{node.parentReference}</p>}{open&&(depth<20?<TreePage sessionId={sessionId} run={run} parent={node.id} select={select} depth={depth+1} />:<p>嵌套超过当前预览深度；选择此调用后，可从其详情继续浏览子调用。</p>)}</li>;
}
function TreePage({sessionId,run,parent,select,depth=0}:{sessionId:string;run:string;parent?:string;select:(node:string)=>void;depth?:number}){
  const [offset,setOffset]=useState(0),query=useInspection(sessionId,{run,parent,offset});
  return <div className="space-y-2">{query.isPending&&<p role="status">读取调用树…</p>}{query.isError&&<p role="alert">{query.error.message}</p>}{query.data&&<><ul aria-label={parent?'子调用':'调用树'} className="m-0 list-none space-y-3 pl-0">{query.data.nodes.map(node=><TreeNode key={node.id} node={node} sessionId={sessionId} run={run} select={select} depth={depth} />)}</ul>{!query.data.nodes.length&&<p>没有调用记录。</p>}{(offset>0||query.data.next!==undefined)&&<div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" disabled={!offset} onClick={()=>setOffset(Math.max(0,offset-40))}>上一页调用</Button><Button size="sm" variant="outline" disabled={query.data.next===undefined} onClick={()=>setOffset(query.data!.next!)}>下一页调用</Button></div>}</>}</div>;
}
function NodeDetail({sessionId,run,node,select}:{sessionId:string;run:string;node:string;select:(node:string)=>void}){
  const [attempt,setAttempt]=useState(''),[eventOffset,setEventOffset]=useState(0),[attemptOffset,setAttemptOffset]=useState(0),[group,setGroup]=useState('');
  const query=useInspection(sessionId,{run,node,attempt,eventOffset,attemptOffset,group}),data=query.isError?undefined:query.data?.detail;
  return <section aria-label="所选调用证据" className="min-w-0 space-y-3 rounded-lg border border-line p-3">{query.isPending&&<p role="status">读取调用证据…</p>}{query.isError&&<p role="alert">{query.error.message}</p>}{data&&<><h3>{data.node.label} · {status(data.node.status)}</h3>{data.node.children>0&&<details><summary>从此调用继续浏览子调用</summary><TreePage sessionId={sessionId} run={run} parent={node} select={select} /></details>}<details><summary>调用身份与归属</summary><Json value={data.node} /></details>
    {data.attempts.length>0&&<><label className="block">网络尝试<Select aria-label="网络尝试" className="w-full" value={attempt} onChange={event=>{setAttempt(event.target.value);setEventOffset(0);}}><option value="">全部 attempts 与调用来源</option>{attempt&&!data.attempts.some(item=>item.id===attempt)&&<option value={attempt}>{attempt}</option>}{data.attempts.map(item=><option key={item.id} value={item.id}>{item.id} · {status(item.status)}</option>)}</Select></label>
      {data.attempts.map(item=><details key={item.id}><summary className="break-all">Attempt {item.id} · {status(item.status)}</summary><p>输入 {amount(item.input)} / 输出 {amount(item.output)} / 缓存读取 {amount(item.cacheRead)} tokens</p><p>延迟 {amount(item.elapsedMs)} ms · 首字节 {amount(item.firstByteMs)} ms · HTTP {item.httpStatus??'未知'}</p><Json value={item} /></details>)}
      {(attemptOffset>0||data.nextAttempt!==undefined)&&<div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" disabled={!attemptOffset} onClick={()=>setAttemptOffset(Math.max(0,attemptOffset-40))}>上一页 attempts</Button><Button size="sm" variant="outline" disabled={data.nextAttempt===undefined} onClick={()=>setAttemptOffset(data.nextAttempt!)}>下一页 attempts</Button></div>}
    </>}
    <label className="block">证据分组<Select aria-label="证据分组" className="w-full" value={group} onChange={event=>{setGroup(event.target.value);setEventOffset(0);}}><option value="">全部事件</option><option value="request">实际请求与转换</option><option value="response">原始响应与归一化结果</option><option value="sources">上下文及来源</option><option value="usage">用量、重试与终态</option></Select></label>
    <p className="text-xs text-muted">以下为持久事件的有界预览；请求、原始响应、归一化结果及工具证据分别保留。展开或读取附件不会重放调用。</p>
    <div className="space-y-3">{data.events.map(event=><EvidenceEvent key={event.eventId} sessionId={sessionId} event={event} />)}</div>
    <p>事件偏移 {eventOffset} / {data.eventTotal}</p><div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" disabled={!eventOffset} onClick={()=>setEventOffset(Math.max(0,eventOffset-40))}>上一页事件</Button><Button size="sm" variant="outline" disabled={data.nextEvent===undefined} onClick={()=>setEventOffset(data.nextEvent!)}>下一页事件</Button></div>
  </>}</section>;
}
export function Inspection({sessionId,initialRun=''}:{sessionId:string;initialRun?:string}){
  const [run,setRun]=useState(initialRun),[runBefore,setRunBefore]=useState(''),[node,setNode]=useState(''),client=useQueryClient();
  const query=useInspection(sessionId,{run,runBefore}),data=query.isError?undefined:query.data;
  return <div className="space-y-4 text-sm"><Button variant="outline" size="sm" onClick={()=>void client.invalidateQueries({queryKey:key(sessionId)})}>刷新只读证据</Button>{query.isPending&&<p role="status">读取运行记录…</p>}{query.isError&&<p role="alert">{query.error.message}</p>}{data&&<>
    <label className="block">运行<Select aria-label="检查运行" className="w-full" value={run} onChange={event=>{setRun(event.target.value);setNode('');}}><option value="">最新运行</option>{run&&!data.runs.some(item=>item.id===run)&&<option value={run}>{run}</option>}{data.runs.map(item=><option key={item.id} value={item.id}>#{item.seq} · {item.id}</option>)}</Select></label>
    <div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" disabled={!runBefore} onClick={()=>setRunBefore('')}>最新运行列表</Button><Button size="sm" variant="outline" disabled={data.nextRunBefore===undefined} onClick={()=>setRunBefore(String(data.nextRunBefore))}>更早运行列表</Button></div>
    <section aria-label="运行用量汇总" className="rounded-lg border border-line p-3"><h3>费用与用量</h3><p>{data.usage.attempts} 次模型尝试，仅逐 attempt 计入，父工具和脚本不再次累加。</p><p>已知输入 {amount(data.usage.input)} / 输出 {amount(data.usage.output)} / 缓存读取 {amount(data.usage.cacheRead)} tokens</p><p>缺少统计：输入 {data.usage.missingInput} 次、输出 {data.usage.missingOutput} 次、缓存 {data.usage.missingCache} 次。</p><p>费用未知 · {data.usage.unknownCostAttempts} 次尝试没有已验证价格；已知用量小计不代表完整总成本。</p></section>
    {data.runId?<div className="grid min-w-0 gap-4 min-[900px]:grid-cols-2"><section aria-label="嵌套调用"><h3>调用树</h3><p className="text-xs text-muted">父调用失败不代表子调用副作用已回滚。</p><TreePage key={data.runId} sessionId={sessionId} run={data.runId} select={setNode} /></section>{node?<NodeDetail key={`${data.runId}:${node}`} sessionId={sessionId} run={data.runId} node={node} select={setNode} />:<p>选择调用查看各 attempt 和原始证据。</p>}</div>:<p>尚无运行证据。</p>}
  </>}</div>;
}
