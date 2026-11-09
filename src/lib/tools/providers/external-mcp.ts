/**
 * tools/providers/external-mcp.ts — ExternalMcpProvider.
 *
 * Wraps the existing buildMcpToolSet() from src/lib/mcp-tool-adapter.ts
 * as a ToolProvider. These are tools from user-connected external MCP
 * servers (configured in Settings → MCP Servers).
 */

import type { ToolProvider, ToolProviderContext } from '../tool-provider';
import type { ToolSet } from 'ai';

export const externalMcpProvider: ToolProvider = {
  id: 'external-mcp',
  displayName: 'External MCP Servers',
  priority: 30,

  provideTools(_ctx: ToolProviderContext): ToolSet {
    const { buildMcpToolSet } = require('../../mcp-tool-adapter') as typeof import('../../mcp-tool-adapter');
    return buildMcpToolSet();
  },

  isAvailable(_ctx: ToolProviderContext): boolean {
    // Available when at least one MCP server is connected
    try {
      const { buildMcpToolSet } = require('../../mcp-tool-adapter') as typeof import('../../mcp-tool-adapter');
      const tools = buildMcpToolSet();
      return Object.keys(tools).length > 0;
    } catch {
      return false;
    }
  },
};
