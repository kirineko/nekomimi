import { useState, type ReactNode } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, ClientError } from '../../api';
import { Button } from '../../ui/Button';
import { DialogRoot, DialogTrigger, DialogContent, DialogTitle, DialogDescription, DialogActions, DialogClose } from '../../ui/Dialog';
import { createKey } from '../state/create';
import { modelsKey } from '../state/models';

interface Review { request: Record<string, unknown>; detail: ReactNode }
export interface ManagementResult { status?: string; id?: string; path?: string; contentHash?: string; revision?: string; removed?: string[]; removedCandidates?: string[]; retained?: string[]; authorizationUrl?: string; expiresAt?: number; error?: string; errors?: string[]; report?: { passed: boolean; diagnostics: { message: string }[] } }
/** Capture the reviewed version at opening; query refresh must not silently change consent. */
export function ManagementConfirm({ label, description, review, sessionId, disabled, dangerous = false, onResult }: {
  label: string; description: string; review: () => Review; sessionId?: string; disabled?: boolean; dangerous?: boolean;
  onResult?: (result: ManagementResult) => void;
}) {
  const client = useQueryClient(), [open, setOpen] = useState(false), [snapshot, setSnapshot] = useState<Review & { label: string; description: string }>();
  const [receipt, setReceipt] = useState<string>();
  const save = useMutation({ mutationFn: () => {
    if (!snapshot) throw new Error('请重新审阅操作');
    return api<ManagementResult>('/customization', { ...snapshot.request, sessionId });
  }, onSuccess: result => {
    const failures = [...(result.errors ?? []), ...(result.report?.diagnostics.map(item => item.message) ?? [])];
    setReceipt(result.removed ? `清理完成：删除内容 ${result.removed.length}，删除候选 ${result.removedCandidates?.length ?? 0}，保留版本 ${result.retained?.length ?? 0}` : result.path ? `已导出：${result.path} · ${result.contentHash ?? result.revision ?? ''}` : result.report ? `静态校验${result.report.passed && !failures.length ? '通过' : '未通过'}${failures.length ? '：' + failures.join('；') : ''}` : `操作收据：${result.status ?? '已返回'}${result.id ? ' · ' + result.id : ''}${result.error ? ' · ' + result.error : ''}`);
    setOpen(false);
    onResult?.(result);
  }, onSettled: async (_result, error) => {
    // Keep failed candidate consent mounted until the user can read and dismiss it.
    // Refresh permissions immediately; content refresh remains an explicit action after failure.
    await Promise.all([client.invalidateQueries({ queryKey: error ? createKey(sessionId, 'customization') : createKey(sessionId) }), client.invalidateQueries({ queryKey: modelsKey(sessionId) })]);
  } });
  return <div className="min-w-0">
    <DialogRoot open={open} onOpenChange={value => { if (!save.isPending) setOpen(value); }}>
      <DialogTrigger asChild><Button variant={dangerous ? 'destructive' : 'outline'} size="sm" disabled={disabled || save.isPending} onClick={() => { setSnapshot({ ...review(), label, description }); setReceipt(undefined); save.reset(); setOpen(true); }}>{label}</Button></DialogTrigger>
      <DialogContent className="max-h-[85dvh] overflow-auto break-words"><DialogTitle>{snapshot?.label}</DialogTitle><DialogDescription>{snapshot?.description}</DialogDescription>
        <div className="mt-3 space-y-2 break-all text-sm">{snapshot?.detail}</div>
        {save.isError && <p role="alert" className="mt-3 text-sm text-danger">操作未确认：{save.error instanceof ClientError && save.error.code === 'resource_settings_conflict' ? '授权修订已变化' : save.error instanceof ClientError && save.error.code === 'provider_migration_conflict' ? '迁移配置修订已变化或已完成迁移' : save.error instanceof ClientError && ['candidate_revision_conflict', 'package_revision_conflict'].includes(save.error.code) ? '候选或已选择版本已变化' : save.error.message}。请关闭后重新读取并审阅；不会自动重试。</p>}
        <DialogActions><DialogClose asChild><Button variant="outline" disabled={save.isPending}>取消操作</Button></DialogClose><Button variant={dangerous ? 'destructive' : 'default'} disabled={save.isError} busy={save.isPending} onClick={() => save.mutate()}>确认{snapshot?.label}</Button></DialogActions>
      </DialogContent>
    </DialogRoot>
    {receipt && <p role="status" className="mt-2 break-all text-xs">{receipt}</p>}
  </div>;
}
