## Why
当前先稳定 macOS/Linux，Windows 的原生检查和平台优化延后，避免其作为本阶段发布门禁。对应 spec.md 的平台交付及发布范围。

## What Changes
- 移除 Windows 原生安装 CI job，保留 Linux/macOS × Node 22.19.0/24.15.0 四组矩阵。
- 更新维护手册、README 和代理发布指引，明确 Windows 暂不执行检查。
- 保留平台实现及测试文件，不宣称新的 Windows 验收结果。

## Capabilities
### Modified Capabilities
- `npm-release-delivery`: 调整当前发布验证平台范围。

## Impact
仅发布工作流和说明；不改变 npm 上传触发条件、凭证方式或包运行逻辑。
