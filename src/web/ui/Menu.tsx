import * as React from "react";
import * as Slot from "@radix-ui/react-slot";
import { cn } from "./utils";

export type MenuItem =
  | {
      kind?: "item";
      id: string;
      label: React.ReactNode;
      danger?: boolean;
      disabled?: boolean;
      hint?: string;
      onSelect?: () => void;
    }
  | {
      kind: "checkbox";
      id: string;
      label: React.ReactNode;
      checked: boolean;
      onCheckedChange: (next: boolean) => void;
    }
  | { kind: "separator"; id: string };

/** 轻量下拉菜单：按钮触发，Escape/外部点击关闭，方向键移动，role=menu 语义。 */
export function Menu({
  trigger,
  items,
  align = "start",
  ariaLabel,
  open: controlledOpen,
  onOpenChange,
}: {
  trigger: React.ReactNode;
  items: MenuItem[];
  align?: "start" | "end";
  ariaLabel?: string;
  open?: boolean;
  onOpenChange?: (open:boolean)=>void;
}) {
  const [localOpen, setLocalOpen] = React.useState(false);
  const open=controlledOpen ?? localOpen;
  const setOpen=(next:boolean|((previous:boolean)=>boolean))=>{const value=typeof next==='function'?next(open):next;setLocalOpen(value);onOpenChange?.(value);};
  const [active, setActive] = React.useState(-1);
  const rootRef = React.useRef<HTMLDivElement>(null);
  const itemRefs = React.useRef<(HTMLButtonElement | null)[]>([]);

  React.useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    // SPA 导航（history push/replace 或后退）时关闭菜单，避免菜单浮在已切换的页面上
    const closeOnNavigate = () => setOpen(false);
    document.addEventListener("mousedown", close);
    window.addEventListener("popstate", closeOnNavigate);
    window.addEventListener("hashchange", closeOnNavigate);
    return () => {
      document.removeEventListener("mousedown", close);
      window.removeEventListener("popstate", closeOnNavigate);
      window.removeEventListener("hashchange", closeOnNavigate);
    };
  }, [open]);

  const selectable = items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => item.kind !== "separator" && !(item.kind !== "checkbox" && item.disabled));
  const move = (delta: number) => {
    if (selectable.length === 0) return;
    const pos = selectable.findIndex(({ index }) => index === active);
    const next = selectable[(pos + delta + selectable.length) % selectable.length]!;
    setActive(next.index);
    itemRefs.current[next.index]?.focus();
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Escape") {
      setOpen(false);
      (rootRef.current?.querySelector("button") as HTMLButtonElement | null)?.focus();
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      if (!open) setOpen(true);
      move(1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) setOpen(true);
      move(-1);
    }
  };

  return (
    <div ref={rootRef} className="relative inline-block" onKeyDown={onKeyDown} onBlur={event=>{if(!event.currentTarget.contains(event.relatedTarget as Node))setOpen(false);}}>
      <Slot.Root
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={ariaLabel}
        className="inline-flex items-center"
        onClick={() => setOpen((value) => !value)}
      >
        {trigger}
      </Slot.Root>
      {open && (
        <div
          role="menu"
          className={cn(
            "absolute z-30 mt-1 min-w-40 rounded-md border border-line bg-background p-1 shadow-floating",
            align === "end" ? "right-0" : "left-0",
          )}
        >
          {items.map((item, index) => {
            if (item.kind === "separator")
              return <div key={item.id} role="separator" className="my-1 h-px bg-line" />;
            if (item.kind === "checkbox")
              return (
                <button
                  key={item.id}
                  ref={(node) => {
                    itemRefs.current[index] = node;
                  }}
                  type="button"
                  role="menuitemcheckbox"
                  aria-checked={item.checked}
                  className="flex w-full items-center justify-between gap-6 rounded-sm border-0 bg-transparent px-3 py-1.5 text-left text-sm text-foreground hover:bg-wash focus-visible:bg-wash"
                  onClick={() => item.onCheckedChange(!item.checked)}
                >
                  {item.label}
                  <span aria-hidden className="text-xs text-muted">
                    {item.checked ? "开" : "关"}
                  </span>
                </button>
              );
            return (
              <button
                key={item.id}
                ref={(node) => {
                  itemRefs.current[index] = node;
                }}
                type="button"
                role="menuitem"
                disabled={item.disabled}
                data-danger={item.danger || undefined}
                className={cn(
                  "flex w-full flex-col items-start rounded-sm border-0 bg-transparent px-3 py-1.5 text-left text-sm text-foreground",
                  "hover:bg-wash focus-visible:bg-wash disabled:opacity-50",
                  "data-[danger]:text-danger",
                )}
                onClick={() => {
                  setOpen(false);
                  item.onSelect?.();
                }}
              >
                {item.label}
                {item.hint && <span className="text-xs text-muted">{item.hint}</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
