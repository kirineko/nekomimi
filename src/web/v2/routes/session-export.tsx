import { useEffect, useId, useRef, useState } from 'react';
import { request } from '../../api';
import { Button } from '../../ui/Button';
import { Textarea } from '../../ui/Input';
import { DialogActions, DialogClose } from '../../ui/Dialog';

export function ExportContent({sessionId}:{sessionId:string}) {
  const redactId=useId();
  const [redact,setRedact]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const controller=useRef<AbortController|undefined>(undefined);
  useEffect(()=>()=>controller.current?.abort(),[sessionId]);
  const download=async(format:'html'|'bundle')=>{
    if(controller.current)return;
    const abort=new AbortController();controller.current=abort;setBusy(true);setError('');
    try {
      const response=await request(`/sessions/${sessionId}/export`,{method:'POST',signal:abort.signal,body:JSON.stringify({version:1,format,redact:redact.split('\n').filter(Boolean)})});
      const blob=await response.blob();if(abort.signal.aborted)return;
      const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=`session-${sessionId}.${format==='html'?'html':'tar'}`;
      link.click();setTimeout(()=>URL.revokeObjectURL(url),5000);
    } catch(cause) {if(!abort.signal.aborted)setError(cause instanceof Error?cause.message:String(cause));}
    finally {if(controller.current===abort){controller.current=undefined;setBusy(false);}}
  };
  return <>
      <div className="mt-4 flex flex-wrap gap-2"><Button disabled={busy} onClick={()=>void download('html')}>下载 HTML</Button><Button variant="outline" disabled={busy} onClick={()=>void download('bundle')}>下载诊断包</Button></div>
      <details className="mt-4 text-sm"><summary>隐私与脱敏</summary><label htmlFor={redactId} className="block">需要脱敏的文本（每行一项）</label><Textarea id={redactId} value={redact} onChange={event=>setRedact(event.target.value)} /><p>脱敏包不可继续会话；此输入只保留到本次窗口关闭。</p></details>
      {busy&&<p role="status">正在准备下载…</p>}{error&&<p role="alert" className="break-words text-sm text-danger">导出失败：{error}</p>}
      <DialogActions><DialogClose asChild><Button variant="outline">{busy?'取消导出':'完成'}</Button></DialogClose></DialogActions>
  </>;
}
