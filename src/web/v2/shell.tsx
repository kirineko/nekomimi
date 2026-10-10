import { SettingsMenu, type SettingsMenuHandle } from "./settings-menu";
import catMark from "../assets/nekomimi.svg";
import { useWorkbenchTheme } from './theme';
import * as React from "react";
import { Link } from "@tanstack/react-router";
import { PanelGroup, ResizablePanel, PanelSeparator } from "../ui/Resizable";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { CoreStatusBadge } from "./core-status";
import { useLayout } from "./state/layout";
import { usePanelRef } from "react-resizable-panels";
import { detailsDrawer, navOverlay, useDetailsDrawer, useNavOverlay } from "./state/details-drawer";

export type Mode = "work" | "create";

/** 主题：明暗 tokens 切换，素材缺失时回退宿主默认（浅色）；主题不改变模式或授权事实。 */
export function useTheme() {
  const [theme, setTheme] = React.useState<"light" | "dark">(() => {
    try {
      const saved = localStorage.getItem("v2-theme");
      if (saved === "dark" || saved === "light") return saved;
    } catch {
      /* ignore */
    }
    return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  });
  React.useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem("v2-theme", theme);
    } catch {
      /* ignore */
    }
  }, [theme]);
  return { theme, setTheme };
}

export function useNarrow() {
  const [narrow, setNarrow] = React.useState(
    () => matchMedia("(max-width: 760px)").matches,
  );
  React.useEffect(() => {
    const media = matchMedia("(max-width: 760px)");
    const onChange = () => setNarrow(media.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);
  return narrow;
}

export function TopBar({
  mode,
  target,
  status,
  running,
  onStop,
  theme,
  onTheme,
}: {
  mode: Mode;
  target: string;
  status?: string;
  running?: boolean;
  onStop?: () => void;
  theme: "light" | "dark";
  onTheme: (theme: "light" | "dark") => void;
}) {
  const customTheme = useWorkbenchTheme();
  const settings = React.useRef<SettingsMenuHandle>(null);
  const narrow = useNarrow();
  const nav = useNavOverlay();
  return (
    <header className="flex min-h-14 flex-shrink-0 flex-wrap items-center justify-between gap-3 border-b border-line bg-background px-6 py-3 max-[760px]:px-3.5">
      <div className="flex items-center gap-2.5 min-[521px]:min-w-40">
        {narrow && (
          <Button size="sm" variant="ghost" aria-expanded={nav} aria-controls="nav" onClick={() => navOverlay.toggle()}>
            会话
          </Button>
        )}
        <span
          data-theme-decoration
          aria-hidden
          className="rounded-md border border-line bg-wash px-2 py-0.5 font-mono text-sm font-bold text-brand"
        >
          <img src={catMark} data-brand-mark alt="" aria-hidden="true" className="block h-5 w-7" />
        </span>
        <strong className="text-base tracking-tight max-[520px]:hidden">Nekomimi</strong>
        {mode === "create" && <Badge>{target}</Badge>}
      </div>
      <nav aria-label="模式" className="flex rounded-lg bg-panel p-0.5">
        <Link
          to="/work"
          aria-current={mode === "work" ? "page" : undefined}
          className={
            mode === "work"
              ? "rounded-md bg-wash px-6 py-1 font-semibold text-foreground"
              : "rounded-md px-6 py-1 text-muted"
          }
        >
          工作
        </Link>
        <Link
          to="/create"
          aria-current={mode === "create" ? "page" : undefined}
          className={
            mode === "create"
              ? "rounded-md bg-wash px-6 py-1 font-semibold text-foreground"
              : "rounded-md px-6 py-1 text-muted"
          }
        >
          创造
        </Link>
      </nav>
      <div className="flex flex-wrap items-center gap-2.5">
        <CoreStatusBadge onOpenRecovery={() => settings.current?.openRecovery()} />
        {customTheme.error && <span role="status" className="max-w-64 break-words text-xs">{customTheme.error}</span>}
        {status && (
          <Badge state={status === "错误" ? "danger" : status === "待授权" ? "warning" : "default"}>
            {status}
          </Badge>
        )}
        {running && onStop && (
          <Button variant="destructive" size="sm" onClick={onStop}>
            停止
          </Button>
        )}
        <SettingsMenu ref={settings} mode={mode} theme={theme} onTheme={onTheme} />
      </div>
    </header>
  );
}

/**
 * 双工作台外壳：宽屏默认两栏（会话导航 + 主区），详情为可折叠面板（始终挂载，
 * 扩展 iframe / 文件浏览器状态在开合与断点变化时不丢失）；窄屏（≤760px）转单主区，
 * 导航与详情为覆盖层，模式、停止、返回始终可达。
 * 布局持久化只保存宽度（v2），打开状态默认收起。
 */
export function WorkbenchShell({
  mode,
  navigation,
  main,
  details,
  revealDetails,
}: {
  mode: Mode;
  navigation: React.ReactNode;
  main: React.ReactNode;
  details?: React.ReactNode;
  /** 兼容旧调用：文件定位等外部触发自动展开详情。 */
  revealDetails?: number;
}) {
  const narrow = useNarrow();
  const layout = useLayout(`shell-${mode}`);
  const drawer = useDetailsDrawer();
  const nav = useNavOverlay();
  const detailsPanel = usePanelRef();
  const closeButton = React.useRef<HTMLButtonElement>(null);
  const returnFocus = React.useRef<HTMLElement | null>(null);

  React.useEffect(() => { if (revealDetails) detailsDrawer.open("files"); }, [revealDetails]);
  // 详情打开时收起导航覆盖层；回到宽屏时两个覆盖层都复位
  React.useEffect(() => { if (drawer.open && narrow) navOverlay.close(); }, [drawer.open, narrow]);
  React.useEffect(() => { if (!narrow) navOverlay.close(); }, [narrow]);
  // 宽屏→窄屏：宽屏中打开的详情面板不应突然变成遮挡全屏的覆盖层
  const wasNarrow = React.useRef(narrow);
  React.useEffect(() => {
    if (narrow && !wasNarrow.current) detailsDrawer.close();
    wasNarrow.current = narrow;
  }, [narrow]);
  // 切换模式时关闭抽屉（内容保持挂载）
  React.useEffect(() => () => detailsDrawer.close(), [mode]);
  // 宽屏：drawer.open ↔ 面板 expand/collapse
  React.useEffect(() => {
    if (narrow || !detailsPanel.current) return;
    if (drawer.open) detailsPanel.current.expand();
    else detailsPanel.current.collapse();
  }, [drawer.open, narrow, detailsPanel]);
  // 打开时聚焦关闭按钮，关闭时还焦点给触发者
  React.useEffect(() => {
    if (drawer.open) {
      returnFocus.current = document.activeElement as HTMLElement | null;
      closeButton.current?.focus({ preventScroll: true });
    } else {
      returnFocus.current?.focus({ preventScroll: true });
      returnFocus.current = null;
    }
  }, [drawer.open]);

  const [savedLayout] = React.useState(() => {
    try {
      const value = JSON.parse(layout.value ?? 'null');
      // v2：只保存 nav/details 宽度；旧 v1 三键结构直接丢弃
      if (value && value.version === 2 && Number.isFinite(value.nav) && Number.isFinite(value.details)
        && value.nav > 5 && value.details > 10) return { nav: value.nav, main: 100 - value.nav - value.details, details: value.details };
    } catch { /* Invalid local preferences use the default proportions. */ }
    return undefined;
  });
  return (
    <div className="workbench-shell flex min-h-0 min-w-0 flex-1 flex-col"
      data-narrow={narrow || undefined} data-details-open={drawer.open || undefined} data-nav-open={nav || undefined}
      data-testid={narrow ? 'mobile-layout' : 'desktop-layout'}>
      <PanelGroup orientation="horizontal" disabled={narrow} defaultLayout={savedLayout}
        className="min-h-0 flex-1"
        onLayoutChanged={value => {
          if (narrow) return;
          const detailsWidth = value["details"];
          const navWidth = value["nav"];
          if (typeof navWidth !== "number") return;
          try {
            const saved = JSON.parse(layout.value ?? "null") as { version?: number; details?: number } | null;
            const details = typeof detailsWidth === "number" && detailsWidth > 0
              ? detailsWidth
              : saved?.version === 2 && typeof saved.details === "number"
                ? saved.details
                : 26;
            layout.set(JSON.stringify({ version: 2, nav: navWidth, details }));
          } catch { /* 布局持久化失败不影响使用 */ }
        }}>
        <ResizablePanel id="nav" defaultSize="18%" minSize="14%" maxSize="28%">
          <div className="h-full overflow-auto bg-panel px-3 py-4">{navigation}</div>
        </ResizablePanel>
        <PanelSeparator aria-label="调整导航宽度" disabled={narrow} />
        <ResizablePanel id="main" minSize="45%">{main}</ResizablePanel>
        {details && <>
          <PanelSeparator aria-label="调整详情宽度" disabled={narrow || !drawer.open} />
          <ResizablePanel id="details" panelRef={detailsPanel} collapsible collapsedSize={0} defaultSize={0} minSize="24%" maxSize="45%">
            <aside aria-label="详情" hidden={!narrow && !drawer.open}
              className="flex h-full flex-col bg-panel"
              onKeyDown={event => { if (event.key === "Escape" && !event.defaultPrevented) { event.preventDefault(); detailsDrawer.close(); } }}>
              <div className="flex items-center justify-between border-b border-line px-4 py-2">
                <h2 className="text-sm">详情</h2>
                <Button ref={closeButton} size="sm" variant="ghost" onClick={() => detailsDrawer.close()}>关闭详情</Button>
              </div>
              <div className="min-h-0 flex-1 overflow-auto p-4">{details}</div>
            </aside>
          </ResizablePanel>
        </>}
      </PanelGroup>
    </div>
  );
}
