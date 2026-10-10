import { useCallback, useSyncExternalStore } from "react";

/**
 * 开发者视图：本地展示偏好；不是权限边界，不发送到服务端，
 * 不进入 Journal、导出、诊断包或扩展桥主题快照。
 */
const KEY = "nekomimi:developer-view";
const listeners = new Set<() => void>();
let memory = false; // localStorage 不可用时的会话内回退

function read(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return memory;
  }
}
function write(next: boolean) {
  memory = next;
  try {
    if (next) localStorage.setItem(KEY, "1");
    else localStorage.removeItem(KEY);
  } catch {
    /* 回退到 memory */
  }
  document.documentElement.toggleAttribute("data-developer-view", next);
  for (const listener of listeners) listener();
}
function subscribe(onChange: () => void) {
  listeners.add(onChange);
  // 同源其它窗口修改时同步（storage 事件只在“其它”窗口触发）
  const onStorage = (event: StorageEvent) => {
    if (event.key !== KEY) return;
    document.documentElement.toggleAttribute("data-developer-view", read());
    onChange();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onStorage);
  };
}

export function useDeveloperView() {
  const enabled = useSyncExternalStore(subscribe, read, () => false);
  const setEnabled = useCallback((next: boolean) => write(next), []);
  const toggle = useCallback(() => write(!read()), []);
  return { enabled, setEnabled, toggle };
}

/** 启动时同步 html 属性，供纯 CSS 规则使用，避免首帧闪烁。 */
export function installDeveloperViewAttribute() {
  document.documentElement.toggleAttribute("data-developer-view", read());
}
