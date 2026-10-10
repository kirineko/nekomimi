import type { ReactNode } from 'react';
import type { ReadableTurn } from './readable-turns';
import { statusText } from '../../presentation';

export function TurnHeading({turn, children}: {turn: ReadableTurn; children?: ReactNode}) {
  return <header className="flex flex-wrap items-center gap-2 border-t border-line pt-3 text-xs text-muted">
    <span className="sr-only">任务轮次</span>
    {turn.status && <span>{statusText(turn.status)}</span>}
    {!turn.status && turn.calls.length > 0 && <span>当前记录未包含任务结束状态</span>}
    {turn.calls.length > 0 && <details className="min-w-0">
      <summary className="cursor-pointer">全部调用 · {turn.calls.length}</summary>
      <ul>{turn.calls.map(call => <li key={call.id}>{call.title} · {statusText(call.status)}</li>)}</ul>
    </details>}
    {children && (turn.status || turn.calls.length > 0) && <span>{children}</span>}
  </header>;
}
