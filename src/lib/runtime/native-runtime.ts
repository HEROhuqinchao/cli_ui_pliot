/**
 * runtime/native-runtime.ts — Native Agent Runtime (no Claude Code CLI).
 *
 * Uses Vercel AI SDK streamText() internally via agent-loop.ts.
 * This is the default runtime when Claude Code CLI is not installed.
 *
 * Phase A wiring: when CODEPILOT_ORCHESTRATOR !== '0', the stream() method
 * routes through the plugin orchestrator layer (orchestrator → strategy →
 * agent-loop). Set CODEPILOT_ORCHESTRATOR=0 to fall back to the legacy
 * direct-call path for rollback safety.
 */

import type { AgentRuntime, RuntimeStreamOptions } from './types';
import { runAgentLoop } from '../agent-loop';
import { buildSystemPrompt } from '../agent-system-prompt';
import { resolveProvider } from '../provider-resolver';
import { syncMcpConnections, disposeAll as disposeMcp } from '../mcp-connection-manager';
import { isOAuthUsable } from '../openai-oauth-manager';
import { isXaiOAuthUsable } from '../xai-oauth-manager';
import { wrapController } from '../safe-stream';
import {
  disposeNativeTurns,
  interruptNativeTurn,
  registerNativeTurnController,
  unregisterNativeTurnController,
} from './native-turn-registry';

// Orchestrator layer — importing index triggers registry population
import { resolveOrchestrator, DEFAULT_PROFILE, getProfile } from '../orchestrator';
import type { OrchestrationContext } from '../orchestrator';
import type { AgentProfile } from '../orchestrator/agent-profile';
import { loadProjectAgentProfiles } from '../orchestrator/project-config';
import { resolveContextPolicy } from '../execution/context-policy';
import { resolvePersistenceHook } from '../execution/persistence-hook';
import { bypassBroker, type PermissionBroker } from '../permission';
import { createRuleBasedBroker } from '../permission/rule-based';
import { getAgentProfile } from '../db';

// ── Feature flag ───────────────────────────────────────────────

const USE_ORCHESTRATOR = process.env.CODEPILOT_ORCHESTRATOR !== '0';

// ── Profile resolution ─────────────────────────────────────────

/** Cache project profiles per working directory (invalidated on change) */
const projectProfilesLoaded = new Set<string>();

function resolveAgentProfile(options: RuntimeStreamOptions, cwd: string): AgentProfile {
  const ro = options.runtimeOptions || {};
  const profileId = ro.agentProfileId as string | undefined;

  if (!profileId) return DEFAULT_PROFILE;

  // 1. Check in-memory registry (populated by project config or prior loads)
  const registered = getProfile(profileId);
  if (registered) return registered;

  // 2. Try loading project config if not yet loaded for this cwd
  if (!projectProfilesLoaded.has(cwd)) {
    projectProfilesLoaded.add(cwd);
    loadProjectAgentProfiles(cwd);
    const fromProject = getProfile(profileId);
    if (fromProject) return fromProject;
  }

  // 3. Try DB
  const row = getAgentProfile(profileId);
  if (row) {
    try {
      return JSON.parse(row.profile_json) as AgentProfile;
    } catch { /* fall through */ }
  }

  return DEFAULT_PROFILE;
}

export const nativeRuntime: AgentRuntime = {
  id: 'native',
  displayName: 'Native (AI SDK)',
  description: 'Built-in agent runtime powered by Vercel AI SDK. No external CLI required.',

  stream(options: RuntimeStreamOptions): ReadableStream<string> {
    if (USE_ORCHESTRATOR) {
      return streamViaOrchestrator(options);
    }
    return streamLegacy(options);
  },

  interrupt(sessionId: string): void {
    interruptNativeTurn(sessionId);
  },

  isAvailable(): boolean {
    // Native runtime is available whenever any provider has credentials.
    // A lightweight check — don't resolve the full provider, just check if
    // there's any configured provider, env-based credentials, or OpenAI OAuth.
    try {
      const resolved = resolveProvider({ callScene: 'connection_test' });
      if (resolved.hasCredentials || !!resolved.provider) return true;
    } catch { /* fall through */ }

    // Also check OpenAI OAuth — it's a virtual provider not in the DB
    try {
      if (isOAuthUsable()) return true;
    } catch { /* module not available */ }

    try {
      if (isXaiOAuthUsable()) return true;
    } catch { /* module not available */ }

    return false;
  },

  dispose(): void {
    disposeNativeTurns();
    // Clean up MCP connections
    disposeMcp().catch(() => {});
  },
};

// ── Orchestrator path (Phase A) ────────────────────────────────

function streamViaOrchestrator(options: RuntimeStreamOptions): ReadableStream<string> {
  const cwd = options.workingDirectory || process.cwd();

  const systemPrompt = buildSystemPrompt({
    userPrompt: options.systemPrompt,
    workingDirectory: cwd,
    modelId: options.model,
  });

  // Create or reuse abort controller
  const abortController = options.abortController || new AbortController();
  registerNativeTurnController(options.sessionId, abortController);

  const ro = options.runtimeOptions || {};
  const maxSteps = (ro.maxSteps as number) || undefined;
  const files = ro.files as import('@/types').FileAttachment[] | undefined;

  // Resolve profile: runtimeOptions.agentProfileId > project config > DB > DEFAULT_PROFILE
  const profile = resolveAgentProfile(options, cwd);

  // Build permission broker
  const permissionBroker: PermissionBroker = options.bypassPermissions
    ? bypassBroker
    : createRuleBasedBroker((options.permissionMode || 'normal') as 'explore' | 'normal' | 'trust');

  // Build OrchestrationContext
  const orchCtx: OrchestrationContext = {
    prompt: options.prompt,
    sessionId: options.sessionId,
    workingDirectory: cwd,
    systemPrompt,
    model: null as never, // resolved by singleOrchestrator via createModel()
    modelId: options.model || '',
    abortSignal: abortController.signal,
    emitSSE: () => {}, // react-loop handles SSE internally
    profile,
    permissionBroker,
    contextPolicy: resolveContextPolicy(profile.contextPolicyId),
    persistence: resolvePersistenceHook('db'),
    // Model configuration
    thinking: options.thinking,
    effort: options.effort,
    context1m: options.context1m,
    temperature: options.temperature,
    topP: options.topP,
    topK: options.topK,
    // Control
    maxSteps: maxSteps ?? profile.maxSteps ?? 50,
    autoTrigger: options.autoTrigger,
    onRuntimeStatusChange: options.onRuntimeStatusChange,
    // Passthrough fields
    callScene: options.callScene,
    bypassPermissions: options.bypassPermissions,
    mcpServers: options.mcpServers,
    files,
    providerId: options.providerId,
    sessionProviderId: options.sessionProviderId,
  };

  // Resolve orchestrator and execute
  const orchestrator = resolveOrchestrator(profile.orchestrator);
  const stream = orchestrator.orchestrate(orchCtx);

  // Wrap with cleanup
  return wrapWithCleanup(stream, options.sessionId, abortController);
}

// ── Legacy path (rollback) ─────────────────────────────────────

function streamLegacy(options: RuntimeStreamOptions): ReadableStream<string> {
  const cwd = options.workingDirectory || process.cwd();

  const systemPrompt = buildSystemPrompt({
    userPrompt: options.systemPrompt,
    workingDirectory: cwd,
    modelId: options.model,
  });

  // Create or reuse abort controller
  const abortController = options.abortController || new AbortController();
  registerNativeTurnController(options.sessionId, abortController);

  const ro = options.runtimeOptions || {};
  const maxSteps = (ro.maxSteps as number) || undefined;
  const files = ro.files as import('@/types').FileAttachment[] | undefined;

  const stream = runAgentLoop({
    prompt: options.prompt,
    callScene: options.callScene,
    sessionId: options.sessionId,
    providerId: options.providerId,
    sessionProviderId: options.sessionProviderId,
    model: options.model,
    systemPrompt,
    workingDirectory: cwd,
    abortController,
    // tools assembled inside agent-loop with permission context
    permissionMode: options.permissionMode,
    bypassPermissions: options.bypassPermissions,
    mcpServers: options.mcpServers,
    thinking: options.thinking,
    effort: options.effort,
    context1m: options.context1m,
    temperature: options.temperature,
    topP: options.topP,
    topK: options.topK,
    maxSteps,
    autoTrigger: options.autoTrigger,
    onRuntimeStatusChange: options.onRuntimeStatusChange,
    files,
  });

  return wrapWithCleanup(stream, options.sessionId, abortController);
}

// ── Shared helpers ─────────────────────────────────────────────

function wrapWithCleanup(stream: ReadableStream<string>, sessionId: string, abortController: AbortController): ReadableStream<string> {
  const reader = stream.getReader();
  return new ReadableStream<string>({
    async start(controllerRaw) {
      const controller = wrapController(controllerRaw);
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          controller.enqueue(value);
          if (controller.closed) break; // consumer aborted — stop pulling
        }
      } finally {
        unregisterNativeTurnController(sessionId, abortController);
        controller.close();
      }
    },
  });
}
