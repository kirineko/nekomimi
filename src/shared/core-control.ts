/** Browser-facing observations. Historical selections never imply a live process. */
export interface CoreControlStatus {
  mode: 'managed' | 'unmanaged'; phase?: 'running' | 'switching' | 'stopped'; switchSupported: boolean;
  installation?: { version: number; id: string; entry: string };
  identity?: { version: string; build: string; entry?: string };
  blockers?: { kind: string; id?: string; sessionId?: string; target?: string; state?: string }[];
}
export interface CoreSwitchPlan {
  version: 1; installationId: string; planHash: string;
  from: { identity: { version: string; build: string }; artifactRevision: string; buildId: string };
  candidate: { validationId: string; buildId: string; candidateId: string; artifactRevision: string; directory: string; build: string };
  impact: { workspace: string; home: string; action: string; activeInstallationFilesChanged: boolean; healthFailure: string };
  contracts: { api: number; sdk: number; data: number }; node: string; platform: string; arch: string;
}
export interface CoreSwitchCommand {
  commandId: string; planHash: string; validationId: string; artifactRevision: string; authorize: boolean;
}
export interface CoreSwitchResult {
  version: 1; commandId: string; planHash: string; status: 'applied' | 'failed' | 'unknown'; applied: boolean; actualBuild?: string; error?: string;
}
export interface CoreLaunchInfo {
  installation: { version: number; id: string; entry: string }; currentMode: 'unmanaged'; switchSupported: false;
  applied: false; managedLaunchSupported: boolean; buildId: string; artifactRevision: string;
  manual: { executable: string; args: string[] }; explanation: string;
}
export interface CoreRecoveryView {
  version: number; installation: { version: number; id: string; entry: string }; planHash: string;
  lastConfirmedSelection: Record<string, unknown> | null; previousConfirmedSelection: Record<string, unknown> | null;
  running: 'not-observed'; applied: false; tasksReplayed: false;
  interrupted: { commandId: string; planHash: string }[];
  groups: { group: number; state: 'absent' | 'present' | 'unknown' }[];
  blockers: { group: number; state: 'absent' | 'present' | 'unknown' }[]; unobservedProcesses: string[];
  launcher: { requiresBuild: boolean; executable?: string; args?: string[] };
}
