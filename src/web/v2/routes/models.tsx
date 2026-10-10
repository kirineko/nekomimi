import { ModelAdvanced } from './model-advanced';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import type { ModelManagement, ModelPurpose, ModelProfile } from '../../../shared/model-management';
import { api } from '../../api';
import { Badge } from '../../ui/Badge';
import { Button } from '../../ui/Button';
import { Select } from '../../ui/Input';
import { DialogRoot, DialogTrigger, DialogContent, DialogTitle, DialogDescription, DialogActions, DialogClose } from '../../ui/Dialog';
import { EmptyState, ErrorState } from '../../ui/StateCard';
import { modelsKey } from '../state/models';
import { ModelProfileEditor } from './model-profile-editor';
const purposes: Array<[ModelPurpose, string]> = [['work','工作对话'],['create','创造对话'],['auxiliary','辅助调用'],['session-title','自动命名'],['compaction','上下文压缩'],['handoff','交接摘要'],['classifier','分类'],['image','图片']];
export const unavailableText: Record<string, string> = { 'credential-not-configured': '未配置凭证', 'profile-not-configured': '未配置模型', 'resource-unavailable': 'Provider 资源不可用', 'unsupported-operation-protocol': '当前协议不支持此操作', 'model-not-discovered': '目录中无法核验此模型' };
const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);
function stateFor(data: ModelManagement, profile: ModelProfile) {
  return data.providers.find(provider => provider.id === profile.providerId && (provider.resourceId ?? 'builtin:deepseek') === profile.resourceId)?.models.find(model => model.id === profile.model && model.operation === (profile.operation ?? 'chat'))?.profileStates.find(state => state.id === profile.id);
}
function purposeLabel(data: ModelManagement, purpose: ModelPurpose) {
  const fallback = ['work','create','compaction','handoff'].includes(purpose) ? 'main' : purpose === 'session-title' ? 'naming' : undefined;
  const selected = data.providerProfiles.selection[purpose] ?? (fallback ? data.providerProfiles.selection[fallback as ModelPurpose] : undefined);
  if (selected) {
    const profile = data.providerProfiles.entries[selected], state = profile && stateFor(data, profile);
    return `${profile ? `${profile.providerId} / ${profile.model} · ${profile.id}` : `缺失配置 ${selected}`} · ${state?.available ? '可用' : unavailableText[state?.unavailableReason ?? 'model-not-discovered']}${data.providerProfiles.selection[purpose] ? '' : '（继承默认用途）'}`;
  }
  if (purpose === 'image' || purpose === 'classifier') return '未选择配置，不能运行';
  return `默认 DeepSeek / ${data.defaultModel.model} · ${data.defaultModel.configured ? '已配置' : '未配置凭证'} · Responses`;
}
function PurposeChoice({ data, purpose, label, sessionId }: { data: ModelManagement; purpose: ModelPurpose; label: string; sessionId?: string }) {
  const client = useQueryClient(), [open, setOpen] = useState(false), [selected, setSelected] = useState('');
  const [revision, setRevision] = useState(data.providerProfiles.revision);
  const operation = purpose === 'classifier' || purpose === 'image' ? purpose : 'chat';
  const save = useMutation({ mutationFn: () => api<ModelManagement["providerProfiles"]>('/customization', { action: 'provider-select', sessionId, purpose, id: selected, revision }),
    onSuccess: profiles => { client.setQueryData<ModelManagement>(modelsKey(sessionId), previous => previous ? { ...previous, providerProfiles: profiles } : previous); setOpen(false); }, onSettled: () => client.invalidateQueries({ queryKey: modelsKey(sessionId) }) });
  return <article className="space-y-2 rounded-lg border border-line p-3"><h2 className="text-sm font-semibold">{label}</h2><p className="break-all text-xs">{purposeLabel(data, purpose)}</p>
    <DialogRoot open={open} onOpenChange={value => { if (!save.isPending) setOpen(value); }}><DialogTrigger asChild><Button size="sm" variant="outline" disabled={save.isPending} onClick={() => { setSelected(data.providerProfiles.selection[purpose] ?? ''); setRevision(data.providerProfiles.revision); save.reset(); setOpen(true); }}>选择{label}模型</Button></DialogTrigger>
      <DialogContent><DialogTitle>选择{label}模型</DialogTitle><DialogDescription>确认只改变{label}用途。缺少凭证或 Provider 的配置不能执行，保存选择不会发起模型请求。</DialogDescription>
        <label className="mt-3 block text-sm">配置<Select aria-label={`${label}模型配置`} value={selected} onChange={event => setSelected(event.target.value)} disabled={save.isPending}><option value="">默认配置</option>{Object.values(data.providerProfiles.entries).filter(profile => (profile.operation ?? 'chat') === operation).map(profile => { const state = stateFor(data, profile); return <option key={profile.id} value={profile.id}>{profile.id} · {profile.providerId}/{profile.model} · {state?.available ? '可用' : unavailableText[state?.unavailableReason ?? 'model-not-discovered']}</option>; })}</Select></label>
        {save.isError && <p role="alert" className="mt-3 text-sm text-danger">保存失败：{errorText(save.error)}。请关闭后重新审阅最新配置；不会自动重试。</p>}
        <DialogActions><Button busy={save.isPending} disabled={save.isError} onClick={() => save.mutate()}>确认用途选择</Button><DialogClose asChild><Button variant="outline" disabled={save.isPending}>取消选择</Button></DialogClose></DialogActions>
      </DialogContent>
    </DialogRoot>
  </article>;
}
export function ModelsPage({ sessionId, mode = 'work' }: { sessionId?: string; mode?: 'work' | 'create' }) {
  const query = useQuery({ queryKey: modelsKey(sessionId), retry: false, queryFn: ({ signal }) => api<ModelManagement>('/customization' + (sessionId ? '?session=' + encodeURIComponent(sessionId) : ''), undefined, signal) });
  const [editing, setEditing] = useState(false);
  if (query.isPending) return <EmptyState title="正在读取模型配置…" busy />;
  if (!query.data) return <ErrorState title="模型配置不可读" detail={errorText(query.error)} actions={<Button onClick={() => void query.refetch()}>重新读取模型配置</Button>} />;
  return <div className="min-w-0"><header className="sticky top-0 z-10 space-y-2 bg-background pb-3"><h1 className="text-xl">模型用途与配置</h1><p className="text-xs text-muted">配置保存在用户范围；每个用途单独确认。目录可见不等于可执行。</p><div className="flex flex-wrap gap-2"><Link className="text-sm underline" to={mode === 'create' ? '/create/settings' : '/work/settings'}>基础设置与默认凭证</Link><Button variant="outline" onClick={() => void query.refetch()}>刷新模型目录</Button><Button disabled={editing} onClick={() => setEditing(true)}>新增模型配置</Button>{sessionId && mode === 'create' ? <Link className="text-sm underline" to="/create/session/$sessionId/resources" params={{ sessionId }}>前往能力目录</Link> : <Link className="text-sm underline" to="/create/resources">前往能力目录</Link>}</div></header>
    {query.isError && <p role="alert">目录刷新失败，保留当前草稿和上次确认的快照：{errorText(query.error)}</p>}
    <section aria-label="模型用途" className="grid gap-3 xl:grid-cols-2">{purposes.map(([purpose,label]) => <PurposeChoice key={purpose} data={query.data} purpose={purpose} label={label} sessionId={sessionId} />)}</section>
    {editing && <ModelProfileEditor data={query.data} sessionId={sessionId} close={() => setEditing(false)} />}
    <section aria-label="已保存模型配置" className="my-4 space-y-2"><h2 className="text-base font-semibold">已保存模型配置</h2>{Object.values(query.data.providerProfiles.entries).length === 0 && <p className="text-xs">尚无自定义配置。</p>}{Object.values(query.data.providerProfiles.entries).map(profile => <article key={profile.id} className="rounded-lg border border-line p-3"><p className="break-all text-sm">{profile.id} · {profile.providerId} / {profile.model} · {profile.operation ?? 'chat'}</p><details className="text-xs"><summary>端点授权范围</summary><p className="break-all">{profile.baseUrl} · {profile.paths.join('、')}</p></details></article>)}</section>
    <ModelAdvanced data={query.data} sessionId={sessionId} />
    <section aria-label="模型能力目录" className="mt-5 space-y-3"><h2 className="text-base font-semibold">可发现模型</h2>{query.data.providers.flatMap(provider => provider.models.map(model => <article key={model.identity} className="rounded-lg border border-line p-3"><h3 className="break-all text-sm">{provider.id} / {model.name} · {model.operation}</h3><p className="break-all text-xs">{model.id} · {model.protocol}</p><Badge state={model.available ? 'ok' : 'warning'}>{model.available ? '可用' : unavailableText[model.unavailableReason ?? ''] ?? '不可用'}</Badge><p className="text-xs">凭证：{model.credentialStatus === 'configured' ? '已配置' : model.credentialStatus === 'missing' ? '未配置' : '无需凭证'}</p></article>))}</section>
  </div>;
}
