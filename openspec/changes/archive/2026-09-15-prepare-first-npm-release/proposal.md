## Why

MVP 已完成本地验收，但 README 仍偏开发记录，安装验证尚未覆盖用户通过 npm 全局安装后的真实入口，仓库也没有自动发布流程。首版发布前需要将交付路径收敛为“安装 → 进入项目目录 → nekomimi web → 设置 DeepSeek API key → 开始任务”，并建立可验证、可追溯的发版过程。

## What Changes

- 完全面向最终用户重写中文 README：产品用途、Node.js 前提、全局安装、启动、密钥获取与设置、会话与工作目录、更新卸载、常见问题；开发和验收内容迁往 docs，通过链接访问。
- 验证全局安装的 nekomimi 在任意用户项目目录启动 Web，无需克隆源码或现场构建；页面只枚举该规范化目录的会话，文件工具作用于该工作区，shell 默认 cwd 为该目录。
- 保持配置及日志存放在 ~/.nekomimi，按工作区分区；不把“目录下的会话”误解释为将 Journal 搬回项目目录。明确当前 shell 不是操作系统沙箱。
- 准备 nekomimi@0.1.0 公共 npm 包，补齐发布元数据与经确认的许可证，检查 tarball 内容，移除 private 发布阻断。
- 增加 GitHub CI 与 Release 触发的 npm OIDC 自动发布，校验 tag/版本/来源提交、构建与测试、发布重复保护，并适配临时目录和浏览器等 CI 平台差异。
- 编写首次交互发布、后续 Trusted Publisher 配置和自动发版的维护文档。

## Capabilities

### New Capabilities

- `npm-release-delivery`: npm 全局安装交付、面向用户的使用文档、首版引导及 GitHub 自动发版契约。

### Modified Capabilities

无。工作区隔离和文件凭证沿用 local-user-configuration、local-web-service 和 core-tools，新增已安装包层面的验收，不重定义运行时历史。

## Impact

涉及 README、docs、package.json/lockfile、打包与测试脚本、.github/workflows 及必要的安装后资源定位修复。对应 spec.md 的 Web/CLI 入口、工具执行与可观测性要求；不新增模型切换、迁移 UI、TUI、MCP 或系统级沙箱。发布前须确定 GitHub 仓库归属、npm 账户/包名权限与许可证；本 change 的准备工作不包含自动创建远端仓库、push、实际 publish 或修改账户授权，真实首发另行显式执行。
