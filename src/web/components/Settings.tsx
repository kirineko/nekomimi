import { useEffect, useState } from "react";
import { api } from "../api";
interface Config {
  authRevision: number;
  configured: boolean;
}
export function Settings({
  close,
  changed,
}: {
  close: () => void;
  changed: () => Promise<void>;
}) {
  const [config, setConfig] = useState<Config>();
  const [key, setKey] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const load = async () => {
    const c = await api<Config>("/config");
    setConfig(c);
  };
  useEffect(() => {
    void load().catch((e) => setMessage(String(e)));
  }, []);
  const perform = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setMessage("");
    try {
      await fn();
      setKey("");
      await load();
      await changed();
      setMessage("已完成");
    } catch (e) {
      setMessage(String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="modal-backdrop">
      <section
        className="settings-panel"
        role="dialog"
        aria-modal="true"
        aria-label="设置"
      >
        <header>
          <div><span className="settings-eyebrow">NEKOMIMI</span><h2>设置</h2></div>
          <button className="icon" onClick={close} aria-label="关闭设置">
            ×
          </button>
        </header>
        {!config ? (
          <p>{message || "加载…"}</p>
        ) : (
          <>
            <form className="settings-card"
              onSubmit={(e) => {
                e.preventDefault();
                void perform(() =>
                  api("/settings", {
                    kind: "auth",
                    revision: config.authRevision,
                    apiKey: key,
                  }),
                );
              }}
            >
              <label>
                <span className="settings-label">API key <span className={`credential-status ${config.configured ? "configured" : ""}`}>{config.configured ? "已配置" : "未配置"}</span></span>
                <input
                  aria-label="API key"
                  type="password"
                  autoComplete="off"
                  value={key}
                  onChange={(e) => setKey(e.target.value)}
                  placeholder={config.configured ? "输入新密钥以替换" : "输入 API key"}
                />
              </label>
              <a className="api-key-link" href="https://platform.deepseek.com/api_keys" target="_blank" rel="noopener noreferrer">获取 DeepSeek API key ↗</a>
              <div className="settings-actions">
                <button className="settings-primary" disabled={busy || !key.trim()} type="submit">
                  保存 API key
                </button>
                <button
                  disabled={busy || !config.configured}
                  type="button"
                  onClick={() =>
                    void perform(() =>
                      api("/settings", {
                        kind: "auth",
                        revision: config.authRevision,
                        apiKey: null,
                      }),
                    )
                  }
                >
                  清除凭证
                </button>
              </div>
            </form>
            <p role="status">{message}</p>
          </>
        )}
      </section>
    </div>
  );
}
