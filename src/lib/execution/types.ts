/**
 * execution/types.ts — ExecutionStrategy interface and ExecutionContext.
 *
 * The ExecutionStrategy abstracts the "how does the agent think and act"
 * loop. The current agent-loop.ts while-loop becomes one implementation
 * ('react-loop'); other strategies (plan-execute, external-framework,
 * remote-delegate) can be swapped in without changing the outer contract.
 *
 * Design constraints:
 * - execute() returns ReadableStream<string> (SSE lines) — same contract
 *   as AgentRuntime.stream(), so the frontend is unaware of which strategy
 *   produced the stream.
 * - ExecutionContext carries all dependencies as injected values (tools,
 *   permission broker, context policy, persistence hook) so strategies
 *   are pure orchestration logic with no hidden imports.
 * - strategyOptions is a typed passthrough for strategy-specific config
 *   (e.g. plan-execute's planning prompt, external-framework's binary path).
 */

import type { LanguageModel, ToolSet, ModelMessage } from 'ai';
import type { SSEEvent, MCPServerConfig, FileAttachment } from '@/types';
import type { ProviderCallScene } from '../provider-call-policy';
import type { PermissionBroker } from '../permission/broker';
import type { ContextPolicy } from './context-policy';
import type { PersistenceHook } from './persistence-hook';

// ── Strategy interface ─────────────────────────────────────────

/**
 * The single contract all execution strategies must fulfil.
 *
 * An ExecutionStrategy controls the think-act loop: how the model is
 * called, how tool results are fed back, when to stop. It does NOT
 * control which tools are available (ToolProvider), whether a tool
 * call is allowed (PermissionBroker), or how history is pruned
 * (ContextPolicy) — those are injected via ExecutionContext.
 */
export interface ExecutionStrategy {
  /** Machine identifier (e.g. 'react-loop', 'plan-execute', 'external-framework') */
  readonly id: string;
  /** Human-readable name for settings UI */
  readonly displayName: string;
  /** Short description of the strategy's behavior */
  readonly description: string;

  /**
   * Execute one full agent interaction.
   * Returns a ReadableStream of SSE lines (`data: {...}\n\n`),
   * identical in format to AgentRuntime.stream() output.
   */
  execute(ctx: ExecutionContext): ReadableStream<string>;

  /** Interrupt the current execution for a session. */
  interrupt(sessionId: string): void;

  /** Whether this strategy is currently usable (dependencies available). */
  isAvailable(): boolean;
}

// ── Execution context ──────────────────────────────────────────

/**
 * All dependencies an ExecutionStrategy needs to run.
 * Assembled by the orchestrator / native-runtime before calling execute().
 */
export interface ExecutionContext {
  // ── Input ──
  /** User's prompt text */
  prompt: string;
  /** Session ID (for DB persistence and SSE metadata) */
  sessionId: string;
  /** Conversation history (already built from DB) */
  messages: ModelMessage[];
  /** Effective system prompt (base + tool prompts + capability fragments) */
  systemPrompt?: string;
  /** The resolved language model instance */
  model: LanguageModel;
  /** Model identifier string (for logging / SSE status events) */
  modelId: string;

  // ── Injected capabilities ──
  /** Assembled tool set (from ToolRegistry) */
  tools: ToolSet;
  /** Permission broker for tool-call authorization */
  permissionBroker: PermissionBroker;
  /** Context management strategy (pruning, window management) */
  contextPolicy: ContextPolicy;
  /** Persistence hooks for DB writes */
  persistence: PersistenceHook;

  // ── Control ──
  /** Maximum number of agent loop steps */
  maxSteps: number;
  /** Abort signal (user cancel or timeout) */
  abortSignal: AbortSignal;
  /** Emit an SSE event to the downstream consumer */
  emitSSE: (event: SSEEvent) => void;
  /** Working directory for tool execution */
  workingDirectory: string;

  // ── Model configuration ──
  /** Thinking configuration (Anthropic-specific) */
  thinking?: { type: 'adaptive' } | { type: 'enabled'; budgetTokens?: number } | { type: 'disabled' };
  /** Effort level */
  effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  /** Enable 1M context beta */
  context1m?: boolean;
  /** Sampling params */
  temperature?: number;
  topP?: number;
  topK?: number;

  // ── Strategy-specific options ──
  /**
   * Passthrough for strategy-specific configuration.
   * - react-loop: { doomLoopThreshold?: number; keepAliveIntervalMs?: number }
   * - plan-execute: { planningPrompt?: string; maxPlanSteps?: number }
   * - external-framework: { binaryPath?: string; frameworkId?: string }
   * - remote-delegate: { endpoint?: string; protocol?: string }
   */
  strategyOptions?: Record<string, unknown>;

  // ── Passthrough fields (react-loop delegation phase) ──
  /**
   * These fields are forwarded to runAgentLoop() during the Stage 2
   * delegation phase. Post-migration, they will be consumed directly
   * by the strategy implementation.
   */
  callScene?: ProviderCallScene;
  providerId?: string;
  sessionProviderId?: string;
  bypassPermissions?: boolean;
  mcpServers?: Record<string, MCPServerConfig>;
  files?: FileAttachment[];

  // ── Callbacks ──
  /** Called when runtime status changes (streaming / idle / error) */
  onRuntimeStatusChange?: (status: string) => void;
  /** Whether this is an auto-trigger turn (skip rewind points) */
  autoTrigger?: boolean;
}

// ── Strategy registry ──────────────────────────────────────────

const strategies = new Map<string, ExecutionStrategy>();

export function registerStrategy(strategy: ExecutionStrategy): void {
  strategies.set(strategy.id, strategy);
}

export function getStrategy(id: string): ExecutionStrategy | undefined {
  return strategies.get(id);
}

export function getAllStrategies(): ExecutionStrategy[] {
  return Array.from(strategies.values());
}

export function getAvailableStrategies(): ExecutionStrategy[] {
  return getAllStrategies().filter(s => s.isAvailable());
}

/**
 * Resolve the execution strategy to use.
 * Falls back to 'react-loop' (the default, always-available strategy).
 */
export function resolveStrategy(strategyId?: string): ExecutionStrategy {
  if (strategyId) {
    const s = strategies.get(strategyId);
    if (s?.isAvailable()) return s;
  }
  const fallback = strategies.get('react-loop');
  if (fallback) return fallback;
  throw new Error('No execution strategy registered. This is a bug — react-loop must always be registered.');
}
