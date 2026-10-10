# 6.2 部分实现：连接策略与有界等待

McpConfig 新增 exposure（省略为 direct），未知值在建立连接前拒绝。direct 在宿主激活时等待；deferred/codemode 后台连接并捕获失败；hidden 不启动。只有 direct 工具进入当前原生工具声明。连接公开 idle/connecting/ready/failed/closed 状态与策略。

McpConnection.ready 以单一连接 Promise 提供默认 5 秒、上限 10 秒的显式等待预算，取消只终止当前等待，不生成另一 owner。关闭期间迟到的初始化不能覆盖为 ready。mcp_content 显式访问会等待就绪并再次检查资源授权，hidden 不能通过该入口读取。

验证：真实本地 HTTP 初始化永久不返回时，deferred/codemode/hidden 的普通模型首轮仍完成；hidden 初始化次数为零。显式等待超时、取消后仍只有一个初始化 owner。15 项相关测试通过；增加等待后授权检查后，其中 9 项回归通过；最终类型、构建、43 项严格规格及 diff 检查通过。

6.2 **尚未完成**：deferred/codemode 的工具发现和调用入口、稳定身份消歧及其权限/故障集成测试仍待接入。当前只完成连接基础，不将非直接工具宣称为已可调用。工具版本与请求声明快照在 6.3 继续实现，当前任务保持未勾选。
