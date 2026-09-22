# Nekomimi 定制开发

SDK 2 新能力、Provider、能力包、MCP OAuth、持久工作流与面板见 [v2.md](v2.md)。V2 仍在实施验收中；以下为兼容保留的 SDK 1 基础。

先通过 resource_read 读取本文件和 example.ts。无需修改安装目录；在工作区 .nekomimi/extensions/<name>/ 创建 extension.json 与 index.ts，运行 customization_validate，用户启用后请求 customization_reload。重载返回 pending 时当前任务继续结束，下一次运行才能使用新版本；不要在当前工具中等待自己结束。

清单：`{"name":"review","sdkVersion":1,"entry":"index.ts","requiredCapabilities":["commands","tools","state","ui","model"]}`。

用户在 Web「定制能力」信任并启用项目扩展。授权覆盖这个资源后，普通修改不重复确认；可停用并撤销。可信扩展具有 Node.js 权限，不是沙箱。通过 ctx.callTool/model/state/ui 的操作被宿主记录；自行运行 Node 网络/文件操作不保证有证据。

工厂只注册工具、命令、钩子及清理；勿在模块顶层或工厂启动后台资源。可注册 beforeRun/beforeTool/afterTool/afterRun，前置钩子可返回 {block:"原因"}，后置观察不能修改原始结果。onDispose 必须幂等且及时完成。长期后台工作不适合 V1。

工具名与命令名仅使用小写字母、数字、下划线、连字符，不能占用 read/write/edit/bash/powershell/web_search/reload/skill。模型工具名形如 ext_review_check；命令完整名 /review:inspect，无歧义时可用 /inspect。

工具 execute(args, ctx) 返回 {content:[{type:"text",text:"..."}],details:{...}}；图片 content 可用 {type:"image",data:"base64",mimeType:"image/png"}。不支持 schema 时应减少复杂约束或明确拒绝，不隐藏改变语义。

ctx.workspace、signal、resourceId 是只读运行属性。ctx.callTool(name,args) 调用当前启用工具；ctx.model(prompt) 使用选定的辅助模型 profile（未选则沿用默认配置）和独立上下文。ctx.state.get(key,version)/set(key,version,value) 持久保存 JSON；schema 版本不匹配报错，不自动清空。ctx.contribute(text) 增加带来源指令；ctx.followUp(prompt) 排队同一运行中的后续提示，继承取消和预算。ctx.reload() 只请求运行后的重载。

ctx.ui({kind:"status"|"card",title,text}) 显示安全文本；ctx.ui({kind:"form",title,fields:[{name,label,required,options}]}) 等待 JSON 回答。headless 表单返回 interaction_unavailable，浏览器断线不自动选择默认值，五分钟超时或取消结束等待。不要将密钥作为表单字段，凭证在服务端环境变量配置。

默认边界：最多 256 个资源或单 MCP 的工具，单资源文件 1 MiB、扩展包 8 MiB、工具证据 4 MiB，模型展示约 24000 字符；每运行最多 128 次宿主扩展操作。达到限制会明确报告，不保证任意扩展代码内存有界。

新增注册使用 SDK 2；V1 工厂不能调用 registerProvider/registerWorkflow/registerPanel。当前支持能力以 customization_sdk 返回目录为准。

开发入口：`resource_list` 返回当前资源 ID、来源和状态，`resource_read({id,file?})` 读取资料或已启用资源。项目文件用普通 read/write/edit；用户级资源先在 Web 授权“允许写用户资源”，再用 resource_write 的 previousHash 校验避免覆盖并发修改。这个授权不允许任意 home 路径。

CLI：`nekomimi extensions list --workspace .` 获取 ID；`extensions validate <id>` 检查清单、依赖及完整 TypeScript 语义，不执行工厂；`extensions enable <id>` 授权后，`extensions trial <id> <command>` 在独立宿主中试运行，以模拟工具/模型/表单记录流程。试运行不启动 MCP，但可信代码直接使用 Node 的操作仍可能有副作用。`extensions reload` 校验一次本地加载；已打开的 Web 服务使用页面重载按钮。

示例 example.ts 的 shell 命令用于 Unix/git 工作区；Windows 扩展应调用 powershell 或使用跨平台 read/edit/write 工具。内置 shell 的规则范围为工作区 cwd；V1 不解析脚本内容推断任意外部目标路径。
