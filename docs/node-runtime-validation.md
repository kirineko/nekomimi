# npm 元数据与 Node.js 兼容性验收

日期：2026-09-15。变更：`configure-npm-metadata-node-support`。

## 结论

- 包最低版本由 Node.js >=24 降为 >=22.19.0，README 与 lockfile 同步。
- keywords 已加入包并在生成 tarball 中核验：nekomimi、deepseek、ai、coding-agent、coding-assistant、cli、web-ui、local-first、observability。
- 固定版本的 pi-agent-core、pi-ai、pi-telemetry、chord 声明 Node.js >=22.19.0；Node.js 20 和较早的 Node.js 22 不在支持范围。

## 实际验证

macOS arm64，Node.js 22.19.0、npm 10.9.3，临时运行时未改变默认 Node：

| 检查 | 结果 |
| --- | --- |
| npm run typecheck | 通过 |
| npm test | 构建成功，63 个测试通过 |
| npm run test:release | 7 个测试通过 |
| npm run test:browser | 4 个测试通过 |
| npm_config_engine_strict=true npm run test:pack | 严格安装与全局安装成功，CLI、Web、文件配置、工作区隔离、规范路径恢复及离线导出导入通过 |
| tarball package.json | keywords、engines 与项目元数据一致 |
| Node.js 20.20.2 / npm 10.8.2 严格安装 pi-agent-core@0.85.1 | 如预期 EBADENGINE，Required >=22.19.0 |
| openspec validate --all --strict | 通过 |

## 边界

CI 新增 Linux/macOS × Node.js 22.19.0/24.15.0 矩阵，新增矩阵尚未推送执行。发布工作流仍使用 Node.js 24.15.0。本次使用合成模型响应验证产品闭环，没有额外调用真实模型。

该变更纳入 0.1.1 发布；npm 页面元数据在发布成功后生效。

关键词配置依据：[npm package.json 文档](https://docs.npmjs.com/cli/v11/configuring-npm/package-json#keywords)。依赖要求依据仓库锁定的 0.85.1 包元数据及严格安装结果。
