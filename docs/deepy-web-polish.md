# Deepy 页面优化验收

日期：2026-09-15。变更：`refine-deepy-web-experience`，已实现并验证，已于 2026-09-15 归档。

## 页面调整

- 页面品牌及标题统一为 Deepy，精简介绍和辅助文案。
- 回复支持 Markdown 标题、列表、表格、代码块。固定 react-markdown 10.1.0、remark-gfm 4.0.1；禁用原始 HTML，仅允许 HTTP(S) 链接，远程图片显示占位文本。
- 会话将用户消息、回复、工具操作和思考过程分层排版，工具详细记录可展开，diff 入口保持可见。
- 追踪默认显示总览，按指令、输入、请求、响应分组；输入来源和回复优先可读内容，原始 JSON 和证据收进详情。
- 独立 Markdown、ToolCard 和展示文案模块；保留原有 Journal、服务端和模型协议。

## 验证

- `npm run typecheck` 通过。
- `npm run build` 通过，已更新本地预览静态资源。
- `npm run test:browser`：3 项 Chrome 测试通过，覆盖 Markdown、恶意内容隔离、提交、diff、证据、来源分页、刷新、继续、导出、窄屏取消及长历史。
- `openspec validate --all --strict`：3 个变更全部通过。
- 已检查桌面和手机截图；本次为展示层回归，未重复调用真实模型。


## 执行追踪二次优化

### 参考设计与落地

- pi `reference/pi/packages/coding-agent/src/core/session-manager.ts`：JSONL 消息保留身份和关联；本项目继续使用自己的 Journal，按运行投影有序记录。
- pi `reference/pi/packages/coding-agent/src/core/export-html/template.js`：按内容类型显示消息，将工具调用与返回关联，推理与原始数据渐进展开。本次工具动作、输入和结果位于同一阅读单元，回答使用 Markdown。
- dsh `reference/dsh/packages/session/session-turn-outline/src/projection.ts`：通过轮次锚点、有限长度预览定位长日志。本次以当前运行作为阅读范围，执行记录独立分页，不依赖客户端已加载的历史窗口。

新增 `ExecutionTrace`（有序执行阅读）、`WireContent`（协议内容分型展示）组件；`tracePage` 为只读、有界的展示接口。输入页直接展示消息、工具调用和结果内容，来源链接及原始证据继续保留。原始附件只在展开时读取。耗时和 token 用量移至次级区块。

验证：全量 45 项 Vitest 测试通过；最后的中断状态处理补充后，再通过 12 项服务端测试及 3 项 Chrome 回归。覆盖 85 条记录的独立分页、运行隔离、未知工具结果、可读输入、工具结果、来源跳转和桌面/手机截图。类型、构建和 OpenSpec 严格校验通过。未执行新的模型任务。

预览在原端口 59971 重启；确认无活动任务后重启，现有会话追踪读取返回 HTTP 200 / 15 条记录。
