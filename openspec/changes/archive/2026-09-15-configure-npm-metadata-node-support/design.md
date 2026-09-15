## Context

当前包要求 >=24；锁定的 pi-agent-core、pi-ai、pi-telemetry、chord 均要求 >=22.19.0。现有 pack smoke 已覆盖全局安装、CLI、Web、项目隔离及导出导入。

## Goals / Non-Goals

**Goals:** 用最低运行时实际验证支持范围，并让 CI 持续覆盖。

**Non-Goals:** 不降级或替换 pi 依赖以支持 Node.js 20；不改变 Journal、模型协议或持久化状态。

## Decisions

- engines 使用 >=22.19.0；不能只改成 >=20 而忽略依赖契约。
- keywords 使用 nekomimi、deepseek、ai、coding-agent、coding-assistant、cli、web-ui、local-first、observability。
- CI 的现有 macOS/Linux 检查增加 22.19.0 与 24.15.0 矩阵；发布工具链保持 Node.js 24。
- 在本机临时运行时中执行 typecheck、单元测试、浏览器和安装包验收；Node.js 20 用严格 engines 安装验证拒绝原因。

## Risks / Trade-offs

- Node.js 20 用户仍需升级 → README 明确最低小版本及依赖原因。
- npm 页面不会随本地编辑更新 → 后续使用新版本发布，本次不上传。
- 本机仅验证 macOS → Linux 由 CI 矩阵验证，不将待执行检查写为通过。
