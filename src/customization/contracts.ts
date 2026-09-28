import {createHash} from "node:crypto";
import type {ResourceIdentity} from "./sdk-contracts.js";
export * from "./sdk-contracts.js";
export {SDK_CAPABILITIES,V2_CAPABILITIES} from "./capabilities.js";
export type {Capability} from "./capabilities.js";
export const CONTRACT_VERSIONS = Object.freeze({sdk:2,package:1,lock:1,rpc:1,ui:1});
export function legacyIdentity(resourceId: string, revision: string): ResourceIdentity {
  return { resourceId, revision, stateNamespace: resourceId };
}
export function packageIdentity(sourceIdentity: string, packageName: string, resourceName: string, revision: string): ResourceIdentity {
  const packageId = createHash("sha256").update(JSON.stringify([sourceIdentity, packageName])).digest("hex");
  const resourceId = `pkg:${packageId}:${resourceName}`;
  return { packageId, resourceId, revision, stateNamespace: resourceId };
}
export function requireCapabilities(required: readonly string[], available: readonly string[]): void {
  const unknown = required.filter(c => !available.includes(c));
  if (unknown.length) throw new Error(`Unsupported capabilities: ${unknown.join(", ")}`);
}
