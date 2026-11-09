/**
 * permission/composite.ts — CompositeBroker: chain multiple brokers.
 *
 * Evaluates brokers in order. The first broker that returns a definitive
 * decision (allow or deny) wins. If all brokers return 'ask', the last
 * broker's prompt is used (it's the most specific).
 *
 * Typical chain: [RuleBasedBroker, InteractiveSseBroker]
 * - RuleBased handles explore/normal/trust rules (fast, sync)
 * - InteractiveSse handles the 'ask' fallback (SSE popup + wait)
 *
 * For external approval: [RuleBasedBroker, ExternalApprovalBroker]
 * - Rules handle local fast-path
 * - External broker delegates to a remote webhook for the 'ask' case
 */

import type {
  PermissionBroker,
  PermissionRequest,
  PermissionDecision,
  PermissionFilterContext,
} from './broker';

/**
 * Create a composite broker that chains multiple brokers.
 *
 * Semantics:
 * - First definitive (allow/deny) result wins.
 * - If all return 'ask', the LAST broker's prompt is used
 *   (most specific broker gets to present the UI).
 * - filterTools intersects results (tool must pass ALL brokers' filters).
 */
export function createCompositeBroker(
  brokers: PermissionBroker[],
  id = 'composite',
): PermissionBroker {
  if (brokers.length === 0) {
    throw new Error('CompositeBroker requires at least one broker');
  }

  if (brokers.length === 1) {
    return brokers[0];
  }

  return {
    id,
    displayName: `Composite (${brokers.map(b => b.id).join(' → ')})`,

    async check(request: PermissionRequest): Promise<PermissionDecision> {
      let lastAskPrompt: PermissionDecision | undefined;

      for (const broker of brokers) {
        const decision = await broker.check(request);

        if (decision.action === 'allow' || decision.action === 'deny') {
          return decision;
        }

        // action === 'ask' — remember and continue to next broker
        lastAskPrompt = decision;
      }

      // All brokers said 'ask' — use the last one's prompt
      return lastAskPrompt ?? { action: 'deny', reason: 'No broker available' };
    },

    filterTools(toolNames: string[], context?: PermissionFilterContext): string[] {
      let result = toolNames;
      for (const broker of brokers) {
        if (broker.filterTools) {
          result = broker.filterTools(result, context);
        }
      }
      return result;
    },
  };
}
