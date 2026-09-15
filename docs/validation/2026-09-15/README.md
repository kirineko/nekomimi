# 选型验证记录（2026-09-15）

## 结论

首版采用 **`@earendil-works/pi-agent-core@0.85.1` 的低层 Agent + 自有 Journal/ContextView + 基于 pi-ai 公开 Responses 接口的 DeepSeek adapter**。

本次实际完成发布包检查、16 项离线探针、11 次限长真实 DeepSeek 请求和技能市场只读检查。真实请求全部为合成数据，未发送项目文件。应用尚未实现，因此以下结论证明接口可用性和已观察到的行为，不代表整套 Harness 已通过验收。

相对原研究，三个实现决定已明确：

1. **首版不整体接入 AgentHarness。** 其公开 Session/Provider 接口实际可运行，但普通事件处理失败被隔离，默认 JSONL/Node 文件接口也没有本项目要求的显式 fsync 水位；需要自建 Storage/执行门禁及原始流记录才能达到目标。低层 Agent 的异步事件屏障和失败阻断已实测，适合本阶段。高层方案并非不可行，本次未实现其自定义持久化 backend，也不把未测试等同于能力缺失。
2. **先复用 Responses parser。** 公开 `onPayload`、自定义 `fetch`、`maxRetries: 0` 和 compat 配置足以形成独立 adapter 边界，并已经通过一次真实历史回传。原始请求/流仍由 Harness 保存，不能只保存 pi 消息；没有证据支持现在就重写 parser。
3. **基础工具沿用接口、自行补执行约束。** pi 发布版 edit 的原始版本多处匹配、BOM/CRLF、重复匹配拒绝和独立 diff 已测试；但它会做模糊回退、无需前置 read，不直接满足本项目精确匹配与新鲜度契约。

## 本地参考仓库

本次检出的源码保留在项目 `reference/pi/` 和 `reference/dsh/`，保持下表所列 commit。`reference/` 已被根目录 `.gitignore` 排除。

## 证据层级

- **实测**：实际执行发布包、fixture 或服务请求，有本目录 JSON 结果。
- **源码/官方文档确认**：存在相应接口或行为；没有将其运行质量等同于实测。
- **后续验收**：需要新项目实现或代表性任务集，当前不能宣称通过。

## 环境和版本

| 对象 | 固定依据 |
|---|---|
| 本机 | macOS arm64，Node v24.15.0 |
| pi-agent-core / pi-ai / pi-tui | npm 官方 registry，全部 0.85.1；禁用安装脚本安装 |
| pi 发布包 gitHead | `d981de1229ef899957bbe968bc8dcda02a21f477` |
| pi 补充源码快照 | `f9bcd351dc3cedf989bc5fc0f8aa012db5737df2`；与发布包分别标识 |
| dsh 源码快照 | `c291e7961a515f6d7af9304e7fd1d257929aef26` |
| Deepy 本地源码 | `a7ba8ad59cf9a728e6ce47d0fd3e74c96c3c9aee` |

npm tarball integrity 和引擎约束见 [npm-agent-metadata.json](npm-agent-metadata.json)，完整依赖见 [package-lock.json](package-lock.json)。发布包要求 Node >=22.19.0；本次仅验证了上表环境。

## 验证矩阵

| ID | 对应 spec.md | 验证项 | 结果与提案影响 |
|---|---|---|---|
| V01 | §6、12 | npm 公开入口 | **实测通过**：Agent、AgentHarness、pi-ai Responses、TuiMainScreen 均可导入。TUI 是类型，实际构造器为 TuiMainScreen/TuiAltScreen，不能沿用旧示例的 `new TUI()`。 |
| V02 | §6 | 低层循环接入 | **实测通过**：一次工具调用驱动两轮模型；transformContext 执行两次；异步日志订阅结束后才执行工具。 |
| V03 | §3.4、6 | 日志失败阻断 | **实测通过**：低层 tool_execution_start 监听器抛错后工具执行次数为 0。仍需实现 transport/执行器共享的 fail-closed 状态，不能仅靠监听器覆盖所有阶段。 |
| V04 | §6 | 高层 Harness 对照 | **实测有条件可用**：公开 MemorySessionRepo/Models 接口跑通并生成会话记录；事件监听器异常产生 handler_error，run 仍 completed。公开 StorageBackedSession 可自定义存储；本次未实现该 backend。 |
| V05 | §3.2、6 | Responses 与原始证据 | **实测通过**：onPayload 修改可到达最终 fetch body；真实历史回传经 pi parser 完成。原始 SSE 可在 fetch 流中截获。未知事件原始数据可留存，但不会出现在 pi 语义事件中，故必须保留原始流。 |
| V06 | §6 | DeepSeek 默认 provider | **发布包实测确认**：deepseekProvider 的模型 API 为 openai-completions，必须另设 Responses 路由。 |
| V07 | §4、6、7.5 | 系统指令语义 | **发现并验证修正**：pi 通用 Responses 在 reasoning 模型下默认生成 developer；设置 supportsDeveloperRole:false 后生成 system。独立 adapter 优先使用 instructions 承载稳定系统指令，且避免重复注入。DeepSeek 官方明确 developer 被当作 user。[D1] |
| V08 | §3.2、6 | 真实 Responses 基本链路 | **实测通过**：文本/reasoning 流、两次 function call、原始 reasoning 与 call/result 配对回传；后续请求正常 completed。 |
| V09 | §6、7.4 | thinking 与 tool_choice | **实测发现限制**：指定函数的 tool_choice 返回 400，错误为 Thinking mode does not support this tool_choice；改为 auto 后正常。不能仅根据通用参数支持表声明所有组合均支持。 |
| V10 | §6、7.1 | reasoning 历史回传 | **实测发现限制**：人工构造工具历史但缺失 reasoning 时得到 400；回传实际原始 items 后请求被接受。原始 reasoning 不能仅由 UI 文本重建，也不能伪造补齐。 |
| V11 | §6、13 | 图片路径 | **实测通过有限样例**：32×32 纯红 PNG 用户输入返回 Red；真实 read_image 调用后回传图片也返回 Red。另一个不自然的 echo→图片历史组合达到 token 上限，仅证明接受协议，未算识别成功。未验证全部格式/尺寸边界。 |
| V12 | §3.2、6 | 重试、失败、取消 | **16 项探针覆盖**：maxRetries:0 时 429 只发一次；maxRetries:1 时 fetch 可见两次尝试；AbortSignal 到达 transport；断流/failed 转为 error；真实 incomplete(max_output_tokens) 转为 length。失败和取消的完整应用终态仍待实现验收。 |
| V13 | §4 | 工具贡献与自定义提示词 | **源码确认**：coding-agent 组装器接受 selectedTools、toolSnippets、promptGuidelines；自定义 prompt 路径不自动追加默认工具指导。工具启停指导同步和来源 manifest 是新项目职责。[P1] |
| V14 | §5 | edit 基线 | **实测通过**：多 edits 对原始文本匹配、BOM/CRLF 保留、重复匹配失败不修改、diff 独立返回。**不满足目标的部分**：无需先 read；Unicode 引号不同仍可模糊匹配成功，details 无匹配模式字段。 |
| V15 | §3.5、5.4 | pi 日志与 shell | **发布包源码确认**：JsonlStorage commit 通过 FileSystem.appendFile；默认 Node 实现无显式 fsync 契约；shell 把 stdout/stderr 送入同一 feed。自有 Journal、水位与双通道 shell 仍必要。 |
| V16 | §3.5、7 | dsh 事件、压缩 | **源码确认**：持久 surface/替换事件、裁剪与摘要分离、带请求配置的摘要路径存在；live stream 在 settlement 前仍可能因进程丢失而缺失。不能以 dsh 默认持久化替代本项目流证据要求。[D2][D3] |
| V17 | §7.2–7.6 | 缓存、预算 | **源码及有限实测**：Deepy 具备 prefix fingerprint、revision 检查和预算保护；dsh 摘要复用前缀设计存在。一次真实历史回传报告 cached_tokens=256；这不证明压缩策略提升成本或缓存保证。[D4] |
| V18 | §8 | Web/TUI 分离 | **源码/发布包确认**：pi-tui 可单独导入；pi server/client 文档明确实验性及应用负责认证。自有 HTTP/SSE 产品协议仍是设计选择，尚无新项目 UI 验收。[P2][P3] |
| V19 | §9 | Skills/MCP | **官方规格确认**：SKILL.md 的 frontmatter/正文和按需加载；MCP tools/list、tools/call、list_changed、结构化结果。未连接用户 MCP 服务，不能声称生态集成完成。[E1][E2] |
| V20 | §9 | skill 市场复用 | **真实只读检查通过**：list 200、19 项；抽样 brainstorming 的 detail/download 可用，ZIP 含 SKILL.md，SHA256 与详情一致。未安装技能、未执行其内容。其余技能、升级事务和异常响应未逐项验证。 |
| V21 | §10–11 | 子任务、后台、审批 | **源码确认/后续设计**：dsh fork 截取已完成 turn，父 in-flight turn 不继承，权限新建；Deepy 文件状态保护和市场校验可作为参考。新 TaskSpec、JobRegistry、PolicyEngine 尚未实现。[D5] |
| V22 | §12–13 | npm 交付与平台 | **部分验证**：发布包 tarball 可安装、ESM 入口可运行；本项目尚无发布 tarball，不能验证最终包、Windows shell、TUI 实际终端兼容性。 |

### 流内存边界补充

发布包 EventStream 的 push 将未消费事件加入数组，没有容量参数。公开 fetch 能捕获原始流，但不能据此声称 pi 语义队列自动有界。首阶段设计已加入响应字节/事件硬上限、原始写入背压、快速消费及展示隔离，集成时必须验证慢盘和慢订阅场景。

## 真实调用记录

请求上限为 1–1024 输出 token，全部针对 `https://api.deepseek.com/responses` / `deepseek-flash`，不扫描或打印 key。总计 11 次请求：9 次 HTTP 200、2 次 HTTP 400。HTTP 200 中包含两次按 token 上限结束的 incomplete，不能统称全部任务成功。

| 测试 | 结果 |
|---|---|
| live-text | completed，文本与 reasoning |
| live-tool | 400，thinking + 指定函数 tool_choice 不兼容 |
| live-auto-tools | completed，reasoning + 两个工具调用 |
| live-auto-resume | completed，原始历史回传，cached_tokens=256 |
| live-incomplete | 1 token 上限，incomplete，符合预期 |
| pi-live-responses-history | 经 pi-ai 公开 adapter，stop，捕获 11,520 原始响应字节 |
| live-image-input | completed，Red |
| live-tool-image | 400，缺失 reasoning 的手工历史被拒绝 |
| live-tool-image-valid-history | 200/incomplete，512 token 用完，未当作图像识别成功 |
| live-read-image-call | completed，生成 read_image 调用 |
| live-read-image-result | completed，工具返回图片后回答 Red |

真实服务结果见 `live-results.json`、`live-followup-results.json`、`image*-results.json`、`pi-live-result.json`；成功请求的 request/response/events 保存为 `live-*.json`。pi-live 的模型 cost 配置为测试占位 0，**不代表真实免费或已核实费用**；usage 才是本次记录的消耗事实。

## 仍需实现或专项实验的项目

这些属于新产品验收或性能结论，不是读取上游文档即可证明的兼容性事实：

- Journal 磁盘耗尽、强杀、fsync 水位、附件事务、背压内存上限和恢复完整性。
- 新工具在外部并发修改、权限限制、原子写入及 Windows/macOS/Linux 上的行为。
- 四工具/专用 search/todo/Deepy 基线的代表性任务成功率、误改率、成本与人类介入。当前没有证据宣称 pi 提示词优于 Deepy。
- compact 的摘要质量、token 预算校准、冷暖缓存和总费用对照；不把 hash 相同或单次命中当作保证。
- Web 双窗口、断线重连、重复命令、HTML 注入隔离；TUI 同协议一致性。
- MCP 真实服务、技能更新回滚、子代理隔离及审批授权生命周期。
- 最终 npm 包干净安装、跨平台分发与性能；当前验证的是依赖包，不是未实现的产品。

第一项 change 只承担第一阶段行为，以上其余项目继续按 spec.md 的后续阶段拆分。默认 100ms/64KiB 刷盘阈值仍是初始工程参数，不是已经实测的性能结论。

## 复现

本目录是独立验证夹具，不是应用工程。依赖安装禁用 scripts；离线测试使用已经记录的真实响应，不调用模型。

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm test
```

已在新的规范路径临时目录执行上述干净安装并复跑成功。最初 npm --prefix 经 macOS /tmp 符号链接产生的路径型 lockfile 已替换为可移植 lockfile。

`npm test` 应有 16 项通过，见 `probe-results.json` 和 `extra-results.json`。测试会更新相应结果 JSON，文件工具在系统临时目录运行。

可选择运行一次真实历史回传（会消耗服务额度；仅从环境读取凭证）：

```sh
npm run test:live
```

该命令要求已有 `DEEPSEEK_API_KEY`，请求内容来自本目录的合成 fixture。离线测试证明公开扩展点和解析结果；真实调用结果会随服务变化，报告只代表本次记录。

## 来源

[P1]: https://github.com/earendil-works/pi/blob/f9bcd351dc3cedf989bc5fc0f8aa012db5737df2/packages/coding-agent/src/core/system-prompt.ts
[P2]: https://github.com/earendil-works/pi/blob/f9bcd351dc3cedf989bc5fc0f8aa012db5737df2/packages/server/README.md
[P3]: https://github.com/earendil-works/pi/blob/f9bcd351dc3cedf989bc5fc0f8aa012db5737df2/packages/client/README.md
[D1]: https://api-docs.deepseek.com/guides/responses_api/
[D2]: https://github.com/deepseek-ai/deepseek-harness/blob/c291e7961a515f6d7af9304e7fd1d257929aef26/docs/agent-lifecycle.md
[D3]: https://github.com/deepseek-ai/deepseek-harness/blob/c291e7961a515f6d7af9304e7fd1d257929aef26/packages/compaction/compaction-basic/README.md
[D4]: https://api-docs.deepseek.com/guides/kv_cache/
[D5]: https://github.com/deepseek-ai/deepseek-harness/blob/c291e7961a515f6d7af9304e7fd1d257929aef26/packages/subagent/subagent-fork-in-process/README.md
[E1]: https://agentskills.io/specification
[E2]: https://modelcontextprotocol.io/specification/2025-11-25/server/tools

主要事实以固定发布包执行结果为依据。源码快照与发布包并非同一 commit；未来路径不可用时可按 npm lockfile 重装检查发布文件。
