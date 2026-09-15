## ADDED Requirements

### Requirement: 搜索元数据与最低运行时

发布包 SHALL 提供与本地编程助手相关的非空 keywords 数组，Node.js 最低要求 SHALL 为 22.19.0，README 与包元数据保持一致。CI SHALL 覆盖最低版本和 Node.js 24；固定依赖不支持的 Node.js 20 和较早的 22 小版本不得声明支持。

#### Scenario: 最低版本安装使用

- **WHEN** 在 Node.js 22.19.0 安装生成的 npm 包
- **THEN** 安装符合 engines 约束，CLI、Web、工作区隔离和离线导出导入检查通过。

#### Scenario: 元数据进入发布产物

- **WHEN** 生成 npm tarball
- **THEN** 包中的 keywords 非空且 engines 与 README 声明相符；版本未发布时不宣称 npm 网站已更新。
