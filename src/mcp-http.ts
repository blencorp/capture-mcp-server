import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  createMcpHandler,
  isJsonContentType,
  isLegacyRequest,
  type AuthInfo,
} from '@modelcontextprotocol/server';
import { NodeStreamableHTTPServerTransport, toNodeHandler, toWebRequest } from '@modelcontextprotocol/node';
import { buildServer, resolveRequestKeys, type BuildServerOptions, type ResolvedKeys } from './mcp-factory.js';

/**
 * The stateless HTTP composition shared by the Railway server and the Lambda
 * handler. Two protocol eras are served side by side:
 *
 * - 2026-07-28 requests go through `createMcpHandler` (`legacy: 'reject'`,
 *   `responseMode: 'json'`).
 * - 2025-era requests are routed by `isLegacyRequest` to a hand-wired
 *   stateless transport with `enableJsonResponse: true` — byte-for-byte the
 *   serving existing hosted clients were validated against, rather than the
 *   entry's built-in fallback, which answers SSE-negotiating clients with an
 *   SSE-framed body that API Gateway + serverless-express never had to carry.
 *
 * Hand-wired compositions own the Content-Type gate (415 before either leg).
 */

export type McpRequest = IncomingMessage & { auth?: AuthInfo; body?: unknown };

export interface CaptureMcpHandlerOptions {
  onerror?: (error: Error) => void;
  /** Observability hook: which key sources served this request. */
  onKeysResolved?: (resolved: ResolvedKeys, era: 'legacy' | 'modern') => void;
  onToolCall?: BuildServerOptions['onToolCall'];
  onToolResult?: BuildServerOptions['onToolResult'];
}

export function createCaptureMcpHandler(options: CaptureMcpHandlerOptions = {}) {
  const { onerror, onKeysResolved, onToolCall, onToolResult } = options;

  const buildForRequest = async (
    era: 'legacy' | 'modern',
    authInfo: AuthInfo | undefined,
    requestInfo: Request | undefined,
  ) => {
    const resolved = resolveRequestKeys({ authInfo, requestInfo });
    onKeysResolved?.(resolved, era);
    return buildServer({
      config: resolved.config,
      apiKeyOverrides: resolved.overrides,
      onToolCall,
      onToolResult,
    });
  };

  const modernHandler = createMcpHandler(
    ctx => buildForRequest('modern', ctx.authInfo, ctx.requestInfo),
    { legacy: 'reject', responseMode: 'json', onerror },
  );
  const modernNodeHandler = toNodeHandler(modernHandler, { onerror });

  return async function handleMcpRequest(req: McpRequest, res: ServerResponse): Promise<void> {
    try {
      if (!isJsonContentType(req.headers['content-type'])) {
        res.writeHead(415, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          jsonrpc: '2.0',
          error: { code: -32600, message: 'Unsupported Media Type: Content-Type must be application/json' },
          id: null,
        }));
        return;
      }

      // The Express JSON body parser has already drained the stream, so the
      // classification probe is built from the parsed body.
      const probe = await toWebRequest(req, req.body);

      if (await isLegacyRequest(probe, req.body)) {
        const server = await buildForRequest('legacy', req.auth, probe);
        const transport = new NodeStreamableHTTPServerTransport({
          sessionIdGenerator: undefined,
          enableJsonResponse: true,
        });
        res.on('close', () => {
          void transport.close();
        });
        await server.connect(transport);
        await transport.handleRequest(req, res, req.body);
        return;
      }

      await modernNodeHandler(req, res, req.body);
    } catch (error) {
      onerror?.(error instanceof Error ? error : new Error(String(error)));
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          jsonrpc: '2.0',
          error: { code: -32603, message: 'Internal server error' },
          id: null,
        }));
      }
    }
  };
}
