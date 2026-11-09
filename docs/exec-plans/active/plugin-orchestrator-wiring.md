# 插件化编排系统 — 接线执行方案

> **状态**: Ready for implementation
> **分支**: `feat/plugin-agent-orchestrator`
> **创建**: 2026-07-28
> **前置**: [plugin-agent-orchestrator.md](./plugin-agent-orchestrator.md)（架构设计）

## 问题陈述

Stage 1 抽象层（25 个新文件）已完成，但完全孤立——没有任何现有代码 import 新模块，注册表 side-effect 永远不触发，应用行为零变化。需要将新架构"接入"运行时，使其成为实际执行路径。

## 核心约束

- `AgentRuntime.stream()` 外部合约不变（SSE ReadableStream）
- 现有三个 Runtime（native / sdk / codex）行为不受影响
- 每个 Phase 独立可交付、可回滚
- 每步改动后 `npm run test` 必须通过

---

## Phase A: 最小接线（激活链路，行为不变）

**目标**: native-runtime → orchestrator → reactLoopStrategy → agent-loop，全链路激活但行为等价。

**预计工作量**: 1.5 天

### A1. 补齐 OrchestrationContext 缺失字段

当前 `OrchestrationContext` 缺少 native-runtime 需要传递的字段。

**文件**: `src/lib/orchestrator/types.ts`

```typescript
export interface OrchestrationContext {
  // ... 现有字段 ...

  // ── 新增：native-runtime 透传字段 ──
  callScene: ProviderCallScene;
  providerId?: string;
  sessionProviderId?: string;
  bypassPermissions?: boolean;
  mcpServers?: Record<string, MCPServerConfig>;
  files?: FileAttachment[];
  onRuntimeStatusChange?: (status: string) => void;
}
```

**验证**: typecheck 通过。

### A2. 补齐 ExecutionContext 缺失字段

**文件**: `src/lib/execution/types.ts`

```typescript
export interface ExecutionContext {
  // ... 现有字段 ...

  // ── 新增：react-loop 委托所需 ──
  callScene?: ProviderCallScene;
  providerId?: string;
  sessionProviderId?: string;
  bypassPermissions?: boolean;
  mcpServers?: Record<string, MCPServerConfig>;
  files?: FileAttachment[];
}
```

**验证**: typecheck 通过。

### A3. native-runtime 接入编排器

**文件**: `src/lib/runtime/native-runtime.ts`

改造 `stream()` 方法，从直接调用 `runAgentLoop()` 改为走编排器路径：

```typescript
import { resolveProfile, DEFAULT_PROFILE } from '../orchestrator/agent-profile';
import { resolveOrchestrator } from '../orchestrator/types';
import { createCompositeBroker, bypassBroker } from '../permission';
import { createRuleBasedBroker } from '../permission/rule-based';
import { createInteractiveSseBroker } from '../permission/interactive-sse';
// 触发 provider 注册 side-effect
import '../tools/providers';
import '../execution/react-loop';

stream(options: RuntimeStreamOptions): ReadableStream<string> {
  const cwd = options.workingDirectory || process.cwd();
  const abortController = options.abortController || new AbortController();
  // ... 现有 activeControllers 跟踪逻辑不变 ...

  // 1. 解析 AgentProfile（当前阶段始终为 DEFAULT_PROFILE）
  const profile = resolveAgentProfile(options);

  // 2. 构建 PermissionBroker
  const permissionBroker = buildPermissionBroker(options, abortController);

  // 3. 构建 OrchestrationContext
  const orchCtx: OrchestrationContext = {
    prompt: options.prompt,
    sessionId: options.sessionId,
    workingDirectory: cwd,
    model: null as never,      // react-loop 内部自行 resolve，此阶段传空
    modelId: options.model || '',
    systemPrompt: buildSystemPrompt({ userPrompt: options.systemPrompt, workingDirectory: cwd, modelId: options.model }),
    abortSignal: abortController.signal,
    emitSSE: () => {},         // react-loop 委托 agent-loop 内部 emit，此阶段 no-op
    profile,
    permissionBroker,
    contextPolicy: resolveContextPolicy(profile.contextPolicyId),
    persistence: resolvePersistenceHook('db'),
    // 透传字段
    callScene: options.callScene,
    providerId: options.providerId,
    sessionProviderId: options.sessionProviderId,
    bypassPermissions: options.bypassPermissions,
    mcpServers: options.mcpServers,
    files: (options.runtimeOptions as any)?.files,
    onRuntimeStatusChange: options.onRuntimeStatusChange,
    thinking: options.thinking,
    effort: options.effort,
    context1m: options.context1m,
    temperature: options.temperature,
    topP: options.topP,
    topK: options.topK,
  };

  // 4. 选择编排器并执行
  const orchestrator = resolveOrchestrator(profile.orchestrator);
  const stream = orchestrator.orchestrate(orchCtx);

  // 5. 包装 cleanup 逻辑（现有 activeControllers.delete 等）
  return wrapWithCleanup(stream, sessionId, abortController);
}
```

**辅助函数**:

```typescript
function resolveAgentProfile(options: RuntimeStreamOptions): AgentProfile {
  // Phase A: 始终返回 DEFAULT_PROFILE
  // Phase C+: 从 runtimeOptions.agentProfileId 或 session 配置解析
  return DEFAULT_PROFILE;
}

function buildPermissionBroker(options: RuntimeStreamOptions, ac: AbortController): PermissionBroker {
  if (options.bypassPermissions) return bypassBroker;

  const ruleBased = createRuleBasedBroker(
    (options.permissionMode || 'normal') as PermissionMode
  );
  // interactive-sse 需要 emitSSE，但 Phase A 的 react-loop 内部自行处理权限弹窗
  // 所以这里只传 rule-based，agent-loop 内部的 wrapWithPermissions 仍然生效
  return ruleBased;
}
```

**关键设计决策**: Phase A 中 `emitSSE` 传 no-op、`model` 传空、`permissionBroker` 只用于 future-proof——因为 reactLoopStrategy 完全委托给 `runAgentLoop()`，后者内部自行处理模型解析、工具组装、权限弹窗、SSE 输出。编排器层在此阶段是"透明管道"。

### A4. reactLoopStrategy 补齐透传字段

**文件**: `src/lib/execution/react-loop.ts`

将 `ExecutionContext` 中新增的字段正确传递给 `runAgentLoop()`：

```typescript
execute(ctx: ExecutionContext): ReadableStream<string> {
  const { runAgentLoop } = require('../agent-loop');

  const controller = new AbortController();
  // link ctx.abortSignal → controller
  if (ctx.abortSignal.aborted) controller.abort();
  else ctx.abortSignal.addEventListener('abort', () => controller.abort(), { once: true });

  const stream = runAgentLoop({
    prompt: ctx.prompt,
    callScene: ctx.callScene || 'chat',
    sessionId: ctx.sessionId,
    providerId: ctx.providerId,
    sessionProviderId: ctx.sessionProviderId,
    model: ctx.modelId || undefined,
    systemPrompt: ctx.systemPrompt,
    workingDirectory: ctx.workingDirectory,
    abortController: controller,
    permissionMode: undefined,       // agent-loop 内部处理
    bypassPermissions: ctx.bypassPermissions,
    mcpServers: ctx.mcpServers,
    thinking: ctx.thinking,
    effort: ctx.effort,
    context1m: ctx.context1m,
    temperature: ctx.temperature,
    topP: ctx.topP,
    topK: ctx.topK,
    maxSteps: ctx.maxSteps,
    autoTrigger: ctx.autoTrigger,
    onRuntimeStatusChange: ctx.onRuntimeStatusChange,
    files: ctx.files,
  });

  // ... 现有 tracking + cleanup 逻辑 ...
  return stream;
}
```

### A5. singleOrchestrator 适配 Phase A 模式

**文件**: `src/lib/orchestrator/single.ts`

当前 `singleOrchestrator` 在 `start()` 中做了工具组装和消息加载，但 react-loop 会忽略这些（agent-loop 内部重做）。Phase A 需要让 singleOrchestrator 识别"委托模式"并跳过无用工作：

```typescript
orchestrate(ctx: OrchestrationContext): ReadableStream<string> {
  const profile = ctx.profile;
  const strategy = resolveStrategy(profile.strategyId);

  // Phase A 快速路径：react-loop 委托模式，跳过工具组装和消息加载
  // （agent-loop 内部自行完成这些工作）
  if (strategy.id === 'react-loop') {
    const execCtx = buildDelegationContext(ctx, profile);
    return strategy.execute(execCtx);
  }

  // Phase B+ 完整路径：编排器组装依赖，策略使用注入的上下文
  return new ReadableStream<string>({
    async start(controller) {
      const toolResult = await assembleToolSet(/* ... */);
      const messages = buildMessages(ctx);
      const execCtx = buildFullExecutionContext(ctx, profile, toolResult, messages);
      const stream = strategy.execute(execCtx);
      // pipe stream → controller
    }
  });
}

function buildDelegationContext(ctx: OrchestrationContext, profile: AgentProfile): ExecutionContext {
  return {
    prompt: ctx.prompt,
    sessionId: ctx.sessionId,
    messages: [],  // unused in delegation mode
    systemPrompt: ctx.systemPrompt,
    model: ctx.model,
    modelId: ctx.modelId,
    tools: {} as ToolSet,  // unused
    permissionBroker: ctx.permissionBroker,
    contextPolicy: ctx.contextPolicy,
    persistence: ctx.persistence,
    maxSteps: profile.maxSteps ?? 50,
    abortSignal: ctx.abortSignal,
    emitSSE: ctx.emitSSE,
    workingDirectory: ctx.workingDirectory,
    // 透传
    callScene: ctx.callScene,
    providerId: ctx.providerId,
    sessionProviderId: ctx.sessionProviderId,
    bypassPermissions: ctx.bypassPermissions,
    mcpServers: ctx.mcpServers,
    files: ctx.files,
    thinking: ctx.thinking,
    effort: ctx.effort,
    context1m: ctx.context1m,
    temperature: ctx.temperature,
    topP: ctx.topP,
    topK: ctx.topK,
    autoTrigger: ctx.autoTrigger,
    onRuntimeStatusChange: ctx.onRuntimeStatusChange,
    strategyOptions: profile.strategyOptions,
  };
}
```

### A6. 注册表激活（side-effect imports）

确保以下模块在应用启动时被加载，触发注册：

**文件**: `src/lib/orchestrator/index.ts`（或新建 `src/lib/plugin-bootstrap.ts`）

```typescript
// 触发所有注册 side-effect
import './single';                    // registerOrchestrator(singleOrchestrator)
import '../execution/react-loop';     // registerStrategy(reactLoopStrategy)
import '../tools/providers';          // registerToolProvider × 3
import '../execution/context-policy'; // registerContextPolicy × 3
import '../execution/persistence-hook'; // registerPersistenceHook × 2
```

native-runtime.ts 顶部 import 此文件即可。

### A7. 验证

- [ ] `npm run test` 全部通过（typecheck + 单元测试）
- [ ] 手动验证：启动 dev server，发送一条消息，确认 SSE 流正常输出
- [ ] 确认 agent-loop.ts 零改动（纯接线，不改内部逻辑）
- [ ] 确认 sdk-runtime / codex-runtime 不受影响

### A8. 回滚方案

如果接线后出现问题，只需在 native-runtime.ts 中恢复直接调用 `runAgentLoop()` 的旧路径。新模块保持存在但不被 import，等价于当前状态。

可以加一个 feature flag 做 A/B：

```typescript
const USE_ORCHESTRATOR = process.env.CODEPILOT_ORCHESTRATOR !== '0';

stream(options) {
  if (USE_ORCHESTRATOR) {
    return this.streamViaOrchestrator(options);
  }
  return this.streamLegacy(options);  // 原有路径
}
```

---

## Phase B: 消除双重工作（react-loop 使用注入依赖）

**目标**: react-loop 不再委托 agent-loop，而是直接使用 ExecutionContext 中注入的 tools/messages/permissionBroker/contextPolicy/persistence。agent-loop.ts 退化为历史参考。

**前置**: Phase A 稳定运行 1+ 周，无回归。

**预计工作量**: 3-4 天

### B1. 模型解析上提

将 `createModel()` 调用从 agent-loop 移到 native-runtime（或 singleOrchestrator）：

```typescript
// singleOrchestrator.orchestrate() 中
const { languageModel, modelId, config } = await createModel({
  callScene: ctx.callScene,
  providerId: ctx.providerId,
  sessionProviderId: ctx.sessionProviderId,
  model: ctx.modelId || undefined,
});
execCtx.model = languageModel;
execCtx.modelId = modelId;
```

### B2. 工具组装生效

singleOrchestrator 已经调用 `assembleToolSet()`。Phase B 中 react-loop 直接使用 `ctx.tools`：

```typescript
// react-loop execute() 中
const result = streamText({
  model: ctx.model,
  instructions: ctx.systemPrompt,
  messages: ctx.messages,
  tools: ctx.tools,           // ← 使用注入的工具集
  // ...
});
```

### B3. 权限走 PermissionBroker

工具不再由 agent-loop 的 `wrapWithPermissions()` 包装。改为：

- `assembleToolSet()` 返回原始工具（不含权限包装）
- react-loop 在执行工具前调用 `ctx.permissionBroker.check()`
- 或者在 tool-registry 层增加一个 `PermissionWrappingProvider`（priority 99），对组装后的工具集做权限包装

推荐后者——保持 react-loop 简洁：

```typescript
// tools/providers/permission-wrapper.ts
export const permissionWrapperProvider: ToolProvider = {
  id: 'permission-wrapper',
  displayName: 'Permission Wrapper',
  priority: 99,  // 最后执行，包装所有已注册工具
  provideTools(ctx) {
    // 获取已组装的工具，用 PermissionBroker 包装
    // 需要 broker 实例——通过 ctx 传入
  }
};
```

### B4. 上下文裁剪走 ContextPolicy

react-loop while 循环中：

```typescript
// 替代 pruneOldToolResults(messages)
const prunedMessages = ctx.contextPolicy.prune(messages, tokenBudget);
```

### B5. 持久化走 PersistenceHook

react-loop 中 DB 写入改为事件驱动：

```typescript
// 替代内联 updateMessage / insertMessage
await ctx.persistence.onToolCompleted({ sessionId, toolName, result, durationMs });
await ctx.persistence.onStepCompleted({ sessionId, step, usage });
```

`dbPersistence` 从 stub 变为真实实现（吸收 agent-loop 中的 DB 逻辑）。

### B6. SSE 输出走 emitSSE

react-loop 不再直接 `controller.enqueue(formatSSE(...))`，改为 `ctx.emitSSE(event)`。singleOrchestrator 提供真实的 emitSSE 回调（写入 ReadableStream controller）。

### B7. agent-loop.ts 退役

当 react-loop 完全自包含后：
- agent-loop.ts 标记 `@deprecated`
- 保留文件但不再被 import
- 下一个 minor 版本删除

### B8. 验证

- [ ] `npm run test` 全部通过
- [ ] 新增单元测试：react-loop 使用 mock 依赖的完整执行流程
- [ ] 新增单元测试：PermissionBroker 链式调用（rule-based → interactive-sse）
- [ ] 新增单元测试：ContextPolicy 裁剪行为
- [ ] 手动 E2E：多轮对话、工具调用、权限弹窗、中断、超时
- [ ] 性能对比：确认无额外 DB 查询或模型调用

---

## Phase C: 增量扩展（新编排器 + 用户配置）

**前置**: Phase B 完成，react-loop 完全自包含。

### C1. DelegateOrchestrator（远程委托）— 2 天

```typescript
// orchestrator/delegate.ts
export const delegateOrchestrator: AgentOrchestrator = {
  id: 'delegate',
  mode: 'delegate',
  orchestrate(ctx) {
    const config = ctx.profile.delegate!;
    // HTTP 流式请求 → 翻译响应为 SSE 事件
    return streamFromRemoteAgent(config, ctx);
  }
};
```

关键子任务：
- 实现 OpenAI Responses 协议的流式客户端
- 实现 A2A 协议的流式客户端
- 输出翻译器：远程响应 → SSEEvent 映射
- 超时 + 重试 + 错误分类

### C2. MultiRoleOrchestrator（多角色协作）— 3 天

```typescript
// orchestrator/multi-role.ts
// sequential: role1.execute() → 输出注入 role2.prompt → role2.execute()
// parallel: Promise.all(roles.map(r => r.execute())) → synthesis.execute()
```

关键子任务：
- 角色间消息传递协议
- 独立 token 预算 per role
- 并行模式的 stream 合并（interleave SSE 事件，带 role 标签）

### C3. WorkflowOrchestrator（工作流状态机）— 3 天

关键子任务：
- 图执行引擎（拓扑排序 + 条件路由）
- human-in-loop 节点（暂停 → SSE 通知 → 等待用户输入 → 恢复）
- 死循环检测（节点访问计数 + 全局 timeout）

### C4. 用户配置层 — 2 天

- DB 表 `agent_profiles` + CRUD
- `.codepilot/agents.json` 解析
- API 端点 `/api/agents/profiles`
- native-runtime 中 `resolveAgentProfile()` 支持按 ID 加载

### C5. Settings UI — 2 天

- Agent Profiles 面板（列表 / 创建 / 编辑 / 删除）
- Chat Composer 中的 Profile 选择器
- 复用现有 `runtime_pin` 机制做 per-session pin

### C6. 验证

- [ ] 集成测试：DelegateOrchestrator 对接 mock HTTP server
- [ ] 集成测试：MultiRole sequential 两角色协作
- [ ] E2E：用户创建自定义 Profile → 选择 → 执行 → 验证输出
- [ ] E2E：工作流 human-in-loop 节点暂停/恢复

---

## 测试策略

### Phase A 测试（接线正确性）

| 测试类型 | 内容 | 文件 |
|---------|------|------|
| 单元测试 | resolveOrchestrator('single') 返回 singleOrchestrator | `__tests__/orchestrator-registry.test.ts` |
| 单元测试 | resolveStrategy('react-loop') 返回 reactLoopStrategy | `__tests__/execution-registry.test.ts` |
| 单元测试 | assembleToolSet 按优先级合并 | `__tests__/tool-registry.test.ts` |
| 单元测试 | CompositeBroker 链式决策 | `__tests__/permission-composite.test.ts` |
| 集成测试 | native-runtime.stream() 走编排器路径输出 SSE | `__tests__/native-runtime-orchestrator.test.ts` |

### Phase B 测试（行为等价性）

| 测试类型 | 内容 |
|---------|------|
| 回归测试 | 现有 agent-loop 测试全部迁移到 react-loop |
| 单元测试 | react-loop 使用 mock model 完成 3 步工具调用 |
| 单元测试 | PermissionBroker ask → 等待 → allow 流程 |
| 单元测试 | ContextPolicy 在 token 超限时裁剪 |
| 单元测试 | PersistenceHook 收到正确事件序列 |

---

## 风险与缓解

| 风险 | 概率 | 影响 | 缓解 |
|------|------|------|------|
| Phase A 接线引入微妙行为差异 | 中 | 高 | Feature flag 双路径；对比测试（同一输入走两条路径，diff 输出） |
| react-loop 透传字段遗漏 | 中 | 中 | 逐字段对照 AgentLoopOptions 类型；typecheck 强制 |
| Phase B 权限行为变化 | 低 | 高 | CompositeBroker 第一层始终是 rule-based（等价现有逻辑）；回归测试覆盖 explore/normal/trust |
| 注册表 side-effect 加载顺序 | 低 | 中 | 显式 import 顺序 + 启动时 assert 注册表非空 |
| 循环依赖（orchestrator ↔ execution ↔ tools） | 中 | 中 | 保持 lazy require 模式；接口文件不 import 实现 |

---

## 文件变更清单

### Phase A（新增/修改）

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/lib/orchestrator/types.ts` | 修改 | 补齐 OrchestrationContext 字段 |
| `src/lib/execution/types.ts` | 修改 | 补齐 ExecutionContext 字段 |
| `src/lib/runtime/native-runtime.ts` | 修改 | stream() 走编排器路径 |
| `src/lib/execution/react-loop.ts` | 修改 | 补齐透传字段 |
| `src/lib/orchestrator/single.ts` | 修改 | 增加委托模式快速路径 |
| `src/lib/orchestrator/index.ts` | 修改 | 增加 side-effect imports |
| `src/__tests__/orchestrator-registry.test.ts` | 新增 | 注册表测试 |
| `src/__tests__/tool-registry.test.ts` | 新增 | 工具组装测试 |
| `src/__tests__/permission-composite.test.ts` | 新增 | 权限链测试 |

### Phase B（新增/修改）

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/lib/execution/react-loop.ts` | 重写 | 自包含 while 循环，使用注入依赖 |
| `src/lib/execution/persistence-hook.ts` | 修改 | dbPersistence 真实实现 |
| `src/lib/tools/providers/permission-wrapper.ts` | 新增 | 权限包装 Provider |
| `src/lib/orchestrator/single.ts` | 修改 | 完整路径（模型解析 + 工具组装 + 消息加载） |
| `src/lib/agent-loop.ts` | 标记废弃 | 不再被 import |

---

## 时间线

```
Week 1:  Phase A（接线 + 测试 + 手动验证）
Week 2:  Phase A 稳定观察 + Phase B 前半（模型上提 + 工具注入）
Week 3:  Phase B 后半（权限/裁剪/持久化迁移 + agent-loop 退役）
Week 4+: Phase C 按需推进（Delegate → MultiRole → Workflow → UI）
```

---

## 决策记录

| 日期 | 决策 | 理由 |
|------|------|------|
| 2026-07-28 | Phase A 用 feature flag 双路径 | 零风险回滚；可对比两条路径的 SSE 输出 |
| 2026-07-28 | react-loop Phase A 保持委托模式 | 避免同时改接线 + 改实现，降低回归风险 |
| 2026-07-28 | 权限包装放 ToolProvider 层而非 react-loop 内 | 保持执行策略简洁；权限是横切关注点，应在组装阶段处理 |
| 2026-07-28 | Phase B 前需要 1 周稳定期 | 确认 Phase A 无微妙回归后再动 agent-loop 内部 |
