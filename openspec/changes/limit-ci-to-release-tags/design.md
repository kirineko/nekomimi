## Context

CI 当前监听所有 push 与 PR；publish.yml 已独立监听 release.published 并提供发布检查。

## Goals / Non-Goals

**Goals:** 减少日常远端运行，同时保留版本兼容性矩阵。

**Non-Goals:** 不改变 npm Trusted Publisher、不自动发布标签、不删除历史运行。

## Decisions

使用 push.tags: [v*]；移除分支和 PR 触发。正式 Release 继续独立验证并上传，操作顺序记录在发布手册。

## Risks / Trade-offs

日常提交不再自动测试 → 开发时本地检查，发版时等待标签 CI。发布工作流与标签 CI 独立 → 手册明确等待顺序；发布工作流自身仍执行检查。配置只做静态验证，本次不创建测试发布标签。
