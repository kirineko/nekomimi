import type { SessionTarget } from './protocol.js';

/** Read-only browser projection; a recorded pass is not a fresh artifact admission. */
export interface CoreCandidateView {
  id: string;
  directory: string;
  sourceRoot: string;
  baselineRevision: string;
  currentRevision: string;
  target: SessionTarget;
  hostMatches: boolean;
  preparedAt: string;
  packageVersion: string;
  lockHash: string;
  buildCommand: string;
  files: { path: string; change: 'added' | 'removed' | 'modified'; beforeHash?: string; afterHash?: string; beforeBytes?: number; afterBytes?: number; before?: string; beforeError?: string; after?: string; truncated?: boolean; binary?: boolean }[];
  excluded: string[];
  historyErrors: string[];
  omittedTasks: number;
  tasks: {
    id: string;
    commandId: string;
    kind: 'build' | 'validation';
    status: 'passed' | 'failed' | 'cancelled' | 'unknown' | 'unconfirmed';
    startedAt: string;
    finishedAt?: string;
    sourceRevision?: string;
    inputHash?: string;
    buildId?: string;
    artifactRevision?: string;
    error?: string;
    checks: string[];
    logs: { at: string; channel: string; text?: string; error?: string; truncated?: boolean }[];
    omittedLogs: number;
  }[];
}
