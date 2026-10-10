import { Link } from '@tanstack/react-router';
import { ErrorState, EmptyState } from '../../ui/StateCard';
import { useCandidate } from '../state/create';
import { useDeliveries } from '../state/handoff';
import { CandidateContent } from './create';
import { DeliverySnapshotDetails } from './handoff-cards';
import { ProjectDeliveryInstall } from './project-delivery';
export interface DeliverySearch { deliverySession?: string; handoff?: string; revision?: string }
export function DeliveryCandidatePage({ sessionId, candidateId, selection }: { sessionId: string; candidateId: string; selection: DeliverySearch }) {
  const valid = !!selection.deliverySession && /^[a-zA-Z0-9_-]{1,80}$/.test(selection.deliverySession) && !!selection.handoff && /^[a-f0-9]{64}$/.test(selection.handoff) && !!selection.revision && /^[a-f0-9]{64}$/.test(selection.revision);
  const deliveries = useDeliveries(selection.deliverySession ?? '', 'work', valid);
  const candidate = useCandidate(candidateId, sessionId);
  const delivery = deliveries.data?.items.find(item => item.handoffId === selection.handoff && item.sourceSessionId === sessionId && item.targetSessionId === selection.deliverySession);
  const snapshot = delivery?.snapshot.find(item => item.candidateId === candidateId && item.revision === selection.revision);
  const back = valid && <Link className="text-sm underline" to="/work/session/$sessionId" params={{ sessionId: selection.deliverySession! }} search={{ delivery: selection.handoff }}>返回工作交付位置</Link>;
  if (!valid) return <ErrorState title="交付版本链接无效" detail="缺少完整的来源、交接或版本信息。" />;
  if (deliveries.isPending) return <EmptyState title="正在核对交付版本…" busy />;
  if (deliveries.isError || !snapshot) return <div className="p-4"><ErrorState title="此链接没有匹配的交付快照" detail={deliveries.error instanceof Error ? deliveries.error.message : '请从工作会话中的原交付卡重新进入。'} />{back}</div>;
  const matches = candidate.data?.contentHash === snapshot.revision;
  return <div className="flex h-full min-h-0 flex-col">
    <section aria-label="交付版本定位" className="max-h-[45%] shrink-0 space-y-2 overflow-auto border-b border-line p-4">
      {back}<h2 className="text-base font-semibold">正在检查交付时的版本</h2><DeliverySnapshotDetails snapshot={snapshot} />
      {candidate.isPending && <p role="status">正在核对开发目录内容…</p>}
      {candidate.isError && <p role="alert">开发候选不可读，保留以上交付快照。{candidate.error instanceof Error ? candidate.error.message : ''}</p>}
      {candidate.data && !matches && <><p role="alert">开发候选已变化；当前差异和验证不属于这份交付版本。</p><p className="break-all text-xs">当前版本 {candidate.data.contentHash}</p><Link className="text-sm underline" to="/create/session/$sessionId/candidate/$candidateId" params={{ sessionId, candidateId }} search={{}}>另行查看当前候选</Link></>}
      {matches && <p className="text-xs">开发内容与交付版本一致。下方显示该内容的当前检查记录，交付时证据保留于上方。</p>}
    </section>
    {matches && candidate.data && <div className="min-h-0 flex-1 overflow-auto">
      {snapshot.scope==='project'&&<ProjectDeliveryInstall key={`${sessionId}:${candidateId}:${snapshot.revision}:${selection.handoff}`} sessionId={sessionId} targetSessionId={selection.deliverySession!} handoffId={selection.handoff!} candidateId={candidateId} contentHash={snapshot.revision} />}
      <CandidateContent key={`${sessionId}:${candidateId}:${candidate.data.contentHash}:${candidate.data.host.build}`} candidate={candidate.data} sessionId={sessionId} />
    </div>}
  </div>;
}
