import { useMutation } from '@tanstack/react-query';
import { api } from '../../api';
import { Button } from '../../ui/Button';
import { ManagementConfirm } from './management-confirm';
interface Plan {
  name: string; appliesTo: string; contentHash: string; planHash: string;
  requiredCapabilities: string[]; settingsRevision: number; activeRevision: number; busy: boolean;
}
/** Installation is separate from transferring the handoff snapshot. */
export function ProjectDeliveryInstall({ sessionId, targetSessionId, handoffId, candidateId, contentHash }: {
  sessionId: string; targetSessionId: string; handoffId: string; candidateId: string; contentHash: string;
}) {
  const input = {sessionId,targetSessionId,handoffId,id:candidateId,contentHash};
  const preview = useMutation({mutationFn:()=>api<Plan>('/customization',{...input,action:'candidate-delivery-preview'})});
  const plan = preview.data;
  return <section aria-label="安装到工作项目" className="space-y-3 rounded-xl border border-line p-4">
    <h3 className="text-base font-semibold">安装到工作项目</h3>
    <p className="text-sm">交付卡只保存版本说明。此操作另行授权将该版本安装到原工作项目，不执行命令，也不更改工作草稿。</p>
    <Button variant="outline" busy={preview.isPending} onClick={()=>preview.mutate()}>审阅项目安装</Button>
    {preview.isError&&<p role="alert" className="break-words text-sm text-danger">无法审阅安装：{preview.error.message}</p>}
    {plan&&<>
      <p className="break-all text-sm">工作项目 {plan.appliesTo}</p><p className="break-all text-xs">版本 {plan.contentHash}</p>
      <p className="text-sm">请求权限：{plan.requiredCapabilities.join('、')||'无'}</p>
      {plan.busy&&<p role="status">工作项目正在运行，请空闲后重新审阅。</p>}
      <ManagementConfirm label="授权并安装到工作项目" sessionId={sessionId} disabled={plan.busy||preview.isPending||preview.isError}
        description="确认加载此项目版本及其声明能力。本地代码具有本机权限，失败不会自动重试；收到 unknown 时请先核对原命令记录。"
        review={()=>({request:{...input,action:'candidate-delivery-apply',planHash:plan.planHash,commandId:`delivery_${plan.planHash}`,authorize:true},
          detail:<><p>项目 {plan.appliesTo}</p><p>候选 {plan.name} · {plan.contentHash}</p><p>权限 {plan.requiredCapabilities.join('、')||'无'}</p><p>授权修订 {plan.settingsRevision} · 活动修订 {plan.activeRevision}</p></>})} />
    </>}
  </section>;
}
