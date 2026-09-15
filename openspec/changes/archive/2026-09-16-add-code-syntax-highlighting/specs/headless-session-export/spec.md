## ADDED Requirements

### Requirement: 自包含离线语法高亮

系统 SHALL 在离线 HTML 中为受支持的 Markdown 代码块和已确认文件 diff 提供与 Web 相同语言、主题及历史来源规则的高亮；所需样式 SHALL 随 HTML 内嵌，无需脚本、服务或网络。导出 MUST 在脱敏后生成展示，保留失败、未知结果、截断和证据缺失的现有语义；高亮失败或超预算 SHALL 回退可读文本，不阻止完整导出。

#### Scenario: 断网阅读
- **WHEN** 用户断网打开包含 Markdown 代码块和已确认文件 diff 的导出
- **THEN** 语法颜色与增删标识可见，不执行脚本或请求外部资源，代码与对应历史证据一致。

#### Scenario: 脱敏与失败降级
- **WHEN** 导出含被移除的敏感内容、损坏历史源文件或超预算代码
- **THEN** token 与 HTML 不恢复敏感原文，可用内容仍导出并按需降级，源 Journal 不变。
