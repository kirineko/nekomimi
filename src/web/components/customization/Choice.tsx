import { useEffect, useLayoutEffect, useId, useRef, useState } from "react";
export interface ChoiceOption { value: string; label: string; description?: string }
export function Choice({ label, value, options, onChange, disabled, placeholder = "请选择", active = true }: {
  label: string; value: string; options: ChoiceOption[]; onChange: (value: string) => void;
  disabled?: boolean; placeholder?: string; active?: boolean;
}) {
  const id = useId();
  const [position, setPosition] = useState({ left: 0, top: 0, width: 240, maxHeight: 280 });
  const [open, setOpen] = useState(false), [query, setQuery] = useState("");
  const trigger = useRef<HTMLButtonElement>(null), popup = useRef<HTMLDivElement>(null);
  const selected = options.find(option => option.value === value);
  const filtered = options.filter(option => `${option.label} ${option.description ?? ""}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  const dismiss = (restore = true) => { setOpen(false); setQuery(""); if (restore) trigger.current?.focus(); };
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const anchor = trigger.current!.getBoundingClientRect();
      const bounds = trigger.current!.closest('[role="dialog"]')!.getBoundingClientRect();
      const width = Math.min(Math.max(anchor.width, 260), bounds.width - 24);
      const below = bounds.bottom - anchor.bottom - 18;
      const above = anchor.top - bounds.top - 18;
      const height = Math.min(280, Math.max(below, above));
      setPosition({ left: Math.max(bounds.left + 12, Math.min(anchor.left, bounds.right - width - 12)), top: below >= 200 || below >= above ? anchor.bottom + 6 : Math.max(bounds.top + 12, anchor.top - height - 6), width, maxHeight: height });
    };
    place();
    window.addEventListener("resize", place);
    const body = trigger.current!.closest('.customization-body');
    body?.addEventListener("scroll", place);
    return () => { window.removeEventListener("resize", place); body?.removeEventListener("scroll", place); };
  }, [open]);
  useEffect(() => {
    if (!active || disabled) { setOpen(false); setQuery(""); }
  }, [active, disabled]);
  useEffect(() => {
    if (!open) return;
    const initial = popup.current?.querySelector<HTMLElement>('[aria-selected="true"]') ?? popup.current?.querySelector<HTMLElement>('[role="option"]') ?? popup.current?.querySelector<HTMLElement>('input, button');
    initial?.focus();
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !popup.current?.contains(event.target) && !trigger.current?.contains(event.target)) { setOpen(false); setQuery(""); }
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);
  return <div className="customization-choice">
    <button ref={trigger} type="button" className="customization-choice-trigger" aria-label={label} aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? id : undefined} disabled={disabled} onClick={() => open ? dismiss() : setOpen(true)} onKeyDown={event => {
      if (event.key === "Escape" && open) { event.preventDefault(); event.stopPropagation(); dismiss(); }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); setOpen(true); }
    }}><span><strong>{selected?.label ?? placeholder}</strong>{selected?.description && <small>{selected.description}</small>}</span><span aria-hidden="true">⌄</span></button>
    {open && <div className="customization-choice-popup" style={position} ref={popup} onBlur={event => {
      if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget) && event.relatedTarget !== trigger.current) dismiss(false);
    }} onKeyDown={event => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); dismiss(); return; }
      const items = Array.from(popup.current!.querySelectorAll<HTMLButtonElement>('[role="option"]'));
      const index = items.indexOf(document.activeElement as HTMLButtonElement);
      let next: number;
      if (event.key === "ArrowDown") next = (index + 1) % items.length;
      else if (event.key === "ArrowUp") next = (index - 1 + items.length) % items.length;
      else if (event.key === "Home" && index >= 0) next = 0;
      else if (event.key === "End" && index >= 0) next = items.length - 1;
      else return;
      event.preventDefault(); items[next]?.focus();
    }}>
      {options.length > 6 && <input aria-label={`搜索${label}`} placeholder="搜索名称或模型…" value={query} onChange={event => setQuery(event.target.value)} />}
      <div id={id} role="listbox" aria-label={label}>
        {filtered.map(option => <button type="button" key={option.value} role="option" aria-selected={option.value === value} tabIndex={0} onClick={() => { dismiss(); onChange(option.value); }}><span><strong>{option.label}</strong>{option.description && <small>{option.description}</small>}</span><span aria-hidden="true">{option.value === value ? "✓" : ""}</span></button>)}
      </div>
      {!filtered.length && <p role="status">没有匹配的选项</p>}
      <button type="button" className="customization-choice-cancel" onClick={() => dismiss()}>取消选择</button>
    </div>}
  </div>;
}
