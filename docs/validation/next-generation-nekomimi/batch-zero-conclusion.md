# 批次0结论与生产迁移边界

## 路线与权威

按用户决定，唯一目标为 Pi Durable 1.0.4 + Nekomimi Journal Storage。每批公开 StorageWrite 先由 MemoryStorage.prepareCommit 校验，写入一个可靠 durable.commit，再更新可丢弃内存投影。框架seq与Journal seq分别关联；不建原生Durable持久store，不自动回退Agent。

未知工具不自动重跑。只读恢复只inspect；新用户命令先记录unknown、撤回旧队列并abortTask，最后允许调度。未验证custom任务拒绝；公开Context绑定Journal.failure，失败等待不得永久悬挂。模型经产品RecordedCall入口冻结bytes/hash，禁止隐藏重试，原始流按持久化背压读取。七项证据见`durable/journal-adaptation.md`与`durable/admission-manifest.json`。

## 精确目标依赖

| 边界 | 目标版本 | 准入与接入决定 |
| --- | --- | --- |
| Durable / Chord | 1.0.4 / 1.0.4 | 已固定源码依赖；生产Harness入口在第2组迁移 |
| Pi AI | 1.0.4 | 公开模型/Provider接口；保持DeepSeek Responses原始items/请求保真，迁移完成后移除旧0.85.1 |
| Pi Codemode | 1.0.4 | 公开VM及分发worker/WASM，子工具必须走产品统一门禁 |
| Pi MCP | 1.0.4 | 单连接owner；resource/prompt/订阅/OAuth按已测矩阵保留协议适配 |
| React / Vite | 19.3.0 / 8.3.0 | 保留现有SPA服务 |
| Radix Dialog / Slot | 1.2.0 / 1.4.0 | 共享键盘与焦点控件，shadcn源纳入仓库维护 |
| Tailwind / Vite插件 | 4.3.3 / 4.3.3 | 语义tokens |
| TanStack Query / Router / Virtual | 5.104.1 / 1.170.41 / 3.14.13 | 查询、路由、长列表各自负责状态 |
| react-resizable-panels | 4.14.2 | 保留三栏、键盘调整与窄屏壳 |
| cva / clsx / tailwind-merge | 0.7.1 / 2.1.1 / 3.7.0 | 共享组件最小样式辅助 |

暂时同时存在生产Agent/AI0.85.1与新增Durable1.0.4，仅供分阶段实现，不视为最终兼容接口；第2组必须删除旧循环并检查业务类型边界。前端固定依赖与许可证见`ui/package-lock.json`和`ui/licenses.json`，生产依赖按实际使用接入，不批量安装未使用组件。

## 允许和拒绝

允许经公共fetch捕获的已验证chat/classifier/image路径；没有记录准入的Provider/API在派发前拒绝。虚拟路由默认关闭，低层Models没有公开注册入口，不用内部Coding Agent机制补载。不能用reference源码修补缺失发布资产。

旧持久化与SDK格式不给隐式兼容：使用独立新目录，拒绝执行前旧文件不变。不能把可信shell称为强沙箱，不允许回放/导入启动工具或工厂；核心候选阶段不执行npm/GitHub发布。

## 视觉与验收映射

用户已批准高对比明暗样稿、轻量猫系品牌点缀和三栏双工作台布局；完整tokens在`ui/styles.css`，六状态/窄屏截图在`ui/screenshots-high-contrast/`。样稿明确为模拟，不替代生产服务和工作台验收。

`build-coverage.py`为26份delta、87个Requirement、186个Scenario逐项生成第2–11组验收去向，产物为`coverage.json`与`coverage.md`。该映射证明不存在未安排场景，不宣称目标行为已实现。仅实际验证后勾选任务；第11组执行完整生产、安装包与平台验收。

目前证据主要为macOS arm64/Node22.19.0和24.15.0；Linux仍须记录，Windows按项目暂缓。实际模型费用、质量与人工介入未测；未获单独授权时不调用真实模型，最终记录缺失报告。
