## ADDED Requirements

### Requirement: 静态页面内容安全策略
服务返回工作台页面时 SHALL 为每个 HTML 响应生成不可预测的 nonce，在 CSP 的 `style-src` 中仅允许 `'self'` 与该 nonce，并以页面可读的方式提供给前端，使界面库动态插入的样式元素可以带上该 nonce。`script-src` SHALL 保持 `'self'`；CSP MUST NOT 使用 `'unsafe-inline'` 或 `'unsafe-eval'`。语法高亮 worker 等同源脚本资源 SHALL 仍可加载。扩展面板 iframe 维持其独立 CSP 不变。

#### Scenario: 打开对话框无 CSP 违规
- **WHEN** 用户打开删除确认、调用证据或设置对话框
- **THEN** 浏览器控制台没有来自宿主资源的 CSP 违规报告，对话框打开时页面背景不可滚动。

#### Scenario: nonce 不复用
- **WHEN** 同一浏览器连续两次加载工作台页面
- **THEN** 两次响应的 nonce 不同，且 nonce 不出现在日志、Journal 或 API 响应中。

#### Scenario: 无 nonce 的内联样式被拒绝
- **WHEN** 页面中注入不带 nonce 的 `<style>` 元素
- **THEN** 浏览器按 CSP 拒绝应用，宿主不放宽策略。

### Requirement: 连接授权失效引导
前端在启动时或任一 API 返回连接授权失效（401 `auth`）时，SHALL 显示整页引导：说明需要从终端打开带一次性令牌的地址，提供“我已重新打开，重试”按钮，并隐藏依赖授权的局部错误。引导 MUST NOT 显示或要求用户粘贴令牌，MUST NOT 自动重发写命令；授权恢复后 SHALL 回到原路由。

#### Scenario: 直接访问地址栏
- **WHEN** 用户没有有效连接 cookie，直接打开 `http://127.0.0.1:<port>/work`
- **THEN** 页面显示“需要从终端打开 Nekomimi”引导与 `nekomimi web` 提示，不出现会话列表错误、主题读取失败等零散报错。

#### Scenario: 运行中授权失效
- **WHEN** 服务重启导致 cookie 失效，用户在已打开的页面提交任务
- **THEN** 提交返回授权失效，页面显示引导并保留草稿；重新授权后草稿仍在，需由用户再次发送。
