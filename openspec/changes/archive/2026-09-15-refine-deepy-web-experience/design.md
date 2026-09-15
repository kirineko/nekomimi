## Context

目前 Timeline 使用 pre 展示全部文本和工具参数，Inspector 初始打开 Request 并自动读取原始附件，普通用户先看到 JSON 而不是执行结果。

## Goals / Non-Goals

Goals：降低默认信息密度，同时保持证据可达性和移动端可用性。
Non-Goals：不改变会话存储、运行并发、模型参数或 CLI 名称。

## Decisions

- 用独立 Markdown 组件封装 react-markdown 与 GFM，禁用原始 HTML；不自动加载远程图片，链接仅允许 http(s)，新窗口打开。
- Timeline 中用户消息保留原文，助手回复渲染 Markdown；模型步骤紧凑展示，工具默认显示动作和文件路径，展开后查看参数/附件。
- Inspector 默认总览：结果、耗时、用量和重试状态；标签改为总览、指令、输入、请求、响应。原始 JSON、hash、字节信息折叠为技术详情。
- 新增展示标签辅助模块，将协议事件和来源 ID 转为中文名称；原始字段仍在技术详情中可见，不篡改权威记录。
- 使用低饱和紫色强调、白色对话区域、紧凑侧栏和卡片化追踪布局；保留移动抽屉和键盘焦点。

## Risks / Trade-offs

- Markdown 可能包含不可信 HTML/链接 → 不启用 raw HTML，阻止脚本 URL 和自动远程图片加载，以浏览器攻击夹具验证。
- 折叠可能隐藏关键信息 → 错误与执行状态始终可见，完整参数/证据有明确入口。

## 执行记录设计

- pi 参考：reference/pi/packages/coding-agent/src/core/session-manager.ts 的消息记录，export-html/template.js 的 assistant 文本、thinking 折叠和工具结果关联；不将字节块当成独立回复。
- dsh 次要参考：reference/dsh/packages/session/session-turn-outline/src/projection.ts 的轮次锚点和有限长度摘要。
- 新增只读 trace 接口按 runId 返回已有 SessionProjection 中的有序行，每页 40 行，独立于客户端历史窗口。前端 ExecutionTrace 按消息、调用、工具、结束分型渲染，选中调用可定位。工具输入和结果同卡展示，错误和取消保持可见；证据附件始终可达。
- Context 返回原有节点的 item，由 safeView 限制显示大小；WireContent 独立渲染消息、函数调用、函数结果及 reasoning，未知类型明确保留原文。原始数据不变，超长内容有截断提示和证据入口。
- 总览指标收起，执行记录默认展示；面板适当加宽，手机保持单列。
