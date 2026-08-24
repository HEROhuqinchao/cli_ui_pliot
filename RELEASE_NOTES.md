## CodePilot v0.67.6

> 保留 macOS 签名、公证与应用内自动更新，同时恢复 Windows 和 Linux 的手动安装包下载。

### 新增功能

- **macOS 自动更新** — CodePilot 可以在后台检查并下载受签名保护的更新，下载完成后由你决定何时重启安装；检测到仍有对话、Bridge 或定时任务运行时不会强制退出。
- **数据库启动恢复** — 数据库损坏、暂时被占用或迁移失败时会展示对应的恢复说明和脱敏诊断；只有确认损坏时才提供新建空数据库，并在操作前保留可验证备份。

### 修复问题

- **修复 GLM-5.3 显示已添加但模型列表中找不到** — 完整识别多个历史版本留下的 GLM-4.7、GLM-4.5-Air、GLM-5.2 与 GLM-5-Turbo 目录，将可确认的旧模型安全迁移到当前目录，同时保留手动编辑和隐藏状态。
- **修复安装更新时可能中断正在输出的会话** — 流式输出、等待授权和运行中的会话都会阻止安装退出，安装交接失败后旧版本会恢复可用状态。
- **修复取消流式任务后的重复关闭错误** — Marketplace、CLI 工具和媒体任务在取消或超时后只结束一次响应，不再继续写入已经关闭的流。
- **修复数据库恢复可能误报损坏或重新载入旧库** — 迁移和运行期故障不再被描述为数据损坏，“新建空数据库”也不会被旧路径数据库覆盖。
- **恢复 Windows 与 Linux 下载** — Windows 和 Linux 用户检查更新时会获得对应平台的真实安装包链接，不再遇到新版本只有 macOS 下载的死端。

### 优化改进

- macOS 安装包经过 Developer ID 签名、公证、staple 与 Gatekeeper 验证；自动更新 metadata、blockmap、checksum 和安装包由同一次不可变构建生成并校验。
- Windows 与 Linux 本版只提供手动下载安装，不启用应用内原生自动安装，也不发布对应平台的 updater metadata。
- 崩溃统计默认不上传 native minidump，进一步收窄可能包含本机路径或内存内容的遥测范围。
- 数据库恢复备份增加一致性校验、内容去重与保留策略，降低重复损坏备份挤占磁盘的风险。

## 下载地址

> macOS v0.67.5 可在应用内检查并升级到本版本。v0.67.1 及更早版本需要先手动安装。Windows/Linux 本版均为手动下载安装。

### macOS

- [Apple Silicon (M1/M2/M3/M4)](https://github.com/op7418/CodePilot/releases/download/v0.67.6/CodePilot-0.67.6-arm64.dmg)
- [Intel](https://github.com/op7418/CodePilot/releases/download/v0.67.6/CodePilot-0.67.6-x64.dmg)

### Windows

- [Windows x64 安装包](https://github.com/op7418/CodePilot/releases/download/v0.67.6/CodePilot.Setup.0.67.6.exe)
- 本版 Windows 安装包未配置 Authenticode 证书，可能出现 SmartScreen 提示；仅从本 Release 下载并用下方 SHA-256 校验，不要从第三方镜像获取。

### Linux

- [x64 AppImage](https://github.com/op7418/CodePilot/releases/download/v0.67.6/CodePilot-0.67.6-x86_64.AppImage)
- [arm64 AppImage](https://github.com/op7418/CodePilot/releases/download/v0.67.6/CodePilot-0.67.6-arm64.AppImage)
- [amd64 DEB](https://github.com/op7418/CodePilot/releases/download/v0.67.6/CodePilot-0.67.6-amd64.deb)
- [arm64 DEB](https://github.com/op7418/CodePilot/releases/download/v0.67.6/CodePilot-0.67.6-arm64.deb)
- [x86_64 RPM](https://github.com/op7418/CodePilot/releases/download/v0.67.6/CodePilot-0.67.6-x86_64.rpm)
- [aarch64 RPM](https://github.com/op7418/CodePilot/releases/download/v0.67.6/CodePilot-0.67.6-aarch64.rpm)

### 完整性验证

- [SHA-256 Checksums](https://github.com/op7418/CodePilot/releases/download/v0.67.6/SHA256SUMS.txt)
- GitHub Release 页面可验证每个安装包的 build-provenance attestation；`latest-mac.yml` 与 blockmap 是自动更新器资产，不需要手工下载。

## 安装说明

**macOS**：下载 DMG → 拖入 Applications → 正常启动。若 Gatekeeper 报告开发者无法验证或文件损坏，请停止安装并反馈，不要绕过安全检查。

**Windows/Linux**：本版使用手动下载安装；安装包不会在后台自行替换当前版本。Windows 出现 SmartScreen 时请先核对下载来源与 SHA-256。

## 系统要求

- macOS 12.0+
- Windows 10/11 x64，或常见 x64/arm64 Linux 发行版
- 需要配置 API 服务商或受支持的套餐凭据
- 推荐安装 Claude Code CLI 以获得完整功能
