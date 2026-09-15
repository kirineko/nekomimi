# deepy-harness

基于 pi 低层 Agent 的 TypeScript headless 编程 Agent。第一版提供 DeepSeek Responses 调用、文件与 shell 工具、可恢复的 Journal，以及离线 HTML/诊断包。

## 开始使用

要求 Node.js 24 或更新版本；当前实测 macOS arm64 + Node 24。

```sh
npm ci
npm run build
# 在环境中设置 DEEPSEEK_API_KEY
node dist/cli.js run "检查当前项目并总结" --workspace . --session .harness/demo --json
node dist/cli.js resume .harness/demo "继续处理" --json
node dist/cli.js replay .harness/demo
node dist/cli.js export .harness/demo --format html --output session.html
node dist/cli.js export .harness/demo --format bundle --output session-bundle
node dist/cli.js inspect session-bundle
node dist/cli.js import session-bundle --output .harness/imported
```

`run/resume` 返回最终结构化结果；Ctrl-C 取消当前调用并等待 shell 停止。重复写入同一会话会返回冲突；进程崩溃后锁租约约 10 秒到期。

`--instructions <文件>` 显式传入项目指导，可重复；每次运行单独指定。`--tools read,edit,write` 限制启用工具；默认另含本机 shell。`--image <图片>` 提供图片输入。`--max-turns` 默认 32，`--max-output-tokens` 默认 4096；默认模型为 `deepseek-flash`。

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

实测结果、capability 对照及限制见 [应用验收报告](docs/implementation-validation.md)。Windows 的终止/目录持久化行为尚未实机验收；跨进程恶意文件替换不具备内核级原子 compare-and-swap 保证。长会话回放目前一次读取 Journal，不提供无限历史的常数内存保证。

## OpenSpec 与研究

- [原始研究](spec.md)
- [依赖与协议选型验证](docs/validation/2026-09-15/README.md)
- [核心提案（已归档）](openspec/changes/archive/2026-09-15-establish-observable-headless-core/proposal.md)
- [设计](openspec/changes/archive/2026-09-15-establish-observable-headless-core/design.md)
- [任务清单](openspec/changes/archive/2026-09-15-establish-observable-headless-core/tasks.md)

参考仓库保存在 gitignored 的 `reference/`。本版包含 headless 核心、本地 Web MVP 和可读执行追踪。TUI、MCP、Skills、压缩、子代理仍属后续范围。三个已完成变更已归档，能力契约见 `openspec/specs/`。

## Web MVP

```sh
npm ci
npm run build
npm run web -- --workspace /path/to/project
```

打开终端打印的本地入口。首次连接交换授权后地址中的令牌会清除；同源 HttpOnly 会话 cookie 支持刷新和新窗口，服务重启后重新打开终端入口即可。服务只监听回环地址，API key 保留在服务端。

界面提供会话列表、任务时间线、流式回复、工具参数/结果与文件 diff。点击“检查调用”可查看 Prompt、Context、Request、Response、Usage；上下文来源支持跳转到原始记录。任务可取消、在终态后继续。浏览器关闭或断线不取消已接受任务；重连只恢复显示。

单个工作区同一时间运行一个任务，其他会话仍可查看；第二个运行明确返回繁忙。会话位于工作区 `.harness/sessions/`；当前版本不自动导入其他目录的历史。无 API key 时仍能浏览历史。导出支持 HTML 和 tar 封装的诊断 bundle；解开 tar 后使用 `harness inspect <目录>` 检查。运行中需要等待停止后再导出。

```sh
npm run test:browser   # 本机 Chrome 的端到端测试
npm run test:web-live  # 显式联网的浏览器合成任务验收
```

开发时先以固定端口启动本地服务，再配置 `HARNESS_DEV_ORIGIN` 使用 `npm run dev:web` 的 API 代理；生产验收使用打包静态资源。同一工作区服务崩溃后需等待约 10 秒租约过期。

[Web 验收报告](docs/web-mvp-validation.md) · [源码模块说明](src/README.md)
