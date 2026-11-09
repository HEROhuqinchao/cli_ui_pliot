/**
 * tools/tool-provider.ts — ToolProvider interface.
 *
 * Abstracts tool sources (builtin coding tools, MCP servers, plugins,
 * user-defined tools) behind a unified registration interface. Replaces
 * the hardcoded import chain in agent-tools.ts's assembleTools().
 *
 * Each provider contributes:
 * - A set of AI SDK tools (ToolSet)
 * - Optional system prompt fragments (tool-specific instructions)
 * - Availability check (e.g. MCP server connected, binary installed)
 *
 * Providers are registered with a priority; same-name tools from
 * higher-priority providers override lower-priority ones.
 */

import type { ToolSet } from 'ai';

// ── Interface ──────────────────────────────────────────────────

/**
 * A source of tools for the agent execution loop.
 *
 * Implementations:
 * - BuiltinCodingProvider: wraps createBuiltinTools() (Read, Write, Edit, Bash, Glob, Grep, Agent)
 * - BuiltinMcpProvider: wraps getBuiltinTools() (notification, memory, dashboard, media, etc.)
 * - ExternalMcpProvider: wraps buildMcpToolSet() (user-connected MCP servers)
 * - PluginAgentProvider: tools contributed by plugin agents (future)
 * - UserDefinedProvider: tools from .codepilot/agents.json inline definitions (future)
 */
export interface ToolProvider {
  /** Machine identifier (e.g. 'builtin-coding', 'external-mcp') */
  readonly id: string;
  /** Human-readable name for UI display */
  readonly displayName: string;
  /**
   * Priority for merge ordering. Lower number = registered first.
   * Same-name tools from later (higher priority number) providers
   * override earlier ones. Default: 50.
   */
  readonly priority: number;

  /**
   * Produce the tools this provider contributes.
   * Can be sync (builtin tools) or async (MCP needs connection handshake).
   */
  provideTools(ctx: ToolProviderContext): Promise<ToolSet> | ToolSet;

  /**
   * System prompt fragments this provider contributes.
   * These are appended to the effective system prompt so the model
   * knows about the tools' conventions and constraints.
   */
  provideSystemPrompts?(ctx: ToolProviderContext): string[];

  /**
   * Whether this provider is available in the current context.
   * e.g. ExternalMcpProvider returns false when no MCP servers are configured.
   */
  isAvailable?(ctx: ToolProviderContext): boolean;
}

// ── Context ────────────────────────────────────────────────────

/**
 * Context passed to each ToolProvider when assembling tools.
 * Contains the information providers need to configure their tools.
 */
export interface ToolProviderContext {
  /** Working directory for tool execution */
  workingDirectory: string;
  /** Current session ID */
  sessionId?: string;
  /** User's prompt (for keyword-gating decisions) */
  prompt?: string;
  /** Active provider ID (for sub-agent inheritance) */
  providerId?: string;
  /** Session's stored provider ID */
  sessionProviderId?: string;
  /** Active model (for sub-agent inheritance) */
  model?: string;
  /** Permission mode (explore/normal/trust/plan) */
  permissionMode?: string;
  /** Whether to only include read-only tools (plan mode) */
  safeReadOnly?: boolean;
  /** MCP server configs (for ExternalMcpProvider) */
  mcpServers?: Record<string, unknown>;
}

// ── Merge result ───────────────────────────────────────────────

export interface AssembledToolSet {
  /** Merged tool set from all providers */
  tools: ToolSet;
  /** Concatenated system prompt fragments */
  systemPrompts: string[];
  /** Which providers contributed (for diagnostics) */
  activeProviders: string[];
}
