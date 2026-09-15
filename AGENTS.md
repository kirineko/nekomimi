# Nekomimi

## 项目入口

- `spec.md`：需求与技术选型研究；推荐和上游信息需要实现时验证。
- `openspec/config.yaml`：项目上下文及产物规则。
- `openspec/changes/`：规划和进行中的变更。
- `openspec/specs/`：完成变更归档后的能力契约；已交付核心、Web MVP 和可读执行追踪。

## 工作流

采用 OpenSpec spec-driven：proposal → specs/design → tasks → apply → 验证 → archive。
新增能力、架构调整或行为变更先建立或更新对应 change；保持需求、设计、任务和实现一致。
用户要求实施时执行相应 tasks；只有验证完成后勾选。仅规划完成不代表功能已实现。
归档前运行 `openspec validate --all --strict` 和变更相关检查；未完成工作保留在 change 中。
文档使用中文，保留 OpenSpec 结构标题及规范关键字。
Codex 工作流技能在 `.agents/skills/openspec-*`；使用时读取相应 SKILL.md。

## 核心约束

可观测性优先：所有模型调用经过同一可记录入口，每次 attempt 可追踪。
Journal 是唯一权威历史；模型上下文与最终请求为带来源的投影。
提示词由启用工具贡献；工具执行证据、模型结果和 UI 展示分离。
框架通过公开接口接入且版本固定；API key 不进入日志或客户端。
回放/导入不执行副作用；恢复不能自动重跑结果未知的工具。
