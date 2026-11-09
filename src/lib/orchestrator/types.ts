/**
 * orchestrator/types.ts — AgentOrchestrator interface and OrchestrationContext.
 *
 * The orchestrator sits ABOVE ExecutionStrategy and decides "who does what,
 * in what order, with what collaboration pattern". For single-agent mode
 * (the current default), it's a thin passthrough to the strategy. For
 * multi-role / workflow / delegate modes, it coordinates multiple strategy
 * invocations.
 *
 * Key constraint: orchestrate() returns ReadableStream<string> (SSE lines),
 * same as AgentRuntime.stream(). The frontend never knows whether one agent
 * or five produced the stream.
 */

import type { LanguageModel } from 'ai';
import type { SSEEvent, MCPServerConfig, FileAttachment } from '@/types';
import type { ProviderCallScene } from '../provider-call-policy';
import type { PermissionBroker } from '../permission/broker';
import type { ContextPolicy } from '../execution/context-policy';
import type { PersistenceHook } from '../execution/persistence-hook';
import type { AgentProfile, MultiRoleConfig, WorkflowConfig, DelegateConfig } from './agent-profile';

// ── Orchestrator interface ─────────────────────────────────────

/**
 * Agent orchestrator — decides how agents collaborate to fulfil a task.
 *
 * Implementations:
 * - SingleOrchestrator: one agent, one strategy (current default behavior)
 * - MultiRoleOrchestrator: multiple agents with role assignments (CrewAI-style)
 * - WorkflowOrchestrator: state-machine execution (LangGraph-style)
 * - DelegateOrchestrator: forward entire task to a remote agent service
 */
export interface AgentOrchestrator {
  /** Machine identifier (e.g. 'single', 'multi-role', 'workflow', 'delegate') */
  readonly id: string;
  /** Human-readable name */
  readonly displayName: string;
  /** Orchestration mode this orchestrator handles */
  readonly mode: OrchestratorMode;

  /**
   * Orchestrate a full task execution.
   * Internally may invoke multiple ExecutionStrategy instances,
   * coordinate their outputs, and merge into a single SSE stream.
   */
  orchestrate(ctx: OrchestrationContext): ReadableStream<string>;

  /** Interrupt the current orchestration for a session. */
  interrupt(sessionId: string): void;
}

export type OrchestratorMode =
  | 'single'        // One agent, direct execution (current default)
  | 'multi-role'    // Multiple agents with role assignments (CrewAI-style)
  | 'workflow'      // State-machine execution (LangGraph-style)
  | 'delegate';     // Forward to remote agent service

// ── Orchestration context ──────────────────────────────────────

/**
 * Everything an orchestrator needs to coordinate agent execution.
 * Assembled by native-runtime from RuntimeStreamOptions + AgentProfile.
 */
export interface OrchestrationContext {
  // ── Input ──
  prompt: string;
  sessionId: string;
  workingDirectory: string;
  systemPrompt?: string;
  model: LanguageModel;
  modelId: string;
  abortSignal: AbortSignal;
  emitSSE: (event: SSEEvent) => void;

  // ── Profile-driven config ──
  /** The resolved AgentProfile driving this orchestration */
  profile: AgentProfile;

  // ── Injected capabilities ──
  permissionBroker: PermissionBroker;
  contextPolicy: ContextPolicy;
  persistence: PersistenceHook;

  // ── Model configuration ──
  thinking?: { type: 'adaptive' } | { type: 'enabled'; budgetTokens?: number } | { type: 'disabled' };
  effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  context1m?: boolean;
  temperature?: number;
  topP?: number;
  topK?: number;

  // ── Control ──
  maxSteps: number;
  autoTrigger?: boolean;
  onRuntimeStatusChange?: (status: string) => void;

  // ── Passthrough fields (needed by react-loop delegation) ──
  /** Provider call scene for model resolution */
  callScene: ProviderCallScene;
  /** Skip all permission checks */
  bypassPermissions?: boolean;
  /** MCP server configurations to sync */
  mcpServers?: Record<string, MCPServerConfig>;
  /** File attachments from the user message */
  files?: FileAttachment[];

  // ── Provider context (for tool assembly) ──
  providerId?: string;
  sessionProviderId?: string;
}

// ── Orchestrator registry ──────────────────────────────────────

const orchestrators = new Map<string, AgentOrchestrator>();

export function registerOrchestrator(orch: AgentOrchestrator): void {
  orchestrators.set(orch.id, orch);
}

export function getOrchestrator(id: string): AgentOrchestrator | undefined {
  return orchestrators.get(id);
}

export function getAllOrchestrators(): AgentOrchestrator[] {
  return Array.from(orchestrators.values());
}

/**
 * Resolve the orchestrator for a given mode.
 * Falls back to 'single' (always registered).
 */
export function resolveOrchestrator(mode: OrchestratorMode): AgentOrchestrator {
  const orch = orchestrators.get(mode);
  if (orch) return orch;
  const fallback = orchestrators.get('single');
  if (fallback) return fallback;
  throw new Error('No orchestrator registered. This is a bug — single must always be registered.');
}
