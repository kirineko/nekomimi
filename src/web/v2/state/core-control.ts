import { useQuery } from '@tanstack/react-query';
import type { CoreControlStatus, CoreSwitchCommand, CoreSwitchResult } from '../../../shared/core-control.js';
import { validId } from '../../../shared/protocol.js';
import { api } from '../../api.js';
import { v2Host } from './query.js';

export const coreStatusKey = () => ['v2', v2Host(), 'core-status'];
export function useCoreStatus(poll = false) {
  return useQuery({ queryKey: coreStatusKey(), queryFn: ({ signal }) => api<CoreControlStatus>('/core/status', undefined, signal),
    refetchInterval: poll ? 2000 : false, retry: false, staleTime: 0 });
}
export interface SavedSwitch {
  version: 1; sessionId: string; candidateId: string; installationId: string; expectedBuild: string; fromBuild: string;
  request: CoreSwitchCommand;
}
const digest = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const key = (sessionId: string, candidateId: string) => `v2-core-switch:${location.host}:${sessionId}:${candidateId}`;
export function readSwitch(sessionId: string, candidateId: string): SavedSwitch | undefined {
  try {
    const value = JSON.parse(sessionStorage.getItem(key(sessionId, candidateId)) ?? 'null') as SavedSwitch | null;
    if (value?.version === 1 && value.sessionId === sessionId && value.candidateId === candidateId && digest(value.installationId)
      && digest(value.expectedBuild) && digest(value.fromBuild) && value.request?.authorize === true
      && typeof value.request.commandId === 'string' && validId(value.request.commandId)
      && typeof value.request.validationId === 'string' && validId(value.request.validationId) && digest(value.request.planHash) && digest(value.request.artifactRevision)) return value;
  } catch { /* Untrusted local state cannot authorize a request. */ }
  return undefined;
}
export function saveSwitch(value: SavedSwitch) {
  // A lost connection must not also lose the command identity on reload.
  sessionStorage.setItem(key(value.sessionId, value.candidateId), JSON.stringify(value));
}
export function forgetSwitch(value: SavedSwitch) { sessionStorage.removeItem(key(value.sessionId, value.candidateId)); }
export function checkedReceipt(value: CoreSwitchResult | null, pending: SavedSwitch) {
  if (value === null) return null;
  if (value?.version !== 1 || value.commandId !== pending.request.commandId || value.planHash !== pending.request.planHash
    || !['applied', 'failed', 'unknown'].includes(value.status) || value.applied !== (value.status === 'applied')
    || (value.actualBuild !== undefined && !digest(value.actualBuild))
    || (value.status === 'applied' && value.actualBuild !== pending.expectedBuild)) throw Error('切换回执与确认命令不一致；结果待核对。');
  return value;
}
export const commandText = (executable: string, args: string[]) => [executable, ...args].map(value => `'${value.replaceAll("'", "'\\''")}'`).join(' ');

export function savedSwitches(): SavedSwitch[] {
  const result: SavedSwitch[] = [];
  try {
    const prefix = `v2-core-switch:${location.host}:`;
    for (let index = 0; index < sessionStorage.length && result.length < 50; index++) {
      const name = sessionStorage.key(index);
      if (!name?.startsWith(prefix)) continue;
      const [sessionId, candidateId] = name.slice(prefix.length).split(':');
      if (!sessionId || !candidateId || !validId(sessionId) || !validId(candidateId)) continue;
      const value = readSwitch(sessionId, candidateId); if (value) result.push(value);
    }
  } catch { /* Browser storage failure does not issue any command. */ }
  return result;
}
