## Why

普通提交、标签和 Release 重复触发检查，产生过多 Actions 运行。按用户要求将远端检查集中在发版阶段，对应 spec.md §13 交付验证。

## What Changes

- CI 仅在推送 v 开头的版本标签时触发，普通分支 push 和 PR 不运行。
- 正式 Release 继续触发 npm 发布并保留全部发布检查。
- 发布手册改为先推送标签、等待 CI 通过、再创建正式 Release。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `npm-release-delivery`: 明确发布阶段的 CI 触发范围。

## Impact

仅工作流及发布手册；不修改运行时代码、依赖、Journal、凭证或已发布版本。
