# 本地 Web MVP 验收

日期：2026-09-15。变更：`add-local-web-mvp`。本报告记录应用实现与验证，不以提案完成替代功能完成。

## 模块结构

新增 `src/shared/`（协议）、`src/server/`（HTTP/授权、会话调度、增量读取、SSE、证据下载）、`src/projection/`（可重建展示投影）、`src/web/`（API、会话 hook 和独立组件）。Node 核心不导入 React，浏览器不导入文件系统或模型 SDK。完整边界见 `src/README.md`。

沿用 React/Vite 选型，锁定 React 19.3.0、Vite 8.3.0。Vite 官方要求 Node 20.19+/22.12+，本机 Node 24.15.0 满足要求；参考 [Vite guide](https://vite.dev/guide/) 与 [React versions](https://react.dev/versions)。锁文件干净安装通过，构建分别检查 Node 和浏览器类型。

## 验收结果

- 44 项 Vitest 测试全部通过。
- 3 项 Chrome 端到端测试全部通过，包含断网与 250 条历史窗口验收。
- 类型检查、Node/Web 构建和 OpenSpec 严格校验通过。
- 真实浏览器模型链路通过；干净安装包验证通过。

## 验收覆盖

| Capability | 验证方式 |
| --- | --- |
| local-web-service | HTTP 协议校验、Host/Origin/令牌、HttpOnly cookie 刷新授权、缺密钥提交拒绝、commandId 去重/冲突、跨会话繁忙与旧 runId 取消隔离、根租约和工作区范围 |
| web-session-stream | 增量水位读取、快照后补读、无效游标 reset、拆分 SSE 投影重建、慢消费者断开、长历史分页、真实 SIGKILL 后原命令不重做 |
| web-task-workbench | Chrome 页面新建/提交、真实文件工具 fixture、diff、终态后继续、刷新/双窗口、断网重连、窄窗口取消、纯文本恶意 HTML 隔离 |
| web-evidence-inspector | 从实际请求打开 Context 来源并跳转事件、按 attempt 检查原始证据、分页附件和完整性失败、HTML 下载与源记录不变、安装包下载验收 |

测试文件：`test/server.test.ts`、`test/stream-projection.test.ts`、`test/cli.test.ts`、`test/browser/workbench.spec.ts`，以及前序核心测试。浏览器测试使用本机 Google Chrome，不依赖外部托管页面。断网测试曾发现已有本地 SSE 连接不会即时关闭，现已显式监听浏览器 offline 事件并按游标重连。Unix 强制终止测试在文件已经修改、结果记录尚未完成时杀死子进程，然后重启服务、重发 commandId，验证文件仍只有一次写入且未产生新模型请求。

## 真实浏览器链路

显式执行 `npm run test:web-live`，浏览器提交一个合成任务到本地服务，再经过原有 pi Agent/DeepSeek Responses 入口调用 write。工作区 `/private/tmp/harness-web-live-0U6c8C`，生成 greeting.txt 内容与预期逐字相同。

两次真实请求均为 HTTP 200 / completed，耗时约 1143ms、902ms；随后在浏览器打开 Request 与 Context，检查来源链接并截图。没有向模型发送项目源码，密钥只留在服务端。脚本无凭证时明确输出 SKIPPED，不以旧 headless 测试替代。

## 安装包

`npm run test:pack` 将 tarball 安装到干净临时目录，验证公开入口、CLI、离线导出/导入，以及安装后的 Web HTML/JS 静态资源、HTTP 合成任务、证据导出。最终安装目录为 `/private/tmp/harness-pack-GZxgIa`。没有发布。

## 设计落地细节

- URL fragment 的临时令牌交换为 HttpOnly、SameSite=Strict 会话 cookie，地址片段立即清除；因此刷新和同源新窗口可继续浏览，无需把令牌写入脚本存储。服务重启重新授权。此细节已同步 design.md。
- 命令确认在同一 Journal 写锁下持久化；HTTP 连接断开不结束任务。相同命令重发读取已存在 receipt，未知结果不会被自动执行。
- Context 来源使用独立分页索引，避免原始 manifest 超过附件单页时失去来源导航。
- 前端保留至多 180 条时间线记录，支持更早分页和回到最新；服务器缓存最多 32 个会话投影。单个会话索引内存随历史增长，不宣称无限历史常数内存。
- 慢 SSE 客户端受 2MiB 发送上限约束，重连从持久化游标补读；积压过大时明确重新加载快照，历史仍可分页读取。
- 单工作区最多一个活动运行，没有隐式任务队列。HTML/bundle 仅终态会话导出；tar 包解开后可使用既有 CLI inspect/import。

## 平台和限制

实测 macOS arm64、Node 24、Google Chrome。Windows PowerShell、tar 和目录同步语义未实机验收；其平台限制沿用核心报告。Shell 仍是本机权限执行，Web 授权不是 OS 沙箱。

会话仅枚举当前工作区 `.harness/sessions/`；不提供任意路径历史导入或文件编辑器。模型价格未验证，界面只展示 provider usage/缓存/延迟并注明费用未提供。完整导出包含任务原文；显式脱敏副本不可精确继续。

运行命令见 README。核心与 Web MVP 变更已于 2026-09-15 按用户要求归档。
