# 核心切换空闲门禁（任务 8.5 的实施中证据）

本文件保留 8.5 前半阶段的空闲与派发保留证据。完整候选确认、托管切换、幂等收据及 UI 实际身份已在后续批次验证，见 `switch-control.md`；任务现已完成，整体 69/89。

## 已实施

- HTTP 写请求在读取 body 前登记；异步检查前同步设置 fence，阻止检查期间出现新的业务写入。相同命令重复准备等待原检查，不提前返回 ready；其它命令不能释放该 fence。失败恢复准入。
- Sessions 在元数据串行 gate 内检查全部工作/创造运行、后台命名、交接准备、下载和审批，以及已加载目标宿主的 pending 变更、busy/degraded 和工作流 queued/ready/running/waiting/unknown。已完成或取消的工作流不阻塞；状态不可读明确阻止。
- 工作流 listReadonly 不创建目录，不加载工厂，不改动历史；常规 list 也复用此只读投影。
- 成功准备同时锁住 HTTP 与直接会话准入。只读 coreSwitchStatus 可供预览，但不能替代实际取得门禁。
- coreOperationBlockers 只读观察构建/验证 Journal 和租约，租约不是 PID 活着的证明。reserveCoreOperations 持有真正派发前使用的两份 Journal writer，阻止独立 CLI 抢入；无终态、unknown、缺少已启动 PID 的清理记录或端口未关闭均阻止，未知操作不重跑。

## 验证进度

switch-gate-complete.log：首批 5 文件 39 项通过，覆盖真实 HTTP 慢 body、会话直接准入、实际挂起模型任务的取消、实时审批、持久工作流等待、原工作/创造独立运行及 Durable 工作流回归。

switch-gate-first.log 保留初始失败：慢请求测试先抢到 fence、导致请求在登记前即被拒绝；工作流 fixture 使用了不合法的非 UUID 目录。修正为通过只读状态协调请求已进入，以及使用有效 UUID，未削弱门禁断言。

switch-fences.log：最终 6 文件 46 项通过，新增独立 Node 进程争抢相同 writer 的拒绝、部分保留失败后释放、无终态/unknown/残留端口/缺失清理证据拒绝、两个工作/创造运行分别取消，以及主任务结束后后台命名继续阻挡。类型检查、构建退出码 0，严格规格 43 项通过，git diff --check 通过。没有执行真实模型、没有切换当前安装。
