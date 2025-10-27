import { Tool } from "@modelcontextprotocol/sdk/types.js";

// Import all tool implementations
import { samTools } from './sam-tools.js';
import { usaspendingTools } from './usaspending-tools.js';
import { joinTools } from './join-tools.js';
import { tangoTools } from './tango-tools.js';

// Tool registry
const toolRegistry = new Map<string, (args: any) => Promise<any>>();

export async function initializeTools(): Promise<Tool[]> {
  const allTools: Tool[] = [];
  
  // Register SAM.gov tools
  const samToolList = await samTools.getTools();
  samToolList.forEach(tool => {
    allTools.push(tool);
    toolRegistry.set(tool.name, (args) => samTools.callTool(tool.name, args));
  });

  // Register USASpending.gov tools  
  const usaspendingToolList = await usaspendingTools.getTools();
  usaspendingToolList.forEach(tool => {
    allTools.push(tool);
    toolRegistry.set(tool.name, (args) => usaspendingTools.callTool(tool.name, args));
  });

  // Register join tools
  const joinToolList = await joinTools.getTools();
  joinToolList.forEach(tool => {
    allTools.push(tool);
    toolRegistry.set(tool.name, (args) => joinTools.callTool(tool.name, args));
  });

  // Register Tango tools
  const tangoToolList = await tangoTools.getTools();
  tangoToolList.forEach(tool => {
    allTools.push(tool);
    toolRegistry.set(tool.name, (args) => tangoTools.callTool(tool.name, args));
  });

  return allTools;
}

export async function callTool(name: string, args: any): Promise<any> {
  const toolFunction = toolRegistry.get(name);
  
  if (!toolFunction) {
    throw new Error(`Tool "${name}" not found`);
  }

  return await toolFunction(args);
}