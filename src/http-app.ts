import {
  bearerAuthChallengeResponse,
  createMcpHandler,
  getOAuthProtectedResourceMetadataUrl,
  verifyBearerToken,
  type AuthInfo,
  type McpRequestContext,
} from '@modelcontextprotocol/server';
import { toNodeHandler } from '@modelcontextprotocol/node';
import express, { type Request, type Response } from 'express';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  AUTHORIZATION_PAGE_CSP,
  DEFAULT_CLIENT_SCOPE,
  getOAuthPublicBaseUrl,
  getProviderKeysFromAuth,
  McpOAuthProvider,
  PROVIDER_IDS,
  renderAuthorizationPage,
  SUPPORTED_SCOPES,
  type ProviderId,
  type ProviderKeys,
  type FormFieldErrors,
} from './auth/mcp-oauth.js';
import { headerKeys, resolveRequestKeys, type KeySource } from './auth/request-keys.js';
import { bodyParsers, oauthRouter } from './auth/oauth-server.js';
import { bucketKey, clientIp } from './client-ip.js';
import { DOCS_PATH, docsHandler } from './docs.js';
import { buildMcpServer } from './mcp-server.js';
import { RequestBudget } from './rate-limit.js';
import { withRequestSignal } from './utils/request-signal.js';
import { readBuildInfo, type BuildInfo } from './build-info.js';

/**
 * How the HTTP transport authenticates callers.
 *
 * - `oauth`: every `/mcp` request needs a valid bearer token. Tools use only the caller's own
 *   provider keys (sealed into the token, or sent in `X-*-Api-Key` headers alongside it).
 * - `insecure`: no authentication, for a single user on their own machine. The operator's
 *   environment keys are used. `src/server.ts` binds it to loopback unless HOST says otherwise.
 */
export type HttpAuth =
  | {
      mode: 'oauth';
      publicBaseUrl: URL;
      tokenSecret: string;
      /** Retired secrets that still open tokens: a rotation in progress (see docs). */
      previousTokenSecrets?: string[];
      accessTokenTtlSeconds?: number;
      refreshTokenTtlSeconds?: number;
      /** The `/mcp` budget per client address: sustained requests per second, and the burst. */
      requestsPerSecond?: number;
      requestBurst?: number;
      /**
       * A header the proxy overwrites with the client address; unset, the address is the TCP peer.
       * Every per-address limiter uses it. Express's `trust proxy` is not used: behind Railway the
       * last X-Forwarded-For entry is the edge, not the client.
       */
      clientIpHeader?: string;
    }
  | { mode: 'insecure' };

export type HttpAppOptions = {
  auth: HttpAuth;
  env?: NodeJS.ProcessEnv;
  /** The built landing and policy pages (`pnpm build:web`). Default: `dist/web` in the working directory. */
  webRoot?: string;
  /** The built documentation site (`pnpm --dir site build`). Default: `docs-site/`, a sibling of `dist/`. */
  docsRoot?: string;
  /** What `/health` reports as running; server.ts reads it from the platform environment at startup. Omitted: this version with no commit. */
  buildInfo?: BuildInfo;
};

/** Pages of the browser app (web/src/main.tsx), served as index.html. */
const PORTAL_ROUTES = ['/'];
/** Pages with their own prerendered file in dist/web (web/vite.config.ts), so their text needs no script. */
const PRERENDERED_ROUTES: Record<string, string> = {
  '/privacy-policy': 'privacy-policy.html',
  '/terms': 'terms.html',
};
const PORTAL_CSP =
  "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'";
const PAGE_CSP = "default-src 'none'; frame-ancestors 'none'; base-uri 'none'";
const DEFAULT_REQUESTS_PER_SECOND = 5;
const DEFAULT_REQUEST_BURST = 20;
/** Largest `/mcp` request body accepted. Tool arguments are small; this leaves room for any of them. */
const MAX_REQUEST_BODY_BYTES = 1024 * 1024;
/** Cap on error text sent to the log: handler failures quote fragments of the caller's headers and body. */
const MAX_LOGGED_ERROR_CHARS = 300;

/** A top-level page load in a browser (not fetch, not an API client). */
function isNavigation(req: Request): boolean {
  if (req.method !== 'GET' && req.method !== 'HEAD') return false;
  const mode = req.get('sec-fetch-mode');
  if (mode) return mode === 'navigate';
  return req.accepts(['json', 'html']) === 'html';
}

const ERROR_PAGE = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Something went wrong · Capture MCP</title></head>
<body><main><h1>Something went wrong</h1><p>This page could not be served. Go back to the <a href="/">home page</a> and try again.</p></main></body>
</html>
`;

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
    // OAuth metadata tells remote clients where to authorize; without a configured public URL it
    // would advertise http://localhost, which no remote client can reach.
    if (!(env.MCP_PUBLIC_BASE_URL || env.PUBLIC_URL)?.trim()) {
      throw new Error('MCP_REQUIRE_OAUTH=true needs MCP_PUBLIC_BASE_URL (the https origin clients use, e.g. https://capture.example.com).');
    }
    return {
      mode: 'oauth',
      publicBaseUrl: getOAuthPublicBaseUrl(port, env),
      tokenSecret,
      previousTokenSecrets: env.OAUTH_TOKEN_SECRET_PREVIOUS?.split(',').map(secret => secret.trim()).filter(Boolean),
      clientIpHeader: parseHeaderName(env.MCP_CLIENT_IP_HEADER),
      requestsPerSecond: parsePositiveInt('MCP_IP_RPS', env.MCP_IP_RPS),
      requestBurst: parsePositiveInt('MCP_IP_BURST', env.MCP_IP_BURST),
      accessTokenTtlSeconds: parsePositiveInt('OAUTH_ACCESS_TOKEN_TTL_SECONDS', env.OAUTH_ACCESS_TOKEN_TTL_SECONDS),
      refreshTokenTtlSeconds: parsePositiveInt('OAUTH_REFRESH_TOKEN_TTL_SECONDS', env.OAUTH_REFRESH_TOKEN_TTL_SECONDS),
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

/** Unset or empty is "use the default"; anything else must be a whole number above zero, or startup fails. */
function parsePositiveInt(name: string, value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === '') return undefined;
  if (!/^\d+$/.test(value.trim()) || Number(value) < 1) {
    throw new Error(`${name} must be a whole number above zero, not "${value}".`);
  }
  return Number(value);
}

function parseHeaderName(value: string | undefined): string | undefined {
  const name = value?.trim().toLowerCase();
  if (!name) return undefined;
  if (!/^[a-z0-9-]+$/.test(name)) {
    throw new Error(`MCP_CLIENT_IP_HEADER must be a header name such as x-real-ip, not "${value}".`);
  }
  return name;
}

const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', 'localhost']);

/**
 * The address to listen on. Unauthenticated (single-user) HTTP serves the operator's own keys,
 * so it may only listen on loopback; a non-loopback HOST is a startup error, not an override.
 */
export function listenHost(auth: HttpAuth, env: NodeJS.ProcessEnv): string | undefined {
  if (auth.mode === 'insecure') {
    const host = env.HOST || '127.0.0.1';
    if (!LOOPBACK_HOSTS.has(host)) {
      throw new Error(
        `MCP_ALLOW_INSECURE_HTTP serves this process's API keys without authentication, so it binds loopback only (HOST=${host} refused). Use MCP_REQUIRE_OAUTH=true to serve other hosts.`,
      );
    }
    return host;
  }
  // undefined lets Node pick its default (dual-stack `::`, falling back to IPv4), as before; a
  // hard-coded '0.0.0.0' would drop IPv6 clients such as Railway's private network.
  return env.HOST || undefined;
}

export function createHttpApp({ auth, env = process.env, webRoot, docsRoot, buildInfo = readBuildInfo({}) }: HttpAppOptions): express.Express {
  const app = express();

  if (auth.mode === 'insecure') {
    // Unauthenticated and serving the operator's keys: refuse requests whose Host header is not
    // loopback, so a DNS-rebinding page in the user's browser cannot reach it.
    app.use((req: Request, res: Response, next: express.NextFunction) => {
      const hostname = (req.headers.host ?? '').replace(/:\d+$/, '').replace(/^\[|\]$/g, '');
      if (!LOOPBACK_HOSTS.has(hostname)) {
        res.status(403).json({ jsonrpc: '2.0', error: { code: -32000, message: 'Forbidden host' }, id: null });
        return;
      }
      next();
    });
  }

  app.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'healthy', transport: 'http', authMode: auth.mode, ...buildInfo });
  });

  // The landing page, the policy pages and the documentation site are public and static. They
  // come before the OAuth and MCP routes and share nothing with them.
  const web = webRoot ?? resolve('dist/web');
  app.use('/assets', express.static(resolve(web, 'assets'), { immutable: true, maxAge: '1y', index: false }));
  const docs = docsHandler(docsRoot ?? fileURLToPath(new URL('../docs-site/', import.meta.url)));
  if (docs) {
    app.use(
      DOCS_PATH,
      (req: Request, res: Response, next: express.NextFunction) => {
        const [path = '', query] = req.originalUrl.split('?');
        if (path !== DOCS_PATH) return docs(req, res, next);
        if (req.method !== 'GET' && req.method !== 'HEAD') return next();
        // `/docs` without the slash would serve the index at the wrong base.
        res.redirect(301, `${DOCS_PATH}/${query === undefined ? '' : `?${query}`}`);
      },
      // A docs file that cannot be read is a server error with no file headers (see docs.ts).
      (error: unknown, req: Request, res: Response, next: express.NextFunction) => {
        if (res.headersSent) return next(error);
        console.error('docs_request_failed');
        res.status(500);
        if (isNavigation(req)) res.set('Content-Security-Policy', PAGE_CSP).type('html').send(ERROR_PAGE);
        else res.json({ error: 'server_error' });
      },
    );
  }
  const pages = new Map<string, Promise<string>>();
  const sendPage = async (res: Response, status = 200, file = 'index.html') => {
    // Outside production, reread so `pnpm dev:web` rebuilds (new asset hashes) show up.
    if (env.NODE_ENV !== 'production') pages.delete(file);
    let page = pages.get(file);
    if (!page) pages.set(file, (page = readFile(resolve(web, file), 'utf8')));
    const html = await page.catch(() => undefined);
    if (!html) {
      pages.delete(file);
      res.status(503).type('text').send('The web pages are not built. Run pnpm build.');
      return;
    }
    res.status(status).set('Content-Security-Policy', PORTAL_CSP).type('html').send(html);
  };
  app.get(Object.keys(PRERENDERED_ROUTES), async (req, res) => {
    await sendPage(res, 200, PRERENDERED_ROUTES[req.path.toLowerCase().replace(/(?<=.)\/$/, '')]);
  });
  app.get(PORTAL_ROUTES, async (_req, res) => {
    await sendPage(res);
  });

  let gate: express.RequestHandler[] = [];
  if (auth.mode === 'oauth') {
    const mcpResourceUrl = new URL('/mcp', auth.publicBaseUrl);
    // One definition of "the client" for the /mcp budget and the OAuth endpoint limiters:
    // the configured header or the peer, with IPv6 counted per /64 and IPv4-mapped IPv6 as IPv4.
    const clientKey = (req: Request) => bucketKey(clientIp(req, auth.clientIpHeader));
    // The limiters' own checks assume `trust proxy`, which this app does not use.
    const perClient = { keyGenerator: clientKey, validate: { xForwardedForHeader: false } };
    const provider = new McpOAuthProvider({
      baseUrl: auth.publicBaseUrl,
      tokenSecret: auth.tokenSecret,
      previousTokenSecrets: auth.previousTokenSecrets,
      accessTokenTtlSeconds: auth.accessTokenTtlSeconds,
      refreshTokenTtlSeconds: auth.refreshTokenTtlSeconds,
    });

    // The credential page holds a request id in its URL and takes API keys: lock down what it may
    // load and keep it out of caches.
    const sendAuthorizationPage = (res: Response, status: number, html: string) => {
      res.status(status).set({ 'Content-Security-Policy': AUTHORIZATION_PAGE_CSP, 'Cache-Control': 'no-store' }).type('html').send(html);
    };

    app.get('/oauth/authorize', (req: Request, res: Response) => {
      const requestId = typeof req.query.request_id === 'string' ? req.query.request_id : '';
      sendAuthorizationPage(
        res,
        requestId ? 200 : 400,
        renderAuthorizationPage(requestId, { error: requestId ? undefined : 'Authorization request is missing.' }),
      );
    });

    app.post('/oauth/authorize', ...bodyParsers, async (req: Request, res: Response) => {
      // `req.body` is undefined when the request carried no form body.
      const form: Record<string, unknown> = req.body ?? {};
      const requestId = typeof form.request_id === 'string' ? form.request_id : '';
      const { keys, checked, fieldErrors } = parseAuthorizeForm(form);
      try {
        res.redirect(302, await provider.completeAuthorization(requestId, keys));
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Authorization failed';
        sendAuthorizationPage(res, 400, renderAuthorizationPage(requestId, { error: message, checked, fieldErrors }));
      }
    });

    app.use(
      oauthRouter({
        provider,
        issuerUrl: auth.publicBaseUrl,
        baseUrl: auth.publicBaseUrl,
        resourceServerUrl: mcpResourceUrl,
        scopesSupported: [...SUPPORTED_SCOPES],
        rateLimit: perClient,
        resourceName: 'GovCon Capture',
      }),
    );

    // Every tool call needs a verified bearer token holding the tools scope. Provider-key headers
    // are never a substitute: they say which upstream key to use, not who the caller is. The
    // budget comes first, so a flood of bad tokens is refused before any is opened.
    const budget = new RequestBudget(
      auth.requestsPerSecond ?? DEFAULT_REQUESTS_PER_SECOND,
      auth.requestBurst ?? DEFAULT_REQUEST_BURST,
    );
    const bearer = {
      verifier: provider,
      requiredScopes: [DEFAULT_CLIENT_SCOPE],
      resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(mcpResourceUrl),
    };
    gate = [
      (req, res, next) => {
        const retryAfter = budget.spend(clientKey(req));
        if (retryAfter === 0) return next();
        res
          .status(429)
          .set('Retry-After', String(retryAfter))
          .json({ jsonrpc: '2.0', error: { code: -32029, message: 'Too many requests. Slow down and retry.' }, id: null });
      },
      async (req, res, next) => {
        try {
          (req as AuthedRequest).auth = await verifyBearerToken(req.headers.authorization, bearer);
          next();
        } catch (error) {
          await relay(res, bearerAuthChallengeResponse(error, bearer));
        }
      },
    ];
  }

  // Stateless: the factory runs once per request, so the keys a tool uses are those of this request's
  // own bearer token and headers, and no state outlives the request. Clients that predate the
  // 2026-07-28 revision are served the same way (`legacy: 'stateless'`). The handler reads the body
  // itself, with a size cap; the body parsers above do not run for it.
  const mcp = createMcpHandler(ctx => buildMcpServer(resolveRequestKeys(keySource(ctx, auth, env))), {
    legacy: 'stateless',
    maxRequestBodySize: MAX_REQUEST_BODY_BYTES,
    // The SDK routes `subscriptions/listen` whatever the capabilities say, and each one holds a
    // stream open. This server has nothing to subscribe to: refuse them all.
    maxSubscriptions: 0,
    onerror: error => console.error('mcp_handler_error:', truncate(error.message)),
  });
  const serveMcp = toNodeHandler(mcp, {
    maxRequestBodySize: MAX_REQUEST_BODY_BYTES,
    onerror: error => console.error('mcp_adapter_error:', truncate(error.message)),
  });
  app.post('/mcp', ...gate, (req: Request, res: Response) => {
    // Over HTTP a client cancels a call by dropping the connection, on every protocol revision, and
    // a stateless server has no other way to hear of it: stop what the request is waiting on.
    const dropped = new AbortController();
    res.on('close', () => {
      if (!res.writableFinished) dropped.abort();
    });
    return withRequestSignal(dropped.signal, () => serveMcp(req, res));
  });

  app.all('/mcp', (_req: Request, res: Response) => {
    res.status(405).json({
      jsonrpc: '2.0',
      error: { code: -32601, message: 'Method not allowed. Use POST for MCP requests.' },
      id: null,
    });
  });

  // Unknown paths: a person in a browser gets the not-found page (status 404); API clients get
  // the short text Express always sent.
  app.use(async (req: Request, res: Response, next: express.NextFunction) => {
    if (isNavigation(req)) return sendPage(res, 404);
    next();
  });
  // A browser that hits an unhandled error gets a page; everything else keeps Express's answer.
  app.use((error: unknown, req: Request, res: Response, next: express.NextFunction) => {
    if (res.headersSent || !isNavigation(req)) return next(error);
    console.error('request_failed');
    res.status(500).set('Content-Security-Policy', PAGE_CSP).type('html').send(ERROR_PAGE);
  });

  return app;
}

type AuthedRequest = Request & { auth?: AuthInfo };

/** Where this request's provider keys may come from: its own token and headers, or the operator's environment in single-user mode. */
function keySource(ctx: McpRequestContext, auth: HttpAuth, env: NodeJS.ProcessEnv): KeySource {
  const headers = headerKeys(name => ctx.requestInfo?.headers.get(name) ?? undefined);
  return auth.mode === 'oauth' ? { kind: 'caller', sealed: getProviderKeysFromAuth(ctx.authInfo), headers } : { kind: 'operator', headers, env };
}

function truncate(message: string): string {
  return message.length > MAX_LOGGED_ERROR_CHARS ? `${message.slice(0, MAX_LOGGED_ERROR_CHARS)}...[truncated]` : message;
}

/** Writes a web-standard Response (the SDK's bearer challenge) to the Express response. */
async function relay(res: Response, response: globalThis.Response): Promise<void> {
  res.status(response.status);
  response.headers.forEach((value, name) => res.setHeader(name, value));
  res.send(await response.text());
}

function parseAuthorizeForm(body: Record<string, unknown> | undefined): {
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
