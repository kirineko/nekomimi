# 首版发布准备验收

日期：2026-09-15。候选：nekomimi@0.1.0。平台：macOS arm64 / Node 24.15.0 / npm 11.12.1。

## 完成内容

- README 改为 npm 全局安装、进入项目目录、nekomimi web、设置 DeepSeek key 的用户路径；开发资料移至 development.md。
- MIT 许可证及 kirineko/nekomimi 仓库元数据；npm 账户由用户指定 kirinekoneko。未创建远端、未设置 remote、未 push、未发布。
- CI 覆盖 Linux/macOS，Release 工作流采用正式 Release 触发、OIDC、标签/版本/主线校验、同一 tarball 验收与发布。bootstrap 开关默认关闭，首发后设置。
- 临时目录使用 os.tmpdir，已安装包验收采用临时 global prefix 和独立 home。

## 本机证据

- npm ci --ignore-scripts：lockfile 一致，依赖安装通过。
- typecheck 通过；63 项测试通过；4 项浏览器用例通过。
- 发布门禁 7 项测试通过，覆盖版本、private、仓库、许可证及 registry 已有版本/权限/服务异常。
- npm 全局安装 tarball 验收通过：CLI 可执行、Web 静态资源可用、文件凭证保存、合成任务写 hello.txt、shell cwd、A/B 会话隔离、规范化路径和重启持久化、安装 CLI 与页面文件不变。
- 核心文件工具已有父路径及 symlink 越界回归通过；本次不修改执行边界。
- 安装后离线 HTML/bundle 导出导入、Web 提交与导出回归通过。
- npm publish --dry-run --ignore-scripts --access public 完成，仅 dry-run，无上传。
- 两份工作流 YAML 可解析；Actions v6 提交由官方仓库 git ls-remote 核实，固定 SHA；工具版本固定。
- OpenSpec 严格校验 13 项通过，git diff --check 通过。

## 尚待真实环境执行

- Linux/macOS GitHub Actions 尚未运行；Windows 不声明完整支持。
- npm whoami 返回 E401，需重新登录并确认 kirinekoneko；包名查询返回 404 不保证发布权限或未来可用性。
- 首版交互发布、registry 安装与首次后续 OIDC 发布均未执行，不将 dry-run 视作其成功证据。
- 实际发布按 releasing.md 执行；发布前须确认 CI 绿色，并移除 README 中首版尚未发布的提示。
