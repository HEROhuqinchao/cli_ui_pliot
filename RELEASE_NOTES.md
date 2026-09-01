## CodePilot v0.67.12

> 让每个聊天在第一次发送后固定 Runtime，避免意外切换造成上下文分叉和缓存重建，并让用量、费用与压缩状态只展示真实可证明的数据。

### 新增功能

- **聊天 Runtime 所有权** — 新聊天在第一条消息发送前仍可选择 Claude Code、CodePilot 或 Codex；第一次执行被接受后，该聊天会固定由所选 Runtime 接管，选择区同步置灰。刷新页面、清空消息或修改全局默认 Runtime 都不会让已有聊天悄悄漂移。
- **同 Runtime 内安全换模型** — Runtime 固定后仍可使用当前 Runtime 支持的模型与渠道变化。CodePilot 会按 Runtime 的真实续聊能力决定是原地继续还是重放上下文，不再只看模型名称猜测。
- **更真实的缓存与费用统计** — 每轮用量现在会按 Runtime 区分未缓存输入、缓存读取、缓存写入与输出。Provider 没有返回某项事实时显示未知或数据不完整，不再把缺失费用和缓存数据聚合成 0。
- **可解释的长对话压缩** — 压缩提示会说明覆盖到哪段历史、是否重建底层会话以及可能带来的缓存影响。Claude Code 与 CodePilot 继续使用主动压缩；Codex 的 thread 压缩明确标为 Runtime 管理，不再混成同一种能力。

### 修复问题

- 修复侧栏点击“新对话”时，局部模型信息被误当成完整执行路线而返回 `400 Bad Request` 的问题。普通空聊天现在保持未绑定，直到用户第一次发送。
- 修复新聊天第一条消息可能直接请求模型、却尚未提交 Runtime 所有权，从而返回 `409 Conflict` 的问题。首发现在会先原子保存 Runtime、Provider 与模型，再启动执行。
- 修复多窗口或快速操作产生路线版本冲突后，页面必须刷新才能恢复的问题。客户端现在会采纳服务端最新路线、保留输入草稿，并提示用户再次发送。
- 修复聊天过程中切换 Runtime 会突然创建并跳转到另一个聊天的问题。普通模型选择器不再触发跨 Runtime 交接；需要换 Runtime 时请主动新建聊天。
- 修复 welcome、heartbeat、Bridge、任务会话和派生工作区可能在创建后重新读取全局默认值，导致实际 Runtime 与原始意图不一致的问题。这些自动会话现在在创建时冻结完整执行路线。
- 修复把 ChatGPT/Codex Desktop 内置的 Codex CLI 误判成独立安装、进而提供错误的一键更新或执行权限假设的问题。内置 CLI 现在明确由所属桌面应用管理，macOS 与 Windows 的常见安装布局都会正确识别。

### 优化改进

- Runtime 所有权与完整执行路线改为服务端单次校验、单次持久化；失败、并发冲突和不允许的跨 Runtime 变更都不会留下半套状态。
- 已开始聊天的 Runtime 显示统一使用用户可读名称，不再暴露 `codex_runtime` 等内部标识。
- 历史会话采用保守迁移：能够由原生 thread/session 证明归属的会话自动恢复；无法可靠判断的会话会要求用户选择一次，不会按今天的全局默认值猜测。
- 跨 Runtime 的底层交接能力保留为独立边界，但不会伪装成普通下拉选择。原聊天和底层 thread 不会被偷偷改写。

### 已知问题

- 本版新的 Runtime 所有权、缓存分桶和压缩合同已经通过自动化测试、开发客户端与 API 冒烟验证，但三个 Runtime 的真实账号长线程 smoke 仍待补齐，因此不承诺固定的缓存命中率或费用下降比例。
- 极慢或长时间排队的第三方渠道在首个模型输出前仍保留 10 分钟安全上限；6–9 分钟真实慢代理 smoke 尚未完成。若当前版本仍自动中断，请附上服务商、模型与大致等待时长反馈。
- Windows 安装包仍未配置 Authenticode 证书，且曾有一台 Windows 11 25H2 机器报告旧版安装器启动失败；当前安装包尚未在同一环境复验。请只从本 Release 下载并核对 SHA-256，异常时附事件查看器信息反馈。
- 旧版本曾有“出现新版提示后会持续高 CPU”的报告，当前版本尚未在原报告环境完成复验。如再次出现，请附操作系统、CPU 采样以及切换到设置页后的变化。

## 下载地址

> macOS v0.67.5 及更高正式版、Windows v0.67.10 及更高正式版可在应用内检查并升级。更早的 Windows 版本请手动安装 v0.67.12；Linux 继续手动下载安装。

### macOS

- [Apple Silicon (M1/M2/M3/M4)](https://github.com/op7418/CodePilot/releases/download/v0.67.12/CodePilot-0.67.12-arm64.dmg)
- [Intel](https://github.com/op7418/CodePilot/releases/download/v0.67.12/CodePilot-0.67.12-x64.dmg)

### Windows

- [Windows x64 安装包](https://github.com/op7418/CodePilot/releases/download/v0.67.12/CodePilot.Setup.0.67.12.exe)
- Windows 安装包未配置 Authenticode 证书，可能显示 SmartScreen。仅从本 Release 下载并核对 SHA-256；应用内也会在安装更新前再次明确提示未签名状态。

### Linux

- [x64 AppImage](https://github.com/op7418/CodePilot/releases/download/v0.67.12/CodePilot-0.67.12-x86_64.AppImage)
- [arm64 AppImage](https://github.com/op7418/CodePilot/releases/download/v0.67.12/CodePilot-0.67.12-arm64.AppImage)
- [amd64 DEB](https://github.com/op7418/CodePilot/releases/download/v0.67.12/CodePilot-0.67.12-amd64.deb)
- [arm64 DEB](https://github.com/op7418/CodePilot/releases/download/v0.67.12/CodePilot-0.67.12-arm64.deb)
- [x86_64 RPM](https://github.com/op7418/CodePilot/releases/download/v0.67.12/CodePilot-0.67.12-x86_64.rpm)
- [aarch64 RPM](https://github.com/op7418/CodePilot/releases/download/v0.67.12/CodePilot-0.67.12-aarch64.rpm)

### 完整性验证

- [SHA-256 Checksums](https://github.com/op7418/CodePilot/releases/download/v0.67.12/SHA256SUMS.txt)
- GitHub Release 页面可验证每个安装包的 build-provenance attestation；`latest-mac.yml`、`latest.yml` 与 blockmap 是自动更新器资产，不需要手工下载。

## 安装说明

**macOS**：下载 DMG → 拖入 Applications → 正常启动。若 Gatekeeper 报告开发者无法验证或文件损坏，请停止安装并反馈，不要绕过安全检查。

已安装的 macOS 正式版会通过同一 GitHub Release 的 `latest-mac.yml` 检查更新，并使用签名、公证后的 universal ZIP 完成应用内下载与重启安装。

**Windows**：v0.67.10 及更高版本会通过 `latest.yml` 优先差分下载未签名 NSIS，失败时回退完整安装包。更早版本需手动安装 v0.67.12。出现 SmartScreen 时请核对下载来源与 SHA-256；安装前仍会明确提示没有独立发布者签名。

**Linux**：继续手动下载新版安装包，不会静默运行包管理器或提权安装。

## 系统要求

- macOS 12.0+
- Windows 10/11 x64，或常见 x64/arm64 Linux 发行版
- 需要配置 API 服务商或受支持的套餐凭据
- 推荐安装 Claude Code CLI 或 Codex CLI 以获得完整功能
