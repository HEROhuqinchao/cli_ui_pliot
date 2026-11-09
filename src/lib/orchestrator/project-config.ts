/**
 * orchestrator/project-config.ts — Parse .codepilot/agents.json project config.
 *
 * Looks for a `.codepilot/agents.json` file in the working directory and
 * parses it into AgentProfile objects. Project-level profiles take precedence
 * over user-level DB profiles when IDs collide.
 *
 * Expected format:
 * {
 *   "agents": [
 *     { "id": "code-reviewer", "displayName": "Code Reviewer", "orchestrator": "single", ... }
 *   ]
 * }
 */

import fs from 'fs';
import path from 'path';
import type { AgentProfile } from './agent-profile';
import { registerProfile } from './agent-profile';

const CONFIG_FILENAME = 'agents.json';
const CONFIG_DIR = '.codepilot';

/**
 * Load and register agent profiles from a project's .codepilot/agents.json.
 * Returns the number of profiles loaded, or 0 if no config found.
 */
export function loadProjectAgentProfiles(workingDirectory: string): number {
  const configPath = path.join(workingDirectory, CONFIG_DIR, CONFIG_FILENAME);

  if (!fs.existsSync(configPath)) {
    return 0;
  }

  try {
    const raw = fs.readFileSync(configPath, 'utf-8');
    const parsed = JSON.parse(raw);

    if (!parsed.agents || !Array.isArray(parsed.agents)) {
      console.warn(`[orchestrator] ${configPath}: missing "agents" array`);
      return 0;
    }

    let count = 0;
    for (const agentDef of parsed.agents) {
      if (!agentDef.id || !agentDef.displayName || !agentDef.orchestrator) {
        console.warn(`[orchestrator] Skipping agent with missing id/displayName/orchestrator`);
        continue;
      }

      const profile: AgentProfile = {
        id: agentDef.id,
        displayName: agentDef.displayName,
        description: agentDef.description || '',
        version: agentDef.version || '1.0.0',
        orchestrator: agentDef.orchestrator,
        strategyId: agentDef.strategyId || 'react-loop',
        strategyOptions: agentDef.strategyOptions,
        toolProviderIds: agentDef.toolProviderIds || [],
        inlineTools: agentDef.inlineTools,
        systemPrompt: agentDef.systemPrompt,
        promptTemplate: agentDef.promptTemplate,
        permissionMode: agentDef.permissionMode,
        permissionBrokerId: agentDef.permissionBrokerId,
        contextPolicyId: agentDef.contextPolicyId,
        multiRole: agentDef.multiRole,
        workflow: agentDef.workflow,
        delegate: agentDef.delegate,
        model: agentDef.model,
        providerId: agentDef.providerId,
        maxSteps: agentDef.maxSteps,
        timeoutSec: agentDef.timeoutSec,
        source: 'project',
        icon: agentDef.icon,
      };

      registerProfile(profile);
      count++;
    }

    if (count > 0) {
      console.log(`[orchestrator] Loaded ${count} agent profile(s) from ${configPath}`);
    }

    return count;
  } catch (err) {
    console.warn(`[orchestrator] Failed to parse ${configPath}:`, err);
    return 0;
  }
}
