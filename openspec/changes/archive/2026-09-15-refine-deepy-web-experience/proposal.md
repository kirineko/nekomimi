## Why

当前工作台默认展示工具参数、英文协议标签和大量说明，普通用户难以快速理解任务结果。本轮以 Deepy 品牌统一界面，改善 Markdown 阅读和执行追踪的信息层级。

## What Changes

- 页面品牌改为 Deepy，精简副标题、说明卡片和重复状态文案。
- 对话支持安全的 Markdown/GFM 标题、列表、表格与代码块渲染。
- 执行过程采用紧凑摘要，工具参数和原始证据按需展开；追踪面板默认总览，使用中文分组和可读来源名称。
- 统一排版、留白、色彩、移动布局与交互状态；保留取消、继续、分页、请求溯源及导出能力。
- 对应 spec.md §8 浏览器检查器。仅修改展示层，不重命名 npm 包/CLI，不变更权威 Journal 或模型协议。

## Capabilities

### New Capabilities

- `web-readable-presentation`: Deepy 品牌、安全 Markdown 和面向普通用户的渐进式追踪呈现。

### Modified Capabilities

无；在既有 Web 功能之上添加展示契约。

## Impact

修改 src/web 组件及样式，新增 Markdown 组件和展示标签模块；增加 react-markdown/remark-gfm，保留模型和工具原文证据，补充浏览器回归。

## 追踪可读性补充

参考 pi JSONL 和 export-html 的消息/工具结果组合，以及 dsh turn outline 的轮次摘要。总览增加当前运行的有序执行记录；输入直接预览消息和工具内容，保留来源跳转。新增只读、有界分页的 trace 投影接口，不修改 Journal。
