import type { PanelView } from "../CustomPanel";
import type { WorkflowView, WorkflowDefinitionView } from "../WorkflowManagement";
import type { ResourceDescriptor } from "../../../customization/types";
export interface Management {
  panels: PanelView[];
  workflows: WorkflowView[];
  workflowDefinitions: WorkflowDefinitionView[];
  providers: { id: string; resourceId?: string; revision: string; models: { id: string; name: string; protocol: string }[] }[];
  providerProfiles: { revision: number; entries: Record<string, { id: string; providerId: string; model: string; baseUrl: string }>; selection: { main?: string; auxiliary?: string; naming?: string } };
  oauth: { server: string; status: string; issuer?: string; clientId?: string }[];
  packages: { packageId: string; scope: "project" | "user"; revision: string; previous?: string; manifest: { name: string; version: string } }[];
  packageCandidates: { id: string; scope: "project" | "user"; name: string; revision: string }[];
  candidates: string[];
  managed: { name: string; revision: string; previous?: string }[];
  resources: ResourceDescriptor[];
  userWrites: boolean;
  settingsRevision: number;
  activeRevision?: string;
  busy: boolean;
  degraded?: string;
  mcp: {
    id: string;
    diagnostics: string;
    toolErrors: { name: string; error: string }[];
  }[];
  activeResources: ResourceDescriptor[];
  receipts: { id: string; status: string; error?: string }[];
}

export type ManagementAction = (value: object) => Promise<unknown>;
