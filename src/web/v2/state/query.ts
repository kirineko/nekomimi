import { QueryClient } from "@tanstack/react-query";

/** 只读查询可有限重试；mutation 一律不自动重试，网络确认丢失须按原 commandId 显式重提（D10）。 */
export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      // 只读查询在窗口聚焦/网络恢复时自动刷新（取代常驻“刷新”按钮）；
      // mutation 一律不自动重试，网络确认丢失须按原 commandId 显式重提（D10）。
      queries: { retry: 1, staleTime: 5_000, refetchOnWindowFocus: true, refetchOnReconnect: true },
      mutations: { retry: false },
    },
  });
}

/** cache key 必须含宿主/模式/目标/会话，迟到数据按 key 隔离。 */
export function v2Key(
  host: string,
  mode: "work" | "create",
  target: string,
  session: string | undefined,
  ...rest: unknown[]
) {
  return ["v2", host, mode, target, session ?? "-", ...rest] as const;
}

export const v2Host = () => location.host;
