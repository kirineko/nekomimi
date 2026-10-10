# 核心候选托管启动与安装租约（任务 8.4）

环境：macOS arm64 / Node v24.15.0；基线 commit be50c5a8a1557ef160056b964cd29e65b395685d，验收对象为未提交工作树，最终文件摘要另见 managed-manifest.json。

## 实现

- CoreInstallation 以规范化后的 CLI 入口生成安装身份，独立注册 Journal 位于用户 HOME 下；不使用工作区或显式数据 --home 分割安装租约。入口符号链接归一，首次只读诊断不创建注册。
- core launch-info 重新核对构建，返回具体 Node 可执行文件和参数数组，准确报告当前 unmanaged、不能切换。源码和未支持平台给出手动候选启动路径，不写 PATH、shell 配置或 npm 全局安装。
- 编译后 Linux/macOS core launch 需要可信授权、通过验证的 validationId 和确切产物 revision；取得安装 writer 后记录意图，薄父进程启动真实候选 Web 子进程，核对实际构建及 HTTP 健康，再写 selected。父进程在整个生命周期持有安装租约。
- 浏览器令牌仅通过 IPC 交给父进程并输出给调用用户，不进入启动 Journal。独立候选产物不覆盖原安装；启动本身不提交模型或业务工具，后续用户工作遵循普通 Web 行为。
- 同安装并发启动拒绝；SIGINT/SIGTERM 及 writer 失效请求有界进程组终止。子进程失去父 IPC 后关闭服务；在模块加载阶段失联则不调用 startWeb。不能确认清理时报告 unknown。
- 本项提供显式受管启动及选择事实，8.5 的运行中切换/全空闲门禁和 8.6 的指针恢复/兼容回退继续独立实施，不宣称已完成。

## 验证

managed-complete.log：5 文件 24 项通过，包括真实受管 Web 子进程、规范路径别名租约竞争、授权/过期收据拒绝、非托管只读启动指引、实际构建身份、令牌不入 Journal、停止后进程组/端口清理、模块加载期间父 IPC 断开零启动，以及构建/独立验证/CLI 回归。单元装配测试对构建与验证查询使用明确 fixture；真实 source → build → validation → managed CLI 全链路单独记录，不以 fixture 替代真实构建证据。

正式 CLI 真实源码闭环通过，见 managed-source.log、managed-source-receipt.json 和 managed-build-validation-receipt.json：source → build → isolated validation → managed launch → concurrent launch busy → SIGTERM → port closed，全链路退出码 0。实际候选 build 为 df15bd1ff91940dc2357df5f4b21955775ba67179c9fcc4ef1a501a745ff87e2，启动 92f088fe-7edf-4581-a4bc-8846b0f03fa5。链路后两处收尾修正为 unknown 清理不显示已停止、正常用户运行保留 Web 默认命名行为；最终快照重建后 managed-final.log 的 3 文件 14 项真实进程定向回归通过，未新增真实模型命名调用；源码候选保留原始构建快照身份，不把不同构建标成相同。未修改真实安装或用户 PATH，不发布、不调用真实模型。Linux/最低 Node 保留到最终平台矩阵；Windows 明确暂缓。

类型检查、最终构建退出码 0；严格规格 43 项通过，git diff --check 通过。8.4 已完成，清单当前 68/89。
