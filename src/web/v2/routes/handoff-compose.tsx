import { HandoffSummary } from './handoff-summary';
import { HandoffRecovery } from './handoff-recovery';
import type { HandoffStatesView } from '../../../shared/handoff-view';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useRef, useState } from 'react';
import type { HandoffDraft, HandoffPreview, HandoffReceipt, SessionMode, SessionPage } from '../../../shared/protocol';
import { api } from '../../api';
import { Button } from '../../ui/Button';
import { Input, Select, Textarea } from '../../ui/Input';
import { useDraft } from '../state/drafts';
import { v2Host, v2Key } from '../state/query';
import type { CandidateView } from '../state/create';
interface Fields { goal: string; constraints: string; summary: string; target: string; title: string; root: string; kind: 'extension' | 'core'; references: NonNullable<HandoffDraft['references']>; usage: string; deliver: boolean }
const defaults: Fields = { goal: '', constraints: '', summary: '', target: '', title: '', root: '', kind: 'extension', references: [], usage: '', deliver: false };
const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);
export function HandoffCompose({ sessionId, mode, candidate, initiallyOpen = false, onClose }: { sessionId: string; mode: SessionMode; candidate?: CandidateView; initiallyOpen?: boolean; onClose?: () => void }) {
  const client = useQueryClient(), stored = useDraft(mode, `handoff:${candidate?.id ?? 'session'}`, sessionId);
  let fields: Fields; try { fields = { ...defaults, ...JSON.parse(stored.value || '{}') }; } catch { fields = defaults; }
  const [open, setOpen] = useState(initiallyOpen), [review, setReview] = useState<{ preview: HandoffPreview; draft: HandoffDraft; commandId: string }>(), [confirmed, setConfirmed] = useState(false);
  const latest = useRef(stored.value); latest.current = stored.value;
  const generation = useRef(0), creationId = useRef(crypto.randomUUID());
  const update = (patch: Partial<Fields>) => { generation.current++; if (['target', 'title', 'root', 'kind'].some(key => key in patch)) creationId.current = crypto.randomUUID(); send.reset(); setReview(undefined); setConfirmed(false); stored.set(JSON.stringify({ ...fields, ...patch })); };
  const targetMode = mode === 'work' ? 'create' : 'work';
  const sessions = useQuery({ queryKey: v2Key(v2Host(), mode, 'handoff', sessionId, 'targets', targetMode), enabled: open,
    queryFn: ({ signal }) => api<SessionPage>(`/sessions?limit=100&mode=${targetMode}`, undefined, signal) });
  const references = useQuery({ queryKey: v2Key(v2Host(), mode, 'handoff', sessionId, 'references'), enabled: open, retry: false,
    queryFn: ({ signal }) => api<{ omitted: number; items: Array<{ sessionId: string; eventId: string; payloadHash: string; type: string; excerpt: string }> }>(`/sessions/${sessionId}/handoff-references`, undefined, signal) });
  const preview = useMutation({ mutationFn: async () => {
    const revision = generation.current, text = stored.value;
    const target: HandoffDraft['target'] = fields.target === 'new' ? { title: fields.title.trim(), creation: { commandId: creationId.current, mode: targetMode, ...(targetMode === 'create' ? { target: { kind: fields.kind, root: fields.root.trim(), scope: 'project' } } : {}) } } : { sessionId: fields.target };
    const draft: HandoffDraft = { version: 1, target, goal: fields.goal, summary: fields.summary, constraints: fields.constraints.split('\n').map(value => value.trim()).filter(Boolean), references: fields.references,
      ...(candidate && fields.deliver ? { delivery: [{ candidateId: candidate.id, resourceId: candidate.resourceId, revision: candidate.contentHash, usage: fields.usage }] } : {}) };
    return { preview: await api<HandoffPreview>(`/sessions/${sessionId}/handoff-preview`, draft), draft, text, revision };
  }, onSuccess: value => { if (value.revision === generation.current && value.text === latest.current) { send.reset(); setReview({ preview: value.preview, draft: value.draft, commandId: crypto.randomUUID() }); setConfirmed(false); } } });
  const send = useMutation({ mutationFn: async (value: NonNullable<typeof review>) => api<HandoffReceipt>(`/sessions/${sessionId}/handoff-confirm`, { version: 1, confirmed: true, commandId: value.commandId, payloadHash: value.preview.payloadHash, draft: value.draft }),
    onSuccess: () => { setConfirmed(false); void client.invalidateQueries({ queryKey: ['v2', v2Host()] }); } });
  const close = () => { generation.current++; setOpen(false); setReview(undefined); setConfirmed(false); if (initiallyOpen) onClose?.(); };
  return <section aria-label="发起交接" className={initiallyOpen ? "space-y-3" : "my-4 space-y-3 rounded-lg border border-line p-3"}>
    {!initiallyOpen && <Button variant="outline" onClick={() => setOpen(true)}>{candidate ? '交付此候选' : mode === 'work' ? '交接到创造会话' : '交接到工作会话'}</Button>}
    {candidate && <CandidateHandoffStates sessionId={sessionId} mode={mode} />}
    {open && <form className="space-y-3" onSubmit={event => { event.preventDefault(); if (!preview.isPending && !send.isPending) preview.mutate(); }}>
      <fieldset disabled={send.isPending} className="space-y-3">
      <p className="text-sm">预览只检查目标和选定内容。确认后仅记录交接，目标任务由你另行提交。</p>
      <label className="block text-sm">交接目的<Textarea required aria-label="交接目的" value={fields.goal} onChange={event => update({ goal: event.target.value })} /></label>
      <label className="block text-sm">目标会话<Select aria-label="交接目标会话" value={fields.target} onChange={event => update({ target: event.target.value })}><option value="">请选择</option><option value="new">新建独立{targetMode === 'create' ? '创造' : '工作'}会话</option>{sessions.data?.sessions.map(item => <option key={item.id} value={item.id}>{item.title} · {item.binding?.target.root}</option>)}</Select></label>
      {sessions.isPending && <p role="status">读取目标会话…</p>}{sessions.isError && <p role="alert">{errorText(sessions.error)}</p>}
      {fields.target === 'new' && <><label className="block text-sm">新会话名称<Input required aria-label="交接新会话名称" value={fields.title} onChange={event => update({ title: event.target.value })} /></label>{targetMode === 'create' && <><label className="block text-sm">开发类型<Select aria-label="交接开发类型" value={fields.kind} onChange={event => update({ kind: event.target.value as Fields['kind'] })}><option value="extension">扩展</option><option value="core">核心源码</option></Select></label><label className="block text-sm">独立开发目录<Input required aria-label="交接开发目录" value={fields.root} onChange={event => update({ root: event.target.value })} /></label></>}</>}
      <label className="block text-sm">约束（每行一项）<Textarea aria-label="交接约束" value={fields.constraints} onChange={event => update({ constraints: event.target.value })} /></label>
      <label className="block text-sm">必要摘要<Textarea aria-label="交接摘要" value={fields.summary} onChange={event => update({ summary: event.target.value })} /></label>
      <details><summary className="text-sm">选定记录引用（{fields.references.length}）</summary><p className="text-xs">只包含你勾选的来源记录，最多 16 项。</p>
        {references.isPending && <p role="status">读取可交接记录…</p>}{references.isError && <p role="alert">{errorText(references.error)}</p>}
        {references.data?.items.length === 0 && <p className="text-xs">此会话尚无可交接记录。</p>}
        {!!references.data?.omitted && <p className="text-xs">仅列出最近 100 项；另有 {references.data.omitted} 项较早记录未列出。</p>}
        {references.data?.items.map(item => <div key={item.eventId} className="my-2"><label className="flex gap-2 text-xs"><input type="checkbox" checked={fields.references.some(ref => ref.eventId === item.eventId)} disabled={fields.references.length >= 16 && !fields.references.some(ref => ref.eventId === item.eventId)} onChange={event => update({ references: event.target.checked ? [...fields.references, { sessionId: item.sessionId, eventId: item.eventId, payloadHash: item.payloadHash }] : fields.references.filter(ref => ref.eventId !== item.eventId) })} /><span className="break-all">{item.type} · {item.eventId}</span></label><pre className="max-h-32 overflow-auto whitespace-pre-wrap break-all text-xs">{item.excerpt}</pre></div>)}
      </details>
      {candidate && <><label className="flex gap-2 text-sm"><input type="checkbox" checked={fields.deliver} onChange={event => update({ deliver: event.target.checked })} />附上此候选的确切版本和使用说明</label>{fields.deliver && <label className="block text-sm">使用说明<Textarea required aria-label="交付使用说明" value={fields.usage} onChange={event => update({ usage: event.target.value })} /></label>}</>}
      <div className="flex flex-wrap gap-2"><Button type="submit" disabled={!fields.target || send.isPending} busy={preview.isPending}>预览交接</Button><Button type="button" variant="outline" disabled={send.isPending} onClick={close}>取消交接</Button></div>
      {preview.isError && <p role="alert">预览失败：{errorText(preview.error)}</p>}
      {review && <section aria-label="交接确认预览" className="space-y-2 rounded-lg bg-panel p-3">
        <h3 className="text-sm font-semibold">确认选定快照</h3><p className="whitespace-pre-wrap break-words">{review.preview.goal}</p><p className="break-all text-xs">目标：{review.preview.target.mode} · {review.preview.target.target.root} · {review.preview.target.target.scope}</p><p className="break-all text-xs">来源版本：{review.preview.source.revision.hash}</p><p className="break-all text-xs">交接内容：{review.preview.payloadHash}</p><p className="text-xs">选定引用 {review.preview.references.length} 项；交付版本 {review.preview.delivery?.length ?? 0} 项</p>
        <p className="whitespace-pre-wrap break-words text-sm">{review.preview.summary}</p>{review.preview.constraints.map((value, index) => <p key={index} className="text-xs">约束：{value}</p>)}
        {review.preview.delivery?.map((value, index) => <p key={index} className="break-all text-xs">{value.name} · {value.revision} · {value.phase} · {value.usage}</p>)}
        {!send.isSuccess && <HandoffSummary key={review.preview.payloadHash} sessionId={sessionId} preview={review.preview} draft={review.draft} onStart={() => setConfirmed(false)} onAdopt={summary => update({ summary })} />}
        <label className="flex gap-2 text-sm"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />我确认将以上快照交接到此目标</label><Button type="button" disabled={!confirmed || send.isSuccess} busy={send.isPending} onClick={() => send.mutate(review)}>确认交接</Button>
      </section>}
      {send.isError && <p role="alert">确认未完成：{errorText(send.error)}。重试使用同一命令；内容变化需重新预览；刷新后先查看下方确认状态，已接受的交接可恢复原记录。</p>}
      {send.data && <p role="status" className="text-sm">交接已记录，未启动目标任务。{targetMode === 'create' ? <Link className="underline" to="/create/session/$sessionId" params={{ sessionId: send.data.targetSessionId }}>查看接收会话</Link> : <Link className="underline" to="/work/session/$sessionId" params={{ sessionId: send.data.targetSessionId }}>查看接收会话</Link>}</p>}
      </fieldset>
    </form>}
  </section>;
}

/** 候选交付场景下的确认状态查询包装（HandoffRecovery 改为受控接收 states）。 */
function CandidateHandoffStates({ sessionId, mode }: { sessionId: string; mode: SessionMode }) {
  const states = useQuery({ queryKey: v2Key(v2Host(), mode, 'handoff', sessionId, 'states'), retry: false,
    queryFn: ({ signal }) => api<HandoffStatesView>(`/sessions/${sessionId}/handoffs`, undefined, signal) });
  if (!states.data?.items.length) return null;
  return <HandoffRecovery key={sessionId} sessionId={sessionId} mode={mode} states={states} />;
}
