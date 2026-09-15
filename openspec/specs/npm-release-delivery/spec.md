# npm-release-delivery Specification

## Purpose

让最终用户无需获取项目源码即可通过 npm 安装并在自己的项目中启动 Nekomimi，同时为维护者提供可核验的安装包、清晰的首版发布步骤和来自 GitHub 的可追溯自动发布流程，降低交付与使用之间的差异。

## Requirements

### Requirement: 全局安装与工作区启动

公开 npm 包 SHALL 提供 nekomimi 命令及运行所需 Web 静态资源；在满足声明的 Node.js 要求后，用户无需克隆源码或手动构建即可使用。未指定工作区时，nekomimi web SHALL 以启动时当前目录的规范化路径为工作区，只显示该工作区的会话，并将文件操作及 shell 初始工作目录定位到该工作区，不写入 npm 安装目录。

#### Scenario: 干净环境首次使用

- **WHEN** 用户全局安装安装包，进入已有项目目录并执行 nekomimi web
- **THEN** Web 可加载，未配置凭证时可打开设置并取得官方密钥获取链接，保存后可执行任务；重启后配置和当前工作区历史保留。

#### Scenario: 两个项目隔离

- **WHEN** 用户分别在 A 和 B 目录启动，或从等价的规范化路径重新启动 A
- **THEN** A 与 B 不混列会话，A 的等价路径共享历史；相对文件操作落在选定项目，安装包目录和另一项目不被该相对操作修改。

### Requirement: 面向用户的 README

README SHALL 以安装使用为主线，包含 Node.js 前提、npm 全局安装、进入目录、Web 启动、官方 DeepSeek API key 获取与保存、发送任务、会话范围、更新及卸载。数据位置与工具边界 SHALL 准确：配置和 Journal 在用户数据目录按工作区管理，shell 具有当前用户权限，不能宣称其为系统沙箱。开发研究和验收记录 SHALL 通过独立文档链接提供。

#### Scenario: 按说明完成任务

- **WHEN** 新用户仅按 README 操作
- **THEN** 无需仓库内开发命令或环境变量密钥即可完成首次任务；知道停止服务、恢复历史及卸载不自动删除个人数据的行为。

### Requirement: 可验证的发布包

发布产物 SHALL 包含声明的 CLI、Web 资源、使用文档和经确认的许可证，依赖与 Node.js 要求可解析；不得包含个人配置、会话记录、参考仓库或测试截图。发布版本与 GitHub Release 标签 SHALL 一致。

#### Scenario: 包内容或版本不符

- **WHEN** 构建资源缺失、安装失败、必要元数据未确定或 Release 标签与包版本不一致
- **THEN** 发布检查失败，不上传版本，不把检查失败报告成发布成功。

### Requirement: GitHub 自动发布

后续正式版本 SHALL 由显式发布的 GitHub Release 触发，检出其标签对应提交，在检查通过后使用 npm Trusted Publishing 发布。普通 push、PR、草稿和预发布 Release SHALL 不触发正式 npm 发布；凭证和真实模型调用不作为普通 CI 的前提。

#### Scenario: 正式发版

- **WHEN** 维护者发布与包版本一致、来自受认可主线提交的正式 Release，且 npm 信任关系已配置
- **THEN** 自动流程验证并发布对应产物，记录版本、提交及包信息；公开仓库发布公开包时提供 npm 来源证明。

#### Scenario: 失败取消和重跑

- **WHEN** 检查失败、发布前取消、授权不匹配或同版本已存在
- **THEN** 不绕过检查或使用隐藏 token 回退；取消和失败明确报告，同版本不覆盖。网络结果不确定时先核查 registry 中版本及产物，再决定是否重试。

### Requirement: 首版引导与维护文档

维护文档 SHALL 区分首版交互认证发布与包存在后的 OIDC 配置，说明 GitHub 仓库、workflow 文件、npm 账户与包权限的对应关系，提供 dry-run、首发、后续发布和失败处理步骤。准备完成不得被描述为已成功发布。

#### Scenario: 首版包尚不存在

- **WHEN** 目标包尚不存在，不能预先绑定 Trusted Publisher
- **THEN** 维护者先验证并交互发布首版，再配置精确的仓库及 workflow 信任；后续流程不要求保存长期 npm 写 token。

### Requirement: 搜索元数据与最低运行时

发布包 SHALL 提供与本地编程助手相关的非空 keywords 数组，Node.js 最低要求 SHALL 为 22.19.0，README 与包元数据保持一致。CI SHALL 覆盖最低版本和 Node.js 24；固定依赖不支持的 Node.js 20 和较早的 22 小版本不得声明支持。

#### Scenario: 最低版本安装使用

- **WHEN** 在 Node.js 22.19.0 安装生成的 npm 包
- **THEN** 安装符合 engines 约束，CLI、Web、工作区隔离和离线导出导入检查通过。

#### Scenario: 元数据进入发布产物

- **WHEN** 生成 npm tarball
- **THEN** 包中的 keywords 非空且 engines 与 README 声明相符；版本未发布时不宣称 npm 网站已更新。

### Requirement: 发布标签触发 CI

CI SHALL 仅对推送的 v 开头版本标签运行 Linux/macOS 与 Node.js 22/24 检查矩阵；普通分支 push 和 pull request SHALL 不触发 CI。npm 正式上传仍 SHALL 由正式 GitHub Release 触发并保留发布前检查。

#### Scenario: 日常开发提交

- **WHEN** 推送分支或创建、更新 PR
- **THEN** 不触发 CI 或 npm 发布。

#### Scenario: 标签发布

- **WHEN** 推送 v0.1.2 等版本标签
- **THEN** CI 检查该标签提交；维护者等待通过后创建正式 Release，发布流程检查失败时不上传 npm。
