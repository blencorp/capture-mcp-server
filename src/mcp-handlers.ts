import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { ToolCatalog, type ProviderKeyOverrides } from './tools/index.js';
import type { RequestKeys } from './auth/request-keys.js';

export type ToolCallHooks = {
  started?(name: string): void;
  finished?(name: string, error?: string): void;
};

/**
 * Registers tools/list and tools/call on `server` for one request's keys. The catalog is built
 * per call, so the tool set and the keys it uses belong to this request alone.
 */
export async function registerToolHandlers(
  server: Server,
  { config, keys }: RequestKeys,
  hooks: ToolCallHooks = {},
): Promise<ToolCatalog> {
  const catalog = await ToolCatalog.create(config);

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: catalog.tools }));

  server.setRequestHandler(CallToolRequestSchema, async request => {
    const { name, arguments: args } = request.params;
    hooks.started?.(name);
    try {
      const result = await catalog.call(name, args ?? {}, keys satisfies ProviderKeyOverrides);
      const structured =
        result !== null && typeof result === 'object' && !Array.isArray(result) ? result : undefined;
      const text =
        structured !== undefined
          ? JSON.stringify(structured, null, 2)
          : result === undefined
            ? 'undefined'
            : String(result);
      hooks.finished?.(name);
      return {
        content: [{ type: 'text', text }],
        ...(structured ? { structuredContent: structured } : {}),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      hooks.finished?.(name, message);
      return {
        content: [{ type: 'text', text: JSON.stringify({ error: message }, null, 2) }],
        structuredContent: { error: message },
        isError: true,
      };
    }
  });

  return catalog;
}
