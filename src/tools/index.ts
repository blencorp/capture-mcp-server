import { Tool } from "@modelcontextprotocol/sdk/types.js";

// Import all tool implementations
import { samTools } from './sam-tools.js';
import { usaspendingTools } from './usaspending-tools.js';
import { joinTools } from './join-tools.js';
import { tangoTools } from './tango-tools.js';

// Tool registry
const toolRegistry = new Map<string, (args: any) => Promise<any>>();

export interface ApiKeyConfig {
  hasSamApiKey: boolean;
  hasTangoApiKey: boolean;
  // Actual key values (from headers or env vars) for injection into tool calls
  samApiKey?: string;
  tangoApiKey?: string;
}

export async function initializeTools(config: ApiKeyConfig): Promise<Tool[]> {
  const allTools: Tool[] = [];
  const enabledToolSets: string[] = [];

  toolRegistry.clear();

  // Always register USASpending.gov tools (no API key required - public API)
  const usaspendingToolList = await usaspendingTools.getTools();
  usaspendingToolList.forEach(tool => {
    allTools.push(tool);
    toolRegistry.set(tool.name, (args) => usaspendingTools.callTool(tool.name, args));
  });
  enabledToolSets.push("USASpending.gov (4 tools)");

  // Conditionally register SAM.gov tools
  if (config.hasSamApiKey) {
    const samToolList = await samTools.getTools();
    samToolList.forEach(tool => {
      allTools.push(tool);
      toolRegistry.set(tool.name, (args) => samTools.callTool(tool.name, args));
    });
    enabledToolSets.push("SAM.gov (4 tools)");

    // Register join tools (require SAM.gov API key)
    const joinToolList = await joinTools.getTools();
    joinToolList.forEach(tool => {
      allTools.push(tool);
      toolRegistry.set(tool.name, (args) => joinTools.callTool(tool.name, args));
    });
    enabledToolSets.push("Join Tools (2 tools)");
  }

  // Conditionally register Tango tools
  if (config.hasTangoApiKey) {
    const tangoToolList = await tangoTools.getTools();
    tangoToolList.forEach(tool => {
      allTools.push(tool);
      toolRegistry.set(tool.name, (args) => tangoTools.callTool(tool.name, args));
    });
    enabledToolSets.push("Tango API (5 tools)");
  }

  // Log enabled tool sets in debug mode
  if (process.env.DEBUG) {
    console.error(`Enabled tool sets: ${enabledToolSets.join(", ")}`);
    console.error(`Total tools available: ${allTools.length}`);
  }

  return allTools;
}

/**
 * Determines which API key to use for a given tool
 */
function getApiKeyForTool(toolName: string, keys: { samKey?: string, tangoKey?: string }): string | undefined {
  // SAM tools and join tools need SAM API key
  if (toolName.includes('sam') || toolName === 'get_entity_and_awards' || toolName === 'get_opportunity_spending_context') {
    return keys.samKey;
  }
  // Tango tools need Tango API key
  if (toolName.includes('tango')) {
    return keys.tangoKey;
  }
  // USASpending tools don't need an API key
  return undefined;
}

/**
 * Call a tool by name with arguments
 * @param name Tool name
 * @param args Tool arguments
 * @param apiKeyOverrides Optional API keys from HTTP headers to inject into args
 */
export async function callTool(
  name: string, 
  args: any, 
  apiKeyOverrides?: { samKey?: string, tangoKey?: string }
): Promise<any> {
  const toolFunction = toolRegistry.get(name);
  
  if (!toolFunction) {
    throw new Error(`Tool "${name}" not found`);
  }

  // Inject API key from headers if not already provided in args
  let argsWithKey = args;
  if (apiKeyOverrides) {
    const keyForTool = getApiKeyForTool(name, apiKeyOverrides);
    if (keyForTool && !args?.api_key) {
      argsWithKey = { ...args, api_key: keyForTool };
      if (process.env.DEBUG) {
        console.error(`[${name}] Injecting API key from header`);
      }
    }
  }

  return await toolFunction(argsWithKey);
}
