import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { createRootRoute, createRoute, createRouter, Link, Outlet, RouterProvider } from '@tanstack/react-router';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Group, Panel, Separator } from 'react-resizable-panels';
import * as Dialog from '@radix-ui/react-dialog';
import { Button } from './button';
import './styles.css';

type Mode = 'work' | 'create';
const drafts: Record<Mode, string> = { work: '', create: '' };
const states = ['正常', '加载', '空', '错误', '已取消', '待授权'];
const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
function useNarrow() {
  const [narrow, set] = useState(matchMedia('(max-width: 760px)').matches);
  useEffect(() => { const m = matchMedia('(max-width: 760px)'); const change = () => set(m.matches); m.addEventListener('change', change); return () => m.removeEventListener('change', change); }, []);
  return narrow;
}
function ThemeDialog() {
  return <Dialog.Root><Dialog.Trigger asChild><Button variant="outline">主题预览</Button></Dialog.Trigger><Dialog.Portal><Dialog.Overlay className="overlay"/><Dialog.Content className="dialog"><Dialog.Title>主题与外观</Dialog.Title><Dialog.Description>仅预览语义 tokens，不应用产品主题。</Dialog.Description><div className="dialog-actions"><Button onClick={() => document.documentElement.dataset.theme = 'light'}>浅色</Button><Button onClick={() => document.documentElement.dataset.theme = 'dark'}>深色</Button><Dialog.Close asChild><Button variant="outline">关闭</Button></Dialog.Close></div></Dialog.Content></Dialog.Portal></Dialog.Root>;
}
function Workbench({ mode }: { mode: Mode }) {
  const narrow = useNarrow(), create = mode === 'create';
  const [state, setState] = useState('正常'), [draft, setDraft] = useState(drafts[mode]);
  const [chunks, setChunks] = useState(0), [running, setRunning] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const query = useQuery({ queryKey: ['fixture-host', mode, 'target'], queryFn: async () => ({ name: create ? 'Nekomimi / 扩展候选' : '用户项目 / example-app' }) });
  const virtual = useVirtualizer({ count: 300, getScrollElement: () => scrollRef.current, estimateSize: () => 104, overscan: 5 });
  useEffect(() => { if (!running) return; const timer = setInterval(() => setChunks(n => n + 1), 40); return () => clearInterval(timer); }, [running]);
  const changeDraft = (value: string) => { drafts[mode] = value; setDraft(value); };
  const navigation = <nav aria-label="会话导航" className="sidebar"><p className="eyebrow">{create ? 'CREATION' : 'WORKSPACE'}</p><h2>{create ? '创造空间' : '我的项目'}</h2><button className="nav-active">{create ? '代码审查能力' : '修复登录表单'}</button><button>{create ? '主题候选' : '整理测试用例'}</button><button>{create ? '交付记录' : '执行历史'}</button><div className="sidebar-foot">只读验证切片<br/>无真实模型 · 无应用权限</div></nav>;
  const details = <aside className="details" aria-label="证据侧栏"><p className="eyebrow">{create ? 'CANDIDATE' : 'INSPECTOR'}</p><h2>{create ? '候选与验证' : '结果与证据'}</h2><div className="card"><span className="badge">{create ? '草稿 v3' : '可追溯'}</span><h3>{create ? '/review 扩展' : '请求输入'}</h3><p>{create ? '静态检查成功不等于已经应用。' : 'Journal → ContextView → WireRequest'}</p></div><div className="card"><h3>{create ? '应用范围' : '上下文预算'}</h3><p>{create ? '项目级 · example-app' : '估算 12.4k / 128k'}</p><div className="meter"><span/></div><p className="muted">示例数据，不代表实际测量。</p></div><Button variant="outline" onClick={() => setState('待授权')}>{create ? '查看应用确认' : '查看完整证据'}</Button></aside>;
  const content = <main className="conversation"><div className="conversation-head"><div><p className="eyebrow">{create ? 'CREATE MODE' : 'WORK MODE'}</p><h1>{create ? '为工作交付新能力' : '专注当前项目'}</h1></div><span role="status" className="badge" data-state={state}>{state}</span></div>
    <p className="scope">{query.data?.name ?? '读取目标…'} · {create ? '候选未应用' : '仅当前工作区'}</p>
    <div className="fixture-controls"><label>样稿状态 <select aria-label="样稿状态" value={state} onChange={e => setState(e.target.value)}>{states.map(s => <option key={s}>{s}</option>)}</select></label><Button size="sm" variant="outline" onClick={() => { setRunning(v => !v); setState('正常'); }}>{running ? '暂停模拟流' : '模拟流'}</Button><span data-testid="chunks">{chunks} chunks</span></div>
    <div className="timeline" ref={scrollRef} data-testid="timeline" aria-label="任务时间线" tabIndex={0}>
      {state === '正常' ? <div style={{ height: virtual.getTotalSize(), position: 'relative', width: '100%' }}>{virtual.getVirtualItems().map(item => <article className="message" key={item.key} data-index={item.index} ref={virtual.measureElement} style={{ position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${item.start}px)` }}><span className="message-role">{item.index % 2 ? 'NEKOMIMI' : 'YOU'} · {String(item.index + 1).padStart(3, '0')}</span><p>{item.index % 2 ? (create ? '先生成隔离候选，保留每次验证证据，等待你确认后再应用。' : '我会先核对项目约束，再检查相关代码；修改和验证会分别记录。') : (create ? '请创建一个只读代码审查命令。' : '请检查登录表单，并说明每个修改的原因。')}{item.index === 0 && chunks > 0 ? ` 已接收${chunks}个片段。` : ''}</p>{item.index === 2 && <img alt="延迟加载的候选预览" src="/delayed.svg" style={{ display: 'block', width: '100%', maxWidth: 400 }}/>}</article>)}</div> : <div className="state-card" role={state === '错误' ? 'alert' : undefined}><h2>{{ 加载: '正在读取可靠状态…', 空: '从一个清晰的任务开始', 错误: '验证失败，原候选保持不变', 已取消: '已停止继续派发', 待授权: '等待明确授权' }[state]}</h2><p>这是技术切片的状态样稿，没有调用模型或提交应用。</p>{state === '待授权' && <Button disabled>未接入授权服务</Button>}{state === '错误' && <Button variant="outline" onClick={() => setState('正常')}>返回时间线</Button>}</div>}
    </div>
    <footer className="composer"><label htmlFor={`draft-${mode}`}>任务草稿</label><textarea id={`draft-${mode}`} aria-label="任务草稿" value={draft} onChange={e => changeDraft(e.target.value)} placeholder={create ? '描述想交付的能力…' : '描述当前任务…'}/><div><span className="muted">草稿与会话模式独立 · 模拟数据</span><Button onClick={() => { setRunning(false); setState('已取消'); }}>停止</Button></div></footer>
  </main>;
  return <><header className="topbar"><div className="brand"><span className="mark">=^.^=</span><strong>Nekomimi</strong><span className="badge">技术样稿</span></div><div className="mode-nav"><Link to="/work" className={!create ? 'selected' : ''}>工作</Link><Link to="/create" className={create ? 'selected' : ''}>创造</Link></div><ThemeDialog/></header>{narrow ? <div className="mobile-layout">{content}<details><summary>导航与证据</summary>{navigation}{details}</details></div> : <Group orientation="horizontal" className="workspace" style={{ height: 'calc(100dvh - 70px)' }} onLayoutChanged={layout => localStorage.setItem(`layout-${mode}`, JSON.stringify(layout))}><Panel id="nav" defaultSize="19%" minSize="14%">{navigation}</Panel><Separator aria-label="调整导航宽度" className="separator"/><Panel id="chat" defaultSize="56%" minSize="35%">{content}</Panel><Separator aria-label="调整证据宽度" className="separator"/><Panel id="details" defaultSize="25%" minSize="20%">{details}</Panel></Group>}</>;
}
const rootRoute = createRootRoute({ component: () => <Outlet/> });
const workRoute = createRoute({ getParentRoute: () => rootRoute, path: '/work', component: () => <Workbench key="work" mode="work"/> });
const createModeRoute = createRoute({ getParentRoute: () => rootRoute, path: '/create', component: () => <Workbench key="create" mode="create"/> });
const indexRoute = createRoute({ getParentRoute: () => rootRoute, path: '/', component: () => <Workbench key="work" mode="work"/> });
const router = createRouter({ routeTree: rootRoute.addChildren([workRoute, createModeRoute, indexRoute]) });
declare module '@tanstack/react-router' { interface Register { router: typeof router } }
createRoot(document.getElementById('root')!).render(<QueryClientProvider client={queryClient}><RouterProvider router={router}/></QueryClientProvider>);
