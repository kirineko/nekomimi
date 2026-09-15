import { useEffect, useRef } from "react";
export function useInspectorFocus(close: () => void, enabled = true, modal = false) {
  const panel = useRef<HTMLElement>(null);
  const onClose = useRef(close);
  onClose.current = close;
  useEffect(() => {
    if (!enabled) return;
    const previous = document.activeElement as HTMLElement | null;
    panel.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); onClose.current(); }
      if (event.key !== 'Tab' || !(modal || matchMedia('(max-width: 1199px)').matches)) return;
      const items = [...(panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],input,textarea,summary,[tabindex="0"]') ?? [])].filter(el=>el.getClientRects().length);
      const first=items[0], last=items.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown',keydown);
    return () => { document.removeEventListener('keydown',keydown); queueMicrotask(() => { if(previous?.isConnected) previous.focus({preventScroll:true}); }); };
  },[enabled, modal]);
  return panel;
}
