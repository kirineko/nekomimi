## Why

Windows 用户运行 nekomimi web 后因静态资源路径校验使用固定斜杠而收到“资源路径无效”。当前会话区域固定 760px、消息留白偏大且辅助状态重复，宽屏空间利用不足。对应 spec.md §13 第一阶段证据闭环及第三阶段浏览器检查器。

## What Changes

- 修复 Windows 静态资源目录边界校验及工作区名称展示，保留路径安全检查。
- 适配 Windows npm 全局安装验收脚本，增加原生 Windows 启动、资源和工作区闭环验证。
- 保留猫咪 logo 和渐变字标，建立紧凑的字体、间距、容器及组件比例系统。
- 对话按轮次组织，收拢重复完成状态及后台命名信息；错误、取消和未知结果仍清晰可见，完整证据可访问。
- 优化输入区、会话列表和响应式追踪面板，结合 React 最佳实践验证流式交互性能与可访问性。
- 本次不升级依赖、不修改模型协议、Journal 数据或离线导出模板，不自动发布新版本。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `local-web-service`: 跨平台静态资源加载及目录边界契约。
- `web-readable-presentation`: 紧凑响应式工作台和按轮次展示契约。
- `npm-release-delivery`: Windows 原生安装与启动验收契约。

## Impact

涉及 src/server/app.ts、跨平台路径辅助模块、src/web 的布局/组件/样式、安装验收脚本、测试、标签 CI 及用户支持文档。保持模块化划分，不把路径、展示投影和网络状态管理集中到 App.tsx。当前只有 Windows 路径语义复现，原生 Windows 尚未验收。
