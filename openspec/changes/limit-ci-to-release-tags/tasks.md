## 1. 调整与验证

- [x] 1.1 修改 CI 触发和发布手册；解析 YAML 核验只有版本标签触发且发布门禁保留。
- [x] 1.2 运行 git diff --check 与 openspec validate --all --strict，记录验证范围。

验证：YAML 解析确认 tag-only CI、四组矩阵和 Release-only 发布；OpenSpec 严格校验、git diff --check 通过。未创建测试标签或触发远端工作流。
