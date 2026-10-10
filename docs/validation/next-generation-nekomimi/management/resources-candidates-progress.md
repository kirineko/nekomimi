# 10.4 能力、权限与候选管理进展

本批为未提交工作树快照；任务 10.4 仍在进行，总进度 72/89。精确基线、环境、源码和日志摘要见 `resources-candidates-manifest.json`。模型页此前证据见 `models-progress.md`。

## 已实现

- 新增全局 `/v2/create/resources` 和绑定目标 `/v2/create/session/:sessionId/resources`，模型页与创造导航提供文字入口。全局目录可读取和撤销，新增授权/校验/重载需绑定创造目标。筛选保持独立状态，刷新不重置筛选。
- 能力卡显示来源、发现/活动版本、当前版本所需/已授权限、遮蔽、诊断和验证记录。确认框冻结展示与请求，不随刷新偷偷替换同意内容；取消恢复焦点，不发写命令。授权内容改变及设置修订冲突均拒绝，修订冲突返回明确 409 和可操作说明。
- 资源启用、撤销、静态校验、重载、用户目录写入授权使用共享控件和显式确认。加载收据按 pending 状态只读刷新；页面读取和取消不执行工厂。
- 候选新增「启用与导出」页签，分别显示选择版本与活动版本。启用要求当前静态验证并确认目标、内容摘要、权限及两个修订；仅修改开发目标，不安装到工作项目。
- 回退视图只读加载不可变旧内容并报告其真实权限，损坏时明确不可读。回退提交核验目标 hash、活动修订和授权修订；并发授权变动不能借用旧确认。
- 导出明确路径与内容摘要，不执行工厂，不覆盖已有文件；失败保留路径与错误，写入不自动重试。候选失败时保持确认框错误可读，重新读取候选由用户显式触发。

## 验证

最终源码停止修改后运行：

| 检查 | 结果 | 日志 |
| --- | --- | --- |
| `npm run typecheck` | 退出 0 | `candidate-management-types-final.log` |
| `npm run build` | 退出 0 | `candidate-management-build-final.log` |
| 浏览器 5 文件 | 30 项通过 | `management-browser-final.log` |
| 服务端 5 文件 | 17 项通过 | `management-unit-final.log` |
| `openspec validate --all --strict` | 43 项通过 | `management-spec-final.log` |
| `git diff --check` | 退出 0 | 无输出 |

浏览器文件：`candidate-management.spec.ts`、`resource-management.spec.ts`、`create-candidates.spec.ts`、`model-settings.spec.ts`、`v2-workbench.spec.ts`。新增场景检查导航/取消零写入与零工厂初始化、绑定目标隔离、资源内容变化、授权修订冲突不重试、筛选、无效目标、360px、候选验证/确认/收据、导出不覆盖、回退旧权限与并发授权冲突、候选内容变化拒绝。资源实际工厂写入计数来自本地夹具；未调用真实模型。

服务端文件：`candidate-view.test.ts`、`customization-candidate-trial.test.ts`、`customization-lifecycle.test.ts`、`create-target-scope.test.ts`、`customization-server.test.ts`。覆盖只读视图无编译/写入、生命周期、候选试运行和目标作用域。

`resources-360.png` 为真实浏览器窄屏检查截图。当前环境 macOS arm64 / Node v24.15.0；不代表最终 Linux/最低 Node 检查。

## 初次失败与修正

保留原始日志，不隐藏失败：

- `resources-types-2.log`：新增 refetchInterval 导致泛型推断为 `{}`；显式指定查询 DTO 后类型检查通过。
- `resources-browser.log`：8 通过、1 失败。旧修订被服务端拒绝，但普通 Error 被 HTTP 层转为通用提示。改用带安全错误码的 409，并验证页面显示「授权修订已变化」；最终全组通过。
- `candidate-management-browser.log`：6 通过、1 失败。测试将「等待加载完成」误匹配为「加载完成」，过早读取活动指针；改为精确终态文本匹配，继续核验真实活动指针及工作项目未变。最终全组通过。

## 尚未完成

能力包安装/回退/导出/清理、MCP 授权、工作流与诊断专页，以及原 UI 的高级模型与其它管理入口仍待整合。10.4 不勾选；完整管理能力保留及旧页面清理还需 10.9 综合验收。本批不归档、不提交、不发布。
