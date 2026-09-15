# core-tools Specification

## Purpose

提供模型易于调用的基础文件和命令工具，同时让用户检查真实参数、输出和文件变化，保留完整执行证据，并防止过期读取导致无提示覆盖用户修改。

## Requirements

### Requirement: 基础工具与有界结果

系统 SHALL 提供 read、edit、write 和适配实际 shell 的命令工具；模型结果有界，完整证据独立保留。

#### Scenario: 基础工具与有界结果验收

- **WHEN** 读取超长文件或运行大量输出命令
- **THEN** 模型收到截断标记与后续读取指引，完整输出可由附件检查。

### Requirement: 文件修改保护

系统 SHALL 对既有文件要求已读取且版本匹配；edit 的 edits 在同一原始版本唯一匹配且互不重叠，否则不做部分修改。

#### Scenario: 文件修改保护验收

- **WHEN** 文件被外部修改，或替换文本重复匹配
- **THEN** 修改被拒绝并给出重读或消歧建议，文件保持执行前内容。

### Requirement: 工作区文件边界

系统 SHALL 拒绝文件工具通过父路径或符号链接访问工作区授权范围之外的文件。

#### Scenario: 工作区文件边界验收

- **WHEN** read 或 write 路径经符号链接指向工作区外
- **THEN** 工具返回范围错误，未读取或修改目标内容。

### Requirement: 命令证据及取消

系统 SHALL 记录实际 shell、cwd、参数、stdout/stderr 通道和接收顺序、退出状态；取消请求与进程实际结束分开。

#### Scenario: 命令证据及取消验收

- **WHEN** 运行持续输出的命令并取消
- **THEN** 完整输出仍可检查；进程未结束时不得显示已停止，结束后记录实际状态。

### Requirement: 精确匹配语义

系统 SHALL 默认拒绝只有经过 Unicode 引号或空白模糊归一化后才匹配的 edit；保留原文件 BOM/换行并记录实际修改区间。

#### Scenario: 模型提供的引号与原文不同

- **WHEN** oldText 使用直引号而原始文本对应位置为弯引号，且不存在精确匹配
- **THEN** 返回匹配失败并保留原文件，不按隐藏的模糊回退修改。

### Requirement: 取消清理进程组

系统 SHALL 在取消或超时后完成 shell 进程组的强制终止流程，即使 shell 及其输出管道先于后台子进程关闭，也不得提前撤销清理。

#### Scenario: 后台子进程忽略 SIGTERM

- **WHEN** 后台子进程忽略 SIGTERM 且重定向 stdout/stderr，用户取消任务或命令超时
- **THEN** 系统完成进程组强制终止后才记录 shell.finished 并返回；子进程不能继续修改工作区。
