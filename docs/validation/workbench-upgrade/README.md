# 工作台、搜索与文件能力验收

日期：2026-09-15。环境：macOS arm64、Node.js v24.15.0、系统 Chrome。对应变更已归档至 `openspec/changes/archive/2026-09-15-upgrade-workbench-and-search`；未发版。

## 已实现

- 共用 RecordedCall/RecordedAttempt 记录主 Responses、会话命名和搜索 Messages 的最终请求及响应，保留用途、attempt 与工具关联。
- 内置 web_search 与启用配置、独立搜索地址及模型、结构化来源、完整/部分/空/失败区分；一次尝试，取消/超时后不自动重试。
- 统一浅色工作台、Composer 整体焦点与自动高度、文件/变更/执行详情面板，响应式抽屉与键盘焦点恢复。
- 持久化 patch 的可读增删、行号、上下文、统计和分页；只展示确认成功的 edit/write。历史损坏/缺失降级，长行截断显式标记，原始 patch 保留。
- 文件树按需分页、隐藏项、刷新、修改定位和用户触发的默认程序打开；目录/文件路径与来源认证检查。

## 验证结果

| 验证 | 结果 |
| --- | --- |
| `npm run typecheck` | 通过 |
| `npm test -- --maxWorkers=1` | 15 个文件、93 项测试通过 |
| `npx playwright test` | 9 项通过，含搜索→write→diff→定位→默认程序请求→重载，以及会话配置/取消/命名/导出/诊断 |
| `npm run test:pack` | 通过：tarball、局部/全局安装、CLI、静态资源、本地服务、离线导出导入 |
| `openspec validate --all --strict` | 15 项通过 |
| 真实 DeepSeek 搜索 | complete、10 条来源，usage 中 1 次服务端搜索，详见 search-live.json |
| macOS 原生默认程序打开 | `/usr/bin/open` 成功返回，中文、空格、引号与 & 路径作为文件参数，详见 native-open.json |
| Linux/Windows 原生默认程序打开 | 未验收：本机没有相应桌面环境；任务 3.4 保持未完成 |

浏览器中默认程序打开使用注入的打开器观察调用次数，不声称该测试打开了真实应用。原生 macOS 验收另创建临时文本文件并执行真实打开；成功返回只表示系统接受请求，不检测编辑器窗口内容。

全量并发测试曾遇到两项时序问题：诊断故障注入被 100ms 周期刷盘抢先触发，已在该测试使用较长刷盘周期隔离目标 append；既有 shell 取消测试曾在内容已停止变化后遇到 PID 尚可查询，串行全量复核通过，未修改 shell 行为或放宽断言。最终验收使用单 worker，保留并发时序现象供后续排查。

## 视觉与可访问性

截图位于本地 `output/playwright/workbench/`（生成产物，不提交）：conversation、inspector、files 的 1920/1440/1280/390 宽度截图，以及 settings。视口分别为 1920×1080、1440×900、1280×720、390×844；额外保留空态截图。

复核内容：整体无横向溢出，正文与代码分层；窄屏抽屉可关闭且恢复触发焦点；输入区无双重矩形聚焦框；文件单击不打开、双击只调用一次；面板切页不清空草稿；键盘 Enter/Shift+Enter/中文输入法、任务失败与停止遵循既有测试。

正文 `#292633`、辅助 `#696273` 对白底，紫色按钮白字、diff 增删文字与状态文字采用高对比配色；增删同时带符号，状态带文字，避免仅依赖颜色。`contrast.json` 记录六组主要配色的计算值，均高于 4.5:1（最低 5.37:1）。

## 证据及边界

- search-live.json 保存实际请求、body hash、已脱敏原始响应、来源和 usage，不保存请求认证头或 API key。
- 上游核对：<https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/web/web-search-deepseek/src/provider.ts>；本机 `deepseek-flash` + `/anthropic/v1/messages` 已实测可用。
- 搜索内部请求不进入主 Responses 消息历史；导出与历史查看不重发搜索。
- 文件树反映当前磁盘，历史 diff 反映执行证据；不捕获 bash 或外部编辑器的逐次变化，不提供 Git 暂存或回滚。
- 长 diff 单页最多 500 行，单行最多 4000 字符；完整原文可由附件获取。

## 2026-09-15 Review 修复回归

- 文件树保留内部目录别名的逻辑路径；祖先循环标为不可展开，直接请求循环目录拒绝。新增回归覆盖根目录自引用、别名内回指根目录、正常别名文件解析。
- 变更面板按事件 ID 增量合并，使用 before/after 序号分页并隔离会话请求。浏览器回归先加载 100 条、展开历史 diff 至第二段，再追加 60 条并继续加载剩余 20 条，验证原 DOM 节点与 diff 分页保持，切会话后旧列表清空。
- `npm run typecheck` 通过；`npx vitest run --maxWorkers=1`：15 文件、95 测试通过；`npm run test:browser`：10 测试通过；`openspec validate --all --strict`：15 项通过；`git diff --check` 通过。
- 全量测试首次在限制本地监听的沙箱中执行，服务器/CLI 测试受环境限制失败；允许测试所需本地 HTTP 服务及子进程后全量通过。
- 修复后再次审查路径校验、循环检测、增量边界、并发历史加载及会话切换取消，未发现新增可操作问题。未执行提交、发版或归档；原 3.4 的 Linux/Windows 桌面验收缺口不变。

## 归档记录

2026-09-15 按用户要求同步全部六项能力规格并归档。27 项任务中 26 项完成；3.4 的 Linux/Windows 原生默认程序打开验收仍未完成，原复选框和平台限制保留。归档校验通过，本次仅本地提交，不推送、不创建版本标签或 Release。
