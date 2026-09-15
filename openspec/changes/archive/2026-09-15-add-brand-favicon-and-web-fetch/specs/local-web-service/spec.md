## MODIFIED Requirements

### Requirement: 跨平台静态资源边界
服务 SHALL 在 Windows 与 POSIX 平台正确加载安装目录中的首页、JS/CSS 及品牌 SVG 图标，以正确内容类型返回；目录包含空格或中文时仍可用；路径判断 SHALL 使用平台路径语义和真实路径，拒绝静态目录外资源，保留既有连接授权。

#### Scenario: Windows 首页加载
- **WHEN** Windows 用户从项目目录执行 nekomimi web 并打开终端链接
- **THEN** 首页及资源正常返回，不因路径分隔符产生“资源路径无效”，页面显示正确的工作区名称。

#### Scenario: 越界资源拒绝
- **WHEN** 请求试图通过父目录、兄弟目录前缀、跨盘路径或指向目录外的符号链接读取文件
- **THEN** 服务不返回目录外内容，合法目录内资源不受影响。

#### Scenario: 图标交付
- **WHEN** 浏览器请求安装包首页声明的 SVG 图标
- **THEN** 返回包内图标和 image/svg+xml 内容类型，不依赖源代码目录或外部图标服务。
