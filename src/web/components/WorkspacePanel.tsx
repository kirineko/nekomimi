import { createContext, useEffect, useState, type ReactNode } from "react";
import { useInspectorFocus } from "../hooks/useInspectorFocus";
export const LocateFile = createContext<((path: string) => void) | undefined>(
  undefined,
);
export type PanelTab = "files" | "changes" | "trace";
export function WorkspacePanel({
  tab,
  setTab,
  close,
  children,
}: {
  tab: PanelTab;
  setTab: (tab: PanelTab) => void;
  close: () => void;
  children: ReactNode;
}) {
  const panel = useInspectorFocus(close);
  const [narrow, setNarrow] = useState(
    matchMedia("(max-width: 1199px)").matches,
  );
  useEffect(() => {
    const m = matchMedia("(max-width: 1199px)");
    const update = () => setNarrow(m.matches);
    m.addEventListener("change", update);
    return () => m.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    if (!narrow) return;
    const siblings = [
      ...document.querySelectorAll<HTMLElement>(".workbench,.sidebar"),
    ];
    for (const el of siblings) el.inert = true;
    return () => {
      for (const el of siblings) el.inert = false;
    };
  }, [narrow]);
  return (
    <>
      {narrow && <div className="workspace-scrim" onClick={close} />}
      <aside
        className="workspace-panel"
        ref={panel}
        role={narrow ? "dialog" : "complementary"}
        aria-modal={narrow || undefined}
        aria-label="工作区面板"
      >
        <header>
          <strong>工作区</strong>
          <button className="icon" aria-label="关闭工作区面板" onClick={close}>
            ×
          </button>
        </header>
        <div className="workspace-tabs" role="tablist" aria-label="工作区视图">
          {(
            [
              ["files", "文件"],
              ["changes", "变更"],
              ["trace", "执行详情"],
            ] as const
          ).map(([id, title]) => (
            <button
              role="tab"
              id={`tab-${id}`}
              aria-controls="workspace-content"
              aria-selected={tab === id}
              tabIndex={tab === id ? 0 : -1}
              key={id}
              onClick={() => setTab(id)}
              onKeyDown={(e) => {
                if (["ArrowLeft", "ArrowRight"].includes(e.key)) {
                  e.preventDefault();
                  const ids: PanelTab[] = ["files", "changes", "trace"];
                  const next =
                    ids[
                      (ids.indexOf(tab) + (e.key === "ArrowRight" ? 1 : 2)) % 3
                    ]!;
                  setTab(next);
                  document.getElementById(`tab-${next}`)?.focus();
                }
              }}
            >
              {title}
            </button>
          ))}
        </div>
        <div
          className="workspace-content"
          id="workspace-content"
          role="tabpanel"
          aria-labelledby={`tab-${tab}`}
        >
          {children}
        </div>
      </aside>
    </>
  );
}
