## CodePilot Agent 能力拆分与自由替换可行性分析

### 一、当前架构的 Agent 能力全景

CodePilot 的 Agent 处理能力分布在五个层次，从外到内依次为：

**Runtime 层（执行引擎）** — 通过 `AgentRuntime` 接口抽象，当前注册了三个实现：`native`（Vercel AI SDK streamText 自研循环）、`claude-code-sdk`（Claude Agent SDK 薄适配）、`codex_runtime`（Codex app-server JSON-RPC 通道）。这是整个系统最核心的可替换边界。

**Provider 层（模型供给）** — `provider-resolver.ts` 实现了四级优先级链（显式指定 → 会话绑定 → 全局默认 → 环境变量），支持 Anthropic、OpenAI、Google、Bedrock、Vertex、xAI 等协议。`ai-provider.ts` 的工厂方法 `createLanguageModel()` 按协议创建对应的 SDK 客户端，并通过中间件管线（defaultSettings → extractReasoning → logging）做统一包装。

**Capability 层（能力编译）** — `harness/context-compiler.ts` + `runtime-adapter.ts` 将"启用了哪些能力"编译为各 Runtime 可消费的形态：ClaudeCode 拿到 `systemPromptAppend + mcpServerNames`，Native 拿到 `systemPromptText + toolSetKeys`，Codex 拿到 `systemPromptInstructions + builtinToolNames`。

**Tool 层（工具执行）** — `agent-tools.ts` 按会话模式和关键词门控组装工具集，`tools/agent.ts` 的 AgentTool 可派生子 Agent（从 `agent-registry.ts` 取定义，当前内置 explore 和 general 两个子 Agent）。权限由 `permission-checker.ts` 三级模式（explore/normal/trust）控制。

**Event 层（事件合约）** — `runtime/contract.ts` 定义了 8 种运行事件 + 4 种权限事件的规范联合类型，所有 Runtime 适配器必须将自身具体事件翻译为此联合。前端只消费这个规范层。

---

### 二、已有的可替换性评估

| 维度 | 当前状态 | 替换成本 |
|------|----------|----------|
| Runtime 引擎替换 | 已支持。`registerRuntime()` + `resolveRuntime()` 构成完整的策略模式 | 低：实现 `AgentRuntime` 接口（4 个方法）即可注册 |
| Provider/模型替换 | 已支持。多协议工厂 + 优先级解析链 | 低：新增协议只需扩展 `createLanguageModel()` 的 switch 分支 |
| 子 Agent 替换 | 部分支持。`agent-registry.ts` 可注册自定义 Agent 定义 | 中：定义结构清晰，但子 Agent 的工具集仍绑定 Native Runtime 的工具实现 |
| 能力集替换 | 部分支持。Capability Compiler 是纯函数，输入 enabledCapabilities 集合 | 中：新增能力需在 compiler 中注册 fragment + hints，但无需改 Runtime |
| 工具实现替换 | 耦合较重。`agent-tools.ts` 直接 import 具体工具实现 | 高：工具与 Native Runtime 的 agent-loop 深度绑定 |
| 权限策略替换 | 耦合较重。permission-checker 嵌入工具执行路径 | 高：替换需同时改 agent-loop 和 bridge 的权限路径 |

---

### 三、核心耦合点（阻碍自由替换的瓶颈）

**1. claude-client.ts 的"万能入口"问题**

`streamClaude()` 是所有路径的汇聚点，内部同时承担：Runtime 解析、环境构建、SDK 会话管理、SSE 流包装、错误分类。虽然最终委托给 `runtime.stream()`，但入口前的准备逻辑（provider 解析、context 组装、MCP 加载）与 SDK 路径有隐式耦合。新 Runtime 如果不需要这些准备步骤，仍被迫经过它们。

**2. Native Runtime 的工具-循环-持久化一体化**

`agent-loop.ts` 是一个 while 循环，将工具调用、权限检查、DB 持久化、doom-loop 检测、context-overflow 裁剪、超时预算全部内联。这意味着：如果想用一个外部 Agent 框架（如 LangGraph、CrewAI、AutoGen）替换 Native Runtime 的"思考-执行"循环，必须重写整个循环或者在外部框架中重新实现这些横切关注点。

**3. SSE 事件格式是前端硬合约**

前端 `useSSEStream` hook 解析 17 种 SSE 事件类型。虽然 `contract.ts` 定义了规范联合，但实际 SSE 文本格式（`data: {"type":"...","data":"..."}\n\n`）是硬编码的。任何新 Runtime 必须精确产出此格式，否则前端无法渲染。

**4. 权限系统的 Runtime 感知**

权限检查在 Native 路径是同步的（agent-loop 内 `checkPermission()`），在 SDK 路径是异步的（SDK 回调 → 前端弹窗 → resume），在 Codex 路径又是另一套（approval proposal）。三套路径没有统一的 PermissionBroker 抽象。

---

### 四、自由替换的可行路径

基于当前架构，实现"Agent 处理能力自由替换"需要分三步走：

**Phase 1：Runtime 级替换（已具备，低成本）**

当前架构已经支持。只需实现 `AgentRuntime` 接口：

```typescript
interface AgentRuntime {
  readonly id: string;
  readonly displayName: string;
  readonly description: string;
  stream(options: RuntimeStreamOptions): ReadableStream<string>;
  interrupt(sessionId: string): void;
  isAvailable(): boolean;
  dispose(): void;
}
```

任何外部 Agent（本地 Ollama、远程 API、自研引擎）只要能将输出翻译为 SSE 事件流，就可以注册为第四个、第五个 Runtime。`resolveRuntime()` 的优先级链和 session-pin 机制已经支持按会话/按请求选择不同 Runtime。

**Phase 2：能力编排层解耦（中等改造）**

将 `agent-loop.ts` 中的横切关注点抽取为可组合的中间件：

- **执行循环** → 抽象为 `ExecutionStrategy` 接口（ReAct loop / Plan-and-Execute / 外部框架委托）
- **工具注册** → 从直接 import 改为 `ToolProvider` 注册表（类似 MCP 的声明式注册）
- **权限检查** → 统一为 `PermissionBroker` 接口（同步/异步/外部审批都是实现差异）
- **持久化** → 从内联改为事件驱动（`onToolCompleted` → 异步写 DB）
- **Context 管理** → 从硬编码裁剪改为 `ContextPolicy` 策略

改造后，替换"Agent 如何处理任务"变成替换 ExecutionStrategy + ToolProvider 的组合，而非替换整个 Runtime。

**Phase 3：Agent 编排器插件化（较大改造）**

引入 `AgentOrchestrator` 概念，将当前的"单 Agent + 子 Agent 派生"模式扩展为可插拔的编排模式：

- 单 Agent 直接执行（当前模式）
- 多 Agent 协作（CrewAI 风格的角色分工）
- 工作流编排（LangGraph 风格的状态机）
- 外部 Agent 委托（将任务整体交给远程 Agent 服务）

这需要在 `agent-registry.ts` 之上增加编排层，并让 `RuntimeStreamOptions` 支持传递编排配置。

---

### 五、结论

**能否做到自由替换？能，但分层看：**

Runtime 级替换（换执行引擎）— 当前架构已经支持，成本极低。这是项目最初就设计好的 Strategy 模式，三个 Runtime 共存已经验证了可行性。

处理能力级替换（换思考/执行策略）— 需要 Phase 2 的中间件化改造。当前 agent-loop 的一体化设计是主要瓶颈，但改造范围可控（约 3-4 个文件的结构性重构），不影响前端和 DB 层。

编排模式级替换（换协作范式）— 需要 Phase 3 的编排器抽象。这是最大的改动，但当前 `agent-registry.ts` + `AgentTool` 的子 Agent 机制已经埋下了扩展点，不是从零开始。

总体而言，CodePilot 的架构在 Runtime 层已经做到了良好的可替换性；主要差距在 agent-loop 内部的横切关注点耦合，以及缺少统一的 PermissionBroker 抽象。这两点解决后，"自由替换 Agent 处理能力"在工程上是完全可行的。
