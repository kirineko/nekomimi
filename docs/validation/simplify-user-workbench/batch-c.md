# 批次 C 验证记录：布局与入口收敛（3.1–3.12）

## 范围与结论

两栏工作台 + 可折叠详情抽屉、管理页路由收敛、设置总览、会话菜单、上下文入口、交接按需展示、自动刷新。
所有改动只改变入口与默认可见性；证据、上下文、请求 body、Journal 均未改动。

## 逐项证据

| 任务 | 实现 | 验证 |
| --- | --- | --- |
| 3.1–3.3 | `state/details-drawer.ts`、`WorkbenchShell` 两栏 + 始终挂载的可折叠详情面板 | `details-drawer.spec.ts`、`v2-content-files.spec.ts` |
| 3.4–3.5 | `management-pages.ts` 注册表（纯数据）、`managementPage()` 工厂、`/work|create/settings-hub` | `management-routes.spec.ts`（深链接刷新、总览逐项可达） |
| 3.6 | `WorkNavigation` “+ 新任务”；`CreateNavigation` 精简为“能力与权限 · N 项可用” | `v2-workbench.spec.ts` 等迁移后通过 |
| 3.7 | `SessionMenu`（`PanelDialog` 统一 5 个受控对话框）；每轮“查看证据”；焦点回到“会话操作” | `inspection.spec.ts`、`workbench.spec.ts`、`readable-turns.spec.ts` 等 |
| 3.8 | 新增 `evidence-consistency.spec.ts` | 开发者视图开/关 × 会话菜单/每轮入口共 4 组合：attempt 数、全部 hash、检查器全文逐字一致；打开检查器 0 写请求、模型调用仍为 1 次 |
| 3.9 | `ContextMeterButton`（`DialogTrigger`，关闭后焦点归还）；“技术详情”默认折叠 | `context-meter.spec.ts`、`context-details.spec.ts`；容量未知显示“上下文” |
| 3.10 | `HandoffCards` 空记录返回 null；`HandoffCompose` 支持 `initiallyOpen/onClose` | `handoff-cards.spec.ts`（8/8）、`management-routes.spec.ts` 空会话场景 |
| 3.11 | `refetchOnWindowFocus/Reconnect`；`stream-invalidation.ts` | `auto-refresh.spec.ts`：聚焦自动出现其他窗口新建的会话且只有 GET；交接事件经 SSE 自动出现卡片 |
| 3.12 | 无 `more-menu`/`core-recovery-button`/INSPECTOR 常驻卡片/旧 `data-expanded` 规则；`rg` 无引用 | `tsc` 两套配置通过；构建通过 |

## 实现中发现并修复的真实缺陷

1. **加载后未滚到底**：每轮“查看证据”按钮（`size=sm`，32px）把标题行撑高，造成布局位移，`scrolling.spec` 11 个场景失败。
   修复：`compact` 变体热区 24px、负外边距抵消，行高保持一行文字。
2. **关闭检查器后焦点丢失**：新入口未使用 `DialogTrigger`，Radix 不知道触发者。改用 `DialogTrigger asChild`。
3. **宽屏→窄屏详情抽屉变成全屏遮罩**：切到窄屏时关闭抽屉，窄屏覆盖层只由用户显式打开。
4. **交接确认后收据链接消失**：确认成功即关闭对话框会隐藏“查看接收会话”收据；成功后保持对话框显示收据。
5. **SSE 失效模块**：`handoff.*` 事件不进入时间线投影，改为按快照 seq 前进触发；按会话重置游标，首次快照不触发多余请求；用 `v2Key` 前缀而非硬编码切片。
6. **管理页重复/嵌套**：页面自带 `<main overflow-auto>` 与 `ManagementMain` 形成双滚动条、双内边距，并重复“返回开发目标”。
   收敛为 `ManagementMain` 作唯一 `<main>`；无会话时保留有意义的“选择创造目标”。
7. **既有排版缺陷**：`.ds` 下 `h1/h2/h3/p` 与按钮的基础规则未分层，永远压过 Tailwind 工具类（标题恒为 24px、`text-xs` 对按钮无效、`p` 外边距不可覆盖）。
   并入 `@layer base`；焦点环/光标规则保持原样以不改变可访问性行为。
8. **设置总览居中而返回链接靠左**；**窄屏顶栏换行**（隐藏品牌文字、保留 logo）；**历史导航常驻 48px 空白**（收到 36px，仍容纳小号按钮）；**输入区“发送”紧贴视口底边**（补底部内边距与安全区）。
9. **文案/信息**：消息标签 `YOU/NEKOMIMI` → “你/Nekomimi”，用户消息淡底色；“会话信息”默认视图不再出现空的“会话标识/当前运行”标签；证据页过期引导改为真实入口按钮，runId 退入开发者视图；`core-switch` 的“顶部版本恢复”改为“设置 → 版本与恢复”。

## 测试迁移要点（未弱化断言）

- 新夹具：`openEvidence`、`openDrawerTab`、`gotoManagement`、`createTask`、`setDeveloperView` 等。
- `/create/resources|themes` 无会话时按设计只读，涉及授权的用例改用会话深链接。
- 同 URL 仅 hash 变化会触发“重新授权后自动刷新”（产品行为），相关用例先离开文档再导航。
- 若干 fixture 在 `goto` 后立即再次 `goto`，改为先等待应用挂载（应用在 `connect` 完成后才渲染）。
- 重复属性 `exact:true,exact:true`（批量替换产物）已清理。
