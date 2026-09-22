## Context

动机与范围见 proposal.md。本设计为规划，未交付实现。

当前 run() 每次创建 Agent，以 CoreTools.definitions() 固定生成工具，再组装提示词并直接构造 ResponsesProvider。tool.intent 位于内置工具包装内；contextView 从 Journal 投影协议历史；RecordedCall 已提供最终请求证据入口。Web 使用 HTTP 命令和 SSE 投影，已有单活动任务及 commandId 去重。仓库的 .agents/skills 属于开发流程，产品尚无 Skills/Rules 自动加载。

当前 npm 发布清单仅含 dist、README、LICENSE；文件工具拒绝工作区外路径。扩展开发文档不能只放源码仓库，也不能以扩大普通 read 的边界解决安装目录访问。

## Goals / Non-Goals

**Goals:**
- 在当前会话完成创建、校验、启用、实际调用、修改重载与重启复用；V1 将 Extensions、Skills、Rules、MCP 纳入同一管理面。
- 资源变化可解释，执行证据与展示独立；V2 增加资源种类或执行后端时不重写权威历史和浏览器协议。

**Non-Goals:**
- 不嵌入 Pi Coding Agent 的完整会话宿主，不提供 Pi 插件二进制/API 兼容承诺。
- 不在执行中的工具栈上替换代码；不把进程内可信扩展描述为沙箱；不在 V1 引入持久化工作流调度器。

## Decisions

### 1. 自有宿主与公开 SDK

保留现有 pi-agent-core 循环，在产品层实现 ResourceCatalog、ExtensionHost、ToolRegistry 和 MCP adapter（名称为设计概念）。增加 nekomimi/extensions 公共子路径，公开宿主自有的 JSON 数据契约和版本号，不泄露可写 Journal、Agent 对象或框架内部消息。

V1 SDK 支持工具/命令注册、beforeRun、beforeTool、afterTool、afterRun、dispose 钩子，命名空间状态，以及通过宿主提交后续提示、调用工具、模型调用和声明式 UI。钩子按稳定资源顺序及注册顺序执行；beforeTool 可拒绝但不可隐式重写参数；afterTool 只观察，不能覆盖原始执行证据。上下文贡献独立记录。后续提示受同一活动运行限制和预算，重载先等当前运行收尾。命令执行同样进入有持久化确认和取消的运行通道。

候选替代为整体复用 pi-coding-agent SDK；其 session/UI 约定与现有 Journal/Web 重叠，故不采用。底层接口兼容通过小型契约测试核验，不能从最新 Pi 文档推断 0.85.1 已支持全部行为。

### 2. 统一身份，保持资源类型独立

建议目录：项目 .nekomimi/extensions、.agents/skills、AGENTS.md、.nekomimi/mcp.json；用户 ~/.nekomimi/extensions、~/.agents/skills、~/.nekomimi/AGENTS.md、~/.nekomimi/mcp.json。仅显式配置的额外路径参与发现；不自动导入 ~/.pi 或其他产品配置。

ResourceDescriptor 包含 kind、逻辑 ID、来源 URI、作用域、版本、内容摘要、所需 SDK 能力及启用状态；身份包含来源，显示名称不是身份。相同逻辑名项目资源覆盖用户资源并显示被遮蔽项；同一作用域重名拒绝激活，不靠目录顺序决定。Rules 按目录链组合，不按名称覆盖。扩展工具/命令使用资源限定名；内置名称保留，V1 不允许隐式覆盖。命令可在唯一且不占用内置名称时提供 /review 等短名，出现歧义时要求限定名。技能短名仅在唯一时解析。

扩展以清单声明入口与包内资源边界，摘要覆盖包内源文件和依赖锁；V1 不自动安装依赖，缺失依赖报告诊断。对外部可变依赖不承诺可重现执行。资源源文件是下一次装配的输入；已保存的 ResourceSnapshot artifact 是历史证据，Journal 引用它并记录 activationId/revision。启停/信任配置是装配输入，不替代会话历史。

用户主动启用的用户扩展，以及显式授权的项目资源范围可持久记忆；项目中的可执行扩展和 MCP 启动/连接配置不因被检出就运行。界面展示授予范围与撤销入口，已覆盖的日常修改不重复询问，新增范围重新确认。Skills/Rules 文本不扩大执行授权。

### 3. 运行快照与分阶段重载

每个 run 绑定不可变资源 revision，包括扩展代码摘要、注册项、Skills 目录元数据、MCP 工具 schema。Rules 正文和 Skill 正文按实际加载时保存来源快照；每次模型请求拥有进一步的 context revision。

重载路径为发现、静态校验、构建候选注册表、等待空闲、切换活动 revision、清理旧资源。工厂只注册声明，不应启动定时器/网络/进程；副作用资源由有界的激活生命周期管理。候选失败不替换旧注册表；激活失败尝试恢复旧注册表并报告清理结果。无法清理的资源标记 degraded，拒绝继续运行而非假装切换成功。进程内任意副作用不能事务回滚，这一限制必须体现在诊断中。

重载命令及 Agent 请求返回 pending/activated/failed 状态；请求 pending 不阻塞当前工具等待自身 run 结束。下一轮对话使用新版本，不自动执行刚创建的命令。重启只加载有效且获授权资源，不恢复未决副作用。扩展状态写入 namespaced Journal entries，带 state schema version；内存缓存由记录恢复。版本不兼容时明确停用或显式迁移，不能静默重置。

### 4. 统一执行与模型入口

把 CoreTools 内的 intent/error 包装提升为所有宿主管理工具共用的执行边界；文件快照及 edit/write 的防覆盖逻辑保留在内置实现中。保存原始参数、资源 revision、调用关联、原始结果/完整 artifact、模型投影和 UI 数据；超限明确截断或失败，不能无限缓冲。后置处理不得修改原始证据。

扩展命令、钩子需要工具或模型时使用宿主服务，关联 session/run/resource；嵌套调用继续生成 toolCallId/modelCallId/attemptId，取消及总运行预算向下传播。扩展辅助模型调用复用当前 DeepSeek adapter 和 RecordedCall，使用独立上下文与 purpose，不污染主对话协议历史。V2 Provider 注册替换协议转换器，不替换证据 transport。

本地进程内可信扩展可以直接使用 Node API；这些外部行为不被宿主保证覆盖。官方示例和受支持 SDK 路径全部走宿主入口，UI 不声称掌握绕过入口的执行。强制约束任意代码属于 V2 隔离后端。

### 5. Skills、Rules 和只读资源访问

Skills 按 Agent Skills 格式解析 name/description，正文延迟加载；提供 /skill:<name> 确定性调用，模型按需调用受限资源读取接口。读取成功写 skill.loaded，保存正文 hash/artifact；重复读取可复用内容，但不能仅凭“曾加载”省略当前请求必需内容。

Rules 先装入用户规则和工作区根规则；针对 read/edit/write 等有明确目标路径的操作，解析工作区根至目标父目录的 AGENTS.md 链。更具体规则仅在对应路径适用，多个目标保留各自作用域。新规则出现或内容变化时，先记录并投影到下一次模型请求，再要求模型重发相关操作，不能让模型未读规则就执行修改。以工具边界检查 hash，避免持续 watcher 成为正确性前提。连续变化有界重试并报告冲突。

不试图静态分析任意 shell 脚本的所有目标文件；shell 使用已知 cwd 规则，跨目录规则解析提供显式宿主接口，并在文档明确此限制。规则是模型指导，不是文件 ACL。

新增只读资源访问入口，以目录清单内 resource ID 读取技能、规则和随包文档；拒绝任意路径、目录穿越及 symlink 越界。普通 read/write 的工作区边界不变。项目级扩展可由现有文件工具写入；用户级资源写入通过限定类型/名称的管理入口和已有授权范围完成，复用版本冲突检查与修改证据，不开放任意 home 写入。

### 6. MCP adapter

通过官方 SDK 公开接口实现 stdio 与 Streamable HTTP，固定实施时验证过的 SDK/协议组合；协议版本协商失败可诊断。支持 tools/list 分页、tools/call、工具列表变化通知，模型工具名包含稳定 server identity。schema 快照按 run 固定，通知只生成下一 revision；无法保真映射的 schema 停用该工具并解释原因。

保留 content、structuredContent、isError 和资源引用原始结构，模型投影受当前模型能力和体积限制。资源链接只展示引用，V1 不自动 fetch MCP resources。MCP 工具注解不是权限依据。stdio 将诊断 stderr 与协议 stdout 分离并限制大小；HTTP 认证由服务端凭证引用注入，取消自动重定向携带凭证的风险路径。

用户取消时发送协议取消（适用时）并停止调度；超时或断线后没有最终结果的调用标记 unknown，不自动重试 tools/call。传输关闭不等同远端副作用回滚。stdio 进程按运行平台清理；重连只恢复会话/工具发现，不重放未决调用。V1 支持无需认证或预配置凭证的 HTTP 服务，OAuth-only 服务明确报告未支持。

### 7. Web 插槽与交互协议

V1 仅提供状态、卡片和声明式表单，以带版本、resourceId、instanceId 的 JSON 贡献传输。数据与命令引用经服务端校验，不接受 HTML/脚本执行。表单回答具有 interactionId 和 commandId，支持幂等提交、取消、超时和断线后重连；浏览器关闭不默认为回答或取消。无交互客户端返回 interaction_unavailable，不能自动选择默认选项。

扩展管理展示发现/待授权/启用/被覆盖/待重载/失败状态与可定位诊断；重载收据可查询。原始工具结果和历史表单/卡片保存在 Journal/artifacts，移除插件后回放、导出、导入仍使用内置通用渲染，不执行插件。自定义命令、重载及表单回答沿用本地连接与 Origin 授权。

### 8. 自开发资料与验证

随包提供开发入口索引、SDK 类型、完整示例和版本清单，以资源 ID 读取。提示词只贡献简短开发资料索引，在用户提出定制时按需读取。CLI/宿主提供静态校验和显式试运行；静态阶段检查语法、清单、类型与可解析依赖，动态注册冲突由获授权的候选装配/试运行发现，不承诺静态推断任意工厂代码。执行扩展工厂的校验属于可信代码执行，必须与纯静态检查区分。试运行使用独立状态和 mock 工具/模型，不能宣称隔离任意 Node API。

代表性验收为 /review：读取 Git diff、应用自定义 Skill/目录 Rules、调用本地 fixture MCP 工具、展示审查卡片/表单。创建后启用、实际调用、修改重载、重启复用、停用撤销形成完整链路。CI 用确定性模型响应和 fixture server；真实模型另做产品演练并保留失败记录。

### 9. 两版演进契约

| 维度 | V1 必须完成 | V2 计划，另建 change |
| --- | --- | --- |
| SDK | 能力声明、版本拒绝、稳定资源 ID | Provider、额外事件与执行后端 |
| 工作流 | 命令、钩子、取消、命名空间状态 | 持久化调度、暂停恢复和事件触发 |
| UI | 声明式状态/卡片/表单及通用回退 | 自定义面板/renderer、构建与隔离、主题 |
| MCP | 两种 transport、tools 全链路 | resources/prompts/订阅、OAuth |
| 分发 | 本地清单、摘要、冲突与启停 | npm/git 安装、锁定、升级与兼容性 |
| 执行 | 可信本地代码，明确记录覆盖边界 | 独立进程或更强隔离，受限能力代理 |

V1 不添加空的 Provider/任意 UI API 冒充支持；通过 requiredCapabilities 返回明确不支持错误。V2 adapter 仍接入同一资源身份、执行关联和 artifact 契约；新增事件类型有版本且旧读者可通用显示。V2 不能绕开现有证据和回放规则。

进入 V2 的门槛：八份 delta specs 的正反向场景通过；安装包在最低 Node 版本通过；浏览器 /review 闭环、重载失败与清理、取消与 unknown、旧历史无插件查看验证完成；真实模型演练另有结果记录，不以 CI fixture 代替模型成功率结论。

## Risks / Trade-offs

- [进程内扩展阻塞或绕过记录] → 明确可信边界；宿主 API 限时与取消只约束合作代码；失效时提示重启，V2 再引入强隔离。
- [热重载泄漏监听器或子进程] → 注册句柄归属 revision、幂等 dispose、重复重载测试及清理失败状态；不宣称任意代码回滚。
- [动态规则引入重复模型请求] → 仅变化时注入，记录阻止执行的原因并设置有界重试；优先规则可见性。
- [远端工具取消不保证停止] → unknown 与取消请求分开，禁止自动重放；UI 保留检查远端状态的提示。
- [SDK/MCP 版本漂移] → 使用公开接口，固定经过最低 Node 和两种 transport 契约测试的版本；最新上游仅为研究资料。
- [范围较广] → 按 tasks 分阶段推进，但 V1 不因只完成资源注册就宣告自定制闭环完成。

## Migration Plan

1. 先落地兼容的证据字段、SDK 与资源目录，不自动迁移其他产品配置；无定制资源的项目保持原行为。
2. 内置工具迁移到共用执行包装后运行既有回归，再接入扩展、Skills/Rules、MCP 和 Web。
3. 通过安装包及端到端验收后开放功能。旧会话允许缺少 resource revision，显示为历史内置能力记录。
4. 回退通过禁用定制资源并重启服务完成，保留源文件、Journal 和 artifacts；不承诺旧二进制支持新交互命令，回退前结束活动运行。

## Implementation Notes

实施固定 Jiti 2.7.0、官方 MCP SDK 1.30.0、TypeScript 5.9.3 和 YAML 2.9.1；保留 pi 0.85.1。上限为 256 个资源/单服务工具、单文件 1 MiB、扩展包 8 MiB、工具结果 4 MiB、模型投影 24000 字符、每轮 128 次宿主操作。两种 Node 版本及 transport 的证据见 `docs/customization-v1-validation.md`。

## Resolved Questions

- TypeScript 加载器与 MCP SDK 已由 Node 22.19.0/24.15.0 契约和安装检查确认。
- 大结果 fixture 确认投影截断与完整 artifact 分离；证据超过上限明确标注缺口。

## References

- 本地依据：src/runtime.ts、src/tools.ts、src/context.ts、src/recorded-call.ts、src/shared/protocol.ts、test/context.test.ts、现有主规格及 spec.md。
- Pi 研究入口：https://pi.dev/docs/latest/extensions 、https://pi.dev/docs/latest/skills 、https://pi.dev/docs/latest/packages 。上游 latest 不作为本项目依赖版本契约。
- MCP 协议入口：https://modelcontextprotocol.io/specification/2025-11-25/basic/transports 、https://modelcontextprotocol.io/specification/2025-11-25/server/tools 。实施时核对 SDK 协商能力，保留不支持能力的明确诊断。
