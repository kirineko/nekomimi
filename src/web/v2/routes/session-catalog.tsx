import {Menu} from '../../ui/Menu';
import {deferred} from '../deferred';
const SessionDeleteDialog=deferred('v2/routes/session-delete.tsx','SessionDeleteDialog','删除确认',()=>import('./session-delete').then(module=>module.SessionDeleteDialog));
import {useEffect,useId,useRef,useState} from 'react';
import {Link} from '@tanstack/react-router';
import type {SessionInfo,SessionMode} from '../../../shared/protocol';
import {sessionTime} from '../../session-time';
import {statusText} from '../../presentation';
import {Button} from '../../ui/Button';
import {Badge} from '../../ui/Badge';
import {DevOnly} from '../dev-only';
import type {useSessionCatalog} from '../state/session-catalog';

export function SessionCatalog({mode,active,query}:{mode:SessionMode;active?:string;query:ReturnType<typeof useSessionCatalog>}) {
  const [now,setNow]=useState(Date.now),[timeOpen,setTimeOpen]=useState<string>();
  const timeId=useId();
  const [menu,setMenu]=useState<string>(),[deleting,setDeleting]=useState<SessionInfo>();
  const opener=useRef<HTMLElement|null>(null);
  useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),30000);return()=>clearInterval(timer);},[]);
  useEffect(()=>{setTimeOpen(undefined);setMenu(undefined);},[active]);
  const rows=query.data?.sessions ?? [];
  return <section aria-label={mode==='work'?'工作会话列表':'创造会话列表'} aria-busy={query.isFetching} className="min-w-0 space-y-2" data-session-catalog-focus tabIndex={-1}>
    {query.isPending&&<p role="status" className="text-sm">读取会话…</p>}
    {query.isError&&<div role="alert" className="text-xs text-danger">会话列表不可用：{String(query.error)}<Button size="sm" variant="outline" onClick={()=>void query.refetch()}>重试会话列表</Button></div>}
    {query.data?.restarted&&<p role="status" className="text-xs">会话顺序已更新，已重新读取第一页。</p>}
    {query.data&&!rows.length&&<p className="text-sm text-muted">还没有会话。</p>}
    <ul className="m-0 list-none space-y-1 p-0">{rows.map((session,index)=>{
      const time=sessionTime(session.activityAt,now),previous=index?sessionTime(rows[index-1]!.activityAt,now).group:undefined;
      return <li key={session.id} className="min-w-0">
        {previous!==time.group&&<h3 className="py-2 text-xs text-muted">{time.group}</h3>}
        <div className={`min-w-0 rounded-md p-2 ${session.id===active?'bg-wash':'hover:bg-wash/60'}`}>
          <div className="flex min-w-0 items-center gap-1"><Link to={mode==='work'?'/work/session/$sessionId':'/create/session/$sessionId'} params={{sessionId:session.id}} title={session.title} aria-current={session.id===active?'page':undefined} className="block min-w-0 flex-1 truncate text-sm font-semibold" data-session-title>{session.title}</Link>
          <Menu open={menu===session.id} onOpenChange={open=>setMenu(previous=>open?session.id:previous===session.id?undefined:previous)} ariaLabel={`会话操作 ${session.title}`} align="end"
            trigger={<Button size="sm" variant="outline" onFocus={event=>{opener.current=event.currentTarget;}}>···</Button>}
            items={[{id:'delete',label:`删除会话 ${session.title}`,danger:true,onSelect:()=>setDeleting(session)}]} />
          </div>
          <div className="flex min-w-0 flex-wrap items-center gap-1 text-xs">
            <span className={['idle','completed'].includes(session.status)?'text-muted':'font-semibold'}>{statusText(session.status)}</span>
            <button type="button" className="min-w-0 truncate rounded-sm border-0 bg-transparent p-0 text-left text-muted underline decoration-dotted underline-offset-2" aria-label={`活动时间 ${session.title}：${time.full}`} aria-expanded={timeOpen===session.id} aria-controls={timeOpen===session.id?`${timeId}-${session.id}`:undefined}
              onClick={()=>setTimeOpen(timeOpen===session.id?undefined:session.id)} onBlur={()=>setTimeOpen(undefined)} onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();setTimeOpen(undefined);}}}><time dateTime={time.iso}>{time.relative}</time></button>
          </div>
          {timeOpen===session.id&&<p id={`${timeId}-${session.id}`} className="break-words text-xs">{time.full}</p>}
          {mode==='create'&&<CreateTarget session={session} />}
        </div>
      </li>;
    })}</ul>
    {query.data?.next!==undefined&&<Button size="sm" variant="outline" disabled={query.isFetching} onClick={query.more}>更多会话</Button>}
    <DevOnly><Button size="sm" variant="outline" disabled={query.isFetching} onClick={()=>void query.refetch()}>刷新会话列表</Button></DevOnly>
    {deleting&&<SessionDeleteDialog loadClose={()=>{setDeleting(undefined);opener.current?.focus();}} key={deleting.id} session={deleting} mode={mode} active={active} opener={opener.current} close={()=>setDeleting(undefined)} />}
  </section>;
}
function CreateTarget({session}:{session:SessionInfo}) {
  return <div className="mt-1 break-all text-xs text-muted">{session.binding?.target.kind==='core'?'核心':'扩展'} · {session.binding?.target.root}{session.targetState==='unavailable'&&<Badge state="warning">目标不可用</Badge>}</div>;
}
