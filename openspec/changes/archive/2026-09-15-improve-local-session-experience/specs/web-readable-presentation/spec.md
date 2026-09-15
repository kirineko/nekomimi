## MODIFIED Requirements

### Requirement: 简洁品牌与对话布局

系统 SHALL 使用 Nekomimi 页面品牌，移除重复教学说明，优先呈现消息、任务状态和必要操作，保留窄窗口操作能力。

#### Scenario: 查看会话

- **WHEN** 用户打开会话
- **THEN** 能直接阅读消息和使用提交/取消；工具参数默认折叠，错误仍可见。

## ADDED Requirements

### Requirement: 统一产品命名

系统 SHALL 使用 Nekomimi 作为产品展示名称、nekomimi 作为发布命令名称，并同步当前帮助与使用文档。更名 SHALL 保持旧历史及 bundle 可读，不机械修改历史证据与协议标识。

#### Scenario: 安装与历史兼容

- **WHEN** 用户安装新版并执行 nekomimi 命令，或读取旧版导出的会话
- **THEN** 命令可用且帮助展示新名称，旧会话仍可验证和读取；默认用户数据使用 .nekomimi 目录。
