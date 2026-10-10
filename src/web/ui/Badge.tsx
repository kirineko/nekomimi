import * as React from "react";
import { cn } from "./utils";

export function Badge({
  className,
  state,
  ...props
}: React.ComponentProps<"span"> & { state?: "default" | "danger" | "warning" | "ok" }) {
  return (
    <span
      data-slot="badge"
      data-state={state ?? "default"}
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-line bg-panel px-2.5 py-0.5 text-[11px]",
        "data-[state=danger]:border-transparent data-[state=danger]:text-danger",
        "data-[state=warning]:border-transparent data-[state=warning]:text-warning",
        "data-[state=ok]:border-transparent data-[state=ok]:text-primary",
        className,
      )}
      {...props}
    />
  );
}
