# 平台能力与组合开发

统一使用 `ExtensionFactory`，当前清单 `sdkVersion:3`；协议数字用于兼容，不代表两套开发平台。

## 开发与能力包

`customization_candidate` 提供脚手架、写文件、完整 TypeScript 校验、独立模拟试验和请求激活。校验绑定内容 hash；授权后通过活动指针事务切换。工具不能替用户授予新权限。重载收据为 pending 时应结束当前任务，下一轮使用新版本。

`customization_package` / `nekomimi packages` 支持 prepare、inspect、activate、list、rollback、export、uninstall。源为 `{kind:"local",path}`、`{kind:"npm",name,version,registry}` 或 `{kind:"git",url,commit}`。npm tag 与 Git branch 解析后写入精确锁，依赖独立于宿主，不运行安装脚本或用户构建配置。导入导出使用本地 tgz；Rules 需重新绑定目标，凭证与状态不打包。

包的 `nekomimi.json` 声明 `manifestVersion:1`、name、version、`sdkVersion:3`、requiredCapabilities、dependencies、resources，以及额外公开 files。资源 kind 可为 extension、skill、rule、mcp、provider、workflow、panel；可执行入口均为 SDK 工厂，面板静态入口另由 registerPanel 声明。每个资源具有独立身份，同一包 revision 共享子进程。Rule 的 ruleScope 与安装时 bindings 共同决定目标。

`packages collect '{"scope":"project","discardCandidates":["候选 UUID"]}'` 只显式回收未引用缓存。安装历史、回退、剩余候选和工作流 Journal 引用均保留；不会删除用户会话、工作流或私有状态。

## Provider 与模型配置

`http-providers.ts` 演示 Responses / Chat Completions 的 JSON/SSE adapter。序列化与解析在扩展进程，实际 HTTP、密钥与 RecordedCall 在宿主。声明 model 的协议、historyCompatibility、上下文/输出预算及 tools/images/reasoning 能力；不要把不支持的能力静默降级。原始请求和响应是证据，canonical projection 只是投影。通用协议的工具调用必须用 toolEvidence 指向原始字段。

`providers save/select/credential` 或管理 API 配置 profile。work、create、compaction、session-title、handoff、classifier、image 分开选择；改变 create 选择不改变 work 或命名。当前新格式内尚未单独选择的 work/create/compaction/handoff 使用 main 默认项，session-title 使用 naming；extension 辅助聊天使用 auxiliary。显式运行 profile 仍是该次调用的覆盖。旧物理数据格式按准入规则拒绝，不自动迁移。凭证仅保存服务端引用；CLI 用 `--credential-file`，不要写入命令参数、扩展源码或面板 props。

model 的 operation 为 chat/classifier/image，省略表示 chat；同 provider/id 的不同 operation 是独立条目。profile 也记录 operation，错误类型不能作为聊天模型派发。credentialRequired=true 要求已配置凭证，未声明时该自定义 adapter 允许无凭证端点；内置 DeepSeek 始终需要凭证。容量未知或不适用用 0 表示，不虚构窗口。

普通 `model_catalog` 工具以及 SDK `ctx.callTool("model_catalog", {operation, offset, limit})` 只读返回类型化身份、能力、资料 ID、凭证状态与不可用原因，不启动工厂或模型。目录是快照，刷新不改写已捕获的调用定义。分类支持 `typesafe-system-one`，图片支持 `openrouter-images`；其它协议报告 `unsupported-operation-protocol`。这两个公开适配器均需要凭证，配置存在不等于操作已经可运行。

不兼容历史拒绝直接续跑；`branch <session> --output <new-directory> [--omit-reasoning]` 或 Web 分支入口明确转换，并保留原事件与 artifacts；未知工具结果不能被伪造成成功。

## MCP 内容与 OAuth

宿主使用 Pi MCP 1.0.4 的公开 stdio/Streamable HTTP client 与 transport；同一连接对象的并发 connect 共享初始化。分页、schema 校验、授权、凭证、内容角色和版本投影仍由宿主管理。JSON-RPC 错误保留 code/message/data；传输中断仍为 UNKNOWN，不自动重放 tools/call。stdio 仅继承受控基础环境与显式凭证映射，stderr 与协议流分离。

`mcp_content` 显式发现、读取资源/模板、获取 prompt、订阅和退订。返回值是带源 URI/参数/版本的非可信工具数据，不是 Skill，也不会提升为 system 指令。通知只标记需要刷新，不修改已发出的模型请求，不自动执行工具或下载资源链接。目录返回独立副本和固定 contentRevision；读取的原始响应另有 digest，显式重读可产生新内容，但不改写旧证据。宿主以 mcp.content.observed 记录操作、模式、目标及原始结果附件；实际上下文投影沿工具结果独立记录，读取不授予权限，也不会把正文复制到另一个模式或目标。

HTTP MCP 的 OAuth 配置为 `{issuer,clientId,scope?,redirectPort?}`，或者 `{issuer,dynamicRegistration:true,scope?,redirectPort?}`。只支持公开客户端、authorization code、S256；动态注册需要发现元数据中的同 issuer 注册端点。固定回调路径 `/oauth/callback`；注册过的静态客户端如限制端口可显式配置 redirectPort。服务/issuer/resource/client 绑定必须一致，不回退 implicit 或 client-secret。CLI `mcp-auth authorize <id>` 和 Web 打开授权 URL；tokens 私有存储，刷新串行，失败要求重新授权，断开不会自动重试工具。协议发现/PKCE/交换/刷新使用固定 Pi MCP 的公开 OAuth API，宿主保留端点验证与凭证锁。凭证按服务器 ID、URL、issuer、client 和配置绑定，同 URL 的不同服务器不混用账号。回调若包含 iss 必须匹配已授权 issuer；服务器要求 iss 时不得省略。业务取消允许已开始的刷新安全保存轮换结果，再阻止业务派发；显式断开使旧代调用不能返回刷新后的凭证。

## 持久工作流与工作区状态

`durable-review.ts` 演示 registerWorkflow、显式步骤与持久表单。每一步返回 next、wait 或 complete，只能转移到声明的步骤。wait 返回稳定交互身份，重启后仍可回答。ctx.ui(form) 仍是当前运行的临时表单，不具有持久等待语义。

每个工作流有独立 Journal，原会话只记录 workflow.reference。步骤意图先落盘；已有完成记录不重跑，意图后没有结果则为 unknown。必须核对外部效果，提交真实结果或明确授权新 attempt；不会自动重试或补偿。

`nekomimi workflows list|inspect|start|resume|answer|resolve|cancel|migrate|evidence|artifact` 使用 JSON 参数。Web 提供状态、证据、回答、恢复及 unknown 核对入口。恢复执行需显式操作；`recover` 只补投待办元数据。命令、工具完成和运行完成可触发工作流，队列最多 64 个未结束流程，因果链最多 8 层，同一链中不能再次触发同一定义；启动服务不会自动执行遗留待办。

ctx.workspaceState 使用 resourceId 命名空间和 schemaVersion、expectedRevision CAS。跨 Journal outbox 只补投状态，不重跑外部操作。`workflows state-get` 读取；`state-migrate` 显式提供 resourceId/key/fromSchemaVersion/schemaVersion/expectedRevision/value。迁移保留旧值证据，不兼容状态不会被自动清空。

## 面板、renderer 与主题

`panel-extension.ts` 与 `review-panel.ts` 演示 registerPanel 和浏览器 `PanelModule`。复制两份文件到同一资源目录，清单能力需 panels、commands、ui；panel.entry 是静态模块，默认导出 `{mount(root,context)}`。可以使用 DOM API，或在包内显式锁定 React 与其类型依赖后使用 TSX；构建不读取用户 tsconfig/插件/生命周期脚本。

propsSchema 校验结构化数据；基础面板 slot 为 sidebar-widget/tool-result，必须声明 contractVersion:3、modes 和 targetScope:"current"；更多运行时区域及整体主题见 runtime-ui.md，fallback 必填。renderer 可绑定工具名，接收 `{tool,args,result}`。使用 `ctx.ui({kind:"panel",title,panelId,props})` 记录独立结果面板；历史保存原始 props artifact、资源 revision、bundle hash 和文本回退，不依赖重新运行脚本。

面板运行于无同源身份的 sandbox iframe，独立 CSP 禁止直接连接、外部脚本、表单提交与子框架；父窗口验证消息 source、nonce、版本和实例，再使用 MessageChannel。工作流桥接动作为声明的 workflow.state/answer/cancel；运行时桥接另见 runtime-ui.md；服务端重新检查授权、活动版本及绑定工作流，answer 使用稳定 waitId、CAS 和幂等命令。回答不会隐式继续执行，使用宿主“继续”入口。

面板局部 theme 接受 background/foreground/accent/border 的十六进制颜色，作用于面板内部。宿主授权、关闭和取消控件不由扩展 CSS 控制。组件失败或缺失时显示 fallback 与结构化数据；历史页面需显式打开仍被授权的同 revision 面板，导入和离线 HTML 不执行包脚本。

浏览器 sandbox 阻止顶层导航，组件 CSP 拒绝直接网络访问。Node 扩展仍为可信代码。具体验证状态以安装版本的验证记录为准，预览成功不代表宿主端到端验收完成。

### 实验模型路由边界

当前构建仅派发明确的物理模型。模型定义、Provider profile 和宿主请求的 `routing` 可省略或设为 `"physical"`；其它值在登记、读取恢复配置或请求派发前拒绝，并提示重新选择物理模型。读取失败不改写原配置，不尝试其它 provider。模型目录标明 `routing: "physical"`。当前不提供 opt-in 自动路由入口，也不声称支持路由后的模型预算或路由费用计算。

### 分类和图片调用

使用 `model_classify({state, questions, profile?})` 和 `model_image({input, profile?})`。默认只解析对应 classifier/image 用途，未配置时明确失败；可显式指定同类型 profile。SDK 使用 `ctx.callTool("model_classify", args)`，Codemode 使用 `await tools.model_classify(args)`；两者与普通工具共用 schema、权限、取消及调用预算。

分类 question 支持 `{type:"choice",instructions,criteria:{候选:说明}}`、`{type:"score",instructions,criteria:[说明]}` 和 `{type:"bool",instructions,criteria:{true:说明,false:说明}}`，返回对应选择/分数/布尔概率。图片 input 为 text/image 内容数组，图片采用 base64 与 mimeType。返回内容和 details 中包含完整结果、独立附件及 modelCallId/attemptId 引用，不自动应用图片。

Provider 模型登记用 operation 区分类型，protocol 填上述公开协议；分类/图片使用宿主公开 Pi 适配器，不调用聊天 serialize/parse。profile.paths 相对 baseUrl，例如 `/systemone`、`/chat/completions`。每次派发前复核资源授权、profile 和凭证，未知终态不重试，不自动跨 provider 回退。模拟 trial 不发起这两类真实调用。

只有模型 attempt 计入用量，父工具/脚本没有额外 usage；缺失 token 或未核实价格为 null。错误 stopReason 返回工具错误与证据，取消后已有附件保留，但不会作为成功结果发布或触发下一轮模型请求。

### MCP 暴露策略与按需调用

服务器配置 `exposure` 可取 `direct`（默认）、`deferred`、`codemode`、`hidden`。direct 工具作为原生声明，激活时等待必要连接；deferred/codemode 后台连接，普通首轮不等待；hidden 不启动连接，也不通过发现/内容入口调用。

先从 resource_list 获取确切 server ID，再调用 `mcp_discover({server, offset?, limit?})`，返回固定 revision 和工具 items（id、name、description、inputSchema）。随后用 `mcp_call({server, tool: item.id, revision, args})` 调用。SDK 使用 ctx.callTool；Codemode 使用 tools.mcp_discover/tools.mcp_call。codemode 策略只允许脚本发起工具调用，发现不会授予权限。显式发现等待默认最多 5 秒且可取消；每次调用校验捕获 schema 与现时授权。

工具 ID 包含稳定服务器身份及原工具名的摘要，不从显示名手工拼接。分页不改变捕获版本；混用其它服务的 ID、过期 revision 或未发现就调用均拒绝。直接工具也采用同一稳定命名规则。工具声明不因通知原地改写，后续运行才采用更新列表。完整发现快照持久保存，恢复本身不连接或执行服务；首次使用恢复的工具前核对在线 schema/version，不符则要求显式重新发现。停用/hidden 服务不因历史快照重新启动。每次主请求准备记录 mcp.request.declarations，其附件包含实际 MCP 声明与发现版本。
