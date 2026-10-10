import {useSessionCatalog} from './session-catalog';
import { useQuery } from '@tanstack/react-query';
import type { SessionTarget } from '../../../shared/protocol';
import type { Ability, LifecycleEvidence } from '../../../shared/customization-lifecycle';
import type { ValidationTask } from '../../../shared/validation-task';
import type { ResourceDescriptor } from '../../../customization/types';
import { api } from '../../api';
import { v2Host, v2Key } from './query';
export interface CustomizationDescribe {
  candidates: string[]; abilities: Ability[]; busy: boolean; degraded?: string;
  resources: ResourceDescriptor[]; activeResources: ResourceDescriptor[];
  settingsRevision: number; userWrites: boolean;
  managedRevision: number; managed: { name: string; revision: string; previous?: string }[];
  receipts: { id: string; status: string; error?: string }[];
  panels: import('../../components/CustomPanel').PanelView[];
  workflowBusy: boolean;
  workflowDefinitions: import('../routes/workflow-controls').WorkflowDefinitionView[];
  workflows: import('../routes/workflow-controls').WorkflowView[];
  packages: { packageId: string; scope: 'project' | 'user'; revision: string; previous?: string; manifest: { name: string; version: string } }[];
  packageCandidates: { id: string; scope: 'project' | 'user'; name: string; revision: string }[];
  packageRevisions: { project: number; user: number };
  oauth: { server: string; issuer?: string; clientId?: string; status: string; expiresAt?: number }[];
  mcp: { id: string; diagnostics: string; toolErrors: { name: string; error: string }[]; content?: unknown }[];
}
export interface CandidateView {
  id: string; name: string; path: string; resourceId: string; contentHash: string; activeRevision: number; previousRevision?: string;
  requestedCapabilities: string[]; addedCapabilities: string[]; target?: SessionTarget;
  rollback?: { contentHash: string; requestedCapabilities: string[] }; rollbackError?: string;
  host: { version: string; build: string }; evidence: LifecycleEvidence[]; previousEvidence: LifecycleEvidence[];
  validationTasks: ValidationTask[];
  files: { name: string; change: string; before?: string; after?: string; truncated: boolean }[];
}
export const createKey = (sessionId?: string, ...parts: unknown[]) => v2Key(v2Host(), 'create', sessionId ?? 'host', sessionId, ...parts);
export function useCreateSessions() {
  return useSessionCatalog('create');
}
export function useCustomization(sessionId?: string) {
  return useQuery<CustomizationDescribe>({ queryKey: createKey(sessionId, 'customization'), refetchInterval: query => query.state.data?.busy || query.state.data?.receipts.some(receipt => receipt.status === 'pending') || query.state.data?.oauth?.some(item => item.status === 'authorizing') || query.state.data?.workflowBusy || query.state.data?.workflows?.some(item => item.status === 'running') ? 1000 : false, queryFn: ({ signal }) => api<CustomizationDescribe>('/customization' + (sessionId ? '?session=' + encodeURIComponent(sessionId) : ''), undefined, signal) });
}
export function useCandidate(candidateId: string, sessionId?: string) {
  return useQuery<CandidateView>({ queryKey: createKey(sessionId, 'candidate', candidateId), enabled: /^[a-z0-9-]{1,100}$/.test(candidateId), retry: false,
    refetchInterval: query => query.state.data?.validationTasks.some(task => ['running', 'cancelling'].includes(task.status)) ? 750 : false,
    queryFn: ({ signal }) => api<CandidateView>('/customization/candidates/' + encodeURIComponent(candidateId) + (sessionId ? '?session=' + encodeURIComponent(sessionId) : ''), undefined, signal) });
}

/** A deep link resolves its own session, independently of the loaded catalog page. */
export function useCreateSession(sessionId?:string) {
  return useQuery({queryKey:createKey(sessionId,'session-info'),enabled:!!sessionId,retry:false,refetchInterval:5000,queryFn:async({signal})=>{
    const snapshot=await api<import('../../../shared/protocol').Snapshot>(`/sessions/${sessionId}/snapshot`,undefined,signal);
    if(snapshot.session.binding?.mode!=='create')throw Error('该会话不是创造会话');
    return snapshot.session;
  }});
}
