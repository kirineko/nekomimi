## Context
Windows 原生检查是独立 CI job，发布上传在 Ubuntu 执行。

## Goals / Non-Goals
目标：本阶段仅以 macOS/Linux 检查作为发布门禁。非目标：删除 Windows 代码、限制 npm 安装平台或宣称完整支持。

## Decisions
删除 Windows job，不保留隐藏开关。保留标签触发、四组矩阵及 Release 上传流程。文档与规格明确暂停 Windows 检查，恢复时需单独变更并提供原生验收证据；历史发布记录保持原样。

## Risks / Trade-offs
暂不自动发现 Windows 平台回归，README 明确其未作为当前验收平台。以 YAML 结构核对、发布检查及严格规格校验验证变更。
