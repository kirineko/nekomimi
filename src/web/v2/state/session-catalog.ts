import {useRef,useState} from 'react';
import {useQuery} from '@tanstack/react-query';
import type {SessionMode,SessionPage} from '../../../shared/protocol';
import {api,ClientError} from '../../api';
import {v2Host,v2Key} from './query';

export const sessionCatalogKey=(mode:SessionMode)=>v2Key(v2Host(),mode,mode==='work'?'default':'host',undefined,'sessions');
/** Rebuild the requested window against one revision. A changed order resets to page one. */
export function useSessionCatalog(mode:SessionMode) {
  const [size,setSize]=useState(30);
  const last=useRef<{mode:SessionMode;data:SessionPage & {restarted:boolean}}|undefined>(undefined);
  const query=useQuery<SessionPage & {restarted:boolean}>({
    queryKey:[...sessionCatalogKey(mode),'window',size],
    refetchInterval:5000,
    placeholderData:(previous,previousQuery)=>previousQuery?.queryKey[2]===mode?previous:undefined,
    queryFn:async({signal})=>{
      const first=()=>api<SessionPage>(`/sessions?mode=${mode}&limit=30`,undefined,signal);
      let page=await first(),sessions=page.sessions,restarted=false;
      try {
        while(page.next!==undefined&&sessions.length<size){
          page=await api<SessionPage>(`/sessions?mode=${mode}&limit=30&offset=${page.next}&revision=${encodeURIComponent(page.listRevision)}`,undefined,signal);
          sessions=[...sessions,...page.sessions];
        }
      }catch(error){
        if(!(error instanceof ClientError)||error.code!=='list_changed')throw error;
        page=await first();sessions=page.sessions;restarted=true;
      }
      return {...page,sessions:[...new Map(sessions.map(session=>[session.id,session])).values()],restarted};
    },
  });
  if(query.data&&!query.isPlaceholderData)last.current={mode,data:query.data};
  const data=query.data ?? (last.current?.mode===mode?last.current.data:undefined);
  return {...query,data,more:()=>{if(!query.isFetching&&data?.next!==undefined)setSize(Math.max(size,data.sessions.length)+30);}};
}
