import { useExtensionDisplay } from "../state/extension-display";
import {SearchSources,SavedFetchSummary} from './search-sources';
import {RunRecovery} from './run-recovery';
import { LocateFile } from "../../workspace-context";
import { useContext, useEffect, useState } from 'react';
import type { TimelineRow } from '../../../shared/protocol';
import { toolContent } from '../../../presentation/content';
import { Markdown } from '../../components/Markdown';
import { DiffView } from '../../components/DiffView';
import { CustomPanel } from '../../components/CustomPanel';
import { Badge } from '../../ui/Badge';
import { Button } from '../../ui/Button';
import { statusText, toolTitle, failureText } from '../../presentation';
import { ArtifactReader } from './artifact-reader';
import { RuntimeSlot, PanelBoundary, useRuntimeUi } from '../slots';

function RecordedPanel({row,sessionId,mode,live,claimLivePanel}:{row:TimelineRow;sessionId:string;mode:'work'|'create';live:boolean;claimLivePanel?:(id:string)=>(()=>boolean)|undefined}) {
  const visible=useExtensionDisplay();
  const query=useRuntimeUi(mode,sessionId),[open,setOpen]=useState(false);
  const saved=row.details as {resourceId?:string;resourceRevision?:string;panelId?:string;props?:unknown;fallback?:string};
  const panel=query.data?.panels?.find(item=>item.resourceId===saved.resourceId && item.revision===saved.resourceRevision && item.id===saved.panelId && item.modes?.includes(mode));
  useEffect(()=>{if(!live)setOpen(false);},[live]);
  useEffect(()=>{if(!visible || (!query.isPending&&!panel))setOpen(false);},[visible,query.isPending,panel]);
  useEffect(()=>{
    if (!live) return;
    // Consume once even when hidden or unavailable. A fresh read avoids using
    // a catalog cached before this command activated its panel definition.
    const current = claimLivePanel?.(row.id);
    if (!current || !visible) return;
    let active = true;
    void query.refetch({cancelRefetch:false}).then(result => {
      const available = result.isSuccess && result.data?.panels?.some(item =>
        item.resourceId===saved.resourceId && item.revision===saved.resourceRevision && item.id===saved.panelId && item.modes?.includes(mode));
      if (active && current() && available) setOpen(true);
    });
    return () => { active = false; };
  },[live,visible,claimLivePanel,row.id,query.refetch,saved.resourceId,saved.resourceRevision,saved.panelId,mode]);
  return <div className="space-y-2">{(!open||!panel)&&<p className="whitespace-pre-wrap break-words text-sm">{row.text || saved.fallback}</p>}
    <Button size="sm" variant="outline" disabled={!panel||!visible} onClick={()=>setOpen(!open)}>{open?'关闭互动内容':'打开互动内容'}</Button>
    {!panel&&<p className="text-xs text-muted">此结果的原始面板版本不可用，保留已保存的文字与证据。</p>}
    {visible&&open&&panel&&<PanelBoundary fallback={saved.fallback ?? row.text}><CustomPanel panel={panel} propsJson={JSON.stringify(saved.props ?? {})} /></PanelBoundary>}
  </div>;
}

/** Historical rows render saved evidence only; fresh live panels may open once. */
export function SavedRow({row,sessionId,create,target:draftTarget='default',live=false,claimLivePanel}:{row:TimelineRow;sessionId:string;create:boolean;target?:string;live?:boolean;claimLivePanel?:(id:string)=>(()=>boolean)|undefined}) {
  const mode=create?'create':'work',tool=row.kind==='tool';
  const failed=['failed','incomplete','interrupted'].includes(row.status ?? '');
  const locate=useContext(LocateFile);
  const {input,result,target}=toolContent(row.text);
  const details=row.details as {kind?:string;patch?:{sha256?:string};path?:string}|undefined;
  const [expanded,setExpanded]=useState(false);
  const content=<article className={`min-w-0 py-3 ${row.kind==='user'?'my-1 rounded-lg bg-wash/70 px-3':'px-1'}`} data-row-kind={row.kind}>
    <div className="flex flex-wrap items-center gap-2">
      <span className={`text-xs font-semibold ${row.kind==='assistant'?'text-brand':'text-muted'}`}>{row.kind==='user'?'你':row.kind==='assistant'?'Nekomimi':tool?toolTitle(row.title):row.title || row.kind}</span>
      {row.status&&<Badge state={['failed','unknown','interrupted'].includes(row.status)?'warning':undefined}>{statusText(row.status)}</Badge>}
    </div>
    {row.kind==='status'&&failed?<div role="status" className="space-y-2"><p className="whitespace-pre-wrap break-words text-sm">{failureText(row.text)}</p><RunRecovery sessionId={sessionId} mode={mode} target={draftTarget} /></div>:details?.kind==='panel'?<RecordedPanel row={row} sessionId={sessionId} mode={mode} live={live} claimLivePanel={claimLivePanel} />:tool?<>
      {target&&<p className="break-all text-xs text-muted">{target}</p>}
      {row.status==='failed'&&<p role="alert" className="whitespace-pre-wrap break-words text-sm text-danger">{result || row.text}</p>}
      <details onToggle={event=>setExpanded(event.currentTarget.open)}><summary className="cursor-pointer text-sm">查看工具详情</summary>
        <p className="text-xs font-semibold">输入</p><pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all text-xs">{input}</pre>
        {result&&<><p className="text-xs font-semibold">结果</p><pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all text-xs">{result}</pre></>}
        {expanded&&row.refs.map((ref,index)=><ArtifactReader key={`${ref.sha256}:${index}`} sessionId={sessionId} hash={ref.sha256} label={`完整工具附件 ${index+1}`} />)}
      </details>
      {row.title==='web_search'&&<SearchSources details={row.details} />}
      {row.title==='web_fetch'&&<SavedFetchSummary details={row.details} />}
      {details?.patch?.sha256&&row.status==='completed'&&<DiffView sessionId={sessionId} digest={details.patch.sha256} path={details.path} locate={locate} embedded />}
      {!details?.patch&&['write','edit'].includes(row.title)&&row.status==='completed'&&<p className="text-xs text-muted">历史 diff 证据不可用，可通过调用证据查看记录。</p>}
    </>:row.kind==='assistant'?<div data-rich-content className="min-w-0 break-words text-sm"><Markdown text={row.text} /></div>:<p className="whitespace-pre-wrap break-words text-sm">{row.kind==='call'&&failed?failureText(row.text):row.text}</p>}
    {!tool&&row.refs.length>0&&<details><summary className="cursor-pointer text-xs">已保存附件（{row.refs.length}）</summary>{row.refs.map((ref,index)=><ArtifactReader key={`${ref.sha256}:${index}`} sessionId={sessionId} hash={ref.sha256} label={`原始附件 ${index+1}`} />)}</details>}
  </article>;
  if(!['user','assistant','tool'].includes(row.kind))return content;
  return <RuntimeSlot slot={tool?'tool-result':'message-content'} mode={mode} sessionId={sessionId} role={row.kind} tool={tool?row.title:undefined} props={{text:row.text,role:row.kind,tool:row.title}}>{content}</RuntimeSlot>;
}
