import { createHash, timingSafeEqual } from 'node:crypto';
import cors from 'cors';
import express, { type NextFunction, type Request, type RequestHandler, type Response, type Router } from 'express';
import { rateLimit, type Options as RateLimitOptions } from 'express-rate-limit';
import {
  buildOAuthProtectedResourceMetadata,
  type OAuthClientInformationFull,
  OAuthErrorCode,
  type OAuthMetadata,
  type OAuthTokenRevocationRequest,
  type OAuthTokens,
  type OAuthTokenVerifier,
} from '@modelcontextprotocol/server';
import * as z from 'zod';

import {
  invalidClient,
  invalidClientMetadata,
  invalidGrant,
  invalidRequest,
  methodNotAllowed,
  OAuthError,
  serverError,
  tooManyRequests,
  unsupportedGrantType,
} from './oauth-errors.js';

// The OAuth 2.1 authorization server endpoints (RFC 6749, 7009, 7591, 8414, 9728, PKCE S256) that
// MCP clients use to obtain a bearer token. The MCP SDK removed its server-side OAuth helpers in v2,
// so they live here, with the same behaviour as the v1 SDK's: the same paths, windows, bodies and
// status codes. What differs is stated where it does.

// ---- What the endpoints need from an authorization server --------------------------------------

export type AuthorizationParams = {
  state?: string;
  scopes?: string[];
  codeChallenge: string;
  redirectUri: string;
  resource?: URL;
};

export interface OAuthRegisteredClientsStore {
  getClient(clientId: string): OAuthClientInformationFull | undefined | Promise<OAuthClientInformationFull | undefined>;
  registerClient(
    client: Omit<OAuthClientInformationFull, 'client_id' | 'client_id_issued_at'>,
  ): OAuthClientInformationFull | Promise<OAuthClientInformationFull>;
}

export interface OAuthServerProvider extends OAuthTokenVerifier {
  readonly clientsStore: OAuthRegisteredClientsStore;
  /** Starts authorization: validates the request and redirects the user agent (here, to the credential page). */
  authorize(client: OAuthClientInformationFull, params: AuthorizationParams, res: Response): Promise<void>;
  /** The PKCE challenge the code was issued for. */
  challengeForAuthorizationCode(client: OAuthClientInformationFull, authorizationCode: string): Promise<string>;
  exchangeAuthorizationCode(
    client: OAuthClientInformationFull,
    authorizationCode: string,
    codeVerifier?: string,
    redirectUri?: string,
    resource?: URL,
  ): Promise<OAuthTokens>;
  exchangeRefreshToken(client: OAuthClientInformationFull, refreshToken: string, scopes?: string[], resource?: URL): Promise<OAuthTokens>;
  revokeToken(client: OAuthClientInformationFull, request: OAuthTokenRevocationRequest): Promise<void>;
}

export type OAuthRouterOptions = {
  provider: OAuthServerProvider;
  /** The authorization server's issuer identifier; its endpoints are served from `baseUrl`. */
  issuerUrl: URL;
  baseUrl: URL;
  /** The protected resource (`/mcp`) these tokens are for. */
  resourceServerUrl: URL;
  scopesSupported: string[];
  resourceName: string;
  /** Options every endpoint's rate limiter shares: how to tell clients apart. */
  rateLimit: Partial<RateLimitOptions>;
};

// ---- Router ------------------------------------------------------------------------------------

/** Mounts `/authorize`, `/token`, `/register`, `/revoke` and the two `/.well-known` metadata documents. */
export function oauthRouter(options: OAuthRouterOptions): Router {
  const metadata = authorizationServerMetadata(options);
  const resourceMetadata = buildOAuthProtectedResourceMetadata({
    oauthMetadata: metadata,
    resourceServerUrl: options.resourceServerUrl,
    scopesSupported: options.scopesSupported,
    resourceName: options.resourceName,
  });
  const resourcePath = options.resourceServerUrl.pathname;

  const router = express.Router();
  router.use('/authorize', authorizationEndpoint(options));
  router.use('/token', tokenEndpoint(options));
  router.use(`/.well-known/oauth-protected-resource${resourcePath === '/' ? '' : resourcePath}`, metadataEndpoint(resourceMetadata));
  router.use('/.well-known/oauth-authorization-server', metadataEndpoint(metadata));
  router.use('/register', registrationEndpoint(options));
  router.use('/revoke', revocationEndpoint(options));
  return router;
}

/** RFC 8414 metadata. The issuer must be https (RFC 8414 section 2), except on loopback for local development. */
export function authorizationServerMetadata({ issuerUrl, baseUrl, scopesSupported }: Pick<OAuthRouterOptions, 'issuerUrl' | 'baseUrl' | 'scopesSupported'>): OAuthMetadata {
  const loopback = issuerUrl.hostname === 'localhost' || issuerUrl.hostname === '127.0.0.1';
  if (issuerUrl.protocol !== 'https:' && !loopback) throw new Error('Issuer URL must be HTTPS');
  if (issuerUrl.hash) throw new Error(`Issuer URL must not have a fragment: ${issuerUrl}`);
  if (issuerUrl.search) throw new Error(`Issuer URL must not have a query string: ${issuerUrl}`);

  const endpoint = (path: string) => new URL(path, baseUrl).href;
  return {
    issuer: issuerUrl.href,
    authorization_endpoint: endpoint('/authorize'),
    response_types_supported: ['code'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint: endpoint('/token'),
    token_endpoint_auth_methods_supported: ['client_secret_post', 'none'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    scopes_supported: scopesSupported,
    revocation_endpoint: endpoint('/revoke'),
    revocation_endpoint_auth_methods_supported: ['client_secret_post'],
    registration_endpoint: endpoint('/register'),
  };
}

// ---- Shared pieces -----------------------------------------------------------------------------

const MINUTES = 60 * 1000;

/** Per-client request limits, as the v1 SDK set them. `shared` says how clients are told apart. */
function limiter(windowMs: number, limit: number, what: string, shared: Partial<RateLimitOptions>): RequestHandler {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: true,
    legacyHeaders: false,
    message: tooManyRequests(`You have exceeded the rate limit for ${what}`).toResponseObject(),
    ...shared,
  });
}

function allowedMethods(methods: string[]): RequestHandler {
  return (req, res, next) => {
    if (methods.includes(req.method)) return next();
    res
      .status(405)
      .set('Allow', methods.join(', '))
      .json(methodNotAllowed(`The method ${req.method} is not allowed for this endpoint`).toResponseObject());
  };
}

/** An OAuth error answers 400 with its body; anything else is a 500 that says nothing about the cause. */
function sendError(res: Response, error: unknown): void {
  const reported = error instanceof OAuthError && error.code !== OAuthErrorCode.ServerError ? error : serverError('Internal Server Error');
  res.status(reported.code === OAuthErrorCode.ServerError ? 500 : 400).json(reported.toResponseObject());
}

/** The first problem zod found, as the `error_description` of an `invalid_request`. */
function parse<T>(schema: z.ZodType<T>, input: unknown, error = invalidRequest): T {
  const result = schema.safeParse(input);
  if (!result.success) throw error(result.error.message);
  return result.data;
}

const sha256 = (value: string) => createHash('sha256').update(value).digest();
/** Constant-time comparison of two secrets of any length. */
const sameSecret = (a: string, b: string) => timingSafeEqual(sha256(a), sha256(b));

/** PKCE S256: the verifier hashes to the challenge sent at authorization (RFC 7636). */
function verifierMatches(verifier: string, challenge: string): boolean {
  return sameSecret(createHash('sha256').update(verifier).digest('base64url'), challenge);
}

type ClientRequest = Request & { client?: OAuthClientInformationFull };

/** Client authentication for `/token` and `/revoke`: `client_id` and, for a confidential client, `client_secret_post`. */
function authenticateClient(store: OAuthRegisteredClientsStore): RequestHandler {
  const schema = z.object({ client_id: z.string(), client_secret: z.string().optional() });
  return async (req: ClientRequest, res: Response, next: NextFunction) => {
    try {
      const { client_id, client_secret } = parse(schema, req.body);
      const client = await store.getClient(client_id);
      if (!client) throw invalidClient('Invalid client_id');
      if (client.client_secret) {
        if (!client_secret) throw invalidClient('Client secret is required');
        if (!sameSecret(client.client_secret, client_secret)) throw invalidClient('Invalid client_secret');
        if (client.client_secret_expires_at && client.client_secret_expires_at < Math.floor(Date.now() / 1000)) {
          throw invalidClient('Client secret has expired');
        }
      }
      req.client = client;
      next();
    } catch (error) {
      sendError(res, error);
    }
  };
}

function metadataEndpoint(document: object): Router {
  const router = express.Router();
  router.use(cors(), allowedMethods(['GET', 'OPTIONS']));
  router.get('/', (_req, res) => {
    res.status(200).json(document);
  });
  return router;
}

// ---- /authorize --------------------------------------------------------------------------------

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/** Exact match, except that a loopback redirect may use any port (RFC 8252 section 7.3). */
export function redirectUriMatches(requested: string, registered: string): boolean {
  if (requested === registered) return true;
  if (!URL.canParse(requested) || !URL.canParse(registered)) return false;
  const [asked, known] = [new URL(requested), new URL(registered)];
  if (!LOOPBACK_HOSTS.has(asked.hostname) || !LOOPBACK_HOSTS.has(known.hostname)) return false;
  return asked.protocol === known.protocol && asked.hostname === known.hostname && asked.pathname === known.pathname && asked.search === known.search;
}

const ClientParams = z.object({
  client_id: z.string(),
  redirect_uri: z.string().optional().refine(value => value === undefined || URL.canParse(value), { message: 'redirect_uri must be a valid URL' }),
});

const RequestParams = z.object({
  response_type: z.literal('code'),
  code_challenge: z.string(),
  code_challenge_method: z.literal('S256'),
  scope: z.string().optional(),
  state: z.string().optional(),
  resource: z.url().optional(),
});

function authorizationEndpoint({ provider, rateLimit: shared }: OAuthRouterOptions): Router {
  const router = express.Router();
  router.use(allowedMethods(['GET', 'POST']), express.urlencoded({ extended: false }), limiter(15 * MINUTES, 100, 'authorization requests', shared));

  router.all('/', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const input: unknown = req.method === 'POST' ? req.body : req.query;

    // Until the client and its redirect URI are known good, errors are shown here, not redirected:
    // an unverified redirect URI must not receive anything.
    let client: OAuthClientInformationFull | undefined;
    let redirectUri: string;
    try {
      const params = parse(ClientParams, input);
      client = await provider.clientsStore.getClient(params.client_id);
      if (!client) throw invalidClient('Invalid client_id');
      const requested = params.redirect_uri;
      if (requested !== undefined) {
        if (!client.redirect_uris.some(registered => redirectUriMatches(requested, registered))) throw invalidRequest('Unregistered redirect_uri');
        redirectUri = requested;
      } else if (client.redirect_uris.length === 1) {
        redirectUri = client.redirect_uris[0]!;
      } else {
        throw invalidRequest('redirect_uri must be specified when client has multiple registered URIs');
      }
    } catch (error) {
      sendError(res, error);
      return;
    }

    // After that, errors go back to the client through its redirect URI.
    let state: string | undefined;
    try {
      const params = parse(RequestParams, input);
      state = params.state;
      await provider.authorize(
        client,
        {
          state,
          scopes: params.scope === undefined ? [] : params.scope.split(' '),
          redirectUri,
          codeChallenge: params.code_challenge,
          resource: params.resource ? new URL(params.resource) : undefined,
        },
        res,
      );
    } catch (error) {
      const reported = error instanceof OAuthError ? error : serverError('Internal Server Error');
      const target = new URL(redirectUri);
      target.searchParams.set('error', reported.code);
      target.searchParams.set('error_description', reported.message);
      if (reported.errorUri) target.searchParams.set('error_uri', reported.errorUri);
      if (state) target.searchParams.set('state', state);
      res.redirect(302, target.href);
    }
  });
  return router;
}

// ---- /token ------------------------------------------------------------------------------------

const GrantType = z.object({ grant_type: z.string() });
const CodeGrant = z.object({
  code: z.string(),
  code_verifier: z.string(),
  redirect_uri: z.string().optional(),
  resource: z.url().optional(),
});
const RefreshGrant = z.object({ refresh_token: z.string(), scope: z.string().optional(), resource: z.url().optional() });

function tokenEndpoint({ provider, rateLimit: shared }: OAuthRouterOptions): Router {
  const router = express.Router();
  router.use(
    cors(),
    allowedMethods(['POST']),
    express.urlencoded({ extended: false }),
    limiter(15 * MINUTES, 50, 'token requests', shared),
    authenticateClient(provider.clientsStore),
  );

  router.post('/', async (req: ClientRequest, res) => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      const { grant_type } = parse(GrantType, req.body);
      const client = req.client;
      if (!client) throw serverError('Internal Server Error');

      switch (grant_type) {
        case 'authorization_code': {
          const { code, code_verifier, redirect_uri, resource } = parse(CodeGrant, req.body);
          const challenge = await provider.challengeForAuthorizationCode(client, code);
          if (!verifierMatches(code_verifier, challenge)) throw invalidGrant('code_verifier does not match the challenge');
          res.status(200).json(await provider.exchangeAuthorizationCode(client, code, undefined, redirect_uri, resource ? new URL(resource) : undefined));
          return;
        }
        case 'refresh_token': {
          const { refresh_token, scope, resource } = parse(RefreshGrant, req.body);
          res.status(200).json(await provider.exchangeRefreshToken(client, refresh_token, scope?.split(' '), resource ? new URL(resource) : undefined));
          return;
        }
        default:
          throw unsupportedGrantType('The grant type is not supported by this authorization server.');
      }
    } catch (error) {
      sendError(res, error);
    }
  });
  return router;
}

// ---- /register (RFC 7591) ----------------------------------------------------------------------

/** Redirect and metadata URLs must not run script in the user's browser. */
// eslint-disable-next-line no-script-url -- the schemes to refuse are named here
const UNSAFE_SCHEMES = new Set(['javascript:', 'data:', 'vbscript:']);
const SafeUrl = z.url().refine(value => !UNSAFE_SCHEMES.has(new URL(value).protocol), {
  message: 'URL cannot use javascript:, data:, or vbscript: scheme',
});

const ClientMetadata = z.object({
    redirect_uris: z.array(SafeUrl),
    token_endpoint_auth_method: z.string().optional(),
    grant_types: z.array(z.string()).optional(),
    response_types: z.array(z.string()).optional(),
    application_type: z.string().optional(),
    client_name: z.string().optional(),
    client_uri: SafeUrl.optional(),
    logo_uri: SafeUrl.optional().or(z.literal('')),
    scope: z.string().optional(),
    contacts: z.array(z.string()).optional(),
    tos_uri: SafeUrl.optional().or(z.literal('')),
    policy_uri: z.string().optional(),
    jwks_uri: SafeUrl.optional(),
    jwks: z.any().optional(),
    software_id: z.string().optional(),
    software_version: z.string().optional(),
    software_statement: z.string().optional(),
  });

function registrationEndpoint({ provider, rateLimit: shared }: OAuthRouterOptions): Router {
  const router = express.Router();
  router.use(cors(), allowedMethods(['POST']), express.json(), limiter(60 * MINUTES, 20, 'client registration requests', shared));

  router.post('/', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      const metadata = parse(ClientMetadata, req.body, invalidClientMetadata);
      // The store issues the client id and, for a confidential client, its secret and expiry.
      const registered = await provider.clientsStore.registerClient(metadata);
      res.status(201).json(registered);
    } catch (error) {
      sendError(res, error);
    }
  });
  return router;
}

// ---- /revoke (RFC 7009) ------------------------------------------------------------------------

const Revocation = z.object({ token: z.string(), token_type_hint: z.string().optional() });

function revocationEndpoint({ provider, rateLimit: shared }: OAuthRouterOptions): Router {
  const router = express.Router();
  router.use(
    cors(),
    allowedMethods(['POST']),
    express.urlencoded({ extended: false }),
    limiter(15 * MINUTES, 50, 'token revocation requests', shared),
    authenticateClient(provider.clientsStore),
  );

  router.post('/', async (req: ClientRequest, res) => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      const request = parse(Revocation, req.body);
      if (!req.client) throw serverError('Internal Server Error');
      await provider.revokeToken(req.client, request);
      res.status(200).json({});
    } catch (error) {
      sendError(res, error);
    }
  });
  return router;
}
