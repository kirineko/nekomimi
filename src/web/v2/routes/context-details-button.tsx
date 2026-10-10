import { useState } from 'react';
import type { ContextOccupancy } from '../../../shared/protocol';
import { Button } from '../../ui/Button';
import { DialogRoot, DialogTrigger, DialogContent, DialogTitle, DialogDescription, DialogClose } from '../../ui/Dialog';
import { deferred } from '../deferred';
const ContextDetails = deferred('v2/routes/context-details.tsx', 'ContextDetails', '上下文详情', () => import('./context-details').then(module => module.ContextDetails));
const count = (value: number | undefined) => value === undefined ? '未知' : value.toLocaleString();
export function ContextDetailsButton({ sessionId, measurement,initialSnapshot,label='上下文详情' }: { sessionId: string; measurement?: ContextOccupancy;initialSnapshot?:string;label?:string }) {
  const [open, setOpen] = useState(false);
  return <DialogRoot open={open} onOpenChange={setOpen}><DialogTrigger asChild><Button variant="outline" size="sm" aria-label={label} title={measurement ? `估算 ${count(measurement.totalTokens)} tokens` : '查看当前投影与历史选择'}>{initialSnapshot?label:'上下文'}{measurement ? ` · ${count(measurement.totalTokens)}` : ''}</Button></DialogTrigger>
    <DialogContent className="max-h-[85dvh] overflow-y-auto break-words p-4"><div className="flex items-center justify-between gap-2"><DialogTitle>上下文详情</DialogTitle><DialogClose asChild><Button variant="outline" size="sm">关闭详情</Button></DialogClose></div><DialogDescription>只读查看当前估算、历史选择和压缩来源。</DialogDescription>{open && <ContextDetails loadClose={() => setOpen(false)} key={`${sessionId}:${initialSnapshot??'current'}`} sessionId={sessionId} initialSnapshot={initialSnapshot} />}</DialogContent>
  </DialogRoot>;
}
