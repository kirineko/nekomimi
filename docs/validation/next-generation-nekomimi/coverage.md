# 全部 delta 任务与验收证据映射

覆盖 30 能力、92 Requirement、233 Scenario。

索引使用实际存在的报告和测试文件，不再指向拟建的 next-generation 测试目录。每个场景保留 WHEN/THEN、规格摘要及关联任务。**任务证据已记录不等于最新全量门槛已通过**；关联测试需结合报告与实际断言审阅，测试文件存在本身不是通过证据。未完成的关联任务明确保留。

再生成：`python3 docs/validation/next-generation-nekomimi/build-coverage.py`。缺失报告/测试、遗漏能力/任务或 Requirement 数量变化会失败。

## codemode-execution/R01 — 受限脚本环境

来源：`openspec/changes/next-generation-nekomimi/specs/codemode-execution/spec.md:7`；任务：5.1。

验收报告：[codemode-runtime/README.md](codemode-runtime/README.md)、[codemode-runtime/pipeline-state.md](codemode-runtime/pipeline-state.md)、[codemode-runtime/partial-failure.md](codemode-runtime/partial-failure.md)

关联测试：`test/codemode-concurrency.test.ts`、`test/codemode-partial-failure.test.ts`、`test/codemode-pipeline.test.ts`、`test/codemode-sandbox.test.ts`、`test/codemode-state.test.ts`

| 场景ID | 场景 | 证据 | 状态 |
| --- | --- | --- | --- |
| S01 | 直接访问宿主 | [报告](codemode-runtime/README.md)，测试见上 | 任务证据已记录 |
| S02 | 无限输出或循环 | [报告](codemode-runtime/README.md)，测试见上 | 任务证据已记录 |

## codemode-execution/R02 — 嵌套调用统一管线

来源：`openspec/changes/next-generation-nekomimi/specs/codemode-execution/spec.md:18`；任务：5.2, 5.6。

验收报告：[codemode-runtime/README.md](codemode-runtime/README.md)、[codemode-runtime/pipeline-state.md](codemode-runtime/pipeline-state.md)、[codemode-runtime/partial-failure.md](codemode-runtime/partial-failure.md)

关联测试：`test/codemode-concurrency.test.ts`、`test/codemode-partial-failure.test.ts`、`test/codemode-pipeline.test.ts`、`test/codemode-sandbox.test.ts`、`test/codemode-state.test.ts`

| 场景ID | 场景 | 证据 | 状态 |
| --- | --- | --- | --- |
| S01 | 嵌套调用被撤权 | [报告](codemode-runtime/README.md)，测试见上 | 任务证据已记录 |
| S02 | 嵌套模型调用 | [报告](codemode-runtime/README.md)，测试见上 | 任务证据已记录 |

## codemode-execution/R03 — 并发与部分失败

来源：`openspec/changes/next-generation-nekomimi/specs/codemode-execution/spec.md:29`；任务：5.3, 5.8。

验收报告：[codemode-runtime/README.md](codemode-runtime/README.md)、[codemode-runtime/pipeline-state.md](codemode-runtime/pipeline-state.md)、[codemode-runtime/partial-failure.md](codemode-runtime/partial-failure.md)

关联测试：`test/codemode-concurrency.test.ts`、`test/codemode-partial-failure.test.ts`、`test/codemode-pipeline.test.ts`、`test/codemode-sandbox.test.ts`、`test/codemode-state.test.ts`

| 场景ID | 场景 | 证据 | 状态 |
| --- | --- | --- | --- |
| S01 | 两个写操作竞争 | [报告](codemode-runtime/README.md)，测试见上 | 任务证据已记录 |
| S02 | 先写后抛错 | [报告](codemode-runtime/README.md)，测试见上 | 任务证据已记录 |

## codemode-execution/R04 — 取消和未知结果

来源：`openspec/changes/next-generation-nekomimi/specs/codemode-execution/spec.md:40`；任务：5.3, 5.8。

验收报告：[codemode-runtime/README.md](codemode-runtime/README.md)、[codemode-runtime/pipeline-state.md](codemode-runtime/pipeline-state.md)、[codemode-runtime/partial-failure.md](codemode-runtime/partial-failure.md)

关联测试：`test/codemode-concurrency.test.ts`、`test/codemode-partial-failure.test.ts`、`test/codemode-pipeline.test.ts`、`test/codemode-sandbox.test.ts`、`test/codemode-state.test.ts`

| 场景ID | 场景 | 证据 | 状态 |
| --- | --- | --- | --- |
| S01 | 未等待远端调用 | [报告](codemode-runtime/README.md)，测试见上 | 任务证据已记录 |

## codemode-execution/R05 — 小状态与输出投影

来源：`openspec/changes/next-generation-nekomimi/specs/codemode-execution/spec.md:47`；任务：5.4。

验收报告：[codemode-runtime/README.md](codemode-runtime/README.md)、[codemode-runtime/pipeline-state.md](codemode-runtime/pipeline-state.md)、[codemode-runtime/partial-failure.md](codemode-runtime/partial-failure.md)

关联测试：`test/codemode-concurrency.test.ts`、`test/codemode-partial-failure.test.ts`、`test/codemode-pipeline.test.ts`、`test/codemode-sandbox.test.ts`、`test/codemode-state.test.ts`

| 场景ID | 场景 | 证据 | 状态 |
| --- | --- | --- | --- |
| S01 | 失败状态写入 | [报告](codemode-runtime/README.md)，测试见上 | 任务证据已记录 |
| S02 | 重开成功分支 | [报告](codemode-runtime/README.md)，测试见上 | 任务证据已记录 |

## context-compaction/R01 — 非破坏性压缩检查点

来源：`openspec/changes/next-generation-nekomimi/specs/context-compaction/spec.md:3`；任务：4.6。

验收报告：[compaction-source/README.md](compaction-source/README.md)、[context-ui/README.md](context-ui/README.md)

关联测试：`test/browser/context-details.spec.ts`、`test/compaction-source.test.ts`、`test/context-compaction.test.ts`

| 场景ID | 场景 | 证据 | 状态 |
| --- | --- | --- | --- |
| S01 | 长历史与工具交互 | [报告](compaction-source/README.md)，测试见上 | 任务证据已记录 |
| S02 | 创造长会话整理 | [报告](compaction-source/README.md)，测试见上 | 任务证据已记录 |

## context-compaction/R02 — 默认自动压缩

来源：`openspec/changes/next-generation-nekomimi/specs/context-compaction/spec.md:16`；任务：4.5, 4.6。

验收报告：[compaction-source/README.md](compaction-source/README.md)、[context-ui/README.md](context-ui/README.md)

关联测试：`test/browser/context-details.spec.ts`、`test/compaction-source.test.ts`、`test/context-compaction.test.ts`

| 场景ID | 场景 | 证据 | 状态 |
| --- | --- | --- | --- |
| S01 | 工具循环中接近容量 | [报告](compaction-source/README.md)，测试见上 | 任务证据已记录 |
| S02 | 无法腾出空间或自动压缩关闭 | [报告](compaction-source/README.md)，测试见上 | 任务证据已记录 |
| S03 | 切换模型预算 | [报告](compaction-source/README.md)，测试见上 | 任务证据已记录 |

## context-compaction/R03 — 摘要原子生效与失败恢复

来源：`openspec/changes/next-generation-nekomimi/specs/context-compaction/spec.md:31`；任务：4.6。

验收报告：[compaction-source/README.md](compaction-source/README.md)、[context-ui/README.md](context-ui/README.md)

关联测试：`test/browser/context-details.spec.ts`、`test/compaction-source.test.ts`、`test/context-compaction.test.ts`

| 场景ID | 场景 | 证据 | 状态 |
| --- | --- | --- | --- |
| S01 | 取消或版本冲突 | [报告](compaction-source/README.md)，测试见上 | 任务证据已记录 |
| S02 | 不完整响应 | [报告](compaction-source/README.md)，测试见上 | 任务证据已记录 |
| S03 | 跨模式迟到摘要 | [报告](compaction-source/README.md)，测试见上 | 任务证据已记录 |

## context-occupancy/R01 — 有来源的当前占用

来源：`openspec/changes/next-generation-nekomimi/specs/context-occupancy/spec.md:3`；任务：4.5, 10.5。

验收报告：[context-ui/README.md](context-ui/README.md)

关联测试：`test/browser/context-details.spec.ts`、`test/context-details.test.ts`

| 场景ID | 场景 | 证据 | 状态 |
| --- | --- | --- | --- |
| S01 | 更新与压缩 | [报告](context-ui/README.md)，测试见上 | 任务证据已记录 |
| S02 | 缺少 usage 或容量 | [报告](context-ui/README.md)，测试见上 | 任务证据已记录 |
| S03 | 检查交接占用 | [报告](context-ui/README.md)，测试见上 | 任务证据已记录 |

## context-occupancy/R02 — 主题化明细入口

来源：`openspec/changes/next-generation-nekomimi/specs/context-occupancy/spec.md:20`；任务：10.5。

验收报告：[context-ui/README.md](context-ui/README.md)

关联测试：`test/browser/context-details.spec.ts`、`test/context-details.test.ts`

| 场景ID | 场景 | 证据 | 状态 |
| --- | --- | --- | --- |
| S01 | 查看与关闭 | [报告](context-ui/README.md)，测试见上 | 任务证据已记录 |
| S02 | 切换会话与历史浏览 | [报告](context-ui/README.md)，测试见上 | 任务证据已记录 |

## context-selection-policy/R01 — 请求级选择快照

来源：`openspec/changes/next-generation-nekomimi/specs/context-selection-policy/spec.md:7`；任务：4.2。

验收报告：[resource-context/README.md](resource-context/README.md)、[handoff-context/README.md](handoff-context/README.md)

关联测试：`test/context-compaction.test.ts`、`test/context-details.test.ts`、`test/context-projection.test.ts`、`test/context-revalidation.test.ts`、`test/context-runtime.test.ts`、`test/context-service.test.ts`、`test/context-snapshot.test.ts`、`test/resource-context.test.ts`

| 场景ID | 场景 | 证据 | 状态 |
| --- | --- | --- | --- |
| S01 | 准备期间资源更新 | [报告](resource-context/README.md)，测试见上 | 任务证据已记录 |

## context-selection-policy/R02 — 层次与按需加载

来源：`openspec/changes/next-generation-nekomimi/specs/context-selection-policy/spec.md:16`；任务：4.3。

验收报告：[resource-context/README.md](resource-context/README.md)、[handoff-context/README.md](handoff-context/README.md)

关联测试：`test/context-compaction.test.ts`、`test/context-details.test.ts`、`test/context-projection.test.ts`、`test/context-revalidation.test.ts`、`test/context-runtime.test.ts`、`test/context-service.test.ts`、`test/context-snapshot.test.ts`、`test/resource-context.test.ts`

| 场景ID | 场景 | 证据 | 状态 |
| --- | --- | --- | --- |
| S01 | 超大能力目录 | [报告](resource-context/README.md)，测试见上 | 任务证据已记录 |
| S02 | 工作任务无开发需求 | [报告](resource-context/README.md)，测试见上 | 任务证据已记录 |

## context-selection-policy/R03 — 状态区分与撤销

来源：`openspec/changes/next-generation-nekomimi/specs/context-selection-policy/spec.md:27`；任务：4.4。

验收报告：[resource-context/README.md](resource-context/README.md)、[handoff-context/README.md](handoff-context/README.md)

关联测试：`test/context-compaction.test.ts`、`test/context-details.test.ts`、`test/context-projection.test.ts`、`test/context-revalidation.test.ts`、`test/context-runtime.test.ts`、`test/context-service.test.ts`、`test/context-snapshot.test.ts`、`test/resource-context.test.ts`

| 场景ID | 场景 | 证据 | 状态 |
| --- | --- | --- | --- |
| S01 | 技能离开作用域 | [报告](resource-context/README.md)，测试见上 | 任务证据已记录 |

## context-selection-policy/R04 — 预算与有界结果

来源：`openspec/changes/next-generation-nekomimi/specs/context-selection-policy/spec.md:34`；任务：4.5。

验收报告：[resource-context/README.md](resource-context/README.md)、[handoff-context/README.md](handoff-context/README.md)

关联测试：`test/context-compaction.test.ts`、`test/context-details.test.ts`、`test/context-projection.test.ts`、`test/context-revalidation.test.ts`、`test/context-runtime.test.ts`、`test/context-service.test.ts`、`test/context-snapshot.test.ts`、`test/resource-context.test.ts`

| 场景ID | 场景 | 证据 | 状态 |
| --- | --- | --- | --- |
| S01 | 工具输出过大 | [报告](resource-context/README.md)，测试见上 | 任务证据已记录 |
| S02 | 固定输入已超限 | [报告](resource-context/README.md)，测试见上 | 任务证据已记录 |

## context-selection-policy/R05 — 交接数据不替代当前指令

来源：`openspec/changes/next-generation-nekomimi/specs/context-selection-policy/spec.md:45`；任务：4.7。

验收报告：[resource-context/README.md](resource-context/README.md)、[handoff-context/README.md](handoff-context/README.md)

关联测试：`test/context-compaction.test.ts`、`test/context-details.test.ts`、`test/context-projection.test.ts`、`test/context-revalidation.test.ts`、`test/context-runtime.test.ts`、`test/context-service.test.ts`、`test/context-snapshot.test.ts`、`test/resource-context.test.ts`

| 场景ID | 场景 | 证据 | 状态 |
| --- | --- | --- | --- |
| S01 | 恶意交接内容 | [报告](resource-context/README.md)，测试见上 | 任务证据已记录 |

## core-change-candidates/R01 — 隔离源码候选

来源：`openspec/changes/next-generation-nekomimi/specs/core-change-candidates/spec.md:7`；任务：8.1。

验收报告：[core/source.md](core/source.md)、[core/build.md](core/build.md)、[core/validation.md](core/validation.md)、[core/switch-gates.md](core/switch-gates.md)、[core/recovery.md](core/recovery.md)、[core-switch-ui/README.md](core-switch-ui/README.md)

关联测试：`test/browser/core-candidate.spec.ts`、`test/browser/core-launch-info.spec.ts`、`test/browser/core-status.spec.ts`、`test/browser/core-switch-real.spec.ts`、`test/browser/core-switch-ui.spec.ts`、`test/core-build-process.test.ts`、`test/core-builds.test.ts`、`test/core-candidate-view.test.ts`、`test/core-candidates-cli.test.ts`、`test/core-candidates.test.ts`、`test/core-control-view.test.ts`、`test/core-managed-child.test.ts`、`test/core-managed.test.ts`、`test/core-operation-fence.test.ts`、`test/core-operations.test.ts`、`test/core-recovery.test.ts`、`test/core-rollback.test.ts`、`test/core-storage-compatibility.test.ts`、`test/core-switch-crash.test.ts`、`test/core-switch-gate.test.ts`、`test/core-switches.test.ts`、`test/core-validation.test.ts`

| 场景ID | 场景 | 证据 | 状态 |
| --- | --- | --- | --- |
| S01 | 基线不匹配 | [报告](core/source.md)，测试见上 | 任务证据已记录 |
| S02 | 源目录含用户修改 | [报告](core/source.md)，测试见上 | 任务证据已记录 |

## core-change-candidates/R02 — 不可变构建与分层验证

来源：`openspec/changes/next-generation-nekomimi/specs/core-change-candidates/spec.md:18`；任务：8.2, 8.3。

验收报告：[core/source.md](core/source.md)、[core/build.md](core/build.md)、[core/validation.md](core/validation.md)、[core/switch-gates.md](core/switch-gates.md)、[core/recovery.md](core/recovery.md)、[core-switch-ui/README.md](core-switch-ui/README.md)

关联测试：`test/browser/core-candidate.spec.ts`、`test/browser/core-launch-info.spec.ts`、`test/browser/core-status.spec.ts`、`test/browser/core-switch-real.spec.ts`、`test/browser/core-switch-ui.spec.ts`、`test/core-build-process.test.ts`、`test/core-builds.test.ts`、`test/core-candidate-view.test.ts`、`test/core-candidates-cli.test.ts`、`test/core-candidates.test.ts`、`test/core-control-view.test.ts`、`test/core-managed-child.test.ts`、`test/core-managed.test.ts`、`test/core-operation-fence.test.ts`、`test/core-operations.test.ts`、`test/core-recovery.test.ts`、`test/core-rollback.test.ts`、`test/core-storage-compatibility.test.ts`、`test/core-switch-crash.test.ts`、`test/core-switch-gate.test.ts`、`test/core-switches.test.ts`、`test/core-validation.test.ts`

| 场景ID | 场景 | 证据 | 状态 |
| --- | --- | --- | --- |
| S01 | 验证后源码变化 | [报告](core/source.md)，测试见上 | 任务证据已记录 |
| S02 | 取消构建 | [报告](core/source.md)，测试见上 | 任务证据已记录 |
| S03 | 独立启动验证 | [报告](core/source.md)，测试见上 | 任务证据已记录 |
| S04 | 旧格式与检查清理 | [报告](core/source.md)，测试见上 | 任务证据已记录 |

## core-change-candidates/R03 — 显式版本切换

来源：`openspec/changes/next-generation-nekomimi/specs/core-change-candidates/spec.md:37`；任务：8.4, 8.5。

验收报告：[core/source.md](core/source.md)、[core/build.md](core/build.md)、[core/validation.md](core/validation.md)、[core/switch-gates.md](core/switch-gates.md)、[core/recovery.md](core/recovery.md)、[core-switch-ui/README.md](core-switch-ui/README.md)

关联测试：`test/browser/core-candidate.spec.ts`、`test/browser/core-launch-info.spec.ts`、`test/browser/core-status.spec.ts`、`test/browser/core-switch-real.spec.ts`、`test/browser/core-switch-ui.spec.ts`、`test/core-build-process.test.ts`、`test/core-builds.test.ts`、`test/core-candidate-view.test.ts`、`test/core-candidates-cli.test.ts`、`test/core-candidates.test.ts`、`test/core-control-view.test.ts`、`test/core-managed-child.test.ts`、`test/core-managed.test.ts`、`test/core-operation-fence.test.ts`、`test/core-operations.test.ts`、`test/core-recovery.test.ts`、`test/core-rollback.test.ts`、`test/core-storage-compatibility.test.ts`、`test/core-switch-crash.test.ts`、`test/core-switch-gate.test.ts`、`test/core-switches.test.ts`、`test/core-validation.test.ts`

| 场景ID | 场景 | 证据 | 状态 |
| --- | --- | --- | --- |
| S01 | 切换时仍运行 | [报告](core/source.md)，测试见上 | 任务证据已记录 |
| S02 | 请求重复 | [报告](core/source.md)，测试见上 | 任务证据已记录 |
| S03 | 浏览器确认丢失或旧目标不再匹配 | [报告](core/source.md)，测试见上 | 任务证据已记录 |

## core-change-candidates/R04 — 切换故障与回退

来源：`openspec/changes/next-generation-nekomimi/specs/core-change-candidates/spec.md:52`；任务：8.6。

验收报告：[core/source.md](core/source.md)、[core/build.md](core/build.md)、[core/validation.md](core/validation.md)、[core/switch-gates.md](core/switch-gates.md)、[core/recovery.md](core/recovery.md)、[core-switch-ui/README.md](core-switch-ui/README.md)

关联测试：`test/browser/core-candidate.spec.ts`、`test/browser/core-launch-info.spec.ts`、`test/browser/core-status.spec.ts`、`test/browser/core-switch-real.spec.ts`、`test/browser/core-switch-ui.spec.ts`、`test/core-build-process.test.ts`、`test/core-builds.test.ts`、`test/core-candidate-view.test.ts`、`test/core-candidates-cli.test.ts`、`test/core-candidates.test.ts`、`test/core-control-view.test.ts`、`test/core-managed-child.test.ts`、`test/core-managed.test.ts`、`test/core-operation-fence.test.ts`、`test/core-operations.test.ts`、`test/core-recovery.test.ts`、`test/core-rollback.test.ts`、`test/core-storage-compatibility.test.ts`、`test/core-switch-crash.test.ts`、`test/core-switch-gate.test.ts`、`test/core-switches.test.ts`、`test/core-validation.test.ts`

| 场景ID | 场景 | 证据 | 状态 |
| --- | --- | --- | --- |
| S01 | 切换中断 | [报告](core/source.md)，测试见上 | 任务证据已记录 |
| S02 | 状态不兼容 | [报告](core/source.md)，测试见上 | 任务证据已记录 |

## core-change-candidates/R05 — 启动方式诊断

来源：`openspec/changes/next-generation-nekomimi/specs/core-change-candidates/spec.md:63`；任务：8.4, 10.8。

验收报告：[core/source.md](core/source.md)、[core/build.md](core/build.md)、[core/validation.md](core/validation.md)、[core/switch-gates.md](core/switch-gates.md)、[core/recovery.md](core/recovery.md)、[core-switch-ui/README.md](core-switch-ui/README.md)

关联测试：`test/browser/core-candidate.spec.ts`、`test/browser/core-launch-info.spec.ts`、`test/browser/core-status.spec.ts`、`test/browser/core-switch-real.spec.ts`、`test/browser/core-switch-ui.spec.ts`、`test/core-build-process.test.ts`、`test/core-builds.test.ts`、`test/core-candidate-view.test.ts`、`test/core-candidates-cli.test.ts`、`test/core-candidates.test.ts`、`test/core-control-view.test.ts`、`test/core-managed-child.test.ts`、`test/core-managed.test.ts`、`test/core-operation-fence.test.ts`、`test/core-operations.test.ts`、`test/core-recovery.test.ts`、`test/core-rollback.test.ts`、`test/core-storage-compatibility.test.ts`、`test/core-switch-crash.test.ts`、`test/core-switch-gate.test.ts`、`test/core-switches.test.ts`、`test/core-validation.test.ts`

| 场景ID | 场景 | 证据 | 状态 |
| --- | --- | --- | --- |
| S01 | 仅构建产物 | [报告](core/source.md)，测试见上 | 任务证据已记录 |

## customization-development/R01 — 版本匹配的开发入口

来源：`openspec/changes/next-generation-nekomimi/specs/customization-development/spec.md:3`；任务：7.1, 7.7。

验收报告：[sdk-runtime/guides.md](sdk-runtime/guides.md)、[sdk-runtime/verification.md](sdk-runtime/verification.md)、[project-delivery/README.md](project-delivery/README.md)、[creation-roundtrip/README.md](creation-roundtrip/README.md)

关联测试：`test/browser/project-delivery.spec.ts`、`test/candidate-assets.test.ts`、`test/candidate-delivery.test.ts`、`test/candidate-executions.test.ts`、`test/candidate-origin.test.ts`、`test/candidate-view.test.ts`、`test/customization-verification.test.ts`、`test/project-delivery.test.ts`

| 场景ID | 场景 | 证据 | 状态 |
| --- | --- | --- | --- |
| S01 | 从需求创建定制 | [报告](sdk-runtime/guides.md)，测试见上 | 任务证据已记录 |
| S02 | 创建整体主题 | [报告](sdk-runtime/guides.md)，测试见上 | 任务证据已记录 |
| S03 | 离线使用安装包资料 | [报告](sdk-runtime/guides.md)，测试见上 | 任务证据已记录 |
| S04 | 核心与扩展选择 | [报告](sdk-runtime/guides.md)，测试见上 | 任务证据已记录 |

## customization-development/R02 — 候选激活与回退

来源：`openspec/changes/next-generation-nekomimi/specs/customization-development/spec.md:24`；任务：7.3, 7.4, 7.5。

验收报告：[sdk-runtime/guides.md](sdk-runtime/guides.md)、[sdk-runtime/verification.md](sdk-runtime/verification.md)、[project-delivery/README.md](project-delivery/README.md)、[creation-roundtrip/README.md](creation-roundtrip/README.md)

关联测试：`test/browser/project-delivery.spec.ts`、`test/candidate-assets.test.ts`、`test/candidate-delivery.test.ts`、`test/candidate-executions.test.ts`、`test/candidate-origin.test.ts`、`test/candidate-view.test.ts`、`test/customization-verification.test.ts`、`test/project-delivery.test.ts`

| 场景ID | 场景 | 证据 | 状态 |
| --- | --- | --- | --- |
| S01 | 校验后又被改写 | [报告](sdk-runtime/guides.md)，测试见上 | 任务证据已记录 |
| S02 | 回退有状态扩展 | [报告](sdk-runtime/guides.md)，测试见上 | 任务证据已记录 |
| S03 | 验证运行期间应用 | [报告](sdk-runtime/guides.md)，测试见上 | 任务证据已记录 |
| S04 | 从独立开发目录交付到原工作项目 | [报告](sdk-runtime/guides.md)，测试见上 | 任务证据已记录 |
| S05 | 交付变化与未确认结果 | [报告](sdk-runtime/guides.md)，测试见上 | 任务证据已记录 |

## customization-development/R03 — 候选二进制素材完整性

来源：`openspec/changes/next-generation-nekomimi/specs/customization-development/spec.md:50`；任务：7.3。

验收报告：[sdk-runtime/guides.md](sdk-runtime/guides.md)、[sdk-runtime/verification.md](sdk-runtime/verification.md)、[project-delivery/README.md](project-delivery/README.md)、[creation-roundtrip/README.md](creation-roundtrip/README.md)

关联测试：`test/browser/project-delivery.spec.ts`、`test/candidate-assets.test.ts`、`test/candidate-delivery.test.ts`、`test/candidate-executions.test.ts`、`test/candidate-origin.test.ts`、`test/candidate-view.test.ts`、`test/customization-verification.test.ts`、`test/project-delivery.test.ts`

| 场景ID | 场景 | 证据 | 状态 |
| --- | --- | --- | --- |
| S01 | 含字体图片的主题候选 | [报告](sdk-runtime/guides.md)，测试见上 | 任务证据已记录 |

## customization-lifecycle/R01 — 用户能力目录与来源

来源：`openspec/changes/next-generation-nekomimi/specs/customization-lifecycle/spec.md:3`；任务：7.6。

验收报告：[sdk-runtime/candidate-origin.md](sdk-runtime/candidate-origin.md)、[create/candidate-executions.md](create/candidate-executions.md)、[project-delivery/README.md](project-delivery/README.md)

关联测试：`test/browser/candidate-management.spec.ts`、`test/candidate-origin.test.ts`、`test/candidate-view.test.ts`、`test/customization-validation-cancel.test.ts`

| 场景ID | 场景 | 证据 | 状态 |
| --- | --- | --- | --- |
| S01 | 会话中创建并管理主题 | [报告](sdk-runtime/candidate-origin.md)，测试见上 | 任务证据已记录 |
| S02 | 外部编辑或旧资源 | [报告](sdk-runtime/candidate-origin.md)，测试见上 | 任务证据已记录 |
| S03 | 工作任务查看交付 | [报告](sdk-runtime/candidate-origin.md)，测试见上 | 任务证据已记录 |

## customization-lifecycle/R02 — 可操作的交付结果

来源：`openspec/changes/next-generation-nekomimi/specs/customization-lifecycle/spec.md:20`；任务：7.4, 7.6, 10.2。

验收报告：[sdk-runtime/candidate-origin.md](sdk-runtime/candidate-origin.md)、[create/candidate-executions.md](create/candidate-executions.md)、[project-delivery/README.md](project-delivery/README.md)

关联测试：`test/browser/candidate-management.spec.ts`、`test/candidate-origin.test.ts`、`test/candidate-view.test.ts`、`test/customization-validation-cancel.test.ts`

| 场景ID | 场景 | 证据 | 状态 |
| --- | --- | --- | --- |
| S01 | 重载后尚未应用 | [报告](sdk-runtime/candidate-origin.md)，测试见上 | 任务证据已记录 |
| S02 | 历史卡片的版本已不可用 | [报告](sdk-runtime/candidate-origin.md)，测试见上 | 任务证据已记录 |
| S03 | 双工作台状态一致 | [报告](sdk-runtime/candidate-origin.md)，测试见上 | 任务证据已记录 |

## customization-release-readiness/R01 — 兼容与故障门槛

来源：`openspec/changes/next-generation-nekomimi/specs/customization-release-readiness/spec.md:3`；任务：11.1, 11.2, 11.5。

验收报告：[next-generation-nekomimi/compatibility-audit.md](compatibility-audit.md)、[creation-roundtrip/README.md](creation-roundtrip/README.md)、[next-generation-nekomimi/platform-matrix.md](platform-matrix.md)、[final-regression/README.md](final-regression/README.md)、[platform-clean/README.md](platform-clean/README.md)

关联测试：`test/data-format.test.ts`、`test/sdk-admission.test.ts`、`test/http-error-privacy.test.ts`

| 场景ID | 场景 | 证据 | 状态 |
| --- | --- | --- | --- |
| S01 | 旧项目升级 | [报告](compatibility-audit.md)，测试见上 | 任务证据已记录 |

## customization-release-readiness/R02 — 可安装版本候选

来源：`openspec/changes/next-generation-nekomimi/specs/customization-release-readiness/spec.md:11`；任务：11.4, 11.8。

验收报告：[next-generation-nekomimi/compatibility-audit.md](compatibility-audit.md)、[creation-roundtrip/README.md](creation-roundtrip/README.md)、[next-generation-nekomimi/platform-matrix.md](platform-matrix.md)、[final-regression/README.md](final-regression/README.md)、[platform-clean/README.md](platform-clean/README.md)

关联测试：`test/data-format.test.ts`、`test/sdk-admission.test.ts`、`test/http-error-privacy.test.ts`

| 场景ID | 场景 | 证据 | 状态 |
| --- | --- | --- | --- |
| S01 | 离线账户独立安装验收 | [报告](compatibility-audit.md)，测试见上 | 任务证据已记录 |

## execution-journal/R01 — 有序且可关联的证据

来源：`openspec/changes/next-generation-nekomimi/specs/execution-journal/spec.md:3`；任务：2.4, 2.5。

验收报告：[durable/causality-and-recovery.md](durable/causality-and-recovery.md)、[privacy-admission/README.md](privacy-admission/README.md)

关联测试：`test/durable-journal-storage.test.ts`、`test/durable-model-service.test.ts`、`test/durable-recovery.test.ts`、`test/durable-runtime-recovery.test.ts`、`test/durable-tool-adapter.test.ts`、`test/journal-causality.test.ts`、`test/journal.test.ts`

| 场景ID | 场景 | 证据 | 状态 |
| --- | --- | --- | --- |
| S01 | 有序且可关联的证据验收 | [报告](durable/causality-and-recovery.md)，测试见上 | 任务证据已记录 |
| S02 | 嵌套调用与交接 | [报告](durable/causality-and-recovery.md)，测试见上 | 任务证据已记录 |

## execution-journal/R02 — 格式版本与旧数据保护

来源：`openspec/changes/next-generation-nekomimi/specs/execution-journal/spec.md:20`；任务：2.1。

验收报告：[durable/causality-and-recovery.md](durable/causality-and-recovery.md)、[privacy-admission/README.md](privacy-admission/README.md)

关联测试：`test/durable-journal-storage.test.ts`、`test/durable-model-service.test.ts`、`test/durable-recovery.test.ts`、`test/durable-runtime-recovery.test.ts`、`test/durable-tool-adapter.test.ts`、`test/journal-causality.test.ts`、`test/journal.test.ts`

| 场景ID | 场景 | 证据 | 状态 |
| --- | --- | --- | --- |
| S01 | 拒绝旧格式 | [报告](durable/causality-and-recovery.md)，测试见上 | 任务证据已记录 |

## execution-journal/R03 — 运行任务的可靠状态

来源：`openspec/changes/next-generation-nekomimi/specs/execution-journal/spec.md:27`；任务：2.5, 3.7。

验收报告：[durable/causality-and-recovery.md](durable/causality-and-recovery.md)、[privacy-admission/README.md](privacy-admission/README.md)

关联测试：`test/durable-journal-storage.test.ts`、`test/durable-model-service.test.ts`、`test/durable-recovery.test.ts`、`test/durable-runtime-recovery.test.ts`、`test/durable-tool-adapter.test.ts`、`test/journal-causality.test.ts`、`test/journal.test.ts`

| 场景ID | 场景 | 证据 | 状态 |
| --- | --- | --- | --- |
| S01 | 安全标注与未知写入 | [报告](durable/causality-and-recovery.md)，测试见上 | 任务证据已记录 |

## execution-journal/R04 — Durable 单一提交映射

来源：`openspec/changes/next-generation-nekomimi/specs/execution-journal/spec.md:34`；任务：1.4, 2.2, 2.4, 2.5。

验收报告：[durable/causality-and-recovery.md](durable/causality-and-recovery.md)、[privacy-admission/README.md](privacy-admission/README.md)

关联测试：`test/durable-journal-storage.test.ts`、`test/durable-model-service.test.ts`、`test/durable-recovery.test.ts`、`test/durable-runtime-recovery.test.ts`、`test/durable-tool-adapter.test.ts`、`test/journal-causality.test.ts`、`test/journal.test.ts`

| 场景ID | 场景 | 证据 | 状态 |
| --- | --- | --- | --- |
| S01 | 多项提交落盘失败 | [报告](durable/causality-and-recovery.md)，测试见上 | 任务证据已记录 |
| S02 | 删除读取投影后重开 | [报告](durable/causality-and-recovery.md)，测试见上 | 任务证据已记录 |

## extension-process-host/R01 — 独立执行与兼容

来源：`openspec/changes/next-generation-nekomimi/specs/extension-process-host/spec.md:3`；任务：7.1, 11.1。

验收报告：[sdk-runtime/contracts.md](sdk-runtime/contracts.md)、[next-generation-nekomimi/compatibility-audit.md](compatibility-audit.md)

关联测试：`test/customization-process.test.ts`、`test/sdk-admission.test.ts`

| 场景ID | 场景 | 证据 | 状态 |
| --- | --- | --- | --- |
| S01 | 当前 SDK 扩展运行 | [报告](sdk-runtime/contracts.md)，测试见上 | 任务证据已记录 |
| S02 | 旧扩展升级运行 | [报告](sdk-runtime/contracts.md)，测试见上 | 任务证据已记录 |

## extension-runtime/R01 — SDK 版本和命名

来源：`openspec/changes/next-generation-nekomimi/specs/extension-runtime/spec.md:3`；任务：7.1。

验收报告：[sdk-runtime/contracts.md](sdk-runtime/contracts.md)、[sdk-runtime/services.md](sdk-runtime/services.md)、[sdk-runtime/boundary.md](sdk-runtime/boundary.md)

关联测试：`test/customization-boundary.test.ts`、`test/customization-process.test.ts`、`test/sdk-admission.test.ts`、`test/sdk-v3-contract.test.ts`

| 场景ID | 场景 | 证据 | 状态 |
| --- | --- | --- | --- |
| S01 | 请求未来能力 | [报告](sdk-runtime/contracts.md)，测试见上 | 任务证据已记录 |
| S02 | 新旧扩展共存 | [报告](sdk-runtime/contracts.md)，测试见上 | 任务证据已记录 |
| S03 | 查询真实能力 | [报告](sdk-runtime/contracts.md)，测试见上 | 任务证据已记录 |

## extension-runtime/R02 — 统一受记录执行

来源：`openspec/changes/next-generation-nekomimi/specs/extension-runtime/spec.md:18`；任务：2.6, 7.2。

验收报告：[sdk-runtime/contracts.md](sdk-runtime/contracts.md)、[sdk-runtime/services.md](sdk-runtime/services.md)、[sdk-runtime/boundary.md](sdk-runtime/boundary.md)

关联测试：`test/customization-boundary.test.ts`、`test/customization-process.test.ts`、`test/sdk-admission.test.ts`、`test/sdk-v3-contract.test.ts`

| 场景ID | 场景 | 证据 | 状态 |
| --- | --- | --- | --- |
| S01 | 扩展工具输出超限 | [报告](sdk-runtime/contracts.md)，测试见上 | 任务证据已记录 |
| S02 | 绕过 UI 调用 | [报告](sdk-runtime/contracts.md)，测试见上 | 任务证据已记录 |
| S03 | 取消时排空已准入宿主服务 | [报告](sdk-runtime/contracts.md)，测试见上 | 任务证据已记录 |

## local-user-configuration/R01 — 配置入口与凭证隔离

来源：`openspec/changes/next-generation-nekomimi/specs/local-user-configuration/spec.md:3`；任务：2.1, 10.4, 11.1, 11.5。

验收报告：[next-generation-nekomimi/format-admission.md](format-admission.md)、[privacy-admission/README.md](privacy-admission/README.md)、[final-regression/README.md](final-regression/README.md)

关联测试：`test/browser/local-experience.spec.ts`、`test/data-format.test.ts`、`test/local-experience.test.ts`、`test/http-error-privacy.test.ts`

| 场景ID | 场景 | 证据 | 状态 |
| --- | --- | --- | --- |
| S01 | 保存并重启 | [报告](format-admission.md)，测试见上 | 任务证据已记录 |
| S02 | 运行中替换或清除凭证 | [报告](format-admission.md)，测试见上 | 任务证据已记录 |
| S03 | 旧配置升级到多 Provider | [报告](format-admission.md)，测试见上 | 任务证据已记录 |
| S04 | Web 修改模型与端点 | [报告](format-admission.md)，测试见上 | 任务证据已记录 |

## mcp-context-and-auth/R01 — 资源与模板

来源：`openspec/changes/next-generation-nekomimi/specs/mcp-context-and-auth/spec.md:3`；任务：6.4。

验收报告：[mcp-runtime/content.md](mcp-runtime/content.md)、[mcp-runtime/oauth.md](mcp-runtime/oauth.md)

关联测试：`test/customization-mcp-oauth.test.ts`、`test/mcp-demand.test.ts`、`test/mcp-discovery.test.ts`、`test/mcp-fault-recovery.test.ts`、`test/mcp-oauth-rotation.test.ts`、`test/mcp-snapshots.test.ts`、`test/mcp-version-runtime.test.ts`

| 场景ID | 场景 | 证据 | 状态 |
| --- | --- | --- | --- |
| S01 | 显式读取远端资源 | [报告](mcp-runtime/content.md)，测试见上 | 任务证据已记录 |
| S02 | 创造读取后返回工作 | [报告](mcp-runtime/content.md)，测试见上 | 任务证据已记录 |

## mcp-context-and-auth/R02 — OAuth 生命周期

来源：`openspec/changes/next-generation-nekomimi/specs/mcp-context-and-auth/spec.md:17`；任务：6.5。

验收报告：[mcp-runtime/content.md](mcp-runtime/content.md)、[mcp-runtime/oauth.md](mcp-runtime/oauth.md)

关联测试：`test/customization-mcp-oauth.test.ts`、`test/mcp-demand.test.ts`、`test/mcp-discovery.test.ts`、`test/mcp-fault-recovery.test.ts`、`test/mcp-oauth-rotation.test.ts`、`test/mcp-snapshots.test.ts`、`test/mcp-version-runtime.test.ts`

| 场景ID | 场景 | 证据 | 状态 |
| --- | --- | --- | --- |
| S01 | 刷新与重启 | [报告](mcp-runtime/content.md)，测试见上 | 任务证据已记录 |
| S02 | 恶意回调或发现 | [报告](mcp-runtime/content.md)，测试见上 | 任务证据已记录 |
| S03 | 同 URL 不同账户 | [报告](mcp-runtime/content.md)，测试见上 | 任务证据已记录 |
| S04 | 取消时令牌轮换 | [报告](mcp-runtime/content.md)，测试见上 | 任务证据已记录 |

## mcp-tool-integration/R01 — 连接与发现

来源：`openspec/changes/next-generation-nekomimi/specs/mcp-tool-integration/spec.md:3`；任务：6.1, 6.2。

验收报告：[mcp-runtime/README.md](mcp-runtime/README.md)、[mcp-runtime/discovery.md](mcp-runtime/discovery.md)、[mcp-runtime/versions.md](mcp-runtime/versions.md)、[mcp-runtime/fault-recovery.md](mcp-runtime/fault-recovery.md)

关联测试：`test/mcp-demand.test.ts`、`test/mcp-discovery.test.ts`、`test/mcp-fault-recovery.test.ts`、`test/mcp-oauth-rotation.test.ts`、`test/mcp-snapshots.test.ts`、`test/mcp-version-runtime.test.ts`、`test/pi-mcp-owner.test.ts`

| 场景ID | 场景 | 证据 | 状态 |
| --- | --- | --- | --- |
| S01 | 多服务器同名工具 | [报告](mcp-runtime/README.md)，测试见上 | 任务证据已记录 |
| S02 | 迟到的非直接服务器 | [报告](mcp-runtime/README.md)，测试见上 | 任务证据已记录 |
| S03 | 规范化重名 | [报告](mcp-runtime/README.md)，测试见上 | 任务证据已记录 |

## mcp-tool-integration/R02 — 工具列表版本

来源：`openspec/changes/next-generation-nekomimi/specs/mcp-tool-integration/spec.md:20`；任务：6.3。

验收报告：[mcp-runtime/README.md](mcp-runtime/README.md)、[mcp-runtime/discovery.md](mcp-runtime/discovery.md)、[mcp-runtime/versions.md](mcp-runtime/versions.md)、[mcp-runtime/fault-recovery.md](mcp-runtime/fault-recovery.md)

关联测试：`test/mcp-demand.test.ts`、`test/mcp-discovery.test.ts`、`test/mcp-fault-recovery.test.ts`、`test/mcp-oauth-rotation.test.ts`、`test/mcp-snapshots.test.ts`、`test/mcp-version-runtime.test.ts`、`test/pi-mcp-owner.test.ts`

| 场景ID | 场景 | 证据 | 状态 |
| --- | --- | --- | --- |
| S01 | 活动运行中列表变化 | [报告](mcp-runtime/README.md)，测试见上 | 任务证据已记录 |
| S02 | 恢复曾发现工具 | [报告](mcp-runtime/README.md)，测试见上 | 任务证据已记录 |

## mcp-tool-integration/R03 — 结果保真和凭证边界

来源：`openspec/changes/next-generation-nekomimi/specs/mcp-tool-integration/spec.md:33`；任务：6.1, 6.6。

验收报告：[mcp-runtime/README.md](mcp-runtime/README.md)、[mcp-runtime/discovery.md](mcp-runtime/discovery.md)、[mcp-runtime/versions.md](mcp-runtime/versions.md)、[mcp-runtime/fault-recovery.md](mcp-runtime/fault-recovery.md)

关联测试：`test/mcp-demand.test.ts`、`test/mcp-discovery.test.ts`、`test/mcp-fault-recovery.test.ts`、`test/mcp-oauth-rotation.test.ts`、`test/mcp-snapshots.test.ts`、`test/mcp-version-runtime.test.ts`、`test/pi-mcp-owner.test.ts`

| 场景ID | 场景 | 证据 | 状态 |
| --- | --- | --- | --- |
| S01 | 结构化结果和错误 | [报告](mcp-runtime/README.md)，测试见上 | 任务证据已记录 |
| S02 | 脚本检查错误 | [报告](mcp-runtime/README.md)，测试见上 | 任务证据已记录 |

## mode-session-handoff/R01 — 显式且最小化交接

来源：`openspec/changes/next-generation-nekomimi/specs/mode-session-handoff/spec.md:7`；任务：3.4。

验收报告：[handoff/completion.md](handoff/completion.md)、[project-delivery/README.md](project-delivery/README.md)、[mode-handoff-roundtrip/README.md](mode-handoff-roundtrip/README.md)

关联测试：`test/browser/handoff-cards.spec.ts`、`test/browser/handoff-recovery.spec.ts`、`test/browser/handoff-summary.spec.ts`、`test/handoff-context.test.ts`、`test/handoff-crash-recovery.test.ts`、`test/handoff-preparation.test.ts`、`test/handoff-transfer.test.ts`、`test/mode-handoff-roundtrip.test.ts`

| 场景ID | 场景 | 证据 | 状态 |
| --- | --- | --- | --- |
| S01 | 取消交接 | [报告](handoff/completion.md)，测试见上 | 任务证据已记录 |
| S02 | 显式摘要准备 | [报告](handoff/completion.md)，测试见上 | 任务证据已记录 |
| S03 | 摘要取消或源变化 | [报告](handoff/completion.md)，测试见上 | 任务证据已记录 |
| S04 | 引用无权限 | [报告](handoff/completion.md)，测试见上 | 任务证据已记录 |

## mode-session-handoff/R02 — 交接幂等与恢复

来源：`openspec/changes/next-generation-nekomimi/specs/mode-session-handoff/spec.md:26`；任务：3.5。

验收报告：[handoff/completion.md](handoff/completion.md)、[project-delivery/README.md](project-delivery/README.md)、[mode-handoff-roundtrip/README.md](mode-handoff-roundtrip/README.md)

关联测试：`test/browser/handoff-cards.spec.ts`、`test/browser/handoff-recovery.spec.ts`、`test/browser/handoff-summary.spec.ts`、`test/handoff-context.test.ts`、`test/handoff-crash-recovery.test.ts`、`test/handoff-preparation.test.ts`、`test/handoff-transfer.test.ts`、`test/mode-handoff-roundtrip.test.ts`

| 场景ID | 场景 | 证据 | 状态 |
| --- | --- | --- | --- |
| S01 | 接受后确认丢失 | [报告](handoff/completion.md)，测试见上 | 任务证据已记录 |
| S02 | 跨会话记录中断 | [报告](handoff/completion.md)，测试见上 | 任务证据已记录 |
| S03 | 源后续变化 | [报告](handoff/completion.md)，测试见上 | 任务证据已记录 |
| S04 | 意图未可靠提交 | [报告](handoff/completion.md)，测试见上 | 任务证据已记录 |
| S05 | 活动运行中重取收据 | [报告](handoff/completion.md)，测试见上 | 任务证据已记录 |

## mode-session-handoff/R03 — 交付结果独立应用

来源：`openspec/changes/next-generation-nekomimi/specs/mode-session-handoff/spec.md:49`；任务：3.6。

验收报告：[handoff/completion.md](handoff/completion.md)、[project-delivery/README.md](project-delivery/README.md)、[mode-handoff-roundtrip/README.md](mode-handoff-roundtrip/README.md)

关联测试：`test/browser/handoff-cards.spec.ts`、`test/browser/handoff-recovery.spec.ts`、`test/browser/handoff-summary.spec.ts`、`test/handoff-context.test.ts`、`test/handoff-crash-recovery.test.ts`、`test/handoff-preparation.test.ts`、`test/handoff-transfer.test.ts`、`test/mode-handoff-roundtrip.test.ts`

| 场景ID | 场景 | 证据 | 状态 |
| --- | --- | --- | --- |
| S01 | 只有预览通过 | [报告](handoff/completion.md)，测试见上 | 任务证据已记录 |
| S02 | 目标已删除或候选过期 | [报告](handoff/completion.md)，测试见上 | 任务证据已记录 |
| S03 | 交付阶段不能伪造 | [报告](handoff/completion.md)，测试见上 | 任务证据已记录 |
| S04 | 工作显式引用交付 | [报告](handoff/completion.md)，测试见上 | 任务证据已记录 |
| S05 | 历史交付与当前版本 | [报告](handoff/completion.md)，测试见上 | 任务证据已记录 |

## mode-session-handoff/R04 — 独立取消与上下文

来源：`openspec/changes/next-generation-nekomimi/specs/mode-session-handoff/spec.md:72`；任务：3.7, 4.7。

验收报告：[handoff/completion.md](handoff/completion.md)、[project-delivery/README.md](project-delivery/README.md)、[mode-handoff-roundtrip/README.md](mode-handoff-roundtrip/README.md)

关联测试：`test/browser/handoff-cards.spec.ts`、`test/browser/handoff-recovery.spec.ts`、`test/browser/handoff-summary.spec.ts`、`test/handoff-context.test.ts`、`test/handoff-crash-recovery.test.ts`、`test/handoff-preparation.test.ts`、`test/handoff-transfer.test.ts`、`test/mode-handoff-roundtrip.test.ts`

| 场景ID | 场景 | 证据 | 状态 |
| --- | --- | --- | --- |
| S01 | 返回工作会话 | [报告](handoff/completion.md)，测试见上 | 任务证据已记录 |
| S02 | 不同目标独立运行与取消 | [报告](handoff/completion.md)，测试见上 | 任务证据已记录 |
| S03 | 辅助命名隔离 | [报告](handoff/completion.md)，测试见上 | 任务证据已记录 |

## model-call-evidence/R01 — 最终请求保真

来源：`openspec/changes/next-generation-nekomimi/specs/model-call-evidence/spec.md:3`；任务：2.7。

验收报告：[durable/pipeline-and-model-policy.md](durable/pipeline-and-model-policy.md)、[typed-model/transport.md](typed-model/transport.md)

关联测试：`test/durable-model-service.test.ts`、`test/model-routing.test.ts`、`test/typed-model.test.ts`

| 场景ID | 场景 | 证据 | 状态 |
| --- | --- | --- | --- |
| S01 | 最终请求保真验收 | [报告](durable/pipeline-and-model-policy.md)，测试见上 | 任务证据已记录 |
| S02 | 工具内模型调用 | [报告](durable/pipeline-and-model-policy.md)，测试见上 | 任务证据已记录 |
| S03 | 扩展辅助调用重试和取消 | [报告](durable/pipeline-and-model-policy.md)，测试见上 | 任务证据已记录 |
| S04 | 自定义 Provider 请求 | [报告](durable/pipeline-and-model-policy.md)，测试见上 | 任务证据已记录 |
| S05 | 脚本分类调用 | [报告](durable/pipeline-and-model-policy.md)，测试见上 | 任务证据已记录 |

## model-call-evidence/R02 — 逐次重试与取消

来源：`openspec/changes/next-generation-nekomimi/specs/model-call-evidence/spec.md:30`；任务：2.7, 5.6。

验收报告：[durable/pipeline-and-model-policy.md](durable/pipeline-and-model-policy.md)、[typed-model/transport.md](typed-model/transport.md)

关联测试：`test/durable-model-service.test.ts`、`test/model-routing.test.ts`、`test/typed-model.test.ts`

| 场景ID | 场景 | 证据 | 状态 |
| --- | --- | --- | --- |
| S01 | 逐次重试与取消验收 | [报告](durable/pipeline-and-model-policy.md)，测试见上 | 任务证据已记录 |
| S02 | 辅助调用迟到 | [报告](durable/pipeline-and-model-policy.md)，测试见上 | 任务证据已记录 |
| S03 | Durable 结果提交失败 | [报告](durable/pipeline-and-model-policy.md)，测试见上 | 任务证据已记录 |

## model-operation-catalog/R01 — 类型化模型发现

来源：`openspec/changes/next-generation-nekomimi/specs/model-operation-catalog/spec.md:7`；任务：5.5。

验收报告：[model-routing/README.md](model-routing/README.md)、[typed-model/README.md](typed-model/README.md)、[typed-model/transport.md](typed-model/transport.md)

关联测试：`test/model-catalog.test.ts`、`test/model-operations.test.ts`、`test/model-routing.test.ts`、`test/typed-model.test.ts`

| 场景ID | 场景 | 证据 | 状态 |
| --- | --- | --- | --- |
| S01 | 同名多类型模型 | [报告](model-routing/README.md)，测试见上 | 任务证据已记录 |
| S02 | 有目录无凭证 | [报告](model-routing/README.md)，测试见上 | 任务证据已记录 |
| S03 | 同一模型的独立配置凭证 | [报告](model-routing/README.md)，测试见上 | 任务证据已记录 |

## model-operation-catalog/R02 — 宿主管理的分类与图片调用

来源：`openspec/changes/next-generation-nekomimi/specs/model-operation-catalog/spec.md:22`；任务：5.6。

验收报告：[model-routing/README.md](model-routing/README.md)、[typed-model/README.md](typed-model/README.md)、[typed-model/transport.md](typed-model/transport.md)

关联测试：`test/model-catalog.test.ts`、`test/model-operations.test.ts`、`test/model-routing.test.ts`、`test/typed-model.test.ts`

| 场景ID | 场景 | 证据 | 状态 |
| --- | --- | --- | --- |
| S01 | 模型返回操作错误 | [报告](model-routing/README.md)，测试见上 | 任务证据已记录 |
| S02 | 取消图片生成 | [报告](model-routing/README.md)，测试见上 | 任务证据已记录 |

## model-operation-catalog/R03 — 用途选择与费用口径

来源：`openspec/changes/next-generation-nekomimi/specs/model-operation-catalog/spec.md:33`；任务：5.5, 5.6。

验收报告：[model-routing/README.md](model-routing/README.md)、[typed-model/README.md](typed-model/README.md)、[typed-model/transport.md](typed-model/transport.md)

关联测试：`test/model-catalog.test.ts`、`test/model-operations.test.ts`、`test/model-routing.test.ts`、`test/typed-model.test.ts`

| 场景ID | 场景 | 证据 | 状态 |
| --- | --- | --- | --- |
| S01 | 两个用途不同模型 | [报告](model-routing/README.md)，测试见上 | 任务证据已记录 |

## model-operation-catalog/R04 — 实验路由的明确边界

来源：`openspec/changes/next-generation-nekomimi/specs/model-operation-catalog/spec.md:40`；任务：5.7。

验收报告：[model-routing/README.md](model-routing/README.md)、[typed-model/README.md](typed-model/README.md)、[typed-model/transport.md](typed-model/transport.md)

关联测试：`test/model-catalog.test.ts`、`test/model-operations.test.ts`、`test/model-routing.test.ts`、`test/typed-model.test.ts`

| 场景ID | 场景 | 证据 | 状态 |
| --- | --- | --- | --- |
| S01 | 路由到较小窗口 | [报告](model-routing/README.md)，测试见上 | 任务证据已记录 |
| S02 | 路由不可用 | [报告](model-routing/README.md)，测试见上 | 任务证据已记录 |
| S03 | 恢复未支持的路由配置 | [报告](model-routing/README.md)，测试见上 | 任务证据已记录 |

## pi-platform-integration/R01 — 版本与能力诊断

来源：`openspec/changes/next-generation-nekomimi/specs/pi-platform-integration/spec.md:7`；任务：2.2, 2.8。

验收报告：[durable/causality-and-recovery.md](durable/causality-and-recovery.md)、[creation-roundtrip/README.md](creation-roundtrip/README.md)、[privacy-admission/README.md](privacy-admission/README.md)、[platform-clean/README.md](platform-clean/README.md)

关联测试：`test/durable-journal-storage.test.ts`、`test/durable-model-service.test.ts`、`test/durable-recovery.test.ts`、`test/durable-runtime-recovery.test.ts`、`test/durable-tool-adapter.test.ts`、`test/sdk-admission.test.ts`

| 场景ID | 场景 | 证据 | 状态 |
| --- | --- | --- | --- |
| S01 | 发布包缺少入口 | [报告](durable/causality-and-recovery.md)，测试见上 | 任务证据已记录 |
| S02 | 离线查询能力 | [报告](durable/causality-and-recovery.md)，测试见上 | 任务证据已记录 |

## pi-platform-integration/R02 — 升级行为门槛

来源：`openspec/changes/next-generation-nekomimi/specs/pi-platform-integration/spec.md:18`；任务：2.3, 2.8, 11.4。

验收报告：[durable/causality-and-recovery.md](durable/causality-and-recovery.md)、[creation-roundtrip/README.md](creation-roundtrip/README.md)、[privacy-admission/README.md](privacy-admission/README.md)、[platform-clean/README.md](platform-clean/README.md)

关联测试：`test/durable-journal-storage.test.ts`、`test/durable-model-service.test.ts`、`test/durable-recovery.test.ts`、`test/durable-runtime-recovery.test.ts`、`test/durable-tool-adapter.test.ts`、`test/sdk-admission.test.ts`

| 场景ID | 场景 | 证据 | 状态 |
| --- | --- | --- | --- |
| S01 | 升级取消语义改变 | [报告](durable/causality-and-recovery.md)，测试见上 | 任务证据已记录 |

## pi-platform-integration/R03 — 不兼容输入保护

来源：`openspec/changes/next-generation-nekomimi/specs/pi-platform-integration/spec.md:25`；任务：2.1, 11.5。

验收报告：[durable/causality-and-recovery.md](durable/causality-and-recovery.md)、[creation-roundtrip/README.md](creation-roundtrip/README.md)、[privacy-admission/README.md](privacy-admission/README.md)、[platform-clean/README.md](platform-clean/README.md)

关联测试：`test/durable-journal-storage.test.ts`、`test/durable-model-service.test.ts`、`test/durable-recovery.test.ts`、`test/durable-runtime-recovery.test.ts`、`test/durable-tool-adapter.test.ts`、`test/sdk-admission.test.ts`

| 场景ID | 场景 | 证据 | 状态 |
| --- | --- | --- | --- |
| S01 | 使用旧数据目录 | [报告](durable/causality-and-recovery.md)，测试见上 | 任务证据已记录 |

## pi-platform-integration/R04 — Durable 目标运行底座

来源：`openspec/changes/next-generation-nekomimi/specs/pi-platform-integration/spec.md:32`；任务：1.4, 2.2, 2.3。

验收报告：[durable/causality-and-recovery.md](durable/causality-and-recovery.md)、[creation-roundtrip/README.md](creation-roundtrip/README.md)、[privacy-admission/README.md](privacy-admission/README.md)、[platform-clean/README.md](platform-clean/README.md)

关联测试：`test/durable-journal-storage.test.ts`、`test/durable-model-service.test.ts`、`test/durable-recovery.test.ts`、`test/durable-runtime-recovery.test.ts`、`test/durable-tool-adapter.test.ts`、`test/sdk-admission.test.ts`

| 场景ID | 场景 | 证据 | 状态 |
| --- | --- | --- | --- |
| S01 | Durable 接入不满足门槛 | [报告](durable/causality-and-recovery.md)，测试见上 | 任务证据已记录 |

## prompt-context-provenance/R01 — 按工具贡献提示

来源：`openspec/changes/next-generation-nekomimi/specs/prompt-context-provenance/spec.md:3`；任务：4.1, 4.3。

验收报告：[resource-context/README.md](resource-context/README.md)、[compaction-source/README.md](compaction-source/README.md)、[handoff-context/README.md](handoff-context/README.md)

关联测试：`test/context-compaction.test.ts`、`test/context-details.test.ts`、`test/context-projection.test.ts`、`test/context-revalidation.test.ts`、`test/context-runtime.test.ts`、`test/context-service.test.ts`、`test/context-snapshot.test.ts`、`test/handoff-context.test.ts`、`test/resource-context.test.ts`

| 场景ID | 场景 | 证据 | 状态 |
| --- | --- | --- | --- |
| S01 | 按工具贡献提示验收 | [报告](resource-context/README.md)，测试见上 | 任务证据已记录 |
| S02 | 扩展版本切换 | [报告](resource-context/README.md)，测试见上 | 任务证据已记录 |
| S03 | 限制定制工具集合 | [报告](resource-context/README.md)，测试见上 | 任务证据已记录 |
| S04 | 工具仅由脚本暴露 | [报告](resource-context/README.md)，测试见上 | 任务证据已记录 |

## prompt-context-provenance/R02 — 上下文追溯

来源：`openspec/changes/next-generation-nekomimi/specs/prompt-context-provenance/spec.md:24`；任务：4.2, 4.4。

验收报告：[resource-context/README.md](resource-context/README.md)、[compaction-source/README.md](compaction-source/README.md)、[handoff-context/README.md](handoff-context/README.md)

关联测试：`test/context-compaction.test.ts`、`test/context-details.test.ts`、`test/context-projection.test.ts`、`test/context-revalidation.test.ts`、`test/context-runtime.test.ts`、`test/context-service.test.ts`、`test/context-snapshot.test.ts`、`test/handoff-context.test.ts`、`test/resource-context.test.ts`

| 场景ID | 场景 | 证据 | 状态 |
| --- | --- | --- | --- |
| S01 | 上下文追溯验收 | [报告](resource-context/README.md)，测试见上 | 任务证据已记录 |
| S02 | 规则和技能更新 | [报告](resource-context/README.md)，测试见上 | 任务证据已记录 |
| S03 | MCP 提示与工作流输入 | [报告](resource-context/README.md)，测试见上 | 任务证据已记录 |
| S04 | 更新后的指导撤销 | [报告](resource-context/README.md)，测试见上 | 任务证据已记录 |
| S05 | 交接后检查工作请求 | [报告](resource-context/README.md)，测试见上 | 任务证据已记录 |

## prompt-context-provenance/R03 — 压缩投影来源链

来源：`openspec/changes/next-generation-nekomimi/specs/prompt-context-provenance/spec.md:49`；任务：4.6, 4.7。

验收报告：[resource-context/README.md](resource-context/README.md)、[compaction-source/README.md](compaction-source/README.md)、[handoff-context/README.md](handoff-context/README.md)

关联测试：`test/context-compaction.test.ts`、`test/context-details.test.ts`、`test/context-projection.test.ts`、`test/context-revalidation.test.ts`、`test/context-runtime.test.ts`、`test/context-service.test.ts`、`test/context-snapshot.test.ts`、`test/handoff-context.test.ts`、`test/resource-context.test.ts`

| 场景ID | 场景 | 证据 | 状态 |
| --- | --- | --- | --- |
| S01 | 检查压缩后的请求 | [报告](resource-context/README.md)，测试见上 | 任务证据已记录 |
| S02 | 旧记录和重放 | [报告](resource-context/README.md)，测试见上 | 任务证据已记录 |

## prompt-task-profiles/R01 — 按任务选择版本化指令

来源：`openspec/changes/next-generation-nekomimi/specs/prompt-task-profiles/spec.md:3`；任务：4.1。

验收报告：[task-profiles/README.md](task-profiles/README.md)

关联测试：`test/context-projection.test.ts`、`test/task-profiles.test.ts`

| 场景ID | 场景 | 证据 | 状态 |
| --- | --- | --- | --- |
| S01 | 辅助请求隔离 | [报告](task-profiles/README.md)，测试见上 | 任务证据已记录 |
| S02 | 同一请求分别处于两模式 | [报告](task-profiles/README.md)，测试见上 | 任务证据已记录 |
| S03 | 交接摘要 | [报告](task-profiles/README.md)，测试见上 | 任务证据已记录 |

## prompt-task-profiles/R02 — 指令与历史数据边界

来源：`openspec/changes/next-generation-nekomimi/specs/prompt-task-profiles/spec.md:20`；任务：4.1, 4.7。

验收报告：[task-profiles/README.md](task-profiles/README.md)

关联测试：`test/context-projection.test.ts`、`test/task-profiles.test.ts`

| 场景ID | 场景 | 证据 | 状态 |
| --- | --- | --- | --- |
| S01 | 历史中的执行请求 | [报告](task-profiles/README.md)，测试见上 | 任务证据已记录 |
| S02 | 检查及重放旧请求 | [报告](task-profiles/README.md)，测试见上 | 任务证据已记录 |
| S03 | 创造日志中的指令 | [报告](task-profiles/README.md)，测试见上 | 任务证据已记录 |

## runtime-ui-extensions/R01 — 完整全局风格契约

来源：`openspec/changes/next-generation-nekomimi/specs/runtime-ui-extensions/spec.md:3`；任务：9.1, 9.6。

验收报告：[runtime-slots/README.md](runtime-slots/README.md)、[live-panels/README.md](live-panels/README.md)

关联测试：`test/browser/live-panels.spec.ts`、`test/browser/v2-runtime-slots.spec.ts`、`test/panel-session-scope.test.ts`、`test/v2-slots.test.tsx`

| 场景ID | 场景 | 证据 | 状态 |
| --- | --- | --- | --- |
| S01 | 应用二次元风格 | [报告](runtime-slots/README.md)，测试见上 | 任务证据已记录 |
| S02 | 响应式与减少动态效果 | [报告](runtime-slots/README.md)，测试见上 | 任务证据已记录 |
| S03 | 旧主题契约 | [报告](runtime-slots/README.md)，测试见上 | 任务证据已记录 |

## runtime-ui-extensions/R02 — 声明式运行时扩展区域

来源：`openspec/changes/next-generation-nekomimi/specs/runtime-ui-extensions/spec.md:20`；任务：9.6。

验收报告：[runtime-slots/README.md](runtime-slots/README.md)、[live-panels/README.md](live-panels/README.md)

关联测试：`test/browser/live-panels.spec.ts`、`test/browser/v2-runtime-slots.spec.ts`、`test/panel-session-scope.test.ts`、`test/v2-slots.test.tsx`

| 场景ID | 场景 | 证据 | 状态 |
| --- | --- | --- | --- |
| S01 | 当前插槽注册契约 | [报告](runtime-slots/README.md)，测试见上 | 任务证据已记录 |
| S02 | 多插件共存 | [报告](runtime-slots/README.md)，测试见上 | 任务证据已记录 |
| S03 | 插件视图崩溃 | [报告](runtime-slots/README.md)，测试见上 | 任务证据已记录 |
| S04 | 创造专属预览 | [报告](runtime-slots/README.md)，测试见上 | 任务证据已记录 |

## runtime-ui-extensions/R03 — 受控宿主交互与状态订阅

来源：`openspec/changes/next-generation-nekomimi/specs/runtime-ui-extensions/spec.md:41`；任务：9.6。

验收报告：[runtime-slots/README.md](runtime-slots/README.md)、[live-panels/README.md](live-panels/README.md)

关联测试：`test/browser/live-panels.spec.ts`、`test/browser/v2-runtime-slots.spec.ts`、`test/panel-session-scope.test.ts`、`test/v2-slots.test.tsx`

| 场景ID | 场景 | 证据 | 状态 |
| --- | --- | --- | --- |
| S01 | 从挂件发起操作 | [报告](runtime-slots/README.md)，测试见上 | 任务证据已记录 |
| S02 | 授权撤销与伪造请求 | [报告](runtime-slots/README.md)，测试见上 | 任务证据已记录 |
| S03 | 迟到的旧页面请求 | [报告](runtime-slots/README.md)，测试见上 | 任务证据已记录 |
| S04 | 绑定目标的面板生命周期 | [报告](runtime-slots/README.md)，测试见上 | 任务证据已记录 |
| S05 | 主题管理的范围与故障恢复 | [报告](runtime-slots/README.md)，测试见上 | 任务证据已记录 |
| S06 | 桥接 HTTP 乱序 | [报告](runtime-slots/README.md)，测试见上 | 任务证据已记录 |

## self-customization-workflow/R01 — 对话自定制闭环

来源：`openspec/changes/next-generation-nekomimi/specs/self-customization-workflow/spec.md:3`；任务：7.8。

验收报告：[creation-roundtrip/README.md](creation-roundtrip/README.md)、[sdk-runtime/guides.md](sdk-runtime/guides.md)、[platform-clean/README.md](platform-clean/README.md)

关联测试：`test/browser/project-delivery.spec.ts`、`test/customization-workflow.test.ts`、`test/project-delivery.test.ts`

| 场景ID | 场景 | 证据 | 状态 |
| --- | --- | --- | --- |
| S01 | 创建并演进审查命令 | [报告](creation-roundtrip/README.md)，测试见上 | 任务证据已记录 |
| S02 | 创造失败 | [报告](creation-roundtrip/README.md)，测试见上 | 任务证据已记录 |

## self-customization-workflow/R02 — 第一版验收与第二版边界

来源：`openspec/changes/next-generation-nekomimi/specs/self-customization-workflow/spec.md:14`；任务：7.8, 11.4。

验收报告：[creation-roundtrip/README.md](creation-roundtrip/README.md)、[sdk-runtime/guides.md](sdk-runtime/guides.md)、[platform-clean/README.md](platform-clean/README.md)

关联测试：`test/browser/project-delivery.spec.ts`、`test/customization-workflow.test.ts`、`test/project-delivery.test.ts`

| 场景ID | 场景 | 证据 | 状态 |
| --- | --- | --- | --- |
| S01 | 验收报告 | [报告](creation-roundtrip/README.md)，测试见上 | 任务证据已记录 |

## self-customization-workflow/R03 — 按需开发导航和动作契约

来源：`openspec/changes/next-generation-nekomimi/specs/self-customization-workflow/spec.md:21`；任务：7.7。

验收报告：[creation-roundtrip/README.md](creation-roundtrip/README.md)、[sdk-runtime/guides.md](sdk-runtime/guides.md)、[platform-clean/README.md](platform-clean/README.md)

关联测试：`test/browser/project-delivery.spec.ts`、`test/customization-workflow.test.ts`、`test/project-delivery.test.ts`

| 场景ID | 场景 | 证据 | 状态 |
| --- | --- | --- | --- |
| S01 | 普通编码任务 | [报告](creation-roundtrip/README.md)，测试见上 | 任务证据已记录 |
| S02 | 项目及用户级风格开发 | [报告](creation-roundtrip/README.md)，测试见上 | 任务证据已记录 |
| S03 | 无效动作与缺失资料 | [报告](creation-roundtrip/README.md)，测试见上 | 任务证据已记录 |

## self-customization-workflow/R04 — 第三方提示贡献兼容

来源：`openspec/changes/next-generation-nekomimi/specs/self-customization-workflow/spec.md:36`；任务：7.1, 7.7。

验收报告：[creation-roundtrip/README.md](creation-roundtrip/README.md)、[sdk-runtime/guides.md](sdk-runtime/guides.md)、[platform-clean/README.md](platform-clean/README.md)

关联测试：`test/browser/project-delivery.spec.ts`、`test/customization-workflow.test.ts`、`test/project-delivery.test.ts`

| 场景ID | 场景 | 证据 | 状态 |
| --- | --- | --- | --- |
| S01 | 旧扩展和远端工具 | [报告](creation-roundtrip/README.md)，测试见上 | 任务证据已记录 |

## session-lifecycle/R01 — 确认删除与范围

来源：`openspec/changes/next-generation-nekomimi/specs/session-lifecycle/spec.md:3`；任务：3.7。

验收报告：[independent-sessions/README.md](independent-sessions/README.md)、[durable/causality-and-recovery.md](durable/causality-and-recovery.md)

关联测试：`test/durable-recovery.test.ts`、`test/independent-sessions.test.ts`、`test/session-identity.test.ts`

| 场景ID | 场景 | 证据 | 状态 |
| --- | --- | --- | --- |
| S01 | 删除非活动会话 | [报告](independent-sessions/README.md)，测试见上 | 任务证据已记录 |
| S02 | 并发写入与重复删除 | [报告](independent-sessions/README.md)，测试见上 | 任务证据已记录 |
| S03 | 删除过程中失败 | [报告](independent-sessions/README.md)，测试见上 | 任务证据已记录 |
| S04 | 删除创造会话 | [报告](independent-sessions/README.md)，测试见上 | 任务证据已记录 |

## session-lifecycle/R02 — 模式会话创建与恢复

来源：`openspec/changes/next-generation-nekomimi/specs/session-lifecycle/spec.md:30`；任务：3.1, 3.7。

验收报告：[independent-sessions/README.md](independent-sessions/README.md)、[durable/causality-and-recovery.md](durable/causality-and-recovery.md)

关联测试：`test/durable-recovery.test.ts`、`test/independent-sessions.test.ts`、`test/session-identity.test.ts`

| 场景ID | 场景 | 证据 | 状态 |
| --- | --- | --- | --- |
| S01 | 创建确认丢失 | [报告](independent-sessions/README.md)，测试见上 | 任务证据已记录 |
| S02 | 目标不可访问 | [报告](independent-sessions/README.md)，测试见上 | 任务证据已记录 |
| S03 | 原目标目录被替换 | [报告](independent-sessions/README.md)，测试见上 | 任务证据已记录 |
| S04 | 创建途中中断 | [报告](independent-sessions/README.md)，测试见上 | 任务证据已记录 |
| S05 | 已删除会话的创建命令重提 | [报告](independent-sessions/README.md)，测试见上 | 任务证据已记录 |

## session-lifecycle/R03 — Durable 观察与运行恢复分离

来源：`openspec/changes/next-generation-nekomimi/specs/session-lifecycle/spec.md:53`；任务：1.4, 2.3, 3.7。

验收报告：[independent-sessions/README.md](independent-sessions/README.md)、[durable/causality-and-recovery.md](durable/causality-and-recovery.md)

关联测试：`test/durable-recovery.test.ts`、`test/independent-sessions.test.ts`、`test/session-identity.test.ts`

| 场景ID | 场景 | 证据 | 状态 |
| --- | --- | --- | --- |
| S01 | 含未知工具的会话重开 | [报告](independent-sessions/README.md)，测试见上 | 任务证据已记录 |
| S02 | 显式继续任务 | [报告](independent-sessions/README.md)，测试见上 | 任务证据已记录 |
| S03 | Headless 任务命令重提 | [报告](independent-sessions/README.md)，测试见上 | 任务证据已记录 |

## web-customization/R01 — 分类导航与渐进展开

来源：`openspec/changes/next-generation-nekomimi/specs/web-customization/spec.md:3`；任务：10.2, 10.4。

验收报告：[create/candidate-executions.md](create/candidate-executions.md)、[studio-migration/README.md](studio-migration/README.md)、[loading-performance/README.md](loading-performance/README.md)

关联测试：`test/browser/candidate-management.spec.ts`、`test/browser/create-candidates.spec.ts`、`test/browser/create-conversation.spec.ts`、`test/browser/mcp-management.spec.ts`、`test/browser/package-management.spec.ts`、`test/browser/panel-management.spec.ts`、`test/browser/resource-management.spec.ts`、`test/browser/theme-management.spec.ts`、`test/browser/v2-feature-loading.spec.ts`、`test/browser/workflow-management.spec.ts`

| 场景ID | 场景 | 证据 | 状态 |
| --- | --- | --- | --- |
| S01 | 初次打开面板 | [报告](create/candidate-executions.md)，测试见上 | 任务证据已记录 |
| S02 | 切换分类查看资源 | [报告](create/candidate-executions.md)，测试见上 | 任务证据已记录 |

## web-customization/R02 — 二次元视觉与统一控件

来源：`openspec/changes/next-generation-nekomimi/specs/web-customization/spec.md:14`；任务：9.1, 9.5。

验收报告：[create/candidate-executions.md](create/candidate-executions.md)、[studio-migration/README.md](studio-migration/README.md)、[loading-performance/README.md](loading-performance/README.md)

关联测试：`test/browser/candidate-management.spec.ts`、`test/browser/create-candidates.spec.ts`、`test/browser/create-conversation.spec.ts`、`test/browser/mcp-management.spec.ts`、`test/browser/package-management.spec.ts`、`test/browser/panel-management.spec.ts`、`test/browser/resource-management.spec.ts`、`test/browser/theme-management.spec.ts`、`test/browser/v2-feature-loading.spec.ts`、`test/browser/workflow-management.spec.ts`

| 场景ID | 场景 | 证据 | 状态 |
| --- | --- | --- | --- |
| S01 | 查看不同分类的控件 | [报告](create/candidate-executions.md)，测试见上 | 任务证据已记录 |

## web-customization/R03 — 紧凑模型选择与配置编辑

来源：`openspec/changes/next-generation-nekomimi/specs/web-customization/spec.md:21`；任务：10.4。

验收报告：[create/candidate-executions.md](create/candidate-executions.md)、[studio-migration/README.md](studio-migration/README.md)、[loading-performance/README.md](loading-performance/README.md)

关联测试：`test/browser/candidate-management.spec.ts`、`test/browser/create-candidates.spec.ts`、`test/browser/create-conversation.spec.ts`、`test/browser/mcp-management.spec.ts`、`test/browser/package-management.spec.ts`、`test/browser/panel-management.spec.ts`、`test/browser/resource-management.spec.ts`、`test/browser/theme-management.spec.ts`、`test/browser/v2-feature-loading.spec.ts`、`test/browser/workflow-management.spec.ts`

| 场景ID | 场景 | 证据 | 状态 |
| --- | --- | --- | --- |
| S01 | 选择与取消选择 | [报告](create/candidate-executions.md)，测试见上 | 任务证据已记录 |
| S02 | 无可用 Provider | [报告](create/candidate-executions.md)，测试见上 | 任务证据已记录 |
| S03 | 取消草稿与保存失败 | [报告](create/candidate-executions.md)，测试见上 | 任务证据已记录 |
| S04 | 轮询期间编辑 | [报告](create/candidate-executions.md)，测试见上 | 任务证据已记录 |

## web-customization/R04 — 键盘与窄屏可用性

来源：`openspec/changes/next-generation-nekomimi/specs/web-customization/spec.md:40`；任务：9.5, 10.9。

验收报告：[create/candidate-executions.md](create/candidate-executions.md)、[studio-migration/README.md](studio-migration/README.md)、[loading-performance/README.md](loading-performance/README.md)

关联测试：`test/browser/candidate-management.spec.ts`、`test/browser/create-candidates.spec.ts`、`test/browser/create-conversation.spec.ts`、`test/browser/mcp-management.spec.ts`、`test/browser/package-management.spec.ts`、`test/browser/panel-management.spec.ts`、`test/browser/resource-management.spec.ts`、`test/browser/theme-management.spec.ts`、`test/browser/v2-feature-loading.spec.ts`、`test/browser/workflow-management.spec.ts`

| 场景ID | 场景 | 证据 | 状态 |
| --- | --- | --- | --- |
| S01 | 仅使用键盘操作 | [报告](create/candidate-executions.md)，测试见上 | 任务证据已记录 |
| S02 | 窄屏与长内容 | [报告](create/candidate-executions.md)，测试见上 | 任务证据已记录 |
| S03 | 高级模型迁移与历史分支 | [报告](create/candidate-executions.md)，测试见上 | 任务证据已记录 |
| S04 | 默认设置与运行时覆盖 | [报告](create/candidate-executions.md)，测试见上 | 任务证据已记录 |

## web-design-system/R01 — 统一语义控件与状态

来源：`openspec/changes/next-generation-nekomimi/specs/web-design-system/spec.md:7`；任务：9.1。

验收报告：[history-ui/README.md](history-ui/README.md)、[compact-header/README.md](compact-header/README.md)、[default-entry/README.md](default-entry/README.md)、[loading-performance/README.md](loading-performance/README.md)

关联测试：`test/browser/header-recovery.spec.ts`、`test/browser/theme-management.spec.ts`、`test/browser/v2-workbench.spec.ts`、`test/v2-theme.test.ts`

| 场景ID | 场景 | 证据 | 状态 |
| --- | --- | --- | --- |
| S01 | 跨工作台操作 | [报告](history-ui/README.md)，测试见上 | 任务证据已记录 |

## web-design-system/R02 — 键盘与响应式布局

来源：`openspec/changes/next-generation-nekomimi/specs/web-design-system/spec.md:14`；任务：9.5, 10.9。

验收报告：[history-ui/README.md](history-ui/README.md)、[compact-header/README.md](compact-header/README.md)、[default-entry/README.md](default-entry/README.md)、[loading-performance/README.md](loading-performance/README.md)

关联测试：`test/browser/header-recovery.spec.ts`、`test/browser/theme-management.spec.ts`、`test/browser/v2-workbench.spec.ts`、`test/v2-theme.test.ts`

| 场景ID | 场景 | 证据 | 状态 |
| --- | --- | --- | --- |
| S01 | 窄屏操作 | [报告](history-ui/README.md)，测试见上 | 任务证据已记录 |
| S02 | 多层浮层 | [报告](history-ui/README.md)，测试见上 | 任务证据已记录 |

## web-design-system/R03 — 双工作台布局与导航

来源：`openspec/changes/next-generation-nekomimi/specs/web-design-system/spec.md:25`；任务：9.2, 9.5。

验收报告：[history-ui/README.md](history-ui/README.md)、[compact-header/README.md](compact-header/README.md)、[default-entry/README.md](default-entry/README.md)、[loading-performance/README.md](loading-performance/README.md)

关联测试：`test/browser/header-recovery.spec.ts`、`test/browser/theme-management.spec.ts`、`test/browser/v2-workbench.spec.ts`、`test/v2-theme.test.ts`

| 场景ID | 场景 | 证据 | 状态 |
| --- | --- | --- | --- |
| S01 | 刷新深链接 | [报告](history-ui/README.md)，测试见上 | 任务证据已记录 |

## web-design-system/R04 — 长内容与草稿稳定性

来源：`openspec/changes/next-generation-nekomimi/specs/web-design-system/spec.md:32`；任务：9.3, 10.7。

验收报告：[history-ui/README.md](history-ui/README.md)、[compact-header/README.md](compact-header/README.md)、[default-entry/README.md](default-entry/README.md)、[loading-performance/README.md](loading-performance/README.md)

关联测试：`test/browser/header-recovery.spec.ts`、`test/browser/theme-management.spec.ts`、`test/browser/v2-workbench.spec.ts`、`test/v2-theme.test.ts`

| 场景ID | 场景 | 证据 | 状态 |
| --- | --- | --- | --- |
| S01 | 列表高度变化 | [报告](history-ui/README.md)，测试见上 | 任务证据已记录 |

## web-design-system/R05 — 失败隔离与恢复

来源：`openspec/changes/next-generation-nekomimi/specs/web-design-system/spec.md:39`；任务：9.4, 9.6, 10.9。

验收报告：[history-ui/README.md](history-ui/README.md)、[compact-header/README.md](compact-header/README.md)、[default-entry/README.md](default-entry/README.md)、[loading-performance/README.md](loading-performance/README.md)

关联测试：`test/browser/header-recovery.spec.ts`、`test/browser/theme-management.spec.ts`、`test/browser/v2-workbench.spec.ts`、`test/v2-theme.test.ts`

| 场景ID | 场景 | 证据 | 状态 |
| --- | --- | --- | --- |
| S01 | 主题和面板失效 | [报告](history-ui/README.md)，测试见上 | 任务证据已记录 |

## web-evidence-inspector/R01 — 请求到来源追溯

来源：`openspec/changes/next-generation-nekomimi/specs/web-evidence-inspector/spec.md:3`；任务：10.5。

验收报告：[context-ui/README.md](context-ui/README.md)、[inspection/README.md](inspection/README.md)

关联测试：`test/browser/context-details.spec.ts`、`test/browser/inspection.spec.ts`、`test/context-details.test.ts`、`test/inspection.test.ts`

| 场景ID | 场景 | 证据 | 状态 |
| --- | --- | --- | --- |
| S01 | 检查含工具历史的调用 | [报告](context-ui/README.md)，测试见上 | 任务证据已记录 |
| S02 | 检查工作交付上下文 | [报告](context-ui/README.md)，测试见上 | 任务证据已记录 |

## web-evidence-inspector/R02 — 原始响应与统计

来源：`openspec/changes/next-generation-nekomimi/specs/web-evidence-inspector/spec.md:18`；任务：10.6。

验收报告：[context-ui/README.md](context-ui/README.md)、[inspection/README.md](inspection/README.md)

关联测试：`test/browser/context-details.spec.ts`、`test/browser/inspection.spec.ts`、`test/context-details.test.ts`、`test/inspection.test.ts`

| 场景ID | 场景 | 证据 | 状态 |
| --- | --- | --- | --- |
| S01 | 失败与缺失用量 | [报告](context-ui/README.md)，测试见上 | 任务证据已记录 |
| S02 | 脚本生成图片 | [报告](context-ui/README.md)，测试见上 | 任务证据已记录 |

## web-evidence-inspector/R03 — 嵌套调用与交付证据树

来源：`openspec/changes/next-generation-nekomimi/specs/web-evidence-inspector/spec.md:35`；任务：10.6。

验收报告：[context-ui/README.md](context-ui/README.md)、[inspection/README.md](inspection/README.md)

关联测试：`test/browser/context-details.spec.ts`、`test/browser/inspection.spec.ts`、`test/context-details.test.ts`、`test/inspection.test.ts`

| 场景ID | 场景 | 证据 | 状态 |
| --- | --- | --- | --- |
| S01 | 脚本失败而子工具成功 | [报告](context-ui/README.md)，测试见上 | 任务证据已记录 |
| S02 | 打开旧预览记录 | [报告](context-ui/README.md)，测试见上 | 任务证据已记录 |

## web-session-stream/R01 — 快照与增量连续性

来源：`openspec/changes/next-generation-nekomimi/specs/web-session-stream/spec.md:3`；任务：9.3, 9.4。

验收报告：[history-ui/README.md](history-ui/README.md)、[runtime-performance/README.md](runtime-performance/README.md)

关联测试：`test/browser/history-navigation.spec.ts`、`test/browser/scrolling-native.spec.ts`、`test/browser/scrolling.spec.ts`、`test/browser/v2-history.spec.ts`、`test/v2-session-stream.test.ts`

| 场景ID | 场景 | 证据 | 状态 |
| --- | --- | --- | --- |
| S01 | 快照与订阅之间产生事件 | [报告](history-ui/README.md)，测试见上 | 任务证据已记录 |
| S02 | 跨模式迟到增量 | [报告](history-ui/README.md)，测试见上 | 任务证据已记录 |

## web-session-stream/R02 — 流展示与背压

来源：`openspec/changes/next-generation-nekomimi/specs/web-session-stream/spec.md:18`；任务：9.4, 10.7。

验收报告：[history-ui/README.md](history-ui/README.md)、[runtime-performance/README.md](runtime-performance/README.md)

关联测试：`test/browser/history-navigation.spec.ts`、`test/browser/scrolling-native.spec.ts`、`test/browser/scrolling.spec.ts`、`test/browser/v2-history.spec.ts`、`test/v2-session-stream.test.ts`

| 场景ID | 场景 | 证据 | 状态 |
| --- | --- | --- | --- |
| S01 | 慢消费者和超长历史 | [报告](history-ui/README.md)，测试见上 | 任务证据已记录 |
| S02 | 慢客户端查看验证 | [报告](history-ui/README.md)，测试见上 | 任务证据已记录 |

## web-task-workbench/R01 — 任务输入与继续

来源：`openspec/changes/next-generation-nekomimi/specs/web-task-workbench/spec.md:3`；任务：10.1。

验收报告：[navigation-migration/README.md](navigation-migration/README.md)、[input-editing/README.md](input-editing/README.md)、[core-switch-ui/README.md](core-switch-ui/README.md)

关联测试：`test/browser/core-switch-ui.spec.ts`、`test/browser/session-navigation.spec.ts`、`test/browser/v2-interactions.spec.ts`

| 场景ID | 场景 | 证据 | 状态 |
| --- | --- | --- | --- |
| S01 | 完成后继续 | [报告](navigation-migration/README.md)，测试见上 | 任务证据已记录 |
| S02 | 回车与换行 | [报告](navigation-migration/README.md)，测试见上 | 任务证据已记录 |
| S03 | 中文输入法 | [报告](navigation-migration/README.md)，测试见上 | 任务证据已记录 |
| S04 | 跨模式草稿 | [报告](navigation-migration/README.md)，测试见上 | 任务证据已记录 |

## web-task-workbench/R02 — 可发现的斜杠命令

来源：`openspec/changes/next-generation-nekomimi/specs/web-task-workbench/spec.md:28`；任务：10.1。

验收报告：[navigation-migration/README.md](navigation-migration/README.md)、[input-editing/README.md](input-editing/README.md)、[core-switch-ui/README.md](core-switch-ui/README.md)

关联测试：`test/browser/core-switch-ui.spec.ts`、`test/browser/session-navigation.spec.ts`、`test/browser/v2-interactions.spec.ts`

| 场景ID | 场景 | 证据 | 状态 |
| --- | --- | --- | --- |
| S01 | 发现自定义命令 | [报告](navigation-migration/README.md)，测试见上 | 任务证据已记录 |
| S02 | 重名与资源更新 | [报告](navigation-migration/README.md)，测试见上 | 任务证据已记录 |
| S03 | 目录不可用与无匹配 | [报告](navigation-migration/README.md)，测试见上 | 任务证据已记录 |
| S04 | 模式不同的命令 | [报告](navigation-migration/README.md)，测试见上 | 任务证据已记录 |

## web-task-workbench/R03 — 工作与创造双工作台

来源：`openspec/changes/next-generation-nekomimi/specs/web-task-workbench/spec.md:52`；任务：9.2, 10.1, 10.2。

验收报告：[navigation-migration/README.md](navigation-migration/README.md)、[input-editing/README.md](input-editing/README.md)、[core-switch-ui/README.md](core-switch-ui/README.md)

关联测试：`test/browser/core-switch-ui.spec.ts`、`test/browser/session-navigation.spec.ts`、`test/browser/v2-interactions.spec.ts`

| 场景ID | 场景 | 证据 | 状态 |
| --- | --- | --- | --- |
| S01 | 打开候选详情 | [报告](navigation-migration/README.md)，测试见上 | 任务证据已记录 |
| S02 | 无效深链接 | [报告](navigation-migration/README.md)，测试见上 | 任务证据已记录 |

## web-task-workbench/R04 — 验证任务可见与可取消

来源：`openspec/changes/next-generation-nekomimi/specs/web-task-workbench/spec.md:63`；任务：10.2, 10.8。

验收报告：[navigation-migration/README.md](navigation-migration/README.md)、[input-editing/README.md](input-editing/README.md)、[core-switch-ui/README.md](core-switch-ui/README.md)

关联测试：`test/browser/core-switch-ui.spec.ts`、`test/browser/session-navigation.spec.ts`、`test/browser/v2-interactions.spec.ts`

| 场景ID | 场景 | 证据 | 状态 |
| --- | --- | --- | --- |
| S01 | 后台验证与导航 | [报告](navigation-migration/README.md)，测试见上 | 任务证据已记录 |
| S02 | 验证工厂启动期间取消 | [报告](navigation-migration/README.md)，测试见上 | 任务证据已记录 |
| S03 | 验证清理无法确认 | [报告](navigation-migration/README.md)，测试见上 | 任务证据已记录 |
| S04 | 开发目录失效时取消 | [报告](navigation-migration/README.md)，测试见上 | 任务证据已记录 |
| S05 | 已完成预览过期 | [报告](navigation-migration/README.md)，测试见上 | 任务证据已记录 |

## work-create-modes/R01 — 模式与目标身份

来源：`openspec/changes/next-generation-nekomimi/specs/work-create-modes/spec.md:7`；任务：3.1。

验收报告：[mode-policy/README.md](mode-policy/README.md)、[independent-sessions/README.md](independent-sessions/README.md)、[mode-handoff-roundtrip/README.md](mode-handoff-roundtrip/README.md)

关联测试：`test/browser/create-conversation.spec.ts`、`test/create-target-scope.test.ts`、`test/independent-sessions.test.ts`、`test/mode-policy.test.ts`

| 场景ID | 场景 | 证据 | 状态 |
| --- | --- | --- | --- |
| S01 | 重启后继续 | [报告](mode-policy/README.md)，测试见上 | 任务证据已记录 |
| S02 | 更换模式 | [报告](mode-policy/README.md)，测试见上 | 任务证据已记录 |

## work-create-modes/R02 — 工作能力集

来源：`openspec/changes/next-generation-nekomimi/specs/work-create-modes/spec.md:18`；任务：3.2。

验收报告：[mode-policy/README.md](mode-policy/README.md)、[independent-sessions/README.md](independent-sessions/README.md)、[mode-handoff-roundtrip/README.md](mode-handoff-roundtrip/README.md)

关联测试：`test/browser/create-conversation.spec.ts`、`test/create-target-scope.test.ts`、`test/independent-sessions.test.ts`、`test/mode-policy.test.ts`

| 场景ID | 场景 | 证据 | 状态 |
| --- | --- | --- | --- |
| S01 | 普通项目修复 | [报告](mode-policy/README.md)，测试见上 | 任务证据已记录 |

## work-create-modes/R03 — 创造能力集

来源：`openspec/changes/next-generation-nekomimi/specs/work-create-modes/spec.md:25`；任务：3.3。

验收报告：[mode-policy/README.md](mode-policy/README.md)、[independent-sessions/README.md](independent-sessions/README.md)、[mode-handoff-roundtrip/README.md](mode-handoff-roundtrip/README.md)

关联测试：`test/browser/create-conversation.spec.ts`、`test/create-target-scope.test.ts`、`test/independent-sessions.test.ts`、`test/mode-policy.test.ts`

| 场景ID | 场景 | 证据 | 状态 |
| --- | --- | --- | --- |
| S01 | 源码不可用 | [报告](mode-policy/README.md)，测试见上 | 任务证据已记录 |
| S02 | 宿主构建变化 | [报告](mode-policy/README.md)，测试见上 | 任务证据已记录 |
| S03 | 开发根目录包含受保护目标 | [报告](mode-policy/README.md)，测试见上 | 任务证据已记录 |

## work-create-modes/R04 — 模式不授予权限

来源：`openspec/changes/next-generation-nekomimi/specs/work-create-modes/spec.md:40`；任务：3.2, 3.3。

验收报告：[mode-policy/README.md](mode-policy/README.md)、[independent-sessions/README.md](independent-sessions/README.md)、[mode-handoff-roundtrip/README.md](mode-handoff-roundtrip/README.md)

关联测试：`test/browser/create-conversation.spec.ts`、`test/create-target-scope.test.ts`、`test/independent-sessions.test.ts`、`test/mode-policy.test.ts`

| 场景ID | 场景 | 证据 | 状态 |
| --- | --- | --- | --- |
| S01 | 工作模式伪造激活请求 | [报告](mode-policy/README.md)，测试见上 | 任务证据已记录 |
| S02 | 嵌套调用与已知资料 ID | [报告](mode-policy/README.md)，测试见上 | 任务证据已记录 |
| S03 | 模式声明与工作流继续 | [报告](mode-policy/README.md)，测试见上 | 任务证据已记录 |
| S04 | 创造目录越界 | [报告](mode-policy/README.md)，测试见上 | 任务证据已记录 |

## workspace-references/R01 — 引用发现的工作区边界

来源：`openspec/changes/next-generation-nekomimi/specs/workspace-references/spec.md:3`；任务：10.9。

验收报告：[input-editing/README.md](input-editing/README.md)

关联测试：`test/session-references.test.ts`、`test/browser/references.spec.ts`

| 场景ID | 场景 | 证据 | 状态 |
| --- | --- | --- | --- |
| S01 | 外部路径与伪造候选 | [报告](input-editing/README.md)，测试见上 | 任务证据已记录 |
| S02 | 创造目录引用 | [报告](input-editing/README.md)，测试见上 | 任务证据已记录 |
| S03 | 引用时目标失效 | [报告](input-editing/README.md)，测试见上 | 任务证据已记录 |

