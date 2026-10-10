import { rememberDeliveryPosition } from '../state/reading-position';
import { useDeliveries } from '../state/handoff';
import { HandoffRecovery } from './handoff-recovery';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import type { HandoffRelationsView, HandoffStatesView } from '../../../shared/handoff-view';
import type { DeliverySnapshot, SessionMode } from '../../../shared/protocol';
import { api } from '../../api';
import { Badge } from '../../ui/Badge';
import { Button } from '../../ui/Button';
import { v2Host, v2Key } from '../state/query';
import { DevOnly } from '../dev-only';
const phaseText: Record<string, string> = { 'awaiting-delivery': '待交付到工作目录', authorization: '待授权', unavailable: '不可用', available: '可用', 'awaiting-application': '待应用', applied: '已应用' };
const stages: Record<string, string> = { static: '静态校验', simulation: '模拟', preview: '预览', loaded: '加载', 'load-failed': '加载失败', host: '宿主验收' };
const statuses: Record<string, string> = { passed: '通过', failed: '失败', cancelled: '已取消', unknown: '结果未知' };
const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);
function SessionLink({ mode, id, children }: { mode: SessionMode; id: string; children: string }) {
  return mode === 'work' ? <Link className="text-sm underline" to="/work/session/$sessionId" params={{ sessionId: id }}>{children}</Link> : <Link className="text-sm underline" to="/create/session/$sessionId" params={{ sessionId: id }}>{children}</Link>;
}
export function DeliverySnapshotDetails({ snapshot }: { snapshot: DeliverySnapshot }) {
  return <section aria-label={`交付快照 ${snapshot.name}`} className="space-y-2">
    <h3 className="text-sm font-semibold">{snapshot.name} · {snapshot.scope === 'user' ? '用户范围' : '项目范围'}</h3>
    <p className="break-all text-xs">交付版本 {snapshot.revision}</p><Badge>{phaseText[snapshot.phase] ?? snapshot.phase}</Badge>
    <p className="whitespace-pre-wrap break-words text-sm">{snapshot.usage}</p>
    <p className="text-xs">使用入口：{snapshot.entries.length ? snapshot.entries.join('、') : '此快照没有可用入口'}</p>
    {!!snapshot.missing.length && <p className="text-xs">缺少权限：{snapshot.missing.join('、')}</p>}
    <details className="text-xs"><summary>交付时的验证证据（{snapshot.evidence.length}）</summary>
      {!snapshot.evidence.length && <p>没有匹配该版本的验证证据。</p>}
      {snapshot.evidence.map(item => <div key={item.eventId} className="my-2 break-all"><p>{item.origin === 'work' ? '工作宿主' : '开发目标'} · {stages[item.stage] ?? item.stage} · {statuses[item.status ?? ''] ?? (item.passed === true ? '通过' : item.passed === false ? '失败' : '已观察')}</p><p>{item.at} · {item.eventId}</p><p>宿主 {item.host} · 版本 {item.revision}</p></div>)}
    </details>
  </section>;
}
/** Read-only observations: mounting a card never confirms a handoff, applies a version or runs a factory. */
export function HandoffCards({ sessionId, mode }: { sessionId: string; mode: SessionMode }) {
  const relations = useQuery({ queryKey: v2Key(v2Host(), mode, 'handoff', sessionId, 'relations'), retry: false,
    queryFn: ({ signal }) => api<HandoffRelationsView>(`/sessions/${sessionId}/handoff-relations`, undefined, signal) });
  const deliveries = useDeliveries(sessionId, mode);
  const states = useQuery({ queryKey: v2Key(v2Host(), mode, 'handoff', sessionId, 'states'), retry: false,
    queryFn: ({ signal }) => api<HandoffStatesView>(`/sessions/${sessionId}/handoffs`, undefined, signal) });
  // 交接按需展示：没有记录且没有错误时不渲染任何区块（web-task-workbench 规格）。
  const empty = !relations.data?.items.length && !deliveries.data?.items.length && !states.data?.items.length;
  const failed = relations.isError || deliveries.isError || states.isError;
  if (empty && !failed) return null;
  const retry = () => { void relations.refetch(); void deliveries.refetch(); void states.refetch(); };
  return <section aria-label="交接与交付" className="my-4 space-y-3">
    <div className="flex flex-wrap items-center gap-2"><h2 className="text-sm font-semibold">交接与交付</h2>
      <DevOnly><Button size="sm" variant="outline" onClick={() => { void relations.refetch(); void deliveries.refetch(); }}>刷新交接记录</Button></DevOnly></div>
    {(relations.isPending || deliveries.isPending) && <p role="status">正在读取交接记录…</p>}
    {failed && <p role="alert" className="text-sm text-danger">交接记录暂时不可读：{errorText(relations.error ?? deliveries.error ?? states.error)}<Button size="sm" variant="outline" onClick={retry}>重试</Button></p>}
    {!!states.data?.items.length && <HandoffRecovery key={sessionId} sessionId={sessionId} mode={mode} states={states} />}
    {relations.data?.items.map(item => <article key={`${item.direction}:${item.handoffId}`} aria-label={`交接 ${item.handoffId}`} className="space-y-2 rounded-lg border border-line p-3">
      <p className="text-sm font-medium">{item.direction === 'incoming' ? '收到交接' : '已记录交接'}：{item.snapshot.goal}</p>
      <p className="break-all text-xs text-muted">交接 {item.handoffId} · 快照 {item.payloadHash}</p>
      {!item.targetSnapshotRetained && <Badge state="warning">目标接收尚未确认</Badge>}
      <div className="flex flex-wrap gap-3">{item.sourceAvailable ? <SessionLink mode={item.snapshot.source.mode} id={item.sourceSessionId}>查看来源会话</SessionLink> : <p className="text-sm text-warning">来源会话已删除或不可回溯；保留交接快照。</p>}{item.targetAvailable ? <SessionLink mode={item.snapshot.target.mode} id={item.targetSessionId}>查看目标会话</SessionLink> : <p className="text-sm text-warning">目标会话不存在或不可用。</p>}</div>
      {item.snapshot.summary && <p className="whitespace-pre-wrap break-words text-sm">{item.snapshot.summary}</p>}
      {!!item.snapshot.constraints.length && <ul className="list-disc pl-5 text-xs">{item.snapshot.constraints.map((constraint, index) => <li key={index}>{constraint}</li>)}</ul>}
      <details className="text-xs"><summary>选定引用（{item.snapshot.references.length}）与目标</summary><p className="break-all">{item.snapshot.target.target.root} · {item.snapshot.target.target.scope}</p>{item.snapshot.references.map(ref => <p className="break-all" key={`${ref.sessionId}:${ref.eventId}`}>{ref.sessionId} · {ref.type} · {ref.eventId}</p>)}</details>
      <p className="text-xs text-muted">接收记录不会启动任务、应用候选或授予权限。</p>
    </article>)}
    {deliveries.data?.items.map(item => <article key={item.handoffId} data-delivery-id={item.handoffId} aria-label={`交付 ${item.handoffId}`} className="space-y-3 rounded-lg border border-line p-3">
      <h2 className="text-sm font-semibold">交付卡</h2><p className="break-all text-xs">交接 {item.handoffId}</p>
      {!item.sourceAvailable && <p role="status" className="text-sm text-warning">来源不可回溯；历史交付快照仍保留。</p>}
      {!item.targetAvailable && <p role="status" className="text-sm text-warning">工作目标不可用，无法确认当前可用状态。</p>}
      {item.snapshot.map((snapshot, index) => { const current = item.current[index]; return <div key={`${snapshot.resourceId}:${index}`} className="space-y-2 border-t border-line pt-3">
        <DeliverySnapshotDetails snapshot={snapshot} />
        {item.sourceAvailable && snapshot.candidateId && <Link className="text-sm underline" to="/create/session/$sessionId/candidate/$candidateId" params={{ sessionId: item.sourceSessionId, candidateId: snapshot.candidateId }} search={{ deliverySession: item.targetSessionId, handoff: item.handoffId, revision: snapshot.revision }} onClick={event => rememberDeliveryPosition(item.targetSessionId, item.handoffId, event.currentTarget)}>查看交付版本候选</Link>}
        {current?.versionState === 'changed-or-missing' && <p role="status" className="text-sm text-warning">交付版本已变化或缺失，当前候选不能冒充原交付版本。</p>}
        {current?.error && <p className="break-words text-xs text-warning">{current.error}</p>}
        {current?.work && <section aria-label="当前工作状态" className="space-y-1 text-xs"><p>当前工作状态：{phaseText[current.work.phase] ?? current.work.phase}</p><p className="break-all">活动版本：{current.work.workActiveRevision ?? '无'}</p><p>入口：{current.work.entries.join('、') || '无'}</p>{!!current.work.missing.length && <p>待授权：{current.work.missing.join('、')}</p>}{!current.work.matchesDeliveredContent && <p>当前活动内容与交付内容不一致。</p>}{current.work.filesDifferFromActive && <p>工作文件与活动版本不一致。</p>}</section>}
      </div>; })}
      <p className="text-xs text-muted">收到交付不代表已应用。已被 {item.consumedBy.length} 次工作请求显式引用。</p>
    </article>)}
  </section>;
}
