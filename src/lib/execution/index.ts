/**
 * execution/index.ts — Public exports for the execution strategy layer.
 */

export type { ExecutionStrategy, ExecutionContext } from './types';
export {
  registerStrategy,
  getStrategy,
  getAllStrategies,
  getAvailableStrategies,
  resolveStrategy,
} from './types';

export type { ContextPolicy, TokenBudget } from './context-policy';
export {
  pruneOldPolicy,
  noopPolicy,
  createSlidingWindowPolicy,
  createTokenBudget,
  registerContextPolicy,
  getContextPolicy,
  resolveContextPolicy,
} from './context-policy';

export type {
  PersistenceHook,
  ToolStartedEvent,
  ToolCompletedEvent,
  StepCompletedEvent,
  RunCompletedEvent,
  RunFailedEvent,
  CheckpointEvent,
} from './persistence-hook';
export {
  noopPersistence,
  dbPersistence,
  registerPersistenceHook,
  getPersistenceHook,
  resolvePersistenceHook,
} from './persistence-hook';
