## Why
实际 Journal 中两次任务在第 6/8 次调用以 max_output_tokens 未完成，输出均为 4096，并非原默认 32 轮限制。错误原因被吞为 Response incomplete 且展示两次。顶栏的外观、恢复、导出按钮平铺占据空间。对应 spec.md 的模型调用可观测性与 Web 交互要求。
## What Changes
- 提高内置默认输出预算至 131072（128K），默认调用轮数改为 64；显式参数保持优先，不自动突破输出上限。
- 保留不完整响应证据，不执行其中工具；显式预算、内容过滤、截断、取消不触发预算扩张。
- 合并重复错误，显示中文原因及继续任务草稿入口。
- 顶栏将外观/恢复/导出整合到更多菜单；自然关闭、键盘恢复焦点，导出使用有关闭入口的弹层。
## Capabilities
### New Capabilities
- `response-recovery`: 有界输出预算恢复与可读失败结果。
- `compact-header`: 顶栏操作收纳与可达的恢复/导出。
### Modified Capabilities
## Impact
影响内置 Responses transport、CLI 默认值、Web Timeline/顶栏及测试。保留原模型调用/Journal/工具授权路径；不更改自定义 Provider 协议，不移除轮数限制，不自动重做已执行工具。上个 change 保留独立不归档；本次不发布。
