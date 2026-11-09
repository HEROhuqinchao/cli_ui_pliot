/**
 * orchestrator/workflow.ts — WorkflowOrchestrator: DAG-based state machine.
 *
 * Executes a directed graph of nodes (agent, condition, transform,
 * human-in-loop, terminal) following edges and conditions. Supports:
 * - Conditional routing (branch based on agent output)
 * - Human-in-loop nodes (pause → SSE → wait → resume)
 * - Dead-loop protection (node visit counting + global timeout)
 * - Transform nodes (extract / summarize / format)
 */

import type { AgentOrchestrator, OrchestrationContext } from './types';
import { registerOrchestrator } from './types';
import type { WorkflowConfig, WorkflowNode, WorkflowEdge } from './agent-profile';
import { resolveStrategy, type ExecutionContext } from '../execution/types';
import { assembleToolSet } from '../tools/tool-registry';
import { resolveContextPolicy } from '../execution/context-policy';
import { resolvePersistenceHook } from '../execution/persistence-hook';
import { createModel } from '../ai-provider';
import { syncMcpConnections } from '../mcp-connection-manager';
import { registerPendingPermission } from '../permission-registry';
import type { SSEEvent } from '@/types';

// ── Helpers ────────────────────────────────────────────────────

function formatSSE(event: SSEEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

interface WorkflowState {
  currentNodeId: string;
  visitCount: Map<string, number>;
  variables: Record<string, string>;
  lastOutput: string;
  totalSteps: number;
}

/**
 * Execute an agent node — runs a strategy with the node's config.
 */
async function executeAgentNode(
  node: WorkflowNode,
  state: WorkflowState,
  ctx: OrchestrationContext,
  controller: { enqueue(chunk: string): void },
): Promise<string> {
  const agentConfig = node.agentConfig;
  if (!agentConfig) return '';

  const strategy = resolveStrategy(agentConfig.strategyId || 'react-loop');

  const { languageModel, modelId, config, isThirdPartyProxy } = createModel({
    callScene: ctx.callScene,
    providerId: ctx.providerId,
    sessionProviderId: ctx.sessionProviderId,
    model: ctx.modelId || undefined,
  });

  const toolResult = await assembleToolSet(
    {
      workingDirectory: ctx.workingDirectory,
      sessionId: ctx.sessionId,
      prompt: state.lastOutput || ctx.prompt,
      providerId: ctx.providerId,
      sessionProviderId: ctx.sessionProviderId,
      model: modelId,
      permissionMode: ctx.profile.permissionMode,
    },
    agentConfig.toolProviderIds?.length ? agentConfig.toolProviderIds : undefined,
  );

  // Build prompt with variable substitution
  let prompt = agentConfig.prompt || ctx.prompt;
  prompt = prompt.replace(/\{\{(\w+)\}\}/g, (_, key) => state.variables[key] || '');
  prompt = prompt.replace('{{input}}', state.lastOutput || ctx.prompt);

  const systemPrompt = [
    ctx.systemPrompt || '',
    ...toolResult.systemPrompts,
  ].filter(Boolean).join('\n\n') || undefined;

  const execCtx: ExecutionContext = {
    prompt,
    sessionId: `${ctx.sessionId}__wf_${node.id}`,
    messages: [{ role: 'user' as const, content: prompt }],
    systemPrompt,
    model: languageModel,
    modelId,
    tools: toolResult.tools,
    permissionBroker: ctx.permissionBroker,
    contextPolicy: resolveContextPolicy(ctx.profile.contextPolicyId),
    persistence: resolvePersistenceHook('noop'),
    maxSteps: 30,
    abortSignal: ctx.abortSignal,
    emitSSE: ctx.emitSSE,
    workingDirectory: ctx.workingDirectory,
    thinking: ctx.thinking,
    effort: ctx.effort,
    context1m: ctx.context1m,
    temperature: ctx.temperature,
    topP: ctx.topP,
    topK: ctx.topK,
    strategyOptions: { _modelConfig: config, _isThirdPartyProxy: isThirdPartyProxy },
    autoTrigger: true,
    callScene: ctx.callScene,
    providerId: ctx.providerId,
    sessionProviderId: ctx.sessionProviderId,
    bypassPermissions: ctx.bypassPermissions,
    mcpServers: ctx.mcpServers,
  };

  controller.enqueue(formatSSE({
    type: 'status',
    data: JSON.stringify({ subtype: 'workflow_node_start', nodeId: node.id, nodeType: 'agent' }),
  }));

  const stream = strategy.execute(execCtx);
  const reader = stream.getReader();
  let collectedText = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value.startsWith('data: ')) {
        try {
          const event = JSON.parse(value.slice(6)) as SSEEvent;
          if (event.type === 'text') {
            collectedText += event.data;
            controller.enqueue(value);
          } else if (event.type === 'tool_use' || event.type === 'tool_result' || event.type === 'thinking') {
            controller.enqueue(value);
          }
        } catch { /* skip malformed */ }
      }
    }
  } finally {
    reader.releaseLock();
  }

  controller.enqueue(formatSSE({
    type: 'status',
    data: JSON.stringify({ subtype: 'workflow_node_end', nodeId: node.id, outputLength: collectedText.length }),
  }));

  return collectedText;
}

/**
 * Evaluate a condition node — returns the branch key to follow.
 * The expression is a simple string evaluated against workflow state.
 * Supported patterns: "contains:TEXT", "equals:TEXT", "not_empty", "empty",
 * or a bare variable name (truthy check).
 */
function evaluateCondition(
  node: WorkflowNode,
  state: WorkflowState,
): string {
  const condition = node.conditionConfig;
  if (!condition) return 'default';

  const { expression, branches, defaultBranch } = condition;
  const context = state.lastOutput || '';

  let resultKey: string;

  if (expression.startsWith('contains:')) {
    const needle = expression.slice('contains:'.length);
    resultKey = context.includes(needle) ? 'true' : 'false';
  } else if (expression.startsWith('equals:')) {
    const expected = expression.slice('equals:'.length);
    resultKey = context.trim() === expected ? 'true' : 'false';
  } else if (expression === 'not_empty') {
    resultKey = context.trim().length > 0 ? 'true' : 'false';
  } else if (expression === 'empty') {
    resultKey = context.trim().length === 0 ? 'true' : 'false';
  } else {
    // Treat as variable name — truthy check
    const val = state.variables[expression] ?? '';
    resultKey = val.trim().length > 0 ? 'true' : 'false';
  }

  return branches[resultKey] || defaultBranch || 'default';
}

/**
 * Execute a transform node — applies a transformation to the last output.
 */
function executeTransform(
  node: WorkflowNode,
  state: WorkflowState,
): string {
  const transform = node.transformConfig;
  if (!transform) return state.lastOutput;

  switch (transform.type) {
    case 'extract': {
      // Regex extraction: config.pattern is a regex string
      const pattern = transform.config.pattern as string | undefined;
      if (pattern) {
        const match = state.lastOutput.match(new RegExp(pattern, 's'));
        return match ? (match[1] || match[0]) : '';
      }
      return state.lastOutput;
    }

    case 'filter': {
      // Line-based filtering: config.keyword filters lines containing it
      const keyword = transform.config.keyword as string | undefined;
      if (keyword) {
        return state.lastOutput
          .split('\n')
          .filter(line => line.includes(keyword))
          .join('\n');
      }
      return state.lastOutput;
    }

    case 'format': {
      // Template-based formatting: config.template with {{content}} placeholder
      const template = transform.config.template as string | undefined;
      if (template) {
        return template.replace('{{content}}', state.lastOutput);
      }
      return state.lastOutput;
    }

    case 'summarize': {
      // Simple truncation-based summary: config.maxLength
      const maxLength = (transform.config.maxLength as number) || 2000;
      if (state.lastOutput.length > maxLength) {
        return state.lastOutput.slice(0, maxLength) + '\n\n[... truncated]';
      }
      return state.lastOutput;
    }

    default:
      return state.lastOutput;
  }
}

// ── Orchestrator implementation ────────────────────────────────

const activeSessions = new Map<string, { abort: () => void }>();

export const workflowOrchestrator: AgentOrchestrator = {
  id: 'workflow',
  displayName: 'Workflow Engine',
  mode: 'workflow',

  orchestrate(ctx: OrchestrationContext): ReadableStream<string> {
    const config = ctx.profile.workflow;
    if (!config || config.nodes.length === 0) {
      return new ReadableStream<string>({
        start(controller) {
          controller.enqueue(formatSSE({
            type: 'error',
            data: JSON.stringify({ error: 'Workflow orchestrator requires profile.workflow with at least one node' }),
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

        const maxVisits = config.maxNodeVisits || 50;
        const timeoutMs = (config.timeoutSec || 600) * 1000;
        const startTime = Date.now();

        // Build adjacency map
        const nodeMap = new Map<string, WorkflowNode>();
        for (const node of config.nodes) {
          nodeMap.set(node.id, node);
        }

        const edgesFrom = new Map<string, WorkflowEdge[]>();
        for (const edge of config.edges) {
          const existing = edgesFrom.get(edge.from) || [];
          existing.push(edge);
          edgesFrom.set(edge.from, existing);
        }

        // Initialize state
        const state: WorkflowState = {
          currentNodeId: config.entryNode,
          visitCount: new Map(),
          variables: { prompt: ctx.prompt },
          lastOutput: '',
          totalSteps: 0,
        };

        try {
          // MCP sync
          if (ctx.mcpServers && Object.keys(ctx.mcpServers).length > 0) {
            await syncMcpConnections(ctx.mcpServers);
          }

          controller.enqueue(formatSSE({
            type: 'status',
            data: JSON.stringify({
              status: 'init',
              session_id: ctx.sessionId,
              model: ctx.modelId,
              tools: [],
              output_style: 'streaming',
              workflow: { nodes: config.nodes.length, entry: config.entryNode },
            }),
          }));

          ctx.onRuntimeStatusChange?.('streaming');

          // ── Graph execution loop ──
          while (state.currentNodeId) {
            // Timeout check
            if (Date.now() - startTime > timeoutMs) {
              controller.enqueue(formatSSE({
                type: 'error',
                data: JSON.stringify({ error: `Workflow timed out after ${config.timeoutSec || 600}s` }),
              }));
              break;
            }

            // Abort check
            if (abortController.signal.aborted) break;

            const node = nodeMap.get(state.currentNodeId);
            if (!node) {
              controller.enqueue(formatSSE({
                type: 'error',
                data: JSON.stringify({ error: `Workflow node not found: ${state.currentNodeId}` }),
              }));
              break;
            }

            // Visit count check (dead-loop protection)
            const visits = (state.visitCount.get(node.id) || 0) + 1;
            state.visitCount.set(node.id, visits);
            if (visits > maxVisits) {
              controller.enqueue(formatSSE({
                type: 'error',
                data: JSON.stringify({ error: `Node "${node.id}" visited ${visits} times — possible infinite loop` }),
              }));
              break;
            }

            state.totalSteps++;

            // ── Execute node by type ──
            let branchKey = 'default';

            switch (node.type) {
              case 'agent': {
                const output = await executeAgentNode(node, state, ctx, controller);
                state.lastOutput = output;
                state.variables[`node_${node.id}`] = output;
                break;
              }

              case 'condition': {
                branchKey = evaluateCondition(node, state);
                controller.enqueue(formatSSE({
                  type: 'status',
                  data: JSON.stringify({ subtype: 'workflow_condition', nodeId: node.id, branch: branchKey }),
                }));
                break;
              }

              case 'transform': {
                state.lastOutput = executeTransform(node, state);
                state.variables[`node_${node.id}`] = state.lastOutput;
                break;
              }

              case 'human-in-loop': {
                // Emit pause event and wait for user input
                const waitId = `wf_hil_${ctx.sessionId}_${node.id}_${Date.now()}`;
                controller.enqueue(formatSSE({
                  type: 'status',
                  data: JSON.stringify({
                    subtype: 'workflow_human_in_loop',
                    nodeId: node.id,
                    waitId,
                    prompt: node.humanConfig?.prompt || 'Please provide input to continue the workflow.',
                  }),
                }));

                // Wait for user response via permission registry mechanism
                const response = await registerPendingPermission(
                  waitId,
                  { nodeId: node.id, workflowPrompt: node.humanConfig?.prompt || '' },
                  abortController.signal,
                );

                if (response.behavior === 'deny') {
                  controller.enqueue(formatSSE({
                    type: 'status',
                    data: JSON.stringify({ subtype: 'workflow_cancelled', nodeId: node.id }),
                  }));
                  state.currentNodeId = '';
                  break;
                }

                const userInput = response.message || JSON.stringify(response.updatedInput || '');
                state.lastOutput = userInput;
                state.variables[`human_${node.id}`] = userInput;
                break;
              }

              case 'terminal': {
                controller.enqueue(formatSSE({
                  type: 'status',
                  data: JSON.stringify({ subtype: 'workflow_terminal', nodeId: node.id }),
                }));
                state.currentNodeId = '';
                break;
              }
            }

            // ── Resolve next node ──
            if (!state.currentNodeId) break; // terminal or cancelled

            const edges = edgesFrom.get(node.id) || [];
            if (edges.length === 0) {
              // No outgoing edges — implicit terminal
              break;
            }

            // Find matching edge (condition edges use branchKey)
            const nextEdge = edges.find(e => !e.condition || e.condition === branchKey) || edges[0];
            state.currentNodeId = nextEdge.to;
          }

          // Emit result
          controller.enqueue(formatSSE({
            type: 'result',
            data: JSON.stringify({
              usage: { input_tokens: 0, output_tokens: 0 },
              session_id: ctx.sessionId,
              num_turns: state.totalSteps,
              workflow: true,
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
registerOrchestrator(workflowOrchestrator);
