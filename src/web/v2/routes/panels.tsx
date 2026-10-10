import { useContext, useState } from 'react';
import { CustomPanel, type PanelView } from '../../components/CustomPanel';
import { UiBridgeContext } from '../../ui-bridge';
import { Button } from '../../ui/Button';
import { Select, Textarea } from '../../ui/Input';
import { EmptyState, ErrorState } from '../../ui/StateCard';
import { useCustomization } from '../state/create';
import { PanelBoundary } from '../slots';
export function PanelsPage({ sessionId, mode }: { sessionId?: string; mode: 'work' | 'create' }) {
  const query = useCustomization(sessionId);
  const [selected, setSelected] = useState(''), [props, setProps] = useState('{}'), [workflow, setWorkflow] = useState(''), [error, setError] = useState('');
  const [live, setLive] = useState<{ key: string; panel: PanelView; props: string; workflow?: string; preview: boolean }>();
  const bridge = useContext(UiBridgeContext);
  if (query.isPending) return <EmptyState title="正在读取面板…" busy />;
  if (!query.data) return <ErrorState title="面板目录不可读" detail={String(query.error)} actions={<Button onClick={() => void query.refetch()}>重新读取面板</Button>} />;
  const data = query.data, panel = data.panels.find(item => `${item.resourceId}|${item.id}` === selected);
  const open = (preview: boolean) => {
    if (!panel) return;
    try {
      const value: unknown = JSON.parse(props);
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('面板数据需要 JSON 对象');
      if (new TextEncoder().encode(props).length > 32768) throw new Error('面板数据不能超过 32 KiB');
      setError(''); setLive({ key: crypto.randomUUID(), panel, props, workflow: preview ? undefined : workflow || undefined, preview });
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  };
  const disabled = !panel || !bridge.enabled || data.busy || mode === 'create' && !sessionId;
  return <div className="min-w-0 space-y-4"><header className="space-y-2"><h1 className="text-xl">面板管理</h1><Button variant="outline" onClick={() => void query.refetch()}>刷新面板目录</Button></header>
    <p className="text-sm">面板需明确打开；刷新页面或离开此页会关闭实例。预览不允许面板操作。填写草稿不会自动发送；已有草稿需要选择保留、追加或替换。</p>
    {!sessionId && <p>{mode === 'create' ? '请先进入绑定的创造目标。' : '请从工作会话进入面板管理。'}</p>}
    {query.isError && <p role="alert">刷新失败：{String(query.error)}</p>}
    {!data.panels.length && <EmptyState title="暂无已加载面板" detail="启用声明面板的资源后，可在此查看和打开。" />}
    <section className="space-y-3" aria-label="打开或预览面板">
      <label className="block text-sm">面板定义<Select className="block max-w-full" aria-label="面板定义" value={selected} onChange={event => { setSelected(event.target.value); setWorkflow(''); }}><option value="">选择面板</option>{data.panels.map(item => <option key={`${item.resourceId}|${item.id}`} value={`${item.resourceId}|${item.id}`}>{item.title ?? item.id} · {item.slot}</option>)}</Select></label>
      {panel && <p className="break-all text-xs">资源 {panel.resourceId} · 版本 {panel.revision}</p>}
      <label className="block text-sm">面板数据 JSON<Textarea aria-label="面板数据 JSON" value={props} onChange={event => setProps(event.target.value)} /></label>
      <label className="block text-sm">关联工作流<Select className="block max-w-full" aria-label="关联工作流" value={workflow} onChange={event => setWorkflow(event.target.value)}><option value="">不关联</option>{data.workflows.filter(item => item.resourceId === panel?.resourceId && item.mode === mode).map(item => <option key={item.id} value={item.id}>{item.id} · {item.status}</option>)}</Select></label>
      {error && <p role="alert" className="break-all text-sm text-danger">{error}</p>}
      <div className="flex flex-wrap gap-2"><Button variant="outline" disabled={disabled} onClick={() => open(true)}>预览面板</Button><Button disabled={disabled} onClick={() => open(false)}>打开面板</Button>{live && <Button variant="outline" onClick={() => setLive(undefined)}>关闭面板实例</Button>}</div>
    </section>
    {live && <PanelBoundary key={live.key} fallback={live.panel.fallback}><UiBridgeContext.Provider value={bridge}><CustomPanel key={live.key} panel={live.panel} propsJson={live.props} workflowId={live.workflow} preview={live.preview} /></UiBridgeContext.Provider></PanelBoundary>}
  </div>;
}
