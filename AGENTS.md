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

## 发版流程

详细操作见 `docs/releasing.md`，实际触发配置以 `.github/workflows/ci.yml` 和 `.github/workflows/publish.yml` 为准。

- 普通分支 push、PR 不运行 Actions。推送 `v*` 标签触发 CI；正式 GitHub Release 的 `published` 事件触发 npm 发布。草稿不触发，预发布跳过正式上传。
- 用户仅要求提交或 push 时，不创建版本标签或 Release。用户明确要求发版后执行以下流程。

1. 更新 `package.json` 和 `package-lock.json` 的版本，确认版本未在官方 npm registry 发布；检查 README、keywords、engines 和发布说明与实际行为一致。
2. 完成变更相关验证及 `openspec validate --all --strict`，同步主规格并归档已完成变更。运行类型检查、单元测试、浏览器测试、发布检查和安装包验收；凭证及真实模型调用不作为 CI 前提。
3. 提交并推送代码到 `main`，创建指向该提交的 `vX.Y.Z` 标签并推送。标签必须与包版本一致。
4. 等待该标签对应的 Linux/macOS × Node.js 22.19.0/24.15.0 四组 CI 及 Windows 原生安装检查全部通过。**Publish 不会自动等待 CI，禁止在确认标签 CI 通过前创建正式 Release。**
5. 创建正式 GitHub Release，等待 `Publish npm` 工作流完成。它检出标签、检查版本与 main 关系、执行测试，并验证和上传同一 tarball；使用 npm Trusted Publishing，不回退长期 NPM_TOKEN。发布工具链使用 Node.js 24，用户最低运行时为 22.19.0。
6. 从官方 registry 核验版本、keywords、engines、integrity 和来源证明；下载发布包核对完整性，在最低支持的 Node.js 版本完成全局安装与 Web 闭环验收，再记录结果。

npm 查询和账号操作显式使用 `--registry=https://registry.npmjs.org`，避免本机镜像配置干扰。发布失败或结果不确定时先查询 registry，已存在的版本不得覆盖或盲目重发；需要修复时使用新版本。
