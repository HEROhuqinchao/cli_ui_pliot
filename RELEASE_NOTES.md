## CodePilot v0.67.9

> 统一模型、权限与工作区操作入口，加入 GLM-5.3-Flash，并为 Windows 正式版启用透明可核验的无签名自动更新。

### 新增功能

- **更紧凑的模型与权限选择** — 模型选择器现在以 Runtime 为一级入口，只展示当前可执行的服务商与模型路线；支持搜索、收藏完整路线，并在输入框内集中显示推理强度、上下文和权限档位。
- **统一工作区侧栏** — Files、Git、Widget、Preview 与 Browser 使用一致的标签和固定机制。固定的模块会按项目恢复，文件树与预览分别保留在主区域和 Inspector，不再出现重复侧栏。
- **安全内置浏览器 MVP** — 可在工作区内打开 HTTPS 页面和本机开发服务，支持地址栏、前进后退、刷新和多个页面标签。网页权限默认拒绝、危险协议与非本机明文 HTTP 会被阻止，下载暂不开放。
- **支持 GLM-5.3-Flash** — 智谱 Coding Plan 中国区和国际区更新为当前 GLM-5.3 / GLM-5.3-Flash 阵容；Flash 支持图片输入、1M 上下文和 Low / High / Max 思考强度，默认使用 Max。
- **Windows 原生自动更新** — 本版本是 Windows 自动更新的首个引导版本。手动安装 v0.67.9 后，后续正式版可通过应用内检查更新，优先差分下载，必要时自动回退完整安装包。

### 优化改进

- 模型收藏现在绑定 Runtime、服务商实例和模型的完整组合；失效收藏会保留原因和删除入口，不会猜测或切换到错误路线。
- 固定 1M 的模型不再显示无效开关；模型切换时只展示并发送真实支持的能力参数。
- Windows 更新界面会从安装包配置读取真实签名状态；当前未配置独立发布者签名时会明确提示，不把 SHA-512 完整性校验误称为 Authenticode 身份验证。
- GLM 历史模型行继续非破坏保留；旧 GLM-4.7 路线会升级到 Flash，但不会静默删除用户手工添加或修改的模型。

## 下载地址

> macOS v0.67.5 及更高正式版可在应用内检查并升级。Windows v0.67.7 及更早版本没有官方更新器标记，必须先手动安装 v0.67.9；Linux 继续手动下载安装。

### macOS

- [Apple Silicon (M1/M2/M3/M4)](https://github.com/op7418/CodePilot/releases/download/v0.67.9/CodePilot-0.67.9-arm64.dmg)
- [Intel](https://github.com/op7418/CodePilot/releases/download/v0.67.9/CodePilot-0.67.9-x64.dmg)

### Windows

- [Windows x64 安装包](https://github.com/op7418/CodePilot/releases/download/v0.67.9/CodePilot.Setup.0.67.9.exe)
- Windows 安装包未配置 Authenticode 证书，可能显示 SmartScreen。仅从本 Release 下载并核对 SHA-256；应用内也会在安装更新前再次明确提示未签名状态。

### Linux

- [x64 AppImage](https://github.com/op7418/CodePilot/releases/download/v0.67.9/CodePilot-0.67.9-x86_64.AppImage)
- [arm64 AppImage](https://github.com/op7418/CodePilot/releases/download/v0.67.9/CodePilot-0.67.9-arm64.AppImage)
- [amd64 DEB](https://github.com/op7418/CodePilot/releases/download/v0.67.9/CodePilot-0.67.9-amd64.deb)
- [arm64 DEB](https://github.com/op7418/CodePilot/releases/download/v0.67.9/CodePilot-0.67.9-arm64.deb)
- [x86_64 RPM](https://github.com/op7418/CodePilot/releases/download/v0.67.9/CodePilot-0.67.9-x86_64.rpm)
- [aarch64 RPM](https://github.com/op7418/CodePilot/releases/download/v0.67.9/CodePilot-0.67.9-aarch64.rpm)

### 完整性验证

- [SHA-256 Checksums](https://github.com/op7418/CodePilot/releases/download/v0.67.9/SHA256SUMS.txt)
- GitHub Release 页面可验证每个安装包的 build-provenance attestation；`latest-mac.yml`、`latest.yml` 与 blockmap 是自动更新器资产，不需要手工下载。

## 安装说明

**macOS**：下载 DMG → 拖入 Applications → 正常启动。若 Gatekeeper 报告开发者无法验证或文件损坏，请停止安装并反馈，不要绕过安全检查。

已安装的 macOS 正式版会通过同一 GitHub Release 的 `latest-mac.yml` 检查更新，并使用签名、公证后的 universal ZIP 完成应用内下载与重启安装。

**Windows**：v0.67.9 是首个支持 Windows 自动更新的正式版，需要手动下载安装。安装后，后续版本会通过 `latest.yml` 优先差分下载未签名 NSIS，失败时回退完整安装包。出现 SmartScreen 时请核对下载来源与 SHA-256；安装前仍会明确提示没有独立发布者签名。

**Linux**：继续手动下载新版安装包，不会静默运行包管理器或提权安装。

## 系统要求

- macOS 12.0+
- Windows 10/11 x64，或常见 x64/arm64 Linux 发行版
- 需要配置 API 服务商或受支持的套餐凭据
- 推荐安装 Claude Code CLI 以获得完整功能
