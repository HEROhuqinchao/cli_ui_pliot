/**
 * orchestrator/delegate.ts — DelegateOrchestrator: forward tasks to remote agents.
 *
 * Supports two wire protocols:
 * - openai-responses: OpenAI Responses API compatible endpoints (streaming SSE)
 * - a2a: Google Agent-to-Agent protocol (JSON-RPC over HTTP with SSE streaming)
 *
 * The orchestrator translates remote agent responses into the local SSE event
 * contract, making remote agents appear as native execution to the frontend.
 */

import type { AgentOrchestrator, OrchestrationContext } from './types';
import { registerOrchestrator } from './types';
import type { DelegateConfig, DelegateAuth } from './agent-profile';
import type { SSEEvent } from '@/types';

// ── Helpers ────────────────────────────────────────────────────

function formatSSE(event: SSEEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

function buildAuthHeaders(auth: DelegateAuth): Record<string, string> {
  switch (auth.type) {
    case 'bearer':
      return { Authorization: `Bearer ${auth.token}` };
    case 'api-key':
      return { [auth.header]: auth.key };
    case 'oauth2':
      // OAuth2 token exchange would happen here; for now pass client credentials
      return { Authorization: `Basic ${Buffer.from(`${auth.clientId}:${auth.clientSecret}`).toString('base64')}` };
    case 'none':
      return {};
  }
}

function resolveEnvVars(value: string): string {
  // Support ${ENV_VAR} syntax in endpoint URLs and tokens
  return value.replace(/\$\{([^}]+)\}/g, (_, name) => process.env[name] || '');
}

// ── OpenAI Responses protocol translator ───────────────────────

interface OpenAIResponseEvent {
  type: string;
  response?: { id?: string; status?: string; output?: Array<{ type: string; content?: Array<{ type: string; text?: string }> }> };
  delta?: string;
  item?: { type?: string; content?: Array<{ type?: string; text?: string }> };
  output_index?: number;
  content_index?: number;
  error?: { message?: string };
}

function translateOpenAIEvent(event: OpenAIResponseEvent): SSEEvent[] {
  const events: SSEEvent[] = [];

  switch (event.type) {
    case 'response.output_text.delta':
      if (event.delta) {
        events.push({ type: 'text', data: event.delta });
      }
      break;

    case 'response.completed':
      // Final result — extract any accumulated output
      if (event.response?.output) {
        for (const item of event.response.output) {
          if (item.type === 'message' && item.content) {
            // Already streamed via deltas; skip
          }
        }
      }
      break;

    case 'response.failed':
    case 'error':
      events.push({
        type: 'error',
        data: JSON.stringify({ error: event.error?.message || 'Remote agent failed' }),
      });
      break;

    default:
      // Ignore other event types (response.created, response.in_progress, etc.)
      break;
  }

  return events;
}

// ── A2A protocol translator ────────────────────────────────────

interface A2AEvent {
  jsonrpc?: string;
  id?: string;
  result?: {
    id?: string;
    status?: { state?: string; message?: { role?: string; parts?: Array<{ type?: string; text?: string }> } };
    artifacts?: Array<{ name?: string; parts?: Array<{ type?: string; text?: string }> }>;
  };
  error?: { code?: number; message?: string };
}

function translateA2AEvent(event: A2AEvent): SSEEvent[] {
  const events: SSEEvent[] = [];

  if (event.error) {
    events.push({
      type: 'error',
      data: JSON.stringify({ error: event.error.message || `A2A error ${event.error.code}` }),
    });
    return events;
  }

  const result = event.result;
  if (!result) return events;

  // Status message (agent thinking / responding)
  if (result.status?.message?.parts) {
    for (const part of result.status.message.parts) {
      if (part.type === 'text' && part.text) {
        events.push({ type: 'text', data: part.text });
      }
    }
  }

  // Artifacts (final output)
  if (result.artifacts) {
    for (const artifact of result.artifacts) {
      if (artifact.parts) {
        for (const part of artifact.parts) {
          if (part.type === 'text' && part.text) {
            events.push({ type: 'text', data: part.text });
          }
        }
      }
    }
  }

  return events;
}

// ── Streaming HTTP client ──────────────────────────────────────

async function* streamFromRemote(
  config: DelegateConfig,
  prompt: string,
  sessionId: string,
  abortSignal: AbortSignal,
): AsyncGenerator<SSEEvent> {
  const endpoint = resolveEnvVars(config.endpoint);
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...buildAuthHeaders(config.auth),
    ...(config.headers || {}),
  };

  let body: string;
  let url = endpoint;

  if (config.protocol === 'openai-responses') {
    // OpenAI Responses API format
    body = JSON.stringify({
      model: 'remote-agent',
      input: prompt,
      stream: config.streaming,
      metadata: { session_id: sessionId },
    });
  } else if (config.protocol === 'a2a') {
    // A2A JSON-RPC format
    body = JSON.stringify({
      jsonrpc: '2.0',
      id: sessionId,
      method: 'tasks/send',
      params: {
        id: sessionId,
        message: { role: 'user', parts: [{ type: 'text', text: prompt }] },
      },
    });
  } else {
    // Custom protocol — send raw prompt
    body = JSON.stringify({ prompt, session_id: sessionId, stream: config.streaming });
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), config.timeoutSec * 1000);

  // Link external abort
  if (abortSignal.aborted) {
    controller.abort();
  } else {
    abortSignal.addEventListener('abort', () => controller.abort(), { once: true });
  }

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body,
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      yield {
        type: 'error',
        data: JSON.stringify({
          error: `Remote agent returned ${response.status}: ${errorText.slice(0, 500)}`,
        }),
      };
      return;
    }

    if (!config.streaming || !response.body) {
      // Non-streaming: parse full response
      const text = await response.text();
      try {
        const json = JSON.parse(text);
        if (config.protocol === 'a2a') {
          for (const event of translateA2AEvent(json)) yield event;
        } else {
          // OpenAI non-streaming response
          const output = json.output || [];
          for (const item of output) {
            if (item.content) {
              for (const c of item.content) {
                if (c.text) yield { type: 'text', data: c.text };
              }
            }
          }
        }
      } catch {
        // Plain text response
        yield { type: 'text', data: text };
      }
      return;
    }

    // Streaming: parse SSE lines from response body
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data:')) continue;

        const data = trimmed.slice(5).trim();
        if (data === '[DONE]') return;

        try {
          const parsed = JSON.parse(data);
          let translated: SSEEvent[];

          if (config.protocol === 'a2a') {
            translated = translateA2AEvent(parsed);
          } else {
            translated = translateOpenAIEvent(parsed);
          }

          for (const event of translated) {
            yield event;
          }
        } catch {
          // Skip malformed JSON lines
        }
      }
    }
  } catch (err) {
    if (controller.signal.aborted && !abortSignal.aborted) {
      yield {
        type: 'error',
        data: JSON.stringify({ error: `Remote agent timed out after ${config.timeoutSec}s` }),
      };
    } else if (!abortSignal.aborted) {
      yield {
        type: 'error',
        data: JSON.stringify({ error: `Remote agent connection failed: ${err instanceof Error ? err.message : String(err)}` }),
      };
    }
  } finally {
    clearTimeout(timeoutId);
  }
}

// ── Orchestrator implementation ────────────────────────────────

const activeAbortControllers = new Map<string, AbortController>();

export const delegateOrchestrator: AgentOrchestrator = {
  id: 'delegate',
  displayName: 'Remote Delegate',
  mode: 'delegate',

  orchestrate(ctx: OrchestrationContext): ReadableStream<string> {
    const config = ctx.profile.delegate;
    if (!config) {
      return new ReadableStream<string>({
        start(controller) {
          controller.enqueue(formatSSE({
            type: 'error',
            data: JSON.stringify({ error: 'Delegate orchestrator requires profile.delegate config' }),
          }));
          controller.enqueue(formatSSE({ type: 'done', data: '' }));
          controller.close();
        },
      });
    }

    const abortController = new AbortController();
    activeAbortControllers.set(ctx.sessionId, abortController);

    // Link external abort
    if (ctx.abortSignal.aborted) {
      abortController.abort();
    } else {
      ctx.abortSignal.addEventListener('abort', () => abortController.abort(), { once: true });
    }

    return new ReadableStream<string>({
      async start(controller) {
        try {
          // Emit init status
          controller.enqueue(formatSSE({
            type: 'status',
            data: JSON.stringify({
              status: 'init',
              session_id: ctx.sessionId,
              model: `delegate:${config.protocol}`,
              tools: [],
              output_style: 'streaming',
            }),
          }));

          ctx.onRuntimeStatusChange?.('streaming');

          // Stream from remote agent
          for await (const event of streamFromRemote(config, ctx.prompt, ctx.sessionId, abortController.signal)) {
            controller.enqueue(formatSSE(event));
          }

          // Emit result
          controller.enqueue(formatSSE({
            type: 'result',
            data: JSON.stringify({
              usage: { input_tokens: 0, output_tokens: 0 },
              session_id: ctx.sessionId,
              num_turns: 1,
              delegate: true,
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
          activeAbortControllers.delete(ctx.sessionId);
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
};

// ── Auto-registration ──────────────────────────────────────────
registerOrchestrator(delegateOrchestrator);
