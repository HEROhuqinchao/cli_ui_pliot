/**
 * permission/broker.ts — Unified PermissionBroker interface.
 *
 * Collapses the three existing permission paths (Native sync rules,
 * SDK async callback, Codex approval proposal) into a single contract.
 * All runtimes and execution strategies check permissions through this
 * interface; the concrete implementation decides how to authorize.
 *
 * Design:
 * - check() is async to support both sync (rule-based) and async
 *   (SSE popup wait, external webhook) authorization flows.
 * - PermissionDecision uses a discriminated union so callers can
 *   exhaustively handle allow / deny / ask without magic strings.
 * - The 'ask' path returns a PermissionPrompt with a waitForResponse()
 *   closure — the strategy awaits it to block until the user responds.
 */

// ── Core interface ─────────────────────────────────────────────

/**
 * Permission broker — the single authorization gate for tool calls.
 *
 * Implementations:
 * - RuleBasedBroker: wraps permission-checker.ts (explore/normal/trust rules)
 * - InteractiveSseBroker: wraps the SSE popup + wait logic from agent-tools.ts
 * - BypassBroker: allows everything (bypassPermissions=true)
 * - ExternalApprovalBroker: delegates to an external HTTP webhook (future)
 * - CompositeBroker: chains multiple brokers (first non-ask wins)
 */
export interface PermissionBroker {
  /** Machine identifier */
  readonly id: string;
  /** Human-readable name */
  readonly displayName: string;

  /**
   * Check whether a tool invocation is authorized.
   *
   * @returns PermissionDecision — allow (proceed), deny (reject), or ask (wait for user)
   */
  check(request: PermissionRequest): Promise<PermissionDecision>;

  /**
   * Filter a tool list to only those that would be auto-allowed.
   * Used by plan mode to restrict the active tool set without
   * triggering permission prompts for every tool.
   *
   * Default: return all tools (no filtering).
   */
  filterTools?(toolNames: string[], context?: PermissionFilterContext): string[];
}

// ── Request / Decision types ───────────────────────────────────

export interface PermissionRequest {
  /** Tool being called (e.g. 'Bash', 'Edit', 'codepilot_notify') */
  toolName: string;
  /** Tool input payload (used for pattern matching in rule-based checks) */
  toolInput: unknown;
  /** Session ID (for session-scoped approval memory) */
  sessionId: string;
  /** Tool mutation level (from harness/mutation-level.ts) */
  mutationLevel?: 'safe_read' | 'mutate' | 'dangerous';
  /** Working directory context */
  workingDirectory?: string;
}

export type PermissionDecision =
  | { action: 'allow' }
  | { action: 'deny'; reason: string }
  | { action: 'ask'; prompt: PermissionPrompt };

export interface PermissionPrompt {
  /** Unique ID for this permission request (for DB persistence + SSE) */
  permissionRequestId: string;
  /** Tool name being requested */
  toolName: string;
  /** Tool input (shown to user for confirmation) */
  toolInput: unknown;
  /** Human-readable description of what will happen */
  description: string;
  /** Approval token (HMAC, for route-level verification) */
  approvalToken?: string;
  /**
   * Wait for the user's response. The strategy awaits this to block
   * execution until the user approves or denies.
   *
   * Resolves with the user's decision. If the abort signal fires
   * while waiting, resolves with { behavior: 'deny', message: 'aborted' }.
   */
  waitForResponse: () => Promise<PermissionResponse>;
}

export interface PermissionResponse {
  behavior: 'allow' | 'deny';
  /** User-modified input (e.g. edited bash command) */
  updatedInput?: unknown;
  /** User's message / reason */
  message?: string;
  /** Session-level rules to remember (e.g. "allow this tool for session") */
  updatedPermissions?: Array<{ toolName: string; pattern: string }>;
}

export interface PermissionFilterContext {
  sessionId: string;
  workingDirectory?: string;
}

// ── Bypass broker ──────────────────────────────────────────────

/**
 * Allows everything. Used when bypassPermissions=true (full_access profile).
 */
export const bypassBroker: PermissionBroker = {
  id: 'bypass',
  displayName: 'Bypass (Full Access)',

  async check(): Promise<PermissionDecision> {
    return { action: 'allow' };
  },

  filterTools(toolNames: string[]): string[] {
    return toolNames;
  },
};
