## MODIFIED Requirements

### Requirement: Windows 原生安装验收

Windows 支持声明 SHALL 以原生环境实际验收为依据，不能仅依靠模拟路径测试。当前版本标签 CI/CD SHALL 暂停 Windows 检查，仅以 Linux/macOS × Node.js 22.19.0/24.15.0 四组 CI 作为发布门禁，保留仅发版触发策略。待 macOS/Linux 稳定后，Windows 优化与原生验收 SHALL 通过后续变更重新引入。

#### Scenario: Windows 全局安装使用

- **WHEN** 后续恢复 Windows 验证，在原生 Windows、Node.js 22.19.0 从生成的 tarball 全局安装并在项目目录启动
- **THEN** CLI shim、首页和资源、文件配置、平台 shell 工具及项目隔离验证通过；包含中文和空格的工作区可用，数据不写入安装目录。

#### Scenario: 缺少原生验证

- **WHEN** 尚无原生 Windows 检查结果或相关检查失败
- **THEN** 验收记录明确未完成，不宣称 Windows 已全面支持，不为完成验证擅自创建发布标签。

#### Scenario: 暂停 Windows 检查
- **WHEN** 当前阶段推送版本标签并准备正式发布
- **THEN** 不创建 Windows runner job，不等待 Windows 状态；仍需四组 Linux/macOS CI 全部通过才创建正式 Release，且文档明确当前验证范围。
