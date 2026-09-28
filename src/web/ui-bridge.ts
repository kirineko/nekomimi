import {createContext} from 'react';
export interface UiBridge {sessionId?:string;enabled?:boolean;handle:(action:string,value:any,resourceId?:string)=>Promise<unknown>}
export const UiBridgeContext=createContext<UiBridge>({handle:async()=>{throw new Error('此区域不支持宿主操作');}});
