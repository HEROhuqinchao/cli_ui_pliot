# CodePilot 三方 API 服务商配置指南

## 核心概念

CodePilot 通过 Claude Code SDK 子进程与 API 通信。SDK 内部使用 Anthropic Messages API 协议，最终请求路径为：

```
{ANTHROPIC_BASE_URL}/v1/messages
```

因此，你配置的 Base URL 是**根端点**，SDK 会自动拼接 `/v1/messages`。

---

## 一、Base URL 配置规则

### 关键原则：不要包含 `/v1/messages`

SDK 会自动在 Base URL 后拼接 `/v1/messages`，所以你只需要填到"协议兼容层"的根路径。

### 正确示例

| 服务商 | Base URL 配置 | 实际请求地址 |
|--------|--------------|-------------|
| DeepSeek | `https://api.deepseek.com/anthropic` | `https://api.deepseek.com/anthropic/v1/messages` |
| GLM (智谱) | `https://open.bigmodel.cn/api/anthropic` | `https://open.bigmodel.cn/api/anthropic/v1/messages` |
| OpenRouter | `https://openrouter.ai/api` | `https://openrouter.ai/api/v1/messages` |
| 自建网关 | `https://your-gateway.com/anthropic` | `https://your-gateway.com/anthropic/v1/messages` |
| 自建网关 (根路径) | `https://your-gateway.com` | `https://your-gateway.com/v1/messages` |

### 常见错误

| 错误配置 | 导致的实际请求 | 问题 |
|---------|--------------|------|
| `https://xxx.com/v1/messages` | `https://xxx.com/v1/messages/v1/messages` | 路径重复 |
| `https://xxx.com/v1` | `https://xxx.com/v1/v1/messages` | 路径重复 |
| `https://xxx.com/compatible/v1` | `https://xxx.com/compatible/v1/v1/messages` | 路径重复 |

### 如何判断你的网关需要填什么？

问你的网关提供方一个问题：**"Anthropic Messages API 的完整端点是什么？"**

- 如果回答是 `https://xxx.com/anthropic/v1/messages` → Base URL 填 `https://xxx.com/anthropic`
- 如果回答是 `https://xxx.com/v1/messages` → Base URL 填 `https://xxx.com`
- 如果回答是 `https://xxx.com/compatible/v1/messages` → Base URL 填 `https://xxx.com/compatible`

**简单规则：把完整端点中的 `/v1/messages` 去掉，剩下的就是 Base URL。**

---

## 二、认证方式 (authStyle)

CodePilot 支持两种认证头格式：

| authStyle | 发送的 HTTP 头 | 适用场景 |
|-----------|---------------|---------|
| `auth_token` | `Authorization: Bearer <key>` | 大多数三方网关（DeepSeek、GLM、OpenRouter、自建网关） |
| `api_key` | `X-Api-Key: <key>` | Anthropic 官方、少数要求 x-api-key 的服务 |

### 如何选择？

- **不确定时选 `auth_token`**（Bearer 头是最通用的）
- 如果你的网关文档说"在 Header 中传 `Authorization: Bearer sk-xxx`" → 选 `auth_token`
- 如果你的网关文档说"在 Header 中传 `x-api-key: sk-xxx`" → 选 `api_key`
- 如果报 `AUTH_001 Missing authorization header` → 说明 authStyle 选错了，换另一个

### 在 UI 中配置

Settings → Providers → 编辑服务商 → Provider Type：
- 选 **Anthropic** → authStyle = `api_key`（X-Api-Key 头）
- 选 **OpenAI-Compatible** / **Custom** → 默认 authStyle = `api_key`
- 预设服务商（DeepSeek、GLM 等）→ 已自动配置正确的 authStyle

如果需要手动覆盖 authStyle，在供应商的 `env_overrides_json` 中无法直接修改（authStyle 由 provider_type 或 preset 决定），需要选择正确的 Provider Type。

---

## 三、模型名称配置

### 模型解析链路

```
UI 选择的模型 (modelId)
    ↓ 查找 availableModels 目录
upstreamModelId（实际发给 API 的模型名）
    ↓ 设置到环境变量
ANTHROPIC_MODEL / ANTHROPIC_DEFAULT_SONNET_MODEL / ...
    ↓ CLI 子进程读取
发送给 API 的 model 字段
```

### 配置方式一：Role Mapping（推荐）

在供应商编辑页面的 **Role Mapping**（`role_models_json`）字段中配置：

```json
{
  "default": "your-model-id",
  "sonnet": "your-model-id",
  "opus": "your-model-id[1M]",
  "haiku": "your-lightweight-model"
}
```

这些值会被设置为：
- `default` → `ANTHROPIC_MODEL`（主模型）
- `sonnet` → `ANTHROPIC_DEFAULT_SONNET_MODEL`
- `opus` → `ANTHROPIC_DEFAULT_OPUS_MODEL`
- `haiku` → `ANTHROPIC_DEFAULT_HAIKU_MODEL`

### 配置方式二：Environment Overrides

在供应商的 **Environment Overrides**（`env_overrides_json`）中配置：

```json
{
  "ANTHROPIC_MODEL": "mdataplus_gc6qew[1M]",
  "ANTHROPIC_DEFAULT_SONNET_MODEL": "mdataplus_gc6qew[1M]",
  "ANTHROPIC_DEFAULT_OPUS_MODEL": "mdataplus_gc6qew[1M]",
  "ANTHROPIC_DEFAULT_HAIKU_MODEL": "mdataplus_gc6qew",
  "CLAUDE_CODE_EFFORT_LEVEL": "max"
}
```

> **注意**：`env_overrides_json` 中的模型名如果是真实模型 ID（包含下划线、点号、方括号等），会正常透传。但如果是裸别名（`sonnet`、`opus`、`haiku`、`claude`、`default`），会被拦截以防止 503 错误。

### 模型名格式说明

| 格式 | 示例 | 说明 |
|------|------|------|
| 纯模型 ID | `deepseek-v4-pro` | 直接发给 API |
| 带上下文窗口后缀 | `mdataplus_gc6qew[1M]` | `[1M]` 会原样发给 API（如果网关支持） |
| 带供应商前缀 | `anthropic/claude-sonnet-4.6` | OpenRouter 格式 |
| 裸别名（会被拦截） | `sonnet`、`opus` | 不要用在 env_overrides 中 |

### 模型名被拒绝怎么办？

如果报错 `There's an issue with the selected model (xxx)`：

1. 确认模型名与网关支持的完全一致（区分大小写）
2. 如果模型名带 `[1M]` 后缀，确认网关是否支持该格式
3. 检查 Role Mapping 和 env_overrides 是否冲突（Role Mapping 优先级更高）
4. 在 Settings → Models 页面确认模型已启用

---

## 四、完整配置示例

### 示例 1：自建 Anthropic 兼容网关

```
名称: My Gateway
Provider Type: Anthropic (或 Custom)
Base URL: https://my-gateway.internal.com/anthropic
API Key: sk-your-token-here
```

env_overrides_json:
```json
{
  "ANTHROPIC_MODEL": "internal-model-v2[1M]",
  "ANTHROPIC_DEFAULT_HAIKU_MODEL": "internal-model-v2",
  "ANTHROPIC_DEFAULT_SONNET_MODEL": "internal-model-v2[1M]",
  "ANTHROPIC_DEFAULT_OPUS_MODEL": "internal-model-v2[1M]"
}
```

### 示例 2：DeepSeek

```
名称: DeepSeek
Provider Type: 预设 (DeepSeek)
Base URL: https://api.deepseek.com/anthropic  (预设已填)
API Key: sk-your-deepseek-key
```

Role Mapping (预设已配置):
```json
{
  "default": "deepseek-v4-pro[1m]",
  "opus": "deepseek-v4-pro[1m]",
  "sonnet": "deepseek-v4-pro[1m]",
  "haiku": "deepseek-v4-flash"
}
```

### 示例 3：OpenRouter

```
名称: OpenRouter
Provider Type: 预设 (OpenRouter)
Base URL: https://openrouter.ai/api  (预设已填)
API Key: sk-or-your-key
```

Role Mapping (预设已配置):
```json
{
  "default": "anthropic/claude-sonnet-4.6",
  "opus": "anthropic/claude-opus-4.7",
  "sonnet": "anthropic/claude-sonnet-4.6",
  "haiku": "anthropic/claude-haiku-4.5"
}
```

---

## 五、其他有用的环境变量

在 `env_overrides_json` 中可配置：

| 变量 | 说明 | 示例 |
|------|------|------|
| `CLAUDE_CODE_EFFORT_LEVEL` | 推理努力等级 | `"max"` / `"high"` / `"medium"` / `"low"` |
| `CLAUDE_CODE_DISABLE_NONSTREAMING_FALLBACK` | 禁止非流式回退 | `"1"` |
| `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` | 禁止非必要请求 | `"1"` |
| `API_TIMEOUT_MS` | API 超时时间（毫秒） | `"3000000"` |
| `DISABLE_AUTOUPDATER` | 禁止 CLI 自动更新 | `"1"` |

---

## 六、故障排查

| 错误信息 | 原因 | 解决方法 |
|---------|------|---------|
| `AUTH_001 Missing authorization header` | authStyle 不匹配或 API Key 未传递 | 切换 Provider Type；确认 API Key 已填写 |
| `There's an issue with the selected model (xxx)` | 模型名不被网关识别 | 检查模型名拼写；确认 Role Mapping 配置 |
| `Connection refused` / `ECONNREFUSED` | Base URL 错误 | 确认 URL 可达；检查是否需要 `/anthropic` 后缀 |
| `404 Not Found` | Base URL 多了 `/v1` | 去掉 URL 中的 `/v1`（SDK 会自动加） |
| `529 Overloaded` | 网关限流 | 等待或联系网关提供方 |
| 钥匙串弹窗 | macOS Keychain 中有残留 Claude 凭据 | 删除：`security delete-generic-password -s "Claude Code-credentials"` |

---

## 七、配置优先级

当多个配置源冲突时，优先级从高到低：

1. **Role Mapping** (`role_models_json`) — 最高优先级，直接设为 `ANTHROPIC_MODEL` 等
2. **Environment Overrides** (`env_overrides_json`) — 真实模型 ID 可覆盖，裸别名被拦截
3. **预设目录** (`provider-catalog.ts`) — 预设服务商的默认模型列表
4. **全局设置** (Settings → Models) — 用户选择的默认模型

---

## 八、Runtime 选择

配置好服务商后，还需要选择正确的 Runtime：

- **Claude Code SDK** (`claude-code-sdk`)：通过 CLI 子进程调用，支持所有三方网关（推荐）
- **Native** (`native`)：通过 Vercel AI SDK 直接调用，仅支持 Anthropic 官方和少数兼容 API

在 Settings → Runtime 中选择，或在聊天界面通过 session pin 指定。

> 大多数三方网关（DeepSeek、GLM、OpenRouter、自建网关）需要使用 **Claude Code SDK** runtime，因为它们通过 Anthropic Messages API 协议通信。
