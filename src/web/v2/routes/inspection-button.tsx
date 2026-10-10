import { useState } from 'react';
import { Button } from '../../ui/Button';
import { DialogRoot,DialogTrigger,DialogContent,DialogTitle,DialogDescription,DialogClose } from '../../ui/Dialog';
import { deferred } from '../deferred';
const Inspection = deferred('v2/routes/inspection.tsx', 'Inspection', '调用证据', () => import('./inspection').then(module => module.Inspection));
/** compact：用于每轮标题行——热区 24px，但负外边距抵消，行高保持一行文字，避免布局位移。 */
export function InspectionButton({sessionId,runId,compact=false}:{sessionId:string;runId?:string;compact?:boolean}){
  const [open,setOpen]=useState(false);
  return <DialogRoot open={open} onOpenChange={setOpen}><DialogTrigger asChild><Button size="sm" variant={compact?"ghost":"outline"} className={compact?"-my-1 h-6 px-2 text-xs text-muted":undefined}>{compact?"查看证据":"查看调用证据"}</Button></DialogTrigger><DialogContent className="max-h-[85dvh] w-[min(960px,calc(100vw-32px))] overflow-y-auto break-words p-4"><div className="flex items-center justify-between gap-2"><DialogTitle>调用证据</DialogTitle><DialogClose asChild><Button size="sm" variant="outline">关闭调用证据</Button></DialogClose></div><DialogDescription>检查嵌套调用、逐次请求与响应，读取已有证据不会执行代码。</DialogDescription>{open&&<Inspection key={sessionId} sessionId={sessionId} initialRun={runId} loadClose={() => setOpen(false)} />}</DialogContent></DialogRoot>;
}
