/**
 * orchestrator/index.ts — Public exports for the orchestrator layer.
 *
 * Importing this module triggers registration of all built-in orchestrators,
 * execution strategies, tool providers, context policies, and persistence
 * hooks via side-effect imports below.
 */

// ── Side-effect imports: populate registries ──────────────────
import './single';                      // registerOrchestrator(singleOrchestrator)
import './delegate';                    // registerOrchestrator(delegateOrchestrator)
import './multi-role';                  // registerOrchestrator(multiRoleOrchestrator)
import './workflow';                    // registerOrchestrator(workflowOrchestrator)
import '../execution/react-loop';       // registerStrategy(reactLoopStrategy)
import '../tools/providers';            // registerToolProvider × 3
import '../execution/context-policy';   // registerContextPolicy (pruneOld, noop, slidingWindow)
import '../execution/persistence-hook'; // registerPersistenceHook (noop, db)

export type { AgentOrchestrator, OrchestrationContext, OrchestratorMode } from './types';
export {
  registerOrchestrator,
  getOrchestrator,
  getAllOrchestrators,
  resolveOrchestrator,
} from './types';

export type {
  AgentProfile,
  InlineToolDefinition,
  InlineToolExecute,
  MultiRoleConfig,
  RoleDefinition,
  SynthesisConfig,
  WorkflowConfig,
  WorkflowNode,
  WorkflowEdge,
  DelegateConfig,
  DelegateAuth,
} from './agent-profile';
export {
  registerProfile,
  unregisterProfile,
  getProfile,
  listProfiles,
  listProfilesBySource,
  DEFAULT_PROFILE,
} from './agent-profile';

export { singleOrchestrator } from './single';
export { delegateOrchestrator } from './delegate';
export { multiRoleOrchestrator } from './multi-role';
export { workflowOrchestrator } from './workflow';
