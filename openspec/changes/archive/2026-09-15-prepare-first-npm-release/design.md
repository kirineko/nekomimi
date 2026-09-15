## Context

参见 proposal.md。当前包为 nekomimi@0.1.0、private=true、Node >=24，已有 dist CLI/Web 和本机安装包验收；尚无 remote 和 .github 工作流。测试脚本包含 /private/tmp，本机 Chrome channel 也需在 CI 明确安装。Journal 仍是唯一权威历史，发布工作不修改协议或恢复语义。对应 spec.md §5、§8、§12–13。

调研依据（2026-09-15）：[npm Trusted Publishing](https://docs.npmjs.com/trusted-publishers/) 要求受支持的托管 runner、npm >=11.5.1 和 OIDC 权限；[npm trust](https://docs.npmjs.com/cli/v11/commands/npm-trust/#prerequisites) 明确要求包已存在。此前 registry 查询 nekomimi 返回 404，仅是查询时状态，执行发布前再核查。

## Goals / Non-Goals

Goals：把用户安装链路与开发源码路径解耦；产物一次打包并核验；将正式 Release、包版本与来源提交绑定。

Non-Goals：不执行真实发布、不新增模型路由配置、不搬移用户历史、不引入 OS 沙箱、不升级 agent 框架、不用真实 API key 跑 PR CI。首版自动化准备与实际首发验收明确区分。

## Decisions

### 1. README 结构与工作目录

重新撰写而不是继续拼接开发记录。顺序为简短产品介绍、Node 24+、`npm install -g nekomimi`、`cd <项目目录>`、`nekomimi web`、打开终端输出的授权链接、设置中获取/保存 DeepSeek key、首次任务、会话与数据、更新卸载和常见问题。保持简洁，不要求用户理解 Journal、OpenSpec 或内部协议。开发命令移至 docs 开发指南。

会话“属于目录”由 canonical workspace 标识决定，不由安装位置或进程启动脚本位置决定。保留 ~/.nekomimi 文件配置和分区。相对文件工具应落在当前项目并拒绝越界，shell cwd 指向项目但不是安全沙箱。README 简短说明这一现有限制。验收覆盖 A/B 两个目录、等价路径、重启，以及安装目录不被任务相对写入。

### 2. npm 产物

保留 0.1.0 作为首版候选。配置公开 registry/access，移除 private，补齐 repository/homepage/bugs/license；许可证与远端 owner 由用户提供，不能猜测。继续 files 白名单发布 dist 和 README，包含 LICENSE；所有资源通过模块位置定位。开发者可以从源码构建，但最终用户无需 TypeScript/Vite。

测试改用 os.tmpdir()，全局安装验收通过临时 npm prefix 和临时用户数据目录隔离真实环境；从项目 A/B 调用已安装的 bin，并验证浏览器资源、设置持久化、会话隔离和合成工具写入。包内容扫描排除 credentials、会话、reference、截图。安装校验应针对最终待发布 tarball，发布不得重新生成不同包。

### 3. CI 与发布工作流

CI 在 push/PR 运行类型、单元与安装测试；Linux/macOS 使用相应托管 runner，浏览器安装使用显式步骤，未验收的平台如 Windows 不声明已支持。不把本机测试数字当成 Linux 通过证据。固定依赖及 Actions 的提交 SHA，使用已核查的 Node/npm 版本；OpenSpec CLI 也固定验证版本。

独立 publish.yml 使用 release.published 并排除 prerelease，读取不可变 tag 指向的 commit，不使用默认分支最新 HEAD。校验 vX.Y.Z 与 package.json、工作树、提交属于发布主线、npm 目标、元数据及必要资源；运行检查并生成 tarball，再对该 tarball 做安装测试和 publish。发布 job 使用 contents:read、id-token:write；不放 NPM_TOKEN。按包串行发布，运行中的发布不被新运行自动取消。

普通 push/tag push 只做 CI，发布正式 GitHub Release 才代表发版意图。版本存在时明确停止并展示 registry 状态；若上传后网络断开，比较完整性信息，不盲目重新发包。同版本不可覆盖，修复需新版本；错误版本可按维护文档 deprecate，不自动 unpublish。

### 4. 首发与后续 OIDC

首发操作手册：确认 GitHub URL/许可证/包权限 → 推送准备好的仓库并通过 CI → 本地交互 npm login/2FA → 发布已验证 0.1.0 tarball → 核验 registry 安装 → 在 npm 绑定 owner/repository/publish.yml 并允许 npm publish → 后续正式 Release 自动发布。

首版 GitHub Release 在发布工作流尚未启用或信任关系尚未配置时应由明确的 bootstrap 开关避免误触；建议工作流用仓库变量 NPM_TRUSTED_PUBLISHING_READY 控制，未启用时清晰跳过自动上传，首发文档记录原因。配置完成后打开该开关；后续权限失败必须失败，不静默回退。第一次真实 OIDC 发版结果另作发布记录，不属于本提案准备完成的伪造验收。

## Risks / Trade-offs

- 包名查询不等于取得发布权 → 首发前再次核查，冲突时确认 scope，bin 仍可为 nekomimi。
- 已有本机测试脚本依赖平台 → 改造临时路径、可执行入口与浏览器安装，逐平台记录结果。
- OIDC repo/workflow 配置匹配错误 → 文档列出精确字段，repository.url 与实际远端一致。
- 全局安装权限因 npm 配置而异 → 提供 Node/npm 安装与 prefix 排错，不把 sudo 作为默认安装方案。
- 发布后不可覆盖版本 → 预检查 tarball；失败与恢复过程记录实际 registry 状态。

## Migration Plan

此变更仅增补交付能力，用户数据无需迁移。准备阶段产出文档、配置、CI 和 dry-run 证据；用户另行要求后才推送并执行首发。撤回准备阶段可恢复工作流和元数据；已发布版本通过新版本修复。

## Open Questions

实施期间、首次远端写入前需提供实际 GitHub owner/repository、npm 发布账户与许可证选择。这些值不改变本提案的流程结构；缺失时保留发布门禁，不填写虚构元数据。Windows 作为未来验证范围，本次不承诺完整验收。

### 已确认发布输入

用户确认 GitHub 为 kirineko/nekomimi、npm 用户 kirinekoneko、MIT 许可证。当前 GitHub 登录为 kirineko；npm whoami 返回 E401，首发前需重新交互登录并确认账户。nekomimi 查询仍为 404，尚未实际占用或发布。
