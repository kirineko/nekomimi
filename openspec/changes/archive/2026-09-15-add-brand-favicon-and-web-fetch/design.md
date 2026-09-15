## Context

动机见 proposal.md。现有 CoreTools 统一记录工具 intent，runtime 持久化工具结果；Journal artifact 支持内容寻址及 read 继续读取。Web 工具卡使用结构化 details，首页尚无 favicon，生产静态路由仅允许 /assets/*。

## Goals / Non-Goals

**Goals:** 在现有工具/Journal 边界内加入可验证的匿名抓取；沿用现有猫耳轮廓并确保生产资源交付。

**Non-Goals:** 见 proposal.md；不引入模型摘要、浏览器抓取或插件宿主，不改变现有历史协议。

## Decisions

1. favicon 使用 SVG 源资源并交由 Vite 生成 /assets/ 资源，页面 CatMark 复用同一 SVG。服务器补齐 SVG MIME，避免开放根目录任意资源或依赖开发服务器特性。
2. 抓取模块拆为网络传输、可读内容提取和工具证据封装。web_fetch 默认作为基础工具可用，独立于 search 设置；返回 content/details，复用 runtime 的工具结果持久化。HTTP 操作用 fetch.started/response/finished 事件记录，不调用 RecordedCall 生成虚假模型统计。
3. 采用公开 Undici Agent/fetch 接口实现每请求 DNS 地址固定和手动跳转；只接受经 ipaddr.js 分类的公开单播地址，IPv6 仅接受全球单播且拒绝转换/保留地址。DNS 等待与 AbortSignal 竞争，连接使用已校验地址。默认直连且不读取环境代理，避免代理远端 DNS 绕过校验；不修改进程全局 dispatcher。每跳重新解析校验，同源最多五跳，跨源作为带目标地址的明确错误。
4. Undici fetch 自动解压，限制解压后的流；字符编码使用 TextDecoder。只接受 HTML、text/*、JSON/XML 及其 +json/+xml 类型；缺少类型时仅在有限前缀明确为 HTML 时接受。HTTP 非 2xx 保存有界响应证据后报错。默认 30 秒、2 MiB、30,000 UTF-16 单位，读取到 EOF 才将恰好到上限判为完整。网络响应上限与输出上限分别记录。
5. 采用 htmlparser2 事件式解析而非 DOM 加递归转换，限制嵌套深度 256、标签数及输出字符数，分块让出事件循环以响应取消。保留块、列表、代码、简单表格结构与安全绝对链接；忽略脚本、样式、隐藏元素及嵌入对象。沿用 Deepy 的保守占位判断与 description 优先级，短正文不被摘要覆盖；回退标识 extraction=metadata，空内容标识 empty。不会解析 hydration JSON。行内代码缓冲后按内容选择分隔符，不使用正文转义；表格行连续输出，忽略表格结构标签之间的缩进空白，单元格内换行转为空格。
6. 响应文本（解压后按源 charset 解码、脱敏并统一保存为 UTF-8）及完整有界提取文本分别保存为 artifact，fetch.finished 包含两者引用、状态和截断字段。模型只接收带来源和不可信提醒的有界文本，附提取文本 artifact 供 read。对取消/失败使用同一响应脱敏路径，记录源 charset、保存编码和接收字节数；未知字符编码时仅保留响应元数据和省略原因，不落盘无法安全脱敏的字节，并记录失败原因；UI 从 Journal details 恢复，不从格式化文本反推元数据。页面不渲染抓取 HTML、不自动加载远程资源。
7. 依赖固定版本，在安装前核验公开包 metadata 与最低 Node 版本；通过确定性传输注入和本地 HTTP fixtures 验证，不用真实模型凭证作验收条件。注入接口只供程序化测试，无模型参数或 Web 设置能关闭网络校验。

## Risks / Trade-offs

- 动态页面可能仅有摘要 → 显式展示提取来源，保持无 JavaScript 边界。
- 同源重定向限制会拦截 http→https 或 www 跳转 → 返回目标供显式新调用。
- 直连在必须使用代理的网络可能失败 → 明确错误，首版不暗中绕过公开目标校验。
- 简单 Markdown 无法保留复杂表格布局 → 不展开 colspan/rowspan，不让数字属性造成输出膨胀。
- 页面可能含提示注入或敏感字串 → 外部内容标为不可信数据，证据沿用 Journal 脱敏，前端不执行 HTML。
- OS DNS 不能真正取消 → 取消后不等待或连接，监听清理且迟到结果不产生副作用。

## Migration Plan

新增工具及资源不要求历史迁移。旧会话缺少 fetch 元数据时仍使用通用卡片。通过类型检查、单元、浏览器、安装包和 OpenSpec 严格验证后完成任务；本次不归档、不提交、不发版。
