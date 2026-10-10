import { useLayoutEffect, type RefObject } from 'react';
const key = (sessionId: string, handoffId: string) => `v2-reading:${location.host}:${sessionId}:${handoffId}`;
export function rememberDeliveryPosition(sessionId: string, handoffId: string, link: HTMLElement) {
  const card = link.closest<HTMLElement>('[data-delivery-id]'), surface = link.closest<HTMLElement>('[data-reading-surface]');
  if (!card || !surface) return;
  try { sessionStorage.setItem(`v2-reading-return:${location.host}:${sessionId}`, handoffId); } catch {}
  try { sessionStorage.setItem(key(sessionId, handoffId), JSON.stringify({ offset: card.getBoundingClientRect().top - surface.getBoundingClientRect().top, details: [...card.querySelectorAll("details")].map(item => item.open) })); } catch { /* Returning still locates the card. */ }
}
export function takeDeliveryReturn(sessionId: string): string | undefined {
  try { const name = `v2-reading-return:${location.host}:${sessionId}`, value = sessionStorage.getItem(name); sessionStorage.removeItem(name); return value && /^[a-f0-9]{64}$/.test(value) ? value : undefined; } catch { return undefined; }
}
export function useDeliveryPosition(surfaceRef: RefObject<HTMLDivElement | null>, handoffId?: string, sessionId?: string) {
  useLayoutEffect(() => {
    const surface = surfaceRef.current;
    if (!surface || !sessionId || !handoffId || !/^[a-f0-9]{64}$/.test(handoffId)) return;
    let offset = 0, details: boolean[] = [];
    try { const value = JSON.parse(sessionStorage.getItem(key(sessionId, handoffId)) || '{}'); if (Number.isFinite(value.offset)) offset = value.offset; if (Array.isArray(value.details) && value.details.every((item: unknown) => typeof item === "boolean")) details = value.details; } catch { /* Missing saved offset starts at the card. */ }
    let stopped = false;
    const restore = () => {
      if (stopped) return;
      const card = surface.querySelector<HTMLElement>(`[data-delivery-id="${handoffId}"]`);
      if (!card) return;
      card.querySelectorAll("details").forEach((item, index) => { if (details[index] !== undefined) item.open = details[index]!; });
      surface.scrollTop += card.getBoundingClientRect().top - surface.getBoundingClientRect().top - offset;
    };
    // Async query results and the timeline can arrive in either order.
    const mutation = new MutationObserver(restore), resize = new ResizeObserver(restore);
    mutation.observe(surface, { childList: true, subtree: true }); resize.observe(surface);
    const stop = () => { stopped = true; mutation.disconnect(); resize.disconnect(); };
    surface.addEventListener('wheel', stop, { passive: true }); surface.addEventListener('touchstart', stop, { passive: true }); surface.addEventListener('pointerdown', stop); surface.addEventListener('keydown', stop);
    restore();
    return () => { stop(); surface.removeEventListener('wheel', stop); surface.removeEventListener('touchstart', stop); surface.removeEventListener('pointerdown', stop); surface.removeEventListener('keydown', stop); };
  }, [surfaceRef, sessionId, handoffId]);
}
