import type {ContextOccupancy,SessionMode} from './protocol.js';
export interface ContextSelectionView {
  id:string;source:string;hash:string;role:string;layer:string;scope?:string;decision:'include'|'exclude';reason:string;eventId?:string;itemIndex?:number;version?:string;sourceHash?:string;sources?:string[];transformations?:string[];projection?:{eventId:string;full:{sha256:string;bytes:number};projected:{sha256:string;bytes:number};version:number};
}
export interface ContextDetailsView {
  sessionId:string;mode?:SessionMode;targetId?:string;measurement?:ContextOccupancy;compacting:boolean;unavailableReason?:string;
  nextSnapshotBefore?:number;
  snapshots:Array<{eventId:string;seq:number;revision:string;purpose:string;modelCallId?:string}>;
  snapshot?:{eventId:string;seq:number;revision:string;contextRevision:string;purpose:string;mode:string;targetId?:string;model:{id:string;provider:string;protocol:string};capabilityRevision:string;handoffs:Array<{handoffId:string;payloadHash:string;sourceSessionId:string;sourceMode:string;decision:string;reason:string;sourceAvailable:boolean}>;nextHandoff?:number;artifact:{sha256:string;bytes:number};selection:ContextSelectionView[];total:number;included:number;excluded:number;next?:number};
  compactions:Array<{eventId:string;seq:number;status:string;runId?:string;operation?:string;sourceRevision?:string;before?:number;after?:number;summary?:string;summaryTruncated:boolean;error?:string;referenceCount:number;references:Array<{eventId:string;itemIndex:number;hash:string}>;artifact?:{sha256:string;bytes:number};previous?:string;source?:unknown;retention?:unknown;retainedFrom?:unknown;summaryHash?:string;nextReference?:number;attemptIds:string[]}>;
  nextCompactionBefore?:number;
}
