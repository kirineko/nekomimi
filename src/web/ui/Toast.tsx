import * as React from "react";
import { cn } from "./utils";
import { Button } from "./Button";

export interface ToastItem {
  id: string;
  title: string;
  detail?: string;
  tone?: "default" | "danger";
  action?: { label: string; run: () => void };
}

/** 通知区域：aria-live 播报，错误用 role=alert；状态由应用层持有，不自动重试业务操作。 */
export function Toasts({
  items,
  onDismiss,
  className,
}: {
  items: ToastItem[];
  onDismiss: (id: string) => void;
  className?: string;
}) {
  return (
    <div
      aria-live="polite"
      className={cn(
        "pointer-events-none fixed right-4 bottom-4 z-50 flex w-[min(360px,calc(100vw-32px))] flex-col gap-2",
        className,
      )}
    >
      {items.map((item) => (
        <div
          key={item.id}
          role={item.tone === "danger" ? "alert" : "status"}
          className="pointer-events-auto rounded-lg border border-line bg-background p-3 shadow-floating"
        >
          <div className="flex items-start justify-between gap-2">
            <strong className={cn("text-sm", item.tone === "danger" && "text-danger")}>
              {item.title}
            </strong>
            <button
              type="button"
              aria-label={`关闭通知：${item.title}`}
              className="text-muted"
              onClick={() => onDismiss(item.id)}
            >
              ×
            </button>
          </div>
          {item.detail && <p className="text-xs text-muted">{item.detail}</p>}
          {item.action && (
            <Button
              size="sm"
              variant="outline"
              className="mt-2"
              onClick={() => {
                item.action!.run();
                onDismiss(item.id);
              }}
            >
              {item.action.label}
            </Button>
          )}
        </div>
      ))}
    </div>
  );
}
