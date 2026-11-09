/**
 * orchestrator/single.ts — SingleOrchestrator: default one-agent execution.
 *
 * Phase B: the orchestrator resolves ALL dependencies (model, tools, messages,
 * context policy, persistence) and passes them into ExecutionContext. The
 * ExecutionStrategy (react-loop) is now fully self-contained and does NOT
 * delegate to agent-loop.ts.
 *
 * This orchestrator is ALWAYS registered and serves as the fallback
 * when no explicit orchestration mode is specified.
 */

import type { AgentOrchestrator, OrchestrationContext } from './types';
import { registerOrchestrator } from './types';
import { resolveStrategy, type ExecutionContext } from '../execution/types';
import { assembleToolSet } from '../tools/tool-registry';
import { resolveContextPolicy } from '../execution/context-policy';
import { resolvePersistenceHook } from '../execution/persistence-hook';
import { buildCoreMessages } from '../message-builder';
import { getMessages } from '../db';
import { createModel } from '../ai-provider';
import { syncMcpConnections } from '../mcp-connection-manager';

// ── Active sessions (for interrupt) ────────────────────────────

const activeStrategies = new Map<string, { interrupt: (id: string) => void }>();

// ── Implementation ─────────────────────────────────────────────

export const singleOrchestrator: AgentOrchestrator = {
  id: 'single',
  displayName: 'Single Agent',
  mode: 'single',

  orchestrate(ctx: OrchestrationContext): ReadableStream<string> {
    const { profile } = ctx;

    // 1. Resolve execution strategy from profile
    const strategy = resolveStrategy(profile.strategyId);

    // Track for interrupt
    activeStrategies.set(ctx.sessionId, strategy);

    // The orchestrator assembles all dependencies before calling execute().
    return new ReadableStream<string>({
      async start(controller) {
        try {
          // ── B1: Resolve model ──
          const { languageModel, modelId, config, isThirdPartyProxy } = createModel({
            callScene: ctx.callScene,
            providerId: ctx.providerId,
            sessionProviderId: ctx.sessionProviderId,
            model: ctx.modelId || undefined,
          });

          // ── MCP sync (tools may depend on MCP connections) ──
          if (ctx.mcpServers && Object.keys(ctx.mcpServers).length > 0) {
            await syncMcpConnections(ctx.mcpServers);
          }

          // ── B2: Assemble tools ──
          const toolResult = await assembleToolSet(
            {
              workingDirectory: ctx.workingDirectory,
              sessionId: ctx.sessionId,
              prompt: ctx.prompt,
              providerId: ctx.providerId,
              sessionProviderId: ctx.sessionProviderId,
              model: modelId,
              permissionMode: profile.permissionMode,
            },
            profile.toolProviderIds.length > 0 ? profile.toolProviderIds : undefined,
          );

          // Build effective system prompt
          const effectiveSystemPrompt =
            [ctx.systemPrompt, ...toolResult.systemPrompts].filter(Boolean).join('\n\n') ||
            undefined;

          // ── Load conversation history ──
          const { messages: dbMessages } = getMessages(ctx.sessionId, {
            limit: 200,
            excludeHeartbeatAck: true,
          });
          const messages = buildCoreMessages(dbMessages);

          // Append current prompt if not already in history
          if (
            ctx.autoTrigger ||
            messages.length === 0 ||
            messages[messages.length - 1]?.role !== 'user'
          ) {
            messages.push({ role: 'user' as const, content: ctx.prompt });
          }

          // Resolve context policy and persistence
          const contextPolicy = resolveContextPolicy(profile.contextPolicyId);
          const persistence = resolvePersistenceHook('db');

          // ── Build ExecutionContext with all resolved dependencies ──
          const execCtx: ExecutionContext = {
            prompt: ctx.prompt,
            sessionId: ctx.sessionId,
            messages,
            systemPrompt: effectiveSystemPrompt,
            model: languageModel,
            modelId,
            tools: toolResult.tools,
            permissionBroker: ctx.permissionBroker,
            contextPolicy,
            persistence,
            maxSteps: profile.maxSteps ?? 50,
            abortSignal: ctx.abortSignal,
            emitSSE: ctx.emitSSE,
            workingDirectory: ctx.workingDirectory,
            thinking: ctx.thinking,
            effort: ctx.effort,
            context1m: ctx.context1m,
            temperature: ctx.temperature,
            topP: ctx.topP,
            topK: ctx.topK,
            strategyOptions: {
              ...profile.strategyOptions,
              // Pass model config details needed by react-loop
              _modelConfig: config,
              _isThirdPartyProxy: isThirdPartyProxy,
            },
            onRuntimeStatusChange: ctx.onRuntimeStatusChange,
            autoTrigger: ctx.autoTrigger,
            callScene: ctx.callScene,
            providerId: ctx.providerId,
            sessionProviderId: ctx.sessionProviderId,
            bypassPermissions: ctx.bypassPermissions,
            mcpServers: ctx.mcpServers,
            files: ctx.files,
          };

          // Execute — pipe strategy output to our controller
          const stream = strategy.execute(execCtx);
          const reader = stream.getReader();

          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              controller.enqueue(value);
            }
            controller.close();
          } catch (err) {
            controller.error(err);
          } finally {
            activeStrategies.delete(ctx.sessionId);
          }
        } catch (err) {
          controller.error(err);
          activeStrategies.delete(ctx.sessionId);
        }
      },
    });
  },

  interrupt(sessionId: string): void {
    const strategy = activeStrategies.get(sessionId);
    if (strategy) {
      strategy.interrupt(sessionId);
      activeStrategies.delete(sessionId);
    }
  },
};

// ── Auto-registration ─────────────────────────────────────────
registerOrchestrator(singleOrchestrator);
