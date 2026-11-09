# 插件化 Agent 编排系统 — 执行计划

> **状态**: Draft（设计阶段）
> **分支**: `feat/plugin-agent-orchestrator`
> **创建**: 2026-07-23
> **前置分析**: [docs/insights/agent-capability-swappability-analysis.md](../../insights/agent-capability-swappability-analysis.md)

## 目标

将 CodePilot 的 Agent 处理能力从当前 agent-loop.ts 的一体化实现，重构为可插拔的分层架构，使以下场景成为一等公民：

1. **接入外部 Agent 框架**（LangGraph、CrewAI、AutoGen 等）作为执行引擎
2. **用户自定义 Agent 配置**（工具集 + 提示词 + 执行策略的声明式组合）
3. **远程 Agent 服务委托**（将任务整体交给远程 Agent API 执行）
4. **多 Agent 协作编排**（角色分工、工作流状态机、并行/串行组合）

## 设计原则

- **渐进式重构**：不破坏现有三个 Runtime（native / claude-code-sdk / codex_runtime）的正常运行，每个 Phase 独立可交付
- **合约优先**：先定义接口和事件合约，再迁移实现；前端 SSE 合约不变
- **最小侵入**：优先在 agent-loop 内部做策略抽取，不改变 `AgentRuntime.stream()` 的外部合约
- **可测试性**：每个抽象层都有对应的 mock 实现和单元测试

---

## 架构总览

```
┌─────────────────────────────────────────────────────────────────┐
│                        Chat API / Bridge                         │
│                  (POST /api/chat, conversationEngine)            │
└──────────────────────────────┬──────────────────────────────────┘
                               │ RuntimeStreamOptions
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                    AgentRuntime (已有合约)                        │
│              stream() → ReadableStream<string> (SSE)             │
├─────────────────────────────────────────────────────────────────┤
│  native-runtime  │  sdk-runtime  │  codex-runtime  │  plugin-*  │
└────────┬─────────┴───────────────┴─────────────────┴────────────┘
         │ (native 内部重构为以下分层)
         ▼
┌─────────────────────────────────────────────────────────────────┐
│                   AgentOrchestrator (新增)                       │
│  编排模式: single | multi-role | workflow | delegate             │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────────┐  ┌──────────────────┐  ┌───────────────┐  │
│  │ExecutionStrategy│  │  ToolProvider    │  │PermissionBroker│  │
│  │                 │  │  Registry        │  │               │  │
│  │ • ReActLoop     │  │                  │  │ • SyncCheck   │  │
│  │ • PlanExecute   │  │ • BuiltinTools   │  │ • AsyncAsk    │  │
│  │ • ExternalFw    │  │ • McpTools       │  │ • External    │  │
│  │ • RemoteDeleg   │  │ • PluginTools    │  │ • Bypass      │  │
│  └─────────────────┘  │ • UserDefined    │  └───────────────┘  │
│                        └──────────────────┘                     │
│  ┌─────────────────┐  ┌──────────────────┐                     │
│  │ ContextPolicy   │  │ PersistenceHook  │                     │
│  │                 │  │                  │                     │
│  │ • PruneOld      │  │ • DBWrite        │                     │
│  │ • SlidingWindow │  │ • EventDriven    │                     │
│  │ • External      │  │ • Noop           │                     │
│  └─────────────────┘  └──────────────────┘                     │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Phase 2: Agent Loop 中间件化拆分

### 2.1 ExecutionStrategy 抽象

**目标**：将 agent-loop.ts 的 while 循环抽取为可替换的执行策略。

**新增文件**: `src/lib/execution/types.ts`

```typescript
/**
 * 执行策略合约 — agent-loop 的 while 循环变成策略的一种实现。
 */
export interface ExecutionStrategy {
  readonly id: string;
  readonly displayName: string;

  /**
   * 执行一轮 Agent 交互。
   * 返回 ReadableStream<string>（SSE 行），与 AgentRuntime.stream() 输出合约一致。
   */
  execute(ctx: ExecutionContext): ReadableStream<string>;

  /** 中断当前执行 */
  interrupt(sessionId: string): void;

  /** 策略是否可用（依赖检查） */
  isAvailable(): boolean;
}

export interface ExecutionContext {
  // ── 输入 ──
  prompt: string;
  sessionId: string;
  messages: ModelMessage[];
  systemPrompt?: string;
  model: LanguageModel;
  modelId: string;

  // ── 能力注入 ──
  tools: ToolSet;
  permissionBroker: PermissionBroker;
  contextPolicy: ContextPolicy;
  persistence: PersistenceHook;

  // ── 控制 ──
  maxSteps: number;
  abortSignal: AbortSignal;
  emitSSE: (event: SSEEvent) => void;

  // ── 运行时选项（策略特有参数） ──
  strategyOptions?: Record<string, unknown>;
}
```

**内置策略实现**:

| 策略 ID | 文件 | 说明 |
|---------|------|------|
| `react-loop` | `execution/react-loop.ts` | 当前 agent-loop 的 while 循环原样迁移，行为不变 |
| `plan-execute` | `execution/plan-execute.ts` | 先规划步骤再逐步执行，适合复杂任务 |
| `external-framework` | `execution/external-framework.ts` | 委托给外部框架（通过子进程/HTTP），翻译输出为 SSE |
| `remote-delegate` | `execution/remote-delegate.ts` | 整体委托给远程 Agent API，流式转发响应 |

**迁移路径**：
1. 从 agent-loop.ts 提取 while 循环体为 `react-loop.ts`（纯重构，行为不变）
2. agent-loop.ts 变为薄壳：组装 ExecutionContext → 调用 strategy.execute()
3. 现有测试全部通过 = 迁移成功

### 2.2 ToolProvider 注册表

**目标**：将工具来源从硬编码 import 改为声明式注册。

**新增文件**: `src/lib/tools/tool-provider.ts`

```typescript
/**
 * 工具提供者合约 — 每个来源（内置、MCP、插件、用户自定义）实现此接口。
 */
export interface ToolProvider {
  readonly id: string;
  readonly displayName: string;
  /** 优先级（数字越小越先注册，同名工具后注册覆盖先注册） */
  readonly priority: number;

  /**
   * 返回此提供者贡献的工具集。
   * 可以是同步（内置工具）或异步（MCP 需要连接）。
   */
  provideTools(ctx: ToolProviderContext): Promise<ToolSet> | ToolSet;

  /** 此提供者贡献的 system prompt 片段 */
  provideSystemPrompts?(ctx: ToolProviderContext): string[];

  /** 是否在当前上下文可用 */
  isAvailable?(ctx: ToolProviderContext): boolean;
}

export interface ToolProviderContext {
  workingDirectory: string;
  sessionId?: string;
  prompt?: string;
  providerId?: string;
  model?: string;
  permissionMode?: string;
}
```

**注册表**: `src/lib/tools/tool-registry.ts`

```typescript
const providers = new Map<string, ToolProvider>();

export function registerToolProvider(provider: ToolProvider): void;
export function unregisterToolProvider(id: string): void;
export function getToolProviders(): ToolProvider[];

/**
 * 组装最终工具集 — 替代当前 assembleTools() 的硬编码逻辑。
 * 按 priority 排序，依次调用 provideTools()，合并结果。
 */
export async function assembleToolSet(ctx: ToolProviderContext): Promise<{
  tools: ToolSet;
  systemPrompts: string[];
}>;
```

**内置 Provider 迁移**:

| Provider ID | 来源 | 优先级 |
|-------------|------|--------|
| `builtin-coding` | 当前 `createBuiltinTools()` | 10 |
| `builtin-mcp` | 当前 `getBuiltinTools()` | 20 |
| `external-mcp` | 当前 `buildMcpToolSet()` | 30 |
| `plugin-agent` | 新增：插件 Agent 贡献的工具 | 50 |
| `user-defined` | 新增：用户配置文件定义的工具 | 90 |

### 2.3 PermissionBroker 统一接口

**目标**：统一三条权限路径（Native 同步、SDK 异步回调、Codex approval proposal）为一个接口。

**新增文件**: `src/lib/permission/broker.ts`

```typescript
/**
 * 权限代理合约 — 所有 Runtime 的权限检查统一走此接口。
 */
export interface PermissionBroker {
  readonly id: string;

  /**
   * 检查工具调用权限。
   * 返回 allow → 直接执行；deny → 拒绝；ask → 等待用户响应。
   */
  check(request: PermissionRequest): Promise<PermissionDecision>;

  /** 批量预检（用于 plan 模式过滤工具集） */
  filterTools?(toolNames: string[]): string[];
}

export interface PermissionRequest {
  toolName: string;
  toolInput: unknown;
  sessionId: string;
  /** 工具变更级别（safe_read / mutate / dangerous） */
  mutationLevel?: 'safe_read' | 'mutate' | 'dangerous';
}

export type PermissionDecision =
  | { action: 'allow' }
  | { action: 'deny'; reason: string }
  | { action: 'ask'; prompt: PermissionPrompt };

export interface PermissionPrompt {
  permissionRequestId: string;
  toolName: string;
  toolInput: unknown;
  description: string;
  /** 等待用户响应的 Promise（由具体实现决定如何阻塞） */
  waitForResponse: () => Promise<{
    behavior: 'allow' | 'deny';
    updatedInput?: unknown;
    message?: string;
  }>;
}
```

**内置实现**:

| Broker ID | 说明 |
|-----------|------|
| `rule-based` | 当前 permission-checker.ts 的规则引擎（explore/normal/trust） |
| `interactive-sse` | 当前 agent-tools.ts 的 SSE 弹窗等待逻辑 |
| `bypass` | bypassPermissions=true 时的全通过 |
| `external-approval` | 新增：委托给外部审批服务（HTTP webhook） |

**组合模式**：`CompositeBroker` 按链式调用，第一个非-ask 结果生效：

```typescript
export function createCompositeBroker(brokers: PermissionBroker[]): PermissionBroker {
  return {
    id: 'composite',
    async check(request) {
      for (const broker of brokers) {
        const decision = await broker.check(request);
        if (decision.action !== 'ask') return decision;
      }
      return { action: 'ask', prompt: /* last broker's prompt */ };
    },
  };
}
```

### 2.4 ContextPolicy 策略

**新增文件**: `src/lib/execution/context-policy.ts`

```typescript
/**
 * 上下文管理策略 — 控制消息历史如何裁剪以适应模型窗口。
 */
export interface ContextPolicy {
  readonly id: string;

  /**
   * 在每步执行前裁剪消息列表。
   * 当前实现: pruneOldToolResults()（保留最近 N 条工具结果）。
   */
  prune(messages: ModelMessage[], budget: TokenBudget): ModelMessage[];

  /** 估算当前消息列表的 token 数 */
  estimateTokens?(messages: ModelMessage[]): number;
}

export interface TokenBudget {
  contextWindow: number;
  reservedForOutput: number;
  reservedForSystem: number;
}
```

### 2.5 PersistenceHook

**新增文件**: `src/lib/execution/persistence-hook.ts`

```typescript
/**
 * 持久化钩子 — 将 agent-loop 中的 DB 写入从内联改为事件驱动。
 */
export interface PersistenceHook {
  readonly id: string;

  /** 工具调用完成时 */
  onToolCompleted?(event: ToolCompletedEvent): void | Promise<void>;

  /** 步骤完成时（token 统计） */
  onStepCompleted?(event: StepCompletedEvent): void | Promise<void>;

  /** 执行完成时（最终结果） */
  onRunCompleted?(event: RunCompletedEvent): void | Promise<void>;

  /** 执行失败时 */
  onRunFailed?(event: RunFailedEvent): void | Promise<void>;
}
```

---

## Phase 3: AgentOrchestrator 编排层

### 3.1 编排器合约

**新增文件**: `src/lib/orchestrator/types.ts`

```typescript
/**
 * Agent 编排器 — 决定"谁来做、怎么做、按什么顺序做"。
 * 位于 ExecutionStrategy 之上，负责多 Agent 场景的调度。
 */
export interface AgentOrchestrator {
  readonly id: string;
  readonly displayName: string;
  readonly mode: OrchestratorMode;

  /**
   * 编排一次完整的任务执行。
   * 内部可以调用多个 ExecutionStrategy / 多个 Agent 实例。
   */
  orchestrate(ctx: OrchestrationContext): ReadableStream<string>;

  interrupt(sessionId: string): void;
}

export type OrchestratorMode =
  | 'single'        // 单 Agent 直接执行（当前默认行为）
  | 'multi-role'    // 多角色协作（CrewAI 风格）
  | 'workflow'      // 工作流状态机（LangGraph 风格）
  | 'delegate';     // 整体委托给外部 Agent

export interface OrchestrationContext {
  prompt: string;
  sessionId: string;
  workingDirectory?: string;
  model: LanguageModel;
  modelId: string;
  systemPrompt?: string;
  abortSignal: AbortSignal;
  emitSSE: (event: SSEEvent) => void;

  /** 编排配置（从 AgentProfile 解析） */
  orchestrationConfig: OrchestrationConfig;

  /** 能力注入 */
  toolRegistry: ToolRegistry;
  permissionBroker: PermissionBroker;
  contextPolicy: ContextPolicy;
  persistence: PersistenceHook;
}
```

### 3.2 编排模式实现

#### Single Orchestrator（默认，等价当前行为）

```typescript
// orchestrator/single.ts
export const singleOrchestrator: AgentOrchestrator = {
  id: 'single',
  displayName: 'Single Agent',
  mode: 'single',
  orchestrate(ctx) {
    const strategy = resolveStrategy(ctx.orchestrationConfig.strategyId);
    const execCtx = buildExecutionContext(ctx);
    return strategy.execute(execCtx);
  },
  interrupt(sessionId) { /* forward to strategy */ },
};
```

#### Multi-Role Orchestrator（CrewAI 风格）

```typescript
// orchestrator/multi-role.ts
export interface RoleDefinition {
  id: string;
  name: string;
  role: string;           // 角色描述（注入 system prompt）
  goal: string;           // 角色目标
  strategyId: string;     // 此角色使用的执行策略
  toolProviderIds: string[]; // 此角色可用的工具来源
  maxSteps?: number;
}

export interface MultiRoleConfig {
  roles: RoleDefinition[];
  /** 协作模式: sequential（接力）| parallel（并行汇总）| debate（辩论） */
  collaboration: 'sequential' | 'parallel' | 'debate';
  /** 汇总策略（parallel/debate 模式下） */
  synthesis?: { strategyId: string; prompt: string };
}
```

#### Workflow Orchestrator（LangGraph 风格）

```typescript
// orchestrator/workflow.ts
export interface WorkflowNode {
  id: string;
  type: 'agent' | 'condition' | 'transform' | 'human-in-loop';
  /** agent 节点: 执行策略 + 工具 */
  agentConfig?: { strategyId: string; toolProviderIds: string[]; prompt: string };
  /** condition 节点: 路由条件 */
  condition?: { expression: string; branches: Record<string, string> };
  /** transform 节点: 数据变换 */
  transform?: { type: 'extract' | 'summarize' | 'format'; config: unknown };
}

export interface WorkflowEdge {
  from: string;
  to: string;
  /** 条件边: 仅当条件满足时走此路径 */
  condition?: string;
}

export interface WorkflowConfig {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  entryNode: string;
  /** 全局超时（秒） */
  timeoutSec?: number;
}
```

#### Delegate Orchestrator（远程委托）

```typescript
// orchestrator/delegate.ts
export interface DelegateConfig {
  /** 远程 Agent 服务端点 */
  endpoint: string;
  /** 认证方式 */
  auth: { type: 'bearer' | 'api-key' | 'oauth2'; credential: string };
  /** 协议: openai-responses | a2a | custom */
  protocol: 'openai-responses' | 'a2a' | 'custom';
  /** 是否流式 */
  streaming: boolean;
  /** 超时 */
  timeoutSec: number;
  /** 输出翻译器（将远程响应翻译为 SSE 事件） */
  outputTranslator?: string;
}
```

### 3.3 AgentProfile — 声明式 Agent 定义

**新增文件**: `src/lib/orchestrator/agent-profile.ts`

```typescript
/**
 * AgentProfile — 用户可配置的 Agent 完整定义。
 * 可通过 Settings UI / 配置文件 / API 注册。
 */
export interface AgentProfile {
  id: string;
  displayName: string;
  description: string;
  version: string;

  /** 编排模式 */
  orchestrator: OrchestratorMode;

  /** 执行策略（single 模式下直接使用） */
  strategyId: string;
  strategyOptions?: Record<string, unknown>;

  /** 工具配置 */
  toolProviderIds: string[];
  /** 额外工具定义（内联，用于简单场景） */
  inlineTools?: InlineToolDefinition[];

  /** 提示词 */
  systemPrompt?: string;
  promptTemplate?: string;  // 支持 {{prompt}} {{context}} 变量

  /** 权限配置 */
  permissionMode?: PermissionMode;
  permissionBrokerId?: string;

  /** 上下文策略 */
  contextPolicyId?: string;

  /** 多角色配置（multi-role 模式） */
  multiRole?: MultiRoleConfig;

  /** 工作流配置（workflow 模式） */
  workflow?: WorkflowConfig;

  /** 委托配置（delegate 模式） */
  delegate?: DelegateConfig;

  /** 模型偏好 */
  model?: string;
  providerId?: string;

  /** 约束 */
  maxSteps?: number;
  timeoutSec?: number;
}

export interface InlineToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;  // JSON Schema
  /** 执行方式: shell | http | script */
  execute: {
    type: 'shell' | 'http' | 'script';
    command?: string;   // shell
    url?: string;       // http
    script?: string;    // script (sandboxed JS)
  };
}
```

### 3.4 Profile 注册与解析

**新增文件**: `src/lib/orchestrator/profile-registry.ts`

```typescript
const profiles = new Map<string, AgentProfile>();

/** 注册 AgentProfile（内置 + 用户自定义） */
export function registerProfile(profile: AgentProfile): void;

/** 按 ID 获取 */
export function getProfile(id: string): AgentProfile | undefined;

/** 列出所有可用 Profile */
export function listProfiles(): AgentProfile[];

/**
 * 从 Profile 构建完整的编排上下文。
 * 解析 strategyId → ExecutionStrategy 实例
 * 解析 toolProviderIds → ToolSet
 * 解析 permissionBrokerId → PermissionBroker 实例
 */
export function resolveProfile(
  profile: AgentProfile,
  ctx: OrchestrationContext,
): ResolvedOrchestration;
```

### 3.5 与现有 Runtime 层的集成

**关键约束**：`AgentRuntime.stream()` 合约不变。插件化改造发生在 native-runtime 内部。

```typescript
// native-runtime.ts 改造后的核心逻辑
export const nativeRuntime: AgentRuntime = {
  id: 'native',
  stream(options: RuntimeStreamOptions): ReadableStream<string> {
    // 1. 解析 AgentProfile（从 runtimeOptions 或 session 配置）
    const profile = resolveAgentProfile(options);

    // 2. 构建编排上下文
    const orchCtx = buildOrchestrationContext(options, profile);

    // 3. 选择编排器
    const orchestrator = resolveOrchestrator(profile.orchestrator);

    // 4. 执行
    return orchestrator.orchestrate(orchCtx);
  },
  // ...
};
```

**对 SDK Runtime 和 Codex Runtime 的影响**：零。它们继续走自己的路径。插件化只改 native-runtime 的内部实现。

---

## Phase 4: 用户配置与 UI

### 4.1 配置文件格式

用户可在项目根目录放置 `.codepilot/agents.json`：

```json
{
  "agents": [
    {
      "id": "code-reviewer",
      "displayName": "Code Reviewer",
      "orchestrator": "single",
      "strategyId": "react-loop",
      "toolProviderIds": ["builtin-coding"],
      "systemPrompt": "You are a senior code reviewer...",
      "permissionMode": "explore",
      "maxSteps": 20
    },
    {
      "id": "research-team",
      "displayName": "Research Team",
      "orchestrator": "multi-role",
      "multiRole": {
        "roles": [
          { "id": "searcher", "role": "Web researcher", "strategyId": "react-loop", "toolProviderIds": ["builtin-coding", "external-mcp"] },
          { "id": "analyst", "role": "Data analyst", "strategyId": "react-loop", "toolProviderIds": ["builtin-coding"] }
        ],
        "collaboration": "sequential"
      }
    },
    {
      "id": "remote-agent",
      "displayName": "Remote Agent",
      "orchestrator": "delegate",
      "delegate": {
        "endpoint": "https://my-agent.example.com/v1/responses",
        "auth": { "type": "bearer", "credential": "${REMOTE_AGENT_TOKEN}" },
        "protocol": "openai-responses",
        "streaming": true,
        "timeoutSec": 300
      }
    }
  ]
}
```

### 4.2 Settings UI 集成

在现有 Settings 页面新增 "Agent Profiles" 面板：
- 列出所有已注册 Profile（内置 + 用户自定义）
- 支持创建/编辑/删除自定义 Profile
- 支持在 Chat Composer 的 Runtime 选择器中选择 Profile
- 支持 per-session pin（复用现有 `runtime_pin` 机制）

### 4.3 API 端点

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/agents/profiles` | GET | 列出所有 AgentProfile |
| `/api/agents/profiles` | POST | 创建自定义 Profile |
| `/api/agents/profiles/:id` | PUT | 更新 Profile |
| `/api/agents/profiles/:id` | DELETE | 删除 Profile |
| `/api/agents/providers` | GET | 列出已注册的 ToolProvider |
| `/api/agents/strategies` | GET | 列出可用的 ExecutionStrategy |

---

## 数据库变更

新增 1 张表（`src/lib/db.ts`）：

```sql
CREATE TABLE IF NOT EXISTS agent_profiles (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  description TEXT DEFAULT '',
  profile_json TEXT NOT NULL,  -- 完整 AgentProfile JSON
  source TEXT DEFAULT 'user',  -- 'builtin' | 'user' | 'project'
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
```

---

## 分阶段交付计划

### Stage 1: 基础抽象层（~3 天）

- [ ] 定义 `ExecutionStrategy` 接口 + `ExecutionContext`
- [ ] 定义 `ToolProvider` 接口 + `ToolRegistry`
- [ ] 定义 `PermissionBroker` 接口 + `CompositeBroker`
- [ ] 定义 `ContextPolicy` 接口
- [ ] 定义 `PersistenceHook` 接口
- [ ] 单元测试：接口合约测试（mock 实现）

### Stage 2: React-Loop 迁移（~2 天）

- [ ] 从 agent-loop.ts 提取 while 循环为 `execution/react-loop.ts`
- [ ] agent-loop.ts 变为薄壳（组装 context → 调用 strategy）
- [ ] 将 `assembleTools()` 迁移为 `BuiltinToolProvider` + `McpToolProvider`
- [ ] 将 `wrapWithPermissions()` 迁移为 `InteractiveSseBroker`
- [ ] 将 `pruneOldToolResults()` 迁移为 `PruneOldPolicy`
- [ ] 回归测试：`npm run test` 全部通过，行为不变

### Stage 3: 编排器骨架（~3 天）

- [ ] 定义 `AgentOrchestrator` 接口 + `OrchestrationContext`
- [ ] 实现 `SingleOrchestrator`（默认，等价当前行为）
- [ ] 定义 `AgentProfile` + `ProfileRegistry`
- [ ] native-runtime.ts 集成：stream() → resolveProfile → orchestrate
- [ ] 回归测试：现有功能不受影响

### Stage 4: 外部框架接入（~3 天）

- [ ] 实现 `ExternalFrameworkStrategy`（子进程 + stdout 翻译）
- [ ] 实现 `RemoteDelegateStrategy`（HTTP 流式转发）
- [ ] 实现 `DelegateOrchestrator`
- [ ] 集成测试：接入一个示例外部 Agent（如 OpenAI Assistants API）

### Stage 5: 多 Agent 编排（~4 天）

- [ ] 实现 `MultiRoleOrchestrator`（sequential / parallel）
- [ ] 实现 `WorkflowOrchestrator`（状态机执行）
- [ ] 工作流条件路由 + human-in-loop 节点
- [ ] 集成测试：多角色协作场景

### Stage 6: 用户配置 + UI（~3 天）

- [ ] DB 表 `agent_profiles` + CRUD API
- [ ] `.codepilot/agents.json` 项目级配置解析
- [ ] Settings UI: Agent Profiles 面板
- [ ] Chat Composer: Profile 选择器
- [ ] E2E 测试：创建自定义 Profile → 使用 → 验证输出

---

## 风险与缓解

| 风险 | 影响 | 缓解 |
|------|------|------|
| agent-loop 迁移引入回归 | 所有 Native 用户 | Stage 2 纯重构 + 现有测试全覆盖；逐函数提取，每步跑测试 |
| 外部框架输出格式不统一 | 翻译层复杂 | 定义 SSE 翻译器接口，每个框架一个适配器；先支持 OpenAI Responses 协议 |
| 多 Agent 编排的 token 爆炸 | 成本失控 | 每个角色独立 token 预算 + 全局预算上限；ContextPolicy 强制裁剪 |
| 权限系统统一后行为变化 | 安全回归 | CompositeBroker 保持现有规则引擎为第一层；新增回归测试覆盖 explore/normal/trust |
| 工作流死循环 | 任务卡死 | 全局 timeout + 节点访问计数 + 最大步数硬限制 |

---

## 决策日志

| 日期 | 决策 | 理由 |
|------|------|------|
| 2026-07-23 | 插件化只改 native-runtime 内部 | SDK/Codex Runtime 有各自的上游合约，不应被本地重构影响 |
| 2026-07-23 | ExecutionStrategy 输出仍为 SSE ReadableStream | 保持前端零改动；所有策略的输出都经过同一个 SSE 合约 |
| 2026-07-23 | AgentProfile 用 JSON 声明式定义 | 降低用户配置门槛；可序列化存 DB；可版本控制 |
| 2026-07-23 | 权限用 CompositeBroker 链式组合 | 保持现有规则引擎不变，新增能力通过追加 broker 实现 |
| 2026-07-23 | 先做 Phase 2 再做 Phase 3 | Phase 2 是 Phase 3 的前置依赖；且 Phase 2 独立可交付价值 |

---

## 文件结构预览

```
src/lib/
├── execution/                    # 新增：执行策略层
│   ├── types.ts                  # ExecutionStrategy + ExecutionContext
│   ├── react-loop.ts             # 从 agent-loop.ts 迁移的 while 循环
│   ├── plan-execute.ts           # 规划-执行策略
│   ├── external-framework.ts     # 外部框架委托
│   ├── remote-delegate.ts        # 远程 Agent 委托
│   ├── context-policy.ts         # ContextPolicy 接口 + 内置实现
│   └── persistence-hook.ts       # PersistenceHook 接口 + 内置实现
├── tools/
│   ├── tool-provider.ts          # 新增：ToolProvider 接口
│   ├── tool-registry.ts          # 新增：Provider 注册表 + assembleToolSet
│   ├── agent.ts                  # 现有：AgentTool（子 Agent 派生）
│   └── ...                       # 现有工具实现不变
├── permission/
│   ├── broker.ts                 # 新增：PermissionBroker 接口
│   ├── composite.ts              # 新增：CompositeBroker
│   ├── rule-based.ts             # 从 permission-checker.ts 迁移
│   └── interactive-sse.ts        # 从 agent-tools.ts 迁移
├── orchestrator/                 # 新增：编排层
│   ├── types.ts                  # AgentOrchestrator + OrchestrationContext
│   ├── single.ts                 # 单 Agent 编排（默认）
│   ├── multi-role.ts             # 多角色协作
│   ├── workflow.ts               # 工作流状态机
│   ├── delegate.ts               # 远程委托
│   ├── agent-profile.ts          # AgentProfile 定义
│   └── profile-registry.ts       # Profile 注册与解析
├── agent-loop.ts                 # 改造为薄壳（组装 → 委托）
├── agent-tools.ts                # 改造为 ToolProvider 适配层
├── permission-checker.ts         # 保留，被 rule-based broker 包装
└── ...
```
