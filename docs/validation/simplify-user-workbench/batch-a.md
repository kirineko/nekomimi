# 批次 A 验证记录（任务 1.1–1.5）

## 1.1 静态 HTML nonce 与 CSP
- `src/server/app.ts`：每个 HTML 响应生成 16 字节 base64 nonce，替换 `__CSP_NONCE__`；CSP 增加 `style-src 'self' 'nonce-…'` 与 `worker-src 'self'`；非 HTML 资源字节不变（res.end 原 buffer）。
- `src/web/index.html`：新增 `<meta property="csp-nonce">`。
- 验证：`test/server.test.ts` 新增 2 项——两次 GET `/work` nonce 不同、HTML 无占位符、CSP 无 unsafe-inline/unsafe-eval、CSS 资产无 nonce；构建产物 index.html 保留占位符。14/14 通过。

## 1.2 前端注入 nonce
- `src/web/csp-nonce.ts`（main.tsx 首行静态导入）调用 `get-nonce.setNonce`；`get-nonce@1.0.1` 提升为直接依赖。
- 验证：`npm ls get-nonce` 只有一个解析（deduped）；`test/browser/csp-nonce.spec.ts`：打开删除确认/调用证据/外观三个对话框后 `securitypolicyviolation` 计数为 0，且对话框打开时 `body.overflow === 'hidden'`（滚动锁生效）。1/1 通过。

## 1.3 Tailwind preflight 与基线
- `tokens.css`：按层导入 theme/preflight/utilities，新增 `@layer base`（body、链接、富文本列表/标题）；`Resizable.tsx` 分隔条改为 1px 细线+扩大命中区。
- 验证：`test/browser/style-baseline.spec.ts`：导航链接无下划线且颜色继承前景色；富文本 ul 为 disc、标题字号大于正文。1/1 通过。
- 截图：docs/validation/simplify-user-workbench/screens/{work-light,work-dark,create-light,settings-light}.png（人工审阅：链接不再为浏览器默认蓝色下划线；明暗主题正常）。

## 1.4 连接授权失效引导
- `api.ts`：401 auth 广播 `AUTH_LOST`，connect 成功广播 `AUTH_RESTORED`；`main.tsx` 增加 `hashchange` 监听——同一标签页打开新终端链接（仅 hash 变化的同文档导航）时重新 connect 并 reload。**修复了一个真实缺陷**：此前同一标签页打开新链接时 SPA 不重载，connect 不执行，授权引导永远无法恢复。
- `v2/connection-gate.tsx`：整页引导覆盖（children 用 hidden 保留，不卸载），重试只发读请求。
- 验证：`test/browser/auth-guide.spec.ts` 2 项：未授权直接访问只见引导、无零散错误；授权失效后提交只有一次 POST、草稿保留；重新打开终端链接后引导消失、无错误响应、无隐藏写命令。2/2 通过。

## 1.5 批次 A 回归
- typecheck（src+web）0 错误；`npm run build` 通过。
- 新增/修改测试全部通过：server.test.ts 14/14；csp-nonce、style-baseline、auth-guide 4/4；live-panels/panel-management/workbench 复跑 9/9。
- 全量 `npm test` 与完整 `npm run test:browser` 由批次 D（4.1）执行。
