export type ModelOperation = 'chat' | 'classifier' | 'image';
export type ModelPurpose = 'main' | 'work' | 'create' | 'auxiliary' | 'naming' | 'session-title' | 'compaction' | 'handoff' | 'classifier' | 'image';
export interface ModelProfile { id: string; providerId: string; resourceId: string; model: string; operation?: ModelOperation; routing?: 'physical'; baseUrl: string; paths: string[]; credentialRef?: string }
export interface ModelState { id: string; credentialStatus: string; available: boolean; unavailableReason?: string }
export interface ModelManagement {
  busy: boolean;
  defaultModel: { providerId: string; model: string; baseUrl: string; protocol: string; configured: boolean };
  providers: Array<{ id: string; resourceId?: string; revision: string; models: Array<{ id: string; name: string; protocol: string; operation: ModelOperation; identity: string; available: boolean; configured: boolean; credentialStatus: string; unavailableReason?: string; profileStates: ModelState[] }> }>;
  providerProfiles: { revision: number; entries: Record<string, ModelProfile>; selection: Partial<Record<ModelPurpose, string>> };
}
