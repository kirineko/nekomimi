# 5.6 部分实现：类型化操作记录入口

`src/pi/typed-model.ts` 使用锁定版本 Pi 的公开 `typesafe-system-one` / `openrouter-images` API。调用捕获模型、输入和允许路径；实际序列化字节通过 RecordedCall，禁用隐式重试、跨 provider 回退及 HTTP 重定向。原始响应先完整记录，再交给公开适配器解码。

分类结果保留 choice/score/bool 类型，错误 stopReason 和无效概率不返回合法答案。图片结果保存文字/图片的完整结果引用及单独附件字节引用。用量只采纳原始响应实际报告的 token 字段，缺失值及未核实价格为 null；不将 Pi 合成的零费用发布为有效费用。调用保留父工具链接，结果不写入主会话 context.add。

完成结果的持久提交后仍检查取消。取消期间已有的附件和用量保留，抛出带证据引用的错误，不返回成功值。

验证：typed-model 7 项、durable-model-service 9 项、model-routing 4 项，共 20 项通过；类型检查、构建、43 项严格规格及 diff 空白检查通过。全部使用本地 transport fixture，没有真实模型调用。图片字节 fixture 仅验证持久引用一致性，不代表真实图片质量验收。

5.6 **尚未完成**：本入口尚未接入 Provider 用途选择、资源授权及重新校验、普通工具和 Codemode；模型目录继续报告分类/图片未接入。接下来完成这些入口、集成取消/预算与父子用量去重。5.8 综合部分失败门槛也仍未执行。
