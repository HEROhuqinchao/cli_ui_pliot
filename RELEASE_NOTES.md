## CodePilot v0.67.7

> 修复升级后智谱 GLM 原有 API Key 无法读取时的错误路由，并给出明确、安全的恢复步骤。

### 修复问题

- **修复新版 GLM 模型全部请求失败** — 部分 Mac 升级后无法解密旧服务商凭据，CodePilot 过去可能错误继承 Claude 登录状态并显示无关的 401。现在会在发送前阻断，不再把 GLM-5.3、GLM-5-Turbo 或 GLM-4.7 请求发往其它服务商。
- **区分 Key 失效与本机凭据不可读** — 提示会明确说明原 API Key 本身可能仍然有效，并引导前往“设置 → 服务商设置”，删除原服务商后使用同一个 Key 重新添加，再回到会话重新选择。
- **修复旧会话使用默认服务商时的晚失败** — 即使旧会话尚未保存服务商 ID，只要最终选择的默认服务商缺少可用凭据，也会在消息写入前停止，不再留下未实际发送的用户消息。
- **修复重新保存 Key 后仍显示旧错误** — 用户清空或重新填写服务商 Key 后，旧的解密失败状态会同步清除，提示与当前真实状态保持一致。

### 优化改进

- 删除服务商会同时移除其自定义模型设置；恢复提示现在会提前说明，方便用户先记录需要保留的配置。
- macOS 正式版继续使用 Developer ID 签名、公证和 `latest-mac.yml` 原生自动更新；Windows 与 Linux 继续提供手动安装包，不发布对应平台的自动更新 metadata。

## 下载地址

> macOS v0.67.5 及更高正式版可在应用内检查并升级到本版本。v0.67.1 及更早版本需要先手动安装。Windows/Linux 本版均为手动下载安装。

### macOS

- [Apple Silicon (M1/M2/M3/M4)](https://github.com/op7418/CodePilot/releases/download/v0.67.7/CodePilot-0.67.7-arm64.dmg)
- [Intel](https://github.com/op7418/CodePilot/releases/download/v0.67.7/CodePilot-0.67.7-x64.dmg)

### Windows

- [Windows x64 安装包](https://github.com/op7418/CodePilot/releases/download/v0.67.7/CodePilot.Setup.0.67.7.exe)
- 本版 Windows 安装包未配置 Authenticode 证书，可能出现 SmartScreen 提示；仅从本 Release 下载并用下方 SHA-256 校验，不要从第三方镜像获取。

### Linux

- [x64 AppImage](https://github.com/op7418/CodePilot/releases/download/v0.67.7/CodePilot-0.67.7-x86_64.AppImage)
- [arm64 AppImage](https://github.com/op7418/CodePilot/releases/download/v0.67.7/CodePilot-0.67.7-arm64.AppImage)
- [amd64 DEB](https://github.com/op7418/CodePilot/releases/download/v0.67.7/CodePilot-0.67.7-amd64.deb)
- [arm64 DEB](https://github.com/op7418/CodePilot/releases/download/v0.67.7/CodePilot-0.67.7-arm64.deb)
- [x86_64 RPM](https://github.com/op7418/CodePilot/releases/download/v0.67.7/CodePilot-0.67.7-x86_64.rpm)
- [aarch64 RPM](https://github.com/op7418/CodePilot/releases/download/v0.67.7/CodePilot-0.67.7-aarch64.rpm)

### 完整性验证

- [SHA-256 Checksums](https://github.com/op7418/CodePilot/releases/download/v0.67.7/SHA256SUMS.txt)
- GitHub Release 页面可验证每个安装包的 build-provenance attestation；`latest-mac.yml` 与 blockmap 是自动更新器资产，不需要手工下载。

## 安装说明

**macOS**：下载 DMG → 拖入 Applications → 正常启动。若 Gatekeeper 报告开发者无法验证或文件损坏，请停止安装并反馈，不要绕过安全检查。

**Windows/Linux**：本版使用手动下载安装；安装包不会在后台自行替换当前版本。Windows 出现 SmartScreen 时请先核对下载来源与 SHA-256。

## 系统要求

- macOS 12.0+
- Windows 10/11 x64，或常见 x64/arm64 Linux 发行版
- 需要配置 API 服务商或受支持的套餐凭据
- 推荐安装 Claude Code CLI 以获得完整功能
