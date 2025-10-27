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
}

export async function initializeTools(config: ApiKeyConfig): Promise<Tool[]> {
  const allTools: Tool[] = [];
  const enabledToolSets: string[] = [];

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

export async function callTool(name: string, args: any): Promise<any> {
  const toolFunction = toolRegistry.get(name);
  
  if (!toolFunction) {
    throw new Error(`Tool "${name}" not found`);
  }

  return await toolFunction(args);
}