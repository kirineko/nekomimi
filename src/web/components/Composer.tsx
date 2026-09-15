import { useEffect, useRef, useState } from "react";
export function Composer({
  busy,
  configured,
  submit,
  cancel,
}: {
  busy: boolean;
  configured: boolean;
  submit: (text: string) => Promise<void>;
  cancel: () => Promise<void>;
}) {
  const textarea = useRef<HTMLTextAreaElement>(null);
  const composing = useRef(false);
  const ended = useRef(0);
  const [text, setText] = useState("");
  useEffect(() => {
    const el = textarea.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = Math.min(180, Math.max(48, el.scrollHeight)) + "px";
    }
  }, [text]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const send = async () => {
    if (pending || busy || !text.trim()) return;
    setPending(true);
    setError("");
    try {
      await submit(text);
      setText("");
    } catch (e) {
      setError(String(e));
    } finally {
      setPending(false);
    }
  };
  return (
    <div className="composer-wrap">
      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <textarea
          ref={textarea}
          disabled={!configured || pending}
          aria-label="任务内容"
          placeholder={
            configured ? "交给 Nekomimi…" : "打开设置，保存 API key 后即可发送"
          }
          value={text}
          onChange={(e) => setText(e.target.value)}
          onCompositionStart={() => {
            composing.current = true;
          }}
          onCompositionEnd={() => {
            composing.current = false;
            ended.current = performance.now();
          }}
          onKeyDown={(e) => {
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
        <div className="composer-bottom">
          <span className="composer-meta">
            <span>DeepSeek</span>
            <span className="composer-hint">Enter 发送 · Shift+Enter 换行</span>
          </span>
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
