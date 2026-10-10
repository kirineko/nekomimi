# 下一代 Nekomimi 验收索引

当前变更：`openspec/changes/next-generation-nekomimi`，尚未归档或发布。任务文件为完成状态入口；历史报告与 manifest 固定当时版本，不由后来修改自动升级为最新证据。

## 当前进展

**89/89 项 apply 已完成并验证。** 最终单元 788/788、浏览器 201/201、类型检查、严格规格 43/43、发布检查 7/7 及四组同包安装通过。详见 [最终评审报告](completion.md)。Linux 共享挂载可靠性失败与其它限制保留；没有归档或发布。

| 验收范围 | 证据 |
| --- | --- |
| 需求到任务映射 | [覆盖索引](coverage.md)、[机器可读索引](coverage.json)、[任务文件](../../../openspec/changes/next-generation-nekomimi/tasks.md) |
| 原版本基线与首次失败 | [基线](baseline/README.md) |
| 主规格语义核对 | [兼容审计](compatibility-audit.md) |
| Journal/Durable 与最终执行 | [Durable 接入](durable/README.md)、[因果与恢复](durable/causality-and-recovery.md) |
| 工作与创造之间的项目安装 | [服务与浏览器](project-delivery/README.md)、[完整创造演进及双 Node 安装](creation-roundtrip/README.md) |
| 旧目录与凭证保护 | [准入/脱敏/只读验证](privacy-admission/README.md) |
| 最终完整单元与浏览器 | [最终回归：788 单元 / 201 浏览器](final-regression/README.md)；历史 [单元 777](full-regression/README.md)、[浏览器 198](live-panels/README.md) 保留为阶段证据 |
| 加载拆分、失败修复与体积回归 | [加载性能](loading-performance/README.md) |
| 同模型/fixture 的上下文、内存与长历史对照 | [运行性能](runtime-performance/README.md) |
| 平台与精确 Node 版本 | [平台矩阵](platform-matrix.md)、[最终同包与文件系统诊断](platform-clean/README.md) |
| 真实模型抽样缺失 | [缺失报告](real-model-missing.md) |

## 实现边界

Pi AI/Durable/Chord/Codemode/MCP 固定 1.0.4；正式执行循环接入公开 Harness/Storage，Journal 是唯一权威历史。SDK 3、数据格式 2；旧 SDK 与不兼容数据在写入/工厂前拒绝。未知副作用不自动重试；交付、激活、回放和模型上下文各有独立边界。

默认工作台 `/work`、创造空间 `/create`；`/dev/ui` 是组件实验入口。普通工作目录与独立创造目标不混用。核心切换需要匹配的源码基线、可信构建及显式授权，安装包不携带完整宿主源码。

无真实模型抽样授权，所有本轮测试使用离线 fixture；不能据其报告真实成本、质量或图片效果。性能测量已披露准备时间、RSS、gzip 和直接会话 JS 回归。Windows 按既有决定暂缓，不借 macOS/Linux 结果宣称完成。

只有全部门槛确实完成后才另行同步主规格和归档；发版仍需明确授权。
