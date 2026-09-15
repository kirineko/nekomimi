# web-evidence-inspector Specification

## Purpose

提供围绕一次模型调用组织的证据检查和离线下载能力，让用户从实际请求追溯提示来源、上下文节点、工具执行及原始响应，并明确区分已验证数据、缺失字段和脱敏副本。

## Requirements

### Requirement: 请求到来源追溯

系统 SHALL 支持从调用卡片查看各 attempt 的实际请求 body/hash、context revision、有序输入节点与 Prompt 来源，并链接关联工具完整证据。

#### Scenario: 检查含工具历史的调用

- **WHEN** 用户点开工具执行之后的模型调用
- **THEN** 能从实际请求定位到本轮指令及历史输入来源，看到配对工具结果与原始 reasoning，不以展示文本替代协议。

### Requirement: 原始响应与统计

系统 SHALL 展示原始响应证据、重试原因、终态和 provider usage、缓存与延迟；缺失统计显示未知，未验证价格不得显示为实际费用。

#### Scenario: 失败与缺失用量

- **WHEN** 一次调用重试或失败且没有 usage
- **THEN** 各 attempt 可分别查看，缺失字段不显示为零消费，原始未知事件仍可读取。

### Requirement: 附件范围与完整性

系统 SHALL 有界加载附件且明确展示截断或续读入口；缺失、损坏附件不得冒充完整内容。

#### Scenario: 证据损坏

- **WHEN** 用户打开已被修改或删除的附件
- **THEN** 显示完整性或缺失错误，不能显示证据已完整加载。

### Requirement: 浏览器离线下载

系统 SHALL 对无活动运行的会话提供 HTML、完整 bundle 和显式脱敏 bundle 下载；活动运行时说明须等待停止。导出 SHALL 不改变源记录、不触发模型或工具。

#### Scenario: 导出敏感文本

- **WHEN** 用户指定需脱敏文本并下载副本
- **THEN** 副本删除指定内容且标记不可精确继续，源 Journal 不变；完整 bundle 可由现有 CLI 校验，HTML 无外部依赖。
