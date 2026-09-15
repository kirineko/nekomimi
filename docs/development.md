# Nekomimi 开发与高级用法

基于 pi 低层 Agent 的 TypeScript headless 编程 Agent。第一版提供 DeepSeek Responses 调用、文件与 shell 工具、可恢复的 Journal，以及离线 HTML/诊断包。

## 开始使用

要求 Node.js 24 或更新版本；当前实测 macOS arm64 + Node 24。

```sh
npm ci
npm run build
node dist/cli.js config
node dist/cli.js web --workspace .
# 安装包的命令为 nekomimi；源码运行使用 node dist/cli.js
node dist/cli.js run "检查当前项目并总结" --workspace . --json
# 使用命令输出中的会话目录继续、检查或导出
node dist/cli.js resume /path/to/session "继续处理" --json
node dist/cli.js export /path/to/session --format html --output session.html
node dist/cli.js export /path/to/session --format bundle --output session-bundle
node dist/cli.js inspect session-bundle

```

`run/resume` 返回最终结构化结果；Ctrl-C 取消当前调用并等待 shell 停止。重复写入同一会话会返回冲突；进程崩溃后锁租约约 10 秒到期。

`--instructions <文件>` 显式传入项目指导，可重复；每次运行单独指定。`--tools read,edit,write` 限制启用工具；默认另含本机 shell 和启用的 `web_search`。`--image <图片>` 提供图片输入。`--max-turns` 默认 32，`--max-output-tokens` 默认 4096；默认模型为 `deepseek-flash`。

文件工具限制在工作区内，修改既有文件前必须读取，外部修改后需重读；edit 仅支持精确匹配。Shell 使用本机权限执行，并不提供操作系统沙箱。默认 Unix 使用 bash（缺失时 sh），Windows 分支使用 PowerShell。

## 证据与恢复

- Journal 是唯一权威历史。上下文 revision、原始 response items、实际请求字节/hash、逐次 attempt、原始 SSE、工具参数与结果分别留存。
- 工具和请求启动前强制落盘；流事件按 100ms 或 64KiB 批量刷盘，附件先于引用落盘。`durableSeq` 表示确认持久化范围，定时阈值不等于延迟保证。
- 文件附件默认上限 32MiB、shell 输出 64MiB；响应上限 16MiB/10,000 个 SSE 事件，请求上限 32MiB。超限显式失败。慢存储对流读取施加背压，显示订阅只保留最新进度。
- 恢复隔离尾部不完整记录，报告未知工具结果，不自动重做操作；仅显式 `resume` 发出新请求。回放、导入、导出均不调用模型或执行工具。
- 完整诊断包包含任务内容，可校验后导入。`--redact <文本>` 生成不可继续的删减包；HTML 默认是转义后的离线阅读视图。脱敏并非自动发现所有隐私内容，分享前应指定需要删除的文本并检查副本。

## 验证

```sh
npm run typecheck
npm test
npm run test:live  # 显式联网；有凭证时仅处理临时合成文件
npm run test:pack  # 临时目录安装本地 tarball，不发布
openspec validate --all --strict
```

实测结果、capability 对照及限制见 [应用验收报告](implementation-validation.md)。Windows 的终止/目录持久化行为尚未实机验收；跨进程恶意文件替换不具备内核级原子 compare-and-swap 保证。长会话回放目前一次读取 Journal，不提供无限历史的常数内存保证。

## OpenSpec 与研究

- [原始研究](../spec.md)
- [依赖与协议选型验证](validation/2026-09-15/README.md)
- [核心提案（已归档）](../openspec/changes/archive/2026-09-15-establish-observable-headless-core/proposal.md)
- [设计](../openspec/changes/archive/2026-09-15-establish-observable-headless-core/design.md)
- [任务清单](../openspec/changes/archive/2026-09-15-establish-observable-headless-core/tasks.md)

参考仓库保存在 gitignored 的 `reference/`。本版包含 headless 核心、本地 Web MVP 和可读执行追踪。TUI、MCP、Skills、压缩、子代理仍属后续范围。三个已完成变更已归档，能力契约见 `openspec/specs/`。

## Web MVP

```sh
npm ci
npm run build
npm run web -- --workspace /path/to/project
```

打开终端打印的本地入口。首次连接交换授权后地址中的令牌会清除；同源 HttpOnly 会话 cookie 支持刷新和新窗口，服务重启后重新打开终端入口即可。服务只监听回环地址，API key 保留在服务端。

界面提供会话列表、任务时间线、流式回复、工具参数/结果与文件 diff。点击调用卡片可查看总览、指令、输入、请求和响应；上下文来源支持跳转到原始记录。任务可取消、在终态后继续。浏览器关闭或断线不取消已接受任务；重连只恢复显示。

单个工作区同一时间运行一个任务，其他会话仍可查看；第二个运行明确返回繁忙。CLI 与 Web 共用 `~/.nekomimi/workspaces/<工作区摘要>/sessions/`。旧 `.harness/sessions/` 和 `~/.deepy-harness/sessions/` 可通过 `nekomimi migrate --execute` 显式复制迁移，原件保留。无 API key 时仍能浏览历史。导出支持 HTML 和 tar 封装的诊断 bundle；解开 tar 后使用 `nekomimi inspect <目录>` 检查。运行中需要等待停止后再导出。

```sh
npm run test:browser   # 本机 Chrome 的端到端测试
npm run test:web-live  # 显式联网的浏览器合成任务验收
```

开发时先以固定端口启动本地服务，端口为 3000，使用 `npm run dev:web` 的 API 代理；生产验收使用打包静态资源。同一工作区服务崩溃后需等待约 10 秒租约过期。

[Web 验收报告](web-mvp-validation.md) · [源码模块说明](../src/README.md)

## 仓库目录

| 路径 | 内容 |
| --- | --- |
| `src/` | 核心运行时、服务端、协议、投影和 Web 组件，详见源码模块说明 |
| `test/` | 单元、集成与浏览器回归测试 |
| `scripts/` | 显式运行的真实调用及安装包验证脚本 |
| `docs/` | [文字文档与验收索引](README.md)，含历史协议研究数据 |
| `openspec/specs/` | 已交付能力契约 |
| `openspec/changes/` | 活动变更及 `archive/` 历史归档 |
| `reference/` | 本地参考仓库，不纳入版本控制 |

`dist/`、`node_modules/`、`test-results/`、`playwright-report/` 和 `.harness/` 为本地生成目录。截图放在测试产物或系统临时目录；仓库保留文字验收结论。

## 配置与会话管理

品牌与安装命令已更名为 Nekomimi / `nekomimi`。设置和凭证分别保存在 `~/.nekomimi/settings.json`、`auth.json`，不读取 API key 环境变量或 dotenv。启动后可从侧栏“设置”保存、替换或清除密钥；已保存的密钥不回显。CLI 使用 `nekomimi config`，`--home <目录>` 显式隔离配置和数据。文件凭证使用本地用户权限保护，不提供同用户 shell 隔离。

Enter 发送，Shift+Enter 换行，中文选词不触发发送。首条消息提供临时标题，首轮成功后自动命名一次；命名记录作为辅助调用独立可查。会话右侧删除入口只清理会话日志与附件，保留工作区文件；请先停止运行或命名、等待下载结束。

CLI 迁移预览：`nekomimi migrate --workspace <目录>`；确认复制：加 `--execute`。迁移校验日志和附件，不执行模型或工具，不覆盖冲突。配置变更用于下一次运行，当前运行使用捕获的设置。


## 工作台升级：搜索、文件与差异

- `src/recorded-call.ts` 是主 Responses、自动命名和搜索 Messages 共用的请求/响应记录入口。搜索调用以 runId/toolCallId/modelCallId/attemptId 关联；搜索内部协议不进入主 Responses 历史。
- `settings.json` 可选 `search` 字段包含 `enabled`、`model`、`baseUrl`。旧配置缺省启用；默认 `deepseek-flash`、`https://api.deepseek.com/anthropic/v1`。与主模型地址独立，共用服务端凭证；Web 设置只提供启用开关，切换后下一任务生效。
- 搜索默认 60 秒、4096 输出 token、最多 3 次服务端搜索、2MiB 响应、10 条来源；单次网络尝试，无自动重试。未知 usage 不按零计算。
- `GET /api/v1/workspace/files` 支持 path、hidden、cursor；`POST /api/v1/workspace/open` 接收 path。沿用授权、来源与 Host 校验，拒绝工作区外路径与特殊文件。默认程序运行于服务端所在机器。
- `GET /api/v1/sessions/:id/changes` 按 offset 加载已确认 edit/write；`GET /api/v1/sessions/:id/diff/:hash` 按 offset/limit 返回历史 patch 的差异行。单页最多 500 行，单行展示最多 4000 字符，完整内容保留在附件。
- 浏览文件不注入模型上下文；导入、回放和导出不触发搜索或默认程序打开。文件树展示当前磁盘，diff 展示历史证据，两者独立。
- `node scripts/search-live-smoke.mjs` 显式联网做最小搜索实测，只写脱敏证据。浏览器回归使用模拟 provider 和打开器，不需要凭证或真实桌面程序。

本次验收见 [工作台升级验收记录](validation/workbench-upgrade/README.md)。Linux/Windows 原生默认程序打开尚待真实桌面环境验证。


## 历史网页读取记录

当前版本已移除 web_fetch 工具及其抓取和代理配置。网页搜索仍由 web_search 提供。旧会话中的 fetch 事件、来源、状态和已保存 artifact 继续只读展示、导出和导入；不会重新抓取或检测系统代理。
