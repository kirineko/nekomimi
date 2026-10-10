# 最终 apply 评审报告

变更 `next-generation-nekomimi`；工作树基线 HEAD `be50c5a8a1557ef160056b964cd29e65b395685d`，实现尚未提交。**89/89 项 apply 任务已完成并验证**；最终浏览器与兼容审计已通过。此报告不授权归档或发布。

## 已实施范围

Pi AI/Durable/Chord/Codemode/MCP 固定 1.0.4，通过公开接口运行；Journal 作为唯一权威历史，模型最终请求与每次 attempt 可追踪。未知工具副作用不自动重跑。SDK 3 与数据格式 2 按准入规则拒绝不兼容状态。

工作和创造具有独立会话、目录目标和授权；交接保留来源与精确版本。项目能力经过候选检查、显式授权安装和工作会话使用，失败保留已激活版本。核心候选的构建、验证、切换及恢复独立记录，需要可信源码基线与显式授权。

正式 Web 默认 `/work`、`/create`，使用已评审的三栏、高对比、轻量猫系视觉；上下文来源、嵌套调用证据、虚拟历史、管理页和恢复入口已接入。历史阅读、回放、导入不执行模型或工具；历史面板需显式打开，当前新鲜有效面板按契约一次展示。

## 最终审计修复

删除了遗留的 HTTP 原始异常控制台调试分支；新增含模拟凭证的真实 HTTP 500 回归，先确认失败再修复通过。外层延迟加载后，浏览器测试定位限定到具体主题区域，并在关闭嵌套确认后明确等待焦点恢复；业务断言保留，两项各重复五次通过。扩展草稿确认同样增加关闭和 iframe 焦点返回断言，连续 10/10 通过。

## 最终验证

- 完整单元：133 文件，788/788，`npm test -- --maxWorkers=2`，501.27 秒。首轮默认并行 754/787，33 项均超时；23 项关键故障隔离及完整重跑均通过，原断言/超时不变。见 [最终回归](final-regression/README.md)。
- 完整浏览器：`npm run test:browser -- --workers=2`，**201/201**，3.8 分钟，exit 0；三次阶段性 200/201 失败和相应修正/重复验收全部保留，见 [最终回归](final-regression/README.md)。
- macOS arm64 与 Linux aarch64 的 Node 22.19.0/24.15.0 四组：最终同一产物完整安装运行通过。共享挂载导致的快照 ENOENT 已由独立探针复现，原生 Linux 文件系统为正式验收范围。见 [平台报告](platform-clean/README.md)。
- 实际安装包浏览器：可选界面、高亮 worker、管理页与候选差异断言通过，47 个资源请求无缺失。
- 最终类型检查通过、严格规格 43/43、发布检查 7/7 通过。

## 每个 Requirement 的验收导航

本表覆盖全部 30 个 delta 能力的 92 个 Requirement。233 个 Scenario 的 WHEN/THEN、绑定任务、准确来源及全部相关测试见 [coverage.json](coverage.json) / [coverage.md](coverage.md)。此表是人工复核入口，文件存在本身不是断言通过证据；每份报告说明运行范围与限制。

| Requirement | 任务 | 已记录证据 |
| --- | --- | --- |
| codemode-execution/R01：受限脚本环境 | 5.1 | [codemode-runtime/README.md](codemode-runtime/README.md)、[codemode-runtime/pipeline-state.md](codemode-runtime/pipeline-state.md)、[codemode-runtime/partial-failure.md](codemode-runtime/partial-failure.md) |
| codemode-execution/R02：嵌套调用统一管线 | 5.2, 5.6 | [codemode-runtime/README.md](codemode-runtime/README.md)、[codemode-runtime/pipeline-state.md](codemode-runtime/pipeline-state.md)、[codemode-runtime/partial-failure.md](codemode-runtime/partial-failure.md) |
| codemode-execution/R03：并发与部分失败 | 5.3, 5.8 | [codemode-runtime/README.md](codemode-runtime/README.md)、[codemode-runtime/pipeline-state.md](codemode-runtime/pipeline-state.md)、[codemode-runtime/partial-failure.md](codemode-runtime/partial-failure.md) |
| codemode-execution/R04：取消和未知结果 | 5.3, 5.8 | [codemode-runtime/README.md](codemode-runtime/README.md)、[codemode-runtime/pipeline-state.md](codemode-runtime/pipeline-state.md)、[codemode-runtime/partial-failure.md](codemode-runtime/partial-failure.md) |
| codemode-execution/R05：小状态与输出投影 | 5.4 | [codemode-runtime/README.md](codemode-runtime/README.md)、[codemode-runtime/pipeline-state.md](codemode-runtime/pipeline-state.md)、[codemode-runtime/partial-failure.md](codemode-runtime/partial-failure.md) |
| context-compaction/R01：非破坏性压缩检查点 | 4.6 | [compaction-source/README.md](compaction-source/README.md)、[context-ui/README.md](context-ui/README.md) |
| context-compaction/R02：默认自动压缩 | 4.5, 4.6 | [compaction-source/README.md](compaction-source/README.md)、[context-ui/README.md](context-ui/README.md) |
| context-compaction/R03：摘要原子生效与失败恢复 | 4.6 | [compaction-source/README.md](compaction-source/README.md)、[context-ui/README.md](context-ui/README.md) |
| context-occupancy/R01：有来源的当前占用 | 4.5, 10.5 | [context-ui/README.md](context-ui/README.md) |
| context-occupancy/R02：主题化明细入口 | 10.5 | [context-ui/README.md](context-ui/README.md) |
| context-selection-policy/R01：请求级选择快照 | 4.2 | [resource-context/README.md](resource-context/README.md)、[handoff-context/README.md](handoff-context/README.md) |
| context-selection-policy/R02：层次与按需加载 | 4.3 | [resource-context/README.md](resource-context/README.md)、[handoff-context/README.md](handoff-context/README.md) |
| context-selection-policy/R03：状态区分与撤销 | 4.4 | [resource-context/README.md](resource-context/README.md)、[handoff-context/README.md](handoff-context/README.md) |
| context-selection-policy/R04：预算与有界结果 | 4.5 | [resource-context/README.md](resource-context/README.md)、[handoff-context/README.md](handoff-context/README.md) |
| context-selection-policy/R05：交接数据不替代当前指令 | 4.7 | [resource-context/README.md](resource-context/README.md)、[handoff-context/README.md](handoff-context/README.md) |
| core-change-candidates/R01：隔离源码候选 | 8.1 | [core/source.md](core/source.md)、[core/build.md](core/build.md)、[core/validation.md](core/validation.md)、[core/switch-gates.md](core/switch-gates.md)、[core/recovery.md](core/recovery.md)、[core-switch-ui/README.md](core-switch-ui/README.md) |
| core-change-candidates/R02：不可变构建与分层验证 | 8.2, 8.3 | [core/source.md](core/source.md)、[core/build.md](core/build.md)、[core/validation.md](core/validation.md)、[core/switch-gates.md](core/switch-gates.md)、[core/recovery.md](core/recovery.md)、[core-switch-ui/README.md](core-switch-ui/README.md) |
| core-change-candidates/R03：显式版本切换 | 8.4, 8.5 | [core/source.md](core/source.md)、[core/build.md](core/build.md)、[core/validation.md](core/validation.md)、[core/switch-gates.md](core/switch-gates.md)、[core/recovery.md](core/recovery.md)、[core-switch-ui/README.md](core-switch-ui/README.md) |
| core-change-candidates/R04：切换故障与回退 | 8.6 | [core/source.md](core/source.md)、[core/build.md](core/build.md)、[core/validation.md](core/validation.md)、[core/switch-gates.md](core/switch-gates.md)、[core/recovery.md](core/recovery.md)、[core-switch-ui/README.md](core-switch-ui/README.md) |
| core-change-candidates/R05：启动方式诊断 | 8.4, 10.8 | [core/source.md](core/source.md)、[core/build.md](core/build.md)、[core/validation.md](core/validation.md)、[core/switch-gates.md](core/switch-gates.md)、[core/recovery.md](core/recovery.md)、[core-switch-ui/README.md](core-switch-ui/README.md) |
| customization-development/R01：版本匹配的开发入口 | 7.1, 7.7 | [sdk-runtime/guides.md](sdk-runtime/guides.md)、[sdk-runtime/verification.md](sdk-runtime/verification.md)、[project-delivery/README.md](project-delivery/README.md)、[creation-roundtrip/README.md](creation-roundtrip/README.md) |
| customization-development/R02：候选激活与回退 | 7.3, 7.4, 7.5 | [sdk-runtime/guides.md](sdk-runtime/guides.md)、[sdk-runtime/verification.md](sdk-runtime/verification.md)、[project-delivery/README.md](project-delivery/README.md)、[creation-roundtrip/README.md](creation-roundtrip/README.md) |
| customization-development/R03：候选二进制素材完整性 | 7.3 | [sdk-runtime/guides.md](sdk-runtime/guides.md)、[sdk-runtime/verification.md](sdk-runtime/verification.md)、[project-delivery/README.md](project-delivery/README.md)、[creation-roundtrip/README.md](creation-roundtrip/README.md) |
| customization-lifecycle/R01：用户能力目录与来源 | 7.6 | [sdk-runtime/candidate-origin.md](sdk-runtime/candidate-origin.md)、[create/candidate-executions.md](create/candidate-executions.md)、[project-delivery/README.md](project-delivery/README.md) |
| customization-lifecycle/R02：可操作的交付结果 | 7.4, 7.6, 10.2 | [sdk-runtime/candidate-origin.md](sdk-runtime/candidate-origin.md)、[create/candidate-executions.md](create/candidate-executions.md)、[project-delivery/README.md](project-delivery/README.md) |
| customization-release-readiness/R01：兼容与故障门槛 | 11.1, 11.2, 11.5 | [/compatibility-audit.md](compatibility-audit.md)、[creation-roundtrip/README.md](creation-roundtrip/README.md)、[/platform-matrix.md](platform-matrix.md)、[final-regression/README.md](final-regression/README.md)、[platform-clean/README.md](platform-clean/README.md) |
| customization-release-readiness/R02：可安装版本候选 | 11.4, 11.8 | [/compatibility-audit.md](compatibility-audit.md)、[creation-roundtrip/README.md](creation-roundtrip/README.md)、[/platform-matrix.md](platform-matrix.md)、[final-regression/README.md](final-regression/README.md)、[platform-clean/README.md](platform-clean/README.md) |
| execution-journal/R01：有序且可关联的证据 | 2.4, 2.5 | [durable/causality-and-recovery.md](durable/causality-and-recovery.md)、[privacy-admission/README.md](privacy-admission/README.md) |
| execution-journal/R02：格式版本与旧数据保护 | 2.1 | [durable/causality-and-recovery.md](durable/causality-and-recovery.md)、[privacy-admission/README.md](privacy-admission/README.md) |
| execution-journal/R03：运行任务的可靠状态 | 2.5, 3.7 | [durable/causality-and-recovery.md](durable/causality-and-recovery.md)、[privacy-admission/README.md](privacy-admission/README.md) |
| execution-journal/R04：Durable 单一提交映射 | 1.4, 2.2, 2.4, 2.5 | [durable/causality-and-recovery.md](durable/causality-and-recovery.md)、[privacy-admission/README.md](privacy-admission/README.md) |
| extension-process-host/R01：独立执行与兼容 | 7.1, 11.1 | [sdk-runtime/contracts.md](sdk-runtime/contracts.md)、[/compatibility-audit.md](compatibility-audit.md) |
| extension-runtime/R01：SDK 版本和命名 | 7.1 | [sdk-runtime/contracts.md](sdk-runtime/contracts.md)、[sdk-runtime/services.md](sdk-runtime/services.md)、[sdk-runtime/boundary.md](sdk-runtime/boundary.md) |
| extension-runtime/R02：统一受记录执行 | 2.6, 7.2 | [sdk-runtime/contracts.md](sdk-runtime/contracts.md)、[sdk-runtime/services.md](sdk-runtime/services.md)、[sdk-runtime/boundary.md](sdk-runtime/boundary.md) |
| local-user-configuration/R01：配置入口与凭证隔离 | 2.1, 10.4, 11.1, 11.5 | [/format-admission.md](format-admission.md)、[privacy-admission/README.md](privacy-admission/README.md)、[final-regression/README.md](final-regression/README.md) |
| mcp-context-and-auth/R01：资源与模板 | 6.4 | [mcp-runtime/content.md](mcp-runtime/content.md)、[mcp-runtime/oauth.md](mcp-runtime/oauth.md) |
| mcp-context-and-auth/R02：OAuth 生命周期 | 6.5 | [mcp-runtime/content.md](mcp-runtime/content.md)、[mcp-runtime/oauth.md](mcp-runtime/oauth.md) |
| mcp-tool-integration/R01：连接与发现 | 6.1, 6.2 | [mcp-runtime/README.md](mcp-runtime/README.md)、[mcp-runtime/discovery.md](mcp-runtime/discovery.md)、[mcp-runtime/versions.md](mcp-runtime/versions.md)、[mcp-runtime/fault-recovery.md](mcp-runtime/fault-recovery.md) |
| mcp-tool-integration/R02：工具列表版本 | 6.3 | [mcp-runtime/README.md](mcp-runtime/README.md)、[mcp-runtime/discovery.md](mcp-runtime/discovery.md)、[mcp-runtime/versions.md](mcp-runtime/versions.md)、[mcp-runtime/fault-recovery.md](mcp-runtime/fault-recovery.md) |
| mcp-tool-integration/R03：结果保真和凭证边界 | 6.1, 6.6 | [mcp-runtime/README.md](mcp-runtime/README.md)、[mcp-runtime/discovery.md](mcp-runtime/discovery.md)、[mcp-runtime/versions.md](mcp-runtime/versions.md)、[mcp-runtime/fault-recovery.md](mcp-runtime/fault-recovery.md) |
| mode-session-handoff/R01：显式且最小化交接 | 3.4 | [handoff/completion.md](handoff/completion.md)、[project-delivery/README.md](project-delivery/README.md)、[mode-handoff-roundtrip/README.md](mode-handoff-roundtrip/README.md) |
| mode-session-handoff/R02：交接幂等与恢复 | 3.5 | [handoff/completion.md](handoff/completion.md)、[project-delivery/README.md](project-delivery/README.md)、[mode-handoff-roundtrip/README.md](mode-handoff-roundtrip/README.md) |
| mode-session-handoff/R03：交付结果独立应用 | 3.6 | [handoff/completion.md](handoff/completion.md)、[project-delivery/README.md](project-delivery/README.md)、[mode-handoff-roundtrip/README.md](mode-handoff-roundtrip/README.md) |
| mode-session-handoff/R04：独立取消与上下文 | 3.7, 4.7 | [handoff/completion.md](handoff/completion.md)、[project-delivery/README.md](project-delivery/README.md)、[mode-handoff-roundtrip/README.md](mode-handoff-roundtrip/README.md) |
| model-call-evidence/R01：最终请求保真 | 2.7 | [durable/pipeline-and-model-policy.md](durable/pipeline-and-model-policy.md)、[typed-model/transport.md](typed-model/transport.md) |
| model-call-evidence/R02：逐次重试与取消 | 2.7, 5.6 | [durable/pipeline-and-model-policy.md](durable/pipeline-and-model-policy.md)、[typed-model/transport.md](typed-model/transport.md) |
| model-operation-catalog/R01：类型化模型发现 | 5.5 | [model-routing/README.md](model-routing/README.md)、[typed-model/README.md](typed-model/README.md)、[typed-model/transport.md](typed-model/transport.md) |
| model-operation-catalog/R02：宿主管理的分类与图片调用 | 5.6 | [model-routing/README.md](model-routing/README.md)、[typed-model/README.md](typed-model/README.md)、[typed-model/transport.md](typed-model/transport.md) |
| model-operation-catalog/R03：用途选择与费用口径 | 5.5, 5.6 | [model-routing/README.md](model-routing/README.md)、[typed-model/README.md](typed-model/README.md)、[typed-model/transport.md](typed-model/transport.md) |
| model-operation-catalog/R04：实验路由的明确边界 | 5.7 | [model-routing/README.md](model-routing/README.md)、[typed-model/README.md](typed-model/README.md)、[typed-model/transport.md](typed-model/transport.md) |
| pi-platform-integration/R01：版本与能力诊断 | 2.2, 2.8 | [durable/causality-and-recovery.md](durable/causality-and-recovery.md)、[creation-roundtrip/README.md](creation-roundtrip/README.md)、[privacy-admission/README.md](privacy-admission/README.md)、[platform-clean/README.md](platform-clean/README.md) |
| pi-platform-integration/R02：升级行为门槛 | 2.3, 2.8, 11.4 | [durable/causality-and-recovery.md](durable/causality-and-recovery.md)、[creation-roundtrip/README.md](creation-roundtrip/README.md)、[privacy-admission/README.md](privacy-admission/README.md)、[platform-clean/README.md](platform-clean/README.md) |
| pi-platform-integration/R03：不兼容输入保护 | 2.1, 11.5 | [durable/causality-and-recovery.md](durable/causality-and-recovery.md)、[creation-roundtrip/README.md](creation-roundtrip/README.md)、[privacy-admission/README.md](privacy-admission/README.md)、[platform-clean/README.md](platform-clean/README.md) |
| pi-platform-integration/R04：Durable 目标运行底座 | 1.4, 2.2, 2.3 | [durable/causality-and-recovery.md](durable/causality-and-recovery.md)、[creation-roundtrip/README.md](creation-roundtrip/README.md)、[privacy-admission/README.md](privacy-admission/README.md)、[platform-clean/README.md](platform-clean/README.md) |
| prompt-context-provenance/R01：按工具贡献提示 | 4.1, 4.3 | [resource-context/README.md](resource-context/README.md)、[compaction-source/README.md](compaction-source/README.md)、[handoff-context/README.md](handoff-context/README.md) |
| prompt-context-provenance/R02：上下文追溯 | 4.2, 4.4 | [resource-context/README.md](resource-context/README.md)、[compaction-source/README.md](compaction-source/README.md)、[handoff-context/README.md](handoff-context/README.md) |
| prompt-context-provenance/R03：压缩投影来源链 | 4.6, 4.7 | [resource-context/README.md](resource-context/README.md)、[compaction-source/README.md](compaction-source/README.md)、[handoff-context/README.md](handoff-context/README.md) |
| prompt-task-profiles/R01：按任务选择版本化指令 | 4.1 | [task-profiles/README.md](task-profiles/README.md) |
| prompt-task-profiles/R02：指令与历史数据边界 | 4.1, 4.7 | [task-profiles/README.md](task-profiles/README.md) |
| runtime-ui-extensions/R01：完整全局风格契约 | 9.1, 9.6 | [runtime-slots/README.md](runtime-slots/README.md)、[live-panels/README.md](live-panels/README.md) |
| runtime-ui-extensions/R02：声明式运行时扩展区域 | 9.6 | [runtime-slots/README.md](runtime-slots/README.md)、[live-panels/README.md](live-panels/README.md) |
| runtime-ui-extensions/R03：受控宿主交互与状态订阅 | 9.6 | [runtime-slots/README.md](runtime-slots/README.md)、[live-panels/README.md](live-panels/README.md) |
| self-customization-workflow/R01：对话自定制闭环 | 7.8 | [creation-roundtrip/README.md](creation-roundtrip/README.md)、[sdk-runtime/guides.md](sdk-runtime/guides.md)、[platform-clean/README.md](platform-clean/README.md) |
| self-customization-workflow/R02：第一版验收与第二版边界 | 7.8, 11.4 | [creation-roundtrip/README.md](creation-roundtrip/README.md)、[sdk-runtime/guides.md](sdk-runtime/guides.md)、[platform-clean/README.md](platform-clean/README.md) |
| self-customization-workflow/R03：按需开发导航和动作契约 | 7.7 | [creation-roundtrip/README.md](creation-roundtrip/README.md)、[sdk-runtime/guides.md](sdk-runtime/guides.md)、[platform-clean/README.md](platform-clean/README.md) |
| self-customization-workflow/R04：第三方提示贡献兼容 | 7.1, 7.7 | [creation-roundtrip/README.md](creation-roundtrip/README.md)、[sdk-runtime/guides.md](sdk-runtime/guides.md)、[platform-clean/README.md](platform-clean/README.md) |
| session-lifecycle/R01：确认删除与范围 | 3.7 | [independent-sessions/README.md](independent-sessions/README.md)、[durable/causality-and-recovery.md](durable/causality-and-recovery.md) |
| session-lifecycle/R02：模式会话创建与恢复 | 3.1, 3.7 | [independent-sessions/README.md](independent-sessions/README.md)、[durable/causality-and-recovery.md](durable/causality-and-recovery.md) |
| session-lifecycle/R03：Durable 观察与运行恢复分离 | 1.4, 2.3, 3.7 | [independent-sessions/README.md](independent-sessions/README.md)、[durable/causality-and-recovery.md](durable/causality-and-recovery.md) |
| web-customization/R01：分类导航与渐进展开 | 10.2, 10.4 | [create/candidate-executions.md](create/candidate-executions.md)、[studio-migration/README.md](studio-migration/README.md)、[loading-performance/README.md](loading-performance/README.md) |
| web-customization/R02：二次元视觉与统一控件 | 9.1, 9.5 | [create/candidate-executions.md](create/candidate-executions.md)、[studio-migration/README.md](studio-migration/README.md)、[loading-performance/README.md](loading-performance/README.md) |
| web-customization/R03：紧凑模型选择与配置编辑 | 10.4 | [create/candidate-executions.md](create/candidate-executions.md)、[studio-migration/README.md](studio-migration/README.md)、[loading-performance/README.md](loading-performance/README.md) |
| web-customization/R04：键盘与窄屏可用性 | 9.5, 10.9 | [create/candidate-executions.md](create/candidate-executions.md)、[studio-migration/README.md](studio-migration/README.md)、[loading-performance/README.md](loading-performance/README.md) |
| web-design-system/R01：统一语义控件与状态 | 9.1 | [history-ui/README.md](history-ui/README.md)、[compact-header/README.md](compact-header/README.md)、[default-entry/README.md](default-entry/README.md)、[loading-performance/README.md](loading-performance/README.md) |
| web-design-system/R02：键盘与响应式布局 | 9.5, 10.9 | [history-ui/README.md](history-ui/README.md)、[compact-header/README.md](compact-header/README.md)、[default-entry/README.md](default-entry/README.md)、[loading-performance/README.md](loading-performance/README.md) |
| web-design-system/R03：双工作台布局与导航 | 9.2, 9.5 | [history-ui/README.md](history-ui/README.md)、[compact-header/README.md](compact-header/README.md)、[default-entry/README.md](default-entry/README.md)、[loading-performance/README.md](loading-performance/README.md) |
| web-design-system/R04：长内容与草稿稳定性 | 9.3, 10.7 | [history-ui/README.md](history-ui/README.md)、[compact-header/README.md](compact-header/README.md)、[default-entry/README.md](default-entry/README.md)、[loading-performance/README.md](loading-performance/README.md) |
| web-design-system/R05：失败隔离与恢复 | 9.4, 9.6, 10.9 | [history-ui/README.md](history-ui/README.md)、[compact-header/README.md](compact-header/README.md)、[default-entry/README.md](default-entry/README.md)、[loading-performance/README.md](loading-performance/README.md) |
| web-evidence-inspector/R01：请求到来源追溯 | 10.5 | [context-ui/README.md](context-ui/README.md)、[inspection/README.md](inspection/README.md) |
| web-evidence-inspector/R02：原始响应与统计 | 10.6 | [context-ui/README.md](context-ui/README.md)、[inspection/README.md](inspection/README.md) |
| web-evidence-inspector/R03：嵌套调用与交付证据树 | 10.6 | [context-ui/README.md](context-ui/README.md)、[inspection/README.md](inspection/README.md) |
| web-session-stream/R01：快照与增量连续性 | 9.3, 9.4 | [history-ui/README.md](history-ui/README.md)、[runtime-performance/README.md](runtime-performance/README.md) |
| web-session-stream/R02：流展示与背压 | 9.4, 10.7 | [history-ui/README.md](history-ui/README.md)、[runtime-performance/README.md](runtime-performance/README.md) |
| web-task-workbench/R01：任务输入与继续 | 10.1 | [navigation-migration/README.md](navigation-migration/README.md)、[input-editing/README.md](input-editing/README.md)、[core-switch-ui/README.md](core-switch-ui/README.md) |
| web-task-workbench/R02：可发现的斜杠命令 | 10.1 | [navigation-migration/README.md](navigation-migration/README.md)、[input-editing/README.md](input-editing/README.md)、[core-switch-ui/README.md](core-switch-ui/README.md) |
| web-task-workbench/R03：工作与创造双工作台 | 9.2, 10.1, 10.2 | [navigation-migration/README.md](navigation-migration/README.md)、[input-editing/README.md](input-editing/README.md)、[core-switch-ui/README.md](core-switch-ui/README.md) |
| web-task-workbench/R04：验证任务可见与可取消 | 10.2, 10.8 | [navigation-migration/README.md](navigation-migration/README.md)、[input-editing/README.md](input-editing/README.md)、[core-switch-ui/README.md](core-switch-ui/README.md) |
| work-create-modes/R01：模式与目标身份 | 3.1 | [mode-policy/README.md](mode-policy/README.md)、[independent-sessions/README.md](independent-sessions/README.md)、[mode-handoff-roundtrip/README.md](mode-handoff-roundtrip/README.md) |
| work-create-modes/R02：工作能力集 | 3.2 | [mode-policy/README.md](mode-policy/README.md)、[independent-sessions/README.md](independent-sessions/README.md)、[mode-handoff-roundtrip/README.md](mode-handoff-roundtrip/README.md) |
| work-create-modes/R03：创造能力集 | 3.3 | [mode-policy/README.md](mode-policy/README.md)、[independent-sessions/README.md](independent-sessions/README.md)、[mode-handoff-roundtrip/README.md](mode-handoff-roundtrip/README.md) |
| work-create-modes/R04：模式不授予权限 | 3.2, 3.3 | [mode-policy/README.md](mode-policy/README.md)、[independent-sessions/README.md](independent-sessions/README.md)、[mode-handoff-roundtrip/README.md](mode-handoff-roundtrip/README.md) |
| workspace-references/R01：引用发现的工作区边界 | 10.9 | [input-editing/README.md](input-editing/README.md) |

## 保留的风险与未测范围

1. **OrbStack 共享目录不满足本轮可靠存储条件。** Linux 快照 HTTP 500 已定位到原子替换期间读取 durable.json 的 ENOENT；独立 5000 次 rename 探针在共享目录产生 2219 次 ENOENT、原生 Linux 目录为 0。正式 Linux 验收在原生文件系统执行，生产 Journal 不吞掉错误或重跑副作用；不能据其通过宣称共享挂载可用于可靠数据目录。此前 Linux 22 首次超时原因仍未确认。
2. **存在性能回归。** 相同四工具、400 条历史的准备时间中位数约 188→455ms；RSS、gzip 和直接会话入口 JS 增加。首页 raw JS 480150→479824 bytes，仅下降约 0.07%；最大单块 361261 bytes，无 500kB 告警。长历史锚点保持 0px。详见 [运行对照](runtime-performance/README.md) 和 [加载对照](loading-performance/README.md)，不宣称整体加速或 token 成本下降。
3. **没有真实模型抽样。** 工作修复、创造、长上下文、分类/图片均有 [缺失报告](real-model-missing.md)；fixture 不证明真实质量、费用或 Provider 生产兼容性。
4. **平台范围有限。** Linux 是 aarch64/OrbStack/Debian 容器；无 Linux 图形浏览器全套、x86_64 或 Windows 验收。Windows 按已批准策略暂缓。macOS Node 22 仅完整安装运行夹具，不等于源码全套。
5. **升级是破坏性准入。** SDK 1/2 与旧格式不能自动执行；旧历史只读或显式复制不意味着可继续运行。核心切换也不能由 npm 安装包凭空提供完整宿主源码。
6. **尚未提交、归档或发版。** 当前报告核验工作树及固定 tarball；不能当作标签 CI、官方 registry 或生产发布验收。历史 manifest 保留当时哈希，最终 manifest 另记。

## 主规格兼容性

42 个主能力与 30 个 delta 交叉核对，其中 20 个未修改主能力保留原保证；详见 [兼容审计](compatibility-audit.md)。已修正 SDK 准入、旧配置拒绝和 Windows 门槛的交叉契约；实时面板和 500kB 体积保证通过实现补齐，没有删除原场景。最终审计已完成；最终回归、四格同包安装及已安装可选资源复核全部通过。


## 交付身份与评审入口

最终 archive SHA-256 `4e4e5a20223da0de09995ca59ccc615787620356f956fa71def84021acaa2135`；build `f7424580c8a12f881340ca43507c425c011e0f790cb7c566c67e0acf619eb2a3`。540 个已打包 dist 文件与本地最终构建逐项一致。源文件、测试、规格、命令和报告摘要见 [最终 manifest](final-regression/manifest.json)；平台日志摘要见 [平台 manifest](platform-clean/manifest.json)。

[任务清单](../../../openspec/changes/next-generation-nekomimi/tasks.md) 已按实际验证勾选；[验收索引](README.md) 保留全部批次入口。当前交付是 apply 工作树与评审证据，没有提交、推送、同步归档或发布。后续归档和发版需按各自工作流另行执行，不能把本报告当成 npm registry 发布验收。
