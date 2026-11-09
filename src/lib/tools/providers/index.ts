/**
 * tools/providers/index.ts — Register all built-in ToolProviders.
 *
 * Import this module once at app startup to register the standard
 * tool providers. After registration, assembleToolSet() from
 * tool-registry.ts can replace the hardcoded assembleTools() in
 * agent-tools.ts.
 */

import { registerToolProvider } from '../tool-registry';
import { builtinCodingProvider } from './builtin-coding';
import { builtinMcpProvider } from './builtin-mcp';
import { externalMcpProvider } from './external-mcp';

// Register in priority order (lower number = registered first)
registerToolProvider(builtinCodingProvider);   // priority 10
registerToolProvider(builtinMcpProvider);      // priority 20
registerToolProvider(externalMcpProvider);     // priority 30

export { builtinCodingProvider, builtinMcpProvider, externalMcpProvider };
