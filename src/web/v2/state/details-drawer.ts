import { useSyncExternalStore } from "react";

export type DetailsTab = "changes" | "files" | "evidence" | "extensions";

interface DrawerState {
  open: boolean;
  tab: DetailsTab;
  revision: number;
}

let state: DrawerState = { open: false, tab: "changes", revision: 0 };
const listeners = new Set<() => void>();
const emit = () => {
  for (const listener of listeners) listener();
};

/** 详情抽屉：轻量全局状态。只影响展示；面板实例始终挂载（见 WorkbenchShell）。 */
export const detailsDrawer = {
  get: () => state,
  open(tab: DetailsTab = state.tab) {
    state = { open: true, tab, revision: state.revision + 1 };
    emit();
  },
  close() {
    if (state.open) {
      state = { ...state, open: false };
      emit();
    }
  },
  toggle(tab?: DetailsTab) {
    if (state.open && (!tab || tab === state.tab)) detailsDrawer.close();
    else detailsDrawer.open(tab);
  },
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};

export const useDetailsDrawer = () =>
  useSyncExternalStore(detailsDrawer.subscribe, detailsDrawer.get, detailsDrawer.get);

/** 窄屏导航覆盖层：与详情抽屉互斥，宽屏下无意义。 */
let navOpen = false;
const navListeners = new Set<() => void>();
export const navOverlay = {
  get: () => navOpen,
  toggle() {
    navOpen = !navOpen;
    if (navOpen) detailsDrawer.close();
    for (const listener of navListeners) listener();
  },
  close() {
    if (!navOpen) return;
    navOpen = false;
    for (const listener of navListeners) listener();
  },
  subscribe(listener: () => void) {
    navListeners.add(listener);
    return () => {
      navListeners.delete(listener);
    };
  },
};
export const useNavOverlay = () =>
  useSyncExternalStore(navOverlay.subscribe, navOverlay.get, navOverlay.get);
