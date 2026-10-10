import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import type { CoreRecoveryView, CoreSwitchResult } from '../../../shared/core-control';
import { api } from '../../api';
import { Button } from '../../ui/Button';
import { DialogActions, DialogClose, DialogContent, DialogDescription, DialogRoot, DialogTitle } from '../../ui/Dialog';
import { checkedReceipt, commandText, savedSwitches, useCoreStatus, type SavedSwitch } from '../state/core-control';
import { v2Host } from '../state/query';
import { createKey } from '../state/create';

export function CoreRecoveryDialog({close,restore}:{close:()=>void;restore:()=>void}) {
  return <DialogRoot open onOpenChange={open=>{if(!open)close();}}>
    <DialogContent className="max-h-[85dvh] w-[min(800px,calc(100vw-32px))] overflow-auto" onCloseAutoFocus={event=>{event.preventDefault();restore();}}>
      <DialogTitle>核心版本与恢复记录</DialogTitle>
      <DialogDescription>历史选择只表示曾经确认的构建。当前运行版本以重新连接后的服务观察为准。</DialogDescription>
      <RecoveryDetails />
      <DialogActions><DialogClose asChild><Button variant="outline">关闭恢复信息</Button></DialogClose></DialogActions>
    </DialogContent>
  </DialogRoot>;
}
function Selection({ label, value }: { label: string; value: Record<string, unknown> | null }) {
  return <section className="rounded-lg border border-line p-3"><h3 className="text-sm font-semibold">{label}</h3>
    {!value ? <p className="text-sm text-muted">没有已记录的选择。</p> : <dl className="mt-2 space-y-1 break-all text-xs">
      {([['build', '历史构建'], ['artifactRevision', '产物摘要'], ['buildId', '构建编号'], ['directory', '保留目录'], ['workspace', '工作目录'], ['home', '数据目录']] as const).map(([key, label]) => <div key={key}><dt>{label}</dt><dd>{typeof value[key] === 'string' ? value[key] : '记录不完整'}</dd></div>)}
    </dl>}
  </section>;
}
function RecoveryDetails() {
  const status = useCoreStatus();
  const [commands] = useState(savedSwitches);
  const query = useQuery({ queryKey: ['v2', v2Host(), 'core-recovery'], staleTime: 0, retry: false,
    queryFn: ({ signal }) => api<CoreRecoveryView>('/core/recovery', undefined, signal) });
  const data = query.isError ? undefined : query.data;
  return <div className="mt-4 space-y-4">
    <Button variant="outline" busy={query.isFetching || status.isFetching} onClick={() => { void query.refetch(); void status.refetch(); }}>重新读取版本与恢复记录</Button>
    <p className="break-all text-sm">当前服务：{!status.isError && status.data?.identity?.build ? `${status.data.identity.version} · ${status.data.identity.build}` : '运行身份待确认，请重新连接后读取。'}</p>
    {query.isPending && <p role="status">正在读取安装记录…</p>}
    {query.isError && <p role="alert" className="text-sm text-danger">恢复记录暂不可读：{String(query.error)}。服务中断时，请从启动该服务的终端使用同一安装的 core recovery-info 检查；不要按历史 PID 杀进程或自动重跑任务。</p>}
    {commands.map(command => <RecoveryReceipt key={command.request.commandId} pending={command} />)}
    {data && <>
      <p className="break-all text-xs text-muted">安装 {data.installation.id}<br />入口 {data.installation.entry}<br />观察摘要 {data.planHash}</p>
      <div className="grid gap-3 md:grid-cols-2"><Selection label="最后确认的选择" value={data.lastConfirmedSelection} /><Selection label="前一个确认的选择" value={data.previousConfirmedSelection} /></div>
      <section className="space-y-2 text-sm"><h3 className="font-semibold">未完成切换与进程观察</h3>
        {!data.interrupted.length && <p>没有未完成切换记录。</p>}
        {data.interrupted.map(item => <p key={item.commandId} className="break-all">命令 {item.commandId}：结果未知，不会自动重试。</p>)}
        {data.groups.map(item => <p key={item.group}>记录进程组 {item.group}：{item.state === 'absent' ? '已观察为不存在' : item.state === 'present' ? '仍存在，阻止恢复' : '无法确认，阻止恢复'}</p>)}
        {!!data.unobservedProcesses.length && <p className="text-warning">{data.unobservedProcesses.length} 项启动意图没有对应进程观察，保持只读恢复。</p>}
      </section>
      <section className="space-y-2 rounded-lg border border-line bg-panel p-3 text-sm"><h3 className="font-semibold">从启动终端恢复</h3>
        <p>先核对进程清理和数据兼容性。元数据对账不等于启动成功，恢复启动不会自动重跑业务任务。</p>
        {data.launcher.requiresBuild ? <p>当前为源码入口。请先完成构建并重新核对编译后 CLI 的安装身份，不能用此源码路径冒充可执行恢复命令。</p>
          : data.launcher.executable && data.launcher.args && <><p>以下命令只读取恢复信息：</p><pre className="whitespace-pre-wrap break-all text-xs">{commandText(data.launcher.executable, data.launcher.args)}</pre><p>清理确认后，以下只读命令分别检查两个恢复选择：</p>{(['last', 'previous'] as const).map(selection => <pre key={selection} className="whitespace-pre-wrap break-all text-xs">{commandText(data.launcher.executable!, [data.installation.entry, 'core', 'recover-plan', JSON.stringify({ selection })])}</pre>)}</>}
        <ol className="list-decimal space-y-1 pl-5"><li>使用同一安装的 core recovery-info 重新获取观察摘要。</li><li>进程清理已确认后，core reconcile 需要确认 commandId、planHash 和 authorize；它只记录元数据对账。</li><li>使用 core recover-plan 明确选择 last 或 previous，核验保留产物及当前存储。</li><li>核对新计划后，core recover 需要确认 commandId、planHash、selection 和 authorize。启动后重新连接并读取实际版本。</li></ol>
        <p className="text-xs text-muted">页面不会修改 PATH、全局安装或旧数据。存在阻碍时先等待其正常完成，再重新检查。</p>
      </section>
    </>}
  </div>;
}

/** Independent of the original candidate page: its old host binding is expected
 * to become unreadable after a successful change of the running core. */
function RecoveryReceipt({ pending }: { pending: SavedSwitch }) {
  const status = useCoreStatus();
  const query = useQuery({ queryKey: createKey(pending.sessionId, 'core-switch-receipt', pending.candidateId, pending.installationId, pending.request.commandId), retry:false, staleTime:0,
    queryFn: async ({signal}) => checkedReceipt((await api<{receipt:CoreSwitchResult|null}>(`/core/receipt?commandId=${encodeURIComponent(pending.request.commandId)}`, undefined, signal)).receipt, pending),
    refetchInterval: query => !query.state.data || query.state.data.status === 'unknown' && status.data?.phase === 'switching' ? 1000 : false });
  const observed = status.isError ? undefined : status.data;
  const matched = query.data?.status === 'applied' && observed?.phase === 'running' && observed.identity?.build === pending.expectedBuild && observed.installation?.id === pending.installationId;
  return <section aria-label={`恢复切换命令 ${pending.request.commandId}`} className="space-y-2 rounded-lg border border-line p-3 text-sm">
    <h3 className="font-semibold">{matched ? '已确认运行目标构建' : query.data?.status === 'failed' ? '切换失败' : '切换结果待核对'}</h3>
    <p className="break-all text-xs">命令 {pending.request.commandId}<br />目标 {pending.expectedBuild}<br />回执构建 {query.data?.actualBuild ?? '未知'}</p>
    {query.data?.error && <p className="break-words text-warning">{query.data.error}</p>}
    {query.isError && <p role="alert" className="break-words text-warning">回执读取失败：{String(query.error)}</p>}
    {!query.data && <p>尚无可确认终态；这里只读取原命令，不重发切换。</p>}
    <Button variant="outline" busy={query.isFetching} onClick={() => { void query.refetch(); void status.refetch(); }}>重新读取此命令回执</Button>
  </section>;
}
