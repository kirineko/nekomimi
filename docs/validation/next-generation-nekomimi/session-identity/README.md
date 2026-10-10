# 模式与目标创建身份

任务3.1完成。验证为当前未提交工作树、macOS arm64、Node24.15.0、本地假Provider及实际HTTP/扩展子进程；未调用真实模型。工作/创造能力过滤、宿主资料和授权范围仍由3.2/3.3实施。

## 实现

共享协议包含SessionBinding/SessionCreation/SessionTarget/TargetHost。会话首条durable.session与session.created固定mode、规范根目录、目录device/inode、scope及创造宿主构建/SDK/数据版本。服务路径ID与所有Journal事件sessionId一致，运行/模型/工具继承mode和targetId。

创建命令由工作区session-catalog Journal协调：intent固定身份，然后写会话身份及标题，最后committed。同一ID内容冲突拒绝；四个持久阶段中断后，同ID只补齐元数据，不重复创建/命名/调模型。显式headless创建命令共用该命名空间，改变会话位置同样冲突。运行任务有独立command/run身份，重提创建不重复任务。

创建收据与标题按现有key及Provider凭证脱敏。删除标记保留，旧创建ID不复活会话；缓存列表隐藏逻辑删除项，重试可以完成剩余物理清理。这里验证了元数据阶段故障注入，不将它冒充真实进程SIGKILL；交接的真实kill门槛由3.5继续。

只读观察显示目标不可用；执行前及模型/工具准备时检查目录身份。目录被删除或被相同路径的新目录替换均拒绝，不回退到服务cwd。提供其他目录的CustomizationHost也在工厂获取前拒绝。原历史分支保留来源，同时建立独立的新绑定；无绑定历史只能观察，不能继续运行。

新工作台创建请求携带固定commandId和mode=work，失败重提保留ID，收据成功后才清除；列表按模式过滤。提交接口拒绝通过payload改写mode/target。

## 证据

- dispatch-verification.log：3文件31项通过；当前session-identity.test.ts共18项，包含真实创建任务写入指定开发目录、目录替换后工具零派发、工厂前宿主拒绝、HTTP并发/重启去重、四阶段中断、headless位置冲突、凭证脱敏、删除回执恢复；另有统一工具管线及实际RPC子调用回归。
- submit-verification.log：2文件28项通过，包含当时16项身份测试与12项主HTTP契约；随后增加两项派发门禁测试。
- receipt-secret-regression.log：3文件55项通过；相关提示和本地体验检查保留。
- related-regression.log：8文件79项通过，含Journal、Durable真实崩溃恢复、导航/诊断/上下文服务。http-provider-regression.log：3文件44项通过。各组有重叠，不汇总为唯一测试总数。
- browser.log：仓库既有Chrome新工作台4项通过（深链接刷新/无效目标、只读模式导航、IME/命令/提交去重/删除/焦点、SSE及重连）。未重新宣称全浏览器门槛通过。
- typecheck.log、build.log通过；spec-validation.log严格43项通过。

首次失败包括错误响应wrapper断言不匹配、删除诊断文字以及缺少新模式绑定的历史分支夹具；原日志保留。修正夹具的版本身份后保留原环境来源/隐藏气泡与原始历史断言，没有放宽生产校验。

## 剩余范围

当前会话身份已固定，创造入口可执行到所选开发目录。工作模式实际工具过滤、HTTP管理操作模式门禁、资料/核心源码检查、两会话交接、独立并发取消与正式创造UI尚待后续任务。没有归档或发布。
