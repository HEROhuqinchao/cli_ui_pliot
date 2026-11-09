/**
 * permission/index.ts — Public exports for the permission broker layer.
 */

export type {
  PermissionBroker,
  PermissionRequest,
  PermissionDecision,
  PermissionPrompt,
  PermissionResponse,
  PermissionFilterContext,
} from './broker';
export { bypassBroker } from './broker';

export { createCompositeBroker } from './composite';

export {
  createRuleBasedBroker,
  addSessionRule,
  getSessionRules,
  clearSessionRules,
} from './rule-based';

export {
  createInteractiveSseBroker,
  type InteractiveSseBrokerConfig,
} from './interactive-sse';
