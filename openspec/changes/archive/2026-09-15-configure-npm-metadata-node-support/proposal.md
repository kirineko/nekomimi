## Why

npm 页面缺少关键词，且 Node.js >=24 的声明排除了依赖支持的 Node.js 22 用户。对应 spec.md 的技术栈及交付要求，需要用实际安装测试确定最低版本。

## What Changes

- 配置描述实际产品能力的 npm keywords。
- 验证并将 Node.js 下限降至 22.19.0，同步 README、锁文件和 CI。
- 记录 Node.js 20 与 22.12 低于固定 pi 依赖声明的限制。
- 不更换依赖、不发布新版本、不修改模型调用与 Journal。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `npm-release-delivery`: 增加关键词及最低运行时安装验证契约。

## Impact

package.json、package-lock.json、README、CI 和验收文档；不改变凭证、会话或工具行为。
