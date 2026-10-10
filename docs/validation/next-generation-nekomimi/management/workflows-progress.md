# 10.4 持久工作流管理进展

新工作流页接入工作模式、全局创造目录及绑定创造目标。保留启动、继续、取消、持久等待回答、未知结果核对/显式重试、定义迁移、待办补投和证据/附件读取；控件采用共享设计系统，模式及目标在服务端再次约束。查看、刷新和页面恢复不推进工作流。

启动/迁移携带当前展示的定义版本；启动输入及等待回答使用内容关联的命令 ID，不自动重试。轮询保留未提交表单。未知结果核对不重跑外部效果，授权新尝试成功后清除重试勾选。迁移保留原证据、使旧等待失效且不自动推进新步骤。

## 本批发现并修复

- 工作流等待事件可能早于执行进程收尾：新增目标级 workflowBusy 展示与轮询；回答、继续和迁移等等待宿主释放，取消仍可达。首次创造目标迁移测试因此失败，修复后通过。
- 取消扩展进程后，其发起的宿主工具 RPC 仍可能收尾。此前 Journal 提前关闭导致一条 EBADF 诊断，尽管当时浏览器断言全通过。本批未把该日志当完整通过：ExtensionProcess 现在跟踪回调所属宿主服务，停止新服务并等待在途结果/失败记录完成，再结束调用。加强测试要求真实 bash 工具已开始，工具终态 seq 早于 workflow.cancelled；最终无该诊断。
- 新增「工作流」链接使旧测试对「工作」的子串匹配有歧义。改为精确匹配模式链接，未移除导航或主题断言。

## 最终验证

| 检查 | 结果 | 证据 |
| --- | --- | --- |
| 类型检查 | 退出 0 | `workflow-page-types-final.log` |
| 构建 | 退出 0 | `workflow-page-build-final.log` |
| 工作流及工作台浏览器测试 | 15 通过 | `workflow-page-browser-drained.log` |
| 工作流、模式、进程及验证取消回归 | 56 通过 | `workflow-page-unit-drained.log` |
| 严格规格 | 43 通过 | `workflow-page-spec.log` |
| 差异空白检查 | 退出 0 | `git diff --check` |

浏览器文件 `workflow-management.spec.ts`、`v2-workbench.spec.ts`。5 项新场景：重启恢复等待表单、单次显式回答、未知效果核对不重复写文件、定义变化拒绝且保留输入、创造目标内迁移及证据作用域、运行中取消与工具终态顺序（部分场景组合于同一测试）。验证 360px，既有工作台的缩放/焦点/导航检查一并通过。

单元文件：`customization-workflow.test.ts`、`customization-durable-workflows.test.ts`、`mode-policy.test.ts`、`customization-process.test.ts`、`customization-validation-cancel.test.ts`。

初次日志完整保留：`workflow-page-browser.log`（11/13，选择器歧义），`workflow-page-browser-final.log`（13/14，收尾门禁），`workflow-page-browser-verified.log`（15 通过但有 EBADF，不能作为最终完整证据）。最终 strengthened 检查见 drained 日志，不复用旧成功结论。

环境 macOS arm64 / Node v24.15.0；真实本地服务、进程、文件及持久 Journal 夹具，不调用真实模型。精确工作树和日志摘要见 `workflows-manifest.json`。10.4 仍未勾选，总进度 72/89；面板及高级模型入口、全 UI 收编与最终验收仍待完成。
