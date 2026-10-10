# Durable 有界对照：恢复策略不直接满足准入条件

## 历史对照状态（2026-10-06）

任务 1.4 **部分完成，未勾选**。已执行真实进程 SIGKILL 与公开提交边界故障注入；七项硬条件逐项状态如下。没有实现 Nekomimi Journal 的 Storage 映射，不声称已证明完整 B 路线可行或不可实现。当时不批准原生 Durable 接入。当前用户已选择 Durable 目标，默认 A 路线撤销；本报告原始实验仍保留，新 Journal Storage 与恢复门禁验证另行记录。

环境：2026-10-06，macOS arm64，Pi 1.0.4，Node 22.19.0 / 24.15.0。依赖和独立消费项目沿用 `../pi-packages/`。只使用公开 exports，Faux Provider 无网络和真实凭证；故障进程是测试 Node 子进程，不是委派代理。

## 实测结果

两种 Node 结果一致，见 `node22-final/results.json`、`node24-final/results.json`。最终探针退出 0 表示**成功复现并断言了对照行为**，不表示 Durable 通过 Nekomimi 准入。

### 强制终止与未知结果

1. 使用 Durable 原生 JSONL，`fsync: true`，仅此一个框架 store。
2. 工具向本地 `external-effects.jsonl` 写入一次模拟外部副作用并 fsync；通过 IPC 通知父进程屏障已到达；工具故意不返回结果。
3. 父进程确认计数 1 后 SIGKILL 该确切 PID，并等待进程退出，避免两个进程同时打开 store。
4. 使用新 Harness 重开同一个 store，通过公开 inspect/entries 确认没有已完成工具结果。只读重开不调度，工具计数仍 1、模型调用为 0。
5. 显式调用 `harness.waitForIdle()` 启动恢复调度：
   - `replay: safe`：工具计数变为 2，随后1次模拟模型调用。
   - `replay: never`：工具计数仍1，产生标明“may have partially run”的 interrupted 错误结果，随后1次模拟模型调用。

测试故意给有可计数副作用的工具标记 safe，检验**宿主是否会直接信任上游标记**，不是断言上游承诺 safe 工具都无副作用。上游按声明重放符合自身文档；Nekomimi 则不能让声明覆盖 unknown 不重跑规则。强制映射 replay: never、阻止不经明确恢复授权的调度以及 unknown 状态映射是潜在宿主适配方案，但本轮未实现和证明它们覆盖所有入口，因此不能据此批准 B。

`external-effects.jsonl` 是模拟外部世界的计数器，不是产品第二份 session/Journal；测试快照及日志只做观察，不供 Harness 恢复。**只有原生 store 不等于已完成 Nekomimi Journal 与 Durable 的唯一提交映射。**

### 提交失败

通过公开 Storage 实现的代理，在提交边界、进入底层 commit 之前抛出带 ENOSPC code 的错误：

- 输入提交拒绝；未调用模型或工具。
- 原 Session 进入 poisoned 状态，继续读取也拒绝，不能清除故障开关后继续使用。
- 关闭并重开 JSONL 后，entries 与提交前相同；没有偷偷恢复失败的输入。

这是可控的**提交边界拒绝**，不是物理磁盘耗尽、fsync 失败、部分文件写入或断电测试；这些结果不得相互替代。尚未测试 UI watcher 的故障水位。

## D2 七项矩阵

| 条件 | 证据/状态 | 准入结论 |
| --- | --- | --- |
| 1. 意图、结果、状态和 UI 同一权威提交 | 原生 JSONL 的失败提交/重开已测；产品事件映射和 UI 水位未测 | 未证明 |
| 2. 最终序列化后的逐网络 attempt，无隐藏重试 | Faux 无真实传输；测试禁用框架/Provider 重试；未构建传输故障夹具 | 未证明，不能由次数推断 |
| 3. 产品固定上下文进入请求 | 发布公共 GenerationHooks.beforeRequest 有替换 messages 类型；未运行替换对照 | 仅静态接口证据 |
| 4. 原始流、不完整响应与背压 | 未建立受记录原始传输入口 | 未证明 |
| 5. kill、unknown、取消迟到、磁盘故障 | kill 与提交边界 ENOSPC 已测；取消迟到、实际 fsync/部分写未测 | 部分，未通过完整门槛 |
| 6. 发布安装、无私有接口、即使 safe 也不自动重跑未知工具 | 安装已通过1.2；SIGKILL 后恢复 safe 工具计数1→2 | 原生恢复策略不满足产品规则 |
| 7. 无独立 Pi session 与产品 Journal 双写 | 探针仅用原生 store；没有构建产品 Journal 的唯一提交映射 | 未证明，不能声称达成 |

当前 D2 要求继续证明 Durable 宿主适配，不自动回退 A。七项准入门槛仍全部有效；本报告仅记录原生对照，不代表新适配通过。

## 探针纠错与原证据

- `durable-probe.initial.mjs` 误用 Faux 默认 stopReason: stop，工具没有执行，子进程在屏障前退出；`node22.log`/`node24.log` 与对应 store 保留。这不是进程恢复失败。
- 修正为 toolUse 后已完成两种重放对照；但首次故障测试误以为 Session 可在提交拒绝后继续读取，遇到 poisoned 错误。该版本保留为 `durable-probe.pre-reopen.mjs`，输出为 `*-corrected.log` 及目录。
- 最终 `durable-probe.mjs` 断言 poisoned 后关闭重开，再检查持久状态，没有放宽“不提交失败输入”的断言。最终输出为 `*-final.log`、目录及 `final-runs.json`。

## 复现

将 `durable-probe.mjs` 复制到任务 1.2 的独立消费项目，使用对应 Node 执行：

```sh
node durable-probe.mjs run /absolute/path/to/new-empty-output
```

必须使用新的空输出目录。脚本只 kill 自己启动、已确认到达副作用屏障的测试子进程。原 store、进程结果、恢复前任务和恢复后 entries 都保存在输出目录。没有生产数据、源码或依赖变更。

## 当前 Journal 适配实施

用户已授权进入apply，单一提交与恢复门禁切片见 [journal-adaptation.md](journal-adaptation.md)。历史原生对照不作为当前生产路线结论。
