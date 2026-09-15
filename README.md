# Nekomimi

一只住在项目里的编程小助手。用 DeepSeek 阅读代码、修改文件、运行命令，在浏览器中查看回答、文件差异和执行过程。

## 安装

需要 **Node.js 24 或更新版本**（包含 npm）。可从 [Node.js 官网](https://nodejs.org/) 安装。

```sh
npm install -g nekomimi
```

## 开始使用

进入你想处理的项目目录，启动 Nekomimi：

```sh
cd /path/to/your-project
nekomimi web
```

打开终端显示的本地链接，在左侧 **设置** 中保存 DeepSeek API key：

1. 登录 [DeepSeek 开放平台](https://platform.deepseek.com/api_keys)，创建 API key。
2. 将密钥填入 Nekomimi 设置中的输入框，点击 **保存 API key**。
3. 回到会话，输入任务。例如：`阅读这个项目，介绍它的结构，先不要修改文件。`

无需克隆 Nekomimi 源码，也无需配置环境变量。当前版本使用 DeepSeek，Web 暂不提供模型或服务地址切换。

## 日常使用

- **发送任务**：Enter 发送，Shift+Enter 换行；中文输入法 Enter 选词不会发送。
- **继续对话**：在同一会话中发送后续要求。首轮完成后，会话会自动命名。
- **查看改动**：展开工具结果与文件 diff；执行追踪可查看调用详情。
- **停止任务**：点击“停止任务”。关闭浏览器不会自动取消任务。
- **删除会话**：侧栏“•••”中选择删除，再确认。只删除会话记录，保留项目文件。
- **导出**：可导出离线 HTML；分享前检查内容，并按需填写脱敏文本。

停止服务请回到终端按 Ctrl+C。下次在同一项目目录运行 `nekomimi web`，即可查看此前会话。服务重启后请使用终端新输出的链接。

## 项目与数据

**在哪个目录启动，就处理哪个项目。** 页面只显示当前工作区的会话，切换到另一个项目目录启动时，两边历史分别管理。

文件工具在当前项目范围内读写，命令的初始工作目录也是当前项目。Shell 使用你的系统权限执行，并不是系统沙箱；执行修改任务前，建议先提交或备份重要文件。

配置和会话保存在 `~/.nekomimi/`，按项目路径区分，不写入 Nekomimi 安装目录。API key 保存在本机配置文件中，设置不会回显已保存密钥；无需设置 `DEEPSEEK_API_KEY`。移动项目目录后，会被视为新的工作区。

## 更新与卸载

```sh
npm install -g nekomimi@latest
```

更新前先停止正在运行的服务。

```sh
npm uninstall -g nekomimi
```

卸载不会删除项目文件或 `~/.nekomimi/` 中的配置和历史。

## 常见问题

**找不到 nekomimi 命令？** 检查 `node --version` 和 `npm --version`，重新打开终端，并确认 npm 全局可执行目录已加入 PATH。安装权限问题可参考 [npm 官方说明](https://docs.npmjs.com/resolving-eacces-permissions-errors-when-installing-packages-globally/)。

**提示未配置或认证失败？** 在设置中保存或替换有效的 DeepSeek API key，并检查开放平台账户状态。

**无法打开页面或提示未授权？** 使用终端打印的完整链接。需要换端口时运行 `nekomimi web --port 3001`。

**提示工作区正在使用？** 同一工作区只运行一个服务或任务实例。停止旧实例后重试；异常退出后可能需要等待锁租约过期。

**支持哪些系统？** macOS 和 Linux 已通过发布 CI 验收。Windows 尚未完成完整验收。

## 开发与文档

开发说明、CLI 高级用法和验收记录见[开发指南](https://github.com/kirineko/nekomimi/blob/main/docs/development.md)与[文档索引](https://github.com/kirineko/nekomimi/blob/main/docs/README.md)。
