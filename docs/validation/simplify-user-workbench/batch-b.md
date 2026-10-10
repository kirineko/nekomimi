# 批次 B 验证记录（任务 2.1–2.7）

## 2.1 开发者视图状态与组件
- `src/web/v2/state/developer-view.ts`：localStorage 偏好、`storage` 事件跨窗口同步、不可用时回退到内存；`html[data-developer-view]` 同步。
- `src/web/v2/dev-only.tsx`：`DevOnly`（关闭时子树不挂载，避免隐藏节点仍发请求）、`DevValue`（等宽+“开发”标记+截断+复制）、`DevEyebrow`。
- 验证：`test/developer-view.test.tsx`（jsdom）5 项通过：默认关闭、持久化、storage 事件、localStorage 抛错回退、SSR/静态渲染关闭。
- 依赖补充：`jsdom` 加入 devDependencies（纯测试环境）。

## 2.2 术语表与文案
- `src/web/glossary.ts`：`sessionStatus`（头部，就绪不显示）、`listStatus`（列表弱化含“就绪”）；`presentation.ts` 的 `statusText` 从术语表导出。
- L0/L1 文案按 design D10 替换（“专注当前项目”→“开始一个任务”、“为工作交付新能力”→“为 Nekomimi 开发新能力”、“正在读取可靠状态…”→“正在加载会话…”、“投影”→“上下文占用”等），测试同步更新。
- 修复（实施中发现的真实缺陷）：命令补全弹层在视口变化后停留在过时坐标，移动端遮挡输入框（`task-input.tsx` 测量改为 rAF 合并 + 120ms 后复测 + scrollend）。
- 验证：`test/glossary.test.ts` 覆盖全部状态码；`session-navigation.spec.ts` 5/5 通过（含此前失败的 116 场景）。

## 2.3 L2 信息归属
- 全部 6 处英文眉标 → `DevEyebrow`（`rg tracking-\[2px\] src/web/v2` 仅命中 dev-only.tsx）。
- 会话头部原始状态 → `SessionStatusLabel`（术语表标签 + `DevValue` 原始码）；交接命令/快照 → `DevValue`；目标构建 → `DevValue`。
- 运行 ID 内联展示与能力阶段码归属随 3.7/3.6 完成（在对应任务范围内）。

## 2.4 顶栏精简
- `CoreStatusBadge`：pending 不占位；异常/无效构建 → “版本待确认”按钮（点击直达恢复，不依赖开发者视图）；切换中 → 警示 Badge；正常 + 非开发者视图 → 隐藏。
- `TopBar`：移除 `CoreRecoveryButton` 与工作模式“用户项目”标签；创造模式保留目标标签。
- 验证：`core-status.spec.ts` 2/2（默认隐藏、异常直达恢复、开发者视图显示截断 hash、缓存绝不冒充当前）。

## 2.5 设置菜单
- `settings-menu.tsx` 替代 `more-menu.tsx`（已删除）；`Menu` 支持 `separator` 与 `menuitemcheckbox`（方向键跳过分隔线、开关项不关闭菜单）。
- `CoreRecoveryDialog` 静态导入（compact-header：宿主恢复不依赖可选 chunk）；`v2-feature-loading.spec.ts` 迁移为“恢复对话框零 chunk 请求且可打开”。
- 验证：`header-recovery.spec.ts` 2/2；`developer-view.spec.ts` 开关 aria-checked、刷新保持、双窗口同步（storage 事件）均通过。

## 2.6 非权威验证
- `developer-view.spec.ts`：开启/关闭两种状态提交同一任务，submit 请求体（除 commandId）完全一致；切换开关零写请求。

## 2.7 测试迁移清单（16 文件）
“更多操作”→“设置”、“导出会话”→“导出当前会话”、“版本恢复”→设置菜单“版本与恢复”、原始状态断言（completed/cancelled/…）→术语表文案（`first()` 处理多处出现）、扩展 iframe 自有文案保留原文。
迁移文件单独运行全部通过；场景数不低于 0.2 基线（基线 198+3 偶发；批次 B 后定向复核 60+ 场景通过）。

## 其余回归
- typecheck（src+web）0 错误；`npm run build` 通过。
- 批次 A 的 4 个新测试文件与本批 developer-view 3 个场景全部通过。
- 全量 `npm test` / `npm run test:browser` 由批次 D（4.1）执行。
