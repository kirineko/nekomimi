import {DiagnosticNotice} from "../../components/DiagnosticNotice";
import { SessionTimeline } from './session-timeline';
import { useMutation } from '@tanstack/react-query';
import { api } from '../../api';
import { Button } from '../../ui/Button';
import { Badge } from '../../ui/Badge';
import { ErrorState } from '../../ui/StateCard';
import { useSessionStream } from '../state/sessionStream';
import { SessionComposer } from './session-composer';
import { SessionStatusLabel } from './session-status';
import { SessionMenu } from './session-menu';
import { detailsDrawer } from '../state/details-drawer';
export function CreateConversation({ sessionId, targetId }: { sessionId: string; targetId: string }) {
  const stream = useSessionStream(sessionId);
  const cancel = useMutation({ mutationFn: (runId: string) => api(`/sessions/${sessionId}/cancel`, { version: 1, runId }) });
  const session = stream.snapshot?.session;
  const running = !!session?.runId && ['running', 'accepted', 'cancelling'].includes(session.status);
  return <section aria-label="创造任务" className="my-4 space-y-3 rounded-lg border border-line p-3">
    <header className="flex flex-wrap items-center gap-2"><h2 className="text-base font-semibold">创造任务</h2>{session && <SessionStatusLabel status={session.status} />}{session && <Button size="sm" variant="outline" onClick={() => detailsDrawer.toggle("changes")}>变更</Button>}{session && <SessionMenu key={`menu:${sessionId}`} session={session} running={running} measurement={stream.snapshot?.context} />}{running && <Button variant="destructive" busy={cancel.isPending} onClick={() => cancel.mutate(session!.runId!)}>停止创造任务</Button>}</header>
    {stream.status === 'connecting' && !stream.snapshot && <p role="status">正在读取创造会话…</p>}
    {stream.status === 'deleted' ? <ErrorState title="创造会话已删除" /> : stream.status === 'unauthorized' ? <ErrorState title="创造会话不可访问" detail={stream.error} /> : <>
      {stream.status === 'disconnected' && <p role="status">连接中断，正在恢复可靠记录…</p>}
      {cancel.isError && <p role="alert">{cancel.error instanceof Error ? cancel.error.message : String(cancel.error)}</p>}
      {session?.diagnostic&&<DiagnosticNotice key={session.diagnostic.id} sessionId={sessionId} value={session.diagnostic} />}
      <SessionTimeline key={sessionId} sessionId={sessionId} stream={stream} create />
      {stream.snapshot && <SessionComposer key={`${sessionId}:${targetId}`} mode="create" busy={running} target={targetId} sessionId={sessionId} />}
    </>}
  </section>;
}
