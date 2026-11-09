/**
 * tools/providers/builtin-mcp.ts — BuiltinMcpProvider.
 *
 * Wraps the existing getBuiltinTools() from src/lib/builtin-tools/index.ts
 * as a ToolProvider. These are the "MCP-equivalent" built-in tools:
 * notification, memory, dashboard, media, schedule_task, etc.
 *
 * Also contributes system prompt fragments (tool-specific instructions).
 */

import type { ToolProvider, ToolProviderContext } from '../tool-provider';
import type { ToolSet } from 'ai';

export const builtinMcpProvider: ToolProvider = {
  id: 'builtin-mcp',
  displayName: 'Built-in Platform Tools',
  priority: 20,

  provideTools(ctx: ToolProviderContext): ToolSet {
    const { getBuiltinTools } = require('../../builtin-tools') as typeof import('../../builtin-tools');
    const { tools } = getBuiltinTools({
      workspacePath: ctx.workingDirectory,
      prompt: ctx.prompt,
      sessionId: ctx.sessionId,
      safeReadOnly: ctx.safeReadOnly,
    });
    return tools;
  },

  provideSystemPrompts(ctx: ToolProviderContext): string[] {
    const { getBuiltinTools } = require('../../builtin-tools') as typeof import('../../builtin-tools');
    const { systemPrompts } = getBuiltinTools({
      workspacePath: ctx.workingDirectory,
      prompt: ctx.prompt,
      sessionId: ctx.sessionId,
      safeReadOnly: ctx.safeReadOnly,
    });
    return systemPrompts;
  },

  isAvailable(): boolean {
    return true;
  },
};
