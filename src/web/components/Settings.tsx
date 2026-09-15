import { useInspectorFocus } from "../hooks/useInspectorFocus";
import { useEffect, useState } from "react";
import { api } from "../api";
interface Config {
  revision: number;
  model: string;
  baseUrl: string;
  search: { enabled: boolean; model: string; baseUrl: string };
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
  const panel = useInspectorFocus(close, true, true);
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
      await load().catch(() => {});
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="modal-backdrop">
      <section
        ref={panel}
        className="settings-panel"
        role="dialog"
        aria-modal="true"
        aria-label="设置"
      >
        <header>
          <h2>设置</h2>
          <button className="icon" onClick={close} aria-label="关闭设置">
            ×
          </button>
        </header>
        {!config ? (
          <p>{message || "加载…"}</p>
        ) : (
          <>
            <form
              className="settings-card"
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
                <span className="settings-label">
                  API key{" "}
                  <span
                    className={`credential-status ${config.configured ? "configured" : ""}`}
                  >
                    {config.configured ? "已配置" : "未配置"}
                  </span>
                </span>
                <input
                  aria-label="API key"
                  type="password"
                  autoComplete="off"
                  value={key}
                  onChange={(e) => setKey(e.target.value)}
                  placeholder={
                    config.configured ? "输入新密钥以替换" : "输入 API key"
                  }
                />
              </label>
              <a
                className="api-key-link"
                href="https://platform.deepseek.com/api_keys"
                target="_blank"
                rel="noopener noreferrer"
              >
                获取 DeepSeek API key ↗
              </a>
              <div className="settings-actions">
                <button
                  className="settings-primary"
                  disabled={busy || !key.trim()}
                  type="submit"
                >
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
            <div className="settings-card">
              <label className="check-label">
                <input
                  type="checkbox"
                  checked={config.search.enabled}
                  disabled={busy}
                  onChange={(e) => {
                    const enabled = e.target.checked;
                    setConfig({
                      ...config,
                      search: { ...config.search, enabled },
                    });
                    void perform(() =>
                      api("/settings", {
                        kind: "settings",
                        revision: config.revision,
                        model: config.model,
                        baseUrl: config.baseUrl,
                        search: { ...config.search, enabled },
                      }),
                    );
                  }}
                />
                启用网页搜索
              </label>
              <p className="panel-muted">
                需要时由模型调用 DeepSeek 服务端搜索。
              </p>
            </div>
            {message && (
              <p
                role="status"
                className={
                  message === "已完成" ? "settings-status ok" : "settings-status"
                }
              >
                {message}
              </p>
            )}
          </>
        )}
      </section>
    </div>
  );
}
