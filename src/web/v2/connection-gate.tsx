import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";
import { api, AUTH_LOST, AUTH_RESTORED } from "../api";
import { Button } from "../ui/Button";

/**
 * 连接授权失效的整页引导（local-web-service 新增 Requirement）。
 * 引导覆盖在既有界面上而不是替换 children：会话草稿保存在 localStorage，
 * 未卸载的组件树保留 IME 组合态与滚动位置；重新授权后只做读请求。
 */
export function ConnectionGate({ children }: { children: ReactNode }) {
  const [lost, setLost] = useState(false);
  const [checking, setChecking] = useState(false);
  const client = useQueryClient();
  useEffect(() => {
    const lost_ = () => setLost(true);
    const restored = () => setLost(false);
    window.addEventListener(AUTH_LOST, lost_);
    window.addEventListener(AUTH_RESTORED, restored);
    return () => {
      window.removeEventListener(AUTH_LOST, lost_);
      window.removeEventListener(AUTH_RESTORED, restored);
    };
  }, []);
  const retry = async () => {
    setChecking(true);
    try {
      await api("/config");
      setLost(false);
      await client.invalidateQueries({ type: "active" });
    } catch {
      /* 仍未授权：保持引导 */
    } finally {
      setChecking(false);
    }
  };
  return (
    <>
      <div hidden={lost}>{children}</div>
      {lost && (
        <main className="ds grid min-h-dvh place-items-center bg-background p-6 text-foreground">
          <section
            role="alertdialog"
            aria-labelledby="auth-title"
            aria-describedby="auth-desc"
            className="max-w-md space-y-4 rounded-2xl border border-line bg-background p-6 shadow-floating"
          >
            <h1 id="auth-title" className="text-xl">
              需要从终端打开 Nekomimi
            </h1>
            <p id="auth-desc" className="text-sm text-muted">
              为保护本地数据，浏览器需要终端打印的一次性链接才能连接。请在启动{" "}
              <code>nekomimi web</code> 的终端中重新打开链接。
            </p>
            <Button onClick={() => void retry()} busy={checking}>
              我已重新打开，重试
            </Button>
          </section>
        </main>
      )}
    </>
  );
}
