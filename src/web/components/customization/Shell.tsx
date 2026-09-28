import { useEffect, useRef, type ReactNode } from "react";
import { CatMark } from "../Brand";
import type { Management } from "./types";

const categories = [
  { id: "models", label: "模型", symbol: "✧" },
  { id: "resources", label: "资源", symbol: "◇" },
  { id: "packages", label: "能力包", symbol: "▧" },
  { id: "workflows", label: "工作流与面板", symbol: "⌘" },
] as const;
export type Category = typeof categories[number]["id"];

export function CategoryPanel({ id, active, children }: { id: Category; active: Category; children: ReactNode }) {
  // Keep forms and explicit panel mounts alive across navigation. Hidden trees are not focusable.
  return <div role="tabpanel" id={`customization-${id}`} aria-labelledby={`customization-tab-${id}`} hidden={id !== active} className="customization-category">{children}</div>;
}

export function CustomizationShell({ close, category, onCategory, data, children, modelIssue }: {
  close: () => void; category: Category; onCategory: (id: Category) => void; data?: Management; children: ReactNode; modelIssue: boolean;
}) {
  const root = useRef<HTMLElement>(null);
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
    const backdrop = root.current!.parentElement!;
    const siblings = Array.from(backdrop.parentElement!.children).filter((node): node is HTMLElement => node instanceof HTMLElement && node !== backdrop);
    const states = siblings.map(node => node.inert);
    siblings.forEach(node => { node.inert = true; });
    root.current?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.focus();
    const focusables = () => Array.from(root.current!.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], summary, iframe, [tabindex="0"]')).filter(node => node.tabIndex >= 0 && !node.closest('[hidden], [inert]') && node.checkVisibility({ visibilityProperty: true }) && !Array.from(node.closest('details:not([open])')?.children ?? []).some(child => child.tagName !== 'SUMMARY' && (child === node || child.contains(node))));
    const keydown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (event.key === "Escape") { event.preventDefault(); closeRef.current(); }
      if (event.key === "Tab") {
        const items = focusables();
        const index = items.indexOf(document.activeElement as HTMLElement);
        event.preventDefault();
        items[(index + (event.shiftKey ? -1 : 1) + items.length) % items.length]?.focus();
      }
    };
    const containFocus = (event: FocusEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) focusables()[0]?.focus();
    };
    document.addEventListener("keydown", keydown);
    document.addEventListener("focusin", containFocus);
    return () => {
      document.removeEventListener("keydown", keydown);
      document.removeEventListener("focusin", containFocus);
      siblings.forEach((node, i) => { node.inert = states[i] ?? false; });
      if (opener?.isConnected) opener.focus();
    };
  }, []);
  useEffect(() => {
    const body = root.current?.querySelector(".customization-body");
    if (body) body.scrollTop = 0;
    if (document.activeElement?.closest('[hidden]') || document.activeElement === document.body) {
      document.getElementById(`customization-tab-${category}`)?.focus();
    }
  }, [category]);
  const attention: Record<Category, number> = {
    models: modelIssue ? 1 : 0,
    resources: (data?.resources.filter(r => r.status === "untrusted" || r.status === "error" || !!r.error).length ?? 0) + (data?.candidates?.length ?? 0) + (data?.mcp?.filter(m => m.toolErrors.length > 0).length ?? 0),
    packages: data?.packageCandidates?.length ?? 0,
    workflows: data?.workflows?.filter(w => w.status === "unknown" || w.status === "waiting" || !!w.error).length ?? 0,
  };
  return <div className="modal-backdrop customization-backdrop">
    <section ref={root} className="settings-panel customization-panel" role="dialog" aria-modal="true" aria-label="定制能力">
      <header className="customization-header">
        <div className="customization-identity"><span className="customization-mascot"><CatMark /></span><div><span className="customization-eyebrow">MAKE IT YOURS <span aria-hidden="true">✦</span></span><h2>定制能力</h2><p>给你的猫系搭档，一点专属灵感。</p></div></div>
        <button className="customization-close" onClick={close} aria-label="关闭定制能力">×</button>
      </header>
      <div role="tablist" aria-label="定制分类" className="customization-tabs">
        {categories.map((item, index) => <button key={item.id} role="tab" id={`customization-tab-${item.id}`} aria-controls={`customization-${item.id}`} aria-selected={category === item.id} tabIndex={category === item.id ? 0 : -1} onClick={() => onCategory(item.id)} onKeyDown={event => {
          let next: number;
          if (event.key === "ArrowRight" || event.key === "ArrowDown") next = (index + 1) % categories.length;
          else if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = (index + categories.length - 1) % categories.length;
          else if (event.key === "Home") next = 0;
          else if (event.key === "End") next = categories.length - 1;
          else return;
          event.preventDefault(); onCategory(categories[next]!.id);
          document.getElementById(`customization-tab-${categories[next]!.id}`)?.focus();
        }}><span aria-hidden="true">{item.symbol}</span>{item.label}{attention[item.id] > 0 && <span className="customization-count" aria-label={`${attention[item.id]} 项待处理`}>{attention[item.id]}</span>}</button>)}
      </div>
      <div className="customization-body">{children}</div>
      <footer className="customization-footer"><span aria-hidden="true">✦</span> 小小定制，无限可能 <span>NEKOMIMI</span></footer>
    </section>
  </div>;
}
