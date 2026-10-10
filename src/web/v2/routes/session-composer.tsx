import { ExtensionInteractions } from "../../components/ExtensionInteractions";
import { TaskInput } from "./task-input";
import { RuntimeSlot } from "../slots";
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useLayoutEffect, useRef } from 'react';
import type { Receipt, SessionMode } from '../../../shared/protocol';
import { api, ClientError } from '../../api';
import { Button } from '../../ui/Button';
import { useDraft } from '../state/drafts';
import { deliveryKey, useDeliveries } from '../state/handoff';
import { useSessionStream } from '../state/sessionStream';
import { ContextMeterButton } from './context-meter';

/** 任务输入：Enter 提交 / Shift+Enter 换行 / IME 组合中不提交；以 "/" 开头提供命令补全；
 *  收据到达前不重复派发同一 commandId，收据到达后只清除已提交文本。 */
export function SessionComposer({ sessionId, mode = "work", target = "default", busy = false }: { sessionId: string; mode?: SessionMode; target?: string; busy?: boolean }) {
  const draft = useDraft(mode, target, sessionId), references = useDraft(mode, mode === "work" ? "delivery-references" : `delivery-references:${target}`, sessionId);
  const deliveries = useDeliveries(sessionId, mode, mode === 'work'), client = useQueryClient();
  let handoffIds: string[]; try { const value: unknown = JSON.parse(references.value || '[]'); handoffIds = Array.isArray(value) && value.every(item => typeof item === 'string') && mode === "work" ? value : []; } catch { handoffIds = []; }
  const footer=useRef<HTMLElement>(null);
  const measurement=useSessionStream(sessionId).snapshot?.context;
  // On short screens the browser reveals the caret, which can leave the send row clipped.
  // Reveal the complete action row only while editing this draft; never move focus.
  useLayoutEffect(()=>{
    if(matchMedia('(max-height: 600px)').matches && document.activeElement?.closest('[data-reference-editor]') && footer.current?.contains(document.activeElement))
      footer.current.querySelector<HTMLButtonElement>('[data-send-task]')?.scrollIntoView({block:'nearest',inline:'nearest',behavior:'instant'});
  },[draft.value]);
  const pending = useRef<{ fingerprint: string; commandId: string } | undefined>(undefined);
  const submit = useMutation({
    mutationFn: async (value: { prompt: string; handoffIds: string[]; selection: string }) => {
      const fingerprint = JSON.stringify([mode, target, sessionId, value.prompt, value.handoffIds]);
      if (pending.current?.fingerprint !== fingerprint) pending.current = { fingerprint, commandId: crypto.randomUUID() };
      return api<Receipt>(`/sessions/${sessionId}/submit`, { version: 1, commandId: pending.current.commandId, prompt: value.prompt, ...(value.handoffIds.length ? { handoffIds: value.handoffIds } : {}) });
    },
    onSuccess: (_receipt, value) => {
      pending.current = undefined;
      if (draft.get().trim() === value.prompt) draft.clear();
      if (references.get() === value.selection) references.clear();
      void client.invalidateQueries({ queryKey: deliveryKey(sessionId, mode) });
    },
  });

  const send = (fromButton=false) => {
    const prompt = draft.value.trim();
    if (!prompt || submit.isPending || busy) return;
    if(fromButton)footer.current?.querySelector<HTMLElement>('[data-reference-editor]')?.focus({preventScroll:true});
    submit.mutate({ prompt, handoffIds: [...handoffIds].sort(), selection: references.value });
  };

  return (
    <footer ref={footer} data-task-composer className="relative shrink-0 border-t border-line bg-background pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
      {mode === "work" && (!!deliveries.data?.items.length || handoffIds.length > 0) && <details className="mb-2 text-xs"><summary>引用交付（已选 {handoffIds.length}）</summary><p>最多选择 8 份，仅将选定交付关联到本次工作请求；不会自动应用、授权或执行能力。</p><div className="max-h-32 space-y-2 overflow-auto">
        {deliveries.data?.items.filter(item => item.receivedEventId).map(item => <label key={item.handoffId} className="flex gap-2"><input type="checkbox" checked={handoffIds.includes(item.handoffId)} disabled={handoffIds.length >= 8 && !handoffIds.includes(item.handoffId)} onChange={event => references.set(JSON.stringify(event.target.checked ? [...handoffIds, item.handoffId] : handoffIds.filter(id => id !== item.handoffId)))} /><span className="break-all">引用 {item.snapshot.map(snapshot => snapshot.name).join('、')} · {item.handoffId}</span></label>)}
        {handoffIds.filter(id => !deliveries.data?.items.some(item => item.handoffId === id)).map(id => <div key={id} className="break-all">已选交付暂不可读：{id}<Button size="sm" variant="outline" onClick={() => references.set(JSON.stringify(handoffIds.filter(value => value !== id)))}>移除此引用</Button></div>)}
      </div></details>}
      {deliveries.isError && <p className="text-xs text-warning">交付列表不可读；已选引用会由服务端在提交时核对。</p>}
      <ExtensionInteractions key={sessionId} sessionId={sessionId} />
      <RuntimeSlot slot="composer-toolbar" mode={mode} sessionId={sessionId} />
      <TaskInput value={draft.value} onChange={draft.set} onSubmit={send} sessionId={sessionId} mode={mode} target={target} />
      <div className="flex items-center justify-between gap-2.5">
        <span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
          <span role={submit.isError?"alert":undefined} className={`text-xs ${submit.isError?"text-danger":"text-muted"}`}>
            {submit.isError
              ? submit.error instanceof ClientError
                ? `提交失败：${submit.error.message}。确认后可重试，不会产生重复命令。`
                : "提交失败，请重试。"
              : "Enter 发送 · Shift+Enter 换行 · / 命令 · @ 引用"}
          </span>
          <ContextMeterButton sessionId={sessionId} measurement={measurement} />
        </span>
        <Button data-send-task onMouseDown={event=>event.preventDefault()} onClick={()=>send(true)} busy={submit.isPending} disabled={!draft.value.trim() || busy}>
          发送
        </Button>
      </div>
    </footer>
  );
}

/** 会话删除：显式确认对话框，成功后返回列表并失效缓存；失败保留会话并给出诊断。 */
