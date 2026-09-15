# npm 发布手册

仓库：`kirineko/nekomimi`；npm 发布账户：`kirinekoneko`；许可证：MIT。

## 发布前准备

- 确认 GitHub owner/repository、npm 发布账户与许可证；package.json 的 repository.url 必须与真实 GitHub 仓库一致。
- 确认目标包名可发布。registry 返回 404 不代表已预留名称。
- 首版候选版本为 0.1.0；发布后同版本不能覆盖。
- Node 24.15.0，npm 11.12.1；README 中的全局安装命令在首版发布后可用。

## 首版

1. 完成元数据与 LICENSE；运行类型、测试、浏览器、全局安装包验收和 OpenSpec 校验。
2. 将已确认的仓库和版本标签推到 GitHub，等待标签的 Linux/macOS CI 全部通过。设置 remote 和 push 是实际发布操作，应按用户指令执行。
3. 在干净的首版标签提交上构建，使用 `npm pack --json --pack-destination <临时目录>` 生成 tarball。不要在 pack 后修改产物。
4. 用 `node scripts/pack-smoke.mjs <tarball绝对路径>` 验证同一个包。使用 `npm publish <tarball> --access public --dry-run` 查看清单，不上传。
5. 交互运行 `npm login`，按 npm 提示完成认证/2FA，然后显式运行 `npm publish <tarball> --access public`。密钥或 OTP 不写入仓库和聊天。
6. 用 `npm view nekomimi@0.1.0 dist --json` 比对 tarball 的 integrity，并在干净 prefix 中从 registry 安装验证。记录版本、提交、integrity 和结果。
7. 创建对应 GitHub Release。首次发布时 `NPM_TRUSTED_PUBLISHING_READY` 尚未设为 true，自动上传明确跳过，避免再次发布同版本。

## 配置后续自动发布

首个包存在后，进入 npm 包 Settings → Trusted Publisher：

- Provider：GitHub Actions。
- Organization or user：真实 GitHub owner。
- Repository：真实仓库名。
- Workflow filename：`publish.yml`，只填文件名。
- Allowed actions：允许直接 `npm publish`。

配置完成后在 GitHub 仓库 Actions variables 中将 `NPM_TRUSTED_PUBLISHING_READY` 设为 `true`。工作流使用 OIDC 短期身份，不配置 NPM_TOKEN；GitHub 托管 runner 是必要条件。公开仓库和公开包可自动附带 provenance。

## 后续版本

更新 package.json 和 lockfile 版本，提交并推送代码，再创建并推送指向该提交的 `vX.Y.Z` 标签。等待标签 CI 的 Linux/macOS × Node.js 22/24 四组检查通过后，再发布正式 GitHub Release。工作流检出标签，检查版本与 main 祖先关系、registry 版本是否存在、测试、构建和打包。对生成的同一 tarball 验证后上传。

普通分支 push/PR 不运行 GitHub Actions；仅推送 `v*` 标签触发 CI，正式 Release 触发发布流程。预发布和草稿不会执行正式上传。运行中的发布不会被新一轮自动取消。每次发布记录包版本、完整性信息与提交。

## 失败处理

- 测试、元数据、标签或授权失败：修复原因后重跑；不绕过门禁，不回退长期 token。
- registry 版本已存在：停止上传，核查版本与 integrity，不能覆盖同版本。
- 上传后断网或取消：先查询 registry。若已发布并且 integrity 相同，补记成功结果；否则调查，不盲目重复发布。
- 已发布版本有缺陷：发布新的修复版本，必要时显式 deprecate；不自动 unpublish。

本地 dry-run 不能证明 GitHub OIDC 发布成功。Linux/macOS 远端 CI、首版 registry 安装与第一次 OIDC 发版需分别记录真实结果。

## 官方参考

- [npm Trusted Publishing](https://docs.npmjs.com/trusted-publishers/)
- [npm trust 前置要求](https://docs.npmjs.com/cli/v11/commands/npm-trust/#prerequisites)
- [npm publish](https://docs.npmjs.com/cli/v11/commands/npm-publish/)
