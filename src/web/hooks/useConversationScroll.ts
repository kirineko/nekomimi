import { useCallback, useLayoutEffect, useRef, type RefObject } from 'react';
import type { TimelineRow } from '../../shared/protocol';

interface Options {
  sessionId?: string;
  ready: boolean;
  rows?: TimelineRow[];
  revision: number;
  isBrowsing: () => boolean;
  browse: () => void;
  reachBottom: () => void;
}
interface RowPosition { node: HTMLElement; top: number; bottom: number }
const BOTTOM_EPSILON = 2;

/** Only this coordinator writes the conversation's scroll position. Geometry is
 * cached on content changes; scrolling reads numbers, never walks DOM geometry. */
export function useConversationScroll(container: RefObject<HTMLElement | null>, options: Options) {
  const latest = useRef(options);
  latest.current = options;
  const controller = useRef<{ reconcile: () => void; capture: () => void } | undefined>(undefined);

  useLayoutEffect(() => {
    const el = container.current;
    const content = el?.querySelector<HTMLElement>('[data-conversation-content]');
    if (!el || !content) return;
    let positions: RowPosition[] = [];
    let programTarget: number | undefined;
    let intent = false, held = false, disposed = false;
    let touchY: number | undefined;
    let frame = 0;
    let settle: ReturnType<typeof setTimeout> | undefined;
    let lastTop = el.scrollTop;
    let lastMax = el.scrollHeight - el.clientHeight;

    const write = (top: number) => {
      const target = Math.max(0, Math.min(top, el.scrollHeight - el.clientHeight));
      if (Math.abs(target - el.scrollTop) < 0.5) return;
      el.scrollTop = target;
      programTarget = el.scrollTop;
      lastTop = el.scrollTop;
    };
    const measure = () => {
      const origin = el.getBoundingClientRect().top - el.scrollTop;
      positions = Array.from(content.querySelectorAll<HTMLElement>('[data-row-id], [data-delivery-id]'), node => {
        const rect = node.getBoundingClientRect();
        return { node, top: rect.top - origin, bottom: rect.bottom - origin };
      }).sort((a, b) => a.top - b.top);
    };
    const reconcile = () => {
      if (disposed || !latest.current.ready) { positions = []; return; }
      if (!latest.current.isBrowsing()) {
        write(el.scrollHeight);
      } else {
        // Cached content coordinates describe the layout before this change.
        // Use the CURRENT scrollTop, including user movement since last render.
        // A removed anchor can fall back only to a surviving visible neighbour.
        const max = el.scrollHeight - el.clientHeight;
        // Removing a page/footer can make the browser clamp scrollTop before
        // this layout effect runs. Preserve the pre-clamp reading position.
        const readingTop = max < lastMax && lastTop > max && Math.abs(el.scrollTop - max) < 1 ? lastTop : el.scrollTop;
        const anchor = positions.find(row => row.bottom > readingTop + 40 &&
          row.top < readingTop + el.clientHeight && row.node.isConnected && content.contains(row.node));
        if (anchor) {
          const now = anchor.node.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop;
          write(readingTop + now - anchor.top);
        }
      }
      measure();
      lastTop = el.scrollTop;
      lastMax = el.scrollHeight - el.clientHeight;
    };
    const finish = () => {
      if (held) return;
      intent = false;
      if (settle) clearTimeout(settle);
    };
    const settleLater = () => {
      if (settle) clearTimeout(settle);
      // Fallback for browsers without scrollend. Renewed by actual scrolls,
      // including inertia, rather than expiring after the initial gesture.
      settle = setTimeout(finish, 180);
    };
    const arm = (direction: number) => {
      // A fresh gesture supersedes the acknowledgement of an older program
      // write, even when opposite inputs are coalesced into one scroll event.
      programTarget = undefined;
      lastTop = el.scrollTop;
      intent = true;
      settleLater();
      if (direction < 0 && el.scrollTop > BOTTOM_EPSILON && latest.current.ready) latest.current.browse();
      // Continuing downward at an already-clamped boundary may emit no scroll
      // event. It still means to continue reading the next page or follow live.
      if (direction > 0 && !frame && latest.current.ready) frame = requestAnimationFrame(() => {
        frame = 0;
        if (el.scrollHeight - el.clientHeight - el.scrollTop <= BOTTOM_EPSILON) latest.current.reachBottom();
      });
    };
    const nestedConsumes = (target: EventTarget | null, delta: number) => {
      for (let node = target instanceof Element ? target : null; node && node !== el; node = node.parentElement) {
        if (node.scrollHeight <= node.clientHeight || !/(auto|scroll)/.test(getComputedStyle(node).overflowY)) continue;
        if (delta < 0 ? node.scrollTop > 0 : node.scrollTop + node.clientHeight < node.scrollHeight - 1) return true;
      }
      return false;
    };
    const wheel = (event: WheelEvent) => {
      if (event.ctrlKey || !event.deltaY || Math.abs(event.deltaX) > Math.abs(event.deltaY) || nestedConsumes(event.target, event.deltaY)) return;
      arm(event.deltaY);
    };
    const pointerDown = (event: PointerEvent) => {
      // Mouse clicks in messages must not turn later layout/focus scrolling
      // into a manual gesture. The native scrollbar targets the container.
      if (event.pointerType === 'mouse' && event.target === el) { held = true; arm(0); }
    };
    const pointerUp = () => { held = false; settleLater(); };
    const touchStart = (event: TouchEvent) => { touchY = event.touches[0]?.clientY; held = true; };
    const touchMove = (event: TouchEvent) => {
      const y = event.touches[0]?.clientY;
      if (y !== undefined && touchY !== undefined) {
        const delta = touchY - y;
        if (delta && !nestedConsumes(event.target, delta)) arm(delta);
      }
      touchY = y;
    };
    const touchEnd = () => { touchY = undefined; held = false; settleLater(); };
    const key = (event: KeyboardEvent) => {
      if ((event.target as Element)?.closest('input,textarea,select,[contenteditable=true]')) return;
      const direction = ['ArrowUp', 'PageUp', 'Home'].includes(event.key) || (event.key === ' ' && event.shiftKey) ? -1 :
        ['ArrowDown', 'PageDown', 'End', ' '].includes(event.key) ? 1 : 0;
      if (direction && !nestedConsumes(event.target, direction)) arm(direction);
    };
    const scroll = () => {
      const top = el.scrollTop;
      if (programTarget !== undefined && Math.abs(top - programTarget) < 1) {
        programTarget = undefined; lastTop = top; return;
      }
      programTarget = undefined;
      const moved = Math.abs(top - lastTop) > 0.5;
      lastTop = top;
      if (!moved || (!intent && !held) || !latest.current.ready) return;
      settleLater();
      // Synchronous browse invalidates any pending latest navigation before a
      // delayed response or ResizeObserver can reclaim the user's position.
      if (el.scrollHeight - el.clientHeight - top > BOTTOM_EPSILON) latest.current.browse();
      if (!frame) frame = requestAnimationFrame(() => {
        frame = 0;
        if (el.scrollHeight - el.clientHeight - el.scrollTop <= BOTTOM_EPSILON) latest.current.reachBottom();
      });
    };

    const observer = new ResizeObserver(reconcile);
    observer.observe(el); observer.observe(content);
    el.addEventListener('scroll', scroll, { passive: true });
    el.addEventListener('scrollend', finish);
    el.addEventListener('wheel', wheel, { passive: true });
    el.addEventListener('pointerdown', pointerDown, { passive: true });
    window.addEventListener('pointerup', pointerUp);
    window.addEventListener('pointercancel', pointerUp);
    el.addEventListener('touchstart', touchStart, { passive: true });
    el.addEventListener('touchmove', touchMove, { passive: true });
    el.addEventListener('touchend', touchEnd, { passive: true });
    el.addEventListener('touchcancel', touchEnd, { passive: true });
    el.addEventListener('keydown', key);
    controller.current = { reconcile, capture: () => {
      measure(); lastTop = el.scrollTop; lastMax = el.scrollHeight - el.clientHeight;
    } };
    reconcile();
    return () => {
      disposed = true;
      controller.current = undefined;
      observer.disconnect(); cancelAnimationFrame(frame);
      if (settle) clearTimeout(settle);
      el.removeEventListener('scroll', scroll); el.removeEventListener('scrollend', finish);
      el.removeEventListener('wheel', wheel); el.removeEventListener('pointerdown', pointerDown);
      window.removeEventListener('pointerup', pointerUp); window.removeEventListener('pointercancel', pointerUp);
      el.removeEventListener('touchstart', touchStart); el.removeEventListener('touchmove', touchMove);
      el.removeEventListener('touchend', touchEnd); el.removeEventListener('touchcancel', touchEnd);
      el.removeEventListener('keydown', key);
    };
  }, [container, options.sessionId]);

  // Rows/revision indicate real content/navigation changes; historyMode alone
  // deliberately does not restore an old reading position.
  useLayoutEffect(() => { controller.current?.reconcile(); }, [options.rows, options.revision, options.ready]);
  return useCallback(() => controller.current?.capture(), []);
}
