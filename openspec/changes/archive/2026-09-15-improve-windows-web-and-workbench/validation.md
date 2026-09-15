# 验收记录

## Windows 路径修复

- 修复静态资源 realpath 后写死 `/` 的校验；新增 resource-path 模块使用平台 relative/isAbsolute 判断，读取已校验的真实路径。
- 工作区标题同时识别 Windows/POSIX 分隔符。
- 6 项资源边界测试通过；与服务测试合计 18 项通过；类型检查通过。
- macOS 安装包验收通过：首页、JS/CSS、中文空格工作区、全局安装、文件配置、工具运行、项目隔离、规范路径恢复及导出导入。
- Windows shim、PowerShell 和 junction 分支已加入脚本，原生结果见下方发布验收。标签 CI 增加 windows-install，静态解析确认未增加日常 push/PR 触发。

## UI

完整会话、追踪及移动端概念图已获用户确认，视觉规范已落实到独立样式与组件。概念图只用于布局、层级和密度；保留现有 Brand，中文文案，不引入模型切换、附件上传或示例虚构统计。

## 未完成边界

初始验收时 Windows 原生结果待补；用户随后授权先归档、发布后人工测试，原生自动检查仍作为正式 Release 的前置条件。

## 本轮 UI 验证

- 类型检查通过；72 项单元测试、5 项浏览器测试、7 项发布检查通过；最终 tarball 全局安装和 Web 闭环验收通过。
- 1440×900、1920×1080、1280×720、390×844 截图均由真实 Chrome/Playwright 生成并人工查看，未写入仓库。原生自动化使用项目已有 Playwright fixture，以合成模型响应保证可重复，不依赖真实密钥。
- 检查点：保留 Brand、侧栏/顶栏比例、右侧短消息、正文行长、输入区域对齐、追踪并排/窄屏抽屉。中文真实任务文案与概念图英文示例不同；无新增模型选择/附件功能，统计来自实际证据。
- 键盘打开追踪后关闭按钮获焦，Escape 恢复触发按钮焦点；四视口无页面横向溢出且输入可见。
- 180 行历史输入及断言耗时 7ms（单次本机样本）；未据此声称流式输出性能全面达标。React 检查采用稳定行 key、纯轮次投影、消息 memo、按 rows 更新的分组缓存、焦点监听清理；未引入 Next.js API 或无依据的全局 memo。
- 会话按连续 runId 归组，缺失 runId 与分页残片保持独立，不重排跨轮次记录。正常完成提示合并，原始调用仍可从摘要与全部调用入口查看。

- 补充 React 静态展示检查：失败/取消/中断/未完成仍显示原因，完成状态折叠且命名调用入口保留；2 项通过，TSX 测试已纳入类型与测试配置。
- 补充 180 行历史下 8 次连续 SSE 展示更新：输入及断言 9ms，草稿保留，手动上滚位置没有被拉回；这是合成事件下的一次本机验收，不代表所有机器的吞吐保证。
- 当时未完成项为原生 Windows 安装结果及依赖该结果的完整跨平台验收；后续结果见下方发布验收。

## 用户授权的归档与发布顺序

用户明确要求先归档并发布，再进行 Windows 人工测试。归档时任务 1.2 与 3.3 的未验收部分保持未勾选，不视为已通过；发布标签仍执行 Windows 原生自动安装检查，人工验收待发布后补充。

标签 CI 首次 Windows 检查发现 tar 清单输出 CRLF 未被规范化，导致允许列表误报；已将行拆分改为同时处理 LF/CRLF，保留完整包内容检查，标签复验已通过。

## 0.1.2 发布验收

- 发布提交：`28ef3beed23e37d5fcc767b41780c6ccfcbe17be`。
- [标签 CI](https://github.com/kirineko/nekomimi/actions/runs/34965883597) 五组全部通过：Linux/macOS × Node.js 22.19.0/24.15.0，以及 Windows Node.js 22.19.0 原生安装检查。
- Windows 检查覆盖 npm 全局 shim、首页及 JS/CSS、中文空格目录、文件配置、PowerShell 文件操作、工作区隔离、junction 规范路径恢复及导出导入。测试通过合成模型响应执行，不依赖真实 API key。
- Windows 测试进程强制终止不会执行 SIGTERM 清理，脚本等待 10 秒写入锁过期后重启；该等待不修改应用租约保护。
- 用户 Windows 人工使用验收仍待发布后进行；自动化通过不等同所有 Windows 环境均已验证。

- [正式 Release](https://github.com/kirineko/nekomimi/releases/tag/v0.1.2) 与 [npm 自动发布](https://github.com/kirineko/nekomimi/actions/runs/34966414711) 完成。
- 官方 registry 已验证版本 `0.1.2`、`engines.node >=22.19.0`、9 项 keywords 及 SLSA 来源证明。下载包 SHA512 与 registry 一致：`sha512-2kcDquwCPyD2/YSzyQiKf4Z9cO4nJvo8Tz03TnpYJ0NYsPv8Tdq7L1PgBoDOo5uT8O44g1QMr/EMa+PaH0+C/A==`。
- 下载官方发布包后，使用 Node.js 22.19.0、npm 10.9.3、engine-strict 完成干净本地及全局安装、CLI、Web 资源/命令/导出、文件配置、工作区隔离、规范路径恢复及离线导出导入，全部通过。
