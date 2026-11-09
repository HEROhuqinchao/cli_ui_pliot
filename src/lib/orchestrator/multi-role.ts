/**
 * orchestrator/multi-role.ts — MultiRoleOrchestrator: multi-agent collaboration.
 *
 * Supports three collaboration modes:
 * - sequential: roles execute in order, each receiving the previous role's output
 * - parallel: all roles execute concurrently, outputs merged by a synthesis step
 * - debate: roles execute in rounds, challenging each other until consensus
 *
 * Each role gets its own ExecutionStrategy instance with role-specific
 * system prompt, tool set, and step budget.
 */

import type { AgentOrchestrator, OrchestrationContext } from './types';
import { registerOrchestrator } from './types';
import type { MultiRoleConfig, RoleDefinition, SynthesisConfig } from './agent-profile';
import { resolveStrategy, type ExecutionContext } from '../execution/types';
import { assembleToolSet } from '../tools/tool-registry';
import { resolveContextPolicy } from '../execution/context-policy';
import { resolvePersistenceHook } from '../execution/persistence-hook';
import { createModel } from '../ai-provider';
import { syncMcpConnections } from '../mcp-connection-manager';
import type { SSEEvent } from '@/types';

// ── Helpers ────────────────────────────────────────────────────

function formatSSE(event: SSEEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

/**
 * Collect all text output from a strategy execution stream.
 * Returns the concatenated text and forwards SSE events with role tags.
 */
async function executeRole(
  role: RoleDefinition,
  prompt: string,
  ctx: OrchestrationContext,
  controller: { enqueue(chunk: string): void },
  roleIndex: number,
): Promise<string> {
  const strategy = resolveStrategy(role.strategyId);

  // Resolve model for this role (may override the global model)
  const { languageModel, modelId, config, isThirdPartyProxy } = createModel({
    callScene: ctx.callScene,
    providerId: ctx.providerId,
    sessionProviderId: ctx.sessionProviderId,
    model: role.model || ctx.modelId || undefined,
  });

  // Assemble role-specific tools
  const toolResult = await assembleToolSet(
    {
      workingDirectory: ctx.workingDirectory,
      sessionId: ctx.sessionId,
      prompt,
      providerId: ctx.providerId,
      sessionProviderId: ctx.sessionProviderId,
      model: modelId,
      permissionMode: ctx.profile.permissionMode,
    },
    role.toolProviderIds.length > 0 ? role.toolProviderIds : undefined,
  );

  // Build role-specific system prompt
  const roleSystemPrompt = [
    `You are "${role.name}" — ${role.role}`,
    `Your goal: ${role.goal}`,
    ctx.systemPrompt || '',
    ...toolResult.systemPrompts,
  ].filter(Boolean).join('\n\n');

  // Build execution context
  const execCtx: ExecutionContext = {
    prompt,
    sessionId: `${ctx.sessionId}__role_${role.id}`,
    messages: [{ role: 'user' as const, content: prompt }],
    systemPrompt: roleSystemPrompt,
    model: languageModel,
    modelId,
    tools: toolResult.tools,
    permissionBroker: ctx.permissionBroker,
    contextPolicy: resolveContextPolicy(ctx.profile.contextPolicyId),
    persistence: resolvePersistenceHook('noop'), // roles don't persist independently
    maxSteps: role.maxSteps ?? 30,
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
      _modelConfig: config,
      _isThirdPartyProxy: isThirdPartyProxy,
    },
    onRuntimeStatusChange: undefined, // only top-level reports status
    autoTrigger: true, // skip rewind points for sub-executions
    callScene: ctx.callScene,
    providerId: ctx.providerId,
    sessionProviderId: ctx.sessionProviderId,
    bypassPermissions: ctx.bypassPermissions,
    mcpServers: ctx.mcpServers,
  };

  // Execute and collect output
  const stream = strategy.execute(execCtx);
  const reader = stream.getReader();
  let collectedText = '';

  // Emit role start marker
  controller.enqueue(formatSSE({
    type: 'status',
    data: JSON.stringify({
      subtype: 'role_start',
      role: role.name,
      roleId: role.id,
      roleIndex,
    }),
  }));

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      // Forward SSE lines, tagging text events with role info
      if (value.startsWith('data: ')) {
        try {
          const event = JSON.parse(value.slice(6)) as SSEEvent;
          if (event.type === 'text') {
            collectedText += event.data;
            // Re-emit with role tag
            controller.enqueue(formatSSE({
              type: 'text',
              data: event.data,
            }));
          } else if (event.type === 'thinking') {
            controller.enqueue(value);
          } else if (event.type === 'tool_use' || event.type === 'tool_result') {
            controller.enqueue(value);
          }
          // Skip status/result/done events from sub-executions
        } catch {
          controller.enqueue(value);
        }
      } else {
        controller.enqueue(value);
      }
    }
  } finally {
    reader.releaseLock();
  }

  // Emit role end marker
  controller.enqueue(formatSSE({
    type: 'status',
    data: JSON.stringify({
      subtype: 'role_end',
      role: role.name,
      roleId: role.id,
      roleIndex,
      outputLength: collectedText.length,
    }),
  }));

  return collectedText;
}

/**
 * Synthesize multiple role outputs into a final response.
 */
async function synthesize(
  outputs: Array<{ role: RoleDefinition; text: string }>,
  synthesis: SynthesisConfig | undefined,
  ctx: OrchestrationContext,
  controller: { enqueue(chunk: string): void },
): Promise<void> {
  if (outputs.length === 1) {
    // Single output — no synthesis needed
    return;
  }

  const synthesisPrompt = synthesis?.prompt
    || 'Synthesize the following outputs from different team members into a single coherent response. Resolve any contradictions and present a unified answer.\n\n{{outputs}}';

  const outputsText = outputs
    .map((o, i) => `## ${o.role.name} (${o.role.role})\n\n${o.text}`)
    .join('\n\n---\n\n');

  const prompt = synthesisPrompt.replace('{{outputs}}', outputsText);

  // Use a lightweight synthesis role
  const synthRole: RoleDefinition = {
    id: 'synthesizer',
    name: 'Synthesizer',
    role: 'Expert at combining multiple perspectives into a unified response',
    goal: 'Produce a single coherent answer from multiple inputs',
    strategyId: synthesis?.strategyId || 'react-loop',
    toolProviderIds: [], // synthesis doesn't need tools
    maxSteps: 5,
  };

  controller.enqueue(formatSSE({
    type: 'status',
    data: JSON.stringify({ subtype: 'synthesis_start' }),
  }));

  await executeRole(synthRole, prompt, ctx, controller, outputs.length);

  controller.enqueue(formatSSE({
    type: 'status',
    data: JSON.stringify({ subtype: 'synthesis_end' }),
  }));
}

// ── Orchestrator implementation ────────────────────────────────

const activeSessions = new Map<string, { abort: () => void }>();

export const multiRoleOrchestrator: AgentOrchestrator = {
  id: 'multi-role',
  displayName: 'Multi-Role Team',
  mode: 'multi-role',

  orchestrate(ctx: OrchestrationContext): ReadableStream<string> {
    const config = ctx.profile.multiRole;
    if (!config || config.roles.length === 0) {
      return new ReadableStream<string>({
        start(controller) {
          controller.enqueue(formatSSE({
            type: 'error',
            data: JSON.stringify({ error: 'Multi-role orchestrator requires profile.multiRole with at least one role' }),
          }));
          controller.enqueue(formatSSE({ type: 'done', data: '' }));
          controller.close();
        },
      });
    }

    return new ReadableStream<string>({
      async start(controller) {
        const abortController = new AbortController();
        activeSessions.set(ctx.sessionId, { abort: () => abortController.abort() });

        try {
          // MCP sync (shared across roles)
          if (ctx.mcpServers && Object.keys(ctx.mcpServers).length > 0) {
            await syncMcpConnections(ctx.mcpServers);
          }

          // Emit init
          controller.enqueue(formatSSE({
            type: 'status',
            data: JSON.stringify({
              status: 'init',
              session_id: ctx.sessionId,
              model: ctx.modelId,
              tools: [],
              output_style: 'streaming',
              collaboration: config.collaboration,
              roles: config.roles.map(r => r.name),
            }),
          }));

          ctx.onRuntimeStatusChange?.('streaming');

          if (config.collaboration === 'sequential') {
            // ── Sequential: each role builds on the previous ──
            let currentPrompt = ctx.prompt;
            const outputs: Array<{ role: RoleDefinition; text: string }> = [];

            for (let i = 0; i < config.roles.length; i++) {
              if (abortController.signal.aborted) break;
              const role = config.roles[i];
              const text = await executeRole(role, currentPrompt, ctx, controller, i);
              outputs.push({ role, text });
              // Next role receives previous output as context
              currentPrompt = `Previous team member "${role.name}" produced:\n\n${text}\n\nNow continue with the original task: ${ctx.prompt}`;
            }

          } else if (config.collaboration === 'parallel') {
            // ── Parallel: all roles execute concurrently ──
            const promises = config.roles.map((role, i) =>
              executeRole(role, ctx.prompt, ctx, controller, i)
                .then(text => ({ role, text })),
            );

            const outputs = await Promise.all(promises);

            // Synthesis step
            if (!abortController.signal.aborted) {
              await synthesize(outputs, config.synthesis, ctx, controller);
            }

          } else if (config.collaboration === 'debate') {
            // ── Debate: rounds of challenge until convergence ──
            const MAX_ROUNDS = 3;
            let roundOutputs: Array<{ role: RoleDefinition; text: string }> = [];

            for (let round = 0; round < MAX_ROUNDS; round++) {
              if (abortController.signal.aborted) break;

              controller.enqueue(formatSSE({
                type: 'status',
                data: JSON.stringify({ subtype: 'debate_round', round: round + 1, maxRounds: MAX_ROUNDS }),
              }));

              const debatePrompt = round === 0
                ? ctx.prompt
                : `Round ${round + 1} of debate. Previous arguments:\n\n${roundOutputs.map(o => `${o.role.name}: ${o.text.slice(0, 2000)}`).join('\n\n')}\n\nChallenge the above arguments and refine your position on: ${ctx.prompt}`;

              const promises = config.roles.map((role, i) =>
                executeRole(role, debatePrompt, ctx, controller, i)
                  .then(text => ({ role, text })),
              );

              roundOutputs = await Promise.all(promises);
            }

            // Final synthesis after debate
            if (!abortController.signal.aborted) {
              await synthesize(roundOutputs, config.synthesis, ctx, controller);
            }
          }

          // Emit result
          controller.enqueue(formatSSE({
            type: 'result',
            data: JSON.stringify({
              usage: { input_tokens: 0, output_tokens: 0 },
              session_id: ctx.sessionId,
              num_turns: config.roles.length,
              collaboration: config.collaboration,
            }),
          }));

          ctx.onRuntimeStatusChange?.('idle');
        } catch (err) {
          if (!abortController.signal.aborted) {
            controller.enqueue(formatSSE({
              type: 'error',
              data: JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
            }));
          }
          ctx.onRuntimeStatusChange?.('idle');
        } finally {
          activeSessions.delete(ctx.sessionId);
          controller.enqueue(formatSSE({ type: 'done', data: '' }));
          controller.close();
        }
      },
    });
  },

  interrupt(sessionId: string): void {
    const session = activeSessions.get(sessionId);
    if (session) {
      session.abort();
      activeSessions.delete(sessionId);
    }
  },
};

// ── Auto-registration ──────────────────────────────────────────
registerOrchestrator(multiRoleOrchestrator);
