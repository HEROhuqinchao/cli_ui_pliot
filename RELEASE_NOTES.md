## CodePilot v0.67.11

> 让 Claude Code 与 Codex CLI 保持在兼容版本，并把任务完成、审批请求等重要提醒可靠送到系统通知。

### 新增功能

- **Claude Code / Codex CLI 更新提醒** — CodePilot 会识别当前实际使用的 CLI、安装版本与可信安装渠道；发现同渠道新版本后，会在工作区左下角持续显示更新卡片，直到你更新或手动关闭。
- **一键更新 CLI** — 支持的 npm、Homebrew、WinGet 与独立安装渠道可直接在卡片或设置中更新。更新期间会显示进度状态，完成后重新发现 CLI 并核对实际版本；渠道归属不明确时只给出人工检查提示，不会猜测并改写其他安装。
- **重要事件系统通知** — 任务完成和需要审批权限时会发送操作系统通知；应用在后台或最小化时也能收到，点击通知会返回对应对话。普通产品通知也统一走系统通知，不再堆在应用右下角。

### 修复问题

- 修复应用更新弹窗把 GitHub Release Notes 的 HTML 标签直接显示为源码的问题。标题、列表、表格和安全链接现在会正常排版，同时继续移除脚本、样式、远程图片与危险链接。
- 修复停止 Codex 任务后仍可能误发“任务完成”系统通知的问题；只有真实完成的交互任务才会触发完成提醒。
- 修复 CLI 更新与新会话、应用退出、CodePilot 自身更新相互竞争时可能造成更新失败的问题。更新执行期间会阻止同一 Runtime 启动，并在退出或应用安装更新前明确等待或取消。
- 修复开发测试数据可能混入日常会话列表的问题，端到端测试现在使用独立数据库与会话环境。

### 优化改进

- CLI 更新卡片改为紧凑布局，区分 Claude Code 与 Codex 图标；更新按钮与说明文案对齐，关闭按钮具有清晰的悬停反馈，失败后可只重试尚未完成的项目。
- 错误遥测进一步收敛为低敏、低基数信号，改善媒体失败、Runtime 子进程异常与模糊中断的归因，同时避免上传原始响应或本地路径。
- Token 用量在来源不完整时不再显示容易误解的占位数字，只展示能够由 Runtime 真实证明的字段。

### 已知问题

- 极慢或长时间排队的第三方渠道在首个模型输出前仍保留 10 分钟安全上限；6–9 分钟真实慢代理 smoke 尚未完成。若当前版本仍自动中断，请附上服务商、模型与大致等待时长反馈。
- Windows 安装包仍未配置 Authenticode 证书，且曾有一台 Windows 11 25H2 机器报告旧版安装器启动失败；当前安装包尚未在同一环境复验。请只从本 Release 下载并核对 SHA-256，异常时附事件查看器信息反馈。
- 旧版本曾有“出现新版提示后会持续高 CPU”的报告，当前版本尚未在原报告环境完成复验。如再次出现，请附操作系统、CPU 采样以及切换到设置页后的变化。

## 下载地址

> macOS v0.67.5 及更高正式版、Windows v0.67.10 及更高正式版可在应用内检查并升级。更早的 Windows 版本请手动安装 v0.67.11；Linux 继续手动下载安装。

### macOS

- [Apple Silicon (M1/M2/M3/M4)](https://github.com/op7418/CodePilot/releases/download/v0.67.11/CodePilot-0.67.11-arm64.dmg)
- [Intel](https://github.com/op7418/CodePilot/releases/download/v0.67.11/CodePilot-0.67.11-x64.dmg)

### Windows

- [Windows x64 安装包](https://github.com/op7418/CodePilot/releases/download/v0.67.11/CodePilot.Setup.0.67.11.exe)
- Windows 安装包未配置 Authenticode 证书，可能显示 SmartScreen。仅从本 Release 下载并核对 SHA-256；应用内也会在安装更新前再次明确提示未签名状态。

### Linux

- [x64 AppImage](https://github.com/op7418/CodePilot/releases/download/v0.67.11/CodePilot-0.67.11-x86_64.AppImage)
- [arm64 AppImage](https://github.com/op7418/CodePilot/releases/download/v0.67.11/CodePilot-0.67.11-arm64.AppImage)
- [amd64 DEB](https://github.com/op7418/CodePilot/releases/download/v0.67.11/CodePilot-0.67.11-amd64.deb)
- [arm64 DEB](https://github.com/op7418/CodePilot/releases/download/v0.67.11/CodePilot-0.67.11-arm64.deb)
- [x86_64 RPM](https://github.com/op7418/CodePilot/releases/download/v0.67.11/CodePilot-0.67.11-x86_64.rpm)
- [aarch64 RPM](https://github.com/op7418/CodePilot/releases/download/v0.67.11/CodePilot-0.67.11-aarch64.rpm)

### 完整性验证

- [SHA-256 Checksums](https://github.com/op7418/CodePilot/releases/download/v0.67.11/SHA256SUMS.txt)
- GitHub Release 页面可验证每个安装包的 build-provenance attestation；`latest-mac.yml`、`latest.yml` 与 blockmap 是自动更新器资产，不需要手工下载。

## 安装说明

**macOS**：下载 DMG → 拖入 Applications → 正常启动。若 Gatekeeper 报告开发者无法验证或文件损坏，请停止安装并反馈，不要绕过安全检查。

已安装的 macOS 正式版会通过同一 GitHub Release 的 `latest-mac.yml` 检查更新，并使用签名、公证后的 universal ZIP 完成应用内下载与重启安装。

**Windows**：v0.67.10 及更高版本会通过 `latest.yml` 优先差分下载未签名 NSIS，失败时回退完整安装包。更早版本需手动安装 v0.67.11。出现 SmartScreen 时请核对下载来源与 SHA-256；安装前仍会明确提示没有独立发布者签名。

**Linux**：继续手动下载新版安装包，不会静默运行包管理器或提权安装。

## 系统要求

- macOS 12.0+
- Windows 10/11 x64，或常见 x64/arm64 Linux 发行版
- 需要配置 API 服务商或受支持的套餐凭据
- 推荐安装 Claude Code CLI 或 Codex CLI 以获得完整功能
