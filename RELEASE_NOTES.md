## CodePilot v0.67.0

> 新增 Grok 4.6、Grok Imagine 与 GLM-5.3 CodePlan 支持，并修复 Grok Build 授权和媒体回显链路。

### 新增功能

- **支持 Grok 4.6** — xAI API Key 与 Grok Build 授权渠道均可选择 Grok 4.6；Grok 4.5 保留为兼容旧会话的模型。
- **支持 Grok Imagine 图片和视频** — Grok Build 登录后可使用 Grok Imagine Image 2.0 生成或编辑图片，并使用 Grok Imagine Video 1.5 生成视频；结果会直接回显并登记到素材库。
- **设置页显示 Grok 媒体能力** — Grok Build 授权成功后会出现在图片与视频服务商状态中，便于确认当前媒体调用实际使用的账号。
- **支持 GLM-5.3 CodePlan** — 智谱 CodePlan 目录更新为 GLM-5.3、GLM-5-Turbo 与 GLM-4.7，并按当前模型能力提供真实可用的推理强度。
- **更新 DeepSeek V4 Pro** — DeepSeek 官方渠道展示当前正式名称，并同步最新推理档位与传输能力。

### 修复问题

- **修复 Grok Build 请求提示“Upgrade Required”** — 补齐当前 Grok Build 客户端版本、身份与模型选择信息，避免授权成功后请求仍被网关拒绝。
- **修复 Grok 4.6 高推理档位请求失败** — 模型菜单和请求参数现在以当前 SDK 实际可承载的档位为准，不再发送 SDK 无法序列化的值。
- **修复 Grok OAuth 回调偶发失败** — 授权回调改用动态本机端口，并保证授权和换取令牌使用同一个回调地址。
- **修复生成图片无法回显或显示为裂图** — 本地生成结果现在通过受控媒体地址渲染，不再把不可访问的本机绝对路径直接交给聊天界面。
- **修复媒体调用链过长** — Agent 会直接看到当前已挂载的图片和视频工具，减少重复检查模型、凭据和接口的无效步骤。
- **修复图片服务商选择错误** — 确认页、调用路由与设置页统一使用当前激活的图片服务商，避免聊天模型渠道影响媒体模型计费与路由。
- **修复停止生成后仍继续轮询** — Native、Claude Code、Codex 和确认页都会传递停止信号；未完成的任务会停止后续请求，已经下载完成的可能计费资产仍会安全保留。

### 优化改进

- Grok Build 的文本请求与 Imagine 媒体请求采用独立的安全路由和请求头白名单，降低授权令牌误发到错误端点的风险。
- 图片、视频和普通聊天模型采用独立能力目录，媒体模型不会混入聊天模型选择器。
- GLM-5.3 在未登录 Codex Account 时也能根据本机 Codex 版本安全判断 Max 档兼容性；旧版或预览版不兼容时会给出明确升级提示，不再静默降级。

### 已知限制

- Grok 4.6、Grok Imagine 和 GLM CodePlan 的实际可用性由账号套餐、区域和上游服务策略决定；登录成功不代表账号一定包含所有图片、视频或模型额度。
- Grok Imagine 的本地停止操作不会撤销上游已经提交或计费的任务，也不代表自动退款。

## 下载地址

### macOS
- [Apple Silicon (M1/M2/M3/M4)](https://github.com/op7418/CodePilot/releases/download/v0.67.0/CodePilot-0.67.0-arm64.dmg)
- [Intel](https://github.com/op7418/CodePilot/releases/download/v0.67.0/CodePilot-0.67.0-x64.dmg)

### Windows
- [Windows 安装包](https://github.com/op7418/CodePilot/releases/download/v0.67.0/CodePilot.Setup.0.67.0.exe)

### Linux x64
- [AppImage](https://github.com/op7418/CodePilot/releases/download/v0.67.0/CodePilot-0.67.0-x86_64.AppImage)
- [deb](https://github.com/op7418/CodePilot/releases/download/v0.67.0/CodePilot-0.67.0-amd64.deb)
- [rpm](https://github.com/op7418/CodePilot/releases/download/v0.67.0/CodePilot-0.67.0-x86_64.rpm)

### Linux arm64
- [AppImage](https://github.com/op7418/CodePilot/releases/download/v0.67.0/CodePilot-0.67.0-arm64.AppImage)
- [deb](https://github.com/op7418/CodePilot/releases/download/v0.67.0/CodePilot-0.67.0-arm64.deb)
- [rpm](https://github.com/op7418/CodePilot/releases/download/v0.67.0/CodePilot-0.67.0-aarch64.rpm)

## 安装说明

**macOS**：下载 DMG → 拖入 Applications → 首次启动如遇安全提示，在系统设置 > 隐私与安全中点击“仍要打开”

**Windows**：下载 exe 安装包 → 双击安装

**Linux**：AppImage 添加可执行权限后直接运行；Debian/Ubuntu 安装 deb；Fedora/RHEL 系安装 rpm

## 系统要求

- macOS 12.0+ / Windows 10+ / Linux (glibc 2.35+)
- 需要配置 API 服务商或受支持的套餐凭据
- 推荐安装 Claude Code CLI 以获得完整功能
