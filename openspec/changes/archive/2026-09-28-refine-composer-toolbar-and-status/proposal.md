## Why
当前输入区模型、快捷键和上下文信息挤在同一操作行，层级不清晰。参考 DSH 精简布局，与 spec.md 的 Web 交互方向一致。

## What Changes
- 模型与图标发送/停止按钮置于输入框内工具栏。
- 快捷键与上下文置于框外状态行，百分比不显示约数前缀。
- 沿用主题变量，适配窄屏与键盘操作。
非目标：新增模型切换、附件或用量统计功能。

## Capabilities
### Modified Capabilities
- `context-occupancy`: 优化输入区明细入口与状态排布。

## Impact
仅 Web 输入区样式与展示；不改变请求、统计或 Journal。
