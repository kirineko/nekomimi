import {Badge} from '../../ui/Badge';
import {useCustomization} from '../state/create';
import {SlotArea} from './details';
import {DevEyebrow} from '../dev-only';
export function CreateDetails({ sessionId }: { sessionId?: string }) {
  const query = useCustomization(sessionId);
  const busy = query.data?.busy, degraded = query.data?.degraded;
  return (
    <aside aria-label="候选与验证" className="flex flex-col gap-3">
      <DevEyebrow>CANDIDATE</DevEyebrow>
      <h2 className="text-base">候选与验证</h2>
      <div className="rounded-xl border border-line bg-background p-4">
        <h3 className="text-sm">运行时状态</h3>
        <div className="mt-2 flex gap-2">
          {busy && <Badge state="warning">忙碌</Badge>}
          {query.isPending ? <Badge>读取中</Badge> : query.isError ? <Badge state="warning">状态待确认</Badge> : degraded ? <Badge state="danger">降级</Badge> : <Badge state="ok">目录已读取</Badge>}
        </div>
        {degraded && <p className="mt-2 text-xs text-danger">{degraded}</p>}
        <p className="mt-2 text-xs text-muted">
          差异与已有验证记录可直接查看；静态校验和可信代码预览须显式运行。不同阶段的结果分别记录。
        </p>
      </div>
      <SlotArea mode="create" sessionId={sessionId} />
    </aside>
  );
}
