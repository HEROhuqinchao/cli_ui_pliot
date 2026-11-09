/**
 * permission/interactive-sse.ts — InteractiveSseBroker.
 *
 * Handles the 'ask' path: emits a permission_request SSE event to the
 * frontend, then blocks (via a Promise) until the user responds through
 * the /api/chat/permissions route.
 *
 * This is the SECOND broker in the CompositeBroker chain — it only
 * engages when the RuleBasedBroker returns 'ask'.
 *
 * Stage 2 migration: wraps the existing logic from agent-tools.ts's
 * wrapWithPermissions() closure (the registerPendingPermission +
 * emitSSE + wait pattern).
 */

import crypto from 'crypto';
import type {
  PermissionBroker,
  PermissionRequest,
  PermissionDecision,
  PermissionResponse,
} from './broker';
import { registerPendingPermission, buildPermissionResolvedEvent } from '../permission-registry';
import { createPermissionRequest } from '../db';
import { issueApprovalToken } from '../permission-approval-token';
import { emit as emitEvent } from '../runtime/event-bus';
import { addSessionRule } from './rule-based';

// ── Configuration ──────────────────────────────────────────────

export interface InteractiveSseBrokerConfig {
  /** Callback to emit SSE events to the frontend stream */
  emitSSE: (event: { type: string; data: string }) => void;
  /** Abort signal (user cancel or timeout unblocks the wait) */
  abortSignal?: AbortSignal;
  /** Permission request timeout in ms (default 5 minutes) */
  timeoutMs?: number;
}

// ── Broker factory ─────────────────────────────────────────────

/**
 * Create an InteractiveSseBroker bound to a specific SSE stream.
 * Must be created per-request (the emitSSE closure is stream-specific).
 */
export function createInteractiveSseBroker(
  config: InteractiveSseBrokerConfig,
): PermissionBroker {
  const { emitSSE, abortSignal, timeoutMs = 5 * 60 * 1000 } = config;

  return {
    id: 'interactive-sse',
    displayName: 'Interactive (SSE Popup)',

    async check(request: PermissionRequest): Promise<PermissionDecision> {
      // This broker always returns 'ask' — it IS the ask handler.
      // In the composite chain, it's only reached when RuleBasedBroker
      // already returned 'ask', so we build the full interactive prompt.

      const permId = crypto.randomBytes(8).toString('hex');
      const expiresAt = new Date(Date.now() + timeoutMs).toISOString();

      // Persist to DB (non-critical)
      try {
        createPermissionRequest({
          id: permId,
          sessionId: request.sessionId,
          toolName: request.toolName,
          toolInput: JSON.stringify(request.toolInput),
          expiresAt,
        });
      } catch { /* non-critical */ }

      // Emit event bus notification
      emitEvent('permission:request', {
        sessionId: request.sessionId,
        toolName: request.toolName,
        permissionId: permId,
      });

      // Emit SSE to frontend
      const approvalToken = issueApprovalToken(permId, expiresAt);
      emitSSE({
        type: 'permission_request',
        data: JSON.stringify({
          permissionRequestId: permId,
          toolName: request.toolName,
          toolInput: request.toolInput,
          description: `Confirm execution of ${request.toolName}`,
          approvalToken,
        }),
      });

      // Build the waitForResponse closure
      const waitForResponse = (): Promise<PermissionResponse> => {
        return registerPendingPermission(
          permId,
          (request.toolInput || {}) as Record<string, unknown>,
          abortSignal,
          () => {
            // onTimeout: emit resolved event so UI dismisses the prompt
            try {
              emitSSE(buildPermissionResolvedEvent(permId));
            } catch {
              // stream already closed — deny still applies
            }
          },
        ).then((permResult) => {
          // Emit resolution event
          emitEvent('permission:resolved', {
            sessionId: request.sessionId,
            toolName: request.toolName,
            behavior: permResult.behavior,
          });

          // Save session-level approval if granted
          const updatedPermissions = permResult.updatedPermissions as
            | Array<{ toolName: string; pattern: string }>
            | undefined;
          if (updatedPermissions && Array.isArray(updatedPermissions)) {
            for (const perm of updatedPermissions) {
              addSessionRule(request.sessionId, {
                permission: perm.toolName,
                pattern: perm.pattern,
                action: 'allow',
              });
            }
          }

          return {
            behavior: permResult.behavior,
            updatedInput: permResult.updatedInput,
            message: permResult.message,
            updatedPermissions,
          } satisfies PermissionResponse;
        });
      };

      return {
        action: 'ask',
        prompt: {
          permissionRequestId: permId,
          toolName: request.toolName,
          toolInput: request.toolInput,
          description: `Confirm execution of ${request.toolName}`,
          approvalToken,
          waitForResponse,
        },
      };
    },
  };
}
