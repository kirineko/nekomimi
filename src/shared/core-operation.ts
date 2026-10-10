export interface CoreOperationInput {
  commandId: string;
  sessionId: string;
  candidateId: string;
  target: string;
  hostBuild: string;
  kind: 'build' | 'validation';
  inputHash?: string;
  buildId?: string;
  artifactRevision?: string;
}
export interface CoreOperation extends CoreOperationInput {
  version: 1;
  requestHash: string;
  status: 'running' | 'cancelling' | 'passed' | 'failed' | 'cancelled' | 'unknown';
  cancelRequested: boolean;
  startedAt: string;
  finishedAt?: string;
  resultId?: string;
  error?: string;
}
export interface CoreBuildReview {
  candidateId: string;
  sourceRevision: string;
  inputHash: string;
  lockHash: string;
  buildScript: string;
  targetHost: { build: string };
  toolchain: { node: { version: string; path: string }; npm: { version: string; path: string }; platform: string; arch: string };
  commands: { executable: string; args: string[] }[];
  policy: { timeoutMs: number; logBytes: number; environment: string };
}
