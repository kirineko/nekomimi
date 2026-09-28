export interface LifecycleEvidence {
  version: 1; resourceId: string; revision: string; stage: 'created' | 'updated' | 'static' | 'preview' | 'simulation' | 'host' | 'loaded' | 'load-failed';
  contributionId?: string; passed?: boolean; sessionId?: string; runId?: string; at: string; host: string;
}
export interface Ability {
  key: string; resourceId: string; revision: string; name: string; scope: string; type: string; localId?: string;
  activeRevision?: string; missing: string[]; granted: string[]; required: string[];
  phase: string; previousEvidence?: LifecycleEvidence[]; evidence: LifecycleEvidence[]; source?: LifecycleEvidence; updatedAt?: string;
  candidateId?: string; error?: string; sourceAvailable?: boolean; relatedSessions?: string[];
}
