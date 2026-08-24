#!/usr/bin/env node

import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { requireBearerAuth, getOAuthProtectedResourceMetadataUrl } from '@modelcontextprotocol/express';
import express, { Request, Response } from 'express';

import { initializeTools, ApiKeyConfig } from './tools/index.js';
import { buildServer, envKeyConfig, SERVER_VERSION } from './mcp-factory.js';
import { createCaptureMcpHandler } from './mcp-http.js';
import {
  getOAuthPublicBaseUrl,
  McpOAuthProvider,
  PROVIDER_IDS,
  renderAuthorizationPage,
  type ProviderId,
  type ProviderKeys,
  type FormFieldErrors,
} from './auth/mcp-oauth.js';
import { oauthEndpointsRouter } from './auth/oauth-endpoints.js';
import { createOAuthStateStoreFromEnv, type OAuthStateStore } from './auth/oauth-state-store.js';

// Transport mode: 'stdio' (default) or 'http'
const TRANSPORT_MODE = process.env.MCP_TRANSPORT || 'stdio';
const HTTP_PORT = parseInt(process.env.PORT || '3000', 10);
const REQUIRE_OAUTH = process.env.MCP_REQUIRE_OAUTH === 'true';

/**
 * Logs startup information
 */
function logStartupInfo(config: ApiKeyConfig, toolCount: number): void {
  if (process.env.DEBUG) {
    console.error("Capture MCP Server initializing...");
    console.error(`Transport mode: ${TRANSPORT_MODE}`);
    console.error("API Key Status:");
    console.error(`  SAM.gov API Key: ${config.hasSamApiKey ? "✓ Configured" : "✗ Not set"}`);
    console.error(`  Tango API Key: ${config.hasTangoApiKey ? "✓ Configured" : "✗ Not set"}`);
    console.error(`  HigherGov API Key: ${config.hasHigherGovApiKey ? "✓ Configured" : "✗ Not set"}`);
    console.error("  USASpending.gov: ✓ Always available (public API)");
    console.error(`Total tools available: ${toolCount}`);

    if (!config.hasSamApiKey && !config.hasTangoApiKey && !config.hasHigherGovApiKey) {
      console.error("\nWARNING: No API keys configured. Only USASpending.gov tools will be available.");
      console.error("Set SAM_GOV_API_KEY, TANGO_API_KEY, and/or HIGHERGOV_API_KEY environment variables to enable additional tools.");
    }
  }
}

/**
 * Run the server in stdio mode (for local desktop clients).
 * serveStdio serves 2026-07-28 clients natively and pins connections that
 * open with the 2025 initialize handshake to a legacy-era instance, so
 * existing Claude Desktop installs keep working.
 */
async function runStdioMode(): Promise<void> {
  const config = envKeyConfig();

  if (process.env.DEBUG) {
    const registry = await initializeTools(config);
    logStartupInfo(config, registry.tools.length);
  }

  serveStdio(() => buildServer({ config }), {
    onerror: (error) => console.error('Capture MCP Server stdio error:', error),
  });

  if (process.env.DEBUG) {
    console.error("Capture MCP Server running on stdio");
  }
}

/**
 * Run the server in HTTP mode (for Railway/remote clients).
 * Stateless per MCP 2026-07-28; 2025-era clients are served through the
 * legacy stateless path (see mcp-http.ts).
 */
async function runHttpMode(): Promise<void> {
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));

  // Health check endpoint
  app.get('/health', (_req: Request, res: Response) => {
    res.json({
      status: 'healthy',
      transport: 'http',
      version: SERVER_VERSION,
      protocolVersion: '2026-07-28',
      authMode: REQUIRE_OAUTH ? 'oauth' : 'none'
    });
  });

  let oauthProvider: McpOAuthProvider | undefined;
  let oauthStateStore: OAuthStateStore | undefined;

  if (REQUIRE_OAUTH) {
    const publicBaseUrl = getOAuthPublicBaseUrl(HTTP_PORT);
    const mcpResourceUrl = new URL('/mcp', publicBaseUrl);
    const tokenSecret = process.env.OAUTH_TOKEN_SECRET || '';
    // Validate before opening Redis so a bad startup configuration cannot
    // leave a reconnecting client behind while main() unwinds.
    if (!tokenSecret.trim()) {
      throw new Error('OAUTH_TOKEN_SECRET is required when MCP_REQUIRE_OAUTH=true');
    }
    oauthStateStore = await createOAuthStateStoreFromEnv();
    oauthProvider = new McpOAuthProvider({
      baseUrl: publicBaseUrl,
      resourceUrl: mcpResourceUrl,
      tokenSecret,
      accessTokenTtlSeconds: parsePositiveInt(process.env.OAUTH_ACCESS_TOKEN_TTL_SECONDS),
      refreshTokenTtlSeconds: parsePositiveInt(process.env.OAUTH_REFRESH_TOKEN_TTL_SECONDS),
      stateStore: oauthStateStore,
    });

    app.get('/oauth/authorize', (req: Request, res: Response) => {
      const requestId = typeof req.query.request_id === 'string' ? req.query.request_id : '';
      res
        .status(requestId ? 200 : 400)
        .type('html')
        .send(renderAuthorizationPage(requestId, {
          error: requestId ? undefined : 'Authorization request is missing.',
        }));
    });

    app.post('/oauth/authorize', async (req: Request, res: Response) => {
      const requestId = typeof req.body.request_id === 'string' ? req.body.request_id : '';
      const { keys, checked, fieldErrors } = parseAuthorizeForm(req.body);

      try {
        const redirectUrl = await oauthProvider!.completeAuthorization(requestId, keys);
        res.redirect(302, redirectUrl);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Authorization failed';
        res
          .status(400)
          .type('html')
          .send(renderAuthorizationPage(requestId, { error: message, checked, fieldErrors }));
      }
    });

    // OAuth 2.1 authorization-server endpoints (/authorize, /token, /register,
    // /revoke) plus the .well-known discovery documents. SDK v2 no longer
    // ships an authorization server, so these live in-repo now.
    app.use(oauthEndpointsRouter({
      provider: oauthProvider,
      baseUrl: publicBaseUrl,
      mcpResourceUrl,
      resourceName: 'GovCon Capture',
    }));
  }

  // MCP endpoint - stateless mode.
  // Auth gate: when OAuth is enabled, require a bearer token UNLESS the caller
  // brings their own provider key via X-*-Api-Key headers (header passthrough
  // for programmatic clients). The provider key itself is the trust anchor.
  const mcpAuthGate = (() => {
    if (!oauthProvider) return [];
    const bearerMiddleware = requireBearerAuth({
      verifier: oauthProvider,
      requiredScopes: [],
      resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(new URL('/mcp', getOAuthPublicBaseUrl(HTTP_PORT))),
    });
    const gate = (req: Request, res: Response, next: (err?: any) => void) => {
      if (hasProviderHeader(req)) {
        return next();
      }
      return bearerMiddleware(req, res, next);
    };
    return [gate];
  })();

  const handleMcp = createCaptureMcpHandler({
    onerror: (error) => console.error('Error handling MCP request:', error),
    onKeysResolved: (resolved, era) => {
      if (process.env.DEBUG) {
        console.error(`API Key Sources (${era} protocol era):`);
        console.error(`  SAM.gov: ${resolved.sources.sam}`);
        console.error(`  Tango: ${resolved.sources.tango}`);
        console.error(`  HigherGov: ${resolved.sources.highergov}`);
      }
    },
  });

  app.post('/mcp', ...mcpAuthGate, (req: Request, res: Response) => {
    void handleMcp(req, res);
  });

  // Handle unsupported methods on /mcp
  app.all('/mcp', (_req: Request, res: Response) => {
    res.status(405).json({
      jsonrpc: '2.0',
      error: {
        code: -32601,
        message: 'Method not allowed. Use POST for MCP requests.'
      },
      id: null
    });
  });

  // Start the HTTP server
  const httpServer = app.listen(HTTP_PORT, () => {
    console.log(`Capture MCP Server running in HTTP mode on port ${HTTP_PORT}`);
    console.log(`MCP endpoint: http://localhost:${HTTP_PORT}/mcp`);
    console.log(`Health check: http://localhost:${HTTP_PORT}/health`);

    if (process.env.DEBUG) {
      const config = envKeyConfig();
      console.error("API Key Status:");
      console.error(`  SAM.gov API Key: ${config.hasSamApiKey ? "✓ Configured" : "✗ Not set"}`);
      console.error(`  Tango API Key: ${config.hasTangoApiKey ? "✓ Configured" : "✗ Not set"}`);
      console.error(`  HigherGov API Key: ${config.hasHigherGovApiKey ? "✓ Configured" : "✗ Not set"}`);
      console.error("  USASpending.gov: ✓ Always available (public API)");
    }
  }).on('error', (error) => {
    console.error('Server error:', error);
    process.exit(1);
  });

  let shuttingDown = false;
  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`Received ${signal}; stopping HTTP server`);

    void handleMcp.close()
      .catch(error => console.error('Failed to close MCP exchanges:', error))
      .finally(() => {
        httpServer.close(() => {
          void oauthStateStore?.close?.().finally(() => process.exit(0));
        });
      });
  };
  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.once('SIGINT', () => shutdown('SIGINT'));
}

function hasProviderHeader(req: Request): boolean {
  return Boolean(
    req.get('X-Sam-Api-Key') ||
    req.get('X-Tango-Api-Key') ||
    req.get('X-Highergov-Api-Key')
  );
}

function parseAuthorizeForm(body: any): {
  keys: ProviderKeys;
  checked: Partial<Record<ProviderId, boolean>>;
  fieldErrors: FormFieldErrors;
} {
  const rawEnabled = body?.['enabled[]'] ?? body?.enabled;
  const enabledList: string[] = Array.isArray(rawEnabled)
    ? rawEnabled.filter((v): v is string => typeof v === 'string')
    : typeof rawEnabled === 'string' ? [rawEnabled] : [];

  const checked: Partial<Record<ProviderId, boolean>> = {};
  const keys: ProviderKeys = {};
  const fieldErrors: FormFieldErrors = {};

  for (const id of PROVIDER_IDS) {
    const isChecked = enabledList.includes(id);
    checked[id] = isChecked;
    if (!isChecked) continue;

    const raw = body?.[`${id}_api_key`];
    const value = typeof raw === 'string' ? raw.trim() : '';
    if (!value) {
      fieldErrors[id] = 'API key is required when this provider is selected.';
      continue;
    }
    keys[id] = value;
  }

  return { keys, checked, fieldErrors };
}

function parsePositiveInt(value: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

/**
 * Main entry point
 */
async function main(): Promise<void> {
  if (TRANSPORT_MODE === 'http') {
    await runHttpMode();
  } else if (TRANSPORT_MODE === 'stdio') {
    await runStdioMode();
  } else {
    console.error(`Unknown transport mode: ${TRANSPORT_MODE}`);
    console.error('Valid options: stdio (default), http');
    process.exit(1);
  }
}

// Start the server
main().catch((error) => {
  console.error("Failed to start server:", error);
  process.exit(1);
});
