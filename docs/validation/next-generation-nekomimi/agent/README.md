# Agent 公开生命周期验证

## 范围

对应任务 1.3，使用任务 1.2 的仓库外独立消费项目与锁文件，直接导入 Pi 1.0.4 公开入口。2026-10-06 在 macOS arm64、Node 24.15.0 和 22.19.0 各运行 11 项 node:test，用例与逐事件 JSONL 留档。**首次两次均 8 通过、3 失败；经用户确认增加显式取消门禁后，两种 Node 均 11/11 通过，任务 1.3 完成。**

这是一个自编的假 JSON Provider，经真实 loopback HTTP 发送和接收 body；不是 OpenAI/DeepSeek Provider 协议兼容测试，不涉及真实凭证或模型。请求上下文从已 fsync 的 JSONL message 记录投影；最终 body 和 SHA-256 先落盘，服务端收到后读取持久证据并逐字节对照。工具执行前验证 intent 已持久化及 assistant 消息已经落盘。不会加载 reference 源码、修改生产依赖或执行用户项目工具。

## 已通过

两种 Node 上结果一致：

1. 首轮 prepareRequest 使用 Journal 投影，实际 body 不含 Agent 初始占位提示；无工具回复自然结束。
2. 工具续轮再次准备上下文，包含持久的 assistant/toolResult 配对；finishTurn 的 continue 不重复增加请求。
3. 无工具时 continue 恰好增加一次上下文请求。
4. end 保留排队的 steering/followup，不再准备或派发请求。
5. 宿主以 finishTurn 限制最大三轮，第四次请求不发生。
6. error 即使有嵌入工具、排队输入及 continue，仍硬退出，工具不执行。
7. aborted 同上。
8. Provider 传输期间取消后无续轮，完成 aborted 终态。

## 三项失败的具体含义

| 场景 | 探针预期 | 观察到的行为 | 网络/副作用 |
| --- | --- | --- | --- |
| prepareRequest 内取消 | 没有 finishTurn | 生成 aborted assistant，再执行一次 finishTurn/turn_end | 0 请求、0 工具 |
| assistant 持久化后取消 | prepare/finish 各一次 | 工具被阻止，但又进入 prepareRequest，产生 aborted 轮次后退出 | 总计1请求、0工具 |
| 第一个顺序工具内取消 | prepare/finish 各一次 | 已开始工具完成；第二个工具不执行；又进入 prepareRequest，再生成 aborted 终态 | 总计1请求、1已开始工具 |

第一项属于探针对终态生命周期的额外假设不成立，不能把生成 aborted 终态当作发送模型请求。

后两项揭示适配要求：取消后框架仍可能进入请求准备 hook。探针 streamFn 已在序列化/派发前检查 AbortSignal，因此没有新增网络请求；此结果不能证明无门禁 Provider 安全，更不能允许 prepareRequest 内压缩或其他辅助模型逻辑无条件执行。

原始用例另存为 `agent.initial.test.mjs`，原日志不变。用户确认后，新版本在 finishTurn 检查已取消 signal 并返回 end，并在 prepareRequest 入口检查 signal；发送和工具边界继续保留检查。prepare 阶段取消的探针轮次数从 0 校正为 1，并断言 aborted，零网络/零工具要求不变。assistant/工具阶段的 prepare 次数仍断言 1，没有通过放宽次数容忍额外准备。

### 门禁复验

`node24-guarded.log` 与 `node22-guarded.log` 均 11/11 通过、退出 0；逐事件证据位于同名前缀目录，命令见 `guarded-runs.json`。这是验证切片显式门禁生效的证据，不是生产适配已落地；批次 1 的 2.3 必须迁移并重跑这些契约。

## 证据与复现

- `agent.initial.test.mjs`：完整首次探针；`agent.test.mjs`：经确认的显式取消门禁版本。
- `runs.json`：命令、时间及退出码。
- `node24.log`、`node22.log`：完整 TAP 输出。
- `node24/<case>/journal.jsonl`、`node22/<case>/journal.jsonl`：每个场景独立记录；失败用例没有 probe.passed 记录。

将 agent.test.mjs 复制到任务 1.2 独立消费目录，指定新的空证据目录运行：

```sh
PROBE_OUTPUT=/absolute/path/to/new-evidence node --test --test-reporter=tap agent.test.mjs
```

分别选择对应 Node 二进制。证据文件采用排他创建，不能覆盖首次失败记录。JSONL 是验证用最小日志，不是 Nekomimi Journal 的完整实现；不据此宣称崩溃恢复、落盘故障、Durable 或真实 Provider 已通过。
