import type { Cursor, Update } from "../shared/protocol.js";
export class ClientError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
export const AUTH_LOST = "nekomimi:auth-lost";
export const AUTH_RESTORED = "nekomimi:auth-restored";

export async function request(
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const response = await fetch(`/api/v1${path}`, {
    ...init,
    headers: {
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  if (!response.ok) {
    const data = await response.json();
    const error = new ClientError(
      data.error?.code ?? "network",
      data.error?.message ?? "请求失败",
    );
    // 401 auth：连接 cookie 失效或服务重启。通知根部显示整页引导，不自动重发写命令。
    if (response.status === 401 && error.code === "auth")
      window.dispatchEvent(new CustomEvent(AUTH_LOST));
    throw error;
  }
  return response;
}
export async function api<T>(
  path: string,
  value?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  return (
    await request(
      path,
      value === undefined
        ? { signal }
        : { method: "POST", body: JSON.stringify(value), signal },
    )
  ).json();
}
export async function connect() {
  const params = new URLSearchParams(location.hash.slice(1));
  const token = params.get("token");
  if (token) {
    history.replaceState(null, "", location.pathname + location.search);
    await request("/connect", {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
    });
    // 终端链接重新授权成功：清除失效状态，关闭整页引导
    window.dispatchEvent(new CustomEvent(AUTH_RESTORED));
  }
  return api<{ workspace: string; configured: boolean }>("/config");
}
export async function stream(
  sessionId: string,
  cursor: Cursor,
  signal: AbortSignal,
  receive: (update: Update) => void,
) {
  const response = await request(
    `/sessions/${sessionId}/events?seq=${cursor.seq}&hash=${cursor.hash}`,
    { signal },
  );
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const frames = buffer.split("\n\n");
      buffer = frames.pop() ?? "";
      for (const frame of frames) {
        const type = frame
          .split("\n")
          .find((l) => l.startsWith("event:"))
          ?.slice(6)
          .trim();
        const data = frame
          .split("\n")
          .find((l) => l.startsWith("data:"))
          ?.slice(5);
        if (!data) continue;
        if (type === "deleted") throw new ClientError("deleted", "会话已删除");
        if (type === "reset") throw new ClientError("reset", "重新同步历史");
        if (type === "stream-error")
          throw new ClientError("stream", JSON.parse(data).message);
        if (type === "update") receive(JSON.parse(data));
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
}
