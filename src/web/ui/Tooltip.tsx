import * as React from "react";
import { cn } from "./utils";

/** 悬停/聚焦显示的纯展示提示；控件的可访问名称仍由自身 label 提供。 */
export function Tooltip({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span className={cn("group relative inline-flex", className)}>
      {children}
      <span
        role="tooltip"
        className={cn(
          "pointer-events-none absolute bottom-full left-1/2 z-40 mb-1.5 -translate-x-1/2",
          "rounded-md border border-line bg-panel px-2 py-1 text-xs whitespace-nowrap text-foreground shadow-soft",
          "opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100",
        )}
      >
        {label}
      </span>
    </span>
  );
}
