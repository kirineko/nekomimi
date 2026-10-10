import { createContext, createElement, useContext, type ReactNode } from 'react';
import { useSession } from "../../hooks/useSession.js";
import type { StreamStatus } from "../../hooks/session-projection.js";
import { validId } from '../../../shared/protocol.js';
import { useStreamHandoffInvalidation } from './stream-invalidation.js';
export { reduce, type StreamStatus, type StreamState } from "../../hooks/session-projection.js";

const CurrentSession = createContext<{sessionId?:string;state:ReturnType<typeof useSession>} | undefined>(undefined);

/** One transport per window/session. Extra readers must not consume HTTP/1
 * connection slots or maintain competing history windows. */
export function SessionStreamProvider({sessionId,children}:{sessionId?:string;children:ReactNode}) {
  const selected=sessionId&&validId(sessionId)?sessionId:undefined;
  const state=useSession(selected);
  const mode=state.snapshot?.session.binding?.mode ?? 'work';
  useStreamHandoffInvalidation(selected,mode,state.snapshot?.cursor.seq);
  return createElement(CurrentSession.Provider,{value:{sessionId:selected,state}},children);
}

export function useSessionStream(sessionId: string | undefined) {
  const current=useContext(CurrentSession),selected=sessionId&&validId(sessionId)?sessionId:undefined;
  if(!current||current.sessionId!==selected)throw new Error('会话流与当前工作台不匹配');
  const state=current.state;
  return { ...state, status: state.connection as StreamStatus,
    snapshot: state.snapshot?.session.id === selected ? state.snapshot : undefined };
}
