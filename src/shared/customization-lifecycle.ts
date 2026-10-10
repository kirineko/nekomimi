import type { SessionBinding, SessionTarget } from "./protocol.js";
export interface CustomizationOrigin {
  sessionId: string; runId?: string; ownerWorkspace: string; target: SessionTarget; scope: "project" | "user";
}
export interface VerificationEnvironment {
  node: string; platform: string; arch: string; sdkVersion: number;
  hostBuild?: string; compilerVersion?: string; sdkHash?: string;
}
export interface VerificationResult {
  stage: 'static' | 'simulation' | 'preview' | 'host';
  status: 'passed' | 'failed' | 'cancelled' | 'unknown' | 'observed';
  hostIntegration: 'not_run' | 'observed' | 'passed' | 'failed';
  resourceId: string; resourceRevision: string;
  environment: VerificationEnvironment;
  check?: string;
}
export interface LifecycleEvidence {
  version: 1; resourceId: string; revision: string; stage: 'created' | 'updated' | 'static' | 'preview' | 'simulation' | 'host' | 'loaded' | 'load-failed';
  sourceBinding?: SessionBinding;
  verification?: VerificationResult; environment?: VerificationEnvironment; status?: VerificationResult["status"]; check?: string;
  contributionId?: string; passed?: boolean; sessionId?: string; runId?: string; at: string; host: string;
  diagnostics?: { stage: string; file?: string; line?: number; column?: number; message: string }[];
}
export interface Ability {
  key: string; resourceId: string; revision: string; name: string; scope: string; type: string; localId?: string;
  origin?: CustomizationOrigin; changeOrigin?: "controlled" | "observed" | "unknown"; changeKind?: "created" | "updated" | "observed-update" | "unknown";
  activeRevision?: string; missing: string[]; granted: string[]; required: string[];
  phase: string; previousEvidence?: LifecycleEvidence[]; evidence: LifecycleEvidence[]; source?: LifecycleEvidence; updatedAt?: string;
  candidateId?: string; error?: string; sourceAvailable?: boolean; relatedSessions?: string[];
}
