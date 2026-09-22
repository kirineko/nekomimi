import { memo, useMemo, useState } from "react";
import { CustomPanel, type PanelView } from "./CustomPanel";
import { Brand } from "./Brand";
import type { TimelineRow } from "../../shared/protocol";
import { Markdown } from "./Markdown";
import { ToolCard } from "./ToolCard";
import { statusText } from "../presentation";
import { conversationTurns, type ConversationTurn } from "../turns";
export { statusText } from "../presentation";
const Message = memo(function Message({row}: {row: TimelineRow}) {
  const [showPanel,setShowPanel]=useState(false);
  const contribution=row.details as {kind?:string;resourceId?:string;resourceRevision?:string;panelId?:string;fallback?:string;bundleHash?:string;props?:unknown;slot?:'sidebar'|'result';themes?:Record<string,unknown>}|undefined;
  const panel:PanelView|undefined=contribution?.kind==='panel' && contribution.resourceId && contribution.resourceRevision && contribution.panelId ? {id:contribution.panelId,resourceId:contribution.resourceId,revision:contribution.resourceRevision,fallback:contribution.fallback ?? row.text,bundleHash:contribution.bundleHash ?? '',slot:contribution.slot ?? 'result',themes:contribution.themes} : undefined;
  return <article className={`row row-${row.kind}`}>
    <div className="row-head"><strong>{row.kind === "user" ? "你" : row.kind === "assistant" ? <Brand compact /> : row.title !== "任务结束" ? row.title : statusText(row.status)}</strong></div>
    {panel&&<><p>{panel.fallback}</p>{showPanel?<CustomPanel panel={panel} propsJson={JSON.stringify(contribution?.props ?? {})}/>:<button onClick={()=>setShowPanel(true)}>打开已授权结果面板</button>}</>}
    {row.text && (row.kind === "assistant" ? <Markdown text={row.text}/> : <div className="row-text">{row.text}</div>)}
  </article>;
});
const Turn = memo(function Turn({turn, sessionId, inspect}: {turn: ConversationTurn; sessionId: string; inspect: (row: TimelineRow)=>void}) {
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
      if(row.kind === "call") return row.status && !["completed","running"].includes(row.status) ? <p className="error" key={row.id}>{statusText(row.status)}：{row.text}</p> : null;
      if(row.kind === "status" && row.status === "completed" && !row.text && primary) return null;
      return row.kind === "tool" ? <ToolCard key={row.id} row={row} sessionId={sessionId}/> : <Message key={row.id} row={row}/>;
    })}
  </section>;
});
export function Timeline({sessionId,rows,inspect,older,latest,hasOlder}: {sessionId:string;rows:TimelineRow[];inspect:(row:TimelineRow)=>void;older:()=>void;latest:()=>void;hasOlder:boolean}) {
  const sidebar=useMemo(()=>rows.filter(row=>(row.details as any)?.kind==='panel'&&(row.details as any)?.slot==='sidebar'),[rows]);
  const turns=useMemo(()=>conversationTurns(rows.filter(row=>!sidebar.includes(row))),[rows,sidebar]);
  return <div className="timeline" aria-label="任务时间线">
    {hasOlder && <div className="history-actions"><button onClick={older}>加载更早记录</button><button onClick={latest}>回到最新记录</button></div>}
    <div className={sidebar.length?"timeline-panels":undefined}><div>{turns.map(turn=><Turn key={turn.id} turn={turn} sessionId={sessionId} inspect={inspect}/>)}</div>{!!sidebar.length&&<aside aria-label="扩展侧栏">{sidebar.map(row=><Message key={row.id} row={row}/>)}</aside>}</div>
  </div>;
}
