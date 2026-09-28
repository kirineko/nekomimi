import {useEffect,useRef} from 'react';
export function ExportDialog({busy,redact,setRedact,close,download,error}:{error?:string;busy:boolean;redact:string;setRedact:(text:string)=>void;close:()=>void;download:(format:string)=>Promise<void>}){
 const dialog=useRef<HTMLDialogElement>(null);
 useEffect(()=>{const opener=document.activeElement as HTMLElement|null;dialog.current?.showModal();return()=>{dialog.current?.close();opener?.focus();};},[]);
 return <dialog ref={dialog} className="export-dialog" aria-label="导出对话" onCancel={e=>{e.preventDefault();close();}} onClick={e=>{if(e.target===e.currentTarget){const r=e.currentTarget.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)close();}}}>
  <header><div><h2>导出对话</h2><p>带走内容，或保存排查问题所需的记录。</p></div><button aria-label="关闭导出" onClick={close}>×</button></header>
  <div className="export-formats"><button disabled={busy} onClick={()=>void download('html')}><strong>下载 HTML</strong><small>可离线阅读的对话页面</small></button><button disabled={busy} onClick={()=>void download('bundle')}><strong>下载诊断包</strong><small>完整会话与执行证据</small></button></div>
  <details><summary>隐私与脱敏</summary><label>需要脱敏的文本（每行一项）<textarea value={redact} onChange={e=>setRedact(e.target.value)}/></label><p>脱敏包不可继续会话。</p></details>
  {error&&<p role="alert" className="error">{error}</p>}
  {busy&&<p role="status">正在准备，请稍候…</p>}
  <footer><button onClick={close}>完成</button></footer>
 </dialog>;
}
