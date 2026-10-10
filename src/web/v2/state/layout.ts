import { useCallback, useSyncExternalStore } from "react";

/** 分栏/视图布局状态：按工作台持久化非敏感布局，不触发任何执行（D10）。 */
const PREFIX = "v2-layout:";
const listeners = new Set<() => void>();

export function readLayout(key: string): string | undefined {
  try {
    return localStorage.getItem(PREFIX + key) ?? undefined;
  } catch {
    return undefined;
  }
}

export function writeLayout(key: string, value: string) {
  try {
    localStorage.setItem(PREFIX + key, value);
  } catch {
    /* 布局持久化失败不影响使用 */
  }
  for (const listener of listeners) listener();
}

export function useLayout(key: string) {
  const value = useSyncExternalStore(
    useCallback((onChange: () => void) => {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    }, []),
    () => readLayout(key) ?? null,
  );
  const set = useCallback((next: string) => writeLayout(key, next), [key]);
  return { value, set };
}
