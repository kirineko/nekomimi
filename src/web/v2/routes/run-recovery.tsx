import {useRef,useState} from 'react';
import type {SessionMode} from '../../../shared/protocol';
import {useDraft} from '../state/drafts';
import {Button} from '../../ui/Button';
import {DialogRoot,DialogContent,DialogTitle,DialogDescription,DialogActions} from '../../ui/Dialog';
const continuation='请从已完成的进度继续任务，先检查现有结果，不要重复已完成的操作。结果未知的操作先核对，不要自动重跑。';
/** Continuing prepares a draft only; it never resumes a run or dispatches a command. */
export function RunRecovery({sessionId,mode,target}:{sessionId:string;mode:SessionMode;target:string}) {
  const draft=useDraft(mode,target,sessionId),[open,setOpen]=useState(false);
  const trigger=useRef<HTMLButtonElement>(null),cancel=useRef<HTMLButtonElement>(null),applied=useRef(false);
  const focusDraft=()=>{const editor=[...document.querySelectorAll<HTMLElement>('[data-session-input]')].find(node=>node.dataset.sessionInput===sessionId);editor?.focus({preventScroll:true});editor?.scrollIntoView({block:'nearest'});};
  const apply=(replace:boolean)=>{const current=draft.get();draft.set(replace||!current.trim()?continuation:current+'\n'+continuation);applied.current=true;setOpen(false);};
  return <DialogRoot open={open} onOpenChange={setOpen}>
    <Button ref={trigger} variant="outline" size="sm" onClick={()=>{applied.current=false;if(draft.get().trim())setOpen(true);else{draft.set(continuation);focusDraft();}}}>继续任务</Button>
    <DialogContent onOpenAutoFocus={event=>{event.preventDefault();cancel.current?.focus();}} onCloseAutoFocus={event=>{event.preventDefault();if(applied.current)focusDraft();else trigger.current?.focus();}}>
      <DialogTitle>保留当前草稿</DialogTitle><DialogDescription>继续说明只写入当前会话草稿，不会自动发送或重跑操作。</DialogDescription>
      <DialogActions><Button ref={cancel} variant="outline" onClick={()=>setOpen(false)}>保留原草稿</Button><Button variant="outline" onClick={()=>apply(false)}>追加到草稿</Button><Button onClick={()=>apply(true)}>替换草稿</Button></DialogActions>
    </DialogContent>
  </DialogRoot>;
}
