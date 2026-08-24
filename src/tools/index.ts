import type { Tool } from "@modelcontextprotocol/server";

// Import all tool implementations
import { samTools } from './sam-tools.js';
import { usaspendingTools } from './usaspending-tools.js';
import { joinTools } from './join-tools.js';
import { tangoTools } from './tango-tools.js';
import { highergovTools } from './highergov-tools.js';
import { referenceTools } from './reference-tools.js';

type ApiKeyName = 'samKey' | 'tangoKey' | 'higherGovKey';
type ToolFunction = (args: any) => Promise<any>;

// Design convention: reject unknown or mistyped parameters with a structured
// bad_request instead of accepting-and-ignoring them. A silently dropped
// filter is how the P0 bugs stayed invisible; at the MCP boundary that failure
// mode is now impossible.
export function validateToolArgs(tool: Tool, args: any): string | null {
  if (args === null || args === undefined) return null;
  if (typeof args !== 'object' || Array.isArray(args)) return 'Tool arguments must be an object';

  const schema: any = tool.inputSchema;
  const properties: Record<string, any> = schema?.properties ?? {};
  const allowed = new Set(Object.keys(properties));
  allowed.add('api_key'); // injected from HTTP headers even where a schema omits it

  const unknown = Object.keys(args).filter(key => !allowed.has(key));
  if (unknown.length > 0) {
    return (
      `Unknown parameter(s) for ${tool.name}: ${unknown.join(', ')}. ` +
      `Accepted parameters: ${Object.keys(properties).join(', ')}. ` +
      `Unknown parameters are rejected rather than silently ignored.`
    );
  }

  const required: string[] = Array.isArray(schema?.required) ? schema.required : [];
  const missing = required.filter(key => args[key] === undefined || args[key] === null || args[key] === '');
  if (missing.length > 0) {
    return `Missing required parameter(s) for ${tool.name}: ${missing.join(', ')}`;
  }

  for (const [key, value] of Object.entries(args)) {
    if (value === undefined || value === null) continue;
    const prop = properties[key];
    if (!prop || typeof prop.type !== 'string') continue; // anyOf/union types: skip
    const expected = prop.type;
    const okType =
      expected === 'string' ? typeof value === 'string'
      : expected === 'number' ? typeof value === 'number' && Number.isFinite(value)
      : expected === 'boolean' ? typeof value === 'boolean'
      : expected === 'array' ? Array.isArray(value)
      : expected === 'object' ? typeof value === 'object' && !Array.isArray(value)
      : true;
    if (!okType) {
      return `Parameter "${key}" of ${tool.name} must be a ${expected}`;
    }
  }
  return null;
}

export interface ApiKeyConfig {
  hasSamApiKey: boolean;
  hasTangoApiKey: boolean;
  hasHigherGovApiKey: boolean;
  // Actual key values (from headers or env vars) for injection into tool calls
  samApiKey?: string;
  tangoApiKey?: string;
  higherGovApiKey?: string;
}

export interface CaptureToolRegistry {
  readonly tools: Tool[];
  callTool(
    name: string,
    args: any,
    apiKeyOverrides?: { samKey?: string; tangoKey?: string; higherGovKey?: string },
  ): Promise<any>;
}

/**
 * Build an isolated tool registry for one MCP server instance.
 *
 * HTTP creates a fresh Server for every request. Keeping these maps local is
 * therefore a correctness requirement: module-global maps let overlapping
 * requests clear or extend one another's callable tool set.
 */
export async function initializeTools(config: ApiKeyConfig): Promise<CaptureToolRegistry> {
  const allTools: Tool[] = [];
  const enabledToolSets: string[] = [];
  const toolRegistry = new Map<string, ToolFunction>();
  const toolApiKeyRegistry = new Map<string, ApiKeyName | null>();
  const toolSchemaRegistry = new Map<string, Tool>();

  // Always register reference tools (static lookups, no API key or network)
  const referenceToolList = await referenceTools.getTools();
  referenceToolList.forEach(tool => {
    allTools.push(tool);
    toolRegistry.set(tool.name, (args) => referenceTools.callTool(tool.name, args));
    toolApiKeyRegistry.set(tool.name, null);
    toolSchemaRegistry.set(tool.name, tool);
  });
  enabledToolSets.push(`Reference (${referenceToolList.length} tools)`);

  // Always register USASpending.gov tools (no API key required - public API)
  const usaspendingToolList = await usaspendingTools.getTools();
  usaspendingToolList.forEach(tool => {
    allTools.push(tool);
    toolRegistry.set(tool.name, (args) => usaspendingTools.callTool(tool.name, args));
    toolApiKeyRegistry.set(tool.name, null);
    toolSchemaRegistry.set(tool.name, tool);
  });
  enabledToolSets.push(`USASpending.gov (${usaspendingToolList.length} tools)`);

  // Conditionally register SAM.gov tools
  if (config.hasSamApiKey) {
    const samToolList = await samTools.getTools();
    samToolList.forEach(tool => {
      allTools.push(tool);
      toolRegistry.set(tool.name, (args) => samTools.callTool(tool.name, args));
      toolApiKeyRegistry.set(tool.name, 'samKey');
      toolSchemaRegistry.set(tool.name, tool);
    });
    enabledToolSets.push(`SAM.gov (${samToolList.length} tools)`);

    // Register join tools (require SAM.gov API key)
    const joinToolList = await joinTools.getTools();
    joinToolList.forEach(tool => {
      allTools.push(tool);
      toolRegistry.set(tool.name, (args) => joinTools.callTool(tool.name, args));
      toolApiKeyRegistry.set(tool.name, 'samKey');
      toolSchemaRegistry.set(tool.name, tool);
    });
    enabledToolSets.push(`Join Tools (${joinToolList.length} tools)`);
  }

  // Conditionally register Tango tools
  if (config.hasTangoApiKey) {
    const tangoToolList = await tangoTools.getTools();
    tangoToolList.forEach(tool => {
      allTools.push(tool);
      toolRegistry.set(tool.name, (args) => tangoTools.callTool(tool.name, args));
      toolApiKeyRegistry.set(tool.name, 'tangoKey');
      toolSchemaRegistry.set(tool.name, tool);
    });
    enabledToolSets.push(`Tango API (${tangoToolList.length} tools)`);
  }

  // Conditionally register HigherGov tools
  if (config.hasHigherGovApiKey) {
    const highergovToolList = await highergovTools.getTools();
    highergovToolList.forEach(tool => {
      allTools.push(tool);
      toolRegistry.set(tool.name, (args) => highergovTools.callTool(tool.name, args));
      toolApiKeyRegistry.set(tool.name, 'higherGovKey');
      toolSchemaRegistry.set(tool.name, tool);
    });
    enabledToolSets.push(`HigherGov (${highergovToolList.length} tools)`);
  }

  // Log enabled tool sets in debug mode
  if (process.env.DEBUG) {
    console.error(`Enabled tool sets: ${enabledToolSets.join(", ")}`);
    console.error(`Total tools available: ${allTools.length}`);
  }

  return {
    tools: Object.freeze([...allTools]) as Tool[],
    async callTool(name, args, apiKeyOverrides) {
      const toolFunction = toolRegistry.get(name);

      if (!toolFunction) {
        throw new Error(`Tool "${name}" not found`);
      }

      const schema = toolSchemaRegistry.get(name);
      if (schema) {
        const validationError = validateToolArgs(schema, args);
        if (validationError) {
          return { error: { code: 'bad_request', message: validationError } };
        }
      }

      // Inject the key resolved for this request, never one held by another
      // registry or request.
      let argsWithKey = args;
      if (apiKeyOverrides) {
        const keyName = toolApiKeyRegistry.get(name);
        const keyForTool = keyName ? apiKeyOverrides[keyName] : undefined;
        if (keyForTool && !args?.api_key) {
          argsWithKey = { ...args, api_key: keyForTool };
          if (process.env.DEBUG) {
            console.error(`[${name}] Injecting API key from header`);
          }
        }
      }

      return await toolFunction(argsWithKey);
    }
  };
}
