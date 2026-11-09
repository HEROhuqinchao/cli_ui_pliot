/**
 * execution/context-policy.ts — Context management strategy.
 *
 * Controls how conversation history is pruned / managed to fit within
 * the model's context window. The current agent-loop uses
 * pruneOldToolResults() inline; this interface extracts that into a
 * swappable policy.
 */

import type { ModelMessage } from 'ai';

// ── Interface ──────────────────────────────────────────────────

/**
 * Context management policy — decides how to trim conversation history
 * before each model call to stay within token budgets.
 */
export interface ContextPolicy {
  /** Machine identifier (e.g. 'prune-old', 'sliding-window', 'noop') */
  readonly id: string;
  /** Human-readable name */
  readonly displayName: string;

  /**
   * Prune / transform the message list before a model call.
   * Called at the start of each agent loop step.
   *
   * @param messages - Full conversation history (may be large)
   * @param budget - Token budget constraints
   * @returns Pruned message list (must preserve message ordering and role alternation)
   */
  prune(messages: ModelMessage[], budget: TokenBudget): ModelMessage[];

  /**
   * Estimate token count for a message list (optional).
   * Used for diagnostics and proactive pruning decisions.
   */
  estimateTokens?(messages: ModelMessage[]): number;
}

// ── Token budget ───────────────────────────────────────────────

export interface TokenBudget {
  /** Model's total context window size */
  contextWindow: number;
  /** Tokens reserved for model output */
  reservedForOutput: number;
  /** Tokens reserved for system prompt */
  reservedForSystem: number;
  /** Effective budget for conversation history */
  get availableForHistory(): number;
}

/**
 * Create a TokenBudget with computed availableForHistory.
 */
export function createTokenBudget(
  contextWindow: number,
  reservedForOutput = 16384,
  reservedForSystem = 8192,
): TokenBudget {
  return {
    contextWindow,
    reservedForOutput,
    reservedForSystem,
    get availableForHistory() {
      return Math.max(0, this.contextWindow - this.reservedForOutput - this.reservedForSystem);
    },
  };
}

// ── Built-in policies ──────────────────────────────────────────

/**
 * Default policy: prune old tool results (mirrors current pruneOldToolResults behavior).
 * Keeps recent tool results intact, summarizes/removes older ones.
 */
export const pruneOldPolicy: ContextPolicy = {
  id: 'prune-old',
  displayName: 'Prune Old Tool Results',

  prune(messages: ModelMessage[], _budget: TokenBudget): ModelMessage[] {
    // Delegate to the existing implementation during migration.
    // After Stage 2, this will contain the extracted logic directly.
    // For now, import lazily to avoid circular deps.
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { pruneOldToolResults } = require('../context-pruner');
      return pruneOldToolResults(messages);
    } catch {
      return messages;
    }
  },
};

/**
 * No-op policy: pass messages through unchanged.
 * Useful for external frameworks that manage their own context.
 */
export const noopPolicy: ContextPolicy = {
  id: 'noop',
  displayName: 'No Pruning',
  prune(messages: ModelMessage[]): ModelMessage[] {
    return messages;
  },
};

/**
 * Sliding window policy: keep only the last N messages.
 * Simple but effective for short-context models.
 */
export function createSlidingWindowPolicy(maxMessages: number): ContextPolicy {
  return {
    id: 'sliding-window',
    displayName: `Sliding Window (${maxMessages})`,
    prune(messages: ModelMessage[]): ModelMessage[] {
      if (messages.length <= maxMessages) return messages;
      // Always keep the first user message (task context) + last N messages
      const first = messages[0];
      const tail = messages.slice(-(maxMessages - 1));
      return [first, ...tail];
    },
  };
}

// ── Registry ───────────────────────────────────────────────────

const policies = new Map<string, ContextPolicy>();

// Register built-ins
policies.set(pruneOldPolicy.id, pruneOldPolicy);
policies.set(noopPolicy.id, noopPolicy);

export function registerContextPolicy(policy: ContextPolicy): void {
  policies.set(policy.id, policy);
}

export function getContextPolicy(id: string): ContextPolicy | undefined {
  return policies.get(id);
}

export function resolveContextPolicy(id?: string): ContextPolicy {
  if (id) {
    const p = policies.get(id);
    if (p) return p;
  }
  return pruneOldPolicy; // default
}
