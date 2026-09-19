## CodePilot v0.67.16

> 新增 Gemini AI Studio 的 Native 接入，修复部分模型续聊时的路由不匹配，并改进消息保存失败提示。

### 新增功能

- **Gemini AI Studio** — 在官方 API 服务中添加 AI Studio API Key，即可在 Native（CodePilot）中选择 Gemini 3.8 Flash；本次不开放到 Claude Code 或 Codex。
- **Gemini 思考深度** — 支持低、中、高三档思考深度，默认中档；支持工具调用历史的保存与同模型续聊。

### 修复问题

- 修复部分第三方模型首轮回复后，续聊出现模型路由不匹配的问题；覆盖 Windows 用户反馈的同类场景。
- 修复 Native 长对话压缩后重复带入旧消息，以及摘要可能产生连续用户消息的问题，保留原有图片附件。
- 回复达到输出长度上限时保留已生成正文并显示提示，避免误认为回答已经完整结束。
- 消息未确认保存时提供明确提示，保留当前正文，避免重试或后台刷新覆盖尚未保存的内容。
- 保存完成后的后台处理不再延迟前台回复结束；快捷建议失败后短暂退避，减少重复请求。

### 优化改进

- TokenDance 添加卡片移到授权登录区域，方便找到浏览器授权入口。
- 改进 Gemini 连接检查和模型发现，支持分页读取并过滤不支持文本生成的模型。

### 已知问题

- Gemini 已通过本地协议、历史持久化及界面回归；真实 AI Studio 账号下的写作、工具调用、压缩后续聊与签名校验仍待实测。
- Windows 正式安装包上的多模型连续对话及重开会话仍待真机验证；本次不宣称所有 Windows 模型问题均已解决。
- 少量旧会话若无法唯一匹配原模型，升级后仍需手动重选一次模型。
- 最初的数据库异常、Windows 服务退出原因，以及此前版本记录的真实账号、运行期恢复和长时间稳定性验证缺口继续跟踪。
- Windows 安装包未配置 Authenticode 证书，请只从本 Release 下载并核对 SHA-256。

## 下载地址

> macOS v0.67.5 及更高正式版、Windows v0.67.10 及更高正式版可在应用内检查并升级。更早的 Windows 版本请手动安装 v0.67.16；Linux 继续手动下载安装。

### macOS

- [Apple Silicon (M1/M2/M3/M4)](https://github.com/op7418/CodePilot/releases/download/v0.67.16/CodePilot-0.67.16-arm64.dmg)
- [Intel](https://github.com/op7418/CodePilot/releases/download/v0.67.16/CodePilot-0.67.16-x64.dmg)

### Windows

- [Windows x64 安装包](https://github.com/op7418/CodePilot/releases/download/v0.67.16/CodePilot.Setup.0.67.16.exe)
- Windows 安装包未配置 Authenticode 证书，可能显示 SmartScreen。仅从本 Release 下载并核对 SHA-256；应用内也会在安装更新前再次明确提示未签名状态。

### Linux

- [x64 AppImage](https://github.com/op7418/CodePilot/releases/download/v0.67.16/CodePilot-0.67.16-x86_64.AppImage)
- [arm64 AppImage](https://github.com/op7418/CodePilot/releases/download/v0.67.16/CodePilot-0.67.16-arm64.AppImage)
- [amd64 DEB](https://github.com/op7418/CodePilot/releases/download/v0.67.16/CodePilot-0.67.16-amd64.deb)
- [arm64 DEB](https://github.com/op7418/CodePilot/releases/download/v0.67.16/CodePilot-0.67.16-arm64.deb)
- [x86_64 RPM](https://github.com/op7418/CodePilot/releases/download/v0.67.16/CodePilot-0.67.16-x86_64.rpm)
- [aarch64 RPM](https://github.com/op7418/CodePilot/releases/download/v0.67.16/CodePilot-0.67.16-aarch64.rpm)

### 完整性验证

- [SHA-256 Checksums](https://github.com/op7418/CodePilot/releases/download/v0.67.16/SHA256SUMS.txt)
- GitHub Release 页面可验证每个安装包的 build-provenance attestation；`latest-mac.yml`、`latest.yml` 与 blockmap 是自动更新器资产，不需要手工下载。

## 安装说明

**macOS**：下载 DMG → 拖入 Applications → 正常启动。若 Gatekeeper 报告开发者无法验证或文件损坏，请停止安装并反馈，不要绕过安全检查。

已安装的 macOS 正式版会通过同一 GitHub Release 的 `latest-mac.yml` 检查更新，并使用签名、公证后的 universal ZIP 完成应用内下载与重启安装。

**Windows**：v0.67.10 及更高版本会通过 `latest.yml` 优先差分下载未签名 NSIS，失败时回退完整安装包。更早版本需手动安装 v0.67.16。出现 SmartScreen 时请核对下载来源与 SHA-256；安装前仍会明确提示没有独立发布者签名。

**Linux**：继续手动下载新版安装包，不会静默运行包管理器或提权安装。

## 系统要求

- macOS 12.0+
- Windows 10/11 x64，或常见 x64/arm64 Linux 发行版
- 需要配置 API 服务商或受支持的套餐凭据
- 推荐安装 Claude Code CLI 或 Codex CLI 以获得完整功能
