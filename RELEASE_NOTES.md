## CodePilot v0.67.15

> 加入 TokenDance：一次连接即可在受支持的 Runtime 中选择精选模型，并提供授权、模型发现和凭据恢复入口。

### 新增功能

- **TokenDance 接入** — 在设置的服务商页面添加 TokenDance，可通过浏览器授权、一次性授权码或手动 API Key 连接。
- **六款默认精选模型** — 默认启用 GLM 5.3、Kimi K3、MiniMax M3、DeepSeek V4 Flash、DeepSeek V4 Pro 与 GLM 5.3 Flash；模型刷新保留用户手动隐藏、启用和编辑的选择。
- **同一连接跨 Runtime 使用** — CodePilot 与 Codex 使用聊天协议，Claude Code 使用模型明确支持的 Messages 协议，无需重复授权。Kimi K3 当前仅在 CodePilot 与 Codex 中显示。
- **授权与额度恢复提示** — 区分余额不足、Key 不可用与周期额度限制，提供充值或重新授权的明确指引。

### 优化改进

- 服务商、模型页与聊天选择器统一使用 TokenDance 官方 Logo，并显示多协议能力和对应 Runtime 的模型筛选结果。
- 授权支持取消与超时，重新授权沿用原连接；Key 仅在服务端加密保存，不返回页面。

### 已知问题

- 真实 TokenDance 授权和本机模型目录已验证；上游生成、Claude CLI 多步工具调用、计费与打包后的授权流程仍待实机验证。
- Claude Code 的模型协议支持使用已核对的目录快照；未知模型不会自动宣称兼容。
- 此前版本保留的真实账号、运行期恢复与 Codex 长时间稳定性验证缺口仍在跟踪。
- Windows 安装包未配置 Authenticode 证书，请只从本 Release 下载并核对 SHA-256。

## 下载地址

> macOS v0.67.5 及更高正式版、Windows v0.67.10 及更高正式版可在应用内检查并升级。更早的 Windows 版本请手动安装 v0.67.15；Linux 继续手动下载安装。

### macOS

- [Apple Silicon (M1/M2/M3/M4)](https://github.com/op7418/CodePilot/releases/download/v0.67.15/CodePilot-0.67.15-arm64.dmg)
- [Intel](https://github.com/op7418/CodePilot/releases/download/v0.67.15/CodePilot-0.67.15-x64.dmg)

### Windows

- [Windows x64 安装包](https://github.com/op7418/CodePilot/releases/download/v0.67.15/CodePilot.Setup.0.67.15.exe)
- Windows 安装包未配置 Authenticode 证书，可能显示 SmartScreen。仅从本 Release 下载并核对 SHA-256；应用内也会在安装更新前再次明确提示未签名状态。

### Linux

- [x64 AppImage](https://github.com/op7418/CodePilot/releases/download/v0.67.15/CodePilot-0.67.15-x86_64.AppImage)
- [arm64 AppImage](https://github.com/op7418/CodePilot/releases/download/v0.67.15/CodePilot-0.67.15-arm64.AppImage)
- [amd64 DEB](https://github.com/op7418/CodePilot/releases/download/v0.67.15/CodePilot-0.67.15-amd64.deb)
- [arm64 DEB](https://github.com/op7418/CodePilot/releases/download/v0.67.15/CodePilot-0.67.15-arm64.deb)
- [x86_64 RPM](https://github.com/op7418/CodePilot/releases/download/v0.67.15/CodePilot-0.67.15-x86_64.rpm)
- [aarch64 RPM](https://github.com/op7418/CodePilot/releases/download/v0.67.15/CodePilot-0.67.15-aarch64.rpm)

### 完整性验证

- [SHA-256 Checksums](https://github.com/op7418/CodePilot/releases/download/v0.67.15/SHA256SUMS.txt)
- GitHub Release 页面可验证每个安装包的 build-provenance attestation；`latest-mac.yml`、`latest.yml` 与 blockmap 是自动更新器资产，不需要手工下载。

## 安装说明

**macOS**：下载 DMG → 拖入 Applications → 正常启动。若 Gatekeeper 报告开发者无法验证或文件损坏，请停止安装并反馈，不要绕过安全检查。

已安装的 macOS 正式版会通过同一 GitHub Release 的 `latest-mac.yml` 检查更新，并使用签名、公证后的 universal ZIP 完成应用内下载与重启安装。

**Windows**：v0.67.10 及更高版本会通过 `latest.yml` 优先差分下载未签名 NSIS，失败时回退完整安装包。更早版本需手动安装 v0.67.15。出现 SmartScreen 时请核对下载来源与 SHA-256；安装前仍会明确提示没有独立发布者签名。

**Linux**：继续手动下载新版安装包，不会静默运行包管理器或提权安装。

## 系统要求

- macOS 12.0+
- Windows 10/11 x64，或常见 x64/arm64 Linux 发行版
- 需要配置 API 服务商或受支持的套餐凭据
- 推荐安装 Claude Code CLI 或 Codex CLI 以获得完整功能
