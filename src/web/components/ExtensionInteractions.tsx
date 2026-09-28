import {useEffect,useRef,useState} from "react";
import {api} from "../api";
import type {Contribution} from "../../customization/types";
interface Item {
  id: string;
  runId: string;
  resourceId: string;
  value: Contribution;
}
export function ExtensionInteractions({ sessionId }: { sessionId: string }) {
  const [items, setItems] = useState<Item[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    const c = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const r = await api<{ items: Item[] }>(
          `/sessions/${sessionId}/interactions`,
          undefined,
          c.signal,
        );
        setItems(r.items);
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
    <section aria-label="扩展交互">
      {error && <p role="alert">{error}</p>}
      {items.map((item) => (
        <ExtensionForm
          key={item.id}
          item={item}
          sessionId={sessionId}
          done={() => setItems((old) => old.filter((i) => i.id !== item.id))}
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
  const submission = useRef<{ payload: string; id: string }>(undefined);
  return (
    <form
      className="extension-form"
      onSubmit={(e) => {
        e.preventDefault();
        const answer = Object.fromEntries(new FormData(e.currentTarget));
        const payload = JSON.stringify(answer);
        if (submission.current?.payload !== payload)
          submission.current = { payload, id: crypto.randomUUID() };
        setBusy(true);
        setError("");
        void api(`/sessions/${sessionId}/answer`, {
          id: item.id,
          commandId: submission.current.id,
          answer,
        })
          .then(done)
          .catch((e) => setError(String(e)))
          .finally(() => setBusy(false));
      }}
    >
      <h3>{item.value.title}</h3>
      <p>{item.value.text}</p>
      {item.value.fields?.map((field) => (
        <label key={field.name}>
          {field.label}
          {field.options ? (
            <select name={field.name} required={field.required} disabled={busy}>
              <option value="">请选择</option>
              {field.options.map((o) => (
                <option key={o}>{o}</option>
              ))}
            </select>
          ) : (
            <input
              name={field.name}
              required={field.required}
              disabled={busy}
            />
          )}
        </label>
      ))}
      {error && <p role="alert">{error}</p>}
      <button disabled={busy}>提交回答</button>
    </form>
  );
}
