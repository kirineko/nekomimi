# 代码语法高亮验收

日期：2026-09-16。变更：`add-code-syntax-highlighting`。环境为 macOS arm64、Node.js 24.15.0，另使用官方 Node.js 22.19.0 验证最低运行时；全部模型输入由本地测试 fixture 提供。

## 已交付行为

- Markdown 支持 JavaScript/TypeScript/TSX/Python/JSON/Shell/diff 及别名；`diff-ts` 等扩展 fence 叠加两侧片段语法色。
- 文件 diff 从保存的 before/after artifact 高亮，按旧/新行号映射，保留分页、增删符号、复制与长行截断。缺失、脱敏、损坏、未知语言或超预算安全降级。
- 固定 github-light 调色板生成 CSS 类。对固定代码/增删背景不足 4.5:1 的颜色降低亮度，Web 和导出采用相同样式；不放宽 CSP。
- 浏览器/Node Worker 分离加载与计算超时，限制输入、队列与缓存。流式更新合并，取消或切换会话后丢弃旧结果。
- 离线 HTML 在脱敏后高亮，内嵌样式，不运行脚本或访问网络；不修改 Journal。

## 检查与复现

| 检查 | 命令/入口 | 结果 |
| --- | --- | --- |
| 类型 | `npm run typecheck` | 通过 |
| 单元与集成 | `npm test` | 179 项通过（19 个文件） |
| 高亮专项 | `npx vitest run test/syntax.test.ts` | 7 项通过 |
| 完整 Chrome 回归 | `npm run test:browser` | 14 项通过 |
| Chrome/WebKit 高亮 | `npx playwright test -c playwright.syntax.config.ts` | 4 项通过 |
| 调色板一致性 | `node scripts/generate-syntax-styles.mjs --check` | 通过 |
| npm 包 | `npm run test:pack` | 本地及全局安装、CLI、导出/导入与 Web 闭环通过 |
| 最低运行时 | Node.js 22.19.0 运行 `scripts/pack-smoke.mjs` | 通过；另直接验证 Worker 和 Markdown SSR |
| OpenSpec | `openspec validate --all --strict` | 20 项通过 |

跨浏览器测试先运行 `npm run build`，并准备 Chrome 与 Playwright WebKit。此次 WebKit 安装于 `/tmp/nekomimi-playwright`，运行时设置 `PLAYWRIGHT_BROWSERS_PATH=/tmp/nekomimi-playwright`。浏览器验收使用实际生产静态资源及服务 CSP，无真实模型或外部服务依赖。

Node.js 22.19.0 官方 darwin-arm64 tarball 的 SHA256 为 `c59006db713c770d6ec63ae16cb3edc11f49ee093b5c415d667bb4f436c6526d`，与官方 SHASUMS256.txt 一致。将解压目录的 bin 放到 PATH 首位运行安装包验收；包中 Node Worker 被实际调用，并检查 Web Worker 文件存在。

WebKit 的 offline 模拟会拒绝 `file://` 导航，因此它的离线测试使用本地 HTML 文件并拦截全部 HTTP 请求；Chrome 使用 offline 模拟。两者均验证导出语法颜色、脚本不执行、无 HTTP 请求，且颜色与 Web 相同。此限制仅涉及测试环境的断网模拟。

## 实际性能和分包

下表是单次本机生产页面测量，不是跨硬件性能保证。流式 fixture 同时含 100 行、1,000 行及超过 256KiB 的代码；超预算块保留纯文本。输入操作耗时包含 Playwright 往返，首块时间也包含模型 fixture 流式传输和 UI 更新。

| 测量 | Chrome | WebKit |
| --- | ---: | ---: |
| 首个 100 行代码块高亮可见 | 787ms | 1,291ms |
| 流式期间输入框填入文本 | 6ms | 4ms |
| 检查器再次展示相同代码 | 133ms | 121ms |

缓存测试在重复查看前后记录 Worker postMessage 次数，均保持 2 次，没有重新计算。测试还覆盖 1,000 行块最终高亮、超预算降级、流式中停止任务及切换会话后无旧结果。缓存/队列上限与可终止超时由专项测试覆盖。

生产构建中高亮不进入首屏执行路径：Worker 175,303 字节（gzip 56,254），TypeScript 语言 chunk 181,073 字节（gzip 16,032），其他语言独立按需加载。首屏主脚本完整体积 429,445 字节（gzip 130,090），这是当前工作区整体产物，不是本变更净增量。gzip 使用 Node zlib 默认参数，与 Vite 报告的压缩参数可能不同。

全部 JS 文件测量见 [bundle-sizes.json](bundle-sizes.json)。浏览器请求记录确认 Worker 和语言均从本地服务加载，没有外部高亮请求。

## 展示证据

- [桌面截图](desktop.png)
- [窄屏截图](mobile.png)

截图使用合成代码和临时工作区。已检查实际 token 颜色、diff 背景与窄屏滚动；完整既有浏览器回归继续覆盖焦点、复制/展开相关交互、导出和会话操作。

## 边界

- 首批语言限于上表，未知语言保持原文，不自动猜测。
- 仅有 diff fence 片段时无法恢复 hunk 外语法状态；完整文件 diff 使用历史 artifact，绝不读取当前文件补齐。
- 每份输入最多 256KiB / 5,000 行，计算超时 1 秒，语言/Worker 加载超时 10 秒；超过限制不阻止阅读或导出。
- 本次最低版本安装包验收在 macOS 完成，未替代发布流程的多平台 CI；本次未发版或归档。
