## Context

动机见 proposal.md 的 Why。以下是影响实现方式的现状与约束：

- 前端入口 `src/web/main.tsx` 先调用 `connect()`，再动态加载 `v2/app`。样式唯一入口是 `src/web/styles/tokens.css`，目前只导入 Tailwind 的 `theme.css` 和 `utilities.css`，没有 `preflight.css`；页面作用域通过 `.ds` 类实现，其中 Dialog Portal 也加了 `.ds`。
- `src/server/app.ts:418-421` 对所有静态响应（包括 index.html）统一设置 `style-src 'self'`。Radix Dialog 1.2.0 依赖 `react-remove-scroll` → `react-style-singleton` → `get-nonce@1.0.1`，打开时会 `document.createElement('style')` 并通过 `getNonce()` 取得 nonce；现在取不到，所以被 CSP 拦截。主题使用 `document.adoptedStyleSheets`，react-resizable-panels 用 `CSSStyleSheet.insertRule`（构造样式表）。这两者不受 `style-src` 中“元素型内联样式”的限制（Chrome 对 constructable stylesheet 不检查 nonce），只需在验证中确认。
- 元素 `style={{width}}` 属性（如上下文 meter）属于 `style-src-attr`。在只有 `style-src 'self'` 的情况下，React 通过 CSSOM（`element.style.width = …`）设置，不受 CSP 拦截，可以保留；不得改用 `setAttribute('style', …)`。
- 外壳 `src/web/v2/shell.tsx`：`TopBar` 和 `WorkbenchShell` 的三栏使用 `react-resizable-panels@4.14.2`，该版本支持 `collapsible` 和 `usePanelRef()`。窄屏通过 `tokens.css` 中 `.workbench-shell[data-narrow]` 的 CSS 隐藏导航和详情，规格要求面板实例在断点变化时保持挂载。
- `router.tsx` 中每个管理页路由都把 `navigation`/`details` 重复传给 `WorkbenchShell`；`WorkNavigation`/`CreateNavigation` 把管理链接硬编码在会话列表上方。
- 查询客户端 `refetchOnWindowFocus: false`。会话列表另有 `refetchInterval: 5000`，但界面上仍放了“刷新会话列表”按钮。交接卡和确认状态 `retry:false`，只能手动刷新。
- 浏览器测试（`test/browser`，54 个文件，`workers: 1`）大量使用 `getByRole('button',{name:'更多操作'})` 等文案选择器，`playwright.config.ts` 的默认视口为 1440×1000。
- 前置条件：`next-generation-nekomimi` 先归档，本设计以归档后的主规格为基线。

## Goals / Non-Goals

**Goals:**
- 一处定义开发者视图状态，任何组件用一个 Hook 或包装组件即可按层显示，避免到处写条件判断。
- 详情改为抽屉，同时**保持面板实例挂载**：扩展 iframe、文件浏览器滚动位置和标签状态在开合时不丢失。
- 管理页路由不再重复 `navigation/details` 样板代码，设置总览由数据驱动生成。
- CSP 保持严格：只增加按请求生成的 nonce，不放宽为 unsafe-inline。
- 测试迁移可以机械完成：提供夹具 `openSettings()`、`enableDeveloperView()`、`openSessionMenu()`。

**Non-Goals:**
- 不改服务端 API、协议类型或 Journal；唯一的服务端改动是静态 HTML 的 nonce 注入和 CSP 头。
- 不重写 inspection、context-details、handoff-compose 的内部逻辑，只调整入口和外层展示。
- 不引入 i18n 框架；术语表是一个简单的常量模块。

## Decisions

### D1. CSP：按请求生成 nonce，并通过 `<meta property="csp-nonce">` 与 `get-nonce.setNonce` 提供给前端

**选择**：服务端返回 index.html 时生成 `randomBytes(16).toString('base64')`，替换 HTML 中的占位符 `__CSP_NONCE__`，CSP 头改为 `style-src 'self' 'nonce-<n>'`。前端在**加载任何 Radix 代码之前**，从 meta 中读取 nonce 并调用 `get-nonce` 的 `setNonce`。

**备选**：
- (a) `style-src 'unsafe-inline'`：最简单，但违背 local-web-service 的安全基线，被拒绝。
- (b) 换掉 Radix Dialog，自写不注入样式的对话框：成本高，还会丢失已验证的焦点和滚动锁行为。
- (c) 用 Vite `html.cspNonce`：Vite 会给构建产物中的 `<script>/<link>` 加 nonce 属性，但运行时动态插入的 `<style>` 仍需 `setNonce`。可以选择同时使用，但不能单独用来解决问题。本设计只用 meta 方案，因为 `script-src 'self'` 已足够。

**服务端示例**（`src/server/app.ts` 静态分支，替换现有 418-421 行附近的代码）：

```ts
import { randomBytes } from "node:crypto";

// …静态资源分支内
const file = join(staticDir, page ? "index.html" : path.slice(1));
const resource = await resolveResource(staticDir, file);
if (!resource) throw new ApiError(403, "path", "资源路径无效");

// 每个 HTML 响应独立 nonce；不写日志、不进入 Journal / API 响应。
const nonce = page ? randomBytes(16).toString("base64") : undefined;
res.setHeader("content-security-policy", [
  "default-src 'self'",
  "script-src 'self'",
  nonce ? `style-src 'self' 'nonce-${nonce}'` : "style-src 'self'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "worker-src 'self'",                       // 语法高亮 worker 为同源模块
  `frame-src ${origin}/api/v1/panels/`,
  "base-uri 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
].join("; "));
res.setHeader("content-type", contentTypes[extname(file)] ?? "application/octet-stream");

const body = await readFile(resource);
res.end(nonce ? Buffer.from(body.toString("utf8").replaceAll("__CSP_NONCE__", nonce)) : body);
```

> `index.html` 每次都要读取并替换，不能缓存替换后的结果；它已经是 `cache-control: no-store`。
> 构建产物中的 `index.html` 由 Vite 从 `src/web/index.html` 生成，占位符会原样保留，需在 4.x 的发布检查中断言。

**HTML 占位**（`src/web/index.html`）：

```html
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta property="csp-nonce" content="__CSP_NONCE__" />
    <link rel="icon" type="image/svg+xml" href="/assets/nekomimi.svg" />
    <title>Nekomimi</title>
  </head>
  <body><div id="root"></div><script type="module" src="/main.tsx"></script></body>
</html>
```

**前端注入**（新增 `src/web/csp-nonce.ts`，在 `main.tsx` 首行静态导入）：

```ts
// src/web/csp-nonce.ts
import { setNonce } from "get-nonce";

/** 必须在任何 Radix / react-remove-scroll 模块求值前执行。
 *  开发服务器（vite dev）没有替换占位符，此时不设置，保持库默认行为。 */
export function installCspNonce(doc: Document = document) {
  const meta = doc.querySelector<HTMLMetaElement>('meta[property="csp-nonce"]');
  const value = meta?.content;
  if (value && value !== "__CSP_NONCE__" && /^[A-Za-z0-9+/=]{16,}$/.test(value)) setNonce(value);
  // 读取后移除 meta，降低被页面内其它脚本读取的面（nonce 仍在 style 元素属性中，可接受）。
  meta?.remove();
}
installCspNonce();
```

```ts
// src/web/main.tsx
import "./csp-nonce";              // ← 第一行，静态导入，保证早于动态 import 的 v2/app
void import("./api")
  .then(({ connect }) => connect().catch(() => undefined))
  .then(() => import("./v2/app"))
  .then(({ mountWorkbench }) => mountWorkbench(document.getElementById("root")!));
```

`package.json` 把 `get-nonce` 提升为直接依赖，并与 lock 中的现有版本一致：

```jsonc
"dependencies": {
  "@radix-ui/react-dialog": "1.2.0",
  "get-nonce": "1.0.1",            // 与 react-style-singleton 解析到同一实例，不能出现两份
  …
}
```

> **风险点**：如果 npm 把 `get-nonce` 解析为两份副本，`setNonce` 就设置在另一实例上。验证时用 `npm ls get-nonce` 确认只有一个 `deduped`，浏览器测试用 `securitypolicyviolation` 事件计数为 0 作为最终证据（见 D10）。

### D2. 样式基线：引入 preflight，保留 `.ds` 作用域给 tokens

**选择**：`tokens.css` 改用 Tailwind 推荐的分层导入，并加入 `preflight.css`。旧页面已删除，不必再把 reset 限定在 `.ds` 内；扩展面板运行在独立 iframe 中，不受影响。

```css
/* src/web/styles/tokens.css —— 头部替换 */
@layer theme, base, components, utilities;
@import "tailwindcss/theme.css" layer(theme);
@import "tailwindcss/preflight.css" layer(base);
@import "tailwindcss/utilities.css" layer(utilities);

/* …@theme inline 与 :root tokens 保持不变… */

@layer base {
  html, body { height: 100%; }
  body { margin: 0; background: var(--surface); color: var(--ink); font: 14px/1.6 system-ui, sans-serif; }
  /* 链接：默认继承前景色，不显示下划线；只有正文富文本保留下划线（[data-rich-content] a 规则已存在） */
  a { color: inherit; text-decoration: none; }
  a:hover { text-decoration: underline; text-underline-offset: 3px; }
  /* preflight 会去掉列表样式；富文本列表在 [data-rich-content] 规则中恢复 */
  [data-rich-content] ul { list-style: disc; }
  [data-rich-content] ol { list-style: decimal; }
  [data-rich-content] :is(p, ul, ol, pre, blockquote, table) { margin-block: .6em; }
  summary { cursor: pointer; }
  ::selection { background: var(--wash); }
}
```

需要逐处检查的副作用（preflight 会把 `h1-h6` 的字号和字重重置为继承、把 `img` 设为 `display:block`）：

| 位置 | 处理 |
| --- | --- |
| `.ds h1/h2/h3` 已定义字号 | 保留；移入 `@layer base`，让 utilities 能覆盖 |
| `[data-rich-content] :is(h1,h2,h3,h4)` | 补充字号：`h1{font-size:1.5em} h2{1.25em} h3{1.1em}`，字重 600 |
| 品牌 `<img>` 已设置 `block` | 不受影响 |
| `button` 背景透明 | 所有宿主按钮都走 `Button` 组件（有 variant 背景）；裸 `<button>` 补 utility 类 |
| `<details>/<summary>` 三角 | preflight 不移除 marker，保持 |
| `input[type=checkbox]` | preflight 不改 appearance；交接表单中的复选框外观保持 |

**分隔条**（`src/web/ui/Resizable.tsx`）改为 1px 线 + 扩大点击热区：

```tsx
export const PanelSeparator = ({ className, ...props }: ComponentProps<typeof Separator>) => (
  <Separator
    className={cn(
      // 视觉 1px，命中区 9px；focus 时加粗显示品牌色
      "relative w-px bg-line outline-none transition-colors",
      "before:absolute before:inset-y-0 before:-left-1 before:-right-1 before:content-['']",
      "hover:bg-brand focus-visible:w-[3px] focus-visible:bg-brand",
      "data-[disabled]:pointer-events-none",
      className,
    )}
    {...props}
  />
);
```

**备选**：继续不引入 preflight，在 `.ds` 下手写 reset。被拒绝：这会重复造轮子，而且 Portal 和 iframe 外的元素（例如 Radix 的 Overlay）仍会漏掉。

### D3. 开发者视图：`useSyncExternalStore` + `storage` 事件，提供 Hook 与包装组件

新增 `src/web/v2/state/developer-view.ts`：

```ts
import { useCallback, useSyncExternalStore } from "react";

/** 本地展示偏好；不是权限边界，不发送到服务端，不进入导出/诊断/扩展主题快照。 */
const KEY = "nekomimi:developer-view";
const listeners = new Set<() => void>();
let memory = false; // localStorage 不可用时的会话内回退

function read(): boolean {
  try { return localStorage.getItem(KEY) === "1"; } catch { return memory; }
}
function write(next: boolean) {
  memory = next;
  try { next ? localStorage.setItem(KEY, "1") : localStorage.removeItem(KEY); } catch { /* 回退到 memory */ }
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
  return () => { listeners.delete(onChange); window.removeEventListener("storage", onStorage); };
}

export function useDeveloperView() {
  const enabled = useSyncExternalStore(subscribe, read, () => false);
  const setEnabled = useCallback((next: boolean) => write(next), []);
  return { enabled, setEnabled, toggle: useCallback(() => write(!read()), []) };
}

/** 启动时同步 html 属性，供纯 CSS 规则使用（如隐藏眉标），避免首帧闪烁。 */
export function installDeveloperViewAttribute() {
  document.documentElement.toggleAttribute("data-developer-view", read());
}
```

包装组件 `src/web/v2/dev-only.tsx`：统一视觉标识（D3 规格中的“开发者信息标识”）：

```tsx
import type { ReactNode } from "react";
import { useDeveloperView } from "./state/developer-view";
import { cn } from "../ui/utils";

/** 仅开发者视图显示。children 只在开启时渲染，避免隐藏节点仍发请求。 */
export function DevOnly({ children, fallback = null }: { children: ReactNode; fallback?: ReactNode }) {
  return useDeveloperView().enabled ? <>{children}</> : <>{fallback}</>;
}

/** 内联开发信息：等宽、弱化、带“开发”标记；长值截断并可复制。 */
export function DevValue({ label, value, className, truncate = 12 }: {
  label: string; value: string; className?: string; truncate?: number;
}) {
  const { enabled } = useDeveloperView();
  if (!enabled) return null;
  const short = value.length > truncate ? `${value.slice(0, truncate)}…` : value;
  return (
    <span data-dev-value className={cn("inline-flex max-w-full items-center gap-1 font-mono text-[11px] text-muted", className)}>
      <span aria-hidden className="rounded-sm border border-dashed border-line px-1 text-[10px]">开发</span>
      <span className="sr-only">{label}：</span>
      <span title={value} className="min-w-0 truncate">{short}</span>
      {value.length > truncate && (
        <button type="button" className="rounded-sm px-1 hover:bg-wash" aria-label={`复制${label}`}
          onClick={() => void navigator.clipboard?.writeText(value)}>复制</button>
      )}
    </span>
  );
}

/** 英文眉标等纯装饰性开发信息，统一一个组件，便于测试断言其不存在。 */
export function DevEyebrow({ children }: { children: string }) {
  return <DevOnly><p data-dev-eyebrow className="m-0 font-mono text-[10px] tracking-[2px] text-muted">{children}</p></DevOnly>;
}
```

**为什么用条件渲染而不是 CSS 隐藏**：L2 组件里有的会触发查询（例如 `HandoffRecovery` 的 `useQuery`）。条件渲染既能避免多余的请求，也能保证测试中 `toHaveCount(0)` 的语义成立。纯装饰性内容可以用 `html[data-developer-view]` CSS 处理，但统一使用组件更容易审查。

**备选**：放进 React Context。被拒绝：跨窗口同步仍需要 storage 事件，而且 Dialog Portal 和 deferred chunk 都要额外包裹 Provider；`useSyncExternalStore` 不需要 Provider。

### D4. 外壳：两栏 + 可折叠详情抽屉，面板始终挂载

`WorkbenchShell` 改为：`details` 面板使用 `collapsible` + `collapsedSize={0}`，默认折叠；开合通过 `usePanelRef()` 控制。面板节点**始终存在**，满足“断点和开合都不销毁实例”。抽屉状态放进轻量 store，供会话头部按钮和文件定位调用。

```ts
// src/web/v2/state/details-drawer.ts
import { useSyncExternalStore } from "react";

export type DetailsTab = "changes" | "files" | "evidence" | "extensions";
interface DrawerState { open: boolean; tab: DetailsTab; revision: number }
let state: DrawerState = { open: false, tab: "changes", revision: 0 };
const listeners = new Set<() => void>();
const emit = () => { for (const l of listeners) l(); };

export const detailsDrawer = {
  get: () => state,
  open(tab: DetailsTab = state.tab) { state = { open: true, tab, revision: state.revision + 1 }; emit(); },
  close() { if (state.open) { state = { ...state, open: false }; emit(); } },
  toggle(tab?: DetailsTab) { state.open && (!tab || tab === state.tab) ? detailsDrawer.close() : detailsDrawer.open(tab); },
  subscribe(listener: () => void) { listeners.add(listener); return () => listeners.delete(listener); },
};
export const useDetailsDrawer = () => useSyncExternalStore(detailsDrawer.subscribe, detailsDrawer.get);
```

```tsx
// src/web/v2/shell.tsx —— WorkbenchShell 重写要点
import { usePanelRef } from "react-resizable-panels";
import { detailsDrawer, useDetailsDrawer } from "./state/details-drawer";

export function WorkbenchShell({ mode, navigation, main, details }: {
  mode: Mode; navigation: React.ReactNode; main: React.ReactNode; details?: React.ReactNode;
}) {
  const narrow = useNarrow();
  const drawer = useDetailsDrawer();
  const panel = usePanelRef();
  const [navOpen, setNavOpen] = React.useState(false);       // 仅窄屏使用
  const closeButton = React.useRef<HTMLButtonElement>(null);
  const returnFocus = React.useRef<HTMLElement | null>(null);

  // 宽屏：drawer.open ↔ Panel expand/collapse；窄屏：交给 CSS 覆盖层
  React.useEffect(() => {
    if (narrow || !panel.current) return;
    drawer.open ? panel.current.expand() : panel.current.collapse();
  }, [drawer.open, narrow, panel]);

  // 打开时记录触发者，关闭时还焦点（规格：关闭后焦点返回“变更”按钮）
  React.useEffect(() => {
    if (drawer.open) { returnFocus.current = document.activeElement as HTMLElement | null; closeButton.current?.focus({ preventScroll: true }); }
    else returnFocus.current?.focus({ preventScroll: true });
  }, [drawer.open]);

  // 切换路由（模式/会话）时关闭抽屉，但不卸载其内容
  React.useEffect(() => () => detailsDrawer.close(), [mode]);

  return (
    <div className="workbench-shell flex min-h-0 min-w-0 flex-1 flex-col"
      data-narrow={narrow || undefined} data-nav-open={navOpen || undefined} data-details-open={drawer.open || undefined}
      data-testid={narrow ? "mobile-layout" : "desktop-layout"}>
      <PanelGroup orientation="horizontal" disabled={narrow} className="min-h-0 flex-1" /* 布局持久化见下 */>
        <ResizablePanel id="nav" defaultSize="18%" minSize="14%" maxSize="28%">
          <div className="h-full overflow-auto bg-panel px-3 py-4">{navigation}</div>
        </ResizablePanel>
        <PanelSeparator aria-label="调整导航宽度" disabled={narrow} />
        <ResizablePanel id="main" minSize="45%">{main}</ResizablePanel>
        {details && <>
          <PanelSeparator aria-label="调整详情宽度" disabled={narrow || !drawer.open} />
          <ResizablePanel id="details" panelRef={panel} collapsible collapsedSize={0} defaultSize={0} minSize="24%" maxSize="45%"
            onResize={size => { if (!narrow && size.asPercentage === 0 && drawer.open) detailsDrawer.close(); /* 拖到 0 视为关闭 */ }}>
            <aside aria-label="详情" hidden={!drawer.open && !narrow} className="flex h-full flex-col bg-panel"
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
```

> 注意：`hidden` 只在宽屏折叠时设置。折叠后面板宽度为 0，`hidden` 让屏幕阅读器和 Tab 跳过它，但 React 子树仍挂载（iframe 不重载）。如果 `hidden` 导致扩展 iframe 被浏览器节流，可改用 `inert` + `aria-hidden`，需在 4.4 验证。

窄屏 CSS（替换 `tokens.css` 中现有的 `.workbench-shell[data-narrow]` 规则组）：

```css
/* 窄屏：主区独占；导航与详情为覆盖层，面板节点始终挂载 */
.workbench-shell[data-narrow] > [data-group] { display: block !important; position: relative; }
.workbench-shell[data-narrow] [data-panel][id="main"] { width: 100% !important; height: 100%; }
.workbench-shell[data-narrow] :is([data-panel][id="nav"], [data-panel][id="details"]) {
  position: absolute; inset-block: 0; z-index: 30; width: min(88vw, 360px) !important; max-width: 100%;
  box-shadow: var(--shadow-floating); transform: translateX(var(--off)); transition: transform var(--motion-duration);
  visibility: hidden;
}
.workbench-shell[data-narrow] [data-panel][id="nav"]     { inset-inline-start: 0; --off: -100%; }
.workbench-shell[data-narrow] [data-panel][id="details"] { inset-inline-end: 0;   --off: 100%; width: 100vw !important; }
.workbench-shell[data-narrow][data-nav-open] [data-panel][id="nav"],
.workbench-shell[data-narrow][data-details-open] [data-panel][id="details"] { --off: 0; visibility: visible; }
.workbench-shell[data-narrow] [role="separator"] { display: none; }
```

窄屏下的“会话”开合按钮放进 `TopBar`（通过 `onToggleNav` 传入），“详情”按钮放在会话头部，两者分别调用 `setNavOpen` 和 `detailsDrawer.toggle()`，符合规格中“互不覆盖”的要求。

**布局持久化**：保留 `useLayout('shell-<mode>')`，但只保存 `nav` 宽度和 `details` 展开时的宽度，**不保存打开状态**（规格要求默认收起）。保存结构改为 `{version:2, nav:number, details:number}`，读到旧结构（三键之和为 100）时丢弃并使用默认值。

**备选**：Radix Dialog 做右侧抽屉。被拒绝：Dialog 关闭会卸载内容，导致扩展 slot 和 FileBrowser 状态丢失，违反 web-design-system “长内容与草稿稳定性”。

### D5. 路由样板收敛：`ManagementPage` 布局路由

现在每个管理页都写 `<WorkbenchShell navigation={…} main={<XPage/>} details={…} />`。改为两个无路径布局路由，统一渲染外壳，子路由只给出 main：

```tsx
// router.tsx（节选）
function ManagementShell({ mode }: { mode: Mode }) {
  const { sessionId } = useParams({ strict: false });
  return (
    <WorkbenchShell
      mode={mode}
      navigation={mode === "work" ? <WorkNavigation active={sessionId} /> : <CreateNavigation sessionId={sessionId} />}
      main={<main className="h-full min-w-0 overflow-auto px-6 py-4 max-[760px]:px-4"><BackToTask mode={mode} sessionId={sessionId} /><Outlet /></main>}
    /* 管理页不提供 details：抽屉入口在会话页 */
    />
  );
}

// 管理页注册表：设置总览、菜单和路由共用同一份数据（D6）
export const managementPages = [
  { id: "settings",  path: "/settings",  title: "基础设置",     hint: "默认模型、凭证与搜索", modes: ["work", "create"], group: "常用" },
  { id: "models",    path: "/models",    title: "模型用途与配置", hint: "按用途选择模型",      modes: ["work", "create"], group: "常用", session: true },
  { id: "themes",    path: "/themes",    title: "主题与外观",    hint: "颜色、字体与扩展显示", modes: ["work", "create"], group: "常用", session: true },
  { id: "resources", path: "/resources", title: "能力与权限",    hint: "启用、授权与诊断",    modes: ["create"], group: "能力", session: true },
  { id: "mcp",       path: "/mcp",       title: "MCP 连接与授权", hint: "外部工具服务",       modes: ["create"], group: "能力", session: true },
  { id: "packages",  path: "/packages",  title: "能力包",       hint: "安装、回退与导出",    modes: ["create"], group: "能力", session: true },
  { id: "panels",    path: "/panels",    title: "面板",         hint: "扩展界面",           modes: ["work", "create"], group: "高级", session: true },
  { id: "workflows", path: "/workflows", title: "持久工作流",    hint: "长任务与恢复",        modes: ["work", "create"], group: "高级", session: true },
] as const satisfies ReadonlyArray<ManagementPageInfo>;
```

`BackToTask` 在设置页顶部提供“返回任务”链接：有 `sessionId` 时回到该会话，否则回到 `/work` 或 `/create`。这弥补了管理链接离开导航后返回路径变长的问题。

现有深链接（如 `/work/session/$id/models`、`/create/session/$id/mcp`）**路径不变**，只把 component 改为布局路由的子路由；`routeTree` 注册方式不变，规格中的“原有深链接地址仍然有效”由 4.x 的路由测试逐条断言。

### D6. 设置菜单与设置总览

`more-menu.tsx` 重命名为 `settings-menu.tsx`，`Menu` 组件增加分组分隔与开关项（`role="menuitemcheckbox"`）：

```ts
// src/web/ui/Menu.tsx —— MenuItem 扩展
export type MenuItem =
  | { kind?: "item"; id: string; label: React.ReactNode; danger?: boolean; disabled?: boolean; hint?: string; onSelect?: () => void }
  | { kind: "checkbox"; id: string; label: React.ReactNode; checked: boolean; onCheckedChange: (next: boolean) => void }
  | { kind: "separator"; id: string };
```

```tsx
// 渲染分支（Menu 内 items.map）
item.kind === "separator" ? <div key={item.id} role="separator" className="my-1 h-px bg-line" />
: item.kind === "checkbox" ? (
  <button key={item.id} type="button" role="menuitemcheckbox" aria-checked={item.checked}
    className="flex w-full items-center justify-between gap-6 rounded-sm px-3 py-1.5 text-left text-sm hover:bg-wash focus-visible:bg-wash"
    onClick={() => { item.onCheckedChange(!item.checked); /* 开关项不关闭菜单 */ }}>
    {item.label}<span aria-hidden className="text-xs text-muted">{item.checked ? "开" : "关"}</span>
  </button>)
: /* 原 menuitem 分支，hint 以第二行 text-xs 呈现 */ …
```

> 方向键导航 `enabled` 过滤时要跳过 `separator`；`itemRefs` 索引保持与 items 对齐。

```tsx
// src/web/v2/settings-menu.tsx
export function SettingsMenu({ mode, theme, onTheme }: { mode: Mode; theme: "light" | "dark"; onTheme: (v: "light" | "dark") => void }) {
  const navigate = useNavigate();
  const { sessionId } = useParams({ strict: false });
  const developer = useDeveloperView();
  const [dialog, setDialog] = useState<"appearance" | "export" | "recovery">();
  const trigger = useRef<HTMLButtonElement>(null);
  const canExport = useCanExport(sessionId);               // 从现 more-menu 提取的同逻辑 Hook
  const session = sessionId && validId(sessionId) ? sessionId : undefined;
  const go = (page: string) => void navigate({ to: session && pageHasSession(page) ? `/${mode}/session/${session}/${page}` : `/${mode}/${page}` });

  return <>
    <Menu align="end" ariaLabel="设置" trigger={<Button ref={trigger} size="sm" variant="outline">设置</Button>} items={[
      { id: "appearance", label: "外观", onSelect: () => setDialog("appearance") },
      { id: "models", label: "模型与凭证", onSelect: () => go("models") },
      { id: "all", label: "全部设置", hint: "能力、MCP、面板、工作流…", onSelect: () => go("settings-hub") },
      { kind: "separator", id: "s1" },
      { id: "export", label: "导出当前会话", disabled: !canExport, onSelect: () => setDialog("export") },
      { id: "recovery", label: "版本与恢复", onSelect: () => setDialog("recovery") },
      { kind: "separator", id: "s2" },
      { kind: "checkbox", id: "developer", label: "开发者视图", checked: developer.enabled, onCheckedChange: developer.setEnabled },
    ]} />
    {dialog === "recovery" && <CoreRecoveryDialog close={() => setDialog(undefined)} restore={() => trigger.current?.focus()} loadClose={() => setDialog(undefined)} />}
    {dialog && dialog !== "recovery" && <MoreDialog dialog={dialog} /* 其余参数同现 more-menu */ />}
  </>;
}
```

> **宿主恢复不依赖可选 chunk**（compact-header 规格）：`CoreRecoveryDialog` 目前通过 `deferred()` 懒加载。它属于恢复路径，应改为在 `settings-menu.tsx` 中**静态导入**；外观对话框仍可懒加载，但“恢复默认外观”需要在 chunk 加载失败时有兜底（现在 deferred 的错误态已提供“关闭”，再增加一个静态的“恢复默认外观”按钮即可）。

设置总览页 `src/web/v2/routes/settings-hub.tsx`（路由 `/work/settings-hub`、`/create/settings-hub`；现有 `/settings` 仍是“基础设置”，避免破坏深链接）：

```tsx
export function SettingsHubPage({ mode, sessionId }: { mode: Mode; sessionId?: string }) {
  const groups = Object.groupBy(managementPages.filter(page => page.modes.includes(mode)), page => page.group);
  return <section aria-labelledby="settings-hub-title" className="mx-auto max-w-3xl space-y-6">
    <h1 id="settings-hub-title">设置</h1>
    {Object.entries(groups).map(([group, pages]) => (
      <section key={group} aria-label={group} className="space-y-2">
        <h2 className="text-sm text-muted">{group}</h2>
        <ul className="grid gap-2 sm:grid-cols-2">
          {pages!.map(page => <li key={page.id}>
            <Link to={pageHref(mode, page, sessionId)} className="block rounded-xl border border-line bg-background p-4 hover:border-brand focus-visible:border-brand">
              <span className="block font-semibold">{page.title}</span>
              <span className="block text-xs text-muted">{page.hint}</span>
            </Link>
          </li>)}
        </ul>
      </section>
    ))}
  </section>;
}
```

> `Object.groupBy` 需要 ES2024 lib，Node 22.19 和 Chrome 均支持；若 `tsconfig` 的 lib 不含 ES2024，改用 reduce。

### D7. 顶栏：版本状态仅在异常或开发者视图中显示

```tsx
// src/web/v2/core-status.tsx —— 重写为“只在需要时出现”
export function CoreStatusBadge({ onOpenRecovery }: { onOpenRecovery: () => void }) {
  const query = useCoreStatus(true);
  const { enabled: developer } = useDeveloperView();
  const identity = query.data?.identity;
  const valid = typeof identity?.version === "string" && typeof identity.build === "string" && /^[a-f0-9]{64}$/.test(identity.build);

  if (query.isPending) return null;                                     // 首帧不占位
  if (query.isError || !valid)                                          // 异常：始终显示，点击直达恢复
    return <Button size="sm" variant="outline" className="text-warning" onClick={onOpenRecovery}>版本待确认</Button>;
  if (query.data.phase === "switching") return <Badge state="warning">正在切换版本</Badge>;
  if (!developer) return null;                                          // 正常 + 非开发者视图：隐藏
  return <span data-testid="core-running-version" className="flex items-center gap-1 text-xs text-muted">
    {identity!.version}<DevValue label="运行构建" value={identity!.build} truncate={8} />
  </span>;
}
```

`TopBar` 去掉 `CoreRecoveryButton` 与 `<Badge>{target}</Badge>`。目标标签只在创造模式显示（例如“开发：sakura-theme”），工作模式不显示“用户项目”：

```tsx
<header className="flex h-12 flex-shrink-0 items-center gap-3 border-b border-line bg-background px-4">
  {narrow && <Button size="sm" variant="ghost" aria-expanded={navOpen} aria-controls="nav" onClick={onToggleNav}>会话</Button>}
  <Brand />
  <ModeSwitch mode={mode} />
  {mode === "create" && target && <Badge>{target}</Badge>}
  <div className="ms-auto flex items-center gap-2">
    <CoreStatusBadge onOpenRecovery={() => settings.current?.openRecovery()} />
    {customTheme.error && <ThemeFallbackNotice error={customTheme.error} />}   {/* 改为小图标 + tooltip，详细信息进开发者视图 */}
    {running && onStop && <Button variant="destructive" size="sm" onClick={onStop}>停止</Button>}
    <SettingsMenu ref={settings} mode={mode} theme={theme} onTheme={onTheme} />
  </div>
</header>
```

> “主题目录读取失败，已使用默认风格”现在是一行常驻文本（截图中 401 时可见）。改为 `Tooltip` 包裹的警示图标；未授权时由 D9 整页引导接管，不再出现。

### D8. 会话页面：头部菜单、交接按需、L2 下沉

**会话头部**（`work-session.tsx` 中替换现有的 `flex … gap-2` 按钮行）：

```tsx
<div className="flex items-center justify-between gap-2 py-2">
  <div className="min-w-0">
    <DevEyebrow>WORK MODE</DevEyebrow>
    <h1 className="truncate text-lg">{session?.title ?? "读取会话…"}</h1>
  </div>
  <div className="flex items-center gap-2">
    <ConnectionNotice status={stream.status} />               {/* 非阻塞：连接中/重连中，role=status */}
    {session && <SessionStatus status={session.status} />}    {/* 就绪时返回 null */}
    {running && session?.runId && <Button variant="destructive" size="sm" busy={cancel.isPending} onClick={() => cancel.mutate(session.runId!)}>停止</Button>}
    {session && <ChangesButton sessionId={sessionId} />}      {/* “变更 · 3”，点击 detailsDrawer.toggle('changes') */}
    {narrow && session && <Button size="sm" variant="outline" onClick={() => detailsDrawer.toggle()}>详情</Button>}
    {session && <SessionMenu session={session} running={running} measurement={stream.snapshot?.context} />}
  </div>
</div>
```

```tsx
// src/web/v2/routes/session-status.tsx
import { sessionStatusLabel } from "../../glossary";
export function SessionStatus({ status }: { status: string }) {
  const label = sessionStatusLabel(status);
  const tone = status === "failed" ? "danger" : ["awaiting-approval", "interrupted"].includes(status) ? "warning" : "default";
  return <>
    {label && <Badge state={tone}>{label}</Badge>}
    <DevValue label="原始状态" value={status} />
  </>;
}
```

**会话菜单** `src/web/v2/routes/session-menu.tsx`：复用现有的 `Inspection`、`ContextDetails`、`HandoffCompose`、`SessionExport` 和 `SessionDeleteDialog`，只把触发器从按钮改为菜单项。对话框打开状态集中管理，焦点归还给菜单触发按钮：

```tsx
type Panel = "inspection" | "context" | "handoff" | "export" | "info" | "delete";

export function SessionMenu({ session, running, measurement }: { session: SessionInfo; running: boolean; measurement?: ContextOccupancy }) {
  const [panel, setPanel] = useState<Panel>();
  const trigger = useRef<HTMLButtonElement>(null);
  const close = () => { setPanel(undefined); requestAnimationFrame(() => trigger.current?.focus()); };
  const handoffLabel = session.mode === "work" ? "交接到创造会话" : "交接到工作会话";

  return <>
    <Menu align="end" ariaLabel="会话操作" trigger={<Button ref={trigger} size="sm" variant="outline" aria-label="会话操作">…</Button>} items={[
      { id: "inspection", label: "调用证据", onSelect: () => setPanel("inspection") },
      { id: "context", label: measurement?.contextWindow ? `上下文 · ${Math.round(measurement.totalTokens / measurement.contextWindow * 100)}%` : "上下文详情", onSelect: () => setPanel("context") },
      { id: "handoff", label: handoffLabel, onSelect: () => setPanel("handoff") },
      { kind: "separator", id: "s1" },
      { id: "export", label: "导出会话", disabled: running, hint: running ? "运行结束后可导出" : undefined, onSelect: () => setPanel("export") },
      { id: "info", label: "会话信息", onSelect: () => setPanel("info") },
      { id: "delete", label: "删除会话", danger: true, disabled: running, onSelect: () => setPanel("delete") },
    ]} />
    {panel === "inspection" && <InspectionDialog sessionId={session.id} onClose={close} />}
    {panel === "context" && <ContextDetailsDialog sessionId={session.id} onClose={close} />}
    {panel === "handoff" && <HandoffDialog sessionId={session.id} mode={session.mode} onClose={close} />}
    {panel === "export" && <ExportDialog sessionId={session.id} onClose={close} />}
    {panel === "info" && <SessionInfoDialog session={session} onClose={close} />}   {/* 目标根目录、模式、创建时间；ID/hash 用 DevValue */}
    {panel === "delete" && <SessionDeleteDialog session={session} mode={session.mode} active={session.id} opener={trigger.current} close={close} loadClose={close} />}
  </>;
}
```

> `InspectionButton`/`ContextDetailsButton` 拆成 `XxxDialog`（受控 `open` + `onClose`）与可选按钮两层。时间线每轮的“查看证据”（现 `TurnHeading` children）继续用按钮形态，文案改为“查看证据”。`ContextDetailsButton` 保留给输入区状态行（D8b）。

**D8b. 输入区上下文入口**（context-occupancy 规格）：在 `session-composer.tsx` 状态行快捷键提示旁增加紧凑入口：

```tsx
<div className="flex items-center justify-between gap-2.5">
  <span className="flex items-center gap-3 text-xs text-muted">
    {statusText}
    {measurement && <ContextMeterButton sessionId={sessionId} measurement={measurement} />}
  </span>
  <Button data-send-task …>发送</Button>
</div>
```

```tsx
// 容量已知：小圆环 + 整数百分比；未知：文字“上下文”。不显示 tokens 原值（进开发者视图/详情）。
export function ContextMeterButton({ sessionId, measurement }: { sessionId: string; measurement: ContextOccupancy }) {
  const percent = measurement.contextWindow ? Math.round(measurement.totalTokens / measurement.contextWindow * 100) : undefined;
  return <ContextDetailsButton sessionId={sessionId} measurement={measurement} variant="ghost"
    label={percent === undefined ? "上下文" : `上下文 ${percent}%`}>
    {percent !== undefined && <svg aria-hidden viewBox="0 0 16 16" className="size-3.5">
      <circle cx="8" cy="8" r="6" fill="none" stroke="var(--line)" strokeWidth="2" />
      <circle cx="8" cy="8" r="6" fill="none" stroke="var(--brand)" strokeWidth="2" pathLength={100}
        strokeDasharray={`${Math.min(100, percent)} 100`} transform="rotate(-90 8 8)" />
    </svg>}
  </ContextDetailsButton>;
}
```

> SVG 属性不是内联 `style`，不受 CSP 影响。现在 details.tsx 中 meter 使用的 `style={{width}}` 走 CSSOM，也可以保留（见 Context）。

**上下文详情**内部，把 `layers/exclusions/reservations/policyVersion/revision` 的区块包进：

```tsx
const { enabled } = useDeveloperView();
<details open={enabled} className="mt-3">
  <summary className="text-sm">技术详情</summary>
  {/* 原分层来源、预留、排除原因渲染保持不变 */}
</details>
```

**交接按需**：`work-session.tsx` 不再常驻渲染 `HandoffCompose`，改为由会话菜单打开 `HandoffDialog`，其内部渲染 `<HandoffCompose initiallyOpen … />`（给 HandoffCompose 增加 `initiallyOpen` 参数，并去掉外层 section 的触发按钮）。`HandoffCards` 在没有记录时返回 `null`：

```tsx
export function HandoffCards({ sessionId, mode }: { sessionId: string; mode: SessionMode }) {
  const relations = useHandoffRelations(sessionId, mode);           // 抽出的 useQuery，见 D9 自动刷新
  const deliveries = useDeliveries(sessionId, mode);
  const states = useHandoffStates(sessionId, mode);
  const empty = !relations.data?.items.length && !deliveries.data?.items.length && !states.data?.items.length;
  const failed = relations.isError || deliveries.isError || states.isError;
  if (empty && !failed) return null;                                 // 读取中或空：不占位
  return <section aria-label="交接与交付" className="my-4 space-y-3">
    <h2 className="text-sm font-semibold">交接与交付</h2>
    {failed && <InlineRetry message="交接记录暂时不可读" onRetry={() => { void relations.refetch(); void deliveries.refetch(); void states.refetch(); }} />}
    <DevOnly><Button size="sm" variant="ghost" onClick={() => { void relations.refetch(); void deliveries.refetch(); }}>刷新交接记录</Button></DevOnly>
    {/* 既有卡片渲染 */}
    {!!states.data?.items.length && <HandoffRecovery sessionId={sessionId} mode={mode} states={states} />}
  </section>;
}
```

`HandoffRecovery` 改为接收外部传入的 `states`，不再自行查询；“重新读取确认状态”按钮放进 `<DevOnly>`；`命令 … · 交接 …`、`目标会话 … · 快照 …` 两行改用 `DevValue`。用户可见文案只保留“交接已完整记录 / 已接受，尚未完整记录 / 待恢复”和恢复操作。

**会话导航**（`work-nav.tsx`）：

```tsx
export function WorkNavigation({ active }: { active?: string }) {
  // …create mutation 不变
  return (
    <nav aria-label="会话" className="flex flex-col gap-3">
      <DevEyebrow>WORKSPACE</DevEyebrow>
      <NewTaskForm busy={create.isPending} error={create.error} onSubmit={name => create.mutate(take(name))} />
      <SessionCatalog mode="work" active={active} query={query} />
    </nav>
  );
}
```

`NewTaskForm` 默认是一个全宽的主按钮“+ 新任务”，点击后直接以“未命名任务”创建并进入会话（标题之后由自动命名或会话信息修改）。保留可选的标题输入（展开“命名后创建”）以兼容现有测试中的“新会话标题”输入场景。`SessionCatalog` 中“刷新会话列表”放进 `<DevOnly>`，错误态的“重试会话列表”保留。

### D9. 自动刷新与连接引导

**查询失效**：全局开启 `refetchOnWindowFocus` 和 `refetchOnReconnect`，只对读查询生效，mutation 不受影响：

```ts
// src/web/v2/state/query.ts
export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: 1, staleTime: 5_000, refetchOnWindowFocus: true, refetchOnReconnect: true },
      mutations: { retry: false },
    },
  });
}
```

> 风险：带 `retry:false` 的读取（交接、核心状态）会在获得焦点时触发一次读请求。这些都是 GET，不会产生写命令；核心状态已有 2s 轮询。需要在 v2-interactions 测试中断言聚焦后无 POST 请求。

**SSE 驱动的失效**：在 `SessionStreamProvider` 收到交接相关事件时，使对应查询失效。为避免把领域判断写进 reducer，用一个小映射表：

```ts
// src/web/v2/state/stream-invalidation.ts
const rules: Array<{ match: (row: TimelineRow) => boolean; keys: (session: string, mode: SessionMode) => unknown[][] }> = [
  { match: row => row.kind === "status" && /^handoff\./.test(row.event ?? ""),
    keys: (s, m) => [v2Key(v2Host(), m, "handoff", s).slice(0, 6) as unknown[]] },
];
export function invalidateFor(client: QueryClient, session: string, mode: SessionMode, rows: TimelineRow[]) {
  for (const rule of rules) if (rows.some(rule.match))
    for (const key of rule.keys(session, mode)) void client.invalidateQueries({ queryKey: key });
}
```

> 具体事件类型以 `TimelineRow` 实际字段为准（实现时在 4.x 中核对 `shared/protocol.ts` 和服务端发出的 handoff 事件名）；若时间线行不携带 handoff 事件，就退回到 `cursor.seq` 变化时使 `handoff` 前缀失效，也就是现有 `revision` 的做法。

**连接引导**：`api.ts` 的 `request()` 在收到 401 `auth` 时广播一次全局事件；`app.tsx` 根部监听并渲染整页引导：

```ts
// src/web/api.ts
export const AUTH_LOST = "nekomimi:auth-lost";
// request() 内：
if (!response.ok) {
  const data = await response.json().catch(() => ({}));
  const error = new ClientError(data.error?.code ?? "network", data.error?.message ?? "请求失败");
  if (response.status === 401 && error.code === "auth") window.dispatchEvent(new CustomEvent(AUTH_LOST));
  throw error;
}
```

```tsx
// src/web/v2/connection-gate.tsx
export function ConnectionGate({ children }: { children: ReactNode }) {
  const [lost, setLost] = useState(false);
  const client = useQueryClient();
  useEffect(() => { const on = () => setLost(true); window.addEventListener(AUTH_LOST, on); return () => window.removeEventListener(AUTH_LOST, on); }, []);
  if (!lost) return <>{children}</>;
  return <main className="ds grid min-h-dvh place-items-center bg-background p-6 text-foreground">
    <section role="alertdialog" aria-labelledby="auth-title" aria-describedby="auth-desc" className="max-w-md space-y-4 rounded-2xl border border-line p-6">
      <h1 id="auth-title">需要从终端打开 Nekomimi</h1>
      <p id="auth-desc" className="text-sm text-muted">为保护本地数据，浏览器需要终端打印的一次性链接才能连接。请在启动 <code>nekomimi web</code> 的终端中重新打开链接。</p>
      <Button onClick={async () => {
        try { await api("/config"); setLost(false); await client.invalidateQueries({ type: "active" }); }   // 只做读请求
        catch { /* 仍未授权：保持引导 */ }
      }}>我已重新打开，重试</Button>
    </section>
  </main>;
}
```

> 要点：引导**覆盖**而不是卸载 children，草稿保存在 localStorage（`drafts.ts`），重新授权后仍在。实现时用 `hidden` 包裹 children，而不是 `return` 替换，确保 SessionComposer 不卸载、不丢未持久化的 IME 组合态：
> ```tsx
> return <><div hidden={lost}>{children}</div>{lost && <AuthGuide …/>}</>;
> ```
> 在 `mountWorkbench` 中把 `RouterProvider` 包进 `ConnectionGate`，并放在 `QueryClientProvider` 内。

### D10. 用户术语表

```ts
// src/web/glossary.ts —— 唯一来源；presentation.ts 的 statusText 改为从此导出
export const sessionStatus: Record<string, string | null> = {
  idle: null,                // 就绪：头部不显示标签；列表显示“就绪”（弱化）
  accepted: "排队中", running: "运行中", cancelling: "正在停止",
  completed: "已完成", cancelled: "已停止", failed: "失败",
  incomplete: "未完成", interrupted: "已中断", unknown: "结果未确认",
};
export const sessionStatusLabel = (value: string) => value in sessionStatus ? sessionStatus[value] : value;

/** 界面文案替换表：实现时逐项 grep 替换，测试同步。 */
export const wording = {
  "选择会话后显示当前投影的上下文统计。": "开始任务后可在这里查看上下文占用。",
  "正在读取可靠状态…": "正在加载会话…",
  "描述目标，Nekomimi 会记录每一步证据。": "描述你想完成的事，Nekomimi 会一步步完成并记录过程。",
  "专注当前项目": "开始一个任务",
  "从左侧选择或新建一个任务会话。": "从左侧选择任务，或新建一个。",
  "为工作交付新能力": "为 Nekomimi 开发新能力",
  "Nekomimi 宿主": "Nekomimi",
  "目标宿主": "适用版本",
  "运行版本待确认": "版本待确认",
  "结果未知": "结果未确认，不会自动重试",
} as const;
```

> `wording` 表不在运行时使用（避免一层间接），作为替换清单与测试迁移对照；实现完成后转存为测试中的“禁用词”断言：

```ts
// test/browser/fixtures/user-view.ts
export const internalTerms = ["WORK MODE", "CREATE MODE", "INSPECTOR", "WORKSPACE", "CANDIDATE", "投影", "可靠状态", "idle", "宿主"];
export async function expectNoInternalTerms(page: Page) {
  const text = await page.locator("body").innerText();
  for (const term of internalTerms) expect(text, `默认视图出现内部术语：${term}`).not.toContain(term);
}
```

### D11. 测试夹具与 CSP 断言

新增 `test/browser/fixtures/workbench.ts`，所有迁移后的测试都通过它访问入口：

```ts
import { expect, type Page } from "@playwright/test";

export async function openSettings(page: Page) {
  const trigger = page.getByRole("button", { name: "设置", exact: true });
  await trigger.click();
  await expect(page.getByRole("menu")).toBeVisible();
  return trigger;
}
export async function chooseSetting(page: Page, name: string) {
  await openSettings(page);
  await page.getByRole("menuitem", { name, exact: true }).click();
}
export async function enableDeveloperView(page: Page) {
  // 直接写偏好比走 UI 更快，且不依赖菜单实现；需在 goto 前调用
  await page.addInitScript(() => localStorage.setItem("nekomimi:developer-view", "1"));
}
export async function openSessionMenu(page: Page, item?: string) {
  await page.getByRole("button", { name: "会话操作", exact: true }).click();
  if (item) await page.getByRole("menuitem", { name: item }).click();
}
export async function openDetails(page: Page, tab: "变更" | "文件" | "证据" = "变更") {
  if (tab === "变更") await page.getByRole("button", { name: /^变更/ }).click();
  else { await page.getByRole("button", { name: /^变更/ }).click(); await page.getByRole("tab", { name: tab }).click(); }
  await expect(page.getByRole("complementary", { name: "详情" })).toBeVisible();
}
/** 统计宿主资源产生的 CSP 违规；浏览器扩展注入的不计入。 */
export async function collectCspViolations(page: Page) {
  await page.addInitScript(() => {
    (window as any).__csp = [];
    document.addEventListener("securitypolicyviolation", e => {
      if (!e.sourceFile || e.sourceFile.startsWith(location.origin)) (window as any).__csp.push(`${e.violatedDirective} ${e.sourceFile}:${e.lineNumber}`);
    });
  });
  return () => page.evaluate(() => (window as any).__csp as string[]);
}
```

**选择器迁移对照表**（tasks 5.x 逐项执行）：

| 旧选择器 | 新路径 |
| --- | --- |
| `button '更多操作'` → `menuitem '外观'` | `chooseSetting(page,'外观')` |
| `button '更多操作'` → `menuitem '导出会话'` | `openSessionMenu(page,'导出会话')`（会话内）或 `chooseSetting(page,'导出当前会话')` |
| `button '版本恢复'` | `chooseSetting(page,'版本与恢复')` |
| `testid 'core-running-version'` | 先 `enableDeveloperView(page)`，或断言异常态 `button '版本待确认'` |
| `button '调用证据'`（头部） | `openSessionMenu(page,'调用证据')`；时间线中为 `button '查看证据'` |
| `button '上下文'`（头部） | 输入区 `button /^上下文/` 或 `openSessionMenu(page,'上下文详情')` |
| `button '交接到创造会话'` | `openSessionMenu(page,'交接到创造会话')` |
| `button '刷新交接记录'` / `'刷新会话列表'` | `enableDeveloperView(page)` 后保留原选择器；或改为断言自动更新 |
| `button '导航与详情'` | 窄屏：`button '会话'` 与 `button '详情'` |
| `link '主题与外观' / '基础设置' / '模型用途与配置' …`（导航） | `chooseSetting(page,'全部设置')` 后点同名 link，或直接 `page.goto` 深链接 |
| `tab '证据'`（常驻侧栏） | `openDetails(page,'证据')` |

## Risks / Trade-offs

- [preflight 改变 h1–h6、列表、按钮默认样式，可能让既有页面局部错位] → 4.1 后对所有路由做截图对比（`test/browser` 中已有截图的场景），再加一份路由遍历截图，在 PR 中人工审阅；富文本规则补充字号和列表样式。
- [`get-nonce` 出现两份副本导致 `setNonce` 无效] → 固定版本并在发布检查中断言 `npm ls get-nonce` 只有一个解析；以浏览器 `securitypolicyviolation` 计数为 0 作为最终证据。
- [`index.html` 被 CDN 或缓存复用，导致 nonce 重复] → 服务只在本机运行，已有 `no-store`；测试中两次请求的 nonce 必须不同。
- [详情面板折叠后 `hidden` 可能让扩展 iframe 被节流或暂停] → 先在 4.4 验证 live-panels 场景；不满足时改为 `inert` 加宽度 0。
- [移除常驻刷新按钮后，用户在 SSE 断开时看不到最新交接状态] → 已开启 `refetchOnWindowFocus/Reconnect`；读取失败显示“重试”；开发者视图保留原按钮。
- [测试迁移量大，容易在迁移中弱化断言] → 迁移只改“如何到达入口”，不改断言主体；每个文件迁移后单独运行，并在任务中记录迁移前后的场景数一致。
- [开发者视图被误解为安全开关] → 规格和设置项说明都写明“仅改变显示”；所有写操作的确认门槛保持不变，并有测试比较两种状态下的请求体。
- [`refetchOnWindowFocus` 在测试中造成额外请求，影响计数断言] → 现有测试计数的是模型/工具/写命令，不统计 GET；个别统计 GET 的用例按需在 `page` 层禁止 focus 事件或放宽断言，并在迁移记录中说明。

## Migration Plan

1. 前置：归档 `next-generation-nekomimi`（`openspec archive`），确认主规格包含本 delta 依赖的 Requirement 标题。
2. 批次 A（样式与安全基线，可单独合入）：D1、D2、D9 连接引导。修复用户截图中的问题，不改布局，测试改动极少。
3. 批次 B（开发者视图 + 文案）：D3、D10、D7。L2 信息开始收起；测试用 `enableDeveloperView` 兜底，保持全绿。
4. 批次 C（布局与入口）：D4、D5、D6、D8。测试选择器集中迁移。
5. 批次 D：完整浏览器回归、截图审阅、规格同步与归档。

回退：每个批次独立提交。批次 C 若出现无法快速修复的回归，可整体 revert 回到批次 B，此时 UI 仍是三栏但 L2 已收起；批次 A 的 CSP/preflight 可以单独保留。

## Open Questions

- 设置总览路由名用 `settings-hub` 还是把现有 `/settings` 改名为 `/settings/basic`？本设计选择不破坏现有深链接，用 `settings-hub`；若用户偏好 `/settings` 作为总览，只需调整路由表和测试，不影响规格。
- 窄屏详情覆盖层宽度取 100vw 还是 88vw：以 360px 实测为准，不影响规格。
