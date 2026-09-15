import { useEffect, useRef } from "react";
export function useInspectorFocus(close: () => void) {
  const panel = useRef<HTMLElement>(null);
  const onClose = useRef(close);
  onClose.current = close;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    panel.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); onClose.current(); }
      if (event.key !== 'Tab' || !matchMedia('(max-width: 1180px)').matches) return;
      const items = [...(panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],input,textarea,summary,[tabindex="0"]') ?? [])].filter(el=>el.getClientRects().length);
      const first=items[0], last=items.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown',keydown);
    return () => { document.removeEventListener('keydown',keydown); if(previous?.isConnected) previous.focus({preventScroll:true}); };
  },[]);
  return panel;
}
