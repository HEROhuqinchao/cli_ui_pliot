/**
 * execution/react-loop.ts — ReAct Loop execution strategy (Phase B: self-contained).
 *
 * This is the full think-act loop extracted from agent-loop.ts. It uses
 * injected dependencies from ExecutionContext:
 *   - ctx.model / ctx.modelId — resolved LanguageModel (from orchestrator)
 *   - ctx.tools — assembled ToolSet (from orchestrator)
 *   - ctx.messages — conversation history (from orchestrator)
 *   - ctx.contextPolicy — message pruning strategy
 *   - ctx.persistence — DB write hooks
 *   - ctx.permissionBroker — tool authorization
 *
 * The strategy creates its own ReadableStream and enqueues SSE lines directly.
 * agent-loop.ts is no longer used when this strategy is active.
 */

import { streamText, type ModelMessage } from 'ai';
import type { ExecutionStrategy, ExecutionContext } from './types';
import type { SSEEvent, TokenUsage, MediaBlock } from '@/types';
import { registerStrategy } from './types';
import { wrapController } from '../safe-stream';
import { pruneOldToolResults } from '../context-pruner';
import { sanitizeClaudeModelOptions } from '../claude-model-options';
import { buildAnthropicProviderOptions } from '../agent-loop-anthropic-wire';
import { buildSamplingIgnoredNotice } from '../anthropic-sampling-notice';
import { buildXaiProviderOptions } from '../xai-provider-options';
import { shouldSuggestSkill, buildSkillNudgeStatusEvent } from '../skill-nudge';
import { emit as emitEvent } from '../runtime/event-bus';
import { createCheckpoint } from '../file-checkpoint';
import { subscribeBuiltinEvents } from '../harness/builtin-event-bus';
import { reportNativeError } from '../error-classifier';
import { buildNativeErrorEventData } from '../agent-loop-error-event';
import { buildToolErrorResultData } from '../agent-loop-tool-error';
import {
  createNativeTimeoutController,
  resolveNativeTimeoutConfig,
  TIMEOUT_CATEGORY,
} from '../native-timeout';
import { isAiSdkTraceEnabled, createRedactedTraceTelemetry } from '../aisdk-trace';
import { READ_ONLY_TOOLS } from '../agent-tools';
import type { AiSdkConfig } from '../provider-resolver';

// ── Constants ──────────────────────────────────────────────────

const DEFAULT_MAX_STEPS = 50;
const DOOM_LOOP_THRESHOLD = 3;
const KEEPALIVE_INTERVAL_MS = 15_000;

// ── Active sessions for interrupt ──────────────────────────────

const activeAbortControllers = new Map<string, AbortController>();

// ── Helpers ────────────────────────────────────────────────────

function formatSSE(event: SSEEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

async function buildNativeAccountingSnapshot(
  records: readonly import('../harness/auto-invoke-accounting').ToolInvocationRecord[],
  workspacePath: string,
): Promise<import('@/types').RuntimeContextAccountingSnapshot | undefined> {
  try {
    const { collectAutoInvokeSnapshot, resolveWorkspaceClaudeMdRules } =
      await import('@/lib/harness/auto-invoke-accounting');
    return collectAutoInvokeSnapshot({
      workspacePath,
      records,
      producedBy: 'codepilot_runtime',
      unsupported: ['system_prompt', 'memory', 'files_attachments'],
      resolveRulesEntry: resolveWorkspaceClaudeMdRules,
    });
  } catch {
    return undefined;
  }
}

// ── Strategy implementation ────────────────────────────────────

export const reactLoopStrategy: ExecutionStrategy = {
  id: 'react-loop',
  displayName: 'ReAct Loop',
  description:
    'Standard think-act loop: model reasons, calls tools, observes results, repeats until done. ' +
    'Equivalent to the default CodePilot native execution behavior.',

  execute(ctx: ExecutionContext): ReadableStream<string> {
    const {
      prompt, sessionId, messages: historyMessages, systemPrompt,
      model: languageModel, modelId, tools, maxSteps = DEFAULT_MAX_STEPS,
      abortSignal, workingDirectory, thinking, effort, context1m,
      temperature, topP, topK, onRuntimeStatusChange, autoTrigger,
      contextPolicy, persistence, strategyOptions,
    } = ctx;

    // Extract model config passed by orchestrator via strategyOptions
    const modelConfig = strategyOptions?._modelConfig as AiSdkConfig | undefined;
    const isThirdPartyProxy = (strategyOptions?._isThirdPartyProxy as boolean) ?? false;

    // Create internal abort controller linked to external signal
    const abortController = new AbortController();
    activeAbortControllers.set(sessionId, abortController);
    if (abortSignal.aborted) {
      abortController.abort();
    } else {
      abortSignal.addEventListener('abort', () => abortController.abort(), { once: true });
    }

    return new ReadableStream<string>({
      async start(controllerRaw) {
        const controller = wrapController(controllerRaw);

        // Keep-alive timer
        const keepAliveTimer = setInterval(() => {
          controller.enqueue(formatSSE({ type: 'keep_alive', data: '' }));
        }, KEEPALIVE_INTERVAL_MS);

        // Timeout controller
        const timeoutCtl = createNativeTimeoutController(
          resolveNativeTimeoutConfig(undefined),
          abortController.signal,
        );

        // Trace integration
        const traceIntegration = isAiSdkTraceEnabled() ? createRedactedTraceTelemetry() : null;

        // Media side-channel
        const pendingMediaByCallId = new Map<string, MediaBlock[]>();

        // Tool invocation accumulator
        const { ToolInvocationAccumulator } = await import('@/lib/harness/auto-invoke-accounting');
        const toolInvocationAccumulator = new ToolInvocationAccumulator();

        // Subscribe builtin events (media side-channel)
        const unsubscribeMediaSideChannel = subscribeBuiltinEvents(
          sessionId,
          (event) => {
            if (event.type !== 'tool_completed') return;
            const media = event.media;
            if (!media || media.length === 0) return;
            const callId = event.toolId;
            if (!callId) return;
            pendingMediaByCallId.set(callId, [...media]);
          },
        );

        try {
          // ── Emit status init ──
          const hasTools = tools && Object.keys(tools).length > 0;
          controller.enqueue(formatSSE({
            type: 'status',
            data: JSON.stringify({
              status: 'init',
              session_id: sessionId,
              model: modelId,
              tools: hasTools ? Object.keys(tools) : [],
              output_style: 'streaming',
            }),
          }));

          // ── Emit rewind point + checkpoint ──
          if (!autoTrigger) {
            controller.enqueue(formatSSE({
              type: 'rewind_point',
              data: JSON.stringify({ session_id: sessionId }),
            }));
            try {
              createCheckpoint(sessionId, '', workingDirectory || process.cwd());
            } catch { /* non-fatal */ }
          }

          // ── Loop state ──
          emitEvent('session:start', { sessionId, model: modelId });
          onRuntimeStatusChange?.('streaming');
          timeoutCtl.onRunStart();

          let step = 0;
          const totalUsage: TokenUsage = { input_tokens: 0, output_tokens: 0 };
          let lastToolNames: string[] = [];
          let doomLoopCount = 0;
          const distinctTools = new Set<string>();
          let messages: ModelMessage[] = [...historyMessages];
          let samplingNoticeSent = false;

          // ── Main while loop ──
          while (step < maxSteps) {
            step++;

            // Sanitize model options
            const sanitized = sanitizeClaudeModelOptions({
              model: modelId, thinking, effort, context1m, temperature, topP, topK,
            });

            // Thinking-forced-on notice (one-shot, step 1 only)
            if (sanitized.thinkingForcedOn && step === 1) {
              controller.enqueue(formatSSE({
                type: 'status',
                data: JSON.stringify({
                  subtype: 'thinking_forced',
                  message: 'Extended thinking is enabled for this model',
                }),
              }));
            }

            // Sampling notice (one-shot)
            if (!samplingNoticeSent) {
              const samplingNotice = buildSamplingIgnoredNotice({
                runtime: 'native',
                model: modelId,
                sanitized,
              });
              if (samplingNotice && samplingNotice.unsent && samplingNotice.unsent.length > 0) {
                samplingNoticeSent = true;
                controller.enqueue(formatSSE({
                  type: 'status',
                  data: JSON.stringify({
                    subtype: 'sampling_ignored',
                    code: samplingNotice.code,
                    reason: samplingNotice.reason,
                    params: samplingNotice.params,
                  }),
                }));
              }
            }

            // Provider options
            let providerOptions: Record<string, unknown> | undefined;
            const sdkType = modelConfig?.sdkType;
            if (sdkType === 'anthropic' || sdkType === 'claude-code-compat') {
              const wire = buildAnthropicProviderOptions({
                isThirdPartyProxy,
                model: modelId,
                sanitized,
              });
              if (wire.effortDroppedUnsupportedModel && step === 1) {
                controller.enqueue(formatSSE({
                  type: 'status',
                  data: JSON.stringify({ subtype: 'effort_dropped', reason: 'unsupported_model' }),
                }));
              }
              if (wire.effortDroppedForProxy && step === 1) {
                controller.enqueue(formatSSE({
                  type: 'status',
                  data: JSON.stringify({ subtype: 'effort_dropped', reason: 'third_party_proxy' }),
                }));
              }
              if (wire.anthropic) {
                providerOptions = { anthropic: wire.anthropic };
              }
            } else if (modelConfig?.useResponsesApi) {
              providerOptions = {
                openai: {
                  instructions: systemPrompt,
                  store: false,
                  reasoningEffort: 'medium',
                  textVerbosity: 'medium',
                },
              };
            }
            if (sdkType === 'xai') {
              providerOptions = {
                ...providerOptions,
                xai: buildXaiProviderOptions(sanitized.effort),
              };
            }

            // B4: Context pruning via injected ContextPolicy
            const prunedMessages = contextPolicy.id === 'prune-old'
              ? pruneOldToolResults(messages)
              : contextPolicy.prune(messages, {
                  contextWindow: 200_000,
                  reservedForOutput: 16_384,
                  reservedForSystem: 8_192,
                  get availableForHistory() { return this.contextWindow - this.reservedForOutput - this.reservedForSystem; },
                });

            // Active tools (plan mode → read-only subset)
            const isPlanMode = false; // TODO: detect from session state post-migration
            const activeToolNames = isPlanMode && hasTools
              ? Object.keys(tools).filter(name => (READ_ONLY_TOOLS as readonly string[]).includes(name))
              : undefined;

            // Arm step timeout
            timeoutCtl.onStepRequest();

            // ── streamText() call ──
            const result = streamText({
              model: languageModel,
              instructions: systemPrompt,
              messages: prunedMessages,
              tools: hasTools ? tools : undefined,
              ...(activeToolNames ? { activeTools: activeToolNames } : {}),
              toolChoice: hasTools ? 'auto' : 'none',
              ...(providerOptions ? { providerOptions: providerOptions as never } : {}),
              ...sanitized.sampling,
              abortSignal: timeoutCtl.signal,
              ...(modelConfig?.useResponsesApi ? {} : { maxOutputTokens: 16384 }),
              ...(traceIntegration
                ? { telemetry: { isEnabled: true, functionId: 'native-react-loop', integrations: [traceIntegration] } }
                : {}),
              onStepFinish: ({ usage: stepUsage, finishReason, toolCalls }) => {
                if (stepUsage) {
                  totalUsage.input_tokens += stepUsage.inputTokens || 0;
                  totalUsage.output_tokens += stepUsage.outputTokens || 0;
                }
                controller.enqueue(formatSSE({
                  type: 'status',
                  data: JSON.stringify({
                    subtype: 'step_complete',
                    step,
                    usage: totalUsage,
                    finishReason,
                    toolsUsed: toolCalls?.map(tc => tc.toolName) || [],
                  }),
                }));
              },
              onAbort: () => {
                if (!timeoutCtl.fired) {
                  onRuntimeStatusChange?.('idle');
                  emitEvent('session:end', { sessionId, steps: step });
                }
              },
              experimental_repairToolCall: async () => null,
              onError: (event) => {
                reportNativeError('NATIVE_STREAM_ERROR', event.error, { modelId, sessionId });
              },
            });

            // ── Consume fullStream ──
            let hasToolCalls = false;
            let hasContent = false;
            const stepToolNames: string[] = [];

            for await (const event of timeoutCtl.guardStream(result.fullStream)) {
              timeoutCtl.onStreamPart(event as { type: string; toolCallId?: string });

              switch (event.type) {
                case 'text-delta': {
                  hasContent = true;
                  controller.enqueue(formatSSE({ type: 'text', data: event.text }));
                  break;
                }
                case 'reasoning-delta': {
                  hasContent = true;
                  controller.enqueue(formatSSE({ type: 'thinking', data: event.text }));
                  break;
                }
                case 'tool-call': {
                  hasToolCalls = true;
                  hasContent = true;
                  stepToolNames.push(event.toolName);
                  distinctTools.add(event.toolName);
                  toolInvocationAccumulator.recordToolUse(
                    event.toolCallId,
                    event.toolName,
                    event.input,
                  );
                  controller.enqueue(formatSSE({
                    type: 'tool_use',
                    data: JSON.stringify({
                      id: event.toolCallId,
                      name: event.toolName,
                      input: event.input,
                    }),
                  }));
                  break;
                }
                case 'tool-result': {
                  const media = pendingMediaByCallId.get(event.toolCallId);
                  if (media) pendingMediaByCallId.delete(event.toolCallId);
                  const resultText = typeof event.output === 'string'
                    ? event.output
                    : JSON.stringify(event.output);
                  toolInvocationAccumulator.recordToolResult(event.toolCallId, resultText);
                  controller.enqueue(formatSSE({
                    type: 'tool_result',
                    data: JSON.stringify({
                      tool_use_id: event.toolCallId,
                      content: resultText,
                      is_error: false,
                      ...(media && media.length > 0 ? { media } : {}),
                    }),
                  }));
                  // B5: Persistence hook — tool completed
                  persistence.onToolCompleted?.({
                    sessionId,
                    toolName: event.toolName,
                    toolCallId: event.toolCallId,
                    result: resultText,
                    timestamp: Date.now(),
                  } as never);
                  break;
                }
                case 'tool-error': {
                  const errorData = buildToolErrorResultData(event);
                  controller.enqueue(formatSSE({
                    type: 'tool_result',
                    data: JSON.stringify({ ...errorData, is_error: true }),
                  }));
                  break;
                }
                case 'error': {
                  reportNativeError('NATIVE_STREAM_ERROR', event.error, { modelId, sessionId });
                  controller.enqueue(formatSSE({
                    type: 'error',
                    data: JSON.stringify({ error: String(event.error) }),
                  }));
                  break;
                }
                default:
                  break;
              }
            }

            // ── Post-stream per-step ──
            timeoutCtl.onStepEnd();

            // B5: Persistence hook — step completed
            persistence.onStepCompleted?.({
              sessionId,
              step,
              usage: { ...totalUsage },
              timestamp: Date.now(),
            } as never);

            if (!hasToolCalls) {
              // Empty response check
              if (!hasContent && step === 1) {
                reportNativeError('EMPTY_RESPONSE', new Error('Empty response from model'), { modelId, sessionId });
                controller.enqueue(formatSSE({
                  type: 'error',
                  data: JSON.stringify({ error: 'Model returned empty response' }),
                }));
              }
              break;
            }

            // Doom loop detection
            if (stepToolNames.length > 0 &&
                stepToolNames.join(',') === lastToolNames.join(',')) {
              doomLoopCount++;
              if (doomLoopCount >= DOOM_LOOP_THRESHOLD) {
                controller.enqueue(formatSSE({
                  type: 'status',
                  data: JSON.stringify({ subtype: 'doom_loop_detected', step }),
                }));
                break;
              }
            } else {
              doomLoopCount = 0;
            }
            lastToolNames = stepToolNames;

            // Feed response messages back for next iteration
            const responseData = await result.response;
            messages = [...messages, ...responseData.messages];
          }

          // ── Post-loop ──

          // Skill nudge
          if (shouldSuggestSkill({ step, distinctTools })) {
            controller.enqueue(formatSSE({
              type: 'status',
              data: JSON.stringify(buildSkillNudgeStatusEvent({ step, distinctTools })),
            }));
          }

          // Result event with accounting
          const nativeAccountingSnapshot = await buildNativeAccountingSnapshot(
            toolInvocationAccumulator.drain(),
            workingDirectory || process.cwd(),
          );
          const usageWithAccounting = nativeAccountingSnapshot
            ? { ...totalUsage, context_accounting: nativeAccountingSnapshot }
            : totalUsage;

          controller.enqueue(formatSSE({
            type: 'result',
            data: JSON.stringify({
              usage: usageWithAccounting,
              session_id: sessionId,
              num_turns: step,
            }),
          }));

          emitEvent('session:end', { sessionId, steps: step });
          onRuntimeStatusChange?.('idle');

          // B5: Persistence hook — run completed
          persistence.onRunCompleted?.({
            sessionId,
            steps: step,
            usage: totalUsage,
            timestamp: Date.now(),
          } as never);

        } catch (err) {
          // ── Error handling ──
          const timedOut = timeoutCtl.fired;
          const isAbort = abortController.signal.aborted && !timedOut;

          if (!isAbort) {
            reportNativeError(
              timedOut ? TIMEOUT_CATEGORY[timedOut.reason] : 'NATIVE_STREAM_ERROR',
              err,
              { sessionId },
            );

            const errorAccounting = await buildNativeAccountingSnapshot(
              toolInvocationAccumulator.drain(),
              workingDirectory || process.cwd(),
            ).catch(() => undefined);

            const errorData = buildNativeErrorEventData(err, errorAccounting, timedOut);
            controller.enqueue(formatSSE({ type: 'error', data: JSON.stringify(errorData) }));

            // B5: Persistence hook — run failed
            persistence.onRunFailed?.({
              sessionId,
              error: err instanceof Error ? err.message : String(err),
              timedOut: !!timedOut,
              timestamp: Date.now(),
            } as never);
          }

          onRuntimeStatusChange?.('idle');
          emitEvent('session:end', { sessionId, steps: 0 });
        } finally {
          // ── Cleanup ──
          timeoutCtl.dispose();
          clearInterval(keepAliveTimer);
          unsubscribeMediaSideChannel();
          activeAbortControllers.delete(sessionId);
          controller.enqueue(formatSSE({ type: 'done', data: '' }));
          controller.close();
        }
      },
    });
  },

  interrupt(sessionId: string): void {
    const controller = activeAbortControllers.get(sessionId);
    if (controller) {
      controller.abort();
      activeAbortControllers.delete(sessionId);
    }
  },

  isAvailable(): boolean {
    return true;
  },
};

// ── Auto-registration ──────────────────────────────────────────
registerStrategy(reactLoopStrategy);
