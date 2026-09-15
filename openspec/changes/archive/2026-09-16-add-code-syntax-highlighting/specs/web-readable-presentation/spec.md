## ADDED Requirements

### Requirement: Markdown 代码语法高亮

系统 SHALL 为声明支持语言的 fenced code block 显示关键字、字符串、注释等语法颜色，至少支持 JavaScript、TypeScript、TSX、Python、JSON、Shell 和 diff，并识别常用别名。无语言、未知语言或高亮失败 SHALL 保留纯文本。高亮 MUST 保留代码内容与现有安全 Markdown 行为，不执行代码、HTML 或脚本，不请求外部高亮资源。

#### Scenario: 常用语言与不可信代码
- **WHEN** 用户阅读带 ts、tsx、python、json、bash 标记且包含 HTML 字符串的代码块
- **THEN** 语法颜色可见，代码作为文本展示，原文未被改写，HTML 不执行，现有 CSP 无需放宽。

#### Scenario: 未知语言与失败
- **WHEN** 代码块没有语言、语言不受支持或高亮模块加载失败
- **THEN** 仍完整展示允许展示的代码内容，不影响回答其余部分或出现未处理错误。

#### Scenario: Markdown diff fence
- **WHEN** 回复包含普通 diff 或 diff-ts 等声明源语言的 diff fence
- **THEN** 普通 diff 区分增删和块头，受支持源语言的可解析片段叠加源代码语法色并保留增删符号，无法识别的内容安全降级，不从当前磁盘补齐前文。

### Requirement: 高亮计算有界且不覆盖新内容

系统 SHALL 限制高亮输入、计算、队列及缓存规模；流式更新 SHALL 合并过期计算，超预算时回退原有文本展示。取消、会话切换及新文本到达后，过期高亮 MUST NOT 覆盖当前内容。高亮结果 MUST NOT 改写持久化历史或模型上下文。

#### Scenario: 大代码块与流式追加
- **WHEN** 回答持续追加代码或代码超过高亮预算
- **THEN** 提交、取消和页面导航仍可操作，文本继续展示，已完成代码块不因无关增量反复全量计算。

#### Scenario: 迟到结果与重新打开
- **WHEN** 高亮尚未完成时切换会话或取消，随后重新打开已保存会话
- **THEN** 迟到结果不污染新页面，重新打开可从原历史重建展示，原文与 Journal 保持不变。
