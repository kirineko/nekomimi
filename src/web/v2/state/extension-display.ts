import { useSyncExternalStore } from 'react';

const listeners = new Set<() => void>();
let cached: boolean | undefined;
function get() {
  if (cached === undefined) {
    try { cached = sessionStorage.getItem('v2-extension-display') !== 'hidden'; }
    catch { cached = true; }
  }
  return cached;
}
export function setExtensionDisplay(value: boolean) {
  cached = value;
  try { sessionStorage.setItem('v2-extension-display', value ? 'visible' : 'hidden'); } catch { /* Window preference still works without storage. */ }
  for (const notify of listeners) notify();
}
const subscribe = (notify: () => void) => { listeners.add(notify); return () => { listeners.delete(notify); }; };
export function useExtensionDisplay() { return useSyncExternalStore(subscribe, get, () => true); }
