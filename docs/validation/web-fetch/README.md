# Favicon 与 web_fetch 验收记录

日期：2026-09-15。环境：macOS、Node.js 24.15.0、Chrome（项目 Playwright 配置）。变更：`add-brand-favicon-and-web-fetch`。

## 已验证行为

- 页面 logo 与 favicon 使用同一品牌 SVG；生产首页声明 `/assets/nekomimi-*.svg`，静态响应为 `image/svg+xml`，浏览器可在 16×16 画布解码，页面 logo 实际加载成功。
- 搜索 → 读取 URL → 模型收到抓取正文/摘要 → 回答的 fixture 闭环完成，重载不增加搜索或抓取次数。卡片显示最终 URL、HTTP 状态、description 摘要标记，证据入口可读取保存的文本。
- Deepy 细节：HTML 正文优先，有意义的短正文保留；description → og:description → twitter:description 回退；gzip/deflate 解压、GBK 解码、正文和输出分级截断、空内容、未知编码失败。
- dsh 补充：公开目标检查、DNS 固定连接、同源重定向上限、跨源显式目标、隐藏元素移除、有界解析、匿名请求、取消、错误与回放元数据。
- HTTP fixture 经过真实 Undici transport 解压，解压后上限正确；不发送 Authorization、Cookie 或 x-api-key。私有目标和混合 DNS 地址在请求前拒绝。
- 失败页面保存响应证据并脱敏；导出 bundle 后导入仍可读取状态和 artifact，不触发网络。重定向后连接失败不沿用上一跳 HTTP 状态。
- 桌面 1440×1000 和窄屏 390×844 截图经人工式视觉检查，卡片可读，无页面横向溢出。截图位于本地忽略目录 `output/playwright/web-fetch-desktop.png`、`output/playwright/web-fetch-mobile.png`。

## 检查命令

- `npm run typecheck`：通过。
- `npx vitest run`：141/141 通过，覆盖完整项目单元与集成测试。
- `npx playwright test`：11/11 通过。
- `npm run test:release`：7/7 通过，仅验证发布元数据，不发版。
- `npm run test:pack`：临时本地安装、临时 prefix 全局安装、全局 CLI/Web、图标 MIME、安装后 web_fetch、离线导出导入通过；最终代码已复验，临时安装目录为 `/var/folders/v9/tsjz4byn1mg90zhd5gn680bm0000gn/T/harness-pack-YNGcMD`。
- `openspec validate --all --strict`：18/18 通过。

初次并行运行单元与浏览器测试时出现短超时：取消证据测试的 30 毫秒期限早于磁盘写入完成，现已改为由第二次流读取确定性触发取消，超时单独验证；既有浏览器任务等待在顺序重跑后通过，未修改其断言。

## 验证范围与限制

本次没有真实模型调用，不以凭证作为测试条件；公网网站兼容性、Node.js 22.19.0、Linux 和 Windows 未在本轮实机运行。抓取使用直连，不使用环境代理；页面需要 JavaScript、登录或仅提供二进制时不在本轮支持范围。新依赖从官方 registry 核验最低 Node 要求并固定为 undici 7.29.1、htmlparser2 12.0.0、ipaddr.js 2.5.0。

参考的是本地 Deepy `src/deepy/tools/runtime/web.py`、`web/fetch_html.py`、`web/search_parse.py`，及 dsh `packages/web/web-fetch-http`、`packages/web/tool-web/src/fetch.ts`。公开接口核对：[Undici Fetch](https://github.com/nodejs/undici/blob/main/docs/docs/api/Fetch.md)、[htmlparser2](https://github.com/fb55/htmlparser2)、[ipaddr.js](https://github.com/whitequark/ipaddr.js)。

## Review 修复与再次审查

同日补充修复：

- UTF-16LE/BE 响应在成功、HTTP 404、分块取消后均先解码脱敏再保存；bundle 中扫描全部 artifact 验证没有 UTF-8 或 UTF-16 编码的测试密钥。记录 `responseCharset` 与 `responseEncoding`，接收字节数不变；未知 charset 记录 `responseOmitted`，不落盘无法安全脱敏的字节。
- 行内代码单独缓冲，保留下划线、反斜杠与空格，按内容选择反引号分隔符；代码块同样避免正文中的反引号提前关闭围栏。测试通过项目实际 Markdown 渲染器比较代码内容。
- GFM 表格不再在相邻行之间插入空行，忽略结构缩进，单元格块元素换行展平，保留 caption 和代码中的竖线；测试检查实际 tbody 和单元格内容。
- 重新审查全部未提交代码及规划产物，复核网络地址固定、重定向状态、失败/取消证据、历史投影、资源交付和依赖边界，未发现新的高置信度可操作问题。

新增 13 项回归，完整单元/集成测试 141/141、浏览器测试 11/11、类型检查、构建、最终安装包验收与 OpenSpec 严格验证均通过。
