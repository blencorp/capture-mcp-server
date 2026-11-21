import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { mcpAuthRouter, getOAuthProtectedResourceMetadataUrl } from '@modelcontextprotocol/sdk/server/auth/router.js';
import { requireBearerAuth } from '@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js';
import express, { type Request, type Response } from 'express';

import {
  getOAuthPublicBaseUrl,
  getProviderKeysFromAuth,
  McpOAuthProvider,
  PROVIDER_IDS,
  renderAuthorizationPage,
  type ProviderId,
  type ProviderKeys,
  type FormFieldErrors,
} from './auth/mcp-oauth.js';
import { headerKeys, resolveRequestKeys, type KeySource } from './auth/request-keys.js';
import { registerToolHandlers } from './mcp-handlers.js';
import { SERVER_NAME, SERVER_VERSION } from './version.js';

/**
 * How the HTTP transport authenticates callers.
 *
 * - `oauth`: every `/mcp` request needs a valid bearer token. Tools use only the caller's own
 *   provider keys (sealed into the token, or sent in `X-*-Api-Key` headers alongside it).
 * - `insecure`: no authentication, for a single user on their own machine. The operator's
 *   environment keys are used. `src/server.ts` binds it to loopback unless HOST says otherwise.
 */
export type HttpAuth =
  | { mode: 'oauth'; publicBaseUrl: URL; tokenSecret: string; accessTokenTtlSeconds?: number; refreshTokenTtlSeconds?: number }
  | { mode: 'insecure' };

export type HttpAppOptions = {
  auth: HttpAuth;
  env?: NodeJS.ProcessEnv;
};

/**
 * The HTTP auth mode, or an error explaining why the server must not start. HTTP fails closed:
 * without OAuth it starts only when explicitly told it serves a single local user.
 */
export function httpAuthFromEnv(env: NodeJS.ProcessEnv, port: number): HttpAuth {
  if (env.MCP_REQUIRE_OAUTH === 'true') {
    const tokenSecret = env.OAUTH_TOKEN_SECRET?.trim();
    if (!tokenSecret) {
      throw new Error('MCP_REQUIRE_OAUTH=true needs OAUTH_TOKEN_SECRET (used to seal access tokens).');
    }
    return {
      mode: 'oauth',
      publicBaseUrl: getOAuthPublicBaseUrl(port),
      tokenSecret,
      accessTokenTtlSeconds: parsePositiveInt(env.OAUTH_ACCESS_TOKEN_TTL_SECONDS),
      refreshTokenTtlSeconds: parsePositiveInt(env.OAUTH_REFRESH_TOKEN_TTL_SECONDS),
    };
  }
  if (env.MCP_ALLOW_INSECURE_HTTP === 'true') {
    return { mode: 'insecure' };
  }
  throw new Error(
    'HTTP mode needs authentication: set MCP_REQUIRE_OAUTH=true (with OAUTH_TOKEN_SECRET). ' +
      'For a single user on this machine only, set MCP_ALLOW_INSECURE_HTTP=true instead ' +
      '(binds 127.0.0.1 and uses this process\'s API keys).',
  );
}

function parsePositiveInt(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', 'localhost']);

/**
 * The address to listen on. Unauthenticated (single-user) HTTP serves the operator's own keys,
 * so it may only listen on loopback; a non-loopback HOST is a startup error, not an override.
 */
export function listenHost(auth: HttpAuth, env: NodeJS.ProcessEnv): string {
  if (auth.mode === 'insecure') {
    const host = env.HOST || '127.0.0.1';
    if (!LOOPBACK_HOSTS.has(host)) {
      throw new Error(
        `MCP_ALLOW_INSECURE_HTTP serves this process's API keys without authentication, so it binds loopback only (HOST=${host} refused). Use MCP_REQUIRE_OAUTH=true to serve other hosts.`,
      );
    }
    return host;
  }
  return env.HOST || '0.0.0.0';
}

export function createMcpServer(): Server {
  return new Server({ name: SERVER_NAME, version: SERVER_VERSION }, { capabilities: { tools: {} } });
}

export function createHttpApp({ auth, env = process.env }: HttpAppOptions): express.Express {
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));

  app.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'healthy', transport: 'http', version: SERVER_VERSION, authMode: auth.mode });
  });

  let gate: express.RequestHandler[] = [];
  if (auth.mode === 'oauth') {
    const mcpResourceUrl = new URL('/mcp', auth.publicBaseUrl);
    const provider = new McpOAuthProvider({
      baseUrl: auth.publicBaseUrl,
      tokenSecret: auth.tokenSecret,
      accessTokenTtlSeconds: auth.accessTokenTtlSeconds,
      refreshTokenTtlSeconds: auth.refreshTokenTtlSeconds,
    });

    app.get('/oauth/authorize', (req: Request, res: Response) => {
      const requestId = typeof req.query.request_id === 'string' ? req.query.request_id : '';
      res
        .status(requestId ? 200 : 400)
        .type('html')
        .send(renderAuthorizationPage(requestId, { error: requestId ? undefined : 'Authorization request is missing.' }));
    });

    app.post('/oauth/authorize', async (req: Request, res: Response) => {
      const requestId = typeof req.body.request_id === 'string' ? req.body.request_id : '';
      const { keys, checked, fieldErrors } = parseAuthorizeForm(req.body);
      try {
        res.redirect(302, await provider.completeAuthorization(requestId, keys));
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Authorization failed';
        res.status(400).type('html').send(renderAuthorizationPage(requestId, { error: message, checked, fieldErrors }));
      }
    });

    app.use(
      mcpAuthRouter({
        provider,
        issuerUrl: auth.publicBaseUrl,
        baseUrl: auth.publicBaseUrl,
        resourceServerUrl: mcpResourceUrl,
        scopesSupported: ['mcp:tools'],
        resourceName: 'GovCon Capture',
      }),
    );

    // Every tool call needs a verified bearer token. Provider-key headers are never a substitute:
    // they say which upstream key to use, not who the caller is.
    gate = [
      requireBearerAuth({
        verifier: provider,
        requiredScopes: [],
        resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(mcpResourceUrl),
      }),
    ];
  }

  app.post('/mcp', ...gate, async (req: Request, res: Response) => {
    try {
      const headers = headerKeys(name => req.get(name));
      const source: KeySource =
        auth.mode === 'oauth'
          ? { kind: 'caller', sealed: getProviderKeysFromAuth(req.auth), headers }
          : { kind: 'operator', headers, env };

      const server = createMcpServer();
      await registerToolHandlers(server, resolveRequestKeys(source));

      // Stateless: a fresh server and transport per request.
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      res.on('close', () => {
        void transport.close();
      });
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      console.error('Error handling MCP request:', error instanceof Error ? error.message : error);
      if (!res.headersSent) {
        res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal server error' }, id: null });
      }
    }
  });

  app.all('/mcp', (_req: Request, res: Response) => {
    res.status(405).json({
      jsonrpc: '2.0',
      error: { code: -32601, message: 'Method not allowed. Use POST for MCP requests.' },
      id: null,
    });
  });

  return app;
}

function parseAuthorizeForm(body: any): {
  keys: ProviderKeys;
  checked: Partial<Record<ProviderId, boolean>>;
  fieldErrors: FormFieldErrors;
} {
  const rawEnabled = body?.['enabled[]'] ?? body?.enabled;
  const enabledList: string[] = Array.isArray(rawEnabled)
    ? rawEnabled.filter((v): v is string => typeof v === 'string')
    : typeof rawEnabled === 'string'
      ? [rawEnabled]
      : [];

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
