export interface ValidationDiagnostic {
  stage: "manifest" | "syntax" | "type" | "dependency";
  code: number | string;
  message: string;
  resourceId: string;
  contentHash: string;
  file?: string;
  line?: number;
  column?: number;
}

export interface ValidationTask {
  version: 1;
  id: string;
  sessionId: string;
  candidateId: string;
  contentHash: string;
  hostBuild: string;
  target: string;
  stage: 'static' | 'simulation' | 'preview';
  requestHash?: string;
  result?: { trialSession?: string; text?: string; instanceId?: string };
  status: 'running' | 'cancelling' | 'passed' | 'failed' | 'cancelled' | 'unknown';
  cancelRequested: boolean;
  startedAt: string;
  finishedAt?: string;
  diagnostics?: ValidationDiagnostic[];
  error?: string;
  logs: { at: string; message: string }[];
}
