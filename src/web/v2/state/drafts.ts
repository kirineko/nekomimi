import { useCallback, useSyncExternalStore } from "react";

/**
 * 会话草稿存储：按 mode/target/session 区分，页面导航不清空；
 * 接受收据后由调用方清除已提交文本。密钥类输入不允许进入本存储（D10）。
 */
type Listener = () => void;
const drafts = new Map<string, string>();
const listeners = new Set<Listener>();
const PREFIX = "v2-draft:";

function read(key: string): string {
  const cached = drafts.get(key);
  if (cached !== undefined) return cached;
  try {
    return localStorage.getItem(PREFIX + key) ?? "";
  } catch {
    return "";
  }
}

function write(key: string, value: string) {
  drafts.set(key, value);
  try {
    if (value) localStorage.setItem(PREFIX + key, value);
    else localStorage.removeItem(PREFIX + key);
  } catch {
    /* 存储不可用时仅保留内存草稿 */
  }
  for (const listener of listeners) listener();
}

export function draftKey(mode: string, target: string, session: string | undefined) {
  return `${mode}/${target}/${session ?? "new"}`;
}

export function useDraft(mode: string, target: string, session: string | undefined) {
  const key = draftKey(mode, target, session);
  const value = useSyncExternalStore(
    useCallback((onChange: Listener) => {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    }, []),
    () => read(key),
  );
  const set = useCallback((next: string) => write(key, next), [key]);
  const clear = useCallback(() => write(key, ""), [key]);
  const get = useCallback(() => read(key), [key]);
  return { value, set, clear, get };
}
