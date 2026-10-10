import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import type { CoreOperation, CoreBuildReview } from '../../../shared/core-operation';
import type { CoreCandidateView } from '../../../shared/core-candidate-view';
import { validId } from '../../../shared/protocol';
import { api } from '../../api';
import { Select } from '../../ui/Input';
import { Button } from '../../ui/Button';
import { ErrorState } from '../../ui/StateCard';
import { createKey } from '../state/create';

export function useCoreOperations(sessionId: string) {
  return useQuery<CoreOperation[]>({ queryKey: createKey(sessionId, 'core-operations'), enabled: validId(sessionId), retry: false,
    queryFn: ({ signal }) => api(`/sessions/${encodeURIComponent(sessionId)}/core-operations`, undefined, signal),
    refetchInterval: query => query.state.data?.some(task => ['running', 'cancelling'].includes(task.status)) ? 750 : false });
}
const statuses = { running: '运行中', cancelling: '取消待确认', passed: '通过', failed: '失败', cancelled: '已取消', unknown: '结果未知' };
export function CoreOperationList({ sessionId }: { sessionId: string }) {
  const query = useCoreOperations(sessionId), client = useQueryClient();
  const cancel = useMutation({ mutationFn: (commandId: string) => api('/customization', { action: 'candidate-core-cancel', sessionId, commandId }), onSettled: () => client.invalidateQueries({ queryKey: createKey(sessionId) }) });
  return <section aria-label="后台核心任务" className="space-y-3">
    {query.isPending && <p role="status">读取后台核心任务…</p>}{query.isError && <ErrorState title="核心任务状态不可读" detail={String(query.error)} />}
    {cancel.isError && <p role="alert" className="text-danger">{String(cancel.error)}</p>}
    {query.data?.map(task => <article key={task.commandId} aria-label={`核心操作 ${task.commandId}`} className="space-y-2 rounded-lg border border-line p-3">
      <h3 className="text-sm font-semibold">{task.kind === 'build' ? '后台构建' : '后台独立验证'} · {statuses[task.status]}</h3><p className="break-all text-xs text-muted">命令 {task.commandId} · {task.startedAt}</p><p className="break-all text-xs text-muted">范围 {task.target}</p>
      {task.resultId && <p className="break-all text-xs">执行记录 {task.resultId}</p>}
      {task.cancelRequested && <p className="text-xs">已记录取消请求；实际结果以终态为准。</p>}
      {task.status === 'unknown' && <p className="text-sm text-warning">执行结果或清理无法确认，不会自动重跑；请查看下方执行记录。</p>}
      {task.error && <p className="break-words text-sm text-warning">{task.error}</p>}
      {['running', 'cancelling'].includes(task.status) && <Button variant="outline" disabled={task.cancelRequested} busy={cancel.isPending} onClick={() => cancel.mutate(task.commandId)}>请求停止核心任务</Button>}
    </article>)}
  </section>;
}
export function CoreActions({ sessionId, candidate }: { sessionId: string; candidate: CoreCandidateView }) {
  const client = useQueryClient(), operations = useCoreOperations(sessionId), [buildConsent, setBuildConsent] = useState(false), [validationConsent, setValidationConsent] = useState(false), [buildId, setBuildId] = useState('');
  const command = useRef<{ fingerprint: string; id: string } | undefined>(undefined);
  const refresh = () => client.invalidateQueries({ queryKey: createKey(sessionId) });
  const review = useMutation({ mutationFn: () => api<CoreBuildReview>('/customization', { action: 'candidate-core-plan', sessionId }) });
  const start = useMutation({ mutationFn: (value: Record<string, unknown>) => {
    const fingerprint = JSON.stringify(value);
    if (command.current?.fingerprint !== fingerprint) command.current = { fingerprint, id: crypto.randomUUID() };
    return api<CoreOperation>('/customization', { ...value, sessionId, commandId: command.current.id, authorize: true });
  }, onSuccess: () => { command.current = undefined; setBuildConsent(false); setValidationConsent(false); }, onSettled: refresh });
  const busy = operations.isPending || operations.isError || operations.data?.some(task => ['running', 'cancelling'].includes(task.status)) || start.isPending;
  const passedBuilds = candidate.tasks.filter(task => task.kind === 'build' && task.status === 'passed' && task.artifactRevision && task.sourceRevision === candidate.currentRevision);
  const selected = passedBuilds.find(task => task.buildId === buildId);
  const plan = review.data, currentPlan = plan?.candidateId === candidate.id && plan.sourceRevision === candidate.currentRevision;
  return <section aria-label="核心执行确认" className="space-y-4 rounded-lg border border-line p-4">
    <h2 className="text-base font-semibold">构建与独立验证</h2>
    <p className="text-sm">可信构建会安装依赖并运行包脚本；独立验证会启动候选代码。两者都使用隔离数据目录，不等同于切换运行版本。</p>
    <Button variant="outline" disabled={!!busy} busy={review.isPending} onClick={() => { setBuildConsent(false); review.mutate(); }}>审阅当前构建计划</Button>
    {review.isError && <p role="alert" className="text-danger">{String(review.error)}</p>}
    {plan && <div className="space-y-3"><dl className="space-y-1 break-all text-xs"><dt>输入摘要</dt><dd>{plan.inputHash}</dd><dt>目标构建</dt><dd>{plan.targetHost.build}</dd><dt>运行时</dt><dd>{plan.toolchain.node.version} / npm {plan.toolchain.npm.version} / {plan.toolchain.platform} {plan.toolchain.arch}</dd><dt>构建脚本</dt><dd>{plan.buildScript}</dd><dt>预算</dt><dd>{plan.policy.timeoutMs / 60000} 分钟，日志最多 {plan.policy.logBytes / 1024 / 1024} MiB</dd></dl>
      <details className="text-xs"><summary>实际命令与工具路径</summary>{plan.commands.map((item, index) => <pre key={index} className="whitespace-pre-wrap break-all">{item.executable} {item.args.join(' ')}</pre>)}</details>
      {!currentPlan && <p className="text-warning">源码已变化，请重新审阅计划。</p>}
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={buildConsent} onChange={event => setBuildConsent(event.target.checked)} />我授权执行此计划的依赖安装和构建脚本</label>
      <Button disabled={!!busy || !currentPlan || !buildConsent} onClick={() => start.mutate({ action: 'candidate-core-build', inputHash: plan.inputHash })}>启动后台构建</Button>
    </div>}
    <div className="space-y-3 border-t border-line pt-3"><label className="block text-sm">待验证构建<Select aria-label="待验证构建" className="mt-2 block w-full" value={buildId} onChange={event => { setBuildId(event.target.value); setValidationConsent(false); }}><option value="">选择已有通过构建</option>{passedBuilds.map(task => <option key={task.id} value={task.buildId}>{task.buildId}</option>)}</Select></label>
      {!passedBuilds.length && <p className="text-xs text-muted">当前源码没有已记录通过的构建。提交验证时还会重新校验输入、工具链和产物。</p>}
      {selected && <p className="break-all text-xs">将验证产物 {selected.artifactRevision}</p>}
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={validationConsent} onChange={event => setValidationConsent(event.target.checked)} />我授权在隔离目录启动所选候选进行独立验证</label>
      <Button disabled={!!busy || !selected || !validationConsent} onClick={() => selected && start.mutate({ action: 'candidate-core-validate', buildId: selected.buildId, artifactRevision: selected.artifactRevision })}>启动独立验证</Button>
    </div>
    {start.isError && <p role="alert" className="text-danger">{String(start.error)}；不会自动重试，可检查后台任务后明确重试同一命令。</p>}
  </section>;
}
