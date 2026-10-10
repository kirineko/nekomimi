import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../../api';
import { Button } from '../../ui/Button';
import { EmptyState, ErrorState } from '../../ui/StateCard';
import { createKey, useCustomization } from '../state/create';
import { WorkflowControls } from './workflow-controls';
export function WorkflowsPage({ sessionId, mode }: { sessionId?: string; mode: 'work' | 'create' }) {
  const query = useCustomization(sessionId), client = useQueryClient(), lock = useRef(false);
  const [pending, setPending] = useState(false), [error, setError] = useState('');
  const action = async (value: object) => {
    if (lock.current) return;
    lock.current = true; setPending(true); setError('');
    try { return await api('/customization', { ...value, sessionId }); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); return undefined; }
    finally { await client.invalidateQueries({ queryKey: createKey(sessionId) }); lock.current = false; setPending(false); }
  };
  if (query.isPending) return <EmptyState title="正在读取持久工作流…" busy />;
  if (!query.data) return <ErrorState title="工作流目录不可读" detail={String(query.error)} actions={<Button onClick={() => void query.refetch()}>重新读取工作流</Button>} />;
  const data = query.data;
  return <div className="min-w-0"><header className="sticky top-0 z-10 space-y-2 bg-background pb-3"><h1 className="text-xl">持久工作流管理</h1><Button variant="outline" onClick={() => void query.refetch()}>刷新工作流状态</Button></header>
    <p className="mb-3 text-sm">当前为{mode === 'work' ? '工作' : '创造'}模式。查看记录不继续执行；结果未知时先核对外部效果。</p>
    {mode === 'create' && !sessionId && <p className="text-warning">请进入绑定的创造目标后管理工作流。</p>}
    {query.isError && <p role="alert">刷新失败，保留上次状态：{String(query.error)}</p>}{error && <p role="alert" className="mb-3 break-all text-danger">操作未确认：{error}。不会自动重试，请刷新核对状态后再决定。</p>}
    {data.workflowBusy && <p role="status" className="mb-3 text-sm">工作流正在执行或收尾；可请求取消，其他操作需等待任务释放。</p>}
    <WorkflowControls flows={data.workflows.filter(flow => flow.mode === mode)} definitions={data.workflowDefinitions.filter(definition => !definition.modes || definition.modes.includes(mode))} busy={pending || data.busy || data.workflowBusy || mode === 'create' && !sessionId} cancelBusy={pending || mode === 'create' && !sessionId} action={action} sessionId={sessionId} />
  </div>;
}
