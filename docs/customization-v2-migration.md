# 0.2.0 定制能力候选迁移说明

这是 V2 的候选说明，尚未正式发布。候选门槛和平台证据见 [验证记录](customization-v2-validation.md)。公开标签、Release 和 npm 上传遵循既有发版流程。

SDK 1 扩展、会话状态、Skills、目标 Rules、MCP 工具和临时表单保留。工厂与回调改在独立 Node 子进程；依赖未公开的宿主内存、私有对象或进程全局共享状态的代码不属于兼容接口。新代码使用 SDK 2 并显式声明能力；未知能力拒绝，不静默降级。

旧 DeepSeek settings/auth 无需迁移即可继续运行。需要模型 profiles 时，在 Web 点击“备份并迁移原 DeepSeek 配置”，或运行 providers migrate。迁移保留私有备份和原 settings/auth；失败时原配置仍可用。main、auxiliary、naming 分别选模型，内置搜索沿用独立设置。

能力包安装前检查来源、精确锁、文件与权限差异。Rule 重新绑定工作区，凭证引用需在接收机器重新配置；包导出不包含会话、OAuth tokens 或私有状态。代码回退保留历史及工作流状态，不自动把新 schema 降回旧 schema。

持久流程在等待时释放活动运行，重启后只恢复状态。unknown 必须人工核对后提交结果或明确授权新 attempt；不得用“恢复”掩盖重复副作用。升级不改写已挂起流程的定义 revision，撤权/卸载阻止新的宿主调用；显式迁移保存原状态证据。

面板只接收经校验的 props 和声明的桥接动作，不接收密钥或宿主认证 token。候选面板预览会执行可信 Node 工厂，须在管理入口显式授权；预览不切换活动注册，桥接动作禁用。插件删除后保留 fallback、结构化数据和 artifact 证据。离线导出/导入不执行包脚本。

回收只清理明确丢弃且未引用的候选缓存；安装历史、回退和工作流引用保留。不要手动删 `.nekomimi/package-content`、workflow-content 或活动指针，原始 Journal 与 artifacts 是恢复和审计依据。
