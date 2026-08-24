import { readFileSync } from 'node:fs';
import { Server, type McpRequestContext } from '@modelcontextprotocol/server';
import { initializeTools, type ApiKeyConfig } from './tools/index.js';
import { getProviderKeysFromAuth } from './auth/mcp-oauth.js';

/**
 * Per-request MCP server construction shared by every serving face (stdio,
 * Railway HTTP, Lambda). Under MCP 2026-07-28 a server instance answers one
 * request (or one stdio connection), so API keys are resolved from the
 * request context each time instead of being wired at process start.
 */

export const SERVER_NAME = 'Capture MCP Server';
export const SERVER_VERSION = readOwnVersion();

export interface ApiKeyOverrides {
  samKey?: string;
  tangoKey?: string;
  higherGovKey?: string;
}

export type KeySource = 'oauth' | 'header' | 'env' | 'none';

export interface ResolvedKeys {
  config: ApiKeyConfig;
  overrides: ApiKeyOverrides;
  sources: { sam: KeySource; tango: KeySource; highergov: KeySource };
}

/**
 * Resolves provider API keys for one request. Precedence per provider:
 * OAuth-sealed key → X-*-Api-Key header → environment variable.
 */
export function resolveRequestKeys(ctx: Pick<McpRequestContext, 'authInfo' | 'requestInfo'>): ResolvedKeys {
  const headers = ctx.requestInfo?.headers;
  const oauthKeys = getProviderKeysFromAuth(ctx.authInfo);

  const headerSamKey = headers?.get('x-sam-api-key') ?? undefined;
  const headerTangoKey = headers?.get('x-tango-api-key') ?? undefined;
  const headerHigherGovKey = headers?.get('x-highergov-api-key') ?? undefined;

  const samApiKey = oauthKeys.sam || headerSamKey || process.env.SAM_GOV_API_KEY;
  const tangoApiKey = oauthKeys.tango || headerTangoKey || process.env.TANGO_API_KEY;
  const higherGovApiKey = oauthKeys.highergov || headerHigherGovKey || process.env.HIGHERGOV_API_KEY;

  return {
    config: {
      hasSamApiKey: !!samApiKey,
      hasTangoApiKey: !!tangoApiKey,
      hasHigherGovApiKey: !!higherGovApiKey,
      samApiKey,
      tangoApiKey,
      higherGovApiKey,
    },
    overrides: {
      samKey: samApiKey,
      tangoKey: tangoApiKey,
      higherGovKey: higherGovApiKey,
    },
    sources: {
      sam: keySource(oauthKeys.sam, headerSamKey, samApiKey),
      tango: keySource(oauthKeys.tango, headerTangoKey, tangoApiKey),
      highergov: keySource(oauthKeys.highergov, headerHigherGovKey, higherGovApiKey),
    },
  };
}

export function envKeyConfig(): ApiKeyConfig {
  return {
    hasSamApiKey: !!process.env.SAM_GOV_API_KEY,
    hasTangoApiKey: !!process.env.TANGO_API_KEY,
    hasHigherGovApiKey: !!process.env.HIGHERGOV_API_KEY,
  };
}

export interface BuildServerOptions {
  config: ApiKeyConfig;
  apiKeyOverrides?: ApiKeyOverrides;
  onToolCall?: (toolName: string) => void;
  onToolResult?: (toolName: string, success: boolean, errorMessage?: string) => void;
}

/**
 * Creates a fresh MCP server with the tools the resolved keys allow. The
 * low-level Server API is used on purpose: the 34 tool definitions are static
 * wire-format JSON Schema objects and register unchanged.
 */
export async function buildServer(options: BuildServerOptions): Promise<Server> {
  const { config, apiKeyOverrides, onToolCall, onToolResult } = options;

  const server = new Server(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { capabilities: { tools: {} } },
  );

  const registry = await initializeTools(config);

  server.setRequestHandler('tools/list', async () => {
    return { tools: registry.tools };
  });

  server.setRequestHandler('tools/call', async (request) => {
    const { name, arguments: args } = request.params;
    onToolCall?.(name);

    try {
      const result = await registry.callTool(name, args ?? {}, apiKeyOverrides);
      const structured =
        result !== null && typeof result === 'object' && !Array.isArray(result) ? result : undefined;
      const textPayload =
        structured !== undefined
          ? JSON.stringify(structured, null, 2)
          : result === undefined
            ? 'undefined'
            : String(result);

      onToolResult?.(name, true);
      return {
        content: [{ type: 'text' as const, text: textPayload }],
        ...(structured ? { structuredContent: structured } : {}),
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      onToolResult?.(name, false, errorMessage);
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ error: errorMessage }, null, 2),
        }],
        structuredContent: { error: errorMessage },
        isError: true,
      };
    }
  });

  return server;
}

function keySource(oauthKey: string | undefined, headerKey: string | undefined, resolved: string | undefined): KeySource {
  if (oauthKey) return 'oauth';
  if (headerKey) return 'header';
  if (resolved) return 'env';
  return 'none';
}

function readOwnVersion(): string {
  // The build copies package.json next to the compiled output (dist/), which
  // is also the Lambda bundle root; the repo-root fallback covers ts-node dev
  // runs from src/.
  for (const candidate of ['./package.json', '../package.json']) {
    try {
      const parsed = JSON.parse(readFileSync(new URL(candidate, import.meta.url), 'utf8'));
      if (typeof parsed.version === 'string') return parsed.version;
    } catch {
      // try the next location
    }
  }
  return '0.0.0';
}
