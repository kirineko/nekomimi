import { useEffect, useRef, useState } from 'react';
import { api } from '../../api';
import type { PanelMount } from '../../components/CustomPanel';

/** A prepared preview can render but cannot call any host action. Navigation never runs a factory. */
export function CandidatePreviewFrame({ frame, title, sessionId }: { frame: PanelMount; title: string; sessionId: string }) {
  const iframe = useRef<HTMLIFrameElement>(null), generation = useRef(0), loads = useRef(0), [error, setError] = useState(''), [ready, setReady] = useState(false), [height, setHeight] = useState(220);
  useEffect(() => {
    const owner = ++generation.current;
    let channel: MessageChannel | undefined, live = true, messages = 0;
    const timer = setTimeout(() => { if (live) setError('预览未完成握手，请关闭后显式重试。'); }, 10000);
    const receive = (event: MessageEvent) => {
      if (channel || event.source !== iframe.current?.contentWindow || event.data?.kind !== 'ready' || event.data?.version !== 1 || event.data?.instanceId !== frame.instanceId || event.data?.nonce !== frame.nonce) return;
      clearTimeout(timer); channel = new MessageChannel(); setReady(true);
      channel.port1.onmessage = message => {
        if (!live) return;
        const value = message.data;
        let size = Infinity; try { size = JSON.stringify(value).length; } catch {}
        if (++messages > 1000 || value?.instanceId !== frame.instanceId || size > 32768) { setError('预览消息无效或超限'); channel?.port1.close(); return; }
        if (value.kind === 'resize' && Number.isFinite(value.height)) setHeight(Math.max(100, Math.min(700, value.height)));
        else if (value.kind === 'crash') setError('预览运行失败；已保留文本回退。');
        else if (value.kind === 'request') channel?.port1.postMessage({ kind: 'response', instanceId: frame.instanceId, id: value.id, error: '预览不允许宿主操作' });
      };
      iframe.current!.contentWindow!.postMessage({ kind: 'connect', version: 1, nonce: frame.nonce, instanceId: frame.instanceId }, '*', [channel.port2]);
    };
    window.addEventListener('message', receive);
    return () => { live = false; clearTimeout(timer); window.removeEventListener('message', receive); channel?.port1.close(); queueMicrotask(() => { if (generation.current === owner) void api('/customization', { action: 'panel-unmount', instanceId: frame.instanceId, sessionId }).catch(() => {}); }); };
  }, [frame, sessionId]);
  return <section aria-label="候选预览内容" className="mt-4 rounded-lg border border-line p-3">
    {!ready && !error && <p role="status">正在连接预览…</p>}
    {error ? <p role="alert" className="text-danger">{error}</p> : <iframe ref={iframe} title={`候选预览 ${title}`} src={frame.url + '?session=' + encodeURIComponent(sessionId)} sandbox="allow-scripts" referrerPolicy="no-referrer" className="w-full border-0" style={{ height }} onLoad={() => { if (++loads.current > 1) setError('预览导航已停止，请显式重新运行。'); }} />}
    {(!ready || error) && <p className="text-sm text-muted">{frame.fallback}</p>}
  </section>;
}
