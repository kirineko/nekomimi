import type { Cursor, Update } from "../shared/protocol";
export class ClientError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
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
    throw new ClientError(
      data.error?.code ?? "network",
      data.error?.message ?? "请求失败",
    );
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
