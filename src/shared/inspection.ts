import type { EvidenceRef } from './protocol.js';
export interface InspectionNode {
  id:string;kind:'model'|'tool';label:string;seq:number;parent?:string;parentMissing?:boolean;parentReference?:string;mode?:string;targetId?:string;status:string;children:number;
  modelCallId?:string;toolCallId?:string;operation?:string;purpose?:string;provider?:string;model?:string;
}
export interface AttemptView {
  id:string;seq:number;status:string;model?:string;provider?:string;operation?:string;purpose?:string;
  input:number|null;output:number|null;cacheRead:number|null;elapsedMs?:number;firstByteMs?:number;httpStatus?:number;retry?:unknown;
}
export interface InspectionEvent {
  eventId:string;seq:number;type:string;timestamp:string;attemptId?:string;payload:unknown;links:Record<string,unknown>;artifacts:EvidenceRef[];
  images:Array<{index:number;mimeType:string;artifact:EvidenceRef}>;
}
export interface InspectionView {
  sessionId:string;runId?:string;runs:Array<{id:string;seq:number}>;nextRunBefore?:number;
  nodes:InspectionNode[];total:number;next?:number;
  usage:{attempts:number;input:number;output:number;cacheRead:number;missingInput:number;missingOutput:number;missingCache:number;cost:null;unknownCostAttempts:number};
  detail?:{node:InspectionNode;attempts:AttemptView[];nextAttempt?:number;events:InspectionEvent[];nextEvent?:number;eventTotal:number};
}
