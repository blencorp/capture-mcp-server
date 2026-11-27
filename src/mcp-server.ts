import {
  McpServer,
  fromJsonSchema,
  type CallToolResult,
  type JsonSchemaType,
  type jsonSchemaValidator,
  type StandardSchemaWithJSON,
} from '@modelcontextprotocol/server';

import type { RequestKeys } from './auth/request-keys.js';
import { ToolCatalog } from './tools/index.js';
import { isToolFailure } from './tools/tool-metadata.js';
import { withRequestSignal } from './utils/request-signal.js';
import { SERVER_NAME, SERVER_VERSION } from './version.js';

/**
 * The MCP revision this server speaks first. The SDK's exported `LATEST_PROTOCOL_VERSION` names the
 * newest 2025 revision, the one older clients negotiate through `initialize`; this one is chosen
 * by the client in each request.
 */
export const MCP_PROTOCOL_VERSION = '2026-07-28';

/**
 * Tool arguments are checked by `ToolCatalog.call`, not by the SDK: it names the unknown, missing or
 * mistyped parameter in a structured `bad_request` (a call that still ends as `isError`), and the
 * schemas sent to clients stay as written. So the input schema is advertised, and the SDK's own
 * validation of it is a pass-through.
 */
const catalogValidatesInput: jsonSchemaValidator = {
  getValidator: () => input => ({ valid: true, data: input as never, errorMessage: undefined }),
};

/**
 * Output schemas, converted once per tool for the life of the process. `fromJsonSchema` compiles a
 * validator, and the SDK's default validator caches every compiled schema by object identity without
 * evicting. The catalog builds fresh schema objects for each request, so converting them per request
 * would grow that cache by every tool, every time. A tool's schema never changes, so its name is the key.
 */
const outputSchemas = new Map<string, StandardSchemaWithJSON<unknown, unknown>>();

function outputSchemaFor(name: string, schema: unknown): StandardSchemaWithJSON<unknown, unknown> {
  let converted = outputSchemas.get(name);
  if (!converted) {
    converted = fromJsonSchema(schema as JsonSchemaType);
    outputSchemas.set(name, converted);
  }
  return converted;
}

/** The text a tool result is shown as: the structured result, indented, for people and older clients. */
const text = (value: unknown): string => JSON.stringify(value, null, 2);

/**
 * One tool call as the MCP result: the tool's own result as text and as `structuredContent`, marked
 * `isError` when it reports a failure (a top-level `error`, or a thrown exception). A call never
 * ends in a protocol error because a tool or its upstream failed.
 */
async function callTool(catalog: ToolCatalog, request: RequestKeys, name: string, args: unknown, signal: AbortSignal | undefined): Promise<CallToolResult> {
  try {
    const result: unknown = await withRequestSignal(signal, () => catalog.call(name, args ?? {}, request.keys));
    if (result === null || typeof result !== 'object' || Array.isArray(result)) {
      throw new Error(`Tool "${name}" returned something other than an object`);
    }
    const structured = result as Record<string, unknown>;
    return {
      content: [{ type: 'text', text: text(structured) }],
      structuredContent: structured,
      ...(isToolFailure(structured) ? { isError: true } : {}),
    };
  } catch (error) {
    const failure = { error: error instanceof Error ? error.message : 'Unknown error' };
    return { content: [{ type: 'text', text: text(failure) }], structuredContent: failure, isError: true };
  }
}

/**
 * A server for one request, holding the tools that request's keys unlock. Nothing is shared between
 * requests, so what a tool sees is always the caller of this request.
 */
export async function buildMcpServer(request: RequestKeys): Promise<McpServer> {
  const catalog = await ToolCatalog.create(request.config);
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    // The tool list is fixed for the life of a request, and there is no session to tell about changes.
    { capabilities: { tools: { listChanged: false } } },
  );

  for (const tool of catalog.tools) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        annotations: tool.annotations,
        inputSchema: fromJsonSchema(tool.inputSchema as JsonSchemaType, catalogValidatesInput),
        outputSchema: outputSchemaFor(tool.name, tool.outputSchema),
      },
      (args, ctx) => callTool(catalog, request, tool.name, args, ctx.mcpReq.signal),
    );
  }
  return server;
}
