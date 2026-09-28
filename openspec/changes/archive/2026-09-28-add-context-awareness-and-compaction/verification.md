# 验证记录

日期：2026-09-28。环境：macOS、Node.js 24.15.0、Chrome。所有模型响应均来自本地假 transport，未使用真实 API 凭证或付费调用。

## 已交付

- 输入框上下文圆环、百分比和系统/工具/对话三类估算；模型容量未知、图片近似、usage 校准和 revision 缓存。统计来自完整有效投影，独立于可见历史页；辅助调用不污染主上下文统计。
- 默认自动压缩、持久化开关、`/compact [保留重点]`、补全和保留名。内置与自定义 Responses / Chat Provider 共用检查点投影。128K/64 轮既有默认不变。
- 原始 Journal 不变；摘要带原节点引用、前置检查点、artifact 和 attemptIds。写队列内比较语义 revision 后一次提交。取消、并发变化、无效响应、无缩减均不生效；崩溃遗留状态不会显示为仍在整理。
- `nekomimi web` 监听成功后自动打开实际连接 URL；`--no-open` 绕过；失败和超时不停止服务。程序化 `startWeb` 无浏览器副作用。
- README、SDK 文档和包根 `ContextOccupancy` 类型入口更新。

## 检查结果

| 检查 | 结果 |
| --- | --- |
| `npm run typecheck` | 通过 |
| `npx vitest run --maxWorkers=2` | 50 个文件、282 项全部通过 |
| `npx vitest run test/context-service.test.ts --maxWorkers=1` | 最后补充中断状态断言后，3 项通过 |
| `npx vitest run test/context-runtime.test.ts --maxWorkers=1` | 补充内置配置自动压缩及实际请求对照后，9 项通过；总测试数现为 283 |
| `npx playwright test test/browser/context-meter.spec.ts test/browser/chat-loading-focus.spec.ts test/browser/history-navigation.spec.ts` | 7 项通过 |
| `npm run build` | 通过，主 JS 451.94 kB / gzip 140.53 kB，无大于 500 kB 警告 |
| `npm run test:release` | 7 项通过 |
| `openspec validate --all --strict` | 39 项通过 |
| `git diff --check` | 通过 |
| `node scripts/pack-smoke.mjs` | 隔离安装、全局 CLI、Web 静态资源、任务/导出/导入、扩展/Provider/工作流/MCP 通过 |
| `node scripts/pack-context-browser.mjs <installation-directory>` | 最终 tarball 中自动/手动压缩、取消、草稿、刷新、历史分页、主题和实际请求证据对照通过 |

首次不限并发的全量测试 277 项通过，3 项因超时失败；三项串行复验通过，随后受控并发的完整测试全部通过。浏览器测试修正了“前一次任务尚未结束就点击下一次提交”和“仍持有写锁就注入历史”的夹具竞态，未弱化焦点/跟随断言。

## 安装包复现与证据

```sh
npm run build
node scripts/pack-smoke.mjs
# 上一步输出隔离 installation directory。若代码有更新，用最新 tarball 更新该目录后再测：
npm pack --pack-destination /private/tmp
npm install --prefix <installation-directory> --ignore-scripts --no-audit --no-fund --registry=https://registry.npmjs.org /private/tmp/nekomimi-0.2.0.tgz
node scripts/pack-context-browser.mjs <installation-directory>
```

本次隔离目录：`/var/folders/v9/tsjz4byn1mg90zhd5gn680bm0000gn/T/harness-pack-CsRRVd`。最后一轮使用重打并重新安装的 tarball，包含中断状态修正。验收脚本读取安装包中的模块、Web 静态资源、SDK 文档和类型，不使用源码宿主。

- [桌面明细截图](../../../../output/playwright/installed-context-default.png)
- [360px 主题明细截图](../../../../output/playwright/installed-context-theme-mobile.png)
- [请求体大小、摘要用途和输出限制证据](../../../../output/playwright/installed-context-evidence.json)

假 Provider 声明 20K 窗口、2K 输出：长历史触发一次自动摘要并继续任务；手动摘要仅产生整理结果，不继续普通模型回复；第三次整理中取消没有新增检查点。发送的所有请求体与 Journal 保存的请求 artifact 逐一相等。保留完整原始历史、刷新恢复的占用数据，查看早期页不改变占用统计。

## 边界

- token 值为估算，可能失真；图片以占位说明进入历史摘要，原件仍保留；摘要有成本且可能损失细节。不能安全缩减时保留原内容并停止，不进行溢出重试。
- 自定义主题通过与运行时相同的 CSS 变量验证继承。用户草稿不计入占用值，实际发送前再次测量。
- macOS 启动分派使用替身程序做端到端测试；Windows/Linux 打开命令的参数和错误路径经过注入桩验证，未在这两种原生桌面环境实际启动浏览器。

## UI 精简补充

按用户截图反馈移除明细底部说明；浮层宽度从 340px 收至 300px，压缩内边距与行距，数字使用等宽数字并右对齐，弱化容量文字、触发按钮背景与阴影，保留与发送按钮的间隔。窄屏浮层居中，继续继承主题变量。估算约数保留，详细说明在文档中。

本轮 `npm run build`、`npm run typecheck`、`openspec validate add-context-awareness-and-compaction --strict`、`git diff --check` 和 `npx playwright test test/browser/context-meter.spec.ts` 全部通过；目视检查了窄屏截图。主 JS 451.74 kB，无 500 kB 警告。
