# 10.4 管理页面完成映射

任务 10.4 已完成，验收以当前 `management-browser-final.log` 的 45 项综合浏览器结果及各子报告为依据；未提交、未归档、未发布。全量浏览器/平台/安装包验收仍由第 11 组完成。

| 需求/入口 | 实现与证据 |
| --- | --- |
| 八类模型用途与自定义配置 | `models.tsx`、`model-profile-editor.tsx`；`models-progress.md`，最终 model-settings 的用途隔离、凭证可用性、草稿与失败清理检查 |
| 能力目录、权限及候选 | `resources.tsx`、`candidate-management.tsx`；`resources-candidates-progress.md`，最终版本变化、授权修订冲突、目标归属、启用/回退/导出检查 |
| MCP 授权与诊断 | `mcp-management.tsx`；`mcp-progress.md`，最终授权/回调/断开与过期配置检查 |
| 能力包 | `package-management.tsx`；`packages-progress.md`，最终审阅安装/回退、导出、不覆盖、卸载和缓存引用检查 |
| 持久工作流 | `workflows.tsx`、`workflow-controls.tsx`；`workflows-progress.md`，最终等待重启、未知结果不重放、迁移及取消后 RPC 排空检查 |
| 显式面板管理 | `panels.tsx`；`panels-progress.md`，最终 iframe/操作/卸载同目标、预览不写、刷新不重挂检查 |
| 高级模型与历史分支 | `model-advanced.tsx`；`advanced-models-progress.md`，最终迁移保留用途、Work/Create 丢失回执去重、reasoning 明确省略检查；核心目标身份有单元证据 |
| 基础设置与默认凭证 | `settings.tsx`；`settings-progress.md`，最终启动覆盖区分、冲突保留草稿、凭证脱敏、窄屏和实际保存检查 |
| 主题与恢复 | `themes.tsx`、`theme.tsx`、`theme-css.ts`；`themes-progress.md`，最终范围、预览、继承、冲突、撤权、字体回退与恢复失败检查 |

所有表内文件路径以 `src/web/v2/routes/` 为默认，theme.tsx/theme-css.ts 位于 `src/web/v2/`。服务端写入仍由既有权限、版本、目标身份及 Journal 契约控制。

当前综合结果：45 项浏览器全部通过；新增主题 13 项定向单元全部通过；完整 `npm run typecheck`、生产构建及 `openspec validate --all --strict`（43 项）通过。历史子报告记录当时的工作树摘要和更广的相关后端检查；不将不同快照的重复测试简单相加。最新快照摘要见 `completion-manifest.json`。

10.9 仍须完成默认入口切换、旧页面/样式清理、完整 slots/宿主 bridge 接入与综合 UI 风险；10.7 仍须处理已发现的跨响应式断点局部状态重置。以上不属于已完成的管理页专项通过声明。
