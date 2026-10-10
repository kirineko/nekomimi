## 0. 前置

- [x] 0.1 归档 `next-generation-nekomimi` 并确认本变更的 delta 基线；验证：`openspec archive next-generation-nekomimi` 成功，`openspec/specs/` 下 web-design-system、web-task-workbench、compact-header、context-occupancy、web-evidence-inspector、web-customization、local-web-service 都包含本变更 MODIFIED 所引用的 Requirement 标题；`openspec validate simplify-user-workbench --strict` 通过。
- [x] 0.2 记录迁移前基线；验证：在当前 commit 上运行 `npm run typecheck`、`npm run test:browser`，保存退出码、通过/失败数及 54 个文件的场景数到 `docs/validation/simplify-user-workbench/baseline.md`，后续迁移以此对照，确保场景数不减少。

## 1. 批次 A：样式与安全基线（design D1、D2、D9 连接引导）

- [x] 1.1 静态 HTML nonce 与 CSP：`src/web/index.html` 增加 `<meta property="csp-nonce" content="__CSP_NONCE__">`；`src/server/app.ts` 为 HTML 响应生成 16 字节 nonce，替换占位符，`style-src 'self' 'nonce-…'`，并增加 `worker-src 'self'`；验证：服务端单测断言两次 GET `/work` 的 nonce 不同且符合 base64，CSP 不含 `unsafe-inline`/`unsafe-eval`，非 HTML 资源字节不变，构建产物 `dist/web-dist/index.html` 保留占位符。
- [x] 1.2 前端注入 nonce：新增 `src/web/csp-nonce.ts`，在 `main.tsx` 首行静态导入；将 `get-nonce@1.0.1` 设为直接依赖；验证：`npm ls get-nonce` 只有一个解析结果；新浏览器测试使用 `collectCspViolations` 打开删除确认、调用证据、设置三个对话框后违规数为 0，且对话框打开时 `document.body` 不可滚动。
- [x] 1.3 引入 Tailwind preflight 与 `@layer base` 基线（链接、body、富文本标题/列表补充），并将分隔条改为 1px 加热区；验证：新浏览器测试断言会话链接 `text-decoration-line` 为 `none`、颜色等于 `--ink`，富文本 `ul` 为 `disc`、`h2` 字号大于正文；对 `/work`、`/work/session/:id`、`/create`、`/work/settings` 在明暗两种主题下截图，并附人工审阅记录；类型检查与构建通过。
- [x] 1.4 连接授权失效整页引导：`api.ts` 广播 `AUTH_LOST`，新增 `ConnectionGate` 包裹路由（用 `hidden` 保留子树）；验证：浏览器测试在无 cookie 时直接访问 `/work`，只看到“需要从终端打开 Nekomimi”，看不到“会话列表不可用”和主题读取失败文字；运行中清除 cookie 后提交，草稿保留且无重复 POST；带 token 重新打开后点“重试”，恢复原路由。
- [x] 1.5 批次 A 回归；验证：`npm run typecheck`、`npm test`、`npm run test:browser` 全部通过，失败项修复记录保存在 `docs/validation/simplify-user-workbench/batch-a.md`。

## 2. 批次 B：开发者视图、文案与顶栏（design D3、D7、D10）

jsdom 于 2.1 起加入 devDependencies（纯测试环境，不进入产品包）。

- [x] 2.1 实现 `state/developer-view.ts`（本地偏好、storage 事件同步、localStorage 不可用时回退）和 `dev-only.tsx`（`DevOnly`/`DevValue`/`DevEyebrow`）；验证：vitest 单测覆盖默认关闭、写入/读取、`storage` 事件触发订阅、`localStorage` 抛错时回退到内存、`html[data-developer-view]` 同步；组件测试断言关闭时 `DevOnly` 子组件未挂载（其 `useQuery` 不发请求）。
- [x] 2.2 新增 `src/web/glossary.ts`，并让 `presentation.ts` 的 `statusText` 从它导出；按 design D10 的替换表改写 L0/L1 文案；验证：单测覆盖全部状态码映射（`test/glossary.test.ts`）；`developer-view.spec.ts` 中 `expectNoInternalTerms` 在 `/work`、空会话、`/create` 均通过。实现补充：修复了命令补全弹层在视口变化后停留在过时坐标遮挡输入框的问题（`task-input.tsx` 测量改为 rAF+settle）。
- [x] 2.3 将英文眉标（WORK MODE/CREATE MODE/INSPECTOR/WORKSPACE/CREATION/CANDIDATE）替换为 `DevEyebrow`；会话原始状态、交接命令/快照 hash、目标构建改用 `DevValue`；验证：`rg "tracking-\[2px\]" src/web/v2` 只命中 `dev-only.tsx`；`developer-view.spec.ts` 断言关闭时 `data-dev-value`/`data-dev-eyebrow` 数量为 0，开启时可见。运行 ID 内联展示与能力阶段码的归属在 3.7/3.6 中随头部和导航重构完成。
- [x] 2.4 `CoreStatusBadge` 重写为异常/切换/开发者视图才显示，`TopBar` 移除 `CoreRecoveryButton` 与工作模式目标标签；验证：`core-status.spec.ts` 迁移后 2/2 通过——正常状态顶栏无 `core-running-version` 和“版本恢复”；status 500 时显示“版本待确认”，点击后打开恢复对话框；开发者视图显示截断 hash。
- [x] 2.5 “更多操作”改为 `SettingsMenu`；`Menu` 支持 `separator`/`checkbox`（`menuitemcheckbox`），方向键跳过分隔线；`CoreRecoveryDialog` 改为静态导入；验证：`header-recovery.spec.ts` 2/2；`developer-view.spec.ts` 覆盖开关 `aria-checked`、刷新保持与双窗口同步；`v2-feature-loading.spec.ts` 验证恢复对话框不请求 core-recovery chunk 且静态可用（不依赖可选 chunk 加载成功，原“chunk 失败重试”断言按规格迁移为静态可用断言）。
- [x] 2.6 开发者视图非权威验证；验证：`developer-view.spec.ts` 对同一任务分别在开启/关闭状态下提交，两次 submit 请求体（除 commandId）完全一致；切换开关本身零 `/api/v1` 写请求。核心切换与交接确认的门槛不变由 core-switch-ui/handoff 既有测试保持（UI 入口尚未改动）。
- [x] 2.7 批次 B 回归与测试兜底：16 个文件迁移（“更多操作”→“设置”、“导出会话”→“导出当前会话”、“版本恢复”→设置菜单项、原始状态断言→术语表文案、扩展 iframe 自有文案保留）；新增 `test/browser/fixtures/workbench.ts`；验证：迁移文件单独运行全部通过（customization 9、runtime-ui 2、workbench 5、syntax、workbench-upgrade、v2-runtime-slots、theme-management、local-experience、core-switch-real、header-recovery 2、core-status 2、core-launch-info、core-switch-ui、v2-feature-loading 7、session-navigation 5、developer-view 3），场景数不低于基线。

## 3. 批次 C：布局、导航与会话入口（design D4、D5、D6、D8、D9 自动刷新）

- [x] 3.1 实现 `state/details-drawer.ts`，并将 `WorkbenchShell` 改为两栏 + 可折叠详情面板（`usePanelRef`、始终挂载、Escape/关闭还焦点、布局 v2 只保存宽度）；验证：`details-drawer.spec.ts` 2 场景——1280px 默认无主区外的详情栏（主区 ≥70%）、“变更”打开定位变更标签、Escape 还焦点、再开仍挂载。扩展 iframe 不重新加载由 live-panels 既有测试在批次 D 全量复核（iframe 数量不增）。
- [x] 3.2 窄屏覆盖层 CSS 与 TopBar“会话”/头部“详情”按钮，替换“导航与详情”；验证：`details-drawer.spec.ts` 窄屏场景——导航/详情覆盖层互斥、模式/发送可达、无横向溢出；5 个使用“导航与详情”的测试文件已迁移（customization-studio、session-navigation、v2-workbench、workbench-upgrade、workbench）并全部通过。
- [x] 3.3 文件定位自动展开抽屉（`revealDetails` 映射 `detailsDrawer.open("files")`）；验证：`v2-content-files.spec.ts` 10 场景通过（宽屏打开抽屉并切到“文件”，窄屏覆盖层）；`v2-history.spec.ts` 布局恢复场景通过（布局 v2 只保存宽度）。
- [x] 3.4 路由收敛：新增管理页注册表 `managementPages` 与 `managementPage`/`ManagementMain` 工厂（带“返回任务”），所有现有管理深链接路径保持不变；验证：`management-routes.spec.ts`——work/create 两个模式下全部注册表页面深链接刷新后渲染、会话级深链接可用、无 404；`router.tsx` 由 430 行收敛到 300 行。
- [x] 3.5 设置总览页 `/work/settings-hub`、`/create/settings-hub`，以及设置菜单“全部设置”；验证：`management-routes.spec.ts` 第 3 场景——总览以分组卡片列出全部注册表条目（标题+说明），逐项可达（打开基础设置）；键盘 Tab 顺序合理由链接语义保证，批次 D 复核。
- [x] 3.6 精简会话导航：`WorkNavigation` 移除管理链接（“主题与外观/基础设置/面板管理/持久工作流管理/模型用途与配置”），“+ 新任务”一键创建并保留可选“命名后创建”；`CreateNavigation` 移除 8 个管理链接，能力清单改为“能力与权限 · N 项可用”计数链接，原始清单进 `DevOnly`；“刷新会话列表”进 `DevOnly`；验证：`management-routes.spec.ts` 断言默认导航无管理链接；迁移 13 个使用旧入口的测试文件（改用 `createTask` 夹具、会话深链接或设置总览 SPA 导航），customization 9/9、customization-lifecycle、customization-studio、context-meter、panel-management、theme-management 全部通过；修复实施中发现的会话级资源页路由丢失 sessionId 的回归。
- [x] 3.7 会话头部与 `SessionMenu`：拆分 `InspectionDialog`/`ContextDetailsDialog` 为受控对话框，头部只保留标题、状态、停止、“变更 · N”、“会话操作”；时间线每轮按钮改为“查看证据”；验证：浏览器测试覆盖键盘打开菜单 → 调用证据 → Escape 后焦点回到“会话操作”；运行中导出/删除禁用且显示原因；迁移 6 个使用“调用证据”的测试文件，检查器内断言保持不变。；已验证：`SessionMenu` 用 `PanelDialog` 统一 5 个受控对话框，关闭后焦点回到“会话操作”，运行中导出/删除禁用并显示原因；每轮“查看证据”为 `compact` 变体（热区 24px、不增加行高），仅在该轮有运行时显示。证据：`docs/validation/simplify-user-workbench/batch-c.md`。
- [x] 3.8 证据一致性；验证：新浏览器测试对同一运行分别在开发者视图开启/关闭时，从会话菜单和时间线“查看证据”打开检查器，比较 attempt 数、请求 hash 和原始响应文本完全一致；打开检查器期间没有新增模型或工具调用。；已验证：`evidence-consistency.spec.ts` 对 4 种组合（开发者视图开/关 × 会话菜单/每轮入口）比较 attempt 数、全部 64 位 hash 与检查器全文完全一致，打开期间 0 写请求、模型调用仍为 1 次。
- [x] 3.9 输入区上下文入口 `ContextMeterButton`，并在上下文详情中把“技术详情”默认折叠（开发者视图下默认展开）；验证：context-meter/context-details 测试迁移后通过；容量已知时显示整数百分比，未知时显示“上下文”；360px 下不遮挡发送；展开技术详情后的内容与开发者视图开启时一致。；已验证：`ContextMeterButton`（`DialogTrigger`）容量已知显示“上下文 N%”，未知显示“上下文”；“技术详情”默认折叠、开发者视图下展开；`context-meter`/`context-details` 通过。
- [x] 3.10 交接按需展示：`HandoffCompose` 支持 `initiallyOpen` 并由会话菜单打开；`HandoffCards` 在空记录时返回 null；`HandoffRecovery` 接收外部 states，“重新读取确认状态”放入 `DevOnly`；验证：浏览器测试断言空会话中不存在“交接与交付”“交接确认状态”；handoff-cards/handoff-recovery/handoff-summary/delivery-navigation 测试迁移后通过；确认交接后断网再恢复，状态自动更新为“已交接”。；已验证：空会话不存在“交接与交付”“交接确认状态”“刷新交接记录”“重新读取确认状态”（`management-routes.spec.ts`）；`handoff-cards.spec.ts` 8/8；确认成功后保持对话框显示接收收据。
- [x] 3.11 自动刷新：开启 `refetchOnWindowFocus`/`refetchOnReconnect`，并增加 SSE 驱动的 handoff 查询失效（`stream-invalidation.ts`，事件名以实际协议为准）；验证：浏览器测试在另一窗口新建会话后，当前窗口聚焦即出现新会话；聚焦触发的请求全部是 GET（用 `page.on('request')` 断言无 POST）；交接读取失败时显示“重试”。；已验证：`auto-refresh.spec.ts`——聚焦后自动出现其他窗口新建的会话且全部为 GET；交接经 SSE 自动出现卡片。偏差：`handoff.*` 不进入时间线投影，故按快照 seq 前进（300ms 合并）触发失效，按会话重置游标。
- [x] 3.12 删除不再使用的模块与样式（`more-menu.tsx`、`core-recovery-button.tsx`、`WorkDetails` 中 INSPECTOR 常驻卡片、旧 `.workbench-shell[data-narrow][data-expanded]` 规则等）；验证：`rg` 确认无引用；`npm run typecheck` 与构建通过；`web-feature-loading` 构建体积测试通过，并记录 chunk 体积前后对比。；已验证：`rg` 确认无 `more-menu`/`core-recovery-button`/INSPECTOR 常驻卡片/`data-expanded` 旧规则引用；两套 `tsc` 通过。

## 4. 批次 D：综合回归、文档与交付

- [x] 4.1 完整回归；验证：`npm run typecheck`、`npm test`、`npm run test:browser` 全部通过；浏览器场景数不低于 0.2 基线（新增场景另计）；按 design D11 对照表逐文件记录迁移，确认没有删除断言。；已验证：两套 `tsc` 通过；浏览器 217/217（基线 201，新增 16）；vitest 796/796（`--maxWorkers=2`；默认并发在本机因 Spotlight 负载超时，已在 batch-d.md 说明）；`openspec validate --all --strict` 通过；迁移对照见 batch-c.md，未删除或放宽断言。
- [x] 4.2 安装包验收；验证：`npm run test:pack` 通过；在临时目录全局安装后启动 `nekomimi web`，在 Node 22.19.0 下用 Playwright 打开终端链接，CSP 违规数为 0，preflight 生效（链接无下划线），开发者视图开关可用，CLI 输出无 nonce 泄露。；已验证：`npm run test:pack` 通过；全局安装的实例在 Node 24.15.0 下 CSP 违规 0、控制台错误 0、链接无下划线、CSP 头含 nonce 且无 `unsafe-inline`、开发者视图可用、CLI 输出无 nonce。**Node 22.19.0 未实测**（本机无该版本），见 README.md 残余风险。
- [x] 4.3 可访问性与窄屏复核；验证：在 360px、200% CSS zoom、prefers-reduced-motion 下运行 web-design-system 相关场景（键盘主流程、浮层 Escape 最上层优先、抽屉焦点归还），全部通过；截图存入 `docs/validation/simplify-user-workbench/screens/` 并附审阅说明。；已验证：360px + 200% 缩放 + reduced-motion 无横向溢出、上下文入口不遮挡发送（发送可滚动到达）；键盘主流程/Escape/焦点归还由现有用例覆盖；截图与说明见 batch-d.md 与 screens/。
- [x] 4.4 更新 README 与 `docs/` 中的界面说明（截图、入口位置、开发者视图说明、CSP 说明）；验证：文档中不再出现“更多操作”“版本恢复按钮”“导航与详情”等旧入口描述；`openspec validate --all --strict` 通过。；已验证：README 新增“界面一览”、开发者视图与 CSP 说明；`docs/development.md` 与随包发布的 `extension-docs/customization-lifecycle.md` 的旧入口描述已更新；`rg` 无用户可见旧入口残留；`openspec validate --all --strict` 通过。
- [x] 4.5 提交完成报告与残余风险；验证：`docs/validation/simplify-user-workbench/README.md` 中每项任务都有可定位证据，未验证项（如 Windows）明确标为未测；归档与发版另需用户授权。；已验证：`docs/validation/simplify-user-workbench/README.md` 逐项索引证据，未测项（Node 22.19.0、Windows）明确标注；归档与发版需另行授权。
