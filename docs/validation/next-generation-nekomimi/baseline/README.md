# 下一代重构：批次 0 基线

## 范围与版本

- 对应任务：`openspec/changes/next-generation-nekomimi/tasks.md` 1.1。
- UTC 起始时间：2026-10-06T14:43:49.997326+00:00。
- 源码 commit：`be50c5a8a1557ef160056b964cd29e65b395685d`。
- 环境：macOS（Darwin）arm64、Node.js v24.15.0、npm 11.12.1。
- 产品包版本 0.2.1；生产 Pi 依赖仍为 0.85.1。未升级依赖、修改源码、测试断言或超时。
- 启动前工作区只有未跟踪的 `openspec/changes/next-generation-nekomimi/`；本报告及日志为本轮新增。
- `manifest.json` 保存命令、退出码、耗时、源码身份，以及 package/lock、测试配置、所有 test 文件的 SHA-256；用于固定 fixture 版本，不以规划目录状态冒充已提交实现。

## 命令与结果

三个命令串行执行，避免两个 build 同时修改 dist；Vitest 内部使用仓库原默认并行配置，未人为降低并发。未运行需要真实模型凭证的 live 脚本。

| 命令 | 退出码 | 耗时 | 结果 | 原始日志 |
| --- | --- | --- | --- | --- |
| `npm run typecheck` | 0 | 3.813s | 通过 | `typecheck.log` |
| `npm test` | 1 | 87.269s | 构建通过；54 文件中52通过、2失败；322用例中320通过、2失败 | `unit.log` |
| `npm run test:browser` | 0 | 162.137s | 构建通过；Chrome headless、单 worker，67用例通过 | `browser.log` |

此记录只证明当前源码在上述环境的结果，不证明 Pi 1.0.4 兼容、最低 Node、Linux、Windows 或新 UI 已通过验证。构建输出在现有被忽略的 dist 目录，浏览器输出在既有被忽略的 test-results 目录。

## 失败与初步定位

1. `test/customization-package-source.test.ts:102`：`bounds Git object history even when the selected commit has a tiny working tree`。
   - 错误：`Test timed out in 30000ms.`
   - 静态检查：用例在临时 Git 仓库创建大随机对象，再验证小工作树仍受到 Git 历史存储上限约束；有本地 Git、随机数据和磁盘负载。
2. `test/customization-workflow.test.ts:8`：`creates a review extension through recorded model tools, then uses skills, rules and MCP across reload and restart`。
   - 错误：`Test timed out in 30000ms.`
   - 静态检查：用假 Provider、本地 MCP 进程和临时工作区验证创建、校验、重载、调用、重启及停用。

两项的具体停滞阶段未定位。经用户选择“先隔离定位”，保持代码、断言和超时不变完成以下诊断（命令、耗时见 `diagnostics.json`）：

- `vitest run test/customization-package-source.test.ts`：退出 0，6/6 通过，1.869s。
- `vitest run test/customization-workflow.test.ts`：退出 0，1/1 通过，6.982s。
- 按原默认并发重新执行 `npm test`：退出 0，54/54 文件、322/322 用例通过，86.705s。

首次超时未复现。结果与瞬时资源竞争假设相容，但尚无负载剖析证据，不能确认根因或声称已修复。原失败基线保留，后续升级仍需完整回归。日志中存储诊断与故障注入用例并存，不能仅凭诊断行断言它们导致上述超时。

## 任务状态与后续门槛

任务 1.1 的目标是保存原始基线、退出码和失败项，因此记录工作已完成；**首次不是全绿，未改代码的后续全套复跑通过**。在隔离诊断后继续独立 Pi 发布包验证，不修改失败用例或超时；不把复跑成功覆盖为首次通过。
