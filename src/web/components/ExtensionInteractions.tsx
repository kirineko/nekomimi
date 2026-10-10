import {useEffect,useRef,useState} from "react";
import {Button} from "../ui/Button";
import {Input,Select} from "../ui/Input";
import {api} from "../api";
import type {Contribution} from "../../customization/types";
interface Item {
  sessionId: string;
  id: string;
  runId: string;
  resourceId: string;
  value: Contribution;
}
export function ExtensionInteractions({ sessionId }: { sessionId: string }) {
  const [items, setItems] = useState<Item[]>([]);
  const [error, setError] = useState("");
  const answered=useRef(new Set<string>());
  useEffect(() => {
    const c = new AbortController();
    setItems([]);setError("");answered.current.clear();
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const r = await api<{ items: Item[] }>(
          `/sessions/${sessionId}/interactions`,
          undefined,
          c.signal,
        );
        if(!c.signal.aborted){setItems(r.items.filter(item=>!answered.current.has(item.id)));setError("");}
      } catch (e) {
        if (!c.signal.aborted) setError(String(e));
      }
      if (!c.signal.aborted) timer = setTimeout(poll, 800);
    };
    void poll();
    return () => {
      c.abort();
      clearTimeout(timer);
    };
  }, [sessionId]);
  return (
    <section aria-label="扩展交互" className="max-h-[35dvh] space-y-3 overflow-auto">
      {error && <p role="alert">{error}</p>}
      {items.filter(item=>item.sessionId===sessionId).map((item) => (
        <ExtensionForm
          key={`${sessionId}:${item.id}`}
          item={item}
          sessionId={sessionId}
          done={() => {answered.current.add(item.id);setItems((old) => old.filter((i) => i.id !== item.id));}}
        />
      ))}
    </section>
  );
}
function ExtensionForm({
  item,
  sessionId,
  done,
}: {
  item: Item;
  sessionId: string;
  done: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const inflight=useRef<AbortController|undefined>(undefined);
  useEffect(()=>()=>inflight.current?.abort(),[sessionId,item.id]);
  const submission = useRef<{ payload: string; id: string }>(undefined);
  return (
    <form
      className="space-y-3 rounded-md border border-line bg-panel p-3 text-sm"
      onSubmit={(e) => {
        e.preventDefault();
        if(inflight.current)return;
        const answer = Object.fromEntries(new FormData(e.currentTarget));
        const payload = JSON.stringify(answer);
        if (submission.current?.payload !== payload)
          submission.current = { payload, id: crypto.randomUUID() };
        const abort=new AbortController();inflight.current=abort;
        setBusy(true);
        setError("");
        void api(`/sessions/${sessionId}/answer`, {
          id: item.id,
          commandId: submission.current.id,
          answer,
        },abort.signal)
          .then(()=>{if(!abort.signal.aborted)done();})
          .catch((e) => {if(!abort.signal.aborted)setError(String(e));})
          .finally(() => {if(!abort.signal.aborted){inflight.current=undefined;setBusy(false);}});
      }}
    >
      <h3 className="font-semibold">{item.value.title}</h3>
      <p className="whitespace-pre-wrap break-words">{item.value.text}</p>
      {item.value.fields?.map((field) => (
        <label key={field.name} className="block space-y-1">
          {field.label}
          {field.options ? (
            <Select name={field.name} required={field.required} disabled={busy}>
              <option value="">请选择</option>
              {field.options.map((o) => (
                <option key={o}>{o}</option>
              ))}
            </Select>
          ) : (
            <Input
              name={field.name}
              required={field.required}
              disabled={busy}
            />
          )}
        </label>
      ))}
      {error && <p role="alert">{error}</p>}
      <Button type="submit" busy={busy}>提交回答</Button>
    </form>
  );
}
