## ADDED Requirements

### Requirement: 移除主动网页抓取并保留历史
系统 SHALL 不再向模型提供 web_fetch 工具或其调用指导，不执行网页抓取或检测抓取代理；网页搜索仍按既有配置提供。已有 fetch 记录 SHALL 保留原状态、来源及证据入口，重开、导入和导出 MUST 不执行网络抓取或改写 Journal。

#### Scenario: 新任务工具集
- **WHEN** 用户发起任务，无论是否启用网页搜索或配置过抓取代理
- **THEN** 模型工具定义与指导均不包含 web_fetch，启用时 web_search 仍可用；过时的 web_fetch 调用按未知工具处理且不请求目标网页。

#### Scenario: 查看旧抓取证据
- **WHEN** 用户重开或导入含成功、失败、取消及截断抓取记录的历史，或导出离线 HTML
- **THEN** 仍能查看原状态、来源和已保存 artifact，缺失证据保留错误提示，不执行抓取或代理检测。
