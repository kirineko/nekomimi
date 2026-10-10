import {SessionCatalog} from './session-catalog';
import { CreateConversation } from './create-conversation';
import { HandoffCompose } from './handoff-compose';
import { HandoffCards } from './handoff-cards';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { useRef, useState } from 'react';
import { api } from '../../api';
import { Badge } from '../../ui/Badge';
import { Button } from '../../ui/Button';
import { Input, Select } from '../../ui/Input';
import { EmptyState, ErrorState } from '../../ui/StateCard';
import { Tabs, TabPanel } from '../../ui/Tabs';
import { createKey, useCandidate, useCreateSessions, useCreateSession, useCustomization, type CandidateView } from '../state/create';
import { CandidateExecution, CandidateTaskRecovery } from './candidate-execution';
import { DevEyebrow, DevOnly, DevValue } from "../dev-only";
import { CandidateManagement } from './candidate-management';
export { useCustomization } from '../state/create';
const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);
const stages = [{ id: 'static', label: '静态校验' }, { id: 'simulation', label: '模拟试运行' }, { id: 'preview', label: '视图预览' }, { id: 'loaded', label: '加载' }, { id: 'host', label: '宿主验收' }];
const statusText: Record<string, string> = { passed: '通过', failed: '失败', cancelled: '已取消', observed: '已观察', running: '运行中', cancelling: '取消待确认', unknown: '结果未知' };
function CandidateLink({ id, sessionId, active }: { id: string; sessionId?: string; active?: boolean }) {
  const props = { 'aria-current': active ? 'page' as const : undefined, className: `block break-all rounded-md px-3 py-2 text-sm ${active ? 'bg-wash font-semibold' : 'hover:bg-wash/60'}`, children: id };
  return sessionId ? <Link to="/create/session/$sessionId/candidate/$candidateId" params={{ sessionId, candidateId: id }} {...props} /> : <Link to="/create/candidate/$candidateId" params={{ candidateId: id }} {...props} />;
}
export function CreateNavigation({ active, sessionId }: { active?: string; sessionId?: string }) {
  const query = useCustomization(sessionId), sessions = useCreateSessions(), selected=useCreateSession(sessionId);
  const abilities = query.data?.abilities.length;
  const resourcesTo = sessionId ? "/create/session/$sessionId/resources" : "/create/resources";
  return <nav aria-label="能力与候选" className="flex flex-col gap-3">
    <DevEyebrow>CREATION</DevEyebrow><Link to="/create" className="text-base font-semibold">创造空间</Link>
    {typeof abilities === 'number' && (
      <Link to={resourcesTo} params={sessionId ? { sessionId } : {}} className="text-sm">
        能力与权限{abilities > 0 ? ` · ${abilities} 项可用` : ''}</Link>
    )}
    <h2 className="text-sm">开发目标</h2>
    <SessionCatalog mode="create" active={sessionId} query={sessions} />
    {sessionId && selected.data?.binding?.target.kind === 'core' && <Link to="/create/session/$sessionId/core" params={{ sessionId }} className="block rounded-md px-3 py-2 text-sm font-semibold hover:bg-wash">核心源码与验证</Link>}
    <h2 className="text-sm">{sessionId ? '目标候选' : '当前项目候选'}</h2>
    {query.isPending && <p role="status">读取候选目录…</p>}{query.isError && <ErrorState title="候选目录不可用" detail={errorText(query.error)} />}
    {query.data?.candidates.length === 0 && <p className="text-sm text-muted">暂无候选。</p>}
    <ul className="m-0 list-none p-0">{query.data?.candidates.map(id => <li key={id}><CandidateLink id={id} sessionId={sessionId} active={id === active} /></li>)}</ul>
    <DevOnly>
      <h2 className="text-sm">可用与待处理能力</h2>{query.data?.abilities.length === 0 && <p className="text-sm text-muted">暂无能力。</p>}
      <ul className="m-0 list-none p-0">{query.data?.abilities.map(ability => <li key={ability.key} className="break-words px-3 py-1 text-sm">{ability.name} <span className="text-xs text-muted">{ability.scope === 'user' ? '用户' : '项目'} · {ability.phase}</span></li>)}</ul>
    </DevOnly>
  </nav>;
}
export function CreateHomePage({ sessionId }: { sessionId?: string }) {
  const selected = useCreateSession(sessionId), catalog = useCustomization(sessionId), navigate = useNavigate(), client = useQueryClient();
  const [title, setTitle] = useState(''), [root, setRoot] = useState(''), [kind, setKind] = useState<'extension' | 'core'>('extension');
  const accepted = useRef<{ fingerprint: string; commandId: string } | undefined>(undefined);
  const create = useMutation({ mutationFn: (value: object) => api<{ id: string }>('/sessions', value), onSuccess: async value => { await client.invalidateQueries({ queryKey: createKey(undefined, 'sessions') }); void navigate({ to: '/create/session/$sessionId', params: { sessionId: value.id } }); } });
  const session = selected.data;
  return <main className="h-full min-w-0 overflow-auto px-6 py-4 max-[760px]:px-4"><DevEyebrow>CREATE MODE</DevEyebrow><h1 className="break-words text-xl">{session?.title ?? (sessionId ? '开发目标' : '为 Nekomimi 开发新能力')}</h1>
    {sessionId ? <>
      {selected.isPending && <EmptyState title="正在读取开发目标…" busy />}{selected.isError && <ErrorState title="开发目标不可用" detail={errorText(selected.error)} />}
      {selected.data && !session && <ErrorState title="创造会话不存在或已删除" />}
      {session && <section aria-label="当前开发目标" className="mt-4 rounded-xl border border-line p-4"><p className="break-all text-sm">{session.binding?.target.root}</p><p className="mt-2 text-xs text-muted">{session.binding?.target.kind === 'core' ? '核心源码' : '扩展开发'} · {session.binding?.target.scope === 'user' ? '用户范围' : '项目范围'}</p><DevValue label="目标构建" value={session.binding?.target.host?.build ?? '未知'} />{session.targetError && <p role="alert" className="text-danger">{session.targetError}</p>}<p className="mt-3 text-sm">从左侧选择候选，检查差异、验证记录或显式运行预览。</p></section>}
      {session?.binding?.target.kind === 'core' && <Link to="/create/session/$sessionId/core" params={{ sessionId }} className="mt-4 block rounded-lg border border-line p-4 text-sm font-semibold">查看核心源码差异与验证记录</Link>}
      {session?.binding && <CreateConversation key={`conversation:${session.id}`} sessionId={session.id} targetId={session.binding.target.id} />}
      {session && <HandoffCompose key={`handoff:${session.id}`} sessionId={session.id} mode="create" />}
      {session && <HandoffCards key={sessionId} sessionId={session.id} mode="create" />}
      {catalog.isError && <ErrorState title="目标目录不可用" detail={errorText(catalog.error)} />}{session?.binding?.target.kind !== 'core' && catalog.data?.candidates.length === 0 && <EmptyState title="此目标尚无扩展候选" detail="在独立开发目录创建候选后，其内容与验证记录会出现在这里。" />}
    </> : <form aria-label="新建创造会话" className="mt-4 flex max-w-xl flex-col gap-4 rounded-xl border border-line p-4" onSubmit={event => {
      event.preventDefault(); if (create.isPending) return;
      const value = { version: 1, mode: 'create', title: title.trim() || '能力开发', target: { kind, root: root.trim(), scope: 'project' } }, fingerprint = JSON.stringify(value);
      if (accepted.current?.fingerprint !== fingerprint) accepted.current = { fingerprint, commandId: crypto.randomUUID() };
      create.mutate({ ...value, commandId: accepted.current.commandId });
    }}><h2 className="text-base">建立独立开发目标</h2><label className="text-sm">会话名称<Input aria-label="创造会话名称" value={title} onChange={event => setTitle(event.target.value)} /></label><label className="text-sm">目标类型<Select aria-label="开发目标类型" value={kind} onChange={event => setKind(event.target.value as 'extension' | 'core')}><option value="extension">扩展</option><option value="core">核心源码</option></Select></label><label className="text-sm">独立目录<Input aria-label="独立开发目录" required value={root} onChange={event => setRoot(event.target.value)} placeholder="/绝对路径/开发目录" /></label><p className="text-xs text-muted">选择已有独立目录；核心目录需先登记源码候选。创建会话不会执行模型、构建或候选代码。</p>{create.isError && <p role="alert" className="text-danger">{errorText(create.error)}</p>}<Button type="submit" busy={create.isPending}>建立创造会话</Button></form>}
  </main>;
}
export function CreateCandidatePage({ candidateId, sessionId }: { candidateId: string; sessionId?: string }) {
  const query = useCandidate(candidateId, sessionId);
  if (!/^[a-z0-9-]{1,100}$/.test(candidateId)) return <ErrorState title="候选地址无效" detail="请从候选列表重新选择。" />;
  if (query.isPending) return <EmptyState title="正在读取候选…" busy />;
  if (query.isError) return <><ErrorState title="候选不存在或暂不可读" detail={errorText(query.error)} actions={<Button variant="outline" onClick={() => void query.refetch()}>重新读取</Button>} />{sessionId && <CandidateTaskRecovery sessionId={sessionId} candidateId={candidateId} />}</>;
  return <CandidateContent key={`${sessionId ?? 'host'}:${candidateId}:${query.data.contentHash}:${query.data.host.build}`} candidate={query.data} sessionId={sessionId} />;
}
export function CandidateContent({ candidate, sessionId }: { candidate: CandidateView; sessionId?: string }) {
  const client = useQueryClient(), [tab, setTab] = useState('diff');
  const refresh = () => client.invalidateQueries({ queryKey: createKey(sessionId) });
  const validationCommand = useRef<string | undefined>(undefined);
  const validating = candidate.validationTasks.some(task => ['running', 'cancelling'].includes(task.status));
  const validate = useMutation({ mutationFn: () => {
    validationCommand.current ??= crypto.randomUUID();
    return api('/customization', { action: 'candidate-validation-start', id: candidate.id, contentHash: candidate.contentHash, commandId: validationCommand.current, sessionId });
  }, onSuccess: () => { validationCommand.current = undefined; }, onSettled: refresh });
  const cancelValidation = useMutation({ mutationFn: (taskId: string) => api('/customization', { action: 'candidate-validation-cancel', taskId, sessionId }), onSettled: refresh });
  return <main className="h-full min-w-0 overflow-auto px-6 py-4 max-[760px]:px-4">
    <header className="sticky top-0 z-10 bg-background pb-3"><h1 className="break-words text-xl">{candidate.name}</h1><p className="break-all text-xs text-muted">{candidate.path}</p></header>
    <section aria-label="候选阶段" className="mb-4 flex flex-wrap gap-2">{stages.map(stage => { const evidence = candidate.evidence.slice().reverse().find(item => item.stage === stage.id || stage.id === 'loaded' && item.stage === 'load-failed'); const task = ['static', 'simulation', 'preview'].includes(stage.id) ? candidate.validationTasks.find(item => item.stage === stage.id && item.contentHash === candidate.contentHash && item.hostBuild === candidate.host.build) : undefined; const status = task && (!evidence || (task.finishedAt ?? task.startedAt) > evidence.at) ? task.status : evidence?.status ?? (evidence?.passed === true ? 'passed' : evidence?.passed === false ? 'failed' : undefined); return <Badge key={stage.id} state={status === 'failed' ? 'danger' : status === 'passed' ? 'ok' : 'default'}>{stage.label}：{status ? statusText[status] ?? status : '未运行'}</Badge>; })}</section>
    <p className="mb-3 break-all text-xs text-muted">当前内容 {candidate.contentHash}；预览和模拟通过不代表已应用或宿主验收通过。</p>
    {sessionId && <HandoffCompose key={`handoff:${sessionId}:${candidate.id}:${candidate.contentHash}`} sessionId={sessionId} mode="create" candidate={candidate} />}
    <Tabs className="flex-wrap" ariaLabel="候选详情" value={tab} onChange={setTab} items={[{ id: 'diff', label: '内容差异' }, { id: 'validation', label: '验证记录' }, { id: 'simulation', label: '模拟试运行' }, { id: 'preview', label: '运行预览' }, { id: 'management', label: '启用与导出' }]} />
    <TabPanel id="diff" active={tab === 'diff'} className="mt-4">{!candidate.files.length && <EmptyState title="与当前选择版本没有内容差异" />}{candidate.files.map(file => <details key={file.name} className="mb-3 rounded-lg border border-line p-3"><summary className="cursor-pointer break-all text-sm font-medium">{file.change === 'added' ? '新增' : file.change === 'removed' ? '删除' : '修改'} · {file.name}</summary><div className="mt-3 grid min-w-0 gap-3 xl:grid-cols-2">{[['变更前', file.before], ['变更后', file.after]].map(([label, value]) => <div key={label}><h3 className="text-xs text-muted">{label}</h3><pre className="max-h-96 overflow-auto whitespace-pre-wrap break-all rounded bg-panel p-3 text-xs">{value ?? '（不存在）'}</pre></div>)}</div>{file.truncated && <p className="text-xs text-warning">内容已截断；完整文件请在开发目录查看。</p>}</details>)}</TabPanel>
    <TabPanel id="validation" active={tab === 'validation'} className="mt-4"><Button disabled={!sessionId || validating} busy={validate.isPending} onClick={() => validate.mutate()}>运行静态校验</Button>{!sessionId && <p className="mt-2 text-sm text-muted">从绑定的创造目标进入后才能运行校验或预览。</p>}{validate.isError && <p role="alert" className="text-danger">{errorText(validate.error)}</p>}{!candidate.evidence.length && !candidate.validationTasks.length && <EmptyState title="当前内容尚无验证记录" detail="页面查看不会启动验证。" />}
      {cancelValidation.isError && <p role="alert" className="text-danger">{errorText(cancelValidation.error)}</p>}
      {candidate.validationTasks.map(task => <article key={task.id} aria-label={`验证任务 ${task.id}`} className="mt-3 space-y-2 rounded-lg border border-line p-3">
        <h3 className="text-sm font-semibold">{stages.find(stage => stage.id === task.stage)?.label ?? task.stage}任务 · {statusText[task.status]}</h3><p className="break-all text-xs text-muted">任务 {task.id} · {task.startedAt}</p><p className="break-all text-xs text-muted">范围 {task.target} · 内容 {task.contentHash}</p>
        {task.contentHash !== candidate.contentHash && <Badge state="warning">对应旧内容，不计入当前状态</Badge>}
        {task.hostBuild !== candidate.host.build && <Badge state="warning">对应其他宿主构建</Badge>}
        {task.cancelRequested && <p className="text-xs">已记录取消请求；实际结果以任务终态为准。</p>}
        {task.status === 'unknown' && <p role="status" className="text-sm text-warning">未找到可靠终态；不会自动重跑。</p>}
        {['running', 'cancelling'].includes(task.status) && <Button variant="outline" disabled={task.cancelRequested} busy={cancelValidation.isPending} onClick={() => cancelValidation.mutate(task.id)}>请求停止验证</Button>}
        {task.error && <p className={`break-words text-sm ${task.status === 'cancelled' ? 'text-muted' : 'text-danger'}`}>{task.error}</p>}
        {task.result?.text && <pre className="whitespace-pre-wrap break-words text-sm">{task.result.text}</pre>}
        <ol aria-label="验证日志" className="list-none space-y-1 p-0">{task.logs.map((log, index) => <li key={index} className="break-words text-xs">{log.at} · {log.message}</li>)}</ol>
        {task.diagnostics?.map((diagnostic, index) => <pre key={index} className="whitespace-pre-wrap break-all text-xs">{diagnostic.file}{diagnostic.line ? `:${diagnostic.line}` : ''} {diagnostic.message}</pre>)}
      </article>)}
      {candidate.evidence.map((evidence, index) => <article key={`${evidence.at}:${index}`} className="mt-3 rounded-lg border border-line p-3"><h3 className="text-sm">{stages.find(stage => stage.id === evidence.stage)?.label ?? evidence.stage} · {statusText[evidence.status ?? 'observed'] ?? evidence.status}</h3><p className="text-xs text-muted">{evidence.at} · {evidence.check ?? '记录的检查'}</p>{evidence.diagnostics?.map((diagnostic, i) => <pre key={i} className="mt-2 whitespace-pre-wrap break-all text-xs">{diagnostic.file}{diagnostic.line ? `:${diagnostic.line}` : ''} {diagnostic.message}</pre>)}</article>)}
      {!!candidate.previousEvidence.length && <details className="mt-4 text-sm"><summary>旧内容或其他环境的记录（不计入当前状态）</summary>{candidate.previousEvidence.map((evidence, index) => <p key={index} className="break-all text-xs">{evidence.at} · {evidence.stage} · {evidence.revision}</p>)}</details>}
    </TabPanel>
    <TabPanel id="simulation" active={tab === 'simulation'} className="mt-4"><CandidateExecution candidate={candidate} sessionId={sessionId} stage="simulation" /></TabPanel>
    <TabPanel id="preview" active={tab === 'preview'} className="mt-4"><CandidateExecution candidate={candidate} sessionId={sessionId} stage="preview" /></TabPanel>
    <TabPanel id="management" active={tab === 'management'} className="mt-4"><CandidateManagement candidate={candidate} sessionId={sessionId} /></TabPanel>
  </main>;
}
