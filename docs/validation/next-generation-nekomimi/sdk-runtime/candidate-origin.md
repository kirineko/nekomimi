# 候选来源、目标与素材（7.3）

2026-10-07，macOS arm64 / Node.js 24.15.0，未提交工作树；精确文件 hash 见 candidate-origin-manifest.json。

## 实现与证据

- 创造运行创建项目候选时，将实际 SessionBinding 和 runId 写入 customization Journal 的 candidate.created，保留目标宿主 build、目录身份和项目应用范围。inspect/preview 从 Journal 只读重建来源；CLI 无会话来源时返回未绑定，不伪造创建者。
- prepare 在写入不可变内容前复核目标目录及宿主身份。测试实际创造运行生成候选，再模拟宿主 build 改变：准备应用被拒绝，候选 Journal 字节及活动指针不变，仍可只读检查旧来源。
- 能力包准备也接收真实创造来源并写入 package.candidate.created；来源保存在候选/安装元数据，应用前与 Journal 比对，项目目标及宿主重新检查。用户范围通过明确的 package scope 表达，不将项目候选误装到用户范围。
- 用户包首次安装及新增 state 权限都不能由模型自动授权；显式授权可安装原版本，未授权扩权保留旧活动版本。移除候选元数据中的来源后，即使请求授权也因 origin mismatch 拒绝。
- 内容及依赖锁变化重新生成摘要，旧 contentHash 不能复用。能力包文件/依赖完整性及授权回归继续通过。
- 二进制素材回归覆盖 WOFF/PNG 原字节、不可变准备、导出解包、主题数据、激活/上一版本及篡改拒绝；受支持旧文本摘要不静默重算。

## 验证

candidate-origin-first.log：初次项目来源与素材等 9 项通过。
candidate-origin-regression.log：首次完整回归 29 通过、1 失败。新用户包测试夹具未初始化新版 home，旧格式保护正确拒绝；仅补齐夹具 prepareDataHome，未放宽生产门禁。
candidate-origin-final.log：最终 6 文件 30 项全部通过。
candidate-origin-types.log / candidate-origin-build.log：类型检查和构建退出码 0。
candidate-origin-specs.log：严格规格 43 项通过；git diff --check 通过。

本报告不代替 7.4 的验证结果模型、7.5 的运行边界切换及 7.6 的交付卡投影，也不宣称完成浏览器字体渲染或安装包验收。
