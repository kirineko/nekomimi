# Codemode 管线、并发与小状态（任务 5.2–5.4）

正式 runtime 在有效工具初始化时加入 codemode；调用者的 tools 限制继续过滤它及子工具。脚本开始固定工具目录，ALL_TOOLS 描述中提供真实输入 schema。宿主分配子 ID 和 parentToolCallId，调用 prepareToolCall 的同一准入／意图／执行／结果管线，未绕过权限、schema、当前资源或工作模式检查；不暴露另一个 codemode 入口。空代码查询固定限额。

每脚本最多 128 个子调用，同一运行的脚本共享四个执行槽，每个资源两个槽，等待队列响应取消。核心文件写队列在入队前固定已读 hash，后续并行写入不能继承前一个刚写出的版本；正常重读后写入继续有效。扩展/MCP 使用异步作用域保留子调用的独立取消信号。脚本结束取消未等待调用，最多等待一秒收敛；仍有意图但未确认终态的调用记录 unknown，未派发的调用不会伪装为已执行。迟到完成事实可以补充原 unknown，不重跑。

完整脚本输出存为工具形状的 JSON 附件，图片还保存独立字节附件。模型投影受既有文本/图片策略约束，大图保留附件读取入口，不以临时文件作为证据。小状态在成功 codemode.finished 事件中引用完整状态附件，失败或取消不提交；队列内比较原状态版本，冲突拒绝而不静默合并。分支复制确认状态快照并保留 sourceEvents，既不重跑脚本也不串会话。

## 验证过程

- pipeline-first：12 项中 11 项通过；缺失成员访问由 QuickJS 工具代理主动抛错，测试的 typeof 查询并非安全的成员存在性判断。改用 ALL_TOOLS 检查递归入口不存在。
- pipeline-types：首轮两处适配类型错误，改为产品 unknown 参数显式读取，并去掉重复的非必要 inputSchema 传值；schema 已在目录描述中提供，执行仍由原产品 schema 校验。
- pipeline-fixed：6 文件 48 项通过；pipeline-types-fixed、pipeline-build 通过。
- concurrency-first：5 文件 32 项通过；concurrency-process：补充真实扩展进程未等待调用与 128 调用预算，2 文件 16 项通过。类型检查通过。
- state-first：17 项中 15 项通过。图片夹具 AQID 不具备 PNG 文件头，被公开 image helper 正确拒绝；改用既有有效 PNG。128 次串行 fsync 在并发测试时超过夹具 15 秒限制；改为并行排队、仍精确断言 128 个效果和第 129 个预算拒绝，没有提高限额或删除断言。
- state-types-first：状态附件变量缺少类型标注，补上 Artifact。
- state-fixed：4 文件 17 项通过，包括重开/独立分支、失败/取消不提交、长文本/图片持久证据、并发和实际 runtime 入口；state-types-fixed 通过。

最终综合回归 `final-tests.log`：13 文件 130 项通过，104.62 秒。`final-types.log` 暴露新并发状态测试的返回类型推断问题；给 readScriptState 明确 Record 返回类型后，`final-types-fixed.log`、`final-build-fixed.log` 通过。随后补齐 MCP 结构化错误可处理语义：统一管线保留失败事实，脚本可读取 isError；`structured-error-tests.log` 三文件 15 项通过（其中 1 项新增，共 131 项不同相关测试），`structured-error-types.log` 通过。使用合成 Provider，本地真实扩展子进程和文件效果，不调用真实外部模型。
