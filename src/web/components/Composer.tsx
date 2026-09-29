import { ReferenceEditor, type ReferenceEditorHandle } from "./ReferenceEditor";
import { useReferences } from "../hooks/useReferences";
import { formatReference, referenceWord, type ReferenceCandidate } from "../../shared/references";
import { api } from "../api";
import { ContextMeter } from "./ContextMeter";
import type { ContextOccupancy } from "../../shared/protocol";
import { createPortal } from "react-dom";
import { useCommands } from "../hooks/useCommands";
import { commandWord, matchingCommands, completeCommand } from "../command-input";
import type { CommandSuggestion } from "../../shared/protocol";
import { useEffect, useRef, useState, useId } from "react";
export function Composer({
  occupancy, compacting, contextRevision=0, requestedDraft, commandRevision, connected,
  busy,
  configured,
  submit,
  cancel,
}: {
  occupancy?: ContextOccupancy; compacting?: boolean;
  contextRevision?: number;
  requestedDraft?: {id:string;text:string};
  commandRevision: number; connected: boolean;
  busy: boolean;
  configured: boolean;
  submit: (text: string) => Promise<void>;
  cancel: () => Promise<void>;
}) {
  const textarea = useRef<ReferenceEditorHandle>(null);
  const context=useRef(contextRevision);context.current=contextRevision;
  const submission=useRef<{context:number;restore:boolean;done:boolean;start:number;end:number}|undefined>(undefined);
  useEffect(()=>{
    const transfer=(event:Event)=>{
      if(event.type==='keydown' && !['Tab','Escape'].includes((event as KeyboardEvent).key))return;
      if(event.type==='focusin' && (event.target===document.body || (event.target instanceof Node && textarea.current?.element?.closest('.composer')?.contains(event.target))))return;
      if(submission.current)submission.current.restore=false;
    };
    document.addEventListener('pointerdown',transfer,true);
    document.addEventListener('keydown',transfer,true);
    window.addEventListener('blur',transfer);
    document.addEventListener('focusin',transfer);
    return()=>{submission.current=undefined;document.removeEventListener('pointerdown',transfer,true);document.removeEventListener('keydown',transfer,true);window.removeEventListener('blur',transfer);document.removeEventListener('focusin',transfer);};
  },[]);
  const composing = useRef(false);
  const ended = useRef(0);
  const [text, setText] = useState("");
  const [draftConflict,setDraftConflict]=useState<string>();
  useEffect(()=>{if(requestedDraft){if(text.trim())setDraftConflict(requestedDraft.text);else{setText(requestedDraft.text);setCaret(requestedDraft.text.length);}}},[requestedDraft?.id]);
  const [caret, setCaret] = useState(0);
  const [selectionEnd, setSelectionEnd] = useState(0);
  const [focused, setFocused] = useState(false);
  const [ime, setIme] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [active, setActive] = useState(0);
  const popup = useRef<HTMLDivElement>(null);
  const listId = useId();
  const word = commandWord(text, caret);
  const reference = referenceWord(textarea.current?.segments ?? [{type:'text',text}], caret, selectionEnd);
  const open = focused && !!word && !ime && !dismissed;
  const referenceOpen = focused && !word && !!reference && !ime && !dismissed;
  const references = useReferences(reference?.query, referenceOpen && connected, contextRevision);
  const candidates = references.page?.entries ?? [];
  const referenceIndex = Math.min(active, Math.max(0, candidates.length - 1));
  const popupOpen = open || referenceOpen;
  const referenceState = useRef({open:referenceOpen,query:reference?.query});
  referenceState.current={open:referenceOpen,query:reference?.query};
  const pickAbort = useRef<AbortController | undefined>(undefined);
  useEffect(()=>()=>{pickAbort.current?.abort();},[referenceOpen,reference?.query,contextRevision]);
  const commands = useCommands(connected, commandRevision, open);
  const matches = word ? matchingCommands(commands.catalog?.commands ?? [], word) : [];
  const index = Math.min(active, Math.max(0, matches.length - 1));
  const [position, setPosition] = useState({ left: 0, bottom: 0, width: 0, maxHeight: 280 });
  useEffect(() => { setActive(0); }, [word, commands.catalog?.revision, reference?.query]);
  useEffect(() => {
    if (!popupOpen) return;
    const place = () => {
      const rect = textarea.current!.element!.getBoundingClientRect();
      const view = window.visualViewport;
      const top = view?.offsetTop ?? 0, left = view?.offsetLeft ?? 0;
      const width = view?.width ?? innerWidth;
      const anchor = Math.min(rect.top, top + (view?.height ?? innerHeight) - 60);
      setPosition({ left: Math.max(left + 8, rect.left), bottom: innerHeight - anchor + 8, width: Math.min(rect.width, width - 16), maxHeight: Math.max(48, Math.min(300, anchor - top - 16)) });
    };
    place();
    window.addEventListener("resize", place); window.addEventListener("scroll", place, true);
    window.visualViewport?.addEventListener("resize", place); window.visualViewport?.addEventListener("scroll", place);
    return () => { window.removeEventListener("resize", place); window.removeEventListener("scroll", place, true); window.visualViewport?.removeEventListener("resize", place); window.visualViewport?.removeEventListener("scroll", place); };
  }, [popupOpen, text]);
  useEffect(() => { if (popupOpen) document.getElementById(`${listId}-${referenceOpen ? referenceIndex : index}`)?.scrollIntoView({ block: "nearest" }); }, [index, referenceIndex, popupOpen, referenceOpen, listId]);
  useEffect(() => {
    const outside = (e: PointerEvent) => {
      if (!textarea.current?.element?.contains(e.target as Node) && !popup.current?.contains(e.target as Node)) setDismissed(true);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, []);
  const complete = (command: CommandSuggestion) => {
    const result = completeCommand(text, command.insertText);
    const end = text.search(/\s/);
    textarea.current?.replace(0, end < 0 ? text.length : end, [{type:'text',text:command.insertText+(end<0?' ':'')}]);
    setCaret(result.caret); setDismissed(true);
    requestAnimationFrame(() => { if (textarea.current?.value === result.text) { textarea.current.focus(); textarea.current.setSelectionRange(result.caret, result.caret); } });
  };
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  useEffect(()=>{
    const current=submission.current;
    if(pending||!configured||!current?.done)return;
    submission.current=undefined;
    if(current.restore&&current.context===contextRevision&&textarea.current){
      textarea.current.focus({preventScroll:true});
      textarea.current.setSelectionRange(Math.min(current.start,textarea.current.value.length),Math.min(current.end,textarea.current.value.length));
    }
  },[pending,configured,contextRevision]);
  const send = async () => {
    if (submission.current && !submission.current.done || pending || busy || !configured || !text.trim()) return;
    const current={context:contextRevision,restore:true,done:false,start:textarea.current?.selectionStart??0,end:textarea.current?.selectionEnd??0,revision:textarea.current?.revision};
    submission.current=current;
    setDismissed(true);
    setPending(true);
    setError("");
    try {
      await submit(text);
      if(current.context===context.current && current.revision===textarea.current?.revision)setText("");
    } catch (e) {
      if(current.context===context.current)setError(String(e));
    } finally {
      current.done=true;
      setPending(false);
    }
  };
  const pickReference = async (candidate: ReferenceCandidate) => {
    if (!reference || !textarea.current) return;
    const token = reference, revision = textarea.current.revision, currentContext = contextRevision;
    pickAbort.current?.abort();const abort=new AbortController();pickAbort.current=abort;
    try {
      const resolved = await api<ReferenceCandidate>(`/workspace/references?mode=resolve&path=${encodeURIComponent(candidate.path)}`,undefined,abort.signal);
      if (abort.signal.aborted || !referenceState.current.open || referenceState.current.query!==token.query || context.current !== currentContext || textarea.current?.revision !== revision || textarea.current.selectionStart !== token.end) return;
      if (resolved.path !== candidate.path || resolved.kind !== candidate.kind) throw Error('引用目标已变化，请刷新');
      textarea.current.replace(token.start, token.end, [{type:'reference',path:resolved.path,kind:resolved.kind},{type:'text',text:' '}]);
      setDismissed(true); setError(''); textarea.current.focus({preventScroll:true});
    } catch (e) { if(!abort.signal.aborted&&context.current===currentContext)setError(String(e)); }
  };
  const drill = (path: string) => {
    if (!reference) return;
    let token = path === '.' ? '@' : formatReference({path,kind:'directory'});
    if(token.startsWith('@"')) token=token.slice(0,-1);
    textarea.current?.replace(reference.start, reference.end, [{type:'text',text:token}]);
    setDismissed(false); textarea.current?.focus({preventScroll:true});
  };
  const directory = reference?.query.includes('/') ? reference.query.slice(0, reference.query.lastIndexOf('/')) : '';
  return (
    <div className="composer-wrap">
      {draftConflict!==undefined&&<div role="dialog" aria-label="保留当前草稿"><p>扩展提供了新的草稿，如何处理？</p><button onClick={()=>{setText(draftConflict);setCaret(draftConflict.length);setDraftConflict(undefined);}}>替换草稿</button><button onClick={()=>{textarea.current?.replace(text.length,text.length,[{type:'text',text:'\n'+draftConflict}]);setDraftConflict(undefined);}}>追加</button><button onClick={()=>setDraftConflict(undefined)}>保留原草稿</button></div>}
      {open && createPortal(<div ref={popup} className="command-popup" style={position} onMouseDown={e => e.preventDefault()} onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget as Node) && e.relatedTarget !== textarea.current?.element) setDismissed(true); }}>
        <div className="command-popup-heading"><span>命令 · ↑↓ 选择 · Tab / Enter 补全</span><button type="button" aria-label="关闭命令提示" onClick={() => setDismissed(true)}>×</button></div>
        <div id={listId} role="listbox" aria-label="斜杠命令">
          {matches.map((command, i) => <button type="button" tabIndex={-1} role="option" id={`${listId}-${i}`} key={command.id} aria-selected={i === index} className="command-option" onPointerMove={() => setActive(i)} onClick={() => complete(command)}>
            <span className="command-option-name"><strong>{command.name}</strong><small>{command.source}</small></span><span className="command-option-description">{command.description}</span>
          </button>)}
        </div>
        {!matches.length && <div className="command-empty" role="status">{commands.error ? "命令加载失败" : commands.loading ? "正在加载命令…" : !commands.catalog?.ready ? "命令尚未就绪" : "没有匹配的命令，可继续手动输入"}{(commands.error || !commands.catalog?.ready) && <button type="button" onClick={() => void commands.refresh()}>重试命令</button>}</div>}
      </div>, document.body)}
      {referenceOpen && createPortal(<div ref={popup} className="command-popup reference-popup" style={position} onMouseDown={e=>e.preventDefault()} onBlur={e=>{if(!e.currentTarget.contains(e.relatedTarget as Node)&&e.relatedTarget!==textarea.current?.element)setDismissed(true);}}>
        <div className="command-popup-heading"><span>引用 · Enter / Tab 选择 · → 进入目录</span><button type="button" aria-label="关闭引用提示" onClick={()=>setDismissed(true)}>×</button></div>
        <nav aria-label="引用目录"><button type="button" onClick={()=>drill('.')}>工作区</button>{directory.split('/').filter(Boolean).map((part,i,parts)=><button type="button" key={i} onClick={()=>drill(parts.slice(0,i+1).join('/'))}>{part}/</button>)}</nav>
        <div id={listId} role="listbox" aria-label="文件与目录">
          {candidates.map((candidate,i)=><div className="reference-option" key={candidate.path}>
            <button type="button" role="option" tabIndex={-1} id={`${listId}-${i}`} aria-selected={i===referenceIndex} className="command-option" onPointerMove={()=>setActive(i)} onClick={()=>void pickReference(candidate)}>
              <span className="command-option-name"><strong>{candidate.name}{candidate.kind==='directory'?'/':''}</strong><small>{candidate.kind==='directory'?'目录':'文件'}</small></span><span className="command-option-description">{candidate.path}</span>
            </button>{candidate.kind==='directory'&&<button type="button" aria-label={`进入目录 ${candidate.path}`} onClick={()=>drill(candidate.path)}>→</button>}
          </div>)}
        </div>
        {references.loading&&<div role="status">正在查找…</div>}
        {references.error&&<div role="alert">{references.error}</div>}
        {!references.loading&&!references.error&&!candidates.length&&<div role="status">没有匹配的文件或目录</div>}
        {references.page?.limited&&<div role="status">结果范围受限，请细化路径或进入目录。</div>}
        <div className="reference-actions"><button type="button" disabled={references.loading} onClick={references.refresh}>{references.error?'重试引用搜索':'刷新引用候选'}</button>{references.page?.next&&<button type="button" disabled={references.loading} onClick={references.more}>加载更多路径</button>}</div>
      </div>, document.body)}
      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <div role="combobox" aria-label="命令补全" aria-haspopup="listbox" aria-expanded={popupOpen} aria-controls={popupOpen ? listId : undefined}>
        <ReferenceEditor
          ref={textarea} contextRevision={contextRevision}
          disabled={!configured || pending}
          aria-label="任务内容" aria-autocomplete="list"
          aria-controls={popupOpen ? listId : undefined}
          aria-activedescendant={popupOpen && (referenceOpen ? candidates.length : matches.length) ? `${listId}-${referenceOpen ? referenceIndex : index}` : undefined}
          placeholder={configured ? "交给 Nekomimi… 输入 @ 引用文件或目录" : "打开设置，保存 API key 后即可发送"}
          value={text}
          onChange={value => { setText(value); setDismissed(false); }}
          onSelect={(start,end) => {setCaret(start);setSelectionEnd(end);}}
          onKeyUp={e => {
            if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key) && commandWord(text, textarea.current?.selectionStart ?? 0)) setDismissed(false);
          }}
          onFocus={() => setFocused(true)}
          onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget as Node) && !popup.current?.contains(e.relatedTarget as Node)) { setFocused(false); setDismissed(true); } }}
          onClick={() => { setCaret(textarea.current?.selectionStart ?? 0); setSelectionEnd(textarea.current?.selectionEnd ?? 0); setDismissed(false); }}
          onCompositionStart={() => { composing.current = true; setIme(true); }}
          onCompositionEnd={() => { composing.current = false; setIme(false); ended.current = performance.now(); }}
          onKeyDown={e => {
            if (e.target !== e.currentTarget || e.defaultPrevented || composing.current || e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229 || performance.now() - ended.current <= 50) return;
            if (popupOpen && e.key === 'Escape') {e.preventDefault();setDismissed(true);return;}
            const count=referenceOpen?candidates.length:matches.length, selected=referenceOpen?referenceIndex:index;
            if (popupOpen && count && ['ArrowDown','ArrowUp'].includes(e.key)) {e.preventDefault();setActive((selected+(e.key==='ArrowDown'?1:-1)+count)%count);return;}
            if (referenceOpen && e.key==='ArrowRight' && candidates[selected]?.kind==='directory') {e.preventDefault();drill(candidates[selected]!.path);return;}
            if (referenceOpen && e.key==='ArrowLeft' && reference?.query.endsWith('/')) {e.preventDefault();drill(directory.includes('/')?directory.slice(0,directory.lastIndexOf('/')):'.');return;}
            if (popupOpen && count && !e.shiftKey && ['Tab','Enter'].includes(e.key)) {
              e.preventDefault();if(!e.repeat){if(referenceOpen)void pickReference(candidates[selected]!);else complete(matches[selected]!);}return;
            }
            if(referenceOpen && e.key==='Enter' && !e.shiftKey){e.preventDefault();return;}
            if(e.key==='Enter'&&!e.shiftKey&&!e.repeat){e.preventDefault();void send();}
          }}
        />
        </div>
        <div className="composer-bottom">
          <span className="composer-model" title={occupancy?.model ?? "DeepSeek"}>
            {occupancy?.model ?? "DeepSeek"}
          </span>
          {busy ? (
            <button
              type="button"
              className="composer-action stop"
              aria-label="停止任务"
              title="停止任务"
              onClick={() => {
                void cancel().catch((e) => setError(String(e)));
              }}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2" /></svg>
            </button>
          ) : (
            <button
              className="composer-action primary"
              aria-label={pending ? "确认中…" : "发送任务"}
              title="Enter 发送 · Shift+Enter 换行"
              type="submit"
              disabled={pending || !configured || !text.trim()}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5m-6 6 6-6 6 6" /></svg>
            </button>
          )}
        </div>
      </form>
      <div className="composer-status">
        <span className="composer-hint">{referenceOpen ? "Enter 引用 · → 进入目录 · Esc 收起" : open && matches.length ? "Enter 补全命令 · Esc 收起" : "Enter 发送 · Shift+Enter 换行 · @ 引用"}</span>
        <ContextMeter value={occupancy} compacting={compacting}/>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
