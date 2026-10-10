import {DiagnosticNotice} from "../../components/DiagnosticNotice";
import { SessionTimeline } from './session-timeline';
import { takeDeliveryReturn } from '../state/reading-position';
import { SessionComposer } from './session-composer';
import { HandoffCards } from './handoff-cards';
import { useMutation } from "@tanstack/react-query";
import { useParams, useSearch } from "@tanstack/react-router";
import { useState } from "react";
import { validId } from "../../../shared/protocol";
import { api } from "../../api";
import { Badge } from "../../ui/Badge";
import { Button } from "../../ui/Button";
import { EmptyState, ErrorState, StateCard } from "../../ui/StateCard";
import { useSessionStream } from "../state/sessionStream";
import { detailsDrawer, useDetailsDrawer } from "../state/details-drawer";
import { useNarrow } from "../shell";
import { DevEyebrow, DevValue } from "../dev-only";
import { SessionStatusLabel } from "./session-status";
import { SessionMenu } from "./session-menu";

export function WorkSessionPage() {
  const { sessionId } = useParams({ from: "/work/session/$sessionId" });
  const { delivery } = useSearch({ from: "/work/session/$sessionId" });
  const [readingDelivery] = useState(() => { const pending = takeDeliveryReturn(sessionId); return delivery ?? pending; });
  const valid = validId(sessionId);
  const stream = useSessionStream(valid ? sessionId : undefined);
  const cancel = useMutation({
    mutationFn: (runId: string) =>
      api(`/sessions/${sessionId}/cancel`, { version: 1, runId }),
  });
  const rows = stream.snapshot?.rows ?? [];
  const drawer = useDetailsDrawer();
  const narrow = useNarrow();

  if (!valid) {
    return (
      <ErrorState
        title="会话地址无效"
        detail="链接中的会话标识不符合格式，未执行任何操作。请从会话列表重新进入。"
      />
    );
  }

  const session = stream.snapshot?.session;
  const running = !!session?.runId && ["running", "accepted", "cancelling"].includes(session.status);

  return (
    <main className="flex h-full min-w-0 flex-col overflow-auto px-6 pt-4 max-[760px]:px-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <DevEyebrow>WORK MODE</DevEyebrow>
          <h1 className="truncate text-xl">{session?.title ?? "读取会话…"}</h1>
        </div>
        <div className="flex max-w-full flex-wrap items-center gap-2">
          {stream.status !== "connected" && (
            <Badge state={stream.status === "deleted" ? "danger" : "warning"}>
              {stream.status === "connecting"
                ? "连接中"
                : stream.status === "disconnected"
                  ? "已断线，重连中"
                  : stream.status === "deleted"
                    ? "已删除"
                    : "未授权"}
            </Badge>
          )}
          {session && <SessionStatusLabel key={session.status} status={session.status} />}
          {running && session?.runId && (
            <Button
              variant="destructive"
              size="sm"
              busy={cancel.isPending}
              onClick={() => cancel.mutate(session.runId!)}
            >
              停止
            </Button>
          )}
          {session && (
            <Button size="sm" variant="outline" aria-expanded={drawer.open && drawer.tab === "changes"} onClick={() => detailsDrawer.toggle("changes")}>
              变更
            </Button>
          )}
          {session && narrow && (
            <Button size="sm" variant="outline" onClick={() => detailsDrawer.toggle()}>
              详情
            </Button>
          )}
          {session && <SessionMenu key={`menu:${sessionId}`} session={session} running={running} measurement={stream.snapshot?.context} />}
        </div>
      </div>
      {session?.diagnostic&&<DiagnosticNotice key={session.diagnostic.id} sessionId={sessionId} value={session.diagnostic} />}
      <SessionTimeline key={`timeline:${sessionId}`} sessionId={sessionId} stream={stream} readingDelivery={readingDelivery}>
        {session && <HandoffCards key={sessionId} sessionId={sessionId} mode="work" />}
        {stream.status === "connecting" && !stream.snapshot && (
          <StateCard title="正在加载会话…" busy />
        )}
        {stream.status === "deleted" && (
          <ErrorState title="会话已删除" detail="该会话不再可用，未执行任何操作。" />
        )}
        {stream.status === "unauthorized" && (
          <ErrorState title="无权访问此会话" detail={stream.error} />
        )}
        {stream.snapshot && rows.length === 0 && (
          <EmptyState title="从一个清晰的任务开始" detail="描述你想完成的事，Nekomimi 会一步步完成并记录过程。" />
        )}
      </SessionTimeline>
      {session && !["deleted","unauthorized"].includes(stream.status) && <SessionComposer key={sessionId} sessionId={sessionId} busy={running} />}
    </main>
  );
}
