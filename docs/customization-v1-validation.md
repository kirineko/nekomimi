# 用户定制 V1 验收（2026-09-22）

对应归档变更 `2026-09-22-enable-user-customization-mvp`。实现包括本地 TS 扩展、Skills、分层 Rules、MCP tools、声明式 Web 贡献及随包开发资料。已于 2026-09-22 复验并归档，尚未发布；V2 能力不在本次交付中。

## 实现与规格映射

| Delta spec | 实现入口 | 验证证据 |
| --- | --- | --- |
| customization-resources | `resources.ts`、`host.ts` | `customization.test.ts`、`customization-failures.test.ts`：项目覆盖、同层冲突、授权与用户写入 CAS、路径/符号链接、坏候选保留、清理失败降级 |
| extension-runtime | `types.ts`、`execution.ts`、`run.ts` | SDK 版本/能力拒绝、公共示例加载、命名冲突、前后钩子、持久状态、结果上限、明确错误与 unknown 分离；原 tools/runtime/recovery 回归 |
| skill-rule-loading | `resources.ts`、`run.ts` | `customization-rules.test.ts` 与集成测试：显式 Skill 参数、按需正文、快照不偷换、删除报错、同级路径隔离、规则删除/连续变化、shell cwd 边界 |
| mcp-tool-integration | `mcp.ts`、共用执行包装 | `customization-mcp.test.ts`：stdio、HTTP JSON/SSE、分页、认证失败、stderr/凭证脱敏、schema 拒绝、列表更新、取消/断线 unknown、强杀不合作子进程 |
| web-customization | server routes、`Customization.tsx`、投影 | server/browser 测试：本地授权、重载失败诊断、撤销、表单去重及冲突、刷新恢复、超时/取消拒绝旧回答、脚本文本转义、插件删除后查看/导出/导入 |
| self-customization-workflow | CLI、`trial.ts`、`extension-docs` | 确定性模型通过 write 创建扩展和 Skill，校验、启用、使用 Rules/MCP、显示卡片、更新重载、重启恢复与停用；浏览器补充表单交互；干净 tarball 和真实模型演练单独验证 |
| prompt-context-provenance | `context.ts`、`CustomRun` | 资源 revision、Skill/Rule 正文 artifact、带作用域的指令、禁用撤销与旧记录保留；原 context/provider 回归 |
| model-call-evidence | `provider.ts`、现有 RecordedCall | 辅助调用 purpose/resource 关联、独立上下文、逐 attempt 重试、既有取消/脱敏/请求字节回归 |

资源快照保存当次源内容和 MCP server identity/schema。当前 run 的 Skill/扩展资料读取使用捕获内容，发现源已删除或路径越界时明确失败；Rules 是操作前重新检查的例外，每次变化单独记录并重新决策。扩展通过 SDK 的调用统一记录；直接 Node 操作不在强制审计范围内。

## 工具链与检查

固定版本：pi-agent-core/pi-ai 0.85.1；Jiti 2.7.0；官方 MCP SDK 1.30.0；TypeScript 5.9.3；YAML 2.9.1。以已安装包公开类型/入口及 Node 22.19.0/24.15.0 契约 fixture 核验；不依赖 Pi Coding Agent 内部扩展加载器。YAML 已从初选版本升级，修复 npm 官方审计报告中的深层嵌套问题。

- `npm run typecheck`：通过。
- `npm test`：24 个文件、132 项测试通过。
- `npm run test:browser`：14/14 通过；新增定制场景覆盖授权、表单、刷新、卡片、重载、错误和停用。
- `npm run test:release`：7/7 通过。
- `openspec validate --all --strict`：18/18 通过。
- SDK 示例额外使用 TypeScript strict + NodeNext 单文件类型检查，并在真实 Jiti 宿主注册检查。
- `npm run test:pack`：本地 tarball 的本地/全局安装、资料/SDK、TS 命令、stdio MCP、Web、历史导出/导入通过。验收不发布 npm。

一次完整并行测试使综合工作流超过原 15 秒限额；独立运行通过。该测试包含多次进程启动和持久化，调整为 30 秒后完整回归通过，未放宽单次生产 MCP/扩展超时。

## 平台与安装

本机 macOS arm64，Node.js 24.15.0；最低版本通过 npm 临时工具缓存运行 Node.js 22.19.0，没有替换用户默认 Node。

两版本均在临时目录安装 tarball：公共 `nekomimi/extensions` 入口、随包资料、Jiti TS 加载、命令、MCP 初始化/调用、全局 CLI、Web 静态资源/会话/命令/导出。两版本均用本地 HTTP/stdio fixture 验证 MCP；Chrome 浏览器全套在 Node 24 下验证。

Linux、Windows 本次没有原生环境，未实测其进程清理、路径和浏览器行为；不能将 macOS 成功等同跨平台已通过。最低 Node 下 Web HTTP 闭环通过，未另外重复 Chrome 全套。

## 真实模型演练

显式脚本 `scripts/customization-live-smoke.mjs` 使用现有本地配置，临时合成工作区，模型 `deepseek-flash`（服务端模型别名，未取得不可变后端版本），Node.js 24.15.0。密钥没有进入报告，真实账户不是 CI 前提。

第一次开放默认工具，模型忽略“不用 shell”的任务约束并过度探索实现：16 轮后耗尽预算，生成了文件但未完成校验。未将其算作成功。

第二次把测试工具明确限定为 read/write/edit 和资源工具，并补充返回值格式；21,103 ms、12 次 attempt。四步均 completed：修复预置的语法错误、执行 `/review` 读取合成文件并展示卡片、修改前缀并请求重载、再次执行得到 `UPDATED:` 前缀。共两张结果卡片。原始 Journal 与报告位于本机临时 `nekomimi-custom-live-Kv8yz5` 目录，不纳入版本库。

预置错误是故障注入，不是假称模型自然首次生成失败；真实首次演练的轮次失败另有记录。单次成功不代表统计成功率，也没有声称真实模型演练覆盖远端生产 MCP 或所有 SDK 能力。

## 边界与 V2 门槛

- V1 扩展为可信进程内 Node 代码。限时/取消约束合作的 SDK 调用，不能中断同步无限循环，也不能强制回滚直接 Node 副作用。清理失败进入 degraded，要求重启。
- MCP HTTP 的取消不能证明远端停止；缺失最终结果标为 unknown，不自动重发。资源链接只保存引用。
- 文件操作检查从根到目标目录的 Rules；shell 只应用 cwd 规则，不解析脚本的任意隐含目标。文件 CAS 不能抵抗恶意并发内核级替换。
- 静态校验检查清单、语法和导入，不是完整 TypeScript 语义检查；示例另行执行类型检查。试运行隔离宿主状态并模拟 SDK 服务，不是 OS 沙箱。
- 资源/SDK/UI 版本、身份、revision、artifact 和 RecordedCall 保留为 V2 接口。新增 Provider、持久工作流、自定义 React、MCP resources/prompts/OAuth、npm/git 分发、进程隔离须另建 change，不得绕过 Journal 或恢复规则。
- npm audit 剩余的两个 moderate 条目来自既有开发依赖 Vitest 4.1.9/@vitest/mocker；不是新增生产依赖，本次未扩展为测试工具链升级。

V1 的确定性、浏览器、最低 Node 安装及单独真实演练证据已建立。上述平台限制和可信代码边界仍有效；V2 仅进入后续 proposal，不自动开始实施。

## 最终验收结果

2026-09-22 最终构建：132/132 单元与集成测试、14/14 浏览器场景、7/7 发布检查、18/18 OpenSpec 校验通过；typecheck 和 SDK 示例 strict 类型检查通过。最终 tarball 在 Node 24.15.0 的 `harness-pack-4EwWBx`、Node 22.19.0 的 `harness-pack-HOgHAP` 临时目录完成本地及全局安装验证。最低 Node 的扩展/MCP/工作流专项为 12/12 通过。

35 项 V1 任务已完成。保留活动 change 供审阅，未执行提交、发布或归档。
