import type { DeliverySnapshot, HandoffPreview } from './protocol.js';

export interface HandoffRelationsView {
  items: Array<{
    handoffId: string; direction: string; sourceSessionId: string; targetSessionId: string; payloadHash: string;
    sourceAvailable: boolean; targetAvailable: boolean; sourceSnapshotRetained: boolean; targetSnapshotRetained: boolean;
    sourceEvidence: string; snapshot: HandoffPreview; createsTask: boolean; grantsPermissions: boolean;
  }>;
}
export interface DeliveriesView {
  items: Array<{
    handoffId: string; payloadHash: string; sourceSessionId: string; targetSessionId: string;
    snapshot: DeliverySnapshot[]; sourceAvailable: boolean; targetAvailable: boolean;
    current: Array<{
      resourceId: string; revision: string; versionState: string; targetAvailable: boolean; error?: string;
      work?: { phase: string; entries: string[]; missing: string[]; applied: boolean; workResourceId?: string;
        workActiveRevision?: string; currentContentHash?: string; matchesDeliveredContent: boolean;
        filesDifferFromActive: boolean; executesCommand: boolean; grantsPermissions: boolean };
    }>;
    consumedBy: Array<{ eventId: string; runId?: string; commandId?: string }>;
    receivedEventId?: string; executesCommand: boolean; grantsPermissions: boolean;
  }>;
}

export interface HandoffStatesView {
  items: Array<{
    handoffId: string; commandId: string; sourceSessionId: string; targetSessionId: string;
    payloadHash: string; sourceRevision: import('./protocol.js').Cursor; phase: string; status: string;
    receipt?: import('./protocol.js').HandoffReceipt; error?: string; createsTask: boolean; grantsPermissions: boolean;
  }>;
}
