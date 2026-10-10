import { useMutation } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import type { HandoffDraft, HandoffPreview } from '../../../shared/protocol';
import { api } from '../../api';
import { Button } from '../../ui/Button';
interface SummaryResult { preparationId: string; summary: string; payloadHash: string; requiresConfirmation: true }
const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);
export function HandoffSummary({ sessionId, preview, draft, onAdopt, onStart }: { sessionId: string; preview: HandoffPreview; draft: HandoffDraft; onAdopt: (summary: string) => void; onStart: () => void }) {
  const [consent, setConsent] = useState(false), [cancelRequested, setCancelRequested] = useState(false);
  const command = useRef(crypto.randomUUID()), request = useRef<AbortController | undefined>(undefined);
  useEffect(() => () => request.current?.abort(), []);
  const prepare = useMutation({ mutationFn: async () => {
    if (!consent) throw Error('请先确认摘要模型调用');
    const abort = new AbortController(); request.current = abort;
    const result = await api<SummaryResult>(`/sessions/${sessionId}/handoff-summary`, { version: 1, commandId: command.current, payloadHash: preview.payloadHash, draft }, abort.signal);
    if (result.payloadHash !== preview.payloadHash || !result.requiresConfirmation) throw Error('摘要返回的来源快照不匹配');
    return result;
  } });
  const cancel = useMutation({ mutationFn: () => api<{ status: string }>(`/sessions/${sessionId}/handoff-summary-cancel`, { commandId: command.current }), onSuccess: () => setCancelRequested(true) });
  return <section aria-label="摘要准备" className="space-y-2 border-t border-line pt-3">
    <h4 className="text-sm font-semibold">为选定内容准备摘要</h4>
    <p className="text-xs">将调用已配置的交接摘要模型，只使用当前预览中选定的数据，无工具调用。离开或修改预览会中止摘要请求，工作任务不受影响。</p>
    <label className="flex gap-2 text-sm"><input type="checkbox" checked={consent} disabled={prepare.isPending} onChange={event => setConsent(event.target.checked)} />我授权调用模型为此预览生成摘要</label>
    <div className="flex flex-wrap gap-2"><Button type="button" variant="outline" disabled={!consent || prepare.isSuccess} busy={prepare.isPending} onClick={() => { onStart(); setCancelRequested(false); cancel.reset(); prepare.mutate(); }}>{prepare.isError ? '重取原摘要准备结果' : '生成交接摘要'}</Button>
    {prepare.isPending && <Button type="button" variant="outline" disabled={cancelRequested} busy={cancel.isPending} onClick={() => cancel.mutate()}>停止摘要准备</Button>}</div>
    {prepare.isPending && <p role="status">{cancelRequested ? '取消请求已发送，等待摘要请求结束。' : '正在准备摘要…'}</p>}
    {cancel.isError && <p role="alert">取消请求失败：{errorText(cancel.error)}</p>}
    {prepare.isError && <p role="alert">摘要未采用：{errorText(prepare.error)}。不会自动交接或重新调用模型。</p>}
    {prepare.data && !prepare.isError && <><p className="break-all text-xs">准备任务 {prepare.data.preparationId}</p><pre className="whitespace-pre-wrap break-words text-sm">{prepare.data.summary}</pre><p className="text-xs">摘要尚未写入交接。采用后需重新预览并确认。</p><Button type="button" variant="outline" onClick={() => onAdopt(prepare.data!.summary)}>采用摘要并重新审阅</Button></>}
  </section>;
}
