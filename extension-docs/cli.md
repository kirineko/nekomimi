# 离线安装包开发

以下流程只需已经安装的 Nekomimi 和支持的 Node.js，不需要源码 checkout、网络或真实模型凭证。先建立一个独立开发目录，用 `--workspace` 指向它，`--home` 指向选定的新格式数据目录。所有命令均使用同一安装版；启动中的 Web 宿主身份与另一个 CLI 不一定相同。

## 读取当前契约

```sh
nekomimi candidates sdk --workspace ./development --home ./data
nekomimi candidates sdk public --workspace ./development --home ./data
nekomimi candidates sdk guide:README.md --workspace ./development --home ./data
nekomimi candidates sdk guide:cli.md --workspace ./development --home ./data
```

输出为 JSON。目录的 `host` 包含 build、contract、entry 和执行命令；指南含 `text`、`hash` 和 `source`。相对链接可通过 `guide:<相对路径>` 读取。不要依据 npm 版本字符串判断内容完全一致。创造会话通过 `customization_sdk` 复核已绑定目标，目标构建改变时需明确建立匹配的新目标会话。

## 命令候选

```sh
nekomimi candidates create review command --workspace ./development --home ./data
nekomimi candidates inspect <id> --workspace ./development --home ./data
nekomimi candidates trial <id> <contentHash> /review --workspace ./development --home ./data
nekomimi candidates activate <id> <contentHash> --workspace ./development --home ./data
```

create 返回候选 `id` 和可编辑 `path`；inspect 返回类型诊断和 `contentHash`。默认命令模板返回参数或 Ready，无需模型。trial 使用独立模拟宿主，不会应用候选。activate 是用户显式授权并应用该 hash 的管理动作；编辑后必须重新 inspect，失败保留原活动版本。命令模板可替换为随包 `guide:example.ts`，同时按实际调用声明权限；该完整示例会调用 git 和辅助模型，不属于离线无凭证验收。

CLI 管理命令是手工操作入口，不虚构创造会话或交接来源。正常产品流程在创造会话开发和授权，再显式交付工作会话；CLI 在开发目录激活不表示原项目已收到能力。`nekomimi run` 新会话默认工作模式，不能通过提示词改变模式；resume 沿用已保存身份。

## Skill

读取 `guide:examples/review-checklist/SKILL.md`，把返回的原始 `text` 保存到开发目录 `.agents/skills/review-checklist/SKILL.md`。使用 `extensions list` 查找 kind 为 skill 的实际 ID；必要时 `extensions enable <id>` 明确启用。`/skill:review-checklist` 显式加载正文，平常只有元数据进入目录。停用后不再贡献提示。

用户级路径以 SDK 返回的 scopes 为准；不要把开发目录中的 Skill 描述为已安装到所有项目。创造会话内优先使用 `resource_write`，并带 `previousHash`；文件并发变化后重新读取。

## 主题

```sh
nekomimi candidates create studio theme --workspace ./development --home ./data
nekomimi candidates inspect <id> --workspace ./development --home ./data
nekomimi candidates activate <id> <contentHash> --workspace ./development --home ./data
```

内置模板使用系统字体，无外网依赖。完整字体、背景、气泡和动效示例见 `guide:examples/sakura/README.md`；安装包自带素材。加载后仍需在目标 Web 宿主的外观入口预览并选择主题，CLI 激活不代表主题已应用，更不代表浏览器视觉验收通过。主题选择、资源授权和项目/用户范围分别管理。

## 核心源码路径

源码准备使用 `nekomimi core preview|prepare|inspect|list`，参数和基线规则见 [核心源码候选](core-source.md)。核心会话只能选择已经登记的独立源码副本。

公开扩展不能修改的核心行为需要独立核心候选：匹配版本的完整源码、依赖锁、明确构建入口、可信构建授权及受管切换。上述 CLI candidate 创建的是扩展，安装包中的 dist、类型和示例不能冒充源码基线。缺少前提时明确报告，不能修改当前安装目录。历史记录和导入也不会触发构建或切换。
