import * as React from "react";
import { cn } from "./utils";

export interface TabItem {
  id: string;
  label: React.ReactNode;
  disabled?: boolean;
}

/** 选项卡：role=tablist，方向键切换焦点，选中态不只靠颜色（font-weight + aria-selected）。 */
export function Tabs({
  items,
  value,
  onChange,
  ariaLabel,
  className,
}: {
  items: TabItem[];
  value: string;
  onChange: (id: string) => void;
  ariaLabel: string;
  className?: string;
}) {
  const refs = React.useRef<(HTMLButtonElement | null)[]>([]);
  const move = (from: number, delta: number) => {
    const enabled = items
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => !item.disabled);
    if (enabled.length === 0) return;
    const pos = enabled.findIndex(({ index }) => index === from);
    const next = enabled[(pos + delta + enabled.length) % enabled.length]!;
    onChange(next.item.id);
    refs.current[next.index]?.focus();
  };
  return (
    <div role="tablist" aria-label={ariaLabel} className={cn("flex gap-1 rounded-lg bg-panel p-1", className)}>
      {items.map((item, index) => (
        <button
          key={item.id}
          ref={(node) => {
            refs.current[index] = node;
          }}
          type="button"
          role="tab"
          id={`tab-${item.id}`}
          aria-selected={item.id === value}
          aria-controls={`tabpanel-${item.id}`}
          disabled={item.disabled}
          tabIndex={item.id === value ? 0 : -1}
          className={cn(
            "rounded-md border-0 px-4 py-1.5 text-sm disabled:opacity-50",
            item.id === value ? "bg-wash font-semibold text-foreground" : "bg-transparent text-muted",
          )}
          onClick={() => onChange(item.id)}
          onKeyDown={(event) => {
            if (event.key === "ArrowRight") {
              event.preventDefault();
              move(index, 1);
            } else if (event.key === "ArrowLeft") {
              event.preventDefault();
              move(index, -1);
            }
          }}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

export function TabPanel({
  id,
  active,
  className,
  ...props
}: React.ComponentProps<"div"> & { id: string; active: boolean }) {
  if (!active) return null;
  return (
    <div
      role="tabpanel"
      id={`tabpanel-${id}`}
      aria-labelledby={`tab-${id}`}
      className={className}
      {...props}
    />
  );
}
