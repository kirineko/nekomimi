## MODIFIED Requirements

### Requirement: 任务输入与继续

系统 SHALL 提供会话列表、多行输入、明确提交操作和结果显示，并允许终态后以新任务继续同一会话。Enter SHALL 发送非空内容，Shift+Enter SHALL 换行；输入法组合期间及选词确认不得发送。按钮提交与键盘提交采用同一去重和繁忙校验。

#### Scenario: 完成后继续

- **WHEN** 用户创建会话提交任务，完成后发送后续消息
- **THEN** 时间线保留前轮内容并新增本轮，后续模型请求使用正确历史，不创建无关联的新会话。

#### Scenario: 回车与换行

- **WHEN** 用户在非组合输入状态按 Enter 或 Shift+Enter
- **THEN** Enter 提交一次非空任务，Shift+Enter 插入换行；长按、空文本、繁忙或确认中不会重复提交，失败时保留输入。

#### Scenario: 中文输入法

- **WHEN** 用户通过 Enter 确认中文候选词
- **THEN** 仅完成选词，不发送任务；组合结束后的独立 Enter 才发送。
