import * as React from "react";
import { cn } from "./utils";

/** 空/加载/错误等整区状态。错误用 role=alert；操作入口由调用方传入，控件自身不发起业务请求。 */
export function StateCard({
  title,
  detail,
  tone = "default",
  busy = false,
  actions,
  className,
}: {
  title: string;
  detail?: React.ReactNode;
  tone?: "default" | "error";
  busy?: boolean;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      role={tone === "error" ? "alert" : undefined}
      aria-busy={busy || undefined}
      className={cn("px-4 py-12 text-center text-muted", className)}
    >
      <h2 className={cn("text-foreground", tone === "error" && "text-danger")}>{title}</h2>
      {detail && <div className="mt-2 text-sm">{detail}</div>}
      {actions && <div className="mt-5 flex justify-center gap-2.5">{actions}</div>}
    </div>
  );
}

export const EmptyState = (props: Omit<React.ComponentProps<typeof StateCard>, "tone">) => (
  <StateCard {...props} />
);
export const ErrorState = (props: Omit<React.ComponentProps<typeof StateCard>, "tone">) => (
  <StateCard tone="error" {...props} />
);
