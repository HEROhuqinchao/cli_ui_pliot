## CodePilot v0.67.4

> 修复 GLM 旧版本升级与数据库启动恢复问题，并为 macOS 加入签名、公证和应用内自动更新能力。

### 新增功能

- **macOS 自动更新** — 从本版本开始，CodePilot 可以在后台检查并下载受签名保护的更新，下载完成后由你决定何时重启安装；检测到仍有对话、Bridge 或定时任务运行时不会强制退出。
- **数据库启动恢复** — 数据库损坏、暂时被占用或迁移失败时会展示对应的恢复说明和脱敏诊断；只有确认损坏时才提供新建空数据库，并在操作前保留可验证备份。

### 修复问题

- **修复 GLM-5.3 显示已添加但模型列表中找不到** — 完整识别多个历史版本留下的 GLM-4.7、GLM-4.5-Air、GLM-5.2 与 GLM-5-Turbo 目录，将可确认的旧模型安全迁移到当前目录，同时保留手动编辑和隐藏状态。
- **修复安装更新时可能中断正在输出的会话** — 流式输出、等待授权和运行中的会话都会阻止安装退出，安装交接失败后旧版本会恢复可用状态。
- **修复取消流式任务后的重复关闭错误** — Marketplace、CLI 工具和媒体任务在取消或超时后只结束一次响应，不再继续写入已经关闭的流。
- **修复数据库恢复可能误报损坏或重新载入旧库** — 迁移和运行期故障不再被描述为数据损坏，“新建空数据库”也不会被旧路径数据库覆盖。
- **修复无对应平台安装包时的误导提示** — Windows 或 Linux 用户检查到 macOS-only 版本时，会明确看到该版本没有兼容安装包，不再把发布详情页显示成下载链接。

### 优化改进

- macOS 安装包现在经过 Developer ID 签名、公证、staple 与 Gatekeeper 验证，自动更新 metadata、blockmap、checksum 和安装包由同一次不可变构建生成并校验。
- 崩溃统计默认不上传 native minidump，进一步收窄可能包含本机路径或内存内容的遥测范围。
- 数据库恢复备份增加一致性校验、内容去重与保留策略，降低重复损坏备份挤占磁盘的风险。

## 下载地址

> v0.67.1 不具备应用内自动更新能力，需要手动安装本版本；后续版本可由 CodePilot 在应用内检查和下载。当前正式发布仅提供 macOS 安装包。

### macOS

- [Apple Silicon (M1/M2/M3/M4)](https://github.com/op7418/CodePilot/releases/download/v0.67.4/CodePilot-0.67.4-arm64.dmg)
- [Intel](https://github.com/op7418/CodePilot/releases/download/v0.67.4/CodePilot-0.67.4-x64.dmg)

### 完整性验证

- [SHA-256 Checksums](https://github.com/op7418/CodePilot/releases/download/v0.67.4/SHA256SUMS.txt)
- GitHub Release 页面可验证每个安装包的 build-provenance attestation；`latest-mac.yml` 与 blockmap 是自动更新器资产，不需要手工下载。

## 安装说明

**macOS**：下载 DMG → 拖入 Applications → 正常启动。若 Gatekeeper 报告开发者无法验证或文件损坏，请停止安装并反馈，不要绕过安全检查。

## 系统要求

- macOS 12.0+
- 需要配置 API 服务商或受支持的套餐凭据
- 推荐安装 Claude Code CLI 以获得完整功能
