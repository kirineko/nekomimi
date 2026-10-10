import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type HTMLAttributes } from 'react';
import { api } from '../api';
import { ReferenceHistory } from '../reference-model';
import { atomicRange, decodeClipboard, normalizeSegments, REFERENCE_MIME, replaceSegments, segmentText, serialize, sliceSegments, type Reference, type Segment } from '../../shared/references';
export interface ReferenceEditorHandle {
  element: HTMLDivElement | null;
  value: string;
  selectionStart: number;
  selectionEnd: number;
  segments: Segment[];
  revision: number;
  focus: (options?: FocusOptions) => void;
  setSelectionRange: (start: number, end: number) => void;
  replace: (start: number, end: number, segments: Segment[]) => void;
}
const savedEditors=new Map<string,{text:string;segments:Segment[]}>();
interface Props extends Omit<HTMLAttributes<HTMLDivElement>, 'onChange' | 'onSelect'> {
  value: string; disabled: boolean; placeholder: string; contextRevision: number; sessionId?:string; stateKey?:string;
  onChange: (text: string) => void; onSelect: (start: number, end: number) => void;
}
export const ReferenceEditor = forwardRef<ReferenceEditorHandle, Props>(function ReferenceEditor({value, disabled, placeholder, contextRevision, sessionId, stateKey, onChange, onSelect, className, ...props}, ref) {
  const sessionRef=useRef(sessionId);sessionRef.current=sessionId;
  const stateKeyRef=useRef(stateKey);stateKeyRef.current=stateKey;
  const root = useRef<HTMLDivElement>(null), history = useRef(new ReferenceHistory());
  const known = useRef(new Map<string, Reference>());
  const composing = useRef(false), callbacks = useRef({ onChange, onSelect }); callbacks.current = { onChange, onSelect };
  const [error, setError] = useState('');
  const epoch = useRef(0), pasteAbort = useRef<AbortController | undefined>(undefined);
  const disabledRef = useRef(disabled); disabledRef.current = disabled;
  const read = (node: Node): Segment[] => {
    if (node.nodeType === Node.TEXT_NODE) return [{ type: 'text', text: node.textContent ?? '' }];
    if (node instanceof HTMLElement) {
      const reference = known.current.get(node.dataset.referenceId ?? '');
      if (reference) return [{ type: 'reference', ...reference }];
      if (node.tagName === 'BR') return [{ type: 'text', text: '\n' }];
    }
    const result: Segment[] = [];
    for (const child of node.childNodes) {
      if (child instanceof HTMLElement && ['DIV', 'P'].includes(child.tagName) && result.length && !serialize(result).endsWith('\n')) result.push({ type: 'text', text: '\n' });
      result.push(...read(child));
    }
    return normalizeSegments(result);
  };
  const selection = () => {
    const el = root.current, selection = window.getSelection();
    if (!el || !selection?.rangeCount || !el.contains(selection.anchorNode) || !el.contains(selection.focusNode)) return history.current.state;
    const range = selection.getRangeAt(0);
    const offset = (node: Node, end: number) => {
      const before = document.createRange(); before.selectNodeContents(el); before.setEnd(node, end);
      return serialize(read(before.cloneContents())).length;
    };
    const [start, end] = atomicRange(history.current.state.segments, offset(range.startContainer, range.startOffset), offset(range.endContainer, range.endOffset));
    history.current.select(start, end);
    return history.current.state;
  };
  const select = (start: number, end = start) => {
    const el = root.current; if (!el) return;
    const length = serialize(history.current.state.segments).length;
    start = Math.min(start, length); end = Math.min(end, length);
    const point = (offset: number): [Node, number] => {
      let at = 0;
      for (let i = 0; i < el.childNodes.length; i++) {
        const node = el.childNodes[i]!, len = serialize(read(node)).length;
        if (offset <= at + len) {
          if (node.nodeType === Node.TEXT_NODE) return [node, Math.max(0, offset - at)];
          return [el, i + (offset > at ? 1 : 0)];
        }
        at += len;
      }
      return [el, el.childNodes.length];
    };
    const range = document.createRange(); range.setStart(...point(start)); range.setEnd(...point(end));
    window.getSelection()?.removeAllRanges(); window.getSelection()?.addRange(range);
    history.current.select(start, end); callbacks.current.onSelect(start, end);
  };
  const render = (restore = true) => {
    const el = root.current; if (!el) return;
    const fragment = document.createDocumentFragment(); known.current.clear();
    for (const s of history.current.state.segments) {
      if (s.type === 'text') fragment.append(document.createTextNode(s.text));
      else {
        const id = crypto.randomUUID(); known.current.set(id, s);
        const chip = document.createElement('span'); chip.contentEditable = 'false'; chip.className = 'reference-chip'; chip.dataset.referenceId = id;
        chip.dataset.path = s.path; chip.title = s.path; chip.setAttribute('aria-label', `${s.kind === 'directory' ? '目录' : '文件'} ${s.path}`);
        const label = document.createElement('span'); label.textContent = `${s.kind === 'directory' ? '▣' : '▤'} ${s.path}${s.kind === 'directory' ? '/' : ''}`;
        const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = '×'; remove.setAttribute('aria-label', `移除引用 ${s.path}`); remove.disabled = disabledRef.current;
        remove.onmousedown = e => e.preventDefault();
        remove.onclick = () => {
          if (disabledRef.current || composing.current || !el.contains(chip)) return;
          // Native IME edits move this node without rebuilding its handler.
          const before = document.createRange(); before.selectNodeContents(el); before.setEndBefore(chip);
          const from = serialize(read(before.cloneContents())).length;
          el.focus({preventScroll:true}); replace(from, from + segmentText(s).length, []);
        };
        chip.append(label, remove); fragment.append(chip);
      }
    }
    fragment.append(document.createTextNode(''));
    el.replaceChildren(fragment); el.dataset.empty = String(!valueOf());
    if (restore) select(history.current.state.start, history.current.state.end);
  };
  const valueOf = () => serialize(history.current.state.segments);
  const notify = () => {
    const key=stateKeyRef.current;
    if(key){savedEditors.delete(key);savedEditors.set(key,{text:valueOf(),segments:normalizeSegments(history.current.state.segments)});if(savedEditors.size>128)savedEditors.delete(savedEditors.keys().next().value!);}
    callbacks.current.onChange(valueOf()); callbacks.current.onSelect(history.current.state.start, history.current.state.end); };
  const replace = (start: number, end: number, segments: Segment[]) => {
    try {
      const next = replaceSegments(history.current.state.segments, start, end, segments);
      history.current.commit({ segments: next.segments, start: next.caret, end: next.caret }); setError(''); render(); notify();
    } catch (e) { setError(String(e)); }
  };
  useImperativeHandle(ref, () => ({
    get element() { return root.current; }, get value() { return valueOf(); },
    get selectionStart() { return selection().start; }, get selectionEnd() { return selection().end; },
    get segments() { return history.current.state.segments; }, get revision() { return history.current.revision; },
    focus: options => root.current?.focus(options), setSelectionRange: select, replace,
  }));
  useLayoutEffect(() => {
    if (value !== valueOf() && !composing.current) {
      const saved=stateKey?savedEditors.get(stateKey):undefined, current=valueOf();
      const segments=saved?.text===value?saved.segments:current&&value.startsWith(current)?normalizeSegments([...history.current.state.segments,{type:'text',text:value.slice(current.length)}]):value?[{type:'text' as const,text:value}]:[];
      history.current.reset(segments); render(document.activeElement === root.current);
      if(stateKey){savedEditors.delete(stateKey);savedEditors.set(stateKey,{text:value,segments:normalizeSegments(segments)});if(savedEditors.size>128)savedEditors.delete(savedEditors.keys().next().value!);}
    } else if (!root.current?.childNodes.length) render(false);
  }, [value,stateKey]);
  useEffect(() => {
    epoch.current++; setError(''); pasteAbort.current?.abort();
    return () => { epoch.current++; pasteAbort.current?.abort(); };
  }, [contextRevision,sessionId]);
  useEffect(() => {
    const el = root.current!;
    for (const button of el.querySelectorAll('button')) button.disabled = disabled;
  }, [disabled]);
  useEffect(() => {
    const el = root.current!;
    const onSelection = () => { if (document.activeElement === el && !composing.current) { const s = selection(); callbacks.current.onSelect(s.start, s.end); } };
    const sync = () => {
      if (composing.current) return;
      try {
        const segments = read(el), selected = selection();
        history.current.commit({ segments, start: selected.start, end: selected.end });
        el.dataset.empty = String(!valueOf()); setError(''); notify();
      } catch (e) { setError(String(e)); render(); }
    };
    const before = (event: InputEvent) => {
      if (composing.current || event.isComposing || event.inputType.includes('Composition')) return;
      if (disabledRef.current) { event.preventDefault(); return; }
      const { start, end } = selection();
      if (['historyUndo', 'historyRedo'].includes(event.inputType)) { event.preventDefault(); history.current.move(event.inputType === 'historyRedo'); render(); notify(); return; }
      if (['insertText', 'insertReplacementText', 'insertLineBreak', 'insertParagraph'].includes(event.inputType)) {
        event.preventDefault(); replace(start, end, [{type:'text',text:event.inputType === 'insertText' || event.inputType === 'insertReplacementText' ? event.data ?? '' : '\n'}]);
      } else if (event.inputType.startsWith('delete')) {
        event.preventDefault();
        let from = start, to = end;
        if (from === to) {
          const text = valueOf(); const backward = event.inputType.includes('Backward');
          if (event.inputType.includes('Word')) { if (backward) from = text.slice(0, start).replace(/\s*\S+\s*$/, '').length; else to += /^\s*\S+\s*/.exec(text.slice(end))?.[0].length ?? 0; }
          else if (event.inputType.includes('Line')) { if (backward) from = text.lastIndexOf('\n', start - 1) + 1; else { const newline = text.indexOf('\n', end); to = newline < 0 ? text.length : newline; } }
          else if (backward) from = start - (Array.from(text.slice(0, start)).at(-1)?.length ?? 0);
          else to = end + (Array.from(text.slice(end))[0]?.length ?? 0);
        }
        replace(from, to, []);
      } else if (event.inputType.startsWith('format') || event.inputType === 'insertFromDrop') event.preventDefault();
    };
    const key = (e: KeyboardEvent) => {
      if (e.target !== el || composing.current || e.isComposing) return;
      if ((e.metaKey || e.ctrlKey) && !e.altKey && (e.key.toLowerCase() === 'z' || e.key.toLowerCase() === 'y')) {
        e.preventDefault(); history.current.move(e.shiftKey || e.key.toLowerCase() === 'y'); render(); notify();
      }
    };
    const copy = (e: ClipboardEvent) => {
      if (!e.clipboardData) return;
      const { start, end } = selection(); if (start === end) return;
      e.preventDefault(); const segments = sliceSegments(history.current.state.segments, start, end);
      e.clipboardData.setData('text/plain', serialize(segments));
      e.clipboardData.setData(REFERENCE_MIME, JSON.stringify({version:1,segments}));
      if (e.type === 'cut' && !disabledRef.current) replace(start, end, []);
    };
    const paste = (e: ClipboardEvent) => {
      if (!e.clipboardData || disabledRef.current || composing.current) return;
      e.preventDefault(); pasteAbort.current?.abort(); const {start,end} = selection();
      const text = e.clipboardData.getData('text/plain'), raw = e.clipboardData.getData(REFERENCE_MIME);
      replace(start, end, [{type:'text',text}]);
      if (!raw) return;
      const revision = history.current.revision, currentEpoch = epoch.current, abort = new AbortController(); pasteAbort.current = abort;
      void (async () => {
        try {
          const segments = decodeClipboard(raw);
          if (serialize(segments) !== text) throw Error('引用与纯文本不一致');
          const refs = segments.filter(s=>s.type==='reference');
          for(let offset=0;offset<refs.length;offset+=4) {
            if(abort.signal.aborted || composing.current || history.current.revision!==revision || epoch.current!==currentEpoch)return;
            await Promise.all(refs.slice(offset,offset+4).map(async segment=>{
              const resolved = await api<Reference>(`/workspace/references?mode=resolve&path=${encodeURIComponent(segment.path)}${sessionRef.current ? `&session=${encodeURIComponent(sessionRef.current)}` : ""}`,undefined,abort.signal);
              if (resolved.path !== segment.path || resolved.kind !== segment.kind) throw Error('引用目标已变化');
            }));
          }
          if (abort.signal.aborted || composing.current || history.current.revision !== revision || epoch.current !== currentEpoch || disabledRef.current) return;
          // Fold async validation into the paste transaction, preserving one undo.
          const next = replaceSegments(history.current.state.segments, start, start + text.length, segments);
          history.current.state = {segments:next.segments,start:next.caret,end:next.caret}; history.current.revision++;
          render(document.activeElement === el); notify();
        } catch { if (!abort.signal.aborted && epoch.current === currentEpoch && history.current.revision === revision) setError('无法恢复引用块，已保留纯文本。'); }
      })();
    };
    const compositionStart = () => { pasteAbort.current?.abort(); composing.current = true; selection(); };
    const compositionEnd = () => { composing.current = false; sync(); };
    el.addEventListener('beforeinput', before); el.addEventListener('input', sync); el.addEventListener('keydown', key);
    el.addEventListener('copy', copy); el.addEventListener('cut', copy); el.addEventListener('paste', paste);
    el.addEventListener('compositionstart', compositionStart); el.addEventListener('compositionend', compositionEnd);
    document.addEventListener('selectionchange', onSelection);
    return () => {
      el.removeEventListener('beforeinput', before); el.removeEventListener('input', sync); el.removeEventListener('keydown', key);
      el.removeEventListener('copy', copy); el.removeEventListener('cut', copy); el.removeEventListener('paste', paste);
      el.removeEventListener('compositionstart', compositionStart); el.removeEventListener('compositionend', compositionEnd);
      document.removeEventListener('selectionchange', onSelection);
    };
  }, []);
  return <><div {...props} ref={root} role="textbox" aria-multiline="true" aria-disabled={disabled} contentEditable={!disabled} suppressContentEditableWarning className={className ?? "reference-editor"} data-placeholder={placeholder} data-empty={!value} onDrop={e=>e.preventDefault()}/>{error&&<p className="text-sm text-danger" role="alert">{error}</p>}</>;
});
