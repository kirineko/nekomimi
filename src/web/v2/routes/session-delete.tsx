import {useRef,useState} from 'react';
import {useNavigate} from '@tanstack/react-router';
import {useQueryClient} from '@tanstack/react-query';
import type {SessionInfo,SessionMode} from '../../../shared/protocol';
import {api} from '../../api';
import {Button} from '../../ui/Button';
import {DialogRoot,DialogContent,DialogTitle,DialogDescription,DialogActions} from '../../ui/Dialog';
import {sessionCatalogKey} from '../state/session-catalog';

export function SessionDeleteDialog({session,mode,active,close,opener}:{session:SessionInfo;mode:SessionMode;active?:string;close:()=>void;opener?:HTMLElement|null}) {
  const [target,setTarget]=useState(session),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const lock=useRef(false),cancel=useRef<HTMLButtonElement>(null),client=useQueryClient(),navigate=useNavigate();
  const act=async(remove:boolean)=>{
    if(lock.current)return;lock.current=true;setBusy(true);setError('');
    try{
      if(remove){
        await api(`/sessions/${session.id}/delete`,{version:1});
        await client.invalidateQueries({queryKey:sessionCatalogKey(mode)});
        close();if(active===session.id)void navigate({to:mode==='work'?'/work':'/create'});
      }else{
        await api(`/sessions/${session.id}/cancel`,{version:1,runId:target.naming?target.namingRunId:target.runId});
        const snapshot=await api<{session:SessionInfo}>(`/sessions/${session.id}/snapshot`);setTarget(snapshot.session);
      }
    }catch(cause){setError(cause instanceof Error?cause.message:String(cause));}
    finally{lock.current=false;setBusy(false);}
  };
  return <DialogRoot open onOpenChange={open=>{if(!open&&!lock.current)close();}}><DialogContent aria-busy={busy}
    onOpenAutoFocus={event=>{event.preventDefault();cancel.current?.focus();}}
    onCloseAutoFocus={event=>{event.preventDefault();queueMicrotask(()=>{if(opener?.isConnected)opener.focus();else document.querySelector<HTMLElement>('[data-session-catalog-focus]')?.focus();});}}
    onEscapeKeyDown={event=>{if(lock.current)event.preventDefault();}} onPointerDownOutside={event=>{if(lock.current)event.preventDefault();}}>
    <DialogTitle>删除会话「{session.title}」？</DialogTitle>
    <DialogDescription>删除会话记录与附件，保留工作区文件。此操作不可撤销。</DialogDescription>
    <p className="text-sm">关联会话、候选和已应用能力会保留；原会话证据将无法再查看。</p>
    {error&&<p role="alert" className="text-sm text-danger">{error}</p>}
    <DialogActions>
      <Button variant="destructive" busy={busy} onClick={()=>void act(true)}>确认删除</Button>
      <Button ref={cancel} variant="outline" disabled={busy} onClick={close}>取消</Button>
      <Button variant="outline" disabled={busy} aria-label="关闭删除确认" onClick={close}>关闭</Button>
      {(['running','cancelling'].includes(target.status)||target.naming)&&<Button variant="outline" disabled={busy} onClick={()=>void act(false)}>停止运行</Button>}
    </DialogActions>
  </DialogContent></DialogRoot>;
}
export function DeleteSession({session}:{session:SessionInfo}) {
  const [open,setOpen]=useState(false),trigger=useRef<HTMLButtonElement>(null);
  return <><Button ref={trigger} size="sm" variant="outline" onClick={()=>setOpen(true)}>删除</Button>{open&&<SessionDeleteDialog session={session} mode={session.binding?.mode ?? 'work'} active={session.id} opener={trigger.current} close={()=>setOpen(false)} />}</>;
}
