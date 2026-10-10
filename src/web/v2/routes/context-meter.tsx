import { useState } from "react";
import type { ContextOccupancy } from "../../../shared/protocol";
import {
  DialogRoot,
  DialogTrigger,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogClose,
} from "../../ui/Dialog";
import { Button } from "../../ui/Button";
import { deferred } from "../deferred";

const ContextDetails = deferred("v2/routes/context-details.tsx", "ContextDetails", "上下文详情", () => import("./context-details").then((module) => module.ContextDetails));

/**
 * 输入区上下文入口（context-occupancy 规格）：容量已知时显示圆环与整数百分比，
 * 未知时显示“上下文”；不占顶栏或会话头部常驻位置；tokens 原值只在详情/开发者视图中。
 */
export function ContextMeterButton({
  sessionId,
  measurement,
}: {
  sessionId: string;
  measurement?: ContextOccupancy;
}) {
  const [open, setOpen] = useState(false);
  const percent =
    measurement?.contextWindow && measurement.contextWindow > 0
      ? Math.min(100, Math.round((measurement.totalTokens / measurement.contextWindow) * 100))
      : undefined;
  return (
    <DialogRoot open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          size="sm"
          variant="ghost"
          className="h-6 gap-1.5 px-2 text-xs text-muted"
          title={measurement ? `估算 ${measurement.totalTokens.toLocaleString()} tokens` : "查看当前上下文与历史选择"}
        >
          {percent !== undefined && (
            <svg aria-hidden viewBox="0 0 16 16" className="size-3.5">
              <circle cx="8" cy="8" r="6" fill="none" stroke="var(--line)" strokeWidth="2" />
              <circle
                cx="8"
                cy="8"
                r="6"
                fill="none"
                stroke={percent >= 85 ? "var(--warning)" : "var(--brand)"}
                strokeWidth="2"
                strokeLinecap="round"
                pathLength={100}
                strokeDasharray={`${percent} 100`}
                transform="rotate(-90 8 8)"
              />
            </svg>
          )}
          {percent === undefined ? "上下文" : `上下文 ${percent}%`}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85dvh] overflow-y-auto break-words p-4">
        <div className="flex items-center justify-between gap-2">
          <DialogTitle>上下文详情</DialogTitle>
          <DialogClose asChild>
            <Button variant="outline" size="sm">关闭详情</Button>
          </DialogClose>
        </div>
        <DialogDescription>只读查看当前估算、历史选择和压缩来源。</DialogDescription>
        {open && <ContextDetails loadClose={() => setOpen(false)} key={`${sessionId}:meter`} sessionId={sessionId} />}
      </DialogContent>
    </DialogRoot>
  );
}
