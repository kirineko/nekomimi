## Context

动机见 proposal.md。现有 Markdown 是 ReactMarkdown + remark-gfm，导出使用 renderToStaticMarkup；DiffView 消费 diffPage 的纯文本行，预览 8 行、展开 120 行、每行最多展示 4,000 字符。工具已保存 before/after/patch artifact；不需要新增历史快照。

Web CSP 为 `style-src 'self'`、`script-src 'self'`，不能直接采用 Shiki 默认内联 HTML。离线导出允许内联 CSS，但禁用脚本和网络。相关回归入口为 test/workbench-services.test.ts、test/conversation-display.test.tsx 及 test/browser/。

### 2026-09-16 可行性验证

环境：本机 macOS arm64，Node.js 24.15.0；官方 npm registry 查询 Shiki 4.4.3，engines >=20。依赖仅安装在 `/tmp/nekomimi-shiki-spike`，使用 `--ignore-scripts`，没有修改项目依赖。

实验入口：临时目录 check.mjs、bundle.mjs、entry.mjs，结果 result.json；临时文件不是长期验收依赖。方法与结果记录如下，正式实现须增加仓库内回归用例。

- 使用 createHighlighterCoreSync + createJavaScriptRegexEngine、github-light，加载 typescript/tsx/javascript/python/json/bash/diff。
- 七种语言逐一断言 token 拼接等于输入且包含多种颜色：通过。
- 使用项目现有 createPatch 和 diffPage，把 130 行注释中的一行及末尾代码修改，按每页 2 行映射旧/新 token，断言文本完全对应：通过。
- 同一注释行单独高亮与带完整前文高亮颜色不同，验证逐行高亮确实会错；GrammarState 延续后的 content/color/fontStyle 与完整解析一致。片段 token offset 从片段起点计算，不能直接视作全文 offset。
- 用项目 React/ReactDOM/ReactMarkdown 做同步 SSR：CSS 类 token 出现，script 字符串被转义，无 style 属性，未知语言保留文本：通过。未知语言直接调用 Shiki 会抛错，必须在适配层显式降级。
- 未闭合模板字符串、CRLF、BOM、Unicode 输入无异常；这里只做 smoke，未覆盖这些输入的完整 diff 行映射。
- 同进程连续五次解析重复的 `const value: string = "hello"; // comment` 行：100 行 5.02–7.21ms，1,000 行 40.28–42.02ms，10,000 行 414.41–424.79ms。高亮器构造 2.35ms，不包括模块加载，也不代表所有语法首次使用成本。
- 项目 Vite 8.3.0，configFile:false、lib ES、minify:true、write:false，将 core、JS engine、七种语言和一个主题打成单个实验模块：代码长度 1,537,902 字符，gzip 283,773 字节。不是实际应用增量或最终 chunk 测量；确认不能把这些全部放进首屏路径。

**结论：核心方案可行，采用固定 CSS 类、Worker 和懒加载。** 本轮未做完整浏览器 CSP/视觉验收、最低 Node.js 22.19.0 运行、真实流式页面性能、生产 Worker 打包、导出全流程验收，不把这些标为已通过。

## Goals / Non-Goals

**Goals:**
- 一个确定性的 token 投影内核供浏览器 Worker、服务端计算和离线导出复用。
- 展示 token 不成为历史事实；缓存失效不影响查看、复制、导出原文。

**Non-Goals:**
- 不新增通用代码高亮网络接口、不接受用户自定义语法或主题，不改变已有 Markdown 图片和链接策略。
- 不承诺只凭不完整 patch 恢复缺失语法状态，不实现编辑器级语义分析。

## Decisions

### 1. 固定 Shiki，采用 JavaScript 引擎与受控语言集合

使用公开 core/token/GrammarState 接口，精确固定 4.4.3；若直接导入 @shikijs/langs/themes，必须声明同版本直接依赖，不能依赖 npm 提升。首批语言为上述七种；js/ts/py/sh 等固定别名，文件扩展名使用固定映射，未知语言保持纯文本。inline code 不高亮。

选择 JS engine 避免 WASM 加载与当前 CSP 的额外适配；不兼容浏览器或语法失败回退纯文本。语言模块和 Worker 从本地构建资源按需加载。SSR 在 renderToStaticMarkup 前完成初始化；缓存模块级高亮器，不在每个组件内新建。

备选 rehype-highlight/lowlight 接入 Markdown 更简单，但仍需解决 diff 状态和共享展示；Prism diff 插件不能直接处理现有分页证据。本方案保留现有渲染器和 diff 包。

### 2. 固定主题转为受控 CSS 类

采用 github-light，构建时从固定主题调色板生成颜色及 fontStyle 类，颜色与斜体/粗体/下划线组合独立映射。为固定 Markdown/增删背景低于 4.5:1 对比度的前景色确定性降低亮度；Web 与导出共享调整后的颜色。运行时只输出允许的类和 React text children，不注入第三方 HTML 或用户 CSS。未知颜色回退默认前景。实验中的动态颜色编号仅验证 SSR 可行性，生产类名必须确定且跨服务端/客户端一致。

Web CSS 随静态资源分发；导出内嵌相同规则。保留增删行背景与符号，对颜色与背景组合做实际对比度验收。无需放宽 CSP。

### 3. 分别解析历史源文件，再按行号投影

服务端从当前会话已确认 tool.result 的 before/after/patch 引用读取历史证据，不接收任意磁盘路径。旧文件高亮用于 del，新文件用于 add/context，header 不参与源代码解析。返回当前页可选 tokens，每项只含文本与受控样式标识，原 text/old/next/truncated/total 不变。

必须在脱敏后的可展示数据上计算，不能把原始 token 内容绕过脱敏输出；只有 token 拼接与对应展示行一致才使用。某侧 artifact 缺失、损坏、脱敏、超预算或映射不一致时，该侧保留纯文本；patch 本身不可用沿用现有 unavailable 行为。新文件没有 before 属于正常情况。不能读取当前工作区补齐。

完整源文件行号映射保留跨 hunk 与跨页上下文；有界文件完整解析一次并缓存，首期不引入检查点持久化。超大文件直接降级，未来若需要检查点仅作可丢弃缓存。长行截断在映射后按已有字符边界裁剪 token，复制仍来自现有文本字段。CRLF/BOM/末尾换行需明确映射规则，不能通过静默改写原文使断言通过。

### 4. Markdown diff 分两级处理

普通 diff fence 使用 diff grammar。`diff-ts`、`diff-javascript` 等扩展标签通过固定别名解析：按 hunk 把删除/上下文与新增/上下文分别组成两侧片段，token 映射回原行，保留前缀和块头。该扩展是适配层逻辑，并非 Shiki 自带 diff 语义。未知源语言退回 diff grammar；无法识别的 patch 退回普通 diff 高亮。hunk 外前文未知时只提供局部语法高亮，不读取磁盘猜测上下文。

### 5. 计算预算、缓存与生命周期

浏览器 Worker 处理 Markdown，服务端 Worker 处理历史文件与导出，主线程只安排任务和呈现结果。共享算法与样式映射，环境适配分开。默认每个环境一个串行计算 Worker，空闲 1 秒释放 Worker，保留有界 token 缓存，避免 CLI 导出进程悬挂；任务队列最多 8 项，超出时保留可见任务并降级其余项。

初始计算上限为每份源文本 UTF-8 256KiB 或 5,000 行，任一超过即纯文本；每个任务计算超时 1 秒终止并重建 Worker。加载语法与计算超时分别处理，加载失败可读性不受影响。缓存按文本摘要/语言/主题/引擎版本隔离，服务端增加会话与脱敏身份；LRU 最大 128 项且序列化 token 总计最多 16MiB，单项超过总预算不缓存。会话删除清理相关缓存。

流式代码高亮最短更新间隔 150ms、每块最多一个待执行最新版本；未闭合 fence 允许降级，完成块复用缓存。任务用会话、块、内容版本关联，切换会话、取消或卸载后丢弃迟到结果。这些是实施默认值，测量后可调整，但不能取消有界性或回退行为。

## Risks / Trade-offs

- [七语种包不小] → 首屏排除高亮实现，语言懒加载；实测生产 chunk 和首次请求，禁止 CDN。
- [语言正则可能长时间执行] → 输入限额加可终止 Worker，不用主线程计时器冒充抢占。
- [历史内容脱敏后无法对齐] → token 与展示文本逐行一致性检查，降级仍保留证据入口。
- [JS 引擎或主题在浏览器表现有差异] → Chromium/WebKit 与生产 CSP 下验证，不支持则纯文本。
- [扩展 diff fence 只有片段] → 明确局部高亮边界，不能宣称与完整源文件语法状态一致。
- [预算造成大文件无语法色] → 仍保留 diff 增删、分页和原文，优先保证阅读和交互。

## Migration Plan

只新增展示层与可选 API 字段，不迁移 Journal；旧客户端忽略新字段，旧历史缺失引用时降级。实施完成后运行相关单元/浏览器/导出/安装包检查与 OpenSpec 严格验证。回滚可删除高亮接入和依赖，纯文本仍可使用。

## Sources

- https://shiki.style/guide/sync-usage
- https://shiki.style/guide/grammar-state
- https://shiki.style/guide/regex-engines
- https://shiki.style/guide/bundles
- 官方 npm registry：Shiki 4.4.3，查询与安装日期 2026-09-16。

## Implementation Validation

实际接入后的验证见 `docs/validation/code-syntax-highlighting/README.md`，包含生产分包、Chromium/WebKit、流式取消、缓存复用、离线导出和最低 Node 版本安装包验收。上方探索阶段记录保持为当时的实验结果。
