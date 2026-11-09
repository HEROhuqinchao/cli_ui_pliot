/**
 * permission/rule-based.ts — RuleBasedBroker: wraps permission-checker.ts.
 *
 * Stage 2 migration adapter: delegates to the existing checkPermission()
 * rule engine (explore/normal/trust modes + dangerous command detection).
 * Returns 'allow' or 'deny' for definitive cases, 'ask' when the rule
 * engine says the user must confirm.
 *
 * This broker is the FIRST in the CompositeBroker chain — it handles
 * the fast-path (auto-allow reads, auto-deny in explore mode, dangerous
 * command detection). Only when it returns 'ask' does the next broker
 * (InteractiveSseBroker) engage the user.
 */

import type {
  PermissionBroker,
  PermissionRequest,
  PermissionDecision,
  PermissionFilterContext,
} from './broker';
import {
  checkPermission,
  type PermissionMode,
  type PermissionRule,
} from '../permission-checker';
import { PERMISSION_SAFE_TOOLS } from '../agent-tools';

// ── Session-level rules (accumulated from "allow for session") ──

const sessionRules = new Map<string, PermissionRule[]>();

export function addSessionRule(
  sessionId: string,
  rule: PermissionRule,
): void {
  const existing = sessionRules.get(sessionId) || [];
  existing.push(rule);
  sessionRules.set(sessionId, existing);
}

export function getSessionRules(sessionId: string): PermissionRule[] {
  return sessionRules.get(sessionId) || [];
}

export function clearSessionRules(sessionId: string): void {
  sessionRules.delete(sessionId);
}

// ── Broker implementation ──────────────────────────────────────

/**
 * Create a RuleBasedBroker for a specific permission mode.
 * The mode determines the base rule set (explore/normal/trust).
 */
export function createRuleBasedBroker(
  mode: PermissionMode = 'normal',
): PermissionBroker {
  return {
    id: `rule-based-${mode}`,
    displayName: `Rule-Based (${mode})`,

    async check(request: PermissionRequest): Promise<PermissionDecision> {
      const userRules = getSessionRules(request.sessionId);
      const result = checkPermission(
        request.toolName,
        request.toolInput,
        mode,
        userRules,
      );

      switch (result.action) {
        case 'allow':
          return { action: 'allow' };
        case 'deny':
          return { action: 'deny', reason: result.reason || 'Denied by permission rules' };
        case 'ask':
          // Return 'ask' — the CompositeBroker will pass this to the
          // next broker (InteractiveSseBroker) which handles the UI.
          // We encode the reason in a minimal prompt structure; the
          // interactive broker will build the full SSE prompt.
          return {
            action: 'ask',
            prompt: {
              permissionRequestId: '', // filled by interactive broker
              toolName: request.toolName,
              toolInput: request.toolInput,
              description: result.reason || `Confirm: ${request.toolName}`,
              waitForResponse: async () => ({ behavior: 'deny' as const, message: 'No interactive broker' }),
            },
          };
      }
    },

    filterTools(toolNames: string[], _context?: PermissionFilterContext): string[] {
      if (mode === 'trust') return toolNames;
      if (mode === 'explore') {
        // Only allow read-only tools in explore mode
        return toolNames.filter(name => PERMISSION_SAFE_TOOLS.has(name));
      }
      // normal mode: all tools available (permission checked at call time)
      return toolNames;
    },
  };
}
