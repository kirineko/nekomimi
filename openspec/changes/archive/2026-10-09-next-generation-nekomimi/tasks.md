## 1. 批次 0：冻结基线与验证选型

本清单按验证证据更新，仅在实际完成后勾选。批次0已完成，保留历史失败记录；当前89/89。详见`docs/validation/next-generation-nekomimi/batch-zero-conclusion.md`和各能力证据目录。没有进行真实模型质量验收。

**Apply 检查点**：用户已要求以Durable为目标修订规格并实施，且已批准高对比明暗样稿。生产目标为Durable1.0.4公开Storage/Harness与产品唯一Journal，原自动回退Agent路线撤销。1.4七项有界准入通过并完成1.10结论与规格映射，生产迁移已完成；正式 CLI/Web 运行入口已切换 Harness，第 11 组最终兼容与回归已完成，完整证据及残余风险见 `docs/validation/next-generation-nekomimi/completion.md`。

覆盖：`pi-platform-integration`、`execution-journal`、`model-call-evidence`、`codemode-execution`、`mcp-tool-integration`、`web-design-system`。参见 design D1–D2、D7–D10。

- [x] 1.1 保存当前主干构建、类型检查、单元测试和浏览器基线及环境；验证：记录 `npm run typecheck`、`npm test`、`npm run test:browser` 的实际退出码、失败项及 fixture 版本，不改断言掩盖失败。证据：`docs/validation/next-generation-nekomimi/baseline/README.md` 及 manifest/log；首次退出码依次为 0/1/0；失败文件单跑及原默认并发全套复跑均通过，首次超时根因仍未确认。
- [x] 1.2 核验 1.0.4 相关包的官方 registry 元数据、exports、类型、tarball 与 worker/WASM 资产；验证：查询显式使用官方 registry，独立临时消费项目可在最低支持 Node 导入，不能依赖 reference 或源码 alias。证据：`docs/validation/next-generation-nekomimi/pi-packages/README.md`；macOS arm64 上 Node 22.19.0/24.15.0 导入与 VM 通过，项目既有类型选项通过，完整依赖声明检查的 optional peer 缺失已记录。
- [x] 1.3 构建低层 Agent 公开接口验证切片，覆盖 prepareRequest/finishTurn、首轮与工具续轮、最大轮数、error/aborted 硬退出；验证：假 Provider 捕获每次 body 并对照持久请求，取消后无额外请求和工具。证据：`docs/validation/next-generation-nekomimi/agent/README.md`，首次两种 Node 均 8/11，保留失败；经用户确认加入显式取消门禁后均 11/11，通过实际 loopback body 与 fsync 请求证据对照。
- [x] 1.4 构建 Durable Journal Storage 唯一提交与恢复门禁切片；验证：公开MemoryStorage.prepareCommit批次到唯一Journal与重建；七项D2证据完成，包括实际HTTP逐attempt/body/hash、固定上下文、原始流背压、真实SIGKILL unknown不重跑、工具意图四类I/O失败零副作用、可靠订阅水位与历史分支重建。Node22.19.0/24.15.0通过，源码定向28项通过；证据：`docs/validation/next-generation-nekomimi/durable/admission-manifest.json`与`journal-adaptation.md`。这是生产迁移准入，不宣称CLI/Web或Linux已交付。
- [x] 1.4.1 将Journal Storage切片落实为类型化源码模块；验证：`test/durable-journal-storage.test.ts`12项通过，涵盖原子批次、历史文档、并发输入分离、关闭排空、写入失败、凭证拒绝、旧格式保护、附件缺失与写入租约；类型检查通过。代码：`src/pi/journal-storage.ts`。
- [x] 1.4.2 将只读观察和显式恢复门禁落实为源码模块；验证：`test/durable-recovery.test.ts`7项通过，实际编译模块在Node22.19.0/24.15.0的Harness崩溃夹具各5项通过，旧排队输入撤回、unknown不重跑，未验证自定义任务在派发前拒绝。代码：`src/pi/recovery.ts`；证据：`docs/validation/next-generation-nekomimi/durable/production-runs.json`。父任务1.4现有独立七项证据；两个子项不替代其完整验收。
- [x] 1.5 验证 Codemode 注入统一执行管线的可行性；验证：直接/嵌套调用各只有一次授权检查、intent 和结果记录，脚本失败不丢成功子调用，打包环境中可启动 VM。证据：`docs/validation/next-generation-nekomimi/codemode/README.md`，独立tarball两种Node各8/8。
- [x] 1.6 验证 Pi MCP 对 tools、resources、prompts、订阅、OAuth 的公开覆盖；验证：本地 stdio/HTTP 夹具逐项运行，输出复用/保留当前 adapter/不可支持矩阵，不能仅用工具搜索成功证明全部支持。证据：`docs/validation/next-generation-nekomimi/mcp/README.md`，两种Node各4项综合测试及保留适配矩阵。
- [x] 1.7 验证统一模型目录中 chat/classifier/image 的捕获入口；验证：对各操作注入限流、非流式结果和取消，所有网络 attempts 有证据，无法捕获的路径标为不可启用；记录虚拟路由接口验证但不默认启用。证据：`docs/validation/next-generation-nekomimi/models/README.md`，三类操作两种Node各10/10；低层Models无虚拟路由注册入口。
- [x] 1.8 制作前端技术切片：共享控件、可调分栏、流式虚拟列表和主题预览；验证：候选依赖在现有 React/Vite/Node 上通过构建、键盘、360px、200%缩放、图片延迟与焦点恢复测试，记录精确版本及许可证。证据：`docs/validation/next-generation-nekomimi/ui/README.md`，两种Node构建/类型/Chrome各7/7，缩放采用明确记录的CSS zoom实验。
- [x] 1.9 给出双工作台视觉样稿、tokens 草案和性能基线；验证：正常/加载/空/错误/取消/待授权、360px及200% CSS缩放均通过，记录阅读与输入指标；用户明确回复“按当前样稿推进（推荐）”，批准高对比、轻量猫系点缀和三栏布局。证据：`docs/validation/next-generation-nekomimi/ui/screenshots-high-contrast/`、`high-contrast-results.json`、`high-contrast-metrics.json`与评审记录。样稿为模拟数据，不等于正式工作台已实现。
- [x] 1.10 固化批次0结论和规格/测试映射；验证：design明确Durable唯一生产路线、固定依赖与拒绝项；26份delta共87个Requirement/186个Scenario有逐项验收去向，`openspec validate --all --strict`43项通过。证据：`docs/validation/next-generation-nekomimi/batch-zero-conclusion.md`、`coverage.md`、`coverage.json`与`durable/gate-spec-validation.log`。

## 2. 批次 1：新格式、Pi 适配与可靠运行

依赖：1.1–1.10。覆盖：`pi-platform-integration`、`execution-journal`、`model-call-evidence`；保留既有工具、恢复及诊断规格。

- [x] 2.1 增加新格式探测、独立数据目录及不兼容错误；验证：正式配置/工作区/定制授权/模型资料/会话运行/分支/导入/候选入口接入，旧配置、会话、SDK1/2和候选恢复夹具均在执行及写入者前拒绝，整目录摘要和原字节不变，新分区正常初始化；17项准入及49项相关回归、51项SDK权限/生命周期检查通过。证据：`docs/validation/next-generation-nekomimi/format-admission.md`及JSON。新会话已经使用Journal Storage标记，运行循环已由2.2/2.3迁移。
- [x] 2.2 按已验证精确版本升级 package/lock 并建立集中 Durable Storage/Harness、AI adapter 边界；验证：AI/Durable/Chord固定1.0.4，Agent依赖及过渡模块已删除；产品工具/图片契约独立于Pi，19处框架导入逐项匹配实际安装包公开exports及文件，浏览器/共享协议/SDK零框架导入，无reference入口；类型检查、构建和严格规格43项通过。证据：`durable/import-boundaries.json`、`durable/harness-current-*.log`。运行语义另由2.3验证。
- [x] 2.3 迁移 Durable generation hooks、受记录Provider与任务终态桥接，删除过时适配分支；验证：正式runtime使用公开Harness，生成前等待可靠产品投影，通知钩子异常通过独立取消门禁阻止再次派发；取消先收敛原生任务再记产品终态；首轮/续轮/错误/取消/无工具终止/64及显式轮数上限通过。62文件372项完整回归（2 workers）通过，正式入口额外断言原生generation/tool终态通过；默认并发9项失败原始日志保留，格式夹具/清理已修复。证据：`durable/harness-full-workers2.log`、`durable/harness-native-runtime.log`。后续2.4–2.8的因果、恢复、管线与安装包门槛独立实施。
- [x] 2.4 扩展 Journal 事件身份和因果关联，维持单写入者租约；验证：原生任务/会话、模型attempt和父子工具可关联，独立异步作用域及进程回调捕获身份，并发响应流/嵌套RPC的seq唯一且artifact不串流；真实断租约取消在途模型并阻止工具，第二写入者/缺失损坏附件/中段损坏回归通过。证据：`durable/causality-and-recovery.md`，82项相关回归及5项因果流测试通过（合计83个不同测试），类型/构建通过。
- [x] 2.5 固定意图、可靠水位和终态发布边界；验证：正式runtime的工具意图append/fsync/水位写入/水位替换四处故障均零副作用；真实SIGKILL在外部效果后、结果前发生，显式继续仅一个新请求、效果仍一次、旧意图仍一次，unknown关联原运行/任务/attempt。可靠投影与Storage故障回归通过。证据：`test/durable-runtime-recovery.test.ts`与`durable/causality-regression.log`，安装包跨Node验证由2.8继续。
- [x] 2.6 重构统一工具管线供直接和嵌套入口调用；验证：一次参数准备/schema/权限/前置hooks，固定schema与能力版本写入意图，直接及原生入口消费一次准入对象；实际进程嵌套调用的hooks各一次，陈旧文件写入仍拒绝，后置观察失败不覆盖外部事实。8文件49项回归及3项管线契约复核、类型/构建通过；证据：`durable/pipeline-and-model-policy.md`、`durable/pipeline-*.log`。
- [x] 2.7 整理受记录模型服务及原始流背压；验证：最终bytes/hash、未知事件、分块密钥、证据超限、取消与迟到结果均通过；每个attempt仅派发一次，未知网络结果不自动重试，Harness/SDK隐藏重试关闭。产品取消直接进入transport，完成事实落盘期间取消不发布迟到值或工具；70项不同测试、类型/构建通过，保留首次失败证据。详见`durable/pipeline-and-model-policy.md`及`model-policy-*.log`。
- [x] 2.8 完成底座与安装包回归门槛；验证：类型/构建、相关单元及`npm run test:pack`通过；安装包CLI/Web/SDK/扩展及真实Durable崩溃恢复通过，最低Node22.19.0与Node24.15.0的安装runtime保留原始请求bytes/hash、reasoning items、tool_choice及工具配对，unknown不重放；辅助命名/压缩23项通过，reasoning控制保留。证据：`durable/runtime-pack-validation.md`及日志；Linux和完整新功能门槛仍由11组承担。

## 3. 批次 2：模式身份、会话生命周期与交接

依赖：第 2 组。覆盖：`work-create-modes`、`mode-session-handoff`、`session-lifecycle`、`execution-journal`。先完成 headless/服务行为，再接新 UI。

- [x] 3.1 定义mode/target/session协议并持久化创建身份；验证：HTTP并发/重启与显式headless创建命令去重，四阶段中断仅补元数据；路径ID与Journal一致，mode/target不可改写，丢失/替换目标及错误宿主阻止派发，创造任务实际写入独立目标。18项身份契约及相关Journal/服务/Provider/RPC回归、类型/构建通过，新工作台4项Chrome检查通过；证据：`docs/validation/next-generation-nekomimi/session-identity/README.md`及日志。3.2/3.3能力与范围门禁独立继续。
- [x] 3.2 实现模式化有效能力计算和服务端执行门禁；验证：work 实际 schema 排除创造工具与 SDK 资料，普通审查命令仍可执行；实际嵌套 RPC、伪造模型工具调用、HTTP 管理／新授权均在派发前拒绝，工作流不能换模式继续，创造模式不自动授权用户写入。9 文件 94 项回归及扩充后 22 项模式测试、类型／构建、3 项 Chrome 导航输入检查通过；证据：`docs/validation/next-generation-nekomimi/mode-policy/README.md`，首次失败日志保留。目标版本与路径范围由 3.3 继续。
- [x] 3.3 增加创造目标和版本资料范围校验；验证：创建／模型／工具准入核对目标及宿主构建，SDK 资料绑定相同目标；安装、原项目父目录和用户资源／数据目录不可作为开发根，真实文件与资源写入口拒绝越界。核心源码、lock、构建入口只读检查，不运行脚本；shell／可信扩展权限限制可查。6 文件 88 项回归、最终 9 项准入、类型／构建通过，证据：`docs/validation/next-generation-nekomimi/create-target/README.md`，首次失败保留。完整源码基线与构建验收由第 8 组继续。
- [x] 3.4 实现无副作用交接预览和显式摘要准备任务；验证：实际 HTTP 预览零模型／工厂／Journal 写入，不创建目标；授权项目与选定引用 hash 校验，独立操作 Journal 记录无工具 handoff 摘要、来源和用途；重复收据一致、取消／工具调用／凭证输出／源变化拒绝，无自动交接或副作用。5 文件 77 项回归（含 8 项准备契约）、类型／构建／严格规格通过；证据：`docs/validation/next-generation-nekomimi/handoff-preparation/README.md`，首次失败保留。确认提交与跨 Journal 恢复由 3.5 继续。
- [x] 3.5 实现源 intent、目标接收、源 committed 的幂等交接协议；验证：源快照、目标绑定及双侧事件固定 handoffId，确认／恢复幂等，内容变化冲突；交接四阶段及目标创建四阶段真实 SIGKILL 后仅一个目标、零模型／工具／命名，HTTP 四阶段确认丢失和 12 项 I/O 故障通过。已接受意图用原快照，未可靠提交且修复改变 cursor 时需重新预览确认；已删、身份不符或快照损坏阻止恢复。33 项协议、8 项最终编译崩溃测试、相关 4 文件 70 项回归及类型／构建／严格规格通过；证据：`docs/validation/next-generation-nekomimi/handoff-transfer/README.md`，首次失败保留。交付与实际上下文消费由 3.6／4.7 继续。
- [x] 3.6 实现创造交付回执和工作消费关联；验证：只读阶段／版本／范围／证据与工作授权独立，加载与应用及宿主验收分离；历史快照与当前过期／删除诊断分开，交付不运行工厂、模型或命令。显式工作请求核对已接收引用并记录运行／命令／版本关联，伪造引用在派发前拒绝；16 项契约、5 文件 77 项相关回归、8 项真实崩溃恢复及类型／构建／严格规格通过。证据：`docs/validation/next-generation-nekomimi/delivery-receipts/README.md`，首次失败保留；上下文正文选择由 4.7 继续。
- [x] 3.7 更新命名、删除、独立取消与恢复逻辑；验证：独立目标并发、同目标串行，取消绑定会话及运行／命名 ID；命令重提不抢占命名，新任务仅抢占同目标命名。删除预览／关系查询保留对侧快照并标注来源不可回溯，不删另一会话／源码／活动能力。8 文件 133 项、Chrome 5 项、类型／构建／严格规格通过；证据：`docs/validation/next-generation-nekomimi/independent-sessions/README.md`，首次失败及默认并发观察超时保留。
- [x] 3.8 通过模式与交接综合 headless/HTTP 契约门槛；验证：两条完整工作需求 -> 并发确认创造 -> 实际受记录候选创建／静态检查 -> 确认交付 -> 重启工作继续，通过重复命令／确认且模型、工厂和工具计数不增加；headless 同 ID 只读返回可靠收据或中断观察结果，unknown 不重跑。12 文件 155 项、最终编译模块 8 项真实 SIGKILL、类型／构建／严格规格通过；证据：`docs/validation/next-generation-nekomimi/mode-handoff-roundtrip/README.md`，首次失败保留。交付正文选择及新用途配置由 4／5 组继续。

## 4. 批次 2：上下文选择、预算与压缩

依赖：3.1–3.3，交接部分依赖 3.4–3.6。覆盖：`context-selection-policy`、`prompt-task-profiles`、`prompt-context-provenance`、`context-compaction`、`context-occupancy`。

- [x] 4.1 实现 work/create/compaction/title/handoff 的版本化 profile；验证：正式运行从持久 mode 选择 work／create v3，压缩／交接 v3、命名独立 v2；固定五类正文、版本和 hash，actual body 与 context.view／attempt profile 对应。辅助请求无工具及开发指导，工作无 SDK 正文／激活流程；旧 bytes 不改写。8 文件 106 项、类型／构建／严格规格通过；证据：`docs/validation/next-generation-nekomimi/task-profiles/README.md`，首次失败与原预算回归保留，未以估计宣称模型质量提升。
- [x] 4.2 建立不可变请求上下文快照和选择清单；验证：固定可靠来源、mode／target／model／活动及有效声明 revision；有序来源／hash／角色／范围／决定清单在不同注册顺序下相同，不冻结调用方。Durable 准备钩子及内置／自定义 stream 一次消费同一快照，准备后对象变化不偷换 body；可靠转换记录关联字段或完整 serializer 输入／输出，8 处 I/O 故障零派发。新增 12 项、最终 4 文件 44 项、10 文件 126 项相关回归及类型／构建／严格规格通过；证据：`docs/validation/next-generation-nekomimi/context-snapshot/README.md`，首次身份排序失败保留。4.3–4.7 门禁独立继续。
- [x] 4.3 实现能力目录预算、按需资料与有效状态区分；验证：版本化目录／分页预算及 UTF-8 描述摘要，150 条完整覆盖；请求快照五类状态与真实首轮／续轮／下一任务正文分别断言，资料读取／原生工具身份／版本可追溯；强制规则超限在主请求、自动及手动压缩前拒绝，完整附件不变且零模型。10 文件 102 项、最终编码 43 项／规则状态 19 项及类型／构建／严格规格 43 项通过；安装包 SDK／CLI／Web／Durable 验收通过（encoding 构建），首次分页投影及旧工作模式 SDK 夹具失败保留并修复。证据：`docs/validation/next-generation-nekomimi/resource-context/README.md`。
- [x] 4.4 实现作用域变化和撤权的请求/执行再校验；验证：失效指令／工具撤下并保存排除来源，主／辅助 Provider 和工具在意图前及可靠提交后重查授权、真实来源和根身份；内容更新保留捕获正文，撤权零新增 HTTP／外部效果，意图后拒绝明确未派发，旧 bytes／附件不变。固定工作流区分执行副本与原授权位置，模拟仍需当前明确 grant，生产不使用模拟准入。新增 8 项、相关集成 35 项及最终 79 文件 544 项全套、类型／构建／严格规格 43 项通过；首次失败及修复保留。证据：`docs/validation/next-generation-nekomimi/context-revalidation/README.md`。
- [x] 4.5 更新大结果投影与分层预算测量；验证：版本 2 分层占用／预留总量可对照，模型／schema／图片／模式／目标变化使旧锚点失效，未知容量不造输入额度或百分比，辅助 usage 隔离；完整附件、UTF-8／JSON 有界文本及独立图片与后续实际 body 关联，图片可按原索引续读。新增 6 项、相关 91 项、最终 80 文件 550 项全部通过，类型／构建／严格规格 43 项通过；预算基线未改，完整回归暴露的冷会话元数据缺失附件问题经确定性重启测试修复，执行准入仍校验全部附件。证据：`docs/validation/next-generation-nekomimi/context-projection/README.md`，首次失败及修复记录保留。工作台分层详情由 10.5 接入。
- [x] 4.6 重构压缩触发与摘要提交校验；验证：源身份绑定会话／模式／目标／模型／有效声明，生成及最终队列内只读重查配置、资源授权和当前状态，微任务取消同步阻止提交；拒绝保留失败事件而不损坏 Journal。创造候选／活动版本、实际阶段及来源、待授权／应用、UNKNOWN 和确认交接约束独立保留为提交时数据，后续可靠事实优先；孤立结果与重叠调用拒绝，未闭合并行组完整保留，递归／并发整理拒绝且 Durable 内置压缩关闭。新增 17 项（13 项来源测试及 4 项真实 Provider 创造场景）、最终 13 文件 130 项相关回归、类型／构建／严格规格通过；主题默认值及生命周期状态查询零目录创建，原历史和工作会话不变。证据：`docs/validation/next-generation-nekomimi/compaction-source/README.md`，首次失败及夹具修复保留。
- [x] 4.7 将交接输入纳入选择与来源索引；验证：确认输入以 user 数据帧进入实际请求，工作交付显式选择且排除 SDK 正文，引用保存原 hash／脱敏 hash／范围／选择理由；完整快照保留，源删除后标注原证据不可用。伪造权限不能执行创造工具，恢复投影校验角色、收据和内容一致性。专项 5 项及最终 8 文件 124 项相关回归、类型／构建／严格规格通过；证据：`docs/validation/next-generation-nekomimi/handoff-context/README.md`，失败夹具记录保留。
- [x] 4.8 完成上下文前后对照报告；验证：保留原七场景基线，同历史／任务／模型／工具的压缩前后实际 body 与 Journal 附件一致，保存 schema/input 估算、保留节点及排除理由，原八节点不变；45 项 prompt/context-runtime 风险场景及类型检查通过。报告明确 MCP／规则／命名估算增长、模式拆分混杂因素及额外摘要请求，不宣称真实缓存、费用或完成率提升。证据：`docs/validation/next-generation-nekomimi/context-comparison/README.md` 和两个 JSON 报告，首次夹具用途断言失败保留。

## 5. 批次 3：Codemode 与类型化模型操作

依赖：第 2、4 组。覆盖：`codemode-execution`、`model-operation-catalog`、`model-call-evidence`、`extension-runtime`。

- [x] 5.1 接入已验证 sandbox 与打包资产，固定宿主资源上限；验证：固定 Codemode 1.0.4／quickjs-wasi 3.6.2，公开 worker 入口与安装资产实际运行。适配器限制总时限 30 秒、内存 16 MiB、源码 256 KiB，公开固定输出／小状态上限且不能扩大时限；无 process/network/fs/module 直接入口，CPU／内存／输出压力及取消有界，宿主仍响应。三项综合测试、类型／构建／严格规格和独立 tarball 安装后真实 worker/WASM 验证通过。证据：`docs/validation/next-generation-nekomimi/codemode-runtime/README.md`；脚本模型入口、并发及持久状态仍由 5.2–5.4 实施。
- [x] 5.2 实现正式 codemode 入口、固定工具目录和真实 schema 描述，子调用由宿主分配 ID／parent，并复用一次 prepare／权限／意图／执行管线；工作过滤、schema 错误、撤权及意图失败均阻止效果，不允许递归 VM。MCP 结构化错误可处理且失败事实保留。 验证：13 文件 130 项综合回归及结构化错误补充 15 项通过（合计 131 项不同测试），类型／构建／严格规格通过。证据：`docs/validation/next-generation-nekomimi/codemode-runtime/pipeline-state.md`，保留首次失败和修复记录。
- [x] 5.3 实现每脚本 128 次、同运行 4 并发／同资源 2 并发预算和可取消等待；文件入队前固定已读版本，竞争写入仅一个成功，重读后可写。子信号传到真实扩展/MCP，未等待调用有界收敛并保留 unknown；真实进程重开不重复效果。 验证：13 文件 130 项综合回归及结构化错误补充 15 项通过（合计 131 项不同测试），类型／构建／严格规格通过。证据：`docs/validation/next-generation-nekomimi/codemode-runtime/pipeline-state.md`，保留首次失败和修复记录。
- [x] 5.4 实现完整输出 JSON 与图片字节附件、模型有界投影及续读入口；成功 codemode.finished 原子引用状态附件，失败／取消／并发旧状态不提交。重开、分支快照及独立会话隔离通过，子工具事实独立保留。 验证：13 文件 130 项综合回归及结构化错误补充 15 项通过（合计 131 项不同测试），类型／构建／严格规格通过。证据：`docs/validation/next-generation-nekomimi/codemode-runtime/pipeline-state.md`，保留首次失败和修复记录。
- [x] 5.5 接入类型化模型目录和用途配置；验证：provider/operation/id 区分三类同名模型，登记和目录副本不改写捕获定义，未知容量不造数；profile 类型在选择及执行前检查。work/create 等用途独立，实际请求分别使用各自模型且命名不变；缺凭证／错误类型零派发。只读 model_catalog 同供普通工具及 SDK，返回凭证与未接入原因，不暴露密钥。75 项不同相关测试及最终类型／构建／严格规格通过。证据：`docs/validation/next-generation-nekomimi/model-catalog/README.md`；分类／图片执行仍由 5.6 实施，工作台选择页面由 10.4 接入。
- [x] 5.6 接入分类和图片宿主调用及 Codemode 模型桥；验证：类型化输出、非流式响应、错误 stopReason、取消迟到、持久附件、父子 usage 单一归属均覆盖；用途配置及授权/凭证在派发前复核，超限拒绝，不隐式重试或跨 provider 回退。52 项不同相关测试和最终类型/构建/严格规格通过。证据：`docs/validation/next-generation-nekomimi/typed-model/README.md`。
- [x] 5.7 固定实验路由支持边界与诊断；验证：默认物理模型，profile 保存/恢复、模型登记、聊天及辅助请求拒绝非 physical 策略；恢复拒绝不改写原文件，零派发及零回退。未启用 opt-in 路由。18 项相关测试、类型、构建及严格规格通过。证据：`docs/validation/next-generation-nekomimi/model-routing/README.md`。
- [x] 5.8 完成脚本部分失败综合门槛；验证：真实 VM/CoreTools/分类工具/本地 HTTP MCP 按序执行成功写入、分类失败、远端副作用后取消；独立事实和 unknown 保留，失败脚本状态不提交。新建宿主及显式恢复后文件 mtime、分类及远端计数不增加。12 项相关测试、顺序/终态复核、类型及严格规格通过。证据：`docs/validation/next-generation-nekomimi/codemode-runtime/partial-failure.md`。

## 6. 批次 3：MCP 接入与按需发现

依赖：第 2、4 组；脚本入口依赖 5.2。覆盖：`mcp-tool-integration`、`mcp-context-and-auth`、`prompt-context-provenance`。

- [x] 6.1 按批次 0 矩阵迁移 MCP transport/认证及保留的协议适配；固定 Pi MCP 1.0.4 公开 client/transport，共享单连接初始化；宿主保留 schema/分页、凭证注入及 OAuth 持久适配。stdio 环境受控、stderr 独立，HTTP 初始化/分页/JSON-RPC 错误原始字段保留。17 项相关测试、类型/构建/严格规格通过。证据：`docs/validation/next-generation-nekomimi/mcp-runtime/README.md`；6.5 的 OAuth 新门槛仍待验证。
- [x] 6.2 实现 direct/deferred/codemode/hidden 策略和稳定身份消歧；非直接服务后台连接、hidden 不启动；mcp_discover/mcp_call 使用确切服务器/工具 ID、固定 schema revision 与当前授权，codemode 仅脚本调用。28 项相关测试覆盖首轮不阻塞、有界等待/取消、规范化冲突准确路由及发现不扩权，类型/构建/严格规格通过。证据：`docs/validation/next-generation-nekomimi/mcp-runtime/discovery.md`。
- [x] 6.3 实现列表变化、请求声明和运行版本快照；完整分页发现存入 Journal，恢复仅重建状态且调用前核对在线版本；请求声明与实际 wire schemas 对照通过。真实通知下活动 schema 不变，移除错误保真且不误路由；停用后重开宿主及续跑零额外初始化/调用。27 项相关测试、类型/构建/严格规格通过。证据：`docs/validation/next-generation-nekomimi/mcp-runtime/versions.md`。
- [x] 6.4 衔接资源/prompts/订阅与模式上下文；内容目录固定版本/独立副本，读取事实含模式、目标和原始附件；三类分页、参数、原始角色、通知仅待刷新及新旧 digest 保留通过。独立创造/工作目标的真实请求无正文或授权继承。18 项相关测试及分页增强复核、类型/构建/严格规格通过。证据：`docs/validation/next-generation-nekomimi/mcp-runtime/content.md`。
- [x] 6.5 迁移 OAuth 服务身份和令牌轮换取消处理；公开 Pi OAuth 协议 API 配合宿主验证/持久化锁。同 URL 双账户隔离，issuer/state 拒绝，取消期间保存轮换令牌且业务零派发，断开代次阻止返回凭证；Journal/附件/Web 管理响应无令牌。20 项相关测试、类型/构建/严格规格通过。证据：`docs/validation/next-generation-nekomimi/mcp-runtime/oauth.md`。
- [x] 6.6 通过 MCP 故障恢复门槛；验证：真实 HTTP 副作用后断线及重启不重发，远端 unknown 与成功/失败脚本状态独立；macOS stdio 忽略 SIGTERM 后强制清理并核对进程组消失，失败不误报成功，清理事实关联 Journal。23 项相关测试、类型/构建/严格规格通过。证据：`docs/validation/next-generation-nekomimi/mcp-runtime/fault-recovery.md`；Linux/Windows 平台结论按 11.8 单独记录。

## 7. 批次 3：新版 SDK 与创造交付

依赖：第 3、4 组，嵌套及 MCP 能力依赖第 5、6 组。覆盖：`extension-runtime`、`customization-development`、`customization-lifecycle`、`self-customization-workflow`。

- [x] 7.1 发布 SDK 3 契约、模式/协议/能力目录和清单校验；旧版本及未来能力在模块导入前拒绝并给出资料入口，公开支持与授权/可执行区分；全部随包 TS 示例静态编译、公开类型依赖图无 Pi/核心实现。47 项相关测试、类型/构建/严格规格通过。证据：`docs/validation/next-generation-nekomimi/sdk-runtime/contracts.md`。
- [x] 7.2 迁移受记录 SDK 服务、进程桥和 hooks；修复 RPC 跨异步边界丢失父调用信号，嵌套模型取消不取消主运行；共享预算、实际 SDK 命令去重、hooks 顺序/前置失败通过，进程失败明确仅宿主服务可观测。35 项不同相关测试、类型/构建/严格规格通过。证据：`docs/validation/next-generation-nekomimi/sdk-runtime/services.md`。
- [x] 7.3 将项目候选/用户能力包与真实创造会话及目标宿主绑定，来源写入 Journal，应用前复核身份且拒绝元数据删改；内容/依赖锁变化使旧 hash 失效，用户扩权保留显式授权门禁，二进制准备/导出/激活/回退字节一致。30 项相关测试、类型/构建/严格规格通过。证据：`docs/validation/next-generation-nekomimi/sdk-runtime/candidate-origin.md`；保留首次夹具初始化失败记录。
- [x] 7.4 重整阶段/状态/版本/环境结果模型；静态检查不执行工厂，模拟成功/失败/取消与预览独立记录，主题挂载仅为观察不伪报宿主通过。修复旧版本活动时新候选模拟误判作用域，取消后旧指针和命令保持可用。33 项不同相关测试、类型/构建/严格规格通过。证据：`docs/validation/next-generation-nekomimi/sdk-runtime/verification.md`，保留首次失败及定位记录。
- [x] 7.5 验证真实运行边界切换与失败保留；候选/能力包确认携带登记 revision，回退校验确切目标 hash，过期确认不改授权或活动版本。状态 schema 不兼容后阻止扩展继续调用宿主服务及伪报成功，保留原状态。41 项相关测试及最终门禁复核、类型/构建/严格规格通过。证据：`docs/validation/next-generation-nekomimi/sdk-runtime/boundary.md`。
- [x] 7.6 更新能力目录和交付卡投影；验证：来源按会话所属项目定位，受控创建/更新与外部观察修改区分；项目/用户范围、活动/候选版本独立，双工作台引用不可变交付事实，历史卡不执行激活；环境匹配证据及来源删除回归 26 项通过，类型/构建/严格规格通过。证据：`docs/validation/next-generation-nekomimi/sdk-runtime/projection.md`。
- [x] 7.7 重写随包开发资料、示例和 CLI 指引；SDK 3 准入、目标身份、扩展/核心路径明确；独立 tarball 实际创建并校验命令、Skill 和主题，加载完整示例清单、拒绝过期宿主资料。18 项相关测试、类型/构建/严格规格及完整安装包回归通过。证据：`docs/validation/next-generation-nekomimi/sdk-runtime/guides.md`；保留 CLI 指南参数修正前的失败日志。
- [x] 7.8 通过创造闭环综合门槛；验证：工作提出 /review -> 创造开发 -> 错误修复 -> 授权应用 -> 工作使用 -> 修改 -> 重启 -> 停用，证据、提示撤销和原工作草稿均符合规格。 默认项目交付已实际实现，完整夹具通过受记录模型工具开发并修复候选，失败保留 v1、更新 v2、重启后使用及停用提示撤销均通过；正式 Node 24 无源码 test:pack 也执行同一夹具。浏览器授权/取消/草稿/丢失响应去重 9/9；证据：`docs/validation/next-generation-nekomimi/creation-roundtrip/README.md`。

## 8. 批次 3：核心候选与受控版本切换

依赖：第 2、3、7 组。覆盖：`core-change-candidates`、`execution-journal`、`customization-development`。本组不执行 npm 或 GitHub 发布。

- [x] 8.1 实现核心候选源码选择、基线和独立开发目录；正式 CLI 预览/确认双 hash/准备/检查，Journal 绑定源码基线、宿主及目录身份，核心会话仅准入已登记候选；真实 Git 修改/索引保护、空目录和可执行位、来源不符/缺失、符号链接、已有目标及只读查询通过。42 项相关回归与 1 项正式 CLI 测试、类型/构建/严格规格通过；当前仓库只读基线预览成功。证据：`docs/validation/next-generation-nekomimi/core/source.md`。
- [x] 8.2 实现源码/lock/Node/npm/PATH/产物 manifest 和明确 inputHash 构建授权；静态零脚本执行，真实 npm 生命周期在隔离副本执行，日志持久化/跨块脱敏/限额、POSIX 组取消和 unknown 不重跑生效；源码/lock/工具链或产物变化使旧结果失效，产物同步落盘并只读固化后提交成功。25 项相关测试、正式 CLI、类型/构建/严格规格通过。证据：`docs/validation/next-generation-nekomimi/core/build.md`；独立启动和宿主验收仍为 not_run。
- [x] 8.3 实现独立候选启动与健康/协议/存储检查；验证：隔离 home 和凭证，默认不执行真实外部操作，端口/进程清理有界，模拟和真实宿主验收分别标记。证据：`docs/validation/next-generation-nekomimi/core/validation.md`；19 项定向回归、正式 CLI 真实源码构建→独立启动→Durable/会话读写恢复→重复命令/只读检查通过；保留首次 esbuild 内部硬链接失败及修复。
- [x] 8.4 实现托管启动选择与安装级租约；验证：同安装只能有一个切换写入者，未支持启动方式只输出明确候选启动步骤，不写 PATH 或全局 npm 安装。证据：`docs/validation/next-generation-nekomimi/core/managed.md`；24 项相关回归及最终 14 项复核通过，正式 CLI 真实源码构建→验证→托管启动→并发 busy→退出清理通过，令牌不入 Journal，运行中切换与恢复仍留在 8.5/8.6。
- [x] 8.5 实现显式候选 hash 确认、全相关运行空闲门禁和幂等切换；验证：工具/审批/验证仍活动时拒绝切换，重复命令不重复启动，成功后 UI 报告实际新构建身份。证据：`docs/validation/next-generation-nekomimi/core/switch-control.md`；30 项控制/验证、35 项服务/Durable 回归及 2 项浏览器测试通过；真实源码双构建、隔离检查、同端口切换、重复确认无额外进程、浏览器实际身份与退出端口清理通过。既有门禁 46 项证据保留；故障回退/重启恢复仍待 8.6。
- [x] 8.6 实现切换恢复、健康失败保留旧版本及状态兼容回退；验证：逐阶段 kill 故障注入确定实际指针，重启不跑业务工具，不兼容存储不能被旧版本清空或自动迁移。证据：`docs/validation/next-generation-nekomimi/core/recovery.md`；全部 Core 14 文件 68 项通过，新增实际 CLI 后专项 5 项通过，previous 构建恢复另复核通过。五个真实 supervisor SIGKILL 边界、同端口恢复、未知工具历史不重跑、兼容回退/不兼容拒绝、元数据写入故障 unknown、并发 writer 及重复恢复去重均有证据。候选准入使用显式夹具，进程/Journal/故障/服务恢复为真实路径；完整源码成功切换证据仍见 8.5。

## 9. 批次 4：设计系统、路由与客户端状态基础

依赖：1.8–1.10；状态协议依赖第 3、4 组。可与第 5–8 组在稳定服务接口上交错实施，但不使用假 UI 状态冒充后端完成。覆盖：`web-design-system`、`web-session-stream`、`runtime-ui-extensions`。

- [x] 9.1 接入已验证的组件/样式依赖并建立 tokens 与基础控件；验证：统一控件状态、键盘可访问名称、焦点、明暗主题、危险/禁用/等待表现，构建无未使用大组件包。证据：批次0锁定的精确版本（Radix Dialog1.2.0/Slot1.4.0、Tailwind4.3.3、TanStack Query5.104.1/Router1.170.41/Virtual3.14.13、react-resizable-panels4.14.2）已接入 package.json；tokens 采用用户批准的高对比明暗色值（`src/web/styles/tokens.css`）；控件库 `src/web/ui/`（Button/Input/Select/Dialog/Menu/Tabs/Tooltip/Toast/Badge/EmptyState/ErrorState/ResizablePanel）；浏览器测试 `test/browser/v2-workbench.spec.ts` 9.1 两项通过（控件状态/键盘/焦点恢复/明暗主题品牌色），未引入未验证组件包。
- [x] 9.2 建立 work/create 路由及目标深链接；验证：刷新到同会话/候选视图，无效/无权目标不回退执行，导航不发写命令，浏览器历史返回不触发模型。证据：TanStack Router 路径路由（过渡期 basepath /v2，10.9 收编）；服务端静态层对无扩展名 GET 回退 index.html 支撑刷新深链接（`src/server/app.ts`，既有 server.test.ts 12/12 仍通过）；浏览器测试 9.2 两项通过（刷新恢复同会话、无效会话/候选/路由明确诊断不回退、模式导航与历史返回零写命令）。注意：router 创建会规范化 URL，connect 须先于路由模块加载（`src/web/main.tsx` 已处理）。
- [x] 9.3 拆分查询缓存、SSE reducer、草稿和布局状态；验证：cache key 含宿主/模式/目标/会话，迟到数据隔离，密钥不进入持久草稿，mutation 默认不自动重试。证据：`src/web/v2/state/`（query.ts cache key 含 host/mode/target/session 且 mutation retry=false；sessionStream.ts reducer；drafts.ts 按 mode/target/session 隔离持久草稿、仅文本不涉密钥；layout.ts 布局独立持久化）；浏览器测试 9.3 通过（跨模式导航草稿保留）。
- [x] 9.4 实现可靠快照/增量握手与慢客户端恢复；验证：快照订阅间事件不丢，重复 cursor 去重，无效 cursor 显式重载，重连与双窗口不增加模型/工具计数。证据：`src/web/v2/state/sessionStream.ts` 先快照后订阅，cursor 为服务端 seq+hash 链；单元测试 `test/v2-session-stream.test.ts` 4 项通过（增量合并、迟到/重复 cursor 丢弃、同 seq 幂等、reset 显式清空等待新快照）；reducer 只读不产生写命令，重连按原 cursor 续订；浏览器测试提交后经 SSE 收到模型回复通过。
- [x] 9.5 实现分栏、窄屏导航和共享状态壳；验证：360px、200%缩放、软键盘和长路径下模式、目标、停止、返回始终可达，布局恢复不影响任务。证据：`src/web/v2/shell.tsx` TopBar+三栏 WorkbenchShell（react-resizable-panels 已验证版本），布局按工作台持久化；窄屏 ≤760px 转单主区+可开合导航/详情；浏览器测试 9.5 两项通过（separator 方向键 aria-valuenow 实际变化、360px 无横向溢出且模式/输入可达、720px+CSS zoom:2 实验下导航折叠后输入仍可达——沿用批次0 CSS 缩放实验口径，不冒充原生 zoom 验收；软键盘/长路径留待整体验收）。
- [x] 9.6 实现新主题及模式化扩展 slots/bridge；验证：旧契约拒绝，主题素材失败回退，跨模式实例不挂载，导航撤销订阅且迟到 bridge 请求不能覆盖另一草稿。证据：`src/web/v2/shell.tsx` useTheme 明暗 tokens（本地 tokens 无外部素材，天然回退宿主默认；tokens.css 补 --accent 别名供面板主题快照）；`src/web/v2/slots.tsx` ModeSlot 校验 contractVersion=3/模式适用/资源版本，单元测试 `test/v2-slots.test.tsx` 4 项通过；CustomPanel 卸载即关闭端口丢弃迟到响应且会话切换拒绝执行；浏览器测试 9.6 通过（旧契约拒绝诊断可见、仅创造模式声明在工作模式不挂载 iframe）。宿主操作在新协议接入前显式拒绝，未用假实现冒充。

## 10. 批次 4：工作与创造页面、上下文和证据

依赖：第 9 组；真实创造操作依赖第 7、8 组。覆盖：`web-task-workbench`、`web-customization`、`context-occupancy`、`web-evidence-inspector`、`customization-lifecycle`。

- [x] 10.1 实现工作台项目/会话、输入、命令发现、文件/变更与结果区域；验证：已有 Enter/Shift+Enter/IME、命令补全、提交去重、删除和焦点风险场景在新布局通过。证据：`src/web/v2/routes/work-session.tsx` Composer 复用 command-input 纯函数实现 / 命令补全（listbox+方向键+Tab 补全不提交）、IME 组合中 Enter 不提交、commandId 收据前去重；删除会话为显式确认对话框且初始焦点在取消；侧栏证据/变更/文件 Tab 复用既有 Changes/FileBrowser 只读组件（`src/web/v2/routes/details.tsx`）；浏览器测试 10.1 通过（IME/补全/去重/删除/焦点），既有浏览器风险场景不依赖旧布局选择器的部分随 10.9 综合门槛复核。
- [x] 10.2 实现创造目标导航、候选差异、验证日志与预览区域；验证：各阶段准确呈现，空/加载/失败可区分，预览入口显式运行，页面切换不重启验证。 完成：扩展候选只读差异、作用域预览和持久后台静态校验已实现；任务编号、日志、取消确认、unknown 不重跑及旧内容证据隔离通过 15 项不同相关单元和 15 项浏览器测试，类型/构建通过。证据：`docs/validation/next-generation-nekomimi/create/progress.md`。核心候选只读页面已接入，持久基线正文、源码差异与构建/独立验证日志通过 17 项单元及 6 项浏览器检查，见 `create/core-readonly.md`；核心页面内计划审阅、后台构建/独立验证及取消已接入，22 项不同单元、8 项浏览器通过，见 `create/core-operations.md`；扩展工厂初始化取消与清理后终态已落实，26 项不同单元及 5 项浏览器通过，见 `create/extension-cancellation.md`；持久后台模拟/预览、明确授权、页面取消和目录失效时的任务读取已整合；最终相关 15 项单元、11 项浏览器、类型/构建和 43 项严格规格通过，见 `create/candidate-executions.md`。
- [x] 10.3 实现交接预览、确认、源/目标跳转与交付卡；验证：未确认不创建任务，取消保留两侧草稿，交付过期和来源删除有明确诊断，已收卡不自动应用。 完成：双工作台交接表单、现有/新建目标预览确认、来源记录选择与只读交付卡已接入；来源/目标跳转、历史与当前状态分离、版本变化、来源删除、取消和迟到预览、同页确认响应丢失重试已验证，见 `docs/validation/next-generation-nekomimi/handoff/ui-progress.md`。刷新后的显式元数据恢复、工作请求选择交付引用及跨导航迟到回执草稿保护已接入，见 `handoff/recovery-and-references.md`；显式摘要准备/取消/重新审阅与创造输入、独立草稿和 SSE 结果已实现，见 `handoff/summary-and-create-input.md`；精确版本关联核对、变化/不可读诊断、显式返回和浏览器后退阅读锚点已完成；最终 29 项浏览器、68 项服务端、类型/构建及 43 项严格规格通过，完整映射见 `handoff/completion.md`。
- [x] 10.4 实现模型用途配置、能力/权限及候选管理页面；验证：只改选定用途，版本冲突不自动重试，失败清除密钥但保留非敏感草稿，模型目录无凭证时不伪装可运行。 完成：独立模型用途页、八类用途确认、自定义配置编辑、逐配置可用性、凭证清理与版本冲突已实现；26 项相关单元与 15 项不同浏览器检查通过，见 `docs/validation/next-generation-nekomimi/management/models-progress.md`。能力/权限与候选启用/回退/导出已继续接入，最终 30 项相关浏览器、17 项服务端及类型/构建/43 项严格规格通过，见 `docs/validation/next-generation-nekomimi/management/resources-candidates-progress.md`。MCP 授权与诊断页已接入，10 项相关浏览器及 5 项服务端回归通过，见 `management/mcp-progress.md`；能力包检查/安装/回退/导出/卸载/清理已接入，13 项不同相关浏览器检查及 7 项服务端回归通过，最终卸载门禁另复核 3 项浏览器通过，见 `management/packages-progress.md`；持久工作流管理已接入，15 项浏览器及 56 项相关服务端/进程检查通过；同时修复取消后宿主 RPC 未排空导致的迟到 Journal 写入，见 `management/workflows-progress.md`。面板管理及目标归属修复已接入，13 项不同浏览器检查、31 项单元检查通过，见 `management/panels-progress.md`。高级模型迁移及跨 Provider 历史分支已接入，9 项浏览器及 58 项不同相关单元检查通过（最终定向复核 24 项），见 `management/advanced-models-progress.md`。基础设置及默认凭证管理已接入，12 项浏览器及 30 项服务端/配置回归通过，见 `management/settings-progress.md`。主题管理已整合，最终管理页综合回归 45 项浏览器、主题定向 13 项单元、完整类型检查/构建/43 项严格规格通过；完成映射见 `management/completion.md`，新旧 UI 切换与完整 slot/bridge 接入仍由 10.9 验收。
- [x] 10.5 实现上下文入口及选择/排除/压缩来源详情；验证：work/create 当前投影、分层来源与预留、固定请求快照和压缩来源分页、附件续读与缺失诊断、未知容量、只读工厂/模型/Journal 不变、迟到读取隔离、360px 深色放大及关闭焦点/草稿保留。修复共享 Portal 作用域与按钮前景色；11 文件 86 项单元、21 项浏览器及最终 4 项复验、完整类型/构建/严格规格通过，首次超时与夹具失败日志保留。证据：`docs/validation/next-generation-nekomimi/context-ui/README.md`；跨断点阅读锚点与全站切换仍由 10.7/10.9 完成。
- [x] 10.6 实现嵌套调用树、多类型模型证据和费用汇总；验证：稳定父子引用与独立失败/取消/unknown、逐 attempt 请求 body/hash 和原始响应分页、分类结果与完整性验证图片、固定上下文快照及交付版本/删除来源诊断、未知费用与父子用量去重。真实 Codemode 部分失败和 typed model 记录入口、工厂/Journal 只读及 360px/焦点/草稿通过；8 文件 34 项单元、18 项浏览器、完整类型/构建/43 项严格规格通过。证据：`docs/validation/next-generation-nekomimi/inspection/README.md`；初始夹具/定位失败与来源状态缓存问题及修复日志保留。
- [x] 10.7 实现长列表虚拟化和自动跟随/历史锚点；验证：图片/字体/面板高度变化、分页失败、迟到导航、选择文本与键盘阅读场景通过；历史行重挂载不运行扩展代码。work/create 共用有界 180 行分页与 SSE 控制器，TanStack Virtual 挂载可见正文并保留稳定锚点、焦点/选择行；历史导航不改变视口高度，交付定位与返回最新协调。宽窄屏共用组件树，真实面板实例/草稿/选择不丢失，分栏比例恢复。40 项不同浏览器、16 项单元及完整类型/构建/43 项严格规格通过；原生滚动等待及旧会话夹具修正与失败日志均保留。证据：`docs/validation/next-generation-nekomimi/history-ui/README.md`。
- [x] 10.8 实现核心候选切换确认和恢复界面；验证：精确目标/产物/影响目录预览、忙碌阻碍及等待/会话入口、确认取消焦点、持久命令与同命令回执查询、断线/刷新/旧目标失效后的独立恢复入口、实际构建匹配才报告成功、failed/unknown 不自动重跑。普通启动方式只返回归属与构建核验后的 argv，失效构建为明确 409；恢复信息只读，终端对账/恢复仍需独立授权。32 项单元、29 项不同浏览器与最后 8 项定向复验、完整类型/构建/43 项严格规格通过；浏览器完成两个真实编译服务子进程的切换、端口复用、回执与身份恢复，源码/构建准入模拟范围单列。证据：`docs/validation/next-generation-nekomimi/core-switch-ui/README.md`。
- [x] 10.9 清理旧页面/样式/兼容分支并通过工作台综合门槛；验证：所有管理能力仍有文字入口、错误局部隔离、键盘/窄屏/减少动效通过，新 UI 不依赖旧选择器，完整浏览器测试通过。 阶段进展：正式插槽契约、会话/模式/目标隔离、草稿冲突与导航/页面桥接、独占 renderer 和局部故障回退已接入；24 项单元、25 项定向浏览器及类型/构建/43 项严格规格通过，见 `docs/validation/next-generation-nekomimi/runtime-slots/README.md`。继续恢复安全 Markdown/代码高亮、工具详情/附件、保存面板、文件/diff 定位和会话 HTML/诊断包导出；修复面板 HTTP 序号乱序，25 项不同浏览器检查含定向复验、类型/构建/严格规格通过，见 `workbench-content/README.md`。引用输入及扩展等待表单已迁移：会话目标隔离、原生输入法/剪贴板/撤销、短屏发送可达、显式回答重试与取消等 36 项浏览器和 7 项单元/HTTP 检查、类型/构建/43 项严格规格通过，追加取消与短屏复核见 `input-editing/README.md`。会话列表稳定分页、跨日/完整时间、统一菜单/删除、101 会话创造深链接已补齐；同时修复候选预览实例会话绑定及越权关闭破坏索引问题，48 项浏览器、11 项单元/HTTP、类型/构建/43 项严格规格通过，见 `session-catalog/README.md`。双模式失败继续草稿、诊断下载、提交焦点及搜索来源/品牌场景已迁移，18 项浏览器、2 项来源安全检查及类型/构建/严格规格通过，见 `recovery-migration/README.md`；可选管理页、文件/变更、调用证据及导出已拆分按需加载，局部失败/重试/关闭与迟到焦点保护已验证；51 项不同浏览器场景通过（含焦点缺陷修复后 11 项复验）、类型/构建/43 项严格规格通过，见 `feature-loading/README.md`。紧凑更多菜单、外观预览取消/默认恢复、窗口级扩展显示与卸载、运行中导出保护已接入；迁移头部风险场景，修复缩放关闭越界和嵌套 Escape 误关底层，84 项浏览器及样式修正后 17 项复验、7 项单元、类型/构建/43 项严格规格通过，见 `compact-header/README.md`。继续迁移输入加载/焦点、会话导航和有界历史三个旧测试文件共 11 项场景，补齐命令目录刷新/失败清除/显式重试/迟到隔离、选中项可见和提交错误警报；最终 47 项浏览器、6 项单元/HTTP、类型/构建/43 项严格规格通过，见 `navigation-migration/README.md`。上下文、本地体验、高亮和滚动五个旧测试文件及夹具共 17 项场景已迁移；修复组件重复 SSE 占满双窗口连接额度和导出高亮调色板不一致，最终 41 项浏览器、12 项单元、类型/构建/43 项严格规格通过，见 `local-syntax-scroll/README.md`。工作台与文件升级两个旧集成文件共 9 项已迁移，真实请求/响应附件分页、嵌套搜索证据、断线取消、长历史输入、诊断水位及变更合并通过；类型与 43 项严格规格通过，见 `workbench-integration-migration/README.md`。运行时 UI 与定制生命周期三个旧场景已迁移，显式面板打开/卸载、主题字体、引用草稿保留、独立创造目录授权及无效链接零写入通过；最终 17 项浏览器与类型检查通过，见 `runtime-ui-migration/README.md`。定制管理七项旧场景已迁移到独立页面；修复配置名称 HTML pattern 无效导致非法输入发请求的问题，20 项浏览器、类型/构建/严格规格通过，见 `studio-migration/README.md`。最后九项旧定制集成场景已迁移，修复等待表单跨路由草稿丢失、忙碌目录缓存不恢复和工作面板入口丢失会话；16 项浏览器及类型/构建/严格规格通过，见 `customization-integration-migration/README.md`。默认入口已切换为 `/work`、`/create`，删除包含 App 的 24 个旧模块及 5 份专用样式；30 项不同浏览器场景、类型/构建/严格规格通过，见 `default-entry/README.md`。新时间线已承接轮次组织、重复成功合并、异常可见及命名按需查看；缺少任务结束记录不推断成功，轮次证据直接定位原运行。迁移旧展示单元测试，移除 Timeline 等 5 个旧模块和旧 PanelManagement，最终 7 项单元、196/196 完整浏览器、类型/构建/严格规格通过，见 `readable-turns/README.md`。原生滚动按实际 scrollend 同步，连续 10 次保持 2px 阈值；长历史展示计数按折叠后的节点调整，分页、完整证据和输入检查保留。冷启动基线与安装包分块验收仍由第 11 组完成，10.9 完成不代表全部规格交付。

## 11. 批次 5：整体回归、安装包与交付证据

依赖：第 2–10 组门槛完成。全部未变规格继续有效；若发现外部行为冲突，先更新相关 delta 并审阅，不静默删场景。本组不自动发版或归档未完成工作。

- [x] 11.1 审核新规格与剩余主规格的兼容范围；验证：逐项检查 core-tools、本地服务、进程宿主、包完整性、headless 导出、历史导航和故障恢复保证，真实变化均有 delta，未变场景仍有测试。 42 个主能力与 30 个 delta（22 个既有变更、8 个新增）逐项核对，20 个未变主能力保留契约；SDK/旧配置/Windows 交叉契约补齐 delta，实时面板与 500kB 体积保证通过实现补齐；最终 788 项单元、201 项浏览器、四格安装及已安装资源复核通过，见 `docs/validation/next-generation-nekomimi/compatibility-audit.md`。
- [x] 11.2 运行全部构建、类型和单元回归；验证：`npm run typecheck`、`npm test` 通过，记录确切 commit/Node/平台及失败修复，任务勾选不早于验证。 当前 macOS arm64 / Node.js 24.15.0 未提交工作树的类型检查、构建及 130 文件 777/777 测试通过，耗时 428.20s；首轮 775/777 的预算持久化耗时与 CLI opener 等待夹具已修正并保留失败记录，见 `docs/validation/next-generation-nekomimi/full-regression/README.md`。
- [x] 11.3 运行完整浏览器及综合故障场景；验证：`npm run test:browser` 通过，覆盖双模式、交接、主题禁用、工作台恢复、双窗口、慢连接、错误输入与取消，不只验证截图。 正式 `npm run test:browser -- --workers=2` 198/198 通过（3.7 分钟）；首次 196/198 的两项交互同步失败保留，补齐退出/目标 iframe 布局等待后重复 10/10 通过。类型检查及严格规格 43/43；证据：`docs/validation/next-generation-nekomimi/live-panels/README.md`。
- [x] 11.4 执行无源码安装包闭环；验证：`npm run test:pack` 及临时目录安装启动通过，SDK 文档/示例、Codemode 资产、Web 静态资源和候选素材齐全，最低 Node 可完成工作 -> 创造 -> 应用 -> 工作使用。 macOS arm64 / Node 24.15.0 与 22.19.0 使用同一 tarball 的全部安装夹具通过，含受记录开发、失败保留旧版、项目授权安装、重启和停用闭环；证据：`docs/validation/next-generation-nekomimi/creation-roundtrip/README.md`。
- [x] 11.5 验证旧目录与敏感数据保护；验证：旧会话/配置/候选加载拒绝前后 hash 不变，日志/浏览器/导出无密钥，历史浏览和导入无模型、工具或工厂副作用。 补齐项目交付回执格式准入及默认/Provider 凭证脱敏；97 项不同单元/服务测试、5 项浏览器、类型/构建及严格规格 43/43 通过，见 `docs/validation/next-generation-nekomimi/privacy-admission/README.md`。
- [x] 11.6 记录长会话和上下文性能对照；验证：同硬件、模型配置和 fixture 下对比 schema/input 体积、准备延迟、内存、分页/锚点与恢复耗时，列出回归和测量限制，不用模拟宣称成本或质量提升。 相同 deepseek-flash/四工具、0/400 条历史各 3 次，及 450 条浏览器历史各 3 次对照完成；保留准备/RSS/加载回归、0px 锚点与只读恢复证据，不宣称成本或质量提升，见 `docs/validation/next-generation-nekomimi/runtime-performance/README.md`。
- [x] 11.7 在用户另行允许且有凭证时进行真实模型抽样，并交付实际测量或明确的缺失报告；验证：分别记录工作修复、创造扩展、长上下文、分类/图片的模型配置、费用、失败和人工介入，未授权时不调用，不把缺失报告当真实质量通过。 交付缺失报告：`docs/validation/next-generation-nekomimi/real-model-missing.md`，分别列出工作修复、创造扩展、长上下文与分类/图片的未执行配置、费用、失败及人工介入状态；无另行授权，未发起真实抽样，勾选只表示报告已交付。
- [x] 11.8 完成 Linux/macOS 与最低/目标 Node 的安装和运行记录；验证：按实际平台逐项列出通过/失败/未测，Windows 明确暂缓且不借其它平台结果宣称通过。 最终同一 tarball 在 macOS arm64 与 Linux aarch64 原生文件系统的 Node 22.19.0/24.15.0 四组完整安装夹具通过；OrbStack 共享挂载的原子替换 ENOENT 已独立复现并明确不纳入可靠存储通过范围，失败记录保留；见 `docs/validation/next-generation-nekomimi/platform-clean/README.md`。
- [x] 11.9 更新 README、源码边界、开发资料及验收索引，核对任务到规格映射；验证：当前文档不再混用旧 SDK/布局/存储承诺，实验路由及 Durable 真实支持状态明确，`openspec validate --all --strict` 和发布检查脚本通过，但不创建标签/Release。 21 份当前文档本地链接核对通过；真实覆盖索引补齐遗漏 workspace-references，现为 30 能力/92 Requirement/233 Scenario；严格规格 43/43、发布检查 7/7，见 `docs/validation/next-generation-nekomimi/documentation/README.md`。
- [x] 11.10 提交最终批次完成与残余风险报告供评审；验证：每项完成任务均有可定位证据，未完成/未验证功能不标为支持，只有满足全部交付门槛后才另行同步主规格和归档，发版仍需明确授权。 最终报告覆盖 30 能力、92 Requirement、233 Scenario 与全部任务证据；单元 788/788、浏览器 201/201、类型、严格规格 43/43、发布检查 7/7、四格同包安装及已安装可选资源通过。性能回归、共享挂载可靠性失败、真实模型未测及 Windows 暂缓均保留；见 `docs/validation/next-generation-nekomimi/completion.md`。未提交、归档或发版。

## 12. 规格覆盖索引与实施顺序

本节是任务导航，不增加隐藏实施工作。新增/修改的 30 个能力全部由以上复选任务覆盖；精确到 Scenario 的证据链接由 1.10 建立并在 11.9 校对。

| 能力 | 主任务组 |
| --- | --- |
| pi-platform-integration | 1、2、11 |
| work-create-modes | 3、4、10 |
| workspace-references | 10.9、11.9 |
| mode-session-handoff | 3、4、10 |
| context-selection-policy | 4、10 |
| codemode-execution | 5 |
| core-change-candidates | 8、10 |
| model-operation-catalog | 1、5、10 |
| web-design-system | 1、9、10 |
| execution-journal | 2、3、8 |
| model-call-evidence | 2、5、10 |
| prompt-task-profiles | 4 |
| prompt-context-provenance | 4、6、10 |
| context-compaction | 4 |
| context-occupancy | 4、10 |
| session-lifecycle | 3、10 |
| extension-runtime | 2、5、7 |
| customization-development | 7、8 |
| customization-lifecycle | 3、7、10 |
| self-customization-workflow | 7、11 |
| mcp-tool-integration | 1、6 |
| mcp-context-and-auth | 6 |
| web-task-workbench | 9、10 |
| web-customization | 9、10 |
| runtime-ui-extensions | 7、9 |
| web-session-stream | 9 |
| web-evidence-inspector | 10、11 |

推荐开始点是第 1 组，不直接跳到 package 升级或页面重写。第 9 组可在其协议依赖固定后与能力开发交错，当前已有apply授权，仍遵守所列依赖和验证门槛。

兼容审核补充：`extension-process-host/独立执行与兼容` 的 SDK 3 准入与旧 SDK 工厂前拒绝由 7.1、11.1 覆盖；修正另一能力仍承诺 V1 兼容的遗漏，未增加新的生产能力。

兼容审核补充：`local-user-configuration/配置入口与凭证隔离` 的不兼容配置拒绝替代旧的自动 profile 映射场景，由 2.1、10.4、11.1、11.5 覆盖；显式历史复制和只读观察不据此获得运行兼容性。

兼容审核补充：`customization-release-readiness` 的旧 SDK/配置兼容及 Windows 候选安装承诺分别与当前破坏性升级和已批准的 Windows 暂缓策略对齐，由 11.1/11.2/11.5 与 11.4/11.8 覆盖；其余故障与 macOS/Linux 门槛保留。
