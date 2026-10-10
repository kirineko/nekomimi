# 随包 SDK 资料与离线开发（7.7）

2026-10-07，macOS arm64 / Node.js 24.15.0，实际对象为未提交工作树构建的安装包。

## 修改

- README 明确 SDK 3、旧 SDK 1/2 的加载前拒绝、独立创造目标以及 CLI 手工候选的来源边界，删除错误的旧协议兼容承诺。
- 新增 cli.md 和完整 Skill 示例；SDK 目录与 CLI 帮助提供实际可读的离线开发入口。命令 trial 必须携带检查后的内容 hash 和带斜杠的命令。
- 扩展开发与核心源码、可信构建、受管切换前提分别说明；安装包资料不冒充核心源码。
- 更新用户数据路径与 OAuth 说明，基础 example.ts 的示例清单补齐 hooks 权限。
- 安装验收通过 CLI 读取全部目录指南、校验正文 hash 和宿主构建，拒绝过期目标；实际创建、检查、模拟、授权并运行命令，保存并发现 Skill，创建和加载主题后显式选择。额外使用指南中的真实清单和 example.ts 验证注册成功。

## 验证与边界

- guides-regression.log：3 文件 18 项通过，覆盖所有随包 TS 示例编译、公开 SDK 边界、旧契约拒绝、目标隔离和资料绑定。
- guides-types.log：类型检查退出码 0；guides-specs.log：严格规格 43 项通过。
- guides-pack-first.log 和 guides-pack-final.log 保留新指南 trial 调用的两次失败，分别为漏传 contentHash、漏写命令前导斜杠；修正指南和调用参数后通过。
- guides-pack-verified.log：完整打包、临时本地/全局安装、Web、SDK、Codemode、能力包、Provider、工作流、面板、MCP、二进制主题和 Durable 崩溃不重放全部通过。
- guides-pack-complete.log：补齐 hooks 清单及完整示例实际加载后的最终安装包回归，退出码 0，全流程通过。

安装依赖阶段使用官方 registry；验收使用已经安装的产物，安装目录无 src checkout。离线 SDK 夹具零模型调用，其余网络场景使用确定性夹具，不调用真实外部模型。
主题选择不等于实际字体/图片渲染或视觉验收；本任务不替代第 10/11 组浏览器、最低 Node、Linux 或真实模型质量门槛。
