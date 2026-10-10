import { CoreSwitchControls } from './core-switch';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import type { CoreCandidateView } from '../../../shared/core-candidate-view';
import { validId } from '../../../shared/protocol';
import { api } from '../../api';
import { Badge } from '../../ui/Badge';
import { Button } from '../../ui/Button';
import { EmptyState, ErrorState } from '../../ui/StateCard';
import { Tabs, TabPanel } from '../../ui/Tabs';
import { CoreActions, CoreOperationList, useCoreOperations } from './core-actions';
import { createKey } from '../state/create';

const statuses = { passed: '通过（历史记录）', failed: '失败', cancelled: '已取消', unknown: '结果未知', unconfirmed: '尚无可靠终态' };
export function CoreCandidatePage({ sessionId }: { sessionId: string }) {
  const operations = useCoreOperations(sessionId);
  const revision = operations.data?.map(task => `${task.commandId}:${task.status}:${task.resultId ?? ''}`).join('|');
  const query = useQuery<CoreCandidateView>({ queryKey: createKey(sessionId, 'core-candidate', revision),
    refetchInterval: operations.data?.some(task => ['running', 'cancelling'].includes(task.status)) ? 1000 : false, enabled: validId(sessionId), retry: false,
    queryFn: ({ signal }) => api(`/sessions/${encodeURIComponent(sessionId)}/core-candidate`, undefined, signal) });
  const [tab, setTab] = useState('diff');
  if (!validId(sessionId)) return <ErrorState title="核心目标地址无效" />;
  if (query.isPending) return <EmptyState title="正在读取核心候选…" busy />;
  if (query.isError) return <><CoreOperationList sessionId={sessionId} /><ErrorState title="核心候选不可读" detail={String(query.error)} actions={<Link to="/create/session/$sessionId" params={{ sessionId }}>返回开发目标</Link>} /></>;
  const candidate = query.data;
  return <main className="h-full min-w-0 overflow-auto px-6 py-4 max-[760px]:px-4">
    <header className="sticky top-0 z-10 bg-background pb-3"><p className="text-xs text-muted">CORE CANDIDATE</p><h1 className="text-xl">核心源码候选</h1><p className="break-all text-xs text-muted">{candidate.directory}</p></header>
    <div className="my-3 flex flex-wrap items-center gap-2"><Badge>已准备源码</Badge><Badge state={candidate.hostMatches ? 'default' : 'warning'}>{candidate.hostMatches ? '版本匹配' : '版本已变化'}</Badge><Button variant="outline" busy={query.isFetching} onClick={() => void query.refetch()}>刷新候选记录</Button></div>
    <p className="mb-3 text-sm">构建和独立验证分别记录；历史通过不代表当前产物仍有效，也不代表已切换或宿主验收通过。</p>
    <details className="mb-4 rounded-lg border border-line p-3 text-xs"><summary className="cursor-pointer">基线与构建输入</summary><dl className="space-y-2 break-all"><dt>候选编号</dt><dd>{candidate.id}</dd><dt>原始源码</dt><dd>{candidate.sourceRoot}</dd><dt>基线摘要</dt><dd>{candidate.baselineRevision}</dd><dt>当前摘要</dt><dd>{candidate.currentRevision}</dd><dt>目标宿主</dt><dd>{candidate.target.host?.build}</dd><dt>依赖锁摘要</dt><dd>{candidate.lockHash}</dd><dt>构建命令</dt><dd>{candidate.buildCommand}</dd><dt>源码版本</dt><dd>{candidate.packageVersion}</dd></dl></details>
    <Tabs ariaLabel="核心候选详情" value={tab} onChange={setTab} items={[{ id: 'diff', label: '源码差异' }, { id: 'validation', label: '构建与验证记录' }]} />
    <TabPanel id="diff" active={tab === 'diff'} className="mt-4">
      {!candidate.files.length && <EmptyState title="源码与准备基线一致" detail="查看差异不会运行构建或候选代码。" />}
      {candidate.files.map(file => <details key={file.path} className="mb-3 rounded-lg border border-line p-3"><summary className="cursor-pointer break-all text-sm font-medium">{file.change === 'added' ? '新增' : file.change === 'removed' ? '删除' : '修改'} · {file.path}</summary>
        <div className="mt-3 grid min-w-0 gap-3 xl:grid-cols-2">{[{ label: '准备时基线', hash: file.beforeHash, bytes: file.beforeBytes, text: file.before, error: file.beforeError }, { label: '当前内容', hash: file.afterHash, bytes: file.afterBytes, text: file.after, error: file.binary ? '二进制内容；展示摘要与字节数。' : undefined }].map(side => <section key={side.label} className="min-w-0"><h2 className="text-sm">{side.label}</h2><p className="break-all text-xs text-muted">{side.hash ?? '不存在'}{side.bytes !== undefined ? ` · ${side.bytes} 字节` : ''}</p>{side.error && <p role="status" className="text-xs text-warning">{side.error}</p>}{side.text !== undefined && <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-all rounded bg-panel p-3 text-xs">{side.text}</pre>}</section>)}</div>
        {file.truncated && <p className="mt-2 text-xs text-warning">正文已截断，摘要对应完整内容。</p>}
      </details>)}
      {!!candidate.excluded.length && <details className="mt-4 text-xs"><summary>未纳入源码的目录与文件</summary><ul>{candidate.excluded.map(path => <li key={path} className="break-all">{path}</li>)}</ul></details>}
    </TabPanel>
    <TabPanel id="validation" active={tab === 'validation'} className="mt-4 space-y-3">
      <CoreActions key={`${candidate.id}:${candidate.currentRevision}`} sessionId={sessionId} candidate={candidate} />
      <CoreSwitchControls key={`switch:${candidate.id}:${candidate.currentRevision}`} sessionId={sessionId} candidate={candidate} />
      <CoreOperationList sessionId={sessionId} />
      {candidate.historyErrors.map(error => <ErrorState key={error} title="部分验证记录不可读" detail={error} />)}
      {!candidate.tasks.length && !candidate.historyErrors.length && <EmptyState title="尚无构建或独立验证记录" detail="可信构建与独立启动需要分别授权，查看页面不会执行这些操作。" />}
      {!!candidate.omittedTasks && <p className="text-sm text-warning">另有 {candidate.omittedTasks} 项较早任务未在本页展示。</p>}
      {candidate.tasks.map(task => <article key={`${task.kind}:${task.id}`} aria-label={`核心验证任务 ${task.id}`} className="space-y-2 rounded-lg border border-line p-3">
        <h2 className="text-sm font-semibold">{task.kind === 'build' ? '可信构建' : '独立启动验证'} · {statuses[task.status]}</h2><p className="break-all text-xs text-muted">任务 {task.id} · 命令 {task.commandId} · {task.startedAt}</p>
        {task.sourceRevision && task.sourceRevision !== candidate.currentRevision && <Badge state="warning">旧源码结果，不适用于当前候选</Badge>}
        {task.artifactRevision && <p className="break-all text-xs">产物 {task.artifactRevision}</p>}
        {task.status === 'unconfirmed' && <p className="text-sm text-warning">该操作可能仍在其他进程运行，或已中断且结果未知；查看页面不会重跑。</p>}
        {task.error && <p className="break-words text-sm text-danger">{task.error}</p>}
        {!!task.checks.length && <details className="text-xs"><summary>已记录检查</summary><ul>{task.checks.map(check => <li key={check}>{check}</li>)}</ul></details>}
        {task.logs.map((log, index) => <div key={index}><p className="text-xs text-muted">{log.at} · {log.channel}</p>{log.error ? <p role="alert" className="text-sm text-danger">{log.error}</p> : <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-all rounded bg-panel p-3 text-xs">{log.text}</pre>}{log.truncated && <p className="text-xs text-warning">该段日志已截断。</p>}</div>)}
        {!!task.omittedLogs && <p className="text-xs text-warning">另有 {task.omittedLogs} 段日志超过本页展示预算。</p>}
      </article>)}
    </TabPanel>
  </main>;
}
