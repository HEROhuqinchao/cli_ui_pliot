/**
 * tools/tool-registry.ts — ToolProvider registration and assembly.
 *
 * Central registry for all ToolProviders. assembleToolSet() replaces
 * the hardcoded logic in agent-tools.ts's assembleTools(): instead of
 * directly importing createBuiltinTools / getBuiltinTools / buildMcpToolSet,
 * it iterates registered providers by priority and merges their output.
 *
 * Migration path (Stage 2):
 * 1. Register BuiltinCodingProvider, BuiltinMcpProvider, ExternalMcpProvider
 *    as wrappers around the existing functions.
 * 2. agent-tools.ts's assembleTools() delegates to assembleToolSet() here.
 * 3. Once stable, remove the old assembleTools() and point callers here.
 */

import type { ToolSet } from 'ai';
import type { ToolProvider, ToolProviderContext, AssembledToolSet } from './tool-provider';

// ── Registry ───────────────────────────────────────────────────

const providers = new Map<string, ToolProvider>();

/**
 * Register a tool provider. Overwrites if same id exists.
 */
export function registerToolProvider(provider: ToolProvider): void {
  providers.set(provider.id, provider);
}

/**
 * Unregister a tool provider by id.
 */
export function unregisterToolProvider(id: string): void {
  providers.delete(id);
}

/**
 * Get a registered provider by id.
 */
export function getToolProvider(id: string): ToolProvider | undefined {
  return providers.get(id);
}

/**
 * List all registered providers, sorted by priority (ascending).
 */
export function getToolProviders(): ToolProvider[] {
  return Array.from(providers.values()).sort((a, b) => a.priority - b.priority);
}

// ── Assembly ───────────────────────────────────────────────────

/**
 * Assemble the final tool set from all registered providers.
 *
 * Replaces the hardcoded assembleTools() in agent-tools.ts.
 * Providers are called in priority order; same-name tools from
 * later providers override earlier ones (last-write-wins).
 *
 * @param ctx - Context for tool assembly (working dir, session, mode, etc.)
 * @param filterIds - Optional: only include these provider ids (for AgentProfile.toolProviderIds)
 */
export async function assembleToolSet(
  ctx: ToolProviderContext,
  filterIds?: string[],
): Promise<AssembledToolSet> {
  const sorted = getToolProviders();
  const activeProviders: string[] = [];
  let mergedTools: ToolSet = {};
  const systemPrompts: string[] = [];

  for (const provider of sorted) {
    // Apply filter if specified (AgentProfile.toolProviderIds)
    if (filterIds && !filterIds.includes(provider.id)) {
      continue;
    }

    // Check availability
    if (provider.isAvailable && !provider.isAvailable(ctx)) {
      continue;
    }

    try {
      const tools = await provider.provideTools(ctx);
      mergedTools = { ...mergedTools, ...tools };
      activeProviders.push(provider.id);

      // Collect system prompts
      if (provider.provideSystemPrompts) {
        const prompts = provider.provideSystemPrompts(ctx);
        systemPrompts.push(...prompts);
      }
    } catch (err) {
      // Provider failure is non-fatal — log and continue
      console.warn(
        `[tool-registry] Provider "${provider.id}" failed: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  return { tools: mergedTools, systemPrompts, activeProviders };
}

/**
 * Synchronous variant for providers that don't need async initialization.
 * Falls back to empty if any provider is async-only.
 */
export function assembleToolSetSync(
  ctx: ToolProviderContext,
  filterIds?: string[],
): AssembledToolSet {
  const sorted = getToolProviders();
  const activeProviders: string[] = [];
  let mergedTools: ToolSet = {};
  const systemPrompts: string[] = [];

  for (const provider of sorted) {
    if (filterIds && !filterIds.includes(provider.id)) continue;
    if (provider.isAvailable && !provider.isAvailable(ctx)) continue;

    try {
      const result = provider.provideTools(ctx);
      // Only handle sync results
      if (result && !(result instanceof Promise)) {
        mergedTools = { ...mergedTools, ...result };
        activeProviders.push(provider.id);

        if (provider.provideSystemPrompts) {
          systemPrompts.push(...provider.provideSystemPrompts(ctx));
        }
      }
    } catch (err) {
      console.warn(
        `[tool-registry] Provider "${provider.id}" failed (sync): ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  return { tools: mergedTools, systemPrompts, activeProviders };
}
