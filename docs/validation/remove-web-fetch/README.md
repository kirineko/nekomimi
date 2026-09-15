# 移除 web_fetch 验证

日期：2026-09-16；macOS arm64 / Node.js 24.15.0。对应 change：remove-web-fetch。

## 实现

- 移除工具注册、提示词、服务端选项、HTML 提取、网络抓取及系统/环境代理逻辑。
- 删除直接依赖 htmlparser2、ipaddr.js、undici，lockfile 共移除 8 个包；`npm ls htmlparser2 ipaddr.js undici --all` 为空。
- 保留旧 fetch 事件的只读投影和摘要、artifact 入口；没有抓取执行路径。
- 构建前清理 dist，安装包检查禁止携带 dist/web-fetch 模块。当前文档删除代理教程，历史发布与归档记录保留。

## 验证结果

- 类型检查通过；17 个测试文件、105 项单元/集成测试通过。
- 新增回归覆盖搜索开关下的工具集、实际模型请求与过时调用返回未知工具，以及旧成功/失败/取消/截断记录的导出导入、artifact 读取和 Journal 保真。
- 浏览器 13 个用例均通过：首轮与单元测试并行时，既有工作台用例超过 5 秒完成等待；单独重跑 2.2 秒通过，未放宽断言。搜索及 favicon 回归首次通过。
- 干净构建与安装包验收通过：包内没有抓取执行资源，安装后的模型工具定义不包含 web_fetch；全局 CLI、Web、配置、工作区隔离、高亮 Worker 与离线导出导入均通过。
- OpenSpec 严格校验 19/19 通过；git diff --check 通过。

变更已归档到 openspec/changes/archive/2026-09-16-remove-web-fetch；主动抓取主规格已退役，历史兼容契约已同步至 core-tools。发版过程与结果见 ../../releases/0.1.5.md。
