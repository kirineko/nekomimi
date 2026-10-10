# Durable底座安装包门槛

任务2.8完成。基线提交为be50c5a8a1557ef160056b964cd29e65b395685d，验证实际对象为当前未提交工作树构建的tarball；不能将基线提交当成完整产物版本。平台为macOS arm64，主运行时Node24.15.0；最低运行时Node22.19.0独立验证安装后的正式runtime。Linux及全部新功能安装验收仍由11.4/11.8承担。

## 结果

- `pack-verified.log`：`npm run test:pack`退出0。临时目录本地/全局安装（官方registry），CLI、工作区规范路径、Web静态资源/命令/导出、离线导入导出、SDK声明/资料、Provider、工作流、面板、MCP、主题二进制素材、候选授权及回退通过。新增Durable真实运行与SIGKILL恢复夹具也通过。
- `runtime-pack-node22.log`和`runtime-pack-node24.log`：已安装tarball的公开运行入口通过原始请求字节/hash、reasoning items与工具结果配对、tool_choice=auto，以及真实SIGKILL后显式继续不重跑未知工具。使用假Provider，无外部模型调用。
- `auxiliary-regression.log`：2文件23项通过，包括辅助命名的reasoning effort=none、隔离历史及上下文压缩；主请求原始items/协议和续轮另见model-policy-runtime.log。
- 本轮工具管线49项、模型相关70项及辅助23项均通过；不同组有重复场景，不汇总为唯一测试总数。类型检查和构建通过，严格OpenSpec43项通过。

## 已修复的验收夹具问题

保留四次失败日志：首页异步加载CSS后旧静态link检查失败；离线夹具使用裸Journal而缺少Durable格式；SDK3的Json结果需要显式类型守卫；macOS临时目录别名需使用readSession返回的规范目录读取附件。

修复后分别检查安装manifest中全部CSS的实际内容/类型、通过正式Journal Storage创建离线夹具、验证resource_list的Json结构、使用规范目录读取附件。没有放宽生产格式校验、SDK类型或附件符号链接保护。

安装包日志中的旧文字“legacy compatibility”来自夹具标题，不代表支持旧SDK声明；实际夹具使用SDK3，旧契约拒绝证据仍见format-admission.md。

## 范围

底座已迁移且通过本批次门槛；模式协议、能力选择、Codemode、完整模型目录和双工作台综合门槛仍有后续任务。未发布、未创建标签、未归档。
