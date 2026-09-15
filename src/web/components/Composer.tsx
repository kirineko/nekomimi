import { useState } from "react";
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
  const [text, setText] = useState("");
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
          disabled={!configured || pending}
          aria-label="任务内容"
          placeholder={
            configured
              ? "交给 Deepy…"
              : "在服务端配置 DEEPSEEK_API_KEY 后即可提交任务"
          }
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
              e.preventDefault();
              void send();
            }
          }}
          maxLength={32000}
        />
        <div className="composer-bottom">
          <span>DeepSeek</span>
          {busy ? (
            <button
              type="button"
              className="stop"
              onClick={() => {
                void cancel().catch((e) => setError(String(e)));
              }}
            >
              ■ 停止任务
            </button>
          ) : (
            <button
              className="primary"
              title="⌘ / Ctrl + Enter"
              type="submit"
              disabled={pending || !configured || !text.trim()}
            >
              {pending ? "确认中…" : "发送任务 ↑"}
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
