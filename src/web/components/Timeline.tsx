import {RuntimeViews} from "./RuntimeViews";
import { createContext, useContext, memo, useMemo, useState } from "react";
import { CustomPanel, type PanelView } from "./CustomPanel";
import { Brand } from "./Brand";
import type { TimelineRow } from "../../shared/protocol";
import { Markdown } from "./Markdown";
import { ToolCard } from "./ToolCard";
import { statusText } from "../presentation";
import { conversationTurns, type ConversationTurn } from "../turns";
export { statusText } from "../presentation";
const ContinueTask=createContext<(()=>void)|undefined>(undefined);
function failureText(text:string){
 if(/Response incomplete/i.test(text))return '本次回复未完整生成。可以继续任务；具体原因可在调用详情中查看。';
 if(/Run turn limit exceeded/i.test(text))return '已达到本次任务的调用轮数上限，请分步骤继续任务。';
 if(/timed out/i.test(text))return '模型响应超时，请检查连接后继续任务。';
 return text||'本次任务未完成，可以检查调用详情后继续。';
}
const LiveRows=createContext<Set<string>>(new Set());
const Message = memo(function Message({row}: {row: TimelineRow}) {
  const live=useContext(LiveRows);
  const [showPanel,setShowPanel]=useState(false);
  const contribution=row.details as {kind?:string;resourceId?:string;resourceRevision?:string;panelId?:string;fallback?:string;bundleHash?:string;props?:unknown;slot?:'sidebar'|'result';themes?:Record<string,unknown>}|undefined;
  const panel:PanelView|undefined=contribution?.kind==='panel' && contribution.resourceId && contribution.resourceRevision && contribution.panelId ? {id:contribution.panelId,title:row.title,resourceId:contribution.resourceId,revision:contribution.resourceRevision,fallback:contribution.fallback ?? row.text,bundleHash:contribution.bundleHash ?? '',slot:contribution.slot ?? 'result',themes:contribution.themes} : undefined;
  return <RuntimeViews slot="message-content" role={row.kind} props={{text:row.text,role:row.kind}}><article data-row-id={row.id} className={`row row-${panel?'panel':row.kind}`}>
    {(!panel||(!showPanel&&!live.has(row.id)))&&<div className="row-head"><strong>{row.kind === "user" ? "你" : row.kind === "assistant" ? <Brand compact /> : row.title !== "任务结束" ? row.title : statusText(row.status)}</strong></div>}
    {panel&&<>{(showPanel||live.has(row.id))?<CustomPanel panel={panel} propsJson={JSON.stringify(contribution?.props ?? {})}/>:<><p className="panel-fallback">{row.text}</p><button onClick={()=>setShowPanel(true)}>打开互动内容</button></>}</>}
    {!panel&&row.text && (row.kind === "assistant" ? <Markdown text={row.text}/> : <div className="row-text">{row.text}</div>)}
  </article></RuntimeViews>;
});
const Turn = memo(function Turn({turn, sessionId, inspect}: {turn: ConversationTurn; sessionId: string; inspect: (row: TimelineRow)=>void}) {
  const continueTask=useContext(ContinueTask);
  const calls = turn.rows.filter(r=>r.kind === "call");
  const primary = calls.find(r=>r.title !== "会话命名") ?? calls[0];
  const tools = turn.rows.filter(r=>r.kind === "tool");
  const terminal = [...turn.rows].reverse().find(r=>r.kind === "status");
  const active = [...calls].reverse().find(r=>r.title !== "会话命名" && r.status === "running");
  const status = active?.status ?? terminal?.status ?? [...calls].reverse().find(r=>r.title !== "会话命名")?.status ?? primary?.status;
  return <section className="conversation-turn" aria-label="任务轮次">
    {turn.rows.filter(r=>r.kind === "user").map(row=><Message key={row.id} row={row}/>)}
    {primary && <div className="row turn-summary">
      <button className="trace-step" aria-label="检查调用" onClick={()=>inspect(primary)}>
        <span className={`step-dot ${status}`}/><span>{tools.length ? `${tools.length} 项操作` : primary.title === "会话命名" ? "会话记录" : "执行过程"}</span>
        <span className="trace-meta">{statusText(status)}</span><span aria-hidden="true">↗</span>
      </button>
      {calls.length > 1 && <details className="turn-calls"><summary>全部调用 · {calls.length}</summary>{calls.map(row=><button key={row.id} onClick={()=>inspect(row)}>{row.title} · {statusText(row.status)}</button>)}</details>}
    </div>}
    {turn.rows.filter(r=>r.kind !== "user").map(row=> {
      if(row.kind === "call") return !terminal&&row===calls.at(-1)&&row.status&&!['completed','running'].includes(row.status)?<p className="error" key={row.id}>{failureText(row.text)}</p>:null;
      if(row===terminal&&row.status&&['failed','incomplete','interrupted'].includes(row.status))return <div className="run-recovery" role="status" key={row.id}><div><strong>{statusText(row.status)}</strong><p>{failureText(row.text)}</p></div>{continueTask&&<button onClick={continueTask}>继续任务</button>}</div>;
      if(row.kind === "status" && row.status === "completed" && !row.text && (primary || row.title === "命令结果")) return null;
      return row.kind === "tool" ? <RuntimeViews key={row.id} slot="tool-result" tool={row.title} props={{tool:row.title,text:row.text}}><ToolCard row={row} sessionId={sessionId}/></RuntimeViews> : <Message key={row.id} row={row}/>;
    })}
  </section>;
});
export function Timeline({sessionId,rows,inspect,older,hasOlder,newer,hasNewer,paging,navigationError,liveRows=new Set(),onContinue}: {onContinue?:()=>void;liveRows?:Set<string>;sessionId:string;rows:TimelineRow[];inspect:(row:TimelineRow)=>void;older:()=>void;hasOlder:boolean;newer?:()=>void;hasNewer?:boolean;paging?:boolean;navigationError?:{direction:string;message:string}}) {
  const sidebar=useMemo(()=>rows.filter(row=>(row.details as any)?.kind==='panel'&&(row.details as any)?.slot==='sidebar'),[rows]);
  const turns=useMemo(()=>conversationTurns(rows.filter(row=>!sidebar.includes(row))),[rows,sidebar]);
  return <ContinueTask.Provider value={onContinue}><LiveRows.Provider value={liveRows}><div className="timeline" aria-label="任务时间线">
    {hasOlder&&<div className="history-actions"><button disabled={paging} onClick={older}>{navigationError?.direction==='older'?'重试查看更早':'查看更早'}</button>{navigationError?.direction==='older'&&<span role="alert">{navigationError.message}</span>}</div>}
    <div className={sidebar.length?"timeline-panels":undefined}><div>{turns.map(turn=><Turn key={turn.id} turn={turn} sessionId={sessionId} inspect={inspect}/>)}</div>{!!sidebar.length&&<aside aria-label="扩展侧栏">{sidebar.map(row=><Message key={row.id} row={row}/>)}</aside>}</div>
    {hasNewer&&<div className="history-actions"><button disabled={paging} onClick={newer}>{navigationError?.direction==='newer'?'重试查看较新':'查看较新'}</button>{navigationError?.direction==='newer'&&<span role="alert">{navigationError.message}</span>}</div>}
  </div></LiveRows.Provider></ContinueTask.Provider>;
}
