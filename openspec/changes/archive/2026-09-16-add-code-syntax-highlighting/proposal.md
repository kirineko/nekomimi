## Why

助手回复的 Markdown 代码块与文件 diff 目前只显示纯文本或整行增删颜色，难以辨认关键字、字符串和注释。为 Web 和离线导出加入一致的语法高亮，提升代码阅读体验，同时保留历史证据与有界展示。

## What Changes

- 使用固定版本 Shiki 4.4.3 的公开 token API，统一语言识别、主题、纯文本降级与 CSS 类映射。
- Markdown fenced code 支持常用语言；普通 diff 支持差异语法，`diff-ts` 等显式语言支持差异与源代码颜色叠加。
- 文件 diff 从已保存的 before/after artifact 分别高亮，再按旧/新行号映射到现有分页；保留红绿背景、符号、统计、复制和原始证据入口。
- 浏览器高亮按需加载并在 Worker 中计算，限制输入、缓存和执行预算，取消或过期结果不能覆盖新内容。
- 离线 HTML 复用高亮投影和固定 CSS，自包含且不执行脚本、不请求外部资源。
- 对应 `spec.md` §3.5 存储与导出、§8.2 浏览器功能、§8.3 本地服务边界。
- 非目标：编辑器、左右分栏或行内字符差异、自动猜测任意语言、TUI 高亮、改变 Journal 或模型上下文、使用当前工作区补造历史。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `web-readable-presentation`: 增加代码块语言高亮、安全降级及流式有界计算契约。
- `file-change-presentation`: 增加保留历史语法上下文的分页 diff 高亮与缺失证据降级契约。
- `headless-session-export`: 增加无需脚本和网络的离线高亮一致性契约。

## Impact

- 涉及 `src/presentation/markdown.ts`、`src/presentation/diff.ts`、`src/web/components/DiffView.tsx`、Web 样式与 Worker、`src/server/changes.ts`、`src/export/html.ts`。
- diff API 增加可选 token 展示字段，纯文本字段保留兼容；不迁移权威历史。
- 实施阶段更新 package/lock 并精确固定 Shiki 及必要直接导入依赖；运行时仍最低 Node.js 22.19.0。
- 已在独立临时目录验证同步 React SSR、7 种语言、分页映射及 GrammarState；七语种静态实验包 gzip 283,773 字节，一万行约 410ms，必须懒加载和限制计算。完整测量及未验证项见 design.md。
