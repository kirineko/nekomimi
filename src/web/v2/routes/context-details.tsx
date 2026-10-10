import { Link } from '@tanstack/react-router';
import type { HandoffRelationsView } from '../../../shared/handoff-view';
import { useState } from 'react';
import { useQuery,useQueryClient } from '@tanstack/react-query';
import type { ContextDetailsView } from '../../../shared/context-details';
import type { ContextOccupancy } from '../../../shared/protocol';
import { api } from '../../api';
import { Button } from '../../ui/Button';
import { Select } from '../../ui/Input';
import { ArtifactReader } from './artifact-reader';
import { useDeveloperView } from '../state/developer-view';

const count = (value: number | undefined) => value === undefined ? '未知' : value.toLocaleString();
function Json({ value }: { value: unknown }) {
  return <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all text-xs">{JSON.stringify(value, null, 2)}</pre>;
}
function PagedFacts({ items }: { items: unknown[] }) {
  const [page, setPage] = useState(0);
  return <div><Json value={items.slice(page * 20, (page + 1) * 20)} />{items.length > 20 && <div className="flex flex-wrap items-center gap-2"><Button size="sm" variant="outline" disabled={page === 0} onClick={() => setPage(page - 1)}>上一页来源</Button><span>{page * 20 + 1}–{Math.min(items.length, (page + 1) * 20)} / {items.length}</span><Button size="sm" variant="outline" disabled={(page + 1) * 20 >= items.length} onClick={() => setPage(page + 1)}>下一页来源</Button></div>}</div>;
}
function Measurement({ value }: { value: ContextOccupancy }) {
  const { enabled: developer } = useDeveloperView();
  const percent = value.contextWindow ? Math.round(value.totalTokens / value.contextWindow * 100) : undefined;
  return <section aria-label="当前上下文统计" className="space-y-3">
    <h3 className="font-semibold">当前占用</h3>
    <p>{value.method === 'calibrated' ? '校准估算' : '估算'} {count(value.totalTokens)} tokens · {percent === undefined ? '容量未知' : `${percent}% / ${count(value.contextWindow)} tokens`}</p>
    <p className="text-xs text-muted">这是下一请求的上下文投影，不是累计计费用量。历史请求的实测值不代表当前输入。</p>
    <dl className="grid grid-cols-2 gap-2 text-sm"><dt>模型</dt><dd className="break-all">{value.model}</dd><dt>系统提示 / 工具 / 对话</dt><dd>{count(value.systemTokens)} / {count(value.toolsTokens)} / {count(value.messageTokens)}</dd></dl>
    {value.imageEstimate && <p className="text-sm">包含图片估算。</p>}
    <details open={developer}>
      <summary className="text-sm">技术详情</summary>
      <dl className="grid grid-cols-2 gap-2 py-2 text-sm"><dt>模式 / 目标</dt><dd className="break-all">{value.mode ?? '未绑定'} / {value.targetId?.slice(0, 12) ?? '—'}</dd><dt>Provider</dt><dd className="break-all">{value.provider}</dd><dt>系统 / 工具 / 消息</dt><dd>{count(value.systemTokens)} / {count(value.toolsTokens)} / {count(value.messageTokens)}</dd><dt>匹配请求样本</dt><dd>{count(value.sampledInputTokens)} tokens</dd><dt>预算策略</dt><dd>{value.policyVersion ?? '未记录'}</dd><dt>输出 / 安全 / 工具结果预留</dt><dd>{count(value.reservations?.output)} / {count(value.reservations?.safety)} / {count(value.reservations?.toolResults)}</dd><dt>可用输入 / 压力阈值</dt><dd>{count(value.reservations?.availableInput)} / {count(value.reservations?.pressureThreshold)}</dd></dl>
      <details><summary>当前上下文与能力版本</summary><Json value={{ mode: value.mode, targetId: value.targetId, revision: value.revision, capabilityRevision: value.capabilityRevision, anchor: value.anchor, purpose: value.purpose }} /></details>
      {value.layers?.map(layer => <details key={layer.id}><summary>{layer.id} · {count(layer.tokens)} tokens</summary><p>原始估算 {count(layer.estimatedTokens)}，校准调整 {count(layer.adjustmentTokens)}</p><PagedFacts key={`${value.revision}:${layer.id}`} items={layer.sources} /></details>)}
      <details><summary>当前排除来源（{value.exclusions?.length ?? 0}）</summary><PagedFacts key={value.revision} items={value.exclusions ?? []} /></details>
    </details>
  </section>;
}
function Checkpoint({ sessionId, initial }: { sessionId: string; initial: ContextDetailsView['compactions'][number] }) {
  const [offset, setOffset] = useState(0);
  const query = useQuery({ queryKey: ['v2', location.host, sessionId, 'context-checkpoint', initial.eventId, offset], enabled: offset > 0,
    queryFn: ({ signal }) => api<ContextDetailsView>(`/sessions/${sessionId}/context-details?checkpoint=${encodeURIComponent(initial.eventId)}&referenceOffset=${offset}`, undefined, signal), retry: false });
  const value = offset ? query.data?.compactions[0] : initial;
  return <details><summary>#{initial.seq} · {({ completed: '已提交', failed: '失败，未应用', cancelled: '取消，未应用', started: '开始记录' } as Record<string,string>)[initial.status] ?? initial.status}</summary>
    <div className="space-y-2 py-2"><p>占用：{count(initial.before)} → {count(initial.after)} tokens</p><Json value={{ eventId: initial.eventId, sourceRevision: initial.sourceRevision, source: initial.source, previous: initial.previous, retention: initial.retention, retainedFrom: initial.retainedFrom, attempts: initial.attemptIds, summaryHash: initial.summaryHash }} />
      {initial.summary && <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all text-xs">{initial.summary}</pre>}{initial.summaryTruncated && <p>摘要预览已截断，完整内容可继续读取。</p>}{initial.error && <p className="break-all">{initial.error}</p>}
      {initial.artifact && <ArtifactReader sessionId={sessionId} hash={initial.artifact.sha256} label="完整摘要附件" />}
      <p>原始节点引用 {initial.referenceCount} · 偏移 {offset}</p>{query.isError && <p role="alert">{query.error.message}</p>}{offset > 0 && query.isPending && <p role="status">读取来源…</p>}{value && <Json value={value.references} />}
      <div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" disabled={!offset} onClick={() => setOffset(Math.max(0, offset - 40))}>上一页压缩来源</Button><Button size="sm" variant="outline" disabled={value?.nextReference === undefined} onClick={() => setOffset(value!.nextReference!)}>下一页压缩来源</Button></div>
    </div>
  </details>;
}
function HandoffSources({sessionId,items}:{sessionId:string;items:NonNullable<ContextDetailsView['snapshot']>['handoffs']}){
  const query=useQuery({queryKey:['v2',location.host,sessionId,'inspection-handoff-sources'],enabled:items.length>0,retry:false,staleTime:0,refetchOnMount:'always',refetchInterval:5000,queryFn:({signal})=>api<HandoffRelationsView>(`/sessions/${sessionId}/handoff-relations`,undefined,signal)});
  return <section aria-label="此请求的交接来源" className="space-y-3">{query.isError&&<p role="alert">当前来源状态不可读：{query.error.message}</p>}{items.map(item=>{
    const current=query.data?.items.find(value=>value.handoffId===item.handoffId&&value.payloadHash===item.payloadHash);
    return <details key={item.handoffId}><summary className="break-all">交接 {item.handoffId.slice(0,12)} · {item.decision==='include'?'选入':'排除'} · {item.reason}</summary><Json value={item} />
      <p className="text-xs">上方为请求捕获的来源状态；以下检查当前是否仍可回溯。</p>{query.isFetching?<p role="status">检查当前来源…</p>:query.isError?<p>当前来源状态待确认。</p>:!current?<p>未找到匹配的当前交接记录，历史选择仍保留。</p>:!current.sourceAvailable?<p role="status">来源会话已删除或不可回溯，不能伪造原始来源。</p>:<div className="space-y-2">
        {current.snapshot.source.mode==='work'?<Link className="block underline" to="/work/session/$sessionId" params={{sessionId:current.sourceSessionId}}>查看交接来源会话</Link>:<Link className="block underline" to="/create/session/$sessionId" params={{sessionId:current.sourceSessionId}}>查看交接来源会话</Link>}
        {current.snapshot.delivery?.map(value=>value.candidateId&&<Link key={value.candidateId} className="block underline" to="/create/session/$sessionId/candidate/$candidateId" params={{sessionId:current.sourceSessionId,candidateId:value.candidateId}} search={{deliverySession:current.targetSessionId,handoff:item.handoffId,revision:value.revision}}>查看交付版本 {value.name}</Link>)}
      </div>}
    </details>;
  })}</section>;
}
export function ContextDetails({ sessionId,initialSnapshot }: { sessionId: string;initialSnapshot?:string }) {
  const [selection, setSelection] = useState({ snapshot: initialSnapshot??'', offset: 0, decision: '', snapshotBefore: '',handoffOffset:'' });
  const [before, setBefore] = useState(''),client=useQueryClient();
  const params = new URLSearchParams(Object.entries({ ...selection, offset: String(selection.offset), compactionBefore: before }).filter(([, value]) => value !== ''));
  const query = useQuery({ queryKey: ['v2', location.host, sessionId, 'context-details', params.toString()],
    queryFn: ({ signal }) => api<ContextDetailsView>(`/sessions/${sessionId}/context-details?${params}`, undefined, signal), retry: false, refetchInterval: 5000 });
  const data = query.isError ? undefined : query.data, snapshot = data?.snapshot;
  return <div className="space-y-5 text-sm">
    <Button variant="outline" size="sm" disabled={query.isFetching} onClick={() => {void query.refetch();void client.invalidateQueries({queryKey:['v2',location.host,sessionId,'inspection-handoff-sources']});}}>刷新只读详情</Button>
    {query.isPending && <p role="status">读取上下文详情…</p>}{query.isError && <p role="alert">上下文详情不可读：{query.error.message}</p>}
    {data && <><details><summary>会话与目标身份 · {data.mode}</summary><Json value={{ sessionId: data.sessionId, mode: data.mode, targetId: data.targetId }} /></details>{data.compacting && <p role="status">正在整理上下文，检查点提交前保留当前投影。</p>}
      {data.measurement ? <Measurement value={data.measurement} /> : <p>{data.unavailableReason}</p>}
      <section aria-label="历史请求选择" className="space-y-3 border-t border-line pt-3"><h3 className="font-semibold">历史请求选择快照</h3><p className="text-xs text-muted">这里记录当次请求实际选入及排除的版本，不代表当前资源授权。</p>
        <label className="block">请求快照<Select className="w-full" value={selection.snapshot} onChange={event => setSelection({ ...selection, snapshot: event.target.value, offset: 0,handoffOffset:'' })}><option value="">最新请求</option>{selection.snapshot && !data.snapshots.some(item => item.eventId === selection.snapshot) && <option value={selection.snapshot}>{selection.snapshot}</option>}{data.snapshots.map(item => <option key={item.eventId} value={item.eventId}>#{item.seq} · {item.purpose} · {item.eventId}</option>)}</Select></label>
        <div className="flex flex-wrap gap-2"><Button variant="outline" size="sm" disabled={!selection.snapshotBefore} onClick={() => setSelection({ ...selection, snapshotBefore: '' })}>最新快照列表</Button><Button variant="outline" size="sm" disabled={data.nextSnapshotBefore === undefined} onClick={() => setSelection({ ...selection, snapshotBefore: String(data.nextSnapshotBefore) })}>更早快照列表</Button></div>
        {snapshot ? <><p>选入 {snapshot.included} · 排除 {snapshot.excluded} · {snapshot.model.id}</p><details><summary>请求身份与版本</summary><Json value={{ ...snapshot, selection: undefined }} /></details>
          <label className="block">选择结果<Select value={selection.decision} className="w-full" onChange={event => setSelection({ ...selection, snapshot: snapshot.eventId, offset: 0, decision: event.target.value })}><option value="">全部</option><option value="include">选入</option><option value="exclude">排除</option></Select></label>
          <div aria-label="请求选择清单" className="space-y-2">{snapshot.selection.map(item => <details key={item.id}><summary className="break-all">{item.decision === 'include' ? '选入' : '排除'} · {item.source} · {item.reason}</summary><Json value={item} />{item.projection && <><ArtifactReader sessionId={sessionId} hash={item.projection.full.sha256} label="原始结果" /><ArtifactReader sessionId={sessionId} hash={item.projection.projected.sha256} label="模型投影" /></>}</details>)}</div>
          <p>选择清单偏移 {selection.offset} / {snapshot.total}</p><div className="flex flex-wrap gap-2"><Button variant="outline" size="sm" disabled={!selection.offset} onClick={() => setSelection({ ...selection, snapshot: snapshot.eventId, offset: Math.max(0, selection.offset - 40) })}>上一页选择</Button><Button variant="outline" size="sm" disabled={snapshot.next === undefined} onClick={() => setSelection({ ...selection, snapshot: snapshot.eventId, offset: snapshot.next! })}>下一页选择</Button></div><ArtifactReader sessionId={sessionId} hash={snapshot.artifact.sha256} label="完整请求快照" />
          <HandoffSources sessionId={sessionId} items={snapshot.handoffs??[]} />{(selection.handoffOffset||snapshot.nextHandoff!==undefined)&&<div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" disabled={!Number(selection.handoffOffset)} onClick={()=>setSelection({...selection,snapshot:snapshot.eventId,handoffOffset:String(Math.max(0,Number(selection.handoffOffset)-40))})}>上一页交接来源</Button><Button size="sm" variant="outline" disabled={snapshot.nextHandoff===undefined} onClick={()=>setSelection({...selection,snapshot:snapshot.eventId,handoffOffset:String(snapshot.nextHandoff)})}>下一页交接来源</Button></div>}
        </> : <p>尚无历史请求快照。</p>}
      </section>
      <section aria-label="压缩来源" className="space-y-3 border-t border-line pt-3"><h3 className="font-semibold">压缩记录与来源</h3><p className="text-xs text-muted">只有已提交检查点改变后续投影；开始、失败或取消记录不表示摘要已生效。</p>{!data.compactions.length && <p>尚无压缩记录。</p>}{data.compactions.map(value => <Checkpoint key={value.eventId} sessionId={sessionId} initial={value} />)}<div className="flex flex-wrap gap-2"><Button variant="outline" size="sm" disabled={!before} onClick={() => setBefore('')}>最新压缩记录</Button><Button variant="outline" size="sm" disabled={data.nextCompactionBefore === undefined} onClick={() => setBefore(String(data.nextCompactionBefore))}>更早压缩记录</Button></div></section>
    </>}
  </div>;
}
