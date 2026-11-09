/**
 * execution/persistence-hook.ts — Persistence hooks for the agent loop.
 *
 * Extracts DB writes from the agent-loop's inline logic into an
 * event-driven interface. Strategies call these hooks at lifecycle
 * points; the hook implementation decides what (if anything) to persist.
 *
 * This decouples execution logic from storage concerns:
 * - The default hook writes to SQLite (current behavior)
 * - A noop hook disables persistence (for ephemeral sub-agents)
 * - A remote hook could sync to a server (future)
 */

import type { MediaBlock } from '@/types';

// ── Interface ──────────────────────────────────────────────────

/**
 * Persistence hook — receives lifecycle events from the execution
 * strategy and persists them as appropriate.
 *
 * All methods are optional (fire-and-forget). Strategies MUST NOT
 * await persistence results for control flow decisions.
 */
export interface PersistenceHook {
  /** Machine identifier */
  readonly id: string;

  /** A tool call was initiated */
  onToolStarted?(event: ToolStartedEvent): void | Promise<void>;

  /** A tool call completed (success or error) */
  onToolCompleted?(event: ToolCompletedEvent): void | Promise<void>;

  /** A step (model call) completed */
  onStepCompleted?(event: StepCompletedEvent): void | Promise<void>;

  /** The full execution completed successfully */
  onRunCompleted?(event: RunCompletedEvent): void | Promise<void>;

  /** The execution failed */
  onRunFailed?(event: RunFailedEvent): void | Promise<void>;

  /** A file checkpoint was created */
  onCheckpoint?(event: CheckpointEvent): void | Promise<void>;
}

// ── Event types ────────────────────────────────────────────────

export interface ToolStartedEvent {
  sessionId: string;
  toolCallId: string;
  toolName: string;
  input: unknown;
  step: number;
}

export interface ToolCompletedEvent {
  sessionId: string;
  toolCallId: string;
  toolName: string;
  output: string;
  isError: boolean;
  media?: readonly MediaBlock[];
  step: number;
}

export interface StepCompletedEvent {
  sessionId: string;
  step: number;
  usage: { inputTokens: number; outputTokens: number };
  finishReason?: string;
  toolsUsed: string[];
}

export interface RunCompletedEvent {
  sessionId: string;
  totalSteps: number;
  totalUsage: { input_tokens: number; output_tokens: number };
  contextAccounting?: unknown;
}

export interface RunFailedEvent {
  sessionId: string;
  error: string;
  errorCode?: string;
  totalSteps: number;
}

export interface CheckpointEvent {
  sessionId: string;
  messageId: string;
  workingDirectory: string;
}

// ── Built-in implementations ───────────────────────────────────

/**
 * Noop hook — discards all events. Used for ephemeral sub-agents
 * and external framework strategies that manage their own state.
 */
export const noopPersistence: PersistenceHook = {
  id: 'noop',
};

/**
 * DB persistence hook — writes to SQLite (current agent-loop behavior).
 * During Stage 2 migration, this will absorb the inline DB writes
 * from agent-loop.ts. For now it's a skeleton that will be filled in.
 */
export const dbPersistence: PersistenceHook = {
  id: 'db',

  onToolCompleted(_event: ToolCompletedEvent): void {
    // Stage 2: absorb tool_result DB writes from agent-loop
  },

  onStepCompleted(_event: StepCompletedEvent): void {
    // Stage 2: absorb step-complete DB writes
  },

  onRunCompleted(_event: RunCompletedEvent): void {
    // Stage 2: absorb result-event DB writes
  },

  onRunFailed(_event: RunFailedEvent): void {
    // Stage 2: absorb error-event DB writes
  },

  onCheckpoint(_event: CheckpointEvent): void {
    // Stage 2: absorb createCheckpoint calls
  },
};

// ── Registry ───────────────────────────────────────────────────

const hooks = new Map<string, PersistenceHook>();

hooks.set(noopPersistence.id, noopPersistence);
hooks.set(dbPersistence.id, dbPersistence);

export function registerPersistenceHook(hook: PersistenceHook): void {
  hooks.set(hook.id, hook);
}

export function getPersistenceHook(id: string): PersistenceHook | undefined {
  return hooks.get(id);
}

export function resolvePersistenceHook(id?: string): PersistenceHook {
  if (id) {
    const h = hooks.get(id);
    if (h) return h;
  }
  return dbPersistence; // default
}
