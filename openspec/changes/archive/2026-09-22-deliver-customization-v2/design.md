## Context

动机和交付范围见 proposal.md。当前 V1 已有 35/35 任务与 macOS 下 Node 22.19.0/24.15.0 的验收记录，但源码仍为工作区未提交变更，V1 规格尚未同步归档。这里描述的是拟实现设计，不能据此将 V2 标为已交付。

已确认的接入点：

- `customization/host.ts` 通过 Jiti 在主进程加载工厂，`deadline` 使用 Promise.race，不能中断同步阻塞；资源切换有候选与清理流程。
- `customization/run.ts` 把工具/命令/规则/技能/辅助模型汇合到运行中，但 `ctx.model` 直接构造 ResponsesProvider；状态仅从当前 session Journal 恢复。
- `customization/interactions.ts` 的等待对象在内存中；事件持久化不等于等待中的 JavaScript continuation 可恢复。
- `provider.ts` 固定 DeepSeek/Responses 模型描述，`recorded-call.ts` 已提供协议独立 HTTP 证据边界；配置只有单组 model/baseUrl/apiKey。
- `resources.ts` 管理本地目录、摘要、覆盖和授权，尚无包依赖锁；`trial.ts` 使用模拟服务，静态校验是 transpile 与导入检查。
- Web 已有管理、卡片与表单；发布包包含 SDK 和开发资料。CI 仅在 v* 标签触发，正式 Release 才触发上传，不能用普通 push 推断发布检查已运行。

## Goals / Non-Goals

**Goals:**

- 给模型一个明确、可修复的开发路径：需求 → 候选 → 类型/注册/契约检查 → 预览/试验 → 激活 → 使用 → 演进。
- 让包、运行、步骤、Provider、UI 实例都绑定不可变 revision，支持更新且不偷换活动行为。
- 以现有 Journal/RecordedCall 为事实入口，扩展执行域，不引入一套独立于证据的工作流事实库。
- V1 公共 SDK、旧会话和默认 DeepSeek 行为保持兼容；所有新增能力都进入干净安装和组合验收。

**Non-Goals:**

- 不提供系统级调度 daemon、分布式 exactly-once 或任意副作用自动回滚。
- 不以独立进程冒充权限沙箱；SDK 权限只强制约束宿主管理服务，可信 Node 代码的直接 OS 行为仍需明确说明。
- 不承诺所有供应商的专有历史能够互相转换；不直接把第三方组件加载到宿主 React/DOM。
- 不建设在线市场或自动发布服务。版本候选验证与公开上传是不同状态。

## Decisions

### 1. 用依赖分批交付，保持一个 V2 验收口径

第一批完成版本/进程/RPC 底座及开发和能力包；第二批实现 Provider、MCP；第三批实现持久工作流与 UI，最后统一验收。第一批含后续 API 的版本协商与协议边界，但不以空 API 标记后续能力可用。

不采用“一次重写运行时”：每批保留 V1 回归，新增逻辑通过明确接口接入。也不把尚未实现的已承诺能力推给 V3；跨平台或协议探针失败时，本 change 保持未完成并记录阻塞。

### 2. 资源身份、能力包与兼容

引入版本化包清单和锁：package identity、source identity、exact revision/integrity、SDK 范围、资源列表、入口、声明的宿主能力及依赖。逻辑资源身份与内容 revision 分离；同包更新保留身份，来源改变不能伪装成普通更新。V1 裸目录资源继续可用，由兼容层保存原 resourceId 和 state namespace，不强制改造成包。

包内资源复用 V1 的发现/覆盖算法。Rules 必须声明相对于安装项目的适用根和 glob/目录范围，绑定结果参与锁与上下文来源；默认不激活包内全局规则。Skills 与 MCP prompts 是不同资源类型，不能靠同名隐式替换。用户自有资源与包文件分开，卸载只移除包归属内容。

SDK 2 添加 Provider、流程、UI 注册与宿主能力声明；SDK 1 适配器保持既有 API 语义。包 manifest 与运行 RPC/UI 版本独立，避免一次 SDK 升级迫使所有历史读者升级。未知 requiredCapabilities 一律拒绝，不做部分注册。

备选是只给现有 extension.json 加任意字段；它不能清晰表达多资源归属、依赖和版本回退，因此不采用。

### 3. 候选内容、类型检查和安装事务

候选写入项目 `.nekomimi/candidates/<id>/`，构建/检查结果绑定完整内容摘要；激活使用不可变内容存储，不从可变源码路径临时导入。活动指针和锁通过带 revision 的原子提交切换，保留可恢复的提交意图与完成记录；启动时只修复元数据，不执行候选代码。预览与模拟试验不触及活动注册。

开发入口提供 SDK 目录/签名查询、脚手架、validate、trial、preview、activate、rollback；Agent 仍可使用普通文件工具编辑候选。诊断区分语法、类型、依赖、注册、权限和运行阶段，带位置和资源身份。完整类型检查用已固定 TypeScript compiler API 和随包 declarations，不运行用户 tsconfig 插件。检查 SDK 示例与生成工程都可在 tarball 环境完成。

npm 安装在独立包缓存中锁定依赖并忽略 lifecycle scripts；Git 获取明确 commit，不执行 hooks/submodules，不改变宿主 node_modules。归档解包先检查路径、链接、文件数、总大小和展开大小。远端包交付预构建资源或使用宿主支持的受控构建入口；需要任意自定义安装脚本的包明确不支持，不能在“校验”阶段暗中执行。

本地开发允许显式构建，但只读取规定配置数据，不自动加载包内可执行 bundler 配置。构建后的 JS/CSS/资源 hash 进入锁。失败清理 staging，锁与活动版本保持一致；垃圾回收不得删除仍被工作流/历史 artifact 引用的内容。

授权 UI 展示代码、依赖、端点、文件范围和宿主能力差异。既有范围内修订复用授权；扩大范围进入待授权。回退代码保留已发生效果，不自动回滚状态迁移。

### 4. 进程宿主与受记录 RPC

每个活动可执行包 revision 使用独立子进程，按单活动执行策略复用；V1 裸扩展按独立资源处理。工厂注册和静态模块执行发生在子进程，父进程仅接受经验证的注册描述。注册回调用 handler ID 表示，不能传递可变 Journal/Agent 对象。

RPC envelope 包含 protocolVersion、instanceId、package/resource/revision、runId、workflow/stepId（可选）、callId、sequence 与取消身份。父进程关联身份而不相信子进程自报权限。SDK tool/model/state/ui/contribute/followUp 经父进程执行，意图落盘后才允许效果，结果与 artifact 分离。stdout/stderr 与 RPC 通道分离；RPC 帧、队列、响应、日志都有限额，过载终止且保留证据缺口。

取消顺序：拒绝新调度 → 发取消 → 等待有限宽限 → 终止/强杀 → 确认退出 → 持久记录真实结果。进程死循环不能阻塞父进程。已有调用返回未知时保留 unknown；迟到消息只记录诊断，不覆盖新实例。平台进程树清理必须有原生测试，不能只用 Unix 假设实现 Windows。

原有进程内钩子无法成为故障隔离边界；worker thread 与主进程共享更多资源且不提供 OS 子进程生命周期，因此采用子进程。此方案没有限制可信代码直接使用 Node 文件/网络 API，权限说明必须准确。

### 5. Provider adapter 与协议保真

ProviderRegistry 管理 providerId、模型目录、adapter revision、历史兼容标识、能力声明和凭证引用。模型主循环依赖统一的运行 adapter 接口，而非直接构造 ResponsesProvider；原 DeepSeek 实现迁入默认 adapter，已有 parser 与工具 call ID 行为保留。

自定义 adapter 在扩展进程完成请求序列化及响应解析，宿主持有 endpoint 授权与认证信息，通过 RecordedCall 发送冻结的 JSON body，先记录接收块再按有界 ACK 流交给 parser。adapter 提供原始协议项与可供循环使用的投影；UI 文本永远不能代替原始历史。parser 异常或未知终态阻止工具执行。

V2 受支持 transport 为 HTTP JSON 请求和 JSON/SSE 响应；提供 Responses 与 Chat Completions 示例、工具循环 fixture 和能力矩阵。未知供应商专有语义通过扩展契约新增，不假装所有兼容 API 已通过。自定义任意二进制/WebSocket transport 不属于本次内置服务。

配置迁移到 provider profiles + credential references，旧配置映射到默认 DeepSeek profile。主会话、扩展调用和命名可选模型；内置搜索维持原独立 Messages adapter。运行固定选择和版本，后续配置修改只影响新调用边界。辅助调用上下文独立，工作流调用带 step 关联。

跨 Provider 继续先检查 history compatibility；无法证明可无损继续时，用户显式创建分支，把允许移交的文本/工具事实及其来源作为新输入，旧协议留在原 Journal，不伪造 reasoning。不给未知转换自动降级。

认证由父进程注入，子进程和前端只拿引用；授权绑定端点，重定向不自动转发密钥。可信扩展自行发送的非 SDK 请求仍不算受记录模型调用，文档不能宣称全面拦截。

### 6. 工作流是持久步骤定义，不序列化 JavaScript continuation

工作流注册声明稳定 definitionId/revision、输入 schema、具名步骤及转移。step handler 接收输入与宿主上下文；等待通过持久状态返回，后续显式 resume 调用对应步骤入口。不得靠重跑整个函数来寻找之前的 await。

工作流使用独立 Journal 保存 workflow/step/attempt/interaction 事件和完整调用证据；会话界面以引用投影呈现，不复制成另一份权威结果。工作区级状态另用串行 Journal，V1 state API 继续指向原会话命名空间。跨 Journal 通知使用持久 outbox + 确定性消息 ID 和消费者去重；不声称存在跨文件事务，未送达通知由记录补投且不等于重新执行步骤。

状态流：

```text
queued --> running --> waiting --> ready --> running --> completed
              |           |                     |
              v           v                     v
           unknown     cancelled               failed
              |
              v
       explicit resolution --> ready / cancelled
```

步骤意图先落盘，完成结果以 artifact 固定。恢复复用已完成结果，unknown 阻止继续，用户可核对外部事实并提交结果，或明确授权一个新的 attempt；它不是回滚，也不承诺外部 exactly-once。计时等待/任意 cron 不在此次范围；提供命令和服务存活期间运行/工具完成事件触发，因果深度和队列长度有界。

遵守现有工作区单活动执行：挂起工作流释放运行占用，待恢复排队；不同工作流的工作区状态写入经 revision/CAS 串行处理。服务重启加载待办状态，但不自动启动有副作用的任务。工作流等待的表单拥有持久身份，可跨重启回答；V1 临时表单保持原“运行取消即关闭”语义。

普通包升级不迁移挂起流程，固定旧 revision 直到流程结束；撤销权限立即阻止新的宿主操作，卸载不删除事实或偷偷继续旧代码。迁移定义/状态为显式命令，有版本检查、备份/转换证据及失败保持原状态。

### 7. MCP 内容和 OAuth

沿用官方 MCP SDK 和现有连接，按 server capabilities 开启 resources/list、templates、read、prompts/list/get 和资源订阅。入口保留命名空间，分页有重复游标和数量保护；文本、图片、二进制分别保存原始证据与有界模型投影，不默认展开链接。

资源读取和 prompt 获取生成带 URI/模板参数、服务器版本、MIME、hash 及注入角色的内容节点。远端角色只是原始输入属性，进入实际上下文时由宿主策略控制，不能覆盖授权。订阅只产生 invalidation/version 提示；当前模型调用和步骤不变，后续显式读取刷新。断线不自动重发工具副作用，退订/关闭走已有清理。

OAuth 首批支持符合固定 MCP SDK 能力的 HTTP authorization-code + PKCE 流程，含发现、资源绑定、静态客户端配置及可用时的注册，保存 refresh token 与授权元数据；不支持流程明确拒绝。回环回调必须绑定单次 state、服务实例、原服务与 issuer，过期/重放无效；发现、授权、token 端点及重定向按协议和可信目标策略验证。服务端凭证存储延用本地权限保护，配置/Journal/UI/包导出只保存引用，不声称抵御同 OS 用户读取。

必须用本地授权服务器覆盖 code、refresh、revocation/删除本地授权、重启及失败；在线生产服务只作独立兼容记录。实际 SDK 所支持的协议修订、注册流程在固定版本探针报告中记录，不用推测宣称兼容。

### 8. 自定义 UI 的隔离与回退

扩展提交 panel/renderer manifest、声明的插槽、静态入口、props schema、宿主动作及必填 fallback 文本/数据。受控构建输出自包含 JS/CSS 和静态资源，随 revision 锁定。主题使用验证过的 token allowlist，不允许全局任意 CSS 覆盖宿主取消/授权界面。

组件运行在 sandbox iframe，允许脚本但不开放同源身份；独立 CSP 限制连接、导航、表单和资源加载，宿主不把认证 token 交给 iframe。postMessage 初始化验证 event.source 与一次性 nonce，再使用绑定实例的 MessageChannel；不能信任 opaque origin 的 origin 字符串单独鉴权。包组件只能请求允许的桥接方法，宿主重验资源/运行/交互身份、schema、权限与幂等命令。

组件崩溃/超时显示 fallback 并允许重建，宿主仍可取消。实时面板可绑定工作流等待；回答成功以持久事件回传为准，前端不维护另一份执行状态。历史默认展示保存的结构化数据与声明式回退；需要交互重现时是显式激活可信版本的新客户端行为，离线导出和导入绝不运行扩展组件。

直接注册 React component 到宿主 bundle 更简单，但会取得宿主 DOM/会话权限且难以独立卸载，因此不采用。

### 9. 验收矩阵与版本交付

| 原始需求 | 必须实际验证的结果 |
| --- | --- |
| command/tool | 对话生成 /review 和检查工具，类型/注册错误修复后通过宿主读取 Git diff 并实际调用 |
| skills/rules | 生成检查 Skill，目录规则按目标生效；停用/更新后指导与历史分离 |
| provider | 对话创建 adapter，在可选目录选中，至少一轮工具调用与响应完成，证据可追溯 |
| workflow | 审查分步骤运行，等待用户时重启，恢复不重做已完成步骤；unknown 必须人工核对 |
| UI tweak | 对话生成筛选/确认面板和主题 token，预览/实际展示，脚本隔离与离线回退 |
| MCP | 使用工具、资源、prompt 与本地 OAuth 服务；通知变化不偷换活动输入 |
| packaging | 分享审查包到第二个干净项目，重绑作用域/凭证，升级/回退/卸载无历史损坏 |

确定性模型负责逐步生成文件及验证所有失败路径，本地 HTTP/MCP/OAuth fixture 不依赖账户；浏览器覆盖完整交互和刷新。真实模型演练分别记录首次生成、修复及实际使用，至少覆盖上述五类原始定制目标；本地协议服务可用于无第三方账户的 adapter 演练，但必须标明模拟远端，不冒充真实供应商成功率。

最终候选建议 0.2.0，实施时核查 registry 后确定；文档、types、示例、SDK 清单与 tarball 一致。macOS/Linux × Node 22.19.0/24.15.0、Windows 最低 Node 原生安装与扩展/MCP 清理、Web 冒烟为发布候选门槛；没有平台环境时保留未完成，不能沿用 V1 的未验证限制宣布全部通过。

交付包括候选 tarball、integrity、版本、工作区/提交标识、迁移/发布说明和验收报告。普通分支不自动跑 Actions，因此实施需取得实际平台运行证据；若只能用现有标签 CI，应在用户明确发版后完成相应门禁，之前称本地候选而非跨平台已验证版本。正式 Release 必须在标签 CI 通过之后创建；此次规划不执行 push/tag/发布。

## Risks / Trade-offs

- [SDK 2 和进程切换改变时序] → V1 fixture 与重载/取消竞态回归；兼容层保留原 ID 与状态语义，不静默迁移任意第三方私有对象。
- [包更新与跨 Journal 恢复不具原子性] → 不可变内容、提交意图、活动指针和去重 outbox；逐个崩溃窗口测试，只补投记录不重放效果。
- [可信进程直接绕过 SDK] → 凭证不注入子进程，宿主动作受授权；明确直接 Node 行为的边界，不宣称 OS 沙箱。
- [跨协议投影丢失语义] → adapter fixture、原始证据、能力检查和显式分支；不以 UI 文本重建供应商历史。
- [持久流程与卸载产生悬挂引用] → revision pin 与引用计数；撤权优先，挂起流程可取消或显式迁移。
- [OAuth/iframe 平台细节] → 固定依赖探针、恶意回调/消息测试、真实浏览器验证；失败不回退到不受控授权或宿主脚本执行。
- [自定制成功率不足] → 比 V1 更明确的脚手架/类型诊断/候选工具；保存真实失败，不能用单次成功推断统计可靠性。
- [范围和平台成本] → 三批各自有门槛，但十一份规格的组合验收才表示 V2 完成；公开市场和 OS 沙箱明确不在范围内。

## Migration Plan

1. 复验 V1 并同步/归档其已交付规格，保留已有未提交源码，不覆盖用户修改。本 V2 delta 对两个主规格保留 V1 新增场景，避免归档时丢失。
2. 增加版本化协议/存储及 SDK 1 兼容层，以 fixture 验证旧 Journal、settings/auth 和裸扩展。配置迁移备份并原子提交，失败不破坏原文件。
3. 先上线进程与候选/包路径，再接入 Provider/MCP，最后接入工作流/UI；每批运行相关 V1/V2 回归。未实现 capability 不对外宣称可用。
4. 默认保留 DeepSeek profile、现有裸资源和历史读取；新权限、新端点和包来源独立授权。暂停流程在升级时固定原 revision。
5. 全部验收后同步/归档 V2，构建并核验同一候选包。用户要求公开发版时依照既有发布门禁执行并核验 registry，不能把打包成功当作上传成功。
6. 回退先停止活动执行、保留 Journal/包内容/配置备份；旧二进制只使用兼容配置和 V1 项目。新工作流/状态若不兼容旧版本则保持只读或用新版恢复，不自动倒写旧 schema。

## Open Questions

- 候选最终 npm 版本号在实施交付时按 registry 占用情况确认，0.2.0 仅为规划默认值。
- 前端受控打包器的具体固定版本、官方 MCP SDK 对授权元数据/注册的实际支持修订，需要在指定 Node/平台探针中确认。选择不得改变 iframe 隔离、PKCE/资源绑定或无安装脚本的契约；若公开依赖不能满足，应报告阻塞而非缩减范围。

## 本轮交付范围调整（2026-09-22）

用户明确要求“暂不验证 Linux、Windows”。本轮交付 macOS / Node 22.19.0、24.15.0 验证的 0.2.0 本地候选，不宣称 Linux、Windows 已通过。原跨平台门槛和公开发布 CI 保留；对应原生验证、全平台候选核验和最终归档暂不完成，不把延期记为通过。
