# 多类型模型捕获入口验证

任务1.7完成：macOS arm64，Pi AI 1.0.4，Node22.19.0/24.15.0各10项测试通过。实际调用公开 Models 和已发布 Provider API，经 options.fetch 注入假传输；没有真实网络模型调用或费用。

| 操作 | API路径 | 实测 |
| --- | --- | --- |
| chat | openai-completions | SSE解析、429后一次重试、取消；所有序列化attempt可记录 |
| classifier | typesafe-system-one | 非流式noul→bool、usage、429后一次重试、取消；所有attempt可记录 |
| image | openrouter-images | 非流式内联图片输出、usage、429后一次重试、取消；所有attempt可记录 |

每个真实SDK序列化后的fetch调用先保存body/hash并fsync，再返回假响应；完整假响应及每次状态也落盘。最终命令见 `runs.json`；`node24/`、`node22/`下每个逻辑调用保存独立JSONL，未保存鉴权headers。rate场景各两attempt、取消场景各一次且aborted，不会以逻辑调用次数覆盖重试。

## 目录与默认策略

同provider/id的chat/classifier/image同时存在，不互相覆盖；无配置auth的可用列表为空。公开Models没有registerVirtualModel；虚拟模型注册属于coding-agent的ModelRuntime/extension层，而不是低层Models接口。本次不嵌入coding-agent，也不启用自动路由；不将源码参考功能宣称为已接入。

## 生产准入边界

这三条HTTP路径已证明可通过公开fetch记录实际attempt；生产仍须以宿主入口控制重试预算、取消和凭证清理。其它API、WebSocket或不能注入transport的Provider均未获本轮记录准入，不凭目录存在而启用。普通CI只运行假传输，TypeSafe当前API文档在2026-10-06核对（https://docs.typesafe.ai/api.md），不推断真实分类质量、费用或图片有效性。图片夹具只用于协议形状，不是可渲染PNG。

DeepSeek Responses保持现有独立适配；本次chat示例不构成替换协议的依据。原始真实网络背压、完整图片附件、父子费用去重和生产持久服务仍由2.7/5.6验收。
