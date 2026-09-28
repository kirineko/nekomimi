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
  const textarea = useRef<HTMLTextAreaElement>(null);
  const context=useRef(contextRevision);context.current=contextRevision;
  const submission=useRef<{context:number;restore:boolean;done:boolean;start:number;end:number}|undefined>(undefined);
  useEffect(()=>{
    const transfer=(event:Event)=>{
      if(event.type==='keydown' && !['Tab','Escape'].includes((event as KeyboardEvent).key))return;
      if(event.type==='focusin' && (event.target===document.body || (event.target instanceof Node && textarea.current?.closest('.composer')?.contains(event.target))))return;
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
  const [focused, setFocused] = useState(false);
  const [ime, setIme] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [active, setActive] = useState(0);
  const popup = useRef<HTMLDivElement>(null);
  const listId = useId();
  const word = commandWord(text, caret);
  const open = focused && !!word && !ime && !dismissed;
  const commands = useCommands(connected, commandRevision, open);
  const matches = word ? matchingCommands(commands.catalog?.commands ?? [], word) : [];
  const index = Math.min(active, Math.max(0, matches.length - 1));
  const [position, setPosition] = useState({ left: 0, bottom: 0, width: 0, maxHeight: 280 });
  useEffect(() => { setActive(0); }, [word, commands.catalog?.revision]);
  useEffect(() => {
    if (!open) return;
    const place = () => {
      const rect = textarea.current!.getBoundingClientRect();
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
  }, [open, text]);
  useEffect(() => { if (open) document.getElementById(`${listId}-${index}`)?.scrollIntoView({ block: "nearest" }); }, [index, open, listId]);
  useEffect(() => {
    const outside = (e: PointerEvent) => {
      if (e.target !== textarea.current && !popup.current?.contains(e.target as Node)) setDismissed(true);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, []);
  const complete = (command: CommandSuggestion) => {
    const result = completeCommand(text, command.insertText);
    setText(result.text); setCaret(result.caret); setDismissed(true);
    requestAnimationFrame(() => { if (textarea.current?.value === result.text) { textarea.current.focus(); textarea.current.setSelectionRange(result.caret, result.caret); } });
  };
  useEffect(() => {
    const el = textarea.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = Math.min(180, Math.max(48, el.scrollHeight)) + "px";
    }
  }, [text]);
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
    const current={context:contextRevision,restore:true,done:false,start:textarea.current?.selectionStart??0,end:textarea.current?.selectionEnd??0};
    submission.current=current;
    setDismissed(true);
    setPending(true);
    setError("");
    try {
      await submit(text);
      if(current.context===context.current)setText("");
    } catch (e) {
      if(current.context===context.current)setError(String(e));
    } finally {
      current.done=true;
      setPending(false);
    }
  };
  return (
    <div className="composer-wrap">
      {draftConflict!==undefined&&<div role="dialog" aria-label="保留当前草稿"><p>扩展提供了新的草稿，如何处理？</p><button onClick={()=>{setText(draftConflict);setCaret(draftConflict.length);setDraftConflict(undefined);}}>替换草稿</button><button onClick={()=>{setText(text+'\n'+draftConflict);setDraftConflict(undefined);}}>追加</button><button onClick={()=>setDraftConflict(undefined)}>保留原草稿</button></div>}
      {open && createPortal(<div ref={popup} className="command-popup" style={position} onMouseDown={e => e.preventDefault()} onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget as Node) && e.relatedTarget !== textarea.current) setDismissed(true); }}>
        <div className="command-popup-heading"><span>命令 · ↑↓ 选择 · Tab / Enter 补全</span><button type="button" aria-label="关闭命令提示" onClick={() => setDismissed(true)}>×</button></div>
        <div id={listId} role="listbox" aria-label="斜杠命令">
          {matches.map((command, i) => <button type="button" tabIndex={-1} role="option" id={`${listId}-${i}`} key={command.id} aria-selected={i === index} className="command-option" onPointerMove={() => setActive(i)} onClick={() => complete(command)}>
            <span className="command-option-name"><strong>{command.name}</strong><small>{command.source}</small></span><span className="command-option-description">{command.description}</span>
          </button>)}
        </div>
        {!matches.length && <div className="command-empty" role="status">{commands.error ? "命令加载失败" : commands.loading ? "正在加载命令…" : !commands.catalog?.ready ? "命令尚未就绪" : "没有匹配的命令，可继续手动输入"}{(commands.error || !commands.catalog?.ready) && <button type="button" onClick={() => void commands.refresh()}>重试命令</button>}</div>}
      </div>, document.body)}
      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <div role="combobox" aria-label="命令补全" aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? listId : undefined}>
        <textarea
          ref={textarea}
          disabled={!configured || pending}
          aria-label="任务内容"
          aria-autocomplete="list"
          aria-controls={open ? listId : undefined}
          aria-activedescendant={open && matches.length ? `${listId}-${index}` : undefined}
          placeholder={
            configured ? "交给 Nekomimi…" : "打开设置，保存 API key 后即可发送"
          }
          value={text}
          onChange={e => { setText(e.target.value); setCaret(e.target.selectionStart); setDismissed(false); }}
          onSelect={e => setCaret(e.currentTarget.selectionStart)}
          onKeyUp={e => {
            setCaret(e.currentTarget.selectionStart);
            if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key) && commandWord(text, e.currentTarget.selectionStart)) setDismissed(false);
          }}
          onFocus={() => setFocused(true)}
          onBlur={e => { if (!popup.current?.contains(e.relatedTarget as Node)) { setFocused(false); setDismissed(true); } }}
          onClick={e => { setCaret(e.currentTarget.selectionStart); setDismissed(false); }}
          onCompositionStart={() => {
            composing.current = true; setIme(true);
          }}
          onCompositionEnd={() => {
            composing.current = false; setIme(false);
            ended.current = performance.now();
          }}
          onKeyDown={(e) => {
            if (composing.current || e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229 || performance.now() - ended.current <= 50) return;
            if (open && e.key === "Escape") { e.preventDefault(); setDismissed(true); return; }
            if (open && matches.length && ["ArrowDown", "ArrowUp"].includes(e.key)) {
              e.preventDefault(); setActive((index + (e.key === "ArrowDown" ? 1 : -1) + matches.length) % matches.length); return;
            }
            if (open && matches.length && !e.shiftKey && (e.key === "Tab" || e.key === "Enter")) {
              e.preventDefault(); if (!e.repeat) complete(matches[index]!); return;
            }
            if (
              e.key === "Enter" &&
              !e.shiftKey &&
              !composing.current &&
              !e.nativeEvent.isComposing &&
              e.nativeEvent.keyCode !== 229 &&
              performance.now() - ended.current > 50 &&
              !e.repeat
            ) {
              e.preventDefault();
              void send();
            }
          }}
          maxLength={32000}
        />
        </div>
        <div className="composer-bottom">
          <span className="composer-meta">
            <span>{occupancy?.model ?? "DeepSeek"}</span>
            <span className="composer-hint">{open && matches.length ? "Enter 补全命令 · Esc 收起" : "Enter 发送 · Shift+Enter 换行"}</span>
          </span>
          <ContextMeter value={occupancy} compacting={compacting}/>
          {busy ? (
            <button
              type="button"
              className="stop"
              onClick={() => {
                void cancel().catch((e) => setError(String(e)));
              }}
            >
              停止任务
            </button>
          ) : (
            <button
              className="primary"
              title="Enter 发送 · Shift+Enter 换行"
              type="submit"
              disabled={pending || !configured || !text.trim()}
            >
              {pending ? "确认中…" : "发送任务"}
            </button>
          )}
        </div>
      </form>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
