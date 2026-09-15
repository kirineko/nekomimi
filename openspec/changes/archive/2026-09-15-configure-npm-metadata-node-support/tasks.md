## 1. 元数据与运行时

- [x] 1.1 配置 keywords、engines 和锁文件，检查 tarball 元数据一致。
- [x] 1.2 更新 README 和 CI 版本矩阵，检查最低小版本与发布运行时分离。

## 2. 验证

- [x] 2.1 在 Node.js 22.19.0 执行类型检查、单元测试、浏览器测试和打包安装验收；验证 Node.js 20 严格安装被依赖要求拒绝。
- [x] 2.2 记录验证边界并通过 openspec validate --all --strict。
