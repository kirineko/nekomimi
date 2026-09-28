import { useEffect, useId, useRef, useState } from 'react';
import type { ContextOccupancy } from '../../shared/protocol';
const number = (n:number) => n >= 1_000_000 ? `${+(n/1_000_000).toFixed(1)}M` : n >= 1000 ? `${+(n/1000).toFixed(1)}K` : String(n);
export function ContextMeter({value,compacting=false}:{value?:ContextOccupancy;compacting?:boolean}) {
  const [open,setOpen]=useState(false), root=useRef<HTMLDivElement>(null),button=useRef<HTMLButtonElement>(null),id=useId();
  useEffect(()=>{if(!open)return;const outside=(e:PointerEvent)=>{if(!root.current?.contains(e.target as Node))setOpen(false);};document.addEventListener('pointerdown',outside);return()=>document.removeEventListener('pointerdown',outside);},[open]);
  const percent=value?.contextWindow?Math.round(value.totalTokens/value.contextWindow*100):undefined;
  const rows=value ? [['系统提示词',value.systemTokens],['工具定义',value.toolsTokens],['对话消息',value.messageTokens]] as const : [];
  return <div className="context-meter" ref={root} onBlur={e=>{if(!e.currentTarget.contains(e.relatedTarget as Node))setOpen(false);}} onKeyDown={e=>{if(e.key==='Escape'&&open){e.preventDefault();e.stopPropagation();setOpen(false);button.current?.focus();}}}>
    <button ref={button} className="context-trigger" type="button" aria-label="上下文占用明细" aria-expanded={open} aria-controls={open?id:undefined} onClick={()=>setOpen(!open)}>
      <svg aria-hidden="true" viewBox="0 0 24 24"><circle className="context-ring-track" cx="12" cy="12" r="9"/><circle className="context-ring" cx="12" cy="12" r="9" pathLength="100" strokeDasharray={`${Math.min(100,percent??0)} 100`}/></svg>
      <span>{compacting?'整理中…':percent===undefined?'上下文':`~${percent}%`}</span>
    </button>
    {open&&<section id={id} className="context-popover" aria-label="上下文占用">
      <div className="context-heading"><span>上下文已用 <strong>{percent===undefined?'—':`~${percent}%`}</strong></span><span className="context-total">{value?<><strong>~{number(value.totalTokens)}</strong><span> / {value.contextWindow?number(value.contextWindow):'容量未知'}</span></>:'等待首次请求'}</span></div>
      <div className="context-bar" aria-hidden="true">{rows.map(([name,n],i)=><span key={name} className={`context-part part-${i}`} style={{width:`${Math.min(100,n/(value?.contextWindow??value?.totalTokens??1)*100)}%`}}/>)}</div>
      <dl>{rows.map(([name,n],i)=><div key={name}><dt><i className={`context-part part-${i}`}/>{name}</dt><dd>~{number(n)}</dd></div>)}</dl>
    </section>}
    {compacting&&<span className="sr-only" role="status">正在整理上下文</span>}
  </div>;
}
