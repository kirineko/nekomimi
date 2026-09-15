## ADDED Requirements

### Requirement: 发布标签触发 CI

CI SHALL 仅对推送的 v 开头版本标签运行 Linux/macOS 与 Node.js 22/24 检查矩阵；普通分支 push 和 pull request SHALL 不触发 CI。npm 正式上传仍 SHALL 由正式 GitHub Release 触发并保留发布前检查。

#### Scenario: 日常开发提交

- **WHEN** 推送分支或创建、更新 PR
- **THEN** 不触发 CI 或 npm 发布。

#### Scenario: 标签发布

- **WHEN** 推送 v0.1.2 等版本标签
- **THEN** CI 检查该标签提交；维护者等待通过后创建正式 Release，发布流程检查失败时不上传 npm。
