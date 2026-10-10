import { useMutation, useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useRef, useState } from 'react';
import type { CoreCandidateView } from '../../../shared/core-candidate-view';
import type { CoreControlStatus, CoreLaunchInfo, CoreSwitchPlan, CoreSwitchResult } from '../../../shared/core-control';
import type { Snapshot } from '../../../shared/protocol';
import { validId } from '../../../shared/protocol';
import { api, ClientError } from '../../api';
import { Button } from '../../ui/Button';
import { Select } from '../../ui/Input';
import { DialogActions, DialogClose, DialogContent, DialogDescription, DialogRoot, DialogTitle } from '../../ui/Dialog';
import { checkedReceipt, commandText, forgetSwitch, readSwitch, saveSwitch, useCoreStatus, type SavedSwitch } from '../state/core-control';
import { createKey } from '../state/create';

function BlockedSession({ sessionId }: { sessionId: string }) {
  const query = useQuery({ queryKey: createKey(sessionId, 'switch-blocker'), retry: false,
    queryFn: ({ signal }) => api<Snapshot>(`/sessions/${sessionId}/snapshot`, undefined, signal) });
  if (!query.data || query.isError) return <span>会话 {sessionId}</span>;
  return <Link className="underline" to={query.data.session.binding?.mode === 'create' ? '/create/session/$sessionId' : '/work/session/$sessionId'} params={{ sessionId }}>打开会话「{query.data.session.title}」查看或停止任务</Link>;
}
function Blockers({ status }: { status?: CoreControlStatus }) {
  return <>{!!status?.blockers?.length && <section aria-label="切换阻碍" className="rounded-lg border border-warning p-3 text-sm">
    <h3 className="font-semibold">当前有任务阻止切换</h3>
    <ul className="mt-2 space-y-2">{status.blockers.map((item, index) => <li key={`${item.kind}:${item.id}:${index}`} className="break-all">
      {item.kind} · {item.state ?? '等待完成'}{item.id && ` · ${item.id}`}{item.target && <p>目标 {item.target}</p>}
      {item.sessionId && validId(item.sessionId) && <BlockedSession sessionId={item.sessionId} />}
    </li>)}</ul>
    <p className="mt-2">可以等待任务正常结束，再刷新状态。此处不会强制停止进程。</p>
  </section>}</>;
}

export function CoreSwitchControls({ sessionId, candidate }: { sessionId: string; candidate: CoreCandidateView }) {
  const status = useCoreStatus();
  const observed = status.isError ? undefined : status.data;
  const [validationId, setValidationId] = useState(''), [buildId, setBuildId] = useState('');
  const [open, setOpen] = useState(false), [consent, setConsent] = useState(false);
  const [pending, setPending] = useState<SavedSwitch | undefined>(() => readSwitch(sessionId, candidate.id));
  const guard = useRef(false), cancelRef = useRef<HTMLButtonElement>(null), reviewRef = useRef<HTMLButtonElement>(null), regionRef = useRef<HTMLElement>(null);
  const validations = candidate.tasks.filter(task => task.kind === 'validation' && task.status === 'passed' && task.artifactRevision);
  const builds = candidate.tasks.filter(task => task.kind === 'build' && task.status === 'passed' && task.artifactRevision);
  const preview = useMutation({ mutationFn: async () => {
    const value = await api<CoreSwitchPlan>('/core/preview', { validationId });
    if (value.candidate?.candidateId !== candidate.id || value.candidate.validationId !== validationId
      || [value.installationId, value.planHash, value.from?.identity?.build, value.candidate.build, value.candidate.artifactRevision].some(value => typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value))
      || value.impact?.action !== 'replace-supervised-web-process' || value.impact.activeInstallationFilesChanged !== false)
      throw Error('切换计划不属于当前核心候选，请重新读取。');
    return value;
  }, onSuccess: () => { setConsent(false); setOpen(true); } });
  const manual = useMutation({ mutationFn: () => api<CoreLaunchInfo>(`/sessions/${sessionId}/core-launch-info?buildId=${encodeURIComponent(buildId)}`) });
  const send = useMutation({ mutationFn: async (value: SavedSwitch) => {
    if (guard.current) throw Error('该确认已在提交，请先读取结果。');
    guard.current = true;
    try {
      saveSwitch(value); setPending(value);
      return checkedReceipt(await api<CoreSwitchResult>('/core/switch', value.request), value);
    } finally { guard.current = false; }
  }, onSettled: () => { void status.refetch(); } });
  const receipt = useQuery({ queryKey: createKey(sessionId, 'core-switch-receipt', candidate.id, pending?.installationId, pending?.request.commandId),
    enabled: !!pending, retry: false, staleTime: 0,
    queryFn: async ({ signal }) => {
      const result = await api<{ receipt: CoreSwitchResult | null }>(`/core/receipt?commandId=${encodeURIComponent(pending!.request.commandId)}`, undefined, signal);
      return checkedReceipt(result.receipt, pending!);
    }, refetchInterval: query => pending && (!query.state.data || query.state.data.status === 'unknown' && observed?.phase === 'switching') ? 1000 : false });
  const result = receipt.data ?? send.data;
  const plan = preview.data;
  const blocked = status.isPending || status.isError || !observed?.switchSupported || observed.phase !== 'running' || !!observed.blockers?.length;
  const sameInstallation = !!pending && observed?.installation?.id === pending.installationId;
  const terminal = result?.status === 'applied' || result?.status === 'failed';
  const rejected = send.error instanceof ClientError && ['core_conflict', 'core_busy', 'core_authorization', 'input', 'command_conflict'].includes(send.error.code) && receipt.isSuccess && receipt.data === null;
  const confirmedRunning = result?.status === 'applied' && observed?.phase === 'running' && observed.identity?.build === pending?.expectedBuild && sameInstallation;
  const confirm = () => {
    if (!plan || !consent || blocked || guard.current || send.isPending) return;
    const value: SavedSwitch = { version:1, sessionId, candidateId:candidate.id, installationId:plan.installationId,
      expectedBuild:plan.candidate.build, fromBuild:plan.from.identity.build,
      request:{commandId:crypto.randomUUID(),planHash:plan.planHash,validationId:plan.candidate.validationId,artifactRevision:plan.candidate.artifactRevision,authorize:true} };
    setOpen(false); setConsent(false); send.mutate(value);
  };
  return <section ref={regionRef} tabIndex={-1} aria-label="核心版本切换" className="space-y-4 rounded-lg border border-line p-4">
    <h2 className="text-base font-semibold">切换运行版本</h2>
    <p className="break-all text-sm">当前服务构建：{observed?.identity?.build ?? '待确认；请重新读取状态。'}</p>
    <Button variant="outline" busy={status.isFetching} onClick={() => void status.refetch()}>等待并刷新切换状态</Button>
    {status.isError && <p role="alert" className="text-sm text-danger">运行状态不可读：{String(status.error)}</p>}
    <Blockers status={observed} />
    {observed && !observed.switchSupported && <section className="space-y-3 rounded-lg bg-panel p-3" aria-label="手动启动指引">
      <p className="text-sm">当前启动方式不支持托管切换。已有构建不代表已应用，请审阅核验后的手动启动路径。</p>
      <Select aria-label="手动启动的构建" value={buildId} onChange={event => { setBuildId(event.target.value); manual.reset(); }}>
        <option value="">选择构建记录</option>{builds.map(task => <option key={task.id} value={task.buildId}>{task.buildId}</option>)}
      </Select>
      <Button variant="outline" disabled={!buildId} busy={manual.isPending} onClick={() => manual.mutate()}>核验手动启动路径</Button>
      {manual.isError && <p role="alert" className="text-sm text-danger">启动路径不可用：{String(manual.error)}</p>}
      {manual.data?.buildId === buildId && <div className="space-y-2 text-sm"><p>已核验构建 {manual.data.buildId}；尚未启动或应用。</p><p className="break-all text-xs">产物 {manual.data.artifactRevision}</p><pre className="whitespace-pre-wrap break-all text-xs">{commandText(manual.data.manual.executable, manual.data.manual.args)}</pre><p>在终端明确运行此命令后，请连接新服务并核对其实际构建。此命令不改变 PATH 或全局安装。</p></div>}
    </section>}
    {observed?.switchSupported && !pending && <div className="space-y-3">
      <label className="block text-sm">已记录通过的独立验证<Select disabled={preview.isPending} className="mt-2 block w-full" aria-label="切换目标验证" value={validationId} onChange={event => { setValidationId(event.target.value); preview.reset(); setConsent(false); }}>
        <option value="">选择验证记录</option>{validations.map(task => <option key={task.id} value={task.id}>{task.id} · {task.buildId}</option>)}
      </Select></label>
      <p className="text-xs text-muted">预览时重新校验源码、产物、协议和存储。历史通过不会跳过准入。</p>
      <Button ref={reviewRef} variant="outline" disabled={!validationId || blocked} busy={preview.isPending} onClick={() => preview.mutate()}>审阅版本切换计划</Button>
    </div>}
    {preview.isError && <p role="alert" className="break-words text-sm text-danger">计划不可用：{String(preview.error)}</p>}
    {send.isError && <p role="alert" className="break-words text-sm text-danger">切换请求未确认：{String(send.error)}。不会自动重发，请先读取回执。</p>}
    {pending && <section aria-label="切换结果" className="space-y-3 rounded-lg border border-line p-3 text-sm">
      <h3 className="font-semibold">{confirmedRunning ? '已确认运行目标构建' : result?.status === 'failed' ? '切换失败' : result?.status === 'unknown' ? '切换结果未知' : result?.status === 'applied' ? '已有成功回执，当前运行版本尚未匹配' : send.isPending ? '切换请求正在处理' : '尚未取得切换终态'}</h3>
      <dl className="space-y-1 break-all text-xs"><dt>确认命令</dt><dd>{pending.request.commandId}</dd><dt>安装</dt><dd>{pending.installationId}</dd><dt>目标构建</dt><dd>{pending.expectedBuild}</dd><dt>产物摘要</dt><dd>{pending.request.artifactRevision}</dd><dt>计划摘要</dt><dd>{pending.request.planHash}</dd><dt>回执记录的实际构建</dt><dd>{result?.actualBuild ?? '尚未确认'}</dd></dl>
      {result?.error && <p className="break-words text-warning">{result.error}</p>}
      {receipt.isError && <p role="alert" className="break-words text-warning">回执暂不可读：{String(receipt.error)}</p>}
      {!sameInstallation && observed && <p className="text-warning">当前安装与保存的确认不匹配，不能在此重发。</p>}
      <p className="text-xs text-muted">查询只读取同一命令回执；历史成功不代表此刻仍运行该版本。结果未知时不自动重跑候选或业务任务。</p>
      <Button variant="outline" busy={receipt.isFetching} onClick={() => { void receipt.refetch(); void status.refetch(); }}>重新读取切换结果</Button>
      {!result && <Button variant="outline" disabled={send.isPending || blocked || !sameInstallation} onClick={() => send.mutate(pending)}>重试同一切换命令</Button>}
      {(terminal || rejected) && <Button variant="outline" disabled={send.isPending || observed?.phase === 'switching'} onClick={() => { forgetSwitch(pending); setPending(undefined); send.reset(); preview.reset(); setValidationId(''); }}>审阅另一次切换</Button>}
      <p className="text-xs">服务无法恢复连接时，打开顶栏“设置 → 版本与恢复”读取恢复记录与启动终端操作指引。</p>
    </section>}
    <DialogRoot open={open} onOpenChange={value => { setOpen(value); if (!value) setConsent(false); }}>
      <DialogContent className="max-h-[85dvh] w-[min(760px,calc(100vw-32px))] overflow-auto" onOpenAutoFocus={event => { event.preventDefault(); cancelRef.current?.focus(); }} onCloseAutoFocus={event => { event.preventDefault(); (reviewRef.current ?? regionRef.current)?.focus(); }}>
        <DialogTitle>确认切换核心运行版本</DialogTitle><DialogDescription>停止当前空闲的托管 Web 进程，并在相同地址启动已验证候选。不会迁移活动工具或修改全局安装。</DialogDescription>
        {plan && <div className="mt-4 space-y-3"><dl className="space-y-1 break-all text-xs">
          <dt>当前构建</dt><dd>{plan.from.identity.build}</dd><dt>目标构建</dt><dd>{plan.candidate.build}</dd><dt>目标候选</dt><dd>{plan.candidate.candidateId}</dd><dt>验证记录</dt><dd>{plan.candidate.validationId}</dd><dt>产物摘要</dt><dd>{plan.candidate.artifactRevision}</dd><dt>候选目录</dt><dd>{plan.candidate.directory}</dd><dt>受影响工作目录</dt><dd>{plan.impact.workspace}</dd><dt>受影响数据目录</dt><dd>{plan.impact.home}</dd><dt>协议</dt><dd>API {plan.contracts.api} / SDK {plan.contracts.sdk} / 数据 {plan.contracts.data}</dd><dt>计划摘要</dt><dd>{plan.planHash}</dd>
        </dl><p className="text-sm">健康检查失败时，只有清理和存储兼容性均确认后才恢复保留版本；否则进入只读恢复，不抹除数据。</p>
        <Blockers status={observed} />
        {observed?.identity?.build !== plan.from.identity.build && <p role="alert" className="text-warning">当前运行构建已变化，关闭后重新审阅计划。</p>}
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={consent} onChange={event => setConsent(event.target.checked)} />我已核对目标构建、产物摘要和影响目录，授权本次切换</label></div>}
        <DialogActions><Button variant="destructive" disabled={!consent || blocked || observed?.identity?.build !== plan?.from.identity.build || send.isPending} onClick={confirm}>确认切换核心版本</Button><DialogClose asChild><Button variant="outline" ref={cancelRef}>取消切换</Button></DialogClose></DialogActions>
      </DialogContent>
    </DialogRoot>
  </section>;
}
