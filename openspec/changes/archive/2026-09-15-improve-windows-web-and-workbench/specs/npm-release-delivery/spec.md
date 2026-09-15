## ADDED Requirements

### Requirement: Windows 原生安装验收

Windows 支持声明 SHALL 以原生环境实际验收为依据，不能仅依靠模拟路径测试。版本标签检查 SHALL 增加 Windows 最低支持 Node.js 版本的全局安装与 Web 验收，保留仅发版触发策略。

#### Scenario: Windows 全局安装使用

- **WHEN** 在原生 Windows、Node.js 22.19.0 从生成的 tarball 全局安装并在项目目录启动
- **THEN** CLI shim、首页和资源、文件配置、平台 shell 工具及项目隔离验证通过；包含中文和空格的工作区可用，数据不写入安装目录。

#### Scenario: 缺少原生验证

- **WHEN** 尚无原生 Windows 检查结果或相关检查失败
- **THEN** 验收记录明确未完成，不宣称 Windows 已全面支持，不为完成验证擅自创建发布标签。
