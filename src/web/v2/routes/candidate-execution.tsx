import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import type { ValidationTask } from '../../../shared/validation-task';
import type { PanelMount } from '../../components/CustomPanel';
import { api } from '../../api';
import { Button } from '../../ui/Button';
import { Input, Textarea } from '../../ui/Input';
import { createKey, type CandidateView } from '../state/create';
import { CandidatePreviewFrame } from './candidate-preview';
const text = (error: unknown) => error instanceof Error ? error.message : String(error);
export function useValidationTasks(sessionId?: string) {
  return useQuery({ queryKey: createKey(sessionId, 'validation-tasks'), enabled: !!sessionId, retry: false,
    queryFn: ({ signal }) => api<ValidationTask[]>(`/sessions/${sessionId}/validation-tasks`, undefined, signal),
    refetchInterval: query => query.state.data?.some(task => ['running', 'cancelling'].includes(task.status)) ? 750 : false });
}
export function CandidateTaskRecovery({ sessionId, candidateId }: { sessionId: string; candidateId: string }) {
  const query = useValidationTasks(sessionId), client = useQueryClient();
  const cancel = useMutation({ mutationFn: (taskId: string) => api('/customization', { action: 'candidate-validation-cancel', sessionId, taskId }), onSettled: () => client.invalidateQueries({ queryKey: createKey(sessionId) }) });
  return <section aria-label="目标验证任务" className="space-y-3 p-4">
    {query.isPending && <p role="status">正在读取任务记录…</p>}{query.isError && <p role="alert">任务记录不可读：{text(query.error)}</p>}
    {query.data?.filter(task => task.candidateId === candidateId).map(task => <article key={task.id}><p className="break-all">{task.stage} · {task.id} · {task.status}</p>{['running', 'cancelling'].includes(task.status) && <Button disabled={task.cancelRequested} busy={cancel.isPending} onClick={() => cancel.mutate(task.id)}>请求停止验证</Button>}{task.error && <p>{task.error}</p>}</article>)}
    {cancel.isError && <p role="alert">{text(cancel.error)}</p>}
  </section>;
}
export function CandidateExecution({ candidate, sessionId, stage }: { candidate: CandidateView; sessionId?: string; stage: 'simulation' | 'preview' }) {
  const client = useQueryClient(), [consent, setConsent] = useState(false), [props, setProps] = useState('{}'), [command, setCommand] = useState('/'), [modelReply, setModelReply] = useState('模拟模型回复'), [requested, setRequested] = useState<string>();
  const accepted = useRef<{ fingerprint: string; id: string } | undefined>(undefined);
  const refresh = () => client.invalidateQueries({ queryKey: createKey(sessionId) });
  const start = useMutation({ mutationFn: async () => {
    if (!sessionId || !consent) throw Error('请先确认执行范围');
    const input = { action: 'candidate-execution-start', sessionId, id: candidate.id, contentHash: candidate.contentHash, stage, authorize: true, ...(stage === 'preview' ? { props: JSON.parse(props) } : { command, modelReply }) };
    const fingerprint = JSON.stringify(input);
    if (accepted.current?.fingerprint !== fingerprint) accepted.current = { fingerprint, id: crypto.randomUUID() };
    return api<ValidationTask>('/customization', { ...input, commandId: accepted.current.id });
  }, onSuccess: task => { accepted.current = undefined; setRequested(task.id); }, onSettled: refresh });
  const task = candidate.validationTasks.find(item => item.id === requested);
  const frame = useQuery({ queryKey: createKey(sessionId, 'preview-frame', requested), enabled: stage === 'preview' && task?.status === 'passed', gcTime: 0, staleTime: 0, retry: false, refetchOnWindowFocus: false, refetchOnReconnect: false,
    queryFn: ({ signal }) => api<{ frame: PanelMount }>(`/sessions/${sessionId}/validation-tasks/${requested}/preview`, undefined, signal) });
  const cancel = useMutation({ mutationFn: (taskId: string) => api('/customization', { action: 'candidate-validation-cancel', sessionId, taskId }), onSettled: refresh });
  const active = candidate.validationTasks.filter(item => item.stage === stage && ['running', 'cancelling'].includes(item.status));
  const busy = candidate.validationTasks.some(item => ['running', 'cancelling'].includes(item.status));
  return <section aria-label={stage === 'preview' ? '候选预览操作' : '候选模拟操作'} className="space-y-3">
    <p className="text-sm">{stage === 'preview' ? '预览会执行可信 Node 扩展工厂和浏览器面板代码，宿主操作被禁用。仅对包含面板或视图的候选可用。' : '模拟会执行可信 Node 扩展工厂和指定命令，使用下方模拟模型回复。'} 离开页面后后台任务继续，可在验证记录中请求停止。</p>
    {stage === 'preview' ? <label className="block text-sm">面板数据 JSON<Textarea aria-label="预览数据 JSON" value={props} onChange={event => setProps(event.target.value)} /></label> : <><label className="block text-sm">模拟命令<Input aria-label="模拟命令" value={command} onChange={event => setCommand(event.target.value)} maxLength={8000} /></label><label className="block text-sm">模拟模型回复<Textarea aria-label="模拟模型回复" value={modelReply} onChange={event => setModelReply(event.target.value)} maxLength={16000} /></label></>}
    <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={consent} onChange={event => setConsent(event.target.checked)} />{stage === 'preview' ? '我授权执行当前候选的预览代码' : '我授权执行当前候选的模拟代码'}</label>
    <Button disabled={!sessionId || !consent || busy || (stage === 'simulation' && !command.startsWith('/'))} busy={start.isPending} onClick={() => { setRequested(undefined); start.mutate(); }}>{stage === 'preview' ? '运行候选预览' : '运行候选模拟'}</Button>
    {stage === 'preview' && !requested && candidate.validationTasks.filter(item => item.stage === 'preview' && item.status === 'passed' && item.contentHash === candidate.contentHash && item.hostBuild === candidate.host.build).slice(0, 1).map(item => <Button key={item.id} variant="outline" disabled={!consent} onClick={() => setRequested(item.id)}>打开已完成预览</Button>)}
    {start.isError && <p role="alert">{text(start.error)}</p>}{cancel.isError && <p role="alert">{text(cancel.error)}</p>}
    {active.map(item => <div key={item.id}><p role="status" className="break-all">任务 {item.id} · {item.cancelRequested ? '取消待确认' : '运行中'}</p><Button disabled={item.cancelRequested} busy={cancel.isPending} onClick={() => cancel.mutate(item.id)}>请求停止验证</Button></div>)}
    {task?.error && <p role="alert">{task.error}</p>}{task?.result?.text && <pre className="whitespace-pre-wrap break-words">{task.result.text}</pre>}
    {stage === 'preview' && requested && task?.status === 'passed' && <>{frame.isPending && <p role="status">正在读取预览实例…</p>}{frame.isError && <p role="alert">预览不可用：{text(frame.error)}。不会自动重新执行候选。</p>}{frame.data && sessionId && <><Button variant="outline" onClick={() => setRequested(undefined)}>关闭预览</Button><CandidatePreviewFrame key={frame.data.frame.instanceId} frame={frame.data.frame} title={candidate.name} sessionId={sessionId} /></>}</>}
  </section>;
}
