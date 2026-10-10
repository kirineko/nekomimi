# Durable Journal适配：当前apply验证

## 范围

任务1.4已进入apply，尚未完成七项准入。固定公开发布包pi-durable 1.0.4；macOS arm64、Node22.19.0/24.15.0。不是生产运行切换，不代表Linux/Windows或真实模型通过。

`journal-storage.mjs`使用公开MemoryStorage.prepareCommit预校验/分离写入，把每批writes存为产品Journal的一个durable.commit，可靠水位完成后才apply读取投影。没有原生Durable持久store或第二个权威快照。Journal仍提供hash链、租约和持久化水位。框架seq与Journalseq显式关联；夹具在中间插入context/unknown证据，断言两者并不相等。

## 实测

两种Node各5项综合断言通过，见`journal-node22/results.json`、`journal-node24/results.json`及`journal-runs.json`。

- 工具完成一次本地可计数副作用、结果提交前SIGKILL。丢弃内存、只从Journal重开，模型0次、工具总计1次，已有task/entries/documents由整批写入重建，仅一个journal.jsonl。
- 保存独立tool.unknown事实，先通过公开abortTask标记所有旧任务，再允许调度收敛；旧工具不重跑，旧模型不继续。显式新command只产生1次新模型调用，unknown证据仍存在。
- GenerationHooks.beforeRequest使用固定产品消息；Faux Provider断言实际接收相同消息，快照在同一Journal先持久化。这只证明Provider输入，不证明最终网络body。
- Journal append前注入ENOSPC，失败后poison，不派发模型；重开条目不变。
- Journal sync前及watermark.rename前分别注入ENOSPC，未可靠批次不发布；重开隔离未确认尾部，可靠条目不变。

`Conversation.abort/submit`、各种wait接口会启用scheduler；因此不能先调用这些接口再核对旧任务。测试先inspect，只读识别unknown并持久记录，逐项abortTask，再waitForIdle，最后接受独立新请求。这里只验证一组generation/tool树，不能外推全部自定义/background任务。

## D2七项准入状态（早期记录，当前补充见文末）

| 条件 | 当前证据 | 剩余工作 |
| --- | --- | --- |
| 单一权威提交及水位 | 整批writes预校验、Journal可靠提交后apply、seq映射 | UI提交观察、并发订阅、投影发布失败及完整文档/分支查询矩阵 |
| 逐网络attempt | 显式关闭框架重试；Faux输入可断言 | 真实loopback transport的逐attempt bytes/hash、限流/隐藏重试 |
| 固定产品上下文 | 公开GenerationHooks替换消息，Provider端断言 | 完整schema/profile、最终body与来源转换对照 |
| 原始流及背压 | 未证明；Faux不是原始网络流 | 受记录Provider桥、慢存储、取消中分块、不完整响应 |
| kill/unknown/取消/磁盘 | SIGKILL、旧任务门禁、append/sync/水位rename注入 | 工具intent失败、取消迟到、部分物理写及其他提交阶段 |
| 公开入口及不重放 | 发布MemoryStorage/Harness/GenerationHooks，工具replay=never；旧任务取消后恢复不重跑 | 注册桥覆盖所有工具/后台任务及安装包资产 |
| 唯一历史重建 | 仅Journal，整批重放恢复内存 | 凭证拒绝/损坏/旧格式、完整document/branch conformance |

1.4保持未勾选，当前总进度仍为7/87；不因这5项退出0宣称全部准入通过。

## 复现

在任务1.2独立消费项目复制本目录两个journal-*.mjs文件，先在产品仓库构建当前Journal，再运行：

```sh
node journal-storage-probe.mjs run /absolute/path/to/new-output file:///absolute/nekomimi/dist/journal.js
```

分别以两种Node执行，输出目录必须不存在。脚本只SIGKILL自己启动且达到IPC屏障的夹具子进程，重开前等待夹具租约过期，不删除锁、不接触用户会话。测试凭证为空；Faux模型无网络。锁等待设置只用于新建夹具目录，不改变生产默认租约。

首次探针把同步poison拒绝传入assert.rejects而未包装，随后更正为async回调；2.2秒等待租约受mtime精度影响，调整到4秒。没有修改产品Journal或上游行为以掩盖测试失败。

## 源码 apply（2026-10-07）

实际代码已落地 `src/pi/journal-storage.ts` 和 `src/pi/recovery.ts`，固定新增 Durable/Chord 1.0.4 依赖，生产 Agent/AI 旧入口尚未切换。Storage实现版本标记和写入前旧格式拒绝、原子批次到Journal、可靠水位后读取投影、输入分离、单写租约、失败poison及关闭排空。恢复实现只读inspect、unknown持久记录、先撤回旧队列/取消旧任务后启用调度；未验证自定义任务恢复在调度前拒绝。

19项源码单元测试已通过。`journal-production-probe.mjs`改为加载实际编译模块，Node22.19.0/24.15.0各5项综合验证通过；它在真实Harness的在途工具中先排入旧输入再SIGKILL，验证恢复不会执行该排队输入。证据见`production-node22/`、`production-node24/`、`production-runs.json`。

类型检查及OpenSpec43项严格校验通过。沙箱中旧本地服务测试因listen EPERM失败；已单独复现限制，在允许本地监听的环境全量339/341通过，两个既有Git历史/定制闭环用例30秒超时，保持原断言/超时以2 workers复跑后341/341通过。保留默认并发失败日志，不将其记为通过。

源码验证不等于1.4七项全部准入；实际网络attempt、原始流背压、完整故障和宿主/UI发布链仍需后续验证。CLI/Web目前继续使用既有入口，此阶段没有加载旧会话到新Durable store。

源码apply验收日志：`source-typecheck.log`、`source-tests-default.log`、`source-tests-workers2.log`、`source-pack.log`、`source-spec-validation.log`。构建及完整安装包闭环通过；从安装包加载新模块的Node22.19.0崩溃/恢复/故障5项综合断言通过（`packed-node22/results.json`），新模块没有源码checkout或reference运行依赖。当前完成1.4.1/1.4.2，整体9/89；父任务1.4仍未完成。Linux/Windows未验证，不推断通过。

## 传输、背压及工具意图故障补充（2026-10-07）

新增真实本地HTTP transport、源码模型服务、背压与意图故障夹具。实际代码 `src/pi/model-service.ts` 冻结请求输入，每个attempt使用同一个RecordedCall入口；未知传输失败不自动重试。`src/pi/task-context.ts`通过公开withAbortSignal组合Journal.failure和调用方取消，让失败等待及时退出。完整证据索引和源码hash见`admission-manifest.json`。

| D2门槛 | 新增实际证据 |
| --- | --- |
| 单权威提交和观察水位 | Storage预校验、Journal水位后apply；真实Harness subscribeCommits逐次对照frameworkSeq和journalSeq；network两种Node各6次可靠发布，两种Node工具意图故障均无越水位发布 |
| 每个网络attempt | 实际loopback首次429后200，服务记录两个独立attempt同一call，框架调用1次；服务回归未知连接失败不自动重试 |
| 固定上下文 | 公开GenerationHooks固定快照；服务器收到最终body逐字节/hash对照可靠request artifact，框架seed已替换 |
| 原始流和背压 | HTTP分块完整原始响应重建；慢artifact写入阻止下一次读取；不完整decoder拒绝成功，分块凭证脱敏与超限保留失败事实 |
| kill/unknown/取消/I/O | 两种Node真实SIGKILL副作用1次/恢复0次；append/sync/watermark.write/rename在原生工具execute意图提交处失败均0副作用；迟到响应和完成提交期间取消不返回结果；部分未确认JSONL尾部被隔离 |
| 公开安装和不重放 | 官方独立安装及最低Node tarball模块验收；恢复先inspect/撤旧队列/abortTask再开启scheduler，未知及旧输入不重跑，未验证custom任务拒绝 |
| 唯一历史重建 | 丢弃MemoryStorage后任务、条目和文档从一个Journal恢复；新增历史分支snapshot独立重建，租约/凭证/旧格式/缺失附件已有单元检查 |

源码定向28/28，模型/runtime/provider回归45/45，类型和构建通过。模型回归初次沙箱因listen EPERM失败，允许本地监听复跑通过。意图故障最初发现原生task.wait不随Journal poison退出，进程以未完成top-level await退出13；现绑定失败Context，Node22.19.0/24.15.0各四项通过。没有延长断言超时或重跑工具。最低Node复验已通过，父任务1.4的七项有界准入切片完成；本轮全量回归57文件350/350通过，严格规格43/43通过，不替代第2组迁移或第11组整体验收。

剩余第2组覆盖生产协议、DeepSeek原始items与SDK迁移、真实业务上下文和UI服务桥。此处的HTTP协议是本地夹具，不是DeepSeek兼容性或模型质量验收；磁盘故障为可控I/O注入，不宣称真实断电或硬件满盘测量。
