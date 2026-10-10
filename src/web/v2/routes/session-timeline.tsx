import { RuntimeSlot } from "../slots";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, useMemo, type ReactNode } from 'react';
import { defaultRangeExtractor, useVirtualizer } from '@tanstack/react-virtual';
import type { TimelineRow } from '../../../shared/protocol.js';
import { useConversationScroll } from '../../hooks/useConversationScroll.js';
import { SavedRow } from './message-content';
import { SyntaxScope } from '../../components/syntax-scope';
import { Button } from '../../ui/Button';
import { useDeliveryPosition } from '../state/reading-position';
import type { useSessionStream } from '../state/sessionStream';
import { readableTurns } from './readable-turns';
import { TurnHeading } from './turn-heading';
import { InspectionButton } from './inspection-button';

/** The bounded history window retains light, stable anchor boxes. Only the
 * virtual range mounts row content. Measured boxes preserve native selection
 * and scroll anchors during page changes; remounts only render saved data. */
export function SessionTimeline({ sessionId, stream, children, readingDelivery, create = false }: {
  sessionId: string; stream: ReturnType<typeof useSessionStream>; children?: ReactNode;
  readingDelivery?: string; create?: boolean;
}) {
  const surface = useRef<HTMLDivElement>(null), prefix = useRef<HTMLDivElement>(null);
  const sizes = useRef(new Map<string, number>());
  const [margin, setMargin] = useState(0), [pinned, setPinned] = useState<string[]>([]);
  const selection = useRef(false);
  const [deliveryRestoring, setDeliveryRestoring] = useState(!!readingDelivery);
  const turns = useMemo(() => readableTurns(stream.snapshot?.rows ?? []), [stream.snapshot?.rows]);
  const rows = useMemo(() => turns.flatMap(turn => turn.rows), [turns]);
  const existingLiveRows = useRef(new Set(stream.liveRows));
  const openedLivePanels = useRef(new Set<string>());
  const liveState = useRef(stream); liveState.current = stream;
  const claimLivePanel = useCallback((id: string) => {
    const current = () => !existingLiveRows.current.has(id) && liveState.current.liveRows.has(id) && !liveState.current.isBrowsing();
    if (!current() || openedLivePanels.current.has(id)) return undefined;
    openedLivePanels.current.add(id);
    if (openedLivePanels.current.size > 180) openedLivePanels.current.delete(openedLivePanels.current.values().next().value!);
    return current;
  }, []);
  const indexes = new Map(rows.map((row, index) => [row.id, index]));
  const pinnedIndexes = pinned.map(id => rows.findIndex(row => row.id === id)).filter(index => index >= 0);
  const virtualizer = useVirtualizer({
    count: rows.length, getScrollElement: () => surface.current, scrollMargin: margin,
    getItemKey: index => rows[index]!.id, estimateSize: index => sizes.current.get(rows[index]!.id) ?? 160,
    overscan: 6,
    rangeExtractor: range => [...new Set([...defaultRangeExtractor(range), ...pinnedIndexes])].sort((a, b) => a - b),
    measureElement: (element, entry) => {
      const height = entry?.borderBoxSize[0]?.blockSize ?? element.getBoundingClientRect().height;
      const id = element.getAttribute('data-row-id');
      if (id) sizes.current.set(id, height);
      return height;
    },
  });
  // The shared coordinator is the single geometry compensation writer.
  virtualizer.shouldAdjustScrollPositionOnItemSizeChange = () => false;
  const visible = new Set(virtualizer.getVirtualItems().map(item => item.index));
  useDeliveryPosition(surface, deliveryRestoring ? readingDelivery : undefined, sessionId);
  useConversationScroll(surface, {
    sessionId, ready: !!stream.snapshot && !deliveryRestoring, rows,
    revision: stream.scrollRevision, isBrowsing: stream.isBrowsing, browse: stream.browse,
    reachBottom: () => { if (!selection.current) stream.reachBottom(); },
  });
  useLayoutEffect(() => {
    const node = prefix.current;
    if (!node) return;
    const measure = () => setMargin(node.getBoundingClientRect().height);
    const observer = new ResizeObserver(measure); observer.observe(node); measure();
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    // Bound the measurement cache as pages leave the 180-row data window.
    const current = new Set(rows.map(row => row.id));
    for (const id of sizes.current.keys()) if (!current.has(id)) sizes.current.delete(id);
  }, [rows]);
  const pinReading = useCallback(() => {
    const node = surface.current;
    if (!node) return;
    const picked = new Set<string>();
    const focus = document.activeElement?.closest<HTMLElement>('[data-row-id]');
    if (focus && node.contains(focus)) { picked.add(focus.dataset.rowId!); stream.browse(); }
    const selected = window.getSelection();
    selection.current = !!selected && !selected.isCollapsed && !!selected.anchorNode && node.contains(selected.anchorNode);
    if (selection.current && selected) {
      stream.browse();
      for (const row of node.querySelectorAll<HTMLElement>('[data-row-id]')) {
        if (selected.containsNode(row, true)) picked.add(row.dataset.rowId!);
      }
    }
    setPinned(previous => { const next = [...picked]; return previous.join('|') === next.join('|') ? previous : next; });
  }, [stream.browse]);
  useEffect(() => {
    document.addEventListener('selectionchange', pinReading);
    return () => document.removeEventListener('selectionchange', pinReading);
  }, [pinReading]);
  const manual = () => { if (deliveryRestoring) { setDeliveryRestoring(false); stream.browse(); } };
  const error = stream.navigationError;
  return <SyntaxScope id={sessionId}>
    <nav aria-label="历史导航" className="flex h-9 flex-none items-center gap-2 overflow-x-auto whitespace-nowrap" aria-busy={stream.paging}>
      {stream.snapshot?.before !== undefined && <Button variant="outline" size="sm" disabled={stream.paging || selection.current} onClick={() => void stream.older()}>{error?.direction === 'older' ? '重试查看更早' : '查看更早'}</Button>}
      {stream.snapshot?.after !== undefined && <Button variant="outline" size="sm" disabled={stream.paging || selection.current} onClick={() => void stream.newer()}>{error?.direction === 'newer' ? '重试查看较新' : '查看较新'}</Button>}
      {(stream.historyMode || stream.snapshot?.after !== undefined || deliveryRestoring) && <Button variant="outline" size="sm" disabled={stream.loadingDirection === 'latest'} onClick={() => { setDeliveryRestoring(false); window.getSelection()?.removeAllRanges(); void stream.latest(); }}>{error?.direction === 'latest' ? '重试返回最新' : '返回最新'}</Button>}
      <span role="status" className="text-xs text-muted">{error?.message ?? (stream.paging ? '正在读取…' : '')}</span>
    </nav>
    <div ref={surface} data-testid={create ? 'create-timeline' : 'timeline'} data-reading-surface
      aria-label={create ? '创造任务记录' : '任务时间线'} tabIndex={0}
      className={create ? 'h-96 min-h-0 overflow-auto' : 'min-h-0 flex-1 overflow-auto'}
      style={{ overflowAnchor: 'none' }} onWheelCapture={manual} onPointerDownCapture={manual}
      onTouchStartCapture={manual} onKeyDownCapture={manual} onFocusCapture={pinReading} onBlurCapture={() => queueMicrotask(pinReading)}>
      <div data-conversation-content>
        <div ref={prefix}><RuntimeSlot slot="session-header" mode={create?"create":"work"} sessionId={sessionId} />{children}</div>
        {turns.map(turn => <section key={turn.id} aria-label="任务轮次" data-turn-id={turn.id}>
        {turn.rows.map((row, turnIndex) => { const index = indexes.get(row.id)!; return <div key={row.id} data-row-id={row.id} data-index={index}
          ref={visible.has(index) ? virtualizer.measureElement : undefined}
          style={{ display: 'flow-root', height: visible.has(index) ? undefined : (sizes.current.get(row.id) ?? 160) }}>
          {visible.has(index) && <>
            {turnIndex === 0 && <TurnHeading turn={turn}><InspectionButton compact sessionId={sessionId} runId={row.runId} /></TurnHeading>}
            {!(turn.summaryOnly && turnIndex === 0) && <SavedRow row={row} sessionId={sessionId} create={create} target={create?stream.snapshot?.session.binding?.target.id:undefined} live={stream.liveRows.has(row.id)} claimLivePanel={claimLivePanel} />}
          </>}
        </div>; })}
        </section>)}
      </div>
    </div>
  </SyntaxScope>;
}
