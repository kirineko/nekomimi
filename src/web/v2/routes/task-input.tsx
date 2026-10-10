import {useEffect,useId,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {useQuery} from '@tanstack/react-query';
import type {CommandCatalog,CommandSuggestion,SessionMode} from '../../../shared/protocol';
import {formatReference,referenceWord,type ReferenceCandidate} from '../../../shared/references';
import {ReferenceEditor,type ReferenceEditorHandle} from '../../components/ReferenceEditor';
import {useReferences} from '../../hooks/useReferences';
import {commandWord,completeCommand,matchingCommands} from '../../command-input';
import {api} from '../../api';
import {Button} from '../../ui/Button';
import {v2Host,v2Key} from '../state/query';

export function TaskInput({value,onChange,onSubmit,sessionId,mode,target}:{value:string;onChange:(value:string)=>void;onSubmit:()=>void;sessionId:string;mode:SessionMode;target:string}) {
  const editor=useRef<ReferenceEditorHandle>(null),popup=useRef<HTMLDivElement>(null);
  const listId=useId(),labelId=useId();
  const [caret,setCaret]=useState(0),[end,setEnd]=useState(0),[selected,setSelected]=useState(0),[focused,setFocused]=useState(false),[dismissed,setDismissed]=useState(false),[ime,setIme]=useState(false),[error,setError]=useState('');
  const composing=useRef(false),ended=useRef(-Infinity),pickAbort=useRef<AbortController|undefined>(undefined);
  const word=commandWord(value,caret),reference=referenceWord(editor.current?.segments ?? [{type:'text',text:value}],caret,end);
  const commandOpen=focused&&!dismissed&&!ime&&!!word,referenceOpen=focused&&!dismissed&&!ime&&!word&&!!reference;
  const open=commandOpen||referenceOpen;
  const commands=useQuery({queryKey:v2Key(v2Host(),mode,target,sessionId,'commands'),queryFn:({signal})=>api<CommandCatalog>('/commands?session='+encodeURIComponent(sessionId),undefined,signal),enabled:commandOpen,staleTime:0,retry:false,refetchInterval:commandOpen?3000:false});
  const matches=word&&!commands.isError&&commands.data?.ready?matchingCommands(commands.data.commands,word):[];
  useEffect(()=>{
    if(!commandOpen)return;
    const refresh=()=>{void commands.refetch({cancelRefetch:true});};
    window.addEventListener('focus',refresh);
    return()=>window.removeEventListener('focus',refresh);
  },[commandOpen,commands.refetch]);
  const references=useReferences(reference?.query,referenceOpen,0,sessionId),candidates=references.page?.entries ?? [];
  const count=referenceOpen?candidates.length:matches.length,index=Math.min(selected,Math.max(0,count-1));
  const current=useRef({sessionId,referenceOpen,query:reference?.query});current.current={sessionId,referenceOpen,query:reference?.query};
  const [position,setPosition]=useState({left:8,top:8,width:320,maxHeight:260});
  useEffect(()=>{
    if(!open)return;
    let raf=0,settle=0;
    // 视口/滚动变化可能在多帧内分步完成（如 resize 引发的连续滚动），
    // 在触发后持续测量直到布局稳定，避免弹层停留在过时坐标上遮挡输入框。
    const measure=()=>{const rect=editor.current?.element?.getBoundingClientRect();if(!rect)return;const height=Math.min(320,Math.max(100,rect.top-12));setPosition(previous=>{
      const next={left:Math.max(8,Math.min(rect.left,innerWidth-328)),top:Math.max(8,rect.top-height-6),width:Math.min(Math.max(320,rect.width),innerWidth-16),maxHeight:height};
      return previous.left===next.left&&previous.top===next.top&&previous.width===next.width&&previous.maxHeight===next.maxHeight?previous:next;
    });};
    const locate=()=>{cancelAnimationFrame(raf);raf=requestAnimationFrame(()=>{measure();settle=window.setTimeout(measure,120);});};
    const outside=(event:PointerEvent)=>{if(event.target instanceof Node&&!popup.current?.contains(event.target)&&!editor.current?.element?.contains(event.target))setDismissed(true);};
    locate();window.addEventListener('resize',locate);window.addEventListener('scroll',locate,true);window.addEventListener('scrollend',locate,true);document.addEventListener('pointerdown',outside,true);
    return()=>{cancelAnimationFrame(raf);clearTimeout(settle);window.removeEventListener('resize',locate);window.removeEventListener('scroll',locate,true);window.removeEventListener('scrollend',locate,true);document.removeEventListener('pointerdown',outside,true);};
  },[open]);
  useEffect(()=>()=>pickAbort.current?.abort(),[sessionId,referenceOpen,reference?.query]);
  useEffect(()=>{
    if(open)popup.current?.querySelector<HTMLElement>('[role="option"][aria-selected="true"]')?.scrollIntoView({block:'nearest'});
  },[open,index,listId]);
  const complete=(command:CommandSuggestion)=>{
    const next=completeCommand(value,command.insertText),stop=value.search(/\s/);
    editor.current?.replace(0,stop<0?value.length:stop,[{type:'text',text:command.insertText+(stop<0?' ':'')}]);
    setDismissed(true);editor.current?.focus({preventScroll:true});editor.current?.setSelectionRange(next.caret,next.caret);
  };
  const pick=async(candidate:ReferenceCandidate)=>{
    if(!reference||!editor.current)return;
    const token=reference,revision=editor.current.revision,abort=new AbortController();pickAbort.current?.abort();pickAbort.current=abort;
    try {
      const resolved=await api<ReferenceCandidate>(`/workspace/references?mode=resolve&session=${encodeURIComponent(sessionId)}&path=${encodeURIComponent(candidate.path)}`,undefined,abort.signal);
      if(abort.signal.aborted||current.current.sessionId!==sessionId||!current.current.referenceOpen||current.current.query!==token.query||editor.current?.revision!==revision||editor.current.selectionStart!==token.end)return;
      if(resolved.path!==candidate.path||resolved.kind!==candidate.kind)throw Error('引用目标已变化，请刷新');
      editor.current.replace(token.start,token.end,[{type:'reference',path:resolved.path,kind:resolved.kind},{type:'text',text:' '}]);
      setDismissed(true);setError('');editor.current.focus({preventScroll:true});
    } catch(cause){if(!abort.signal.aborted)setError(String(cause));}
  };
  const drill=(path:string)=>{
    if(!reference)return;let token=path==='.'?'@':formatReference({path,kind:'directory'});if(token.startsWith('@"'))token=token.slice(0,-1);
    editor.current?.replace(reference.start,reference.end,[{type:'text',text:token}]);setDismissed(false);setSelected(0);editor.current?.focus({preventScroll:true});
  };
  const directory=reference?.query.includes('/')?reference.query.slice(0,reference.query.lastIndexOf('/')):'';
  return <>
    {open&&createPortal(<div ref={popup} data-reference-popup={referenceOpen?true:undefined} className="ds fixed z-30 space-y-2 overflow-auto rounded-md border border-line bg-background p-2 text-foreground shadow-floating" style={position} onMouseDown={event=>event.preventDefault()}>
      <div className="flex items-center justify-between gap-2 text-xs"><strong>{referenceOpen?'引用文件或目录':'命令建议'}</strong><Button size="sm" variant="outline" aria-label={referenceOpen?'关闭引用提示':'关闭命令提示'} onClick={()=>{setDismissed(true);editor.current?.focus({preventScroll:true});}}>关闭</Button></div>
      {referenceOpen&&<nav aria-label="引用目录" className="flex flex-wrap gap-1"><Button size="sm" variant="outline" onClick={()=>drill('.')}>工作区</Button>{directory.split('/').filter(Boolean).map((part,i,parts)=><Button key={i} size="sm" variant="outline" onClick={()=>drill(parts.slice(0,i+1).join('/'))}>{part}/</Button>)}</nav>}
      <div id={listId} role="listbox" aria-label={referenceOpen?'文件与目录':'命令建议'}>
        {referenceOpen?candidates.map((candidate,i)=><div key={candidate.path} className="flex min-w-0 items-center gap-1">
          <button type="button" role="option" tabIndex={-1} id={`${listId}-${i}`} aria-selected={i===index} className="min-w-0 flex-1 rounded-sm border-0 bg-transparent px-2 py-1 text-left text-sm text-foreground aria-selected:bg-wash" onPointerMove={()=>setSelected(i)} onClick={()=>void pick(candidate)}><strong className="break-all">{candidate.name}{candidate.kind==='directory'?'/':''}</strong>{' '}<span className="ml-2 text-xs text-muted">{candidate.kind==='directory'?'目录':'文件'}</span><span className="block break-all text-xs text-muted">{candidate.path}</span></button>
          {candidate.kind==='directory'&&<Button size="sm" variant="outline" aria-label={`进入目录 ${candidate.path}`} onClick={()=>drill(candidate.path)}>进入</Button>}
        </div>):matches.map((command,i)=><button type="button" role="option" tabIndex={-1} id={`${listId}-${i}`} key={command.id} aria-selected={i===index} className="block w-full rounded-sm border-0 bg-transparent px-2 py-1 text-left text-sm text-foreground aria-selected:bg-wash" onPointerMove={()=>setSelected(i)} onClick={()=>complete(command)}><strong>{command.name}</strong><span className="ml-2 text-xs text-muted">{command.source}</span><span className="block text-xs">{command.description}</span></button>)}
      </div>
      {referenceOpen?<>
        {references.loading&&<p role="status" className="text-xs">正在查找…</p>}{references.error&&<p role="alert" className="break-words text-xs text-danger">{references.error}</p>}
        {!references.loading&&!references.error&&!count&&<p role="status" className="text-xs">没有匹配的文件或目录</p>}{references.page?.limited&&<p role="status" className="text-xs">结果范围受限，请细化路径或进入目录。</p>}
        <div className="flex gap-2"><Button size="sm" variant="outline" disabled={references.loading} onClick={references.refresh}>{references.error?'重试引用搜索':'刷新引用候选'}</Button>{references.page?.next&&<Button size="sm" variant="outline" disabled={references.loading} onClick={references.more}>加载更多路径</Button>}</div>
      </>:!count&&<p role="status" className="text-xs">{commands.isError?'命令加载失败':commands.isPending?'正在加载命令…':!commands.data?.ready?'命令尚未就绪':'没有匹配的命令，可继续手动输入'}{(commands.isError||(!commands.isPending&&!commands.data?.ready))&&<Button size="sm" variant="outline" onClick={()=>void commands.refetch()}>重试命令</Button>}</p>}
    </div>,document.body)}
    <div id={labelId} className="text-xs font-semibold">任务草稿</div>
    <div role="combobox" aria-label="任务补全" aria-haspopup="listbox" aria-expanded={open} aria-controls={open?listId:undefined}>
      <ReferenceEditor ref={editor} contextRevision={0} sessionId={sessionId} stateKey={JSON.stringify([v2Host(),mode,target,sessionId])} disabled={false} value={value} aria-labelledby={labelId} aria-autocomplete="list" aria-controls={open?listId:undefined} aria-activedescendant={open&&count?`${listId}-${index}`:undefined}
        data-session-input={sessionId} data-reference-editor className="my-2 min-h-18 max-h-52 overflow-auto whitespace-pre-wrap break-words rounded-md border border-line bg-background px-3 py-2 text-sm text-foreground" placeholder="描述当前任务… / 命令 · @ 引用文件或目录"
        onChange={next=>{onChange(next);setDismissed(false);setSelected(0);}} onSelect={(start,finish)=>{setCaret(start);setEnd(finish);}}
        onKeyUp={event=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(event.key)&&commandWord(value,editor.current?.selectionStart ?? 0))setDismissed(false);}}
        onFocus={()=>setFocused(true)} onBlur={event=>{if(!event.currentTarget.contains(event.relatedTarget as Node)&&!popup.current?.contains(event.relatedTarget as Node)){setFocused(false);setDismissed(true);}}}
        onClick={()=>{setCaret(editor.current?.selectionStart ?? 0);setEnd(editor.current?.selectionEnd ?? 0);setDismissed(false);}}
        onCompositionStart={()=>{composing.current=true;setIme(true);}} onCompositionEnd={()=>{composing.current=false;setIme(false);ended.current=performance.now();}}
        onKeyDown={event=>{
          if(event.target!==event.currentTarget||event.defaultPrevented||composing.current||event.nativeEvent.isComposing||event.nativeEvent.keyCode===229||performance.now()-ended.current<=50)return;
          if(open&&event.key==='Escape'){event.preventDefault();setDismissed(true);return;}
          if(open&&count&&['ArrowDown','ArrowUp'].includes(event.key)){event.preventDefault();setSelected((index+(event.key==='ArrowDown'?1:-1)+count)%count);return;}
          if(referenceOpen&&event.key==='ArrowRight'&&candidates[index]?.kind==='directory'){event.preventDefault();drill(candidates[index]!.path);return;}
          if(referenceOpen&&event.key==='ArrowLeft'&&reference?.query.endsWith('/')){event.preventDefault();drill(directory.includes('/')?directory.slice(0,directory.lastIndexOf('/')):'.');return;}
          if(open&&count&&!event.shiftKey&&['Tab','Enter'].includes(event.key)){event.preventDefault();if(!event.repeat){if(referenceOpen)void pick(candidates[index]!);else complete(matches[index]!);}return;}
          if(referenceOpen&&event.key==='Enter'&&!event.shiftKey){event.preventDefault();return;}
          if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();if(!event.repeat){setDismissed(true);onSubmit();}}
        }} />
    </div>
    {error&&<p role="alert" className="text-xs text-danger">{error}</p>}
  </>;
}
