import {AsyncFeature} from "./components/AsyncFeature";
import {features} from "./features";
import {UiBridgeContext} from "./ui-bridge";
import {RuntimeViews,RuntimeViewsContext} from "./components/RuntimeViews";
import {CustomPanel,type PanelView} from "./components/CustomPanel";
import {RuntimeTheme, type ThemeCatalog} from "./components/RuntimeTheme";
import { useSessionList } from "./hooks/useSessionList";
import { DeleteSessionDialog } from "./components/DeleteSessionDialog";
import {ExtensionInteractions} from "./components/ExtensionInteractions";
import { SyntaxScope } from "./components/Markdown";
import {WorkspacePanel} from "./components/WorkspacePanel";
import {LocateFile, type PanelTab} from "./workspace-context";
import { DiagnosticNotice } from "./components/DiagnosticNotice";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Receipt, SessionInfo, TimelineRow } from "../shared/protocol";
import { api, connect, request } from "./api";
import { useSession } from "./hooks/useSession";
import { Sidebar } from "./components/Sidebar";
import { Timeline, statusText } from "./components/Timeline";

import { Settings } from "./components/Settings";
import { Composer } from "./components/Composer";
export function App() {
  const [config, setConfig] = useState<{
    workspace: string;
    configured: boolean;
  }>();
  const [runtimeViews,setRuntimeViews]=useState<PanelView[]>([]),[uiDisabled,setUiDisabled]=useState(false),[page,setPage]=useState<PanelView>(),[uiDraft,setUiDraft]=useState<{id:string;text:string}>();
  useEffect(()=>{const reset=()=>{setUiDisabled(true);setPage(undefined);};window.addEventListener("nekomimi-ui-reset",reset);return()=>window.removeEventListener("nekomimi-ui-reset",reset);},[]);
  const [themeCatalog,setThemeCatalog]=useState<ThemeCatalog>();
  const refreshUi=useCallback(()=>{void api<{runtimeUi:ThemeCatalog;panels:PanelView[]}>("/runtime-ui").then(v=>{setThemeCatalog(old=>JSON.stringify(old)===JSON.stringify(v.runtimeUi)?old:v.runtimeUi);setRuntimeViews(old=>{const views=v.panels.filter(p=>!["sidebar","result"].includes(p.slot));return JSON.stringify(old)===JSON.stringify(views)?old:views;});}).catch(()=>{});},[]);
  useEffect(()=>{if(config){refreshUi();const timer=setInterval(refreshUi,1500);return()=>clearInterval(timer);}},[config,refreshUi]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [deliveryTarget,setDeliveryTarget]=useState<{resourceId:string;revision:string}>();
  const [customizationOpen, setCustomizationOpen] = useState(false);
  const [deleting, setDeleting] = useState<SessionInfo>();
  const [commandRevision, setCommandRevision] = useState(0);
  const [error, setError] = useState("");
  const { sessions, setSessions, next, load, loading: listLoading, error: listError } = useSessionList();
  const [selected, setSelected] = useState<string | undefined>(
    new URLSearchParams(location.search).get("session") ?? undefined,
  );
  const conversation = useRef<HTMLElement>(null);
  const follow = useRef(true);
  const scrollIntent=useRef(0);
  const programScroll=useRef<number|undefined>(undefined);
  const positionScroll=(el:HTMLElement,top:number)=>{el.scrollTop=top;programScroll.current=el.scrollTop;};
  const [inputContext,setInputContext]=useState(0);
  const selectionEpoch=useRef(0);
  const [panelOpen, setPanelOpen] = useState(false);
  const [panelTab, setPanelTab] = useState<PanelTab>("files");
  const [locateRevision, setLocateRevision] = useState(0);
  const [located, setLocated] = useState<string>();
  const [inspection, setInspection] = useState<TimelineRow>();
  const [sidebar, setSidebar] = useState(false);
  const locateFile = useCallback((path: string) => {
    setLocated(path);
    setLocateRevision((n) => n + 1);
    setPanelTab("files");
    setPanelOpen(true);
    setSidebar(false);
  }, []);
  const inspect = useCallback((row: TimelineRow) => {
    setInspection(row);
    setPanelTab("trace");
    setPanelOpen(true);
    setSidebar(false);
  }, []);
  const [exportOpen, setExportOpen] = useState(false);
  const [redact, setRedact] = useState("");
  const [downloading, setDownloading] = useState(false);
  const [creating, setCreating] = useState(false);
  const pending = useRef<{ text: string; id: string } | undefined>(undefined);
  const {
    snapshot, liveRows, browse, reachBottom, navigationError, loadingDirection, newer, historyMode, hasNew, paging, scrollRevision,
    connection,
    error: streamError,
    older,
    latest,
  } = useSession(config ? selected : undefined);
  useEffect(() => {
    void connect()
      .then((value) => {
        setConfig(value);
        return load();
      })
      .catch((e) => setError(String(e)));
  }, [load]);
  useEffect(() => {
    if (snapshot)
      setSessions((old) =>
        old.map((s) => (s.id === snapshot.session.id ? snapshot.session : s)),
      );
  }, [snapshot?.session.status, snapshot?.session.id, snapshot?.session.title, snapshot?.session.activityAt]);
  useEffect(() => { if (config) void load(); }, [config, snapshot?.session.activityAt, snapshot?.session.status, connection, load]);
  useEffect(() => {
    const refresh = () => { if (config) { void load(); setCommandRevision(n => n + 1); } };
    window.addEventListener("focus", refresh); window.addEventListener("online", refresh);
    return () => { window.removeEventListener("focus", refresh); window.removeEventListener("online", refresh); };
  }, [config, load]);
  useLayoutEffect(() => {
    if (follow.current && !historyMode && conversation.current)
      positionScroll(conversation.current,conversation.current.scrollHeight);
  }, [snapshot?.rows, snapshot?.session.id, historyMode, scrollRevision]);
  useLayoutEffect(() => {
    if (!scrollRevision || !conversation.current) return;
    follow.current = true;
    positionScroll(conversation.current,conversation.current.scrollHeight);
  }, [scrollRevision]);
  const readingAnchor = useRef<{id:string;offset:number}|undefined>(undefined);
  const captureAnchor = useCallback(() => {
    const container=conversation.current;if(!container)return;
    const top=container.getBoundingClientRect().top;
    const row=Array.from(container.querySelectorAll<HTMLElement>('[data-row-id]')).find(el=>el.getBoundingClientRect().bottom>top+40);
    readingAnchor.current=row?{id:row.dataset.rowId!,offset:row.getBoundingClientRect().top-top}:undefined;
  },[]);
  useLayoutEffect(()=>{
    const container=conversation.current;
    if(!container)return;
    const restore=()=>{
      if(!historyMode){if(follow.current)positionScroll(container,container.scrollHeight);return;}
      const anchor=readingAnchor.current;if(!anchor)return;
      const row=Array.from(container.querySelectorAll<HTMLElement>('[data-row-id]')).find(el=>el.dataset.rowId===anchor.id);
      if(row)positionScroll(container,container.scrollTop+row.getBoundingClientRect().top-container.getBoundingClientRect().top-anchor.offset);
    };
    restore();
    const observer=new ResizeObserver(restore);
    const content=container.querySelector('.timeline');if(content)observer.observe(content);
    return()=>observer.disconnect();
  },[snapshot?.rows,historyMode]);
  useEffect(()=>{
    const open=()=>setCustomizationOpen(false);
    const manage=(event:Event)=>{setDeliveryTarget((event as CustomEvent).detail);setCustomizationOpen(true);};
    window.addEventListener('nekomimi-theme-open',open);
    window.addEventListener('nekomimi-customization-open',manage);
    return()=>{window.removeEventListener('nekomimi-theme-open',open);window.removeEventListener('nekomimi-customization-open',manage);};
  },[]);
  const clearSelection = () => {
    selectionEpoch.current++;setInputContext(n=>n+1);
    setSelected(undefined);
    setInspection(undefined);
    pending.current = undefined;
    history.replaceState(null, "", location.pathname);
  };
  useEffect(() => {
    if (connection === "deleted") {
      clearSelection();
      void load();
    }
  }, [connection, load]);
  const refreshConfig = async () => {
    setConfig(await api("/config"));
    await load();
    setCommandRevision(n => n + 1);
    refreshUi();
  };
  const choose = (id: string, fromSubmit=false) => {
    if(!fromSubmit){selectionEpoch.current++;setInputContext(n=>n+1);}
    follow.current = true;
    setSelected(id);
    setInspection(undefined);
    setSidebar(false);
    pending.current = undefined;
    history.replaceState(null, "", `?session=${id}`);
  };
  const create = async (fromSubmit=false) => {
    const epoch=selectionEpoch.current;
    setCreating(true);
    try {
      const session = await api<SessionInfo>("/sessions", {
        version: 1,
        title: "新会话",
      });
      await load();
      if(epoch===selectionEpoch.current)choose(session.id,fromSubmit);
      return session.id;
    } finally {
      setCreating(false);
    }
  };
  const submit = async (text: string) => {
    const epoch=selectionEpoch.current;
    const sessionId = selected ?? (await create(true));
    if(epoch!==selectionEpoch.current)return;
    if (!pending.current || pending.current.text !== text)
      pending.current = { text, id: crypto.randomUUID() };
    await api<Receipt>(`/sessions/${sessionId}/submit`, {
      version: 1,
      commandId: pending.current.id,
      prompt: text,
    });
    pending.current = undefined;
    void load();
    setCommandRevision(n => n + 1);
  };
  const busy = ["running", "cancelling"].includes(
    snapshot?.session.status ?? "",
  );
  const cancel = async () => {
    if (snapshot?.session.runId && selected)
      await api(`/sessions/${selected}/cancel`, {
        version: 1,
        runId: snapshot.session.runId,
      });
  };
  const download = async (format: string) => {
    if (!selected) return;
    setDownloading(true);
    setError("");
    try {
      const response = await request(`/sessions/${selected}/export`, {
        method: "POST",
        body: JSON.stringify({
          version: 1,
          format,
          redact: redact.split("\n").filter(Boolean),
        }),
      });
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = format === "html" ? "session.html" : "session.tar";
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (e) {
      setError(String(e));
    } finally {
      setDownloading(false);
    }
  };
  return (
    <UiBridgeContext.Provider value={{sessionId:selected,enabled:!uiDisabled,handle:async(action,value,resourceId)=>{
      if(action==='draft.set'){setUiDraft({id:crypto.randomUUID(),text:value.text});return {status:'draft_requested'};}
      if(action==='session.navigate'){choose(value.sessionId);return {status:'navigated'};}
      if(action==='view.open'){const view=runtimeViews.find(p=>p.resourceId===resourceId&&p.id===value.viewId&&p.slot==='page');if(!view)throw new Error('视图不可用');setPage(view);return {status:'opened'};}
      throw new Error('未知操作');
    }}}><RuntimeViewsContext.Provider value={uiDisabled?[]:runtimeViews}><SyntaxScope id={selected ?? ""}><LocateFile.Provider value={locateFile}>
      <div className={`app ${panelOpen ? "with-inspector" : ""}`}>
        {customizationOpen && <AsyncFeature feature={features.customization} label="定制能力" modal target={deliveryTarget} sessionId={selected} close={() => { setCustomizationOpen(false); void refreshConfig().catch(e => setError(String(e))); }} branched={id => { setSelected(id); setInspection(undefined); setCustomizationOpen(false); history.replaceState(null, "", `${location.pathname}?session=${id}`); void refreshConfig().catch(e => setError(String(e))); }} />}
        {settingsOpen && (
          <Settings
            close={() => setSettingsOpen(false)}
            changed={refreshConfig}
          />
        )}
        {deleting && <DeleteSessionDialog session={deleting} close={() => setDeleting(undefined)} removed={id => {
          if (selected === id) clearSelection();
          setDeleting(undefined); void load();
        }} />}
        <Sidebar
          settings={() => setSettingsOpen(true)}
          remove={(s) => {
            setError("");
            setDeleting(s);
          }}
          loading={listLoading}
          error={listError}
          retry={() => void load()}
          sessions={sessions}
          selected={selected}
          choose={choose}
          create={() => {
            void create().catch((e) => setError(String(e)));
          }}
          more={
            next !== undefined
              ? () => {
                  void load(true).catch((e) => setError(String(e)));
                }
              : undefined
          }
          open={sidebar}
          close={() => setSidebar(false)}
        />
        <main className="workbench">
          <header className="topbar">
            <button
              className="mobile-only icon"
              onClick={() => {
                setPanelOpen(false);
                setSidebar(true);
              }}
              aria-label="打开会话列表"
            >
              ☰
            </button>
            <div>
              <div className="workspace-name">
                {config?.workspace.split(/[\\/]/).filter(Boolean).at(-1) ??
                  "连接本地服务…"}
              </div>
            </div>
            <div className="topbar-actions">
              {!uiDisabled&&runtimeViews.filter(p=>p.slot==='page').map(p=><button key={`${p.resourceId}:${p.id}`} onClick={()=>setPage(p)}>{p.title??p.id}</button>)}
              <button onClick={() => {setDeliveryTarget(undefined);setCustomizationOpen(true);}}>定制能力</button>
              <button
                className={`panel-toggle ${panelOpen ? "is-open" : ""}`}
                aria-label="打开工作区面板"
                aria-expanded={panelOpen}
                onClick={() => {
                  setPanelOpen(!panelOpen);
                  setSidebar(false);
                }}
              >
                文件与变更
              </button>
              <RuntimeTheme catalog={themeCatalog} refresh={refreshUi} onExport={()=>{setError("");setExportOpen(true);}} canExport={!!selected&&!busy} uiDisabled={uiDisabled} onToggleViews={()=>setUiDisabled(v=>!v)}/>
              <span className={`connection ${connection}`}>
                {connection === "connected"
                  ? "已连接"
                  : connection === "connecting"
                    ? "连接中"
                    : "连接已断开"}
              </span>
            </div>
          </header>
          {(error || streamError) && (
            <div className="error banner" role="alert">
              {error || streamError}
            </div>
          )}
          {snapshot?.session.diagnostic && (
            <DiagnosticNotice
              key={snapshot.session.diagnostic.id}
              value={snapshot.session.diagnostic}
              sessionId={snapshot.session.id}
            />
          )}
          {exportOpen&&<AsyncFeature feature={features.export} label="导出对话" modal error={error} busy={downloading||busy} redact={redact} setRedact={setRedact} close={()=>setExportOpen(false)} download={download}/>}
          <section
            className="conversation"
            ref={conversation}
            onWheel={() => {scrollIntent.current=Date.now()+600;}}
            onTouchStart={() => {scrollIntent.current=Date.now()+600;}}
            onPointerDown={() => {scrollIntent.current=Date.now()+600;}}
            onKeyDown={e => {if(["ArrowDown","ArrowUp","PageDown","PageUp","End","Home"," "].includes(e.key))scrollIntent.current=Date.now()+600;}}
            onScroll={(e) => {
              const el = e.currentTarget;
              if(programScroll.current!==undefined&&Math.abs(el.scrollTop-programScroll.current)<2){programScroll.current=undefined;return;}
              programScroll.current=undefined;
              if(historyMode)captureAnchor();
              if(Date.now()>scrollIntent.current)return;
              follow.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
              if (!follow.current && snapshot) browse();
              else reachBottom();
            }}
          >
            {page&&!uiDisabled?<section aria-label="扩展页面"><button onClick={()=>setPage(undefined)}>返回会话</button><CustomPanel panel={page}/></section>:null}
            <RuntimeViews slot="session-header"/>
            <div className="conversation-heading">
              <h1>{snapshot?.session.title ?? "今天想做什么？"}</h1>
              <p>
                {snapshot ? (
                  <>
                    <span className={`badge ${snapshot.session.status}`}>
                      {statusText(snapshot.session.status)}
                    </span>
                  </>
                ) : null}
              </p>
            </div>

            {snapshot && selected && snapshot.session.id === selected ? (
              <Timeline
                onContinue={()=>setUiDraft({id:crypto.randomUUID(),text:"请从已完成的进度继续任务，先检查现有结果，不要重复已完成的操作。"})}
                sessionId={selected}
                liveRows={liveRows}
                rows={snapshot.rows}
                inspect={inspect}
                older={() => {
                  captureAnchor(); follow.current = false;
                  void older().catch((e) => setError(String(e)));
                }}
                newer={() => { captureAnchor(); follow.current = false; void newer().catch(e => setError(String(e))); }}
                hasNewer={snapshot.after!==undefined} paging={paging} navigationError={navigationError}
                hasOlder={!!snapshot.before}
              />
            ) : (
              <div className="welcome">
                <p className="welcome-copy">
                  在下方输入任务。Nekomimi 会阅读当前项目、修改文件，并在这里展示差异。
                </p>
              </div>
            )}
          </section>
          {(historyMode || navigationError?.direction === "latest") && <div className="history-return"><button className="history-latest" disabled={loadingDirection==='latest'} onClick={() => {follow.current=true;void latest();}}><span aria-hidden="true">↓</span> {navigationError?.direction==='latest'?'重试返回最新':hasNew?'有新消息 · 返回最新':'返回最新'}</button>{navigationError?.direction==='latest'&&<span role="alert">{navigationError.message}</span>}</div>}
          {selected && <ExtensionInteractions key={selected} sessionId={selected} />}
          <RuntimeViews slot="composer-toolbar"/>
          <Composer
            contextRevision={inputContext}
            requestedDraft={uiDraft}
            commandRevision={commandRevision}
            connected={!!config && connection === "connected"}
            busy={busy}
            configured={!!config?.configured && !creating}
            submit={submit}
            cancel={cancel}
          />
        </main>
        {panelOpen && (
          <WorkspacePanel
            tab={panelTab}
            setTab={setPanelTab}
            close={() => setPanelOpen(false)}
          >
            <div hidden={panelTab !== "files"}>
              <AsyncFeature feature={features.files} label="文件" close={() => setPanelOpen(false)}
                workspace={config?.workspace ?? ""}
                locate={located}
                locateRevision={locateRevision}
                revision={
                  snapshot?.rows
                    .filter(
                      (r) =>
                        r.kind === "tool" &&
                        r.status === "completed" &&
                        ["edit", "write"].includes(r.title),
                    )
                    .at(-1)?.seq ?? 0
                }
              />
            </div>
            {panelTab === "changes" && (
              <AsyncFeature feature={features.changes} label="变更" close={() => setPanelOpen(false)}
                sessionId={selected}
                revision={snapshot?.cursor.seq ?? 0}
                locate={locateFile}
              />
            )}
            {panelTab === "trace" && (!inspection || !selected) && (
              <p className="panel-empty">从执行过程选择一次调用，查看详情</p>
            )}
            {panelTab === "trace" && inspection && selected && (
              <AsyncFeature feature={features.inspector} label="执行详情"
                embedded
                sessionId={selected}
                row={
                  snapshot?.rows.find((row) => row.id === inspection.id) ??
                  inspection
                }
                responseText={
                  snapshot?.rows.find(
                    (row) =>
                      row.attemptId === inspection.attemptId &&
                      row.kind === "assistant",
                  )?.text
                }
                revision={snapshot?.cursor.seq ?? 0}
                select={setInspection}
                close={() => setPanelOpen(false)}
              />
            )}
          </WorkspacePanel>
        )}
      </div>
    </LocateFile.Provider></SyntaxScope></RuntimeViewsContext.Provider></UiBridgeContext.Provider>
  );
}
