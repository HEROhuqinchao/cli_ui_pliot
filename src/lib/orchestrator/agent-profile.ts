/**
 * orchestrator/agent-profile.ts — AgentProfile: declarative agent definition.
 *
 * An AgentProfile is the user-facing configuration unit that describes
 * "what kind of agent I want": its orchestration mode, execution strategy,
 * available tools, prompts, permissions, and constraints.
 *
 * Profiles can come from:
 * - Built-in defaults (registered at startup)
 * - User configuration (.codepilot/agents.json in project root)
 * - Database (agent_profiles table, managed via Settings UI / API)
 *
 * The profile is resolved into concrete instances (strategy, tools, broker)
 * by profile-registry.ts before being passed to the orchestrator.
 */

import type { OrchestratorMode } from './types';

// ── AgentProfile ───────────────────────────────────────────────

/**
 * Complete declarative definition of an agent's behavior.
 * Serializable to JSON for storage in DB / config files.
 */
export interface AgentProfile {
  /** Unique identifier */
  id: string;
  /** Human-readable name (shown in UI picker) */
  displayName: string;
  /** What this agent does (shown as tooltip / description) */
  description: string;
  /** Schema version for forward compatibility */
  version: string;

  // ── Orchestration ──
  /** How agents collaborate: single | multi-role | workflow | delegate */
  orchestrator: OrchestratorMode;

  // ── Execution strategy ──
  /** Which execution strategy to use (e.g. 'react-loop', 'plan-execute') */
  strategyId: string;
  /** Strategy-specific options */
  strategyOptions?: Record<string, unknown>;

  // ── Tools ──
  /** Which ToolProviders to include (by id). Empty = all available. */
  toolProviderIds: string[];
  /** Inline tool definitions (for simple custom tools) */
  inlineTools?: InlineToolDefinition[];

  // ── Prompts ──
  /** System prompt override (replaces default if set) */
  systemPrompt?: string;
  /** Prompt template with {{variables}} support */
  promptTemplate?: string;

  // ── Permissions ──
  /** Permission mode: explore | normal | trust */
  permissionMode?: 'explore' | 'normal' | 'trust';
  /** Permission broker id (overrides default composite) */
  permissionBrokerId?: string;

  // ── Context management ──
  /** Context policy id (e.g. 'prune-old', 'sliding-window', 'noop') */
  contextPolicyId?: string;

  // ── Multi-role config (orchestrator === 'multi-role') ──
  multiRole?: MultiRoleConfig;

  // ── Workflow config (orchestrator === 'workflow') ──
  workflow?: WorkflowConfig;

  // ── Delegate config (orchestrator === 'delegate') ──
  delegate?: DelegateConfig;

  // ── Model preferences ──
  /** Preferred model (overrides session model if set) */
  model?: string;
  /** Preferred provider (overrides session provider if set) */
  providerId?: string;

  // ── Constraints ──
  /** Maximum agent loop steps (default 50) */
  maxSteps?: number;
  /** Global timeout in seconds */
  timeoutSec?: number;

  // ── Metadata ──
  /** Where this profile came from */
  source?: 'builtin' | 'user' | 'project';
  /** Icon identifier for UI */
  icon?: string;
}

// ── Inline tool definition ─────────────────────────────────────

/**
 * A tool defined inline in the profile (no separate ToolProvider needed).
 * Suitable for simple shell commands, HTTP calls, or sandboxed scripts.
 */
export interface InlineToolDefinition {
  /** Tool name (must be unique within the profile) */
  name: string;
  /** Description shown to the model */
  description: string;
  /** JSON Schema for the tool's input */
  inputSchema: Record<string, unknown>;
  /** How to execute this tool */
  execute: InlineToolExecute;
}

export type InlineToolExecute =
  | { type: 'shell'; command: string; cwd?: string }
  | { type: 'http'; url: string; method?: string; headers?: Record<string, string> }
  | { type: 'script'; runtime: 'node' | 'python'; code: string };

// ── Multi-role config ──────────────────────────────────────────

/**
 * Configuration for multi-role orchestration (CrewAI-style).
 * Multiple agents with distinct roles collaborate on a task.
 */
export interface MultiRoleConfig {
  /** Role definitions (one per participating agent) */
  roles: RoleDefinition[];
  /** How roles collaborate */
  collaboration: 'sequential' | 'parallel' | 'debate';
  /** Synthesis config (for parallel/debate: how to merge outputs) */
  synthesis?: SynthesisConfig;
}

export interface RoleDefinition {
  /** Unique role id */
  id: string;
  /** Role name (e.g. "Researcher", "Code Writer", "Reviewer") */
  name: string;
  /** Role description injected into system prompt */
  role: string;
  /** What this role aims to achieve */
  goal: string;
  /** Execution strategy for this role */
  strategyId: string;
  /** Tool providers available to this role */
  toolProviderIds: string[];
  /** Max steps for this role's execution */
  maxSteps?: number;
  /** Model override for this role */
  model?: string;
}

export interface SynthesisConfig {
  /** Strategy used to synthesize outputs */
  strategyId: string;
  /** Prompt template for synthesis ({{outputs}} variable) */
  prompt: string;
}

// ── Workflow config ────────────────────────────────────────────

/**
 * Configuration for workflow orchestration (LangGraph-style).
 * A directed graph of nodes executed according to edges and conditions.
 */
export interface WorkflowConfig {
  /** Graph nodes */
  nodes: WorkflowNode[];
  /** Graph edges (connections between nodes) */
  edges: WorkflowEdge[];
  /** Entry point node id */
  entryNode: string;
  /** Global timeout in seconds */
  timeoutSec?: number;
  /** Maximum total node visits (prevents infinite loops) */
  maxNodeVisits?: number;
}

export interface WorkflowNode {
  /** Unique node id */
  id: string;
  /** Node type determines execution behavior */
  type: 'agent' | 'condition' | 'transform' | 'human-in-loop' | 'terminal';
  /** Display label */
  label?: string;

  /** Agent node: execute a strategy with tools */
  agentConfig?: {
    strategyId: string;
    toolProviderIds: string[];
    prompt: string;
    maxSteps?: number;
  };

  /** Condition node: route based on expression */
  conditionConfig?: {
    /** Expression evaluated against the workflow state */
    expression: string;
    /** Branch mapping: result value → target node id */
    branches: Record<string, string>;
    /** Default branch if no match */
    defaultBranch?: string;
  };

  /** Transform node: data transformation */
  transformConfig?: {
    type: 'extract' | 'summarize' | 'format' | 'filter';
    config: Record<string, unknown>;
  };

  /** Human-in-loop node: wait for user input */
  humanConfig?: {
    prompt: string;
    inputType: 'text' | 'choice' | 'approval';
    choices?: string[];
    timeoutSec?: number;
  };
}

export interface WorkflowEdge {
  /** Source node id */
  from: string;
  /** Target node id */
  to: string;
  /** Optional condition expression (edge only taken if true) */
  condition?: string;
  /** Edge label (for visualization) */
  label?: string;
}

// ── Delegate config ────────────────────────────────────────────

/**
 * Configuration for delegate orchestration.
 * Forwards the entire task to a remote agent service.
 */
export interface DelegateConfig {
  /** Remote agent service endpoint URL */
  endpoint: string;
  /** Authentication configuration */
  auth: DelegateAuth;
  /** Wire protocol for communication */
  protocol: 'openai-responses' | 'a2a' | 'custom';
  /** Whether to use streaming (SSE) or wait for full response */
  streaming: boolean;
  /** Request timeout in seconds */
  timeoutSec: number;
  /** Custom headers to include in requests */
  headers?: Record<string, string>;
  /** Output translator id (transforms remote response to SSE events) */
  outputTranslatorId?: string;
}

export type DelegateAuth =
  | { type: 'bearer'; token: string }
  | { type: 'api-key'; header: string; key: string }
  | { type: 'oauth2'; tokenUrl: string; clientId: string; clientSecret: string }
  | { type: 'none' };

// ── Profile registry ───────────────────────────────────────────

const profiles = new Map<string, AgentProfile>();

/**
 * Register an AgentProfile (builtin or user-defined).
 */
export function registerProfile(profile: AgentProfile): void {
  profiles.set(profile.id, profile);
}

/**
 * Unregister a profile by id.
 */
export function unregisterProfile(id: string): void {
  profiles.delete(id);
}

/**
 * Get a profile by id.
 */
export function getProfile(id: string): AgentProfile | undefined {
  return profiles.get(id);
}

/**
 * List all registered profiles.
 */
export function listProfiles(): AgentProfile[] {
  return Array.from(profiles.values());
}

/**
 * List profiles filtered by source.
 */
export function listProfilesBySource(source: 'builtin' | 'user' | 'project'): AgentProfile[] {
  return listProfiles().filter(p => p.source === source);
}

// ── Default profile ────────────────────────────────────────────

/**
 * The default profile — equivalent to current native-runtime behavior.
 * Always registered; used when no explicit profile is selected.
 */
export const DEFAULT_PROFILE: AgentProfile = {
  id: 'default',
  displayName: 'CodePilot Default',
  description: 'Standard single-agent execution with full tool access.',
  version: '1.0.0',
  orchestrator: 'single',
  strategyId: 'react-loop',
  toolProviderIds: [],  // empty = all available
  permissionMode: 'normal',
  contextPolicyId: 'prune-old',
  maxSteps: 50,
  source: 'builtin',
};

// Register the default profile
registerProfile(DEFAULT_PROFILE);
