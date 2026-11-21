import { type Tool } from "@modelcontextprotocol/sdk/types.js";

// Import all tool implementations
import { samTools } from './sam-tools.js';
import { usaspendingTools } from './usaspending-tools.js';
import { joinTools } from './join-tools.js';
import { tangoTools } from './tango-tools.js';
import { highergovTools } from './highergov-tools.js';
import { referenceTools } from './reference-tools.js';

type ApiKeyName = 'samKey' | 'tangoKey' | 'higherGovKey';
export type ProviderKeyOverrides = { samKey?: string; tangoKey?: string; higherGovKey?: string };

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
  // Actual key values (resolved per request) for injection into tool calls
  samApiKey?: string;
  tangoApiKey?: string;
  higherGovApiKey?: string;
}

type ToolEntry = {
  tool: Tool;
  call: (args: any) => Promise<any>;
  keyName: ApiKeyName | null;
};

/**
 * The tools one request may use, and how to call them. Each request builds its own catalog from
 * the keys that request is allowed to use, so concurrent requests with different keys never see
 * each other's tool sets (a shared module-level registry was cleared and refilled per request).
 */
export class ToolCatalog {
  readonly tools: Tool[];
  readonly #entries: Map<string, ToolEntry>;

  private constructor(entries: ToolEntry[]) {
    this.tools = entries.map(entry => entry.tool);
    this.#entries = new Map(entries.map(entry => [entry.tool.name, entry]));
  }

  static async create(config: ApiKeyConfig): Promise<ToolCatalog> {
    const entries: ToolEntry[] = [];
    const enabledToolSets: string[] = [];
    const add = async (
      label: string,
      module: { getTools(): Promise<Tool[]> | Tool[]; callTool(name: string, args: any): Promise<any> },
      keyName: ApiKeyName | null,
    ) => {
      const list = await module.getTools();
      for (const tool of list) {
        entries.push({ tool, call: args => module.callTool(tool.name, args), keyName });
      }
      enabledToolSets.push(`${label} (${list.length} tools)`);
    };

    // Always available: static reference lookups and the public USASpending.gov API.
    await add('Reference', referenceTools, null);
    await add('USASpending.gov', usaspendingTools, null);
    if (config.hasSamApiKey) {
      await add('SAM.gov', samTools, 'samKey');
      await add('Join Tools', joinTools, 'samKey'); // join tools call SAM.gov
    }
    if (config.hasTangoApiKey) await add('Tango API', tangoTools, 'tangoKey');
    if (config.hasHigherGovApiKey) await add('HigherGov', highergovTools, 'higherGovKey');

    if (process.env.DEBUG) {
      console.error(`Enabled tool sets: ${enabledToolSets.join(', ')}`);
      console.error(`Total tools available: ${entries.length}`);
    }
    return new ToolCatalog(entries);
  }

  /**
   * Call a tool by name. `keys` are the provider keys this request may use; the one the tool
   * needs is injected as `api_key` unless the caller passed one explicitly.
   */
  async call(name: string, args: any, keys?: ProviderKeyOverrides): Promise<any> {
    const entry = this.#entries.get(name);
    if (!entry) {
      throw new Error(`Tool "${name}" not found`);
    }

    const validationError = validateToolArgs(entry.tool, args);
    if (validationError) {
      return { error: { code: 'bad_request', message: validationError } };
    }

    const keyForTool = entry.keyName && keys ? keys[entry.keyName] : undefined;
    const argsWithKey = keyForTool && !args?.api_key ? { ...args, api_key: keyForTool } : args;
    return await entry.call(argsWithKey);
  }
}
