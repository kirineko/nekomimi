import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { api } from '../../api';
import { Button } from '../../ui/Button';
import { Input, Select } from '../../ui/Input';
import { EmptyState, ErrorState } from '../../ui/StateCard';
import { useCustomization, type CustomizationDescribe } from '../state/create';
import { ManagementConfirm } from './management-confirm';
type Scope = 'project' | 'user';
interface Preview {
  candidate: { id: string; scope: Scope; revision: string; manifest: { name: string; version: string } };
  activeRevision: number; passed: boolean; permissions: string[]; addedPermissions: string[]; changedFiles: number;
  checks: { diagnostics: { file?: string; line?: number; message: string }[] }[];
  files: { name: string; preview?: string }[];
}
function PackageReview({ label, id, scope, rollback, sessionId, busy }: { label: string; id: string; scope: Scope; rollback?: boolean; sessionId?: string; busy: boolean }) {
  const inspect = useMutation({ mutationFn: () => api<Preview>('/customization', { action: rollback ? 'package-rollback-inspect' : 'package-inspect', id, scope, sessionId }) });
  const preview = inspect.data;
  return <div className="space-y-3">
    <Button variant="outline" disabled={!sessionId || busy} busy={inspect.isPending} onClick={() => inspect.mutate()}>{label}</Button>
    {inspect.isError && <p role="alert" className="break-all text-sm text-danger">检查失败：{inspect.error.message}</p>}
    {preview && <section aria-label={`能力包审阅 ${preview.candidate.manifest.name}`} className="space-y-3 rounded-lg border border-line p-3">
      <h3 className="break-all text-base">{preview.candidate.manifest.name} · {preview.candidate.manifest.version}</h3>
      <p className="text-sm">{preview.passed ? '静态检查通过' : '静态检查未通过'}；{preview.candidate.scope === 'user' ? '用户范围，可能影响多个项目' : '当前开发项目'}</p>
      <p className="break-all text-xs">审阅版本 {preview.candidate.revision}</p><p className="break-all text-xs">全部授权范围：{preview.permissions.join('、') || '无'}</p><p className="break-all text-xs">新增授权：{preview.addedPermissions.join('、') || '无'}</p>
      {preview.checks.flatMap(check => check.diagnostics).map((item,index) => <p key={index} role="alert" className="break-all text-xs">{item.file}:{item.line} {item.message}</p>)}
      <details className="text-xs"><summary>变更文件（{preview.changedFiles}）</summary><p>最多预览 64 个文件，每个文本最多 4000 字符。</p>{preview.files.map(file => <details key={file.name}><summary className="break-all">{file.name}</summary><pre className="whitespace-pre-wrap break-all">{file.preview ?? '删除或非文本内容'}</pre></details>)}</details>
      <ManagementConfirm label={rollback ? '授权并回退能力包' : '授权并安装能力包'} sessionId={sessionId} disabled={busy || !preview.passed} description="确认按此摘要加载能力包及其声明权限；本地代码具有本机权限。检查通过不等于加载或宿主验收通过。" review={() => ({ request: { action: rollback ? 'package-rollback' : 'package-activate', id: rollback ? id : preview.candidate.id, scope: preview.candidate.scope, contentHash: preview.candidate.revision, activeRevision: preview.activeRevision, authorize: true }, detail: <><p>{preview.candidate.manifest.name} · {preview.candidate.revision}</p><p>范围 {preview.candidate.scope === 'user' ? '用户范围' : '当前开发项目'}</p><p>权限 {preview.permissions.join('、') || '无'}</p><p>安装修订 {preview.activeRevision}</p></> })} />
      <Button variant="ghost" onClick={() => inspect.reset()}>关闭能力包审阅</Button>
    </section>}
  </div>;
}
function InstalledPackage({ pkg, data, sessionId }: { pkg: CustomizationDescribe['packages'][number]; data: CustomizationDescribe; sessionId?: string }) {
  const [output, setOutput] = useState(`${pkg.manifest.name.replace(/[^a-zA-Z0-9_-]/g, '_')}-${pkg.revision.slice(0,12)}.tgz`);
  const busy = data.busy || data.receipts.some(receipt => receipt.status === 'pending');
  return <article aria-label={`已安装能力包 ${pkg.manifest.name}`} className="space-y-3 rounded-xl border border-line p-4"><h2 className="break-all text-base font-semibold">{pkg.manifest.name} · {pkg.manifest.version}</h2><p className="break-all text-xs">{pkg.scope === 'user' ? '用户范围' : '项目范围'} · {pkg.revision}</p>
    {pkg.previous && <PackageReview label="检查回退版本" id={pkg.packageId} scope={pkg.scope} rollback sessionId={sessionId} busy={busy} />}
    <details className="space-y-3 text-sm"><summary>导出与卸载</summary><label className="block">能力包导出路径<Input aria-label={`能力包导出路径 ${pkg.manifest.name}`} value={output} onChange={event => setOutput(event.target.value)} /></label>
      <ManagementConfirm label="导出能力包" sessionId={sessionId} disabled={!sessionId || !output.trim()} description="将审阅版本导出到当前开发工作区，不包含授权、凭证、目标绑定与运行状态；已有文件不会覆盖。" review={() => ({ request: { action: 'package-export', id: pkg.packageId, scope: pkg.scope, contentHash: pkg.revision, output: output.trim() }, detail: <><p>{pkg.manifest.name} · {pkg.revision}</p><p>输出 {output.trim()}</p></> })} />
      <ManagementConfirm label="卸载能力包" dangerous sessionId={sessionId} disabled={!sessionId || busy} description="撤销此安装版本并移除其可用能力。历史记录保留，已发生的外部操作不会撤销。" review={() => ({ request: { action: 'package-uninstall', id: pkg.packageId, scope: pkg.scope, contentHash: pkg.revision, activeRevision: data.packageRevisions[pkg.scope] }, detail: <><p>{pkg.manifest.name} · {pkg.revision}</p><p>范围 {pkg.scope === 'user' ? '用户范围，影响其他项目' : '当前开发项目'}</p></> })} />
    </details>
  </article>;
}
export function PackageManagementPage({ sessionId }: { sessionId?: string }) {
  const query = useCustomization(sessionId), [scope, setScope] = useState<Scope>('project'), [discard, setDiscard] = useState<string[]>([]);
  if (query.isPending) return <EmptyState title="正在读取能力包…" busy />;
  if (!query.data) return <ErrorState title="能力包目录不可读" detail={String(query.error)} actions={<Button onClick={() => void query.refetch()}>重新读取能力包</Button>} />;
  const data = query.data, busy = data.busy || data.receipts.some(receipt => receipt.status === 'pending');
  return <div className="min-w-0"><header className="sticky top-0 z-10 space-y-3 bg-background pb-3"><h1 className="text-xl">能力包管理</h1><div className="flex flex-wrap gap-3"><Button variant="outline" onClick={() => void query.refetch()}>刷新能力包目录</Button>{!sessionId && <Link className="text-sm underline" to="/create">选择创造目标</Link>}</div></header>
    {!sessionId && <p className="mb-3 text-sm">检查、安装及其他管理操作需进入绑定的创造目标。</p>}{query.isError && <p role="alert">刷新失败：{String(query.error)}</p>}
    <section aria-label="能力包候选" className="space-y-3"><h2 className="text-base">待审阅候选</h2>{!data.packageCandidates.length && <EmptyState title="暂无能力包候选" detail="在创造目标中准备能力包后，其候选会显示在这里。" />}{data.packageCandidates.map(candidate => <article key={`${candidate.scope}:${candidate.id}`} className="space-y-2 rounded-xl border border-line p-4"><p className="break-all text-sm">{candidate.name} · {candidate.scope === 'user' ? '用户范围' : '项目范围'}</p><p className="break-all text-xs">{candidate.revision}</p><PackageReview label="检查能力包候选" id={candidate.id} scope={candidate.scope} sessionId={sessionId} busy={busy} /></article>)}</section>
    <section aria-label="已安装能力包" className="my-4 space-y-3"><h2 className="text-base">已安装能力包</h2>{!data.packages.length && <EmptyState title="尚未安装能力包" />}{data.packages.map(pkg => <InstalledPackage key={pkg.packageId} pkg={pkg} data={data} sessionId={sessionId} />)}</section>
    <details className="my-4 space-y-3 rounded-lg border border-line p-3 text-sm"><summary>清理未引用能力包缓存</summary><p>已安装、回退、候选以及历史/工作流引用均保留。勾选候选仅请求丢弃，实际保留由服务端引用检查决定。</p><Select aria-label="能力包清理范围" value={scope} onChange={event => { setScope(event.target.value as Scope); setDiscard([]); }}><option value="project">当前项目</option><option value="user">用户范围</option></Select>{data.packageCandidates.filter(candidate => candidate.scope === scope).map(candidate => <label key={candidate.id} className="block break-all"><input type="checkbox" checked={discard.includes(candidate.id)} onChange={event => setDiscard(previous => event.target.checked ? [...previous,candidate.id] : previous.filter(id => id !== candidate.id))} />请求丢弃 {candidate.name} · {candidate.revision.slice(0,12)}</label>)}<ManagementConfirm label="清理能力包缓存" sessionId={sessionId} dangerous disabled={!sessionId || busy} description="仅删除服务端确认无引用的内容；存在历史或运行引用的内容不会删除。" review={() => ({ request: { action: 'package-collect', scope, discardCandidates: discard }, detail: <><p>范围 {scope}</p><p>请求丢弃候选 {discard.join('、') || '无'}</p></> })} /></details>
    <section aria-label="能力包加载记录" className="break-all text-xs"><h2>加载记录</h2>{data.receipts.slice(-10).map(receipt => <p key={receipt.id}>{receipt.id} · {receipt.status}{receipt.error && ` · ${receipt.error}`}</p>)}</section>
  </div>;
}
