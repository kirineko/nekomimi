import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '../../ui/Button';
import { Input } from '../../ui/Input';
import { EmptyState, ErrorState } from '../../ui/StateCard';
import { createKey, useCustomization, type CandidateView } from '../state/create';
import { ManagementConfirm } from './management-confirm';

export function CandidateManagement({ candidate, sessionId }: { candidate: CandidateView; sessionId?: string }) {
  const query = useCustomization(sessionId), client = useQueryClient(), [output, setOutput] = useState(`${candidate.name}.tgz`);
  if (query.isPending) return <EmptyState title="正在读取候选管理状态…" busy />;
  if (!query.data) return <ErrorState title="候选管理状态不可读" detail={String(query.error)} actions={<Button onClick={() => void query.refetch()}>刷新候选管理状态</Button>} />;
  const data = query.data, pending = data.receipts.some(receipt => receipt.status === 'pending');
  const managed = data.managed.find(item => item.name === candidate.name), active = data.activeResources.find(item => item.id === candidate.resourceId);
  const validated = candidate.evidence.slice().reverse().find(item => item.stage === 'static')?.passed === true;
  const stale = data.managedRevision !== candidate.activeRevision, locked = !sessionId || pending || data.busy || stale;
  return <section aria-label="候选启用与导出" className="space-y-4 rounded-xl border border-line p-4">
    <h2 className="text-base font-semibold">候选启用与导出</h2>
    <Button variant="outline" onClick={() => void client.invalidateQueries({ queryKey: createKey(sessionId) })}>刷新候选状态</Button>
    <p className="break-all text-xs">目标目录 {candidate.target?.root ?? candidate.path}</p>
    <p className="break-all text-xs">已选择版本 {managed?.revision ?? '无'}；已加载版本 {active?.hash ?? '无'}</p>
    <p className="text-sm">启用只作用于当前开发目标。交付到工作会话后仍需另行审阅，不会自动安装到工作项目。</p>
    {!sessionId && <p className="text-warning">请从绑定的创造目标进入管理。</p>}
    {!validated && <p className="text-sm">请先在「验证记录」运行当前内容的静态校验。</p>}
    {stale && <p role="status" className="text-warning">已选择版本发生变化，请刷新后重新审阅。</p>}
    {query.isError && <p role="alert" className="text-danger">状态刷新失败：{String(query.error)}</p>}
    <ManagementConfirm label="授权并启用候选" sessionId={sessionId} disabled={locked || !validated} description="确认运行此版本的本地扩展代码并授权其全部声明能力。静态校验通过不代表实际加载或宿主验收通过。" review={() => ({ request: { action: 'candidate-activate', id: candidate.id, contentHash: candidate.contentHash, revision: data.settingsRevision, activeRevision: candidate.activeRevision, authorize: true }, detail: <><p>{candidate.name} · {candidate.contentHash}</p><p>目标 {candidate.target?.root}</p><p>请求权限 {candidate.requestedCapabilities.join('、') || '无'}</p><p>新增权限 {candidate.addedCapabilities.join('、') || '无'}</p></> })} />
    {candidate.rollbackError && <p role="alert" className="text-danger">{candidate.rollbackError}</p>}
    {candidate.rollback && <ManagementConfirm label="回退候选版本" sessionId={sessionId} dangerous disabled={locked} description="确认重新加载此前版本及其声明权限；回退不会撤销该版本曾执行的外部操作。" review={() => ({ request: { action: 'candidate-rollback', name: candidate.name, revision: data.settingsRevision, contentHash: candidate.rollback!.contentHash, activeRevision: candidate.activeRevision, authorize: true }, detail: <><p>目标 {candidate.target?.root}</p><p>回退版本 {candidate.rollback!.contentHash}</p><p>请求权限 {candidate.rollback!.requestedCapabilities.join('、') || '无'}</p></> })} />}
    <div className="space-y-2 border-t border-line pt-3"><label className="block text-sm">导出文件路径<Input aria-label="候选导出文件路径" value={output} onChange={event => setOutput(event.target.value)} /></label><p className="text-xs text-muted">写入当前开发目标范围的新文件；不覆盖已有文件，不执行扩展工厂。</p><ManagementConfirm label="导出候选归档" sessionId={sessionId} disabled={!sessionId || !output.trim()} description="按此内容摘要静态检查并导出候选。导出不启用资源。" review={() => ({ request: { action: 'candidate-export', id: candidate.id, contentHash: candidate.contentHash, output: output.trim() }, detail: <><p>开发目标 {candidate.target?.root}</p><p>导出路径 {output.trim()}</p><p>版本 {candidate.contentHash}</p></> })} /></div>
    <section aria-label="候选加载收据" className="break-all text-xs"><h3>加载收据</h3>{!data.receipts.length && <p>尚无加载记录。</p>}{data.receipts.slice(-10).map(receipt => <p key={receipt.id}>{receipt.id} · {receipt.status === 'pending' ? '等待加载完成' : receipt.status === 'activated' ? '加载完成' : receipt.status === 'failed' ? '加载失败' : receipt.status}{receipt.error && ` · ${receipt.error}`}</p>)}</section>
  </section>;
}
