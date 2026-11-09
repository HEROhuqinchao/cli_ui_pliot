/**
 * tools/providers/builtin-coding.ts — BuiltinCodingProvider.
 *
 * Wraps the existing createBuiltinTools() from src/lib/tools/index.ts
 * as a ToolProvider. This is the Stage 2 migration adapter: same tools,
 * same behavior, new registration interface.
 *
 * Tools provided: Read, Write, Edit, Bash, Glob, Grep, Agent, TodoWrite,
 * AskUserQuestion, EnterPlanMode, ExitPlanMode, Skill, WebFetch, WebSearch,
 * NotebookEdit, ImageGen, ImageSearch.
 */

import type { ToolProvider, ToolProviderContext } from '../tool-provider';
import type { ToolSet } from 'ai';

export const builtinCodingProvider: ToolProvider = {
  id: 'builtin-coding',
  displayName: 'Built-in Coding Tools',
  priority: 10,

  provideTools(ctx: ToolProviderContext): ToolSet {
    // Delegate to the existing implementation
    const { createBuiltinTools } = require('../index') as typeof import('../index');
    return createBuiltinTools({
      workingDirectory: ctx.workingDirectory,
      sessionId: ctx.sessionId,
      providerId: ctx.providerId,
      sessionProviderId: ctx.sessionProviderId,
      model: ctx.model,
      permissionMode: ctx.permissionMode as import('../..//permission-checker').PermissionMode | undefined,
    });
  },

  isAvailable(): boolean {
    // Built-in coding tools are always available
    return true;
  },
};
