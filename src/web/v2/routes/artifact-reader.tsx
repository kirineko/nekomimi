import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api';
import { Button } from '../../ui/Button';
export function ArtifactReader({ sessionId, hash, label }: { sessionId: string; hash: string; label: string }) {
  const [open, setOpen] = useState(false), [offset, setOffset] = useState(0);
  const query = useQuery({ queryKey: ['v2', location.host, sessionId, 'context-artifact', hash, offset], enabled: open,
    queryFn: ({ signal }) => api<{ text: string; encoding: string; next?: number; bytes: number }>(`/sessions/${sessionId}/artifacts/${hash}?offset=${offset}&limit=12000`, undefined, signal), retry: false });
  return <div className="space-y-2"><Button variant="outline" size="sm" onClick={() => setOpen(!open)}>{open ? '收起' : '读取'}{label}</Button>{open && <>
    <p className="break-all text-xs">SHA256 {hash}</p>{query.isPending && <p role="status">读取附件…</p>}{query.isError && <p role="alert">附件不可读：{query.error.message}</p>}
    {query.data && <><p className="text-xs">偏移 {offset} / {query.data.bytes} bytes · {query.data.encoding}</p><pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all text-xs">{query.data.text}</pre><div className="flex gap-2"><Button size="sm" variant="outline" disabled={!offset} onClick={() => setOffset(0)}>附件开头</Button><Button size="sm" variant="outline" disabled={query.data.next === undefined} onClick={() => setOffset(query.data!.next!)}>继续读取附件</Button></div></>}
  </>}</div>;
}
