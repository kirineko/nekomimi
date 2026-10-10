## MODIFIED Requirements

### Requirement: 有序且可关联的证据

系统 SHALL 为每个会话保存版本化且单调递增 seq 的事件，并使用稳定 ID 关联 run、model call、attempt 和工具调用。

事件 SHALL 关联所属模式、目标和存在时的父调用、交接、候选及验证任务身份。跨会话关联使用稳定引用而非时间排序推断；唯一权威提交记录 SHALL 足以重建这些关系，运行框架和展示缓存不得另有独立权威状态。

#### Scenario: 有序且可关联的证据验收

- **WHEN** 并发产生模型流和工具输出
- **THEN** 事件不交错损坏，同一会话 seq 唯一且递增，调用关系可从 ID 重建。

#### Scenario: 嵌套调用与交接
- **WHEN** 创造会话的脚本包含多个工具并向工作会话交付
- **THEN** 每个子调用和交付均可由稳定 ID 回溯，父调用费用/状态汇总不覆盖子调用事实。

## ADDED Requirements

### Requirement: 格式版本与旧数据保护
系统 SHALL 在写入前验证存储格式与宿主支持范围；不支持的旧格式只返回诊断，不自动迁移、删除、重算 hash 或执行其扩展。新目录的创建需要明确目标选择。

#### Scenario: 拒绝旧格式
- **WHEN** 以新宿主打开旧格式会话目录
- **THEN** 返回不兼容及独立目录指引，旧目录所有原始文件保持不变。

### Requirement: 运行任务的可靠状态
模型、工具、验证与版本切换任务 SHALL 区分已接受、运行、请求取消、已确认终态和 unknown，并在可靠提交后公开相应水位；历史恢复不得仅因任务持有 replay-safe 标注而重跑结果未知的工具。

#### Scenario: 安全标注与未知写入
- **WHEN** 工具标注安全但上次执行结果未持久化
- **THEN** 恢复仍显示 unknown，不自动执行，需核对实际状态及新的明确请求。

### Requirement: Durable 单一提交映射
系统 SHALL 将 Durable 的每批 StorageWrite 原子映射为唯一 Journal 中的版本化提交，保留框架提交 seq 与 Journal 可靠水位关联；任务、条目及文档投影仅由可靠批次重建。内存投影 SHALL 可丢弃；MUST NOT 另写原生 Durable session store 作为权威。校验、持久化或投影发布失败 SHALL 阻止当前实例后续派发与成功发布。

#### Scenario: 多项提交落盘失败
- **WHEN** 一批任务、条目及文档写入在Journal或水位提交阶段失败
- **THEN** 不对外发布该批可靠成功，当前实例不可继续派发；重开只恢复已确认水位内的整批写入，不出现半批状态。

#### Scenario: 删除读取投影后重开
- **WHEN** 丢弃全部Durable内存状态并仅从Journal及附件重开
- **THEN** 恢复相同已提交任务、条目、文档与关联，框架seq与Journal水位可追溯，不创建第二份权威文件或执行模型工具。
