import { useMutation, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { useState } from "react";
import type { HandoffStatesView } from "../../../shared/handoff-view";
import type { HandoffReceipt, SessionMode } from "../../../shared/protocol";
import { api } from "../../api";
import { Button } from "../../ui/Button";
import { v2Host } from "../state/query";
import { DevOnly, DevValue } from "../dev-only";

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * 交接确认状态：只在存在已接受交接时由 HandoffCards 渲染；
 * 手动“重新读取”按钮属于开发者视图，正常路径由 SSE 事件与聚焦自动刷新（3.11）。
 */
export function HandoffRecovery({
  sessionId,
  mode,
  states,
}: {
  sessionId: string;
  mode: SessionMode;
  states: UseQueryResult<HandoffStatesView>;
}) {
  const client = useQueryClient(),
    [approved, setApproved] = useState<string>();
  const recover = useMutation({
    mutationFn: (item: HandoffStatesView["items"][number]) =>
      api<HandoffReceipt>(`/sessions/${sessionId}/handoff-recover`, {
        version: 1,
        commandId: item.commandId,
        payloadHash: item.payloadHash,
      }),
    onSuccess: () => setApproved(undefined),
    onSettled: () => client.invalidateQueries({ queryKey: ["v2", v2Host()] }),
  });
  void mode;
  return (
    <section aria-label="交接确认状态" className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <h3 className="text-sm font-semibold">交接确认状态</h3>
        <DevOnly>
          <Button size="sm" variant="outline" onClick={() => void states.refetch()}>
            重新读取确认状态
          </Button>
        </DevOnly>
      </div>
      {states.data?.items.map((item) => (
        <article
          key={item.handoffId}
          aria-label={`确认状态 ${item.handoffId}`}
          className="space-y-2 rounded-lg border border-line p-3"
        >
          <h4 className="text-sm">
            {item.receipt
              ? "交接已完整记录"
              : item.status === "blocked"
                ? "交接待恢复，存在阻碍"
                : "交接已接受，尚未完整记录"}
          </h4>
          <DevValue label="命令" value={item.commandId} />
          <DevValue label="交接" value={item.handoffId} />
          <DevValue label="目标会话" value={item.targetSessionId} />
          <DevValue label="快照" value={item.payloadHash} />
          {item.error && <p className="text-sm text-warning">{item.error}</p>}
          {!item.receipt && (
            <>
              <p className="text-xs">
                恢复只补齐这份已接受快照的接收记录；不会重新生成摘要、应用候选或运行目标任务。
              </p>
              <label className="flex gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={approved === item.handoffId}
                  disabled={recover.isPending}
                  onChange={(event) =>
                    setApproved(event.target.checked ? item.handoffId : undefined)
                  }
                />
                我确认恢复这份已接受的交接
              </label>
              <Button
                variant="outline"
                disabled={approved !== item.handoffId}
                busy={recover.isPending && recover.variables?.handoffId === item.handoffId}
                onClick={() => recover.mutate(item)}
              >
                恢复交接记录
              </Button>
            </>
          )}
          {recover.isError && recover.variables?.handoffId === item.handoffId && (
            <p role="alert">恢复未完成：{errorText(recover.error)}</p>
          )}
        </article>
      ))}
    </section>
  );
}
