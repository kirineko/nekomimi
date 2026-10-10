# 10.9 默认工作台入口切换

2026-10-08，未提交工作树，macOS arm64 / Node.js 24.15.0 / Chrome 154.0.8037.98。

默认 `/` 在完成 token 连接后进入 `/work`，工作/创造深链接正式使用 `/work`、`/create`。移除旧 App 分流，先前 `/v2/*` 实验地址显示无效页面，不创建会话或执行模型。源码 `web/v2` 名称与内部缓存版本保留，不作为公开兼容路由。浏览器测试和相关 CLI smoke 路径已同步。

通过 TypeScript import 图核对新入口、共享代码与所有测试依赖，删除 **24 个旧模块（包括 App）和 5 份专用样式**。`RuntimeTheme` 只被新页面用于类型引用，类型提取至 `web/theme-types.ts`；共享渲染组件和离线导出语法样式保留。删除清单见 `removed.json`。

## 验证

**30 项不同浏览器场景通过**：入口/双模式基础、按需加载故障、工作任务闭环及九项定制集成。首次合跑 29 通过、1 项测试错误地把首次 `/connect` 认证请求当业务写入；修正后该项单独复核通过。最终断言恰好一次认证请求、零其他 POST、零模型调用，包含正式入口、刷新、模式导航及无效旧实验地址。

```sh
npx playwright test test/browser/v2-workbench.spec.ts test/browser/v2-feature-loading.spec.ts test/browser/workbench.spec.ts test/browser/customization.spec.ts --workers=2
npx playwright test test/browser/v2-workbench.spec.ts --grep 'default entry' --workers=2
npm run typecheck
npm run build
openspec validate --all --strict
```

完整类型检查、构建及严格规格通过。构建报告主 app chunk 657.29 kB / gzip 205.19 kB 并提示超过 500 kB；这是当前打包结果，尚无同硬件冷启动/历史基线对照，不据此宣称性能改善或回归。可选功能延迟加载/失败重试检查通过。

## 未完成契约

清理依赖时确认 `test/conversation-display.test.tsx` 仍只验证旧 Timeline，而新 SessionTimeline 未完整承接 `web-readable-presentation` 的按轮次组织、成功状态合并和辅助调用按需查看。因此暂留旧 Timeline 及关联模块/测试，下一步先在新实现补齐并迁移证据，再移除余下旧模块。不能把本批入口通过视为整个 10.9 完成。

全量浏览器、7.8 创造交付及第 11 组门槛仍未完成，进度 78/89，未提交、归档或发布。
