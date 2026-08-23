import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import express, { Router, type Request, type Response } from 'express';
import {
  OAuthError,
  OAuthErrorCode,
  type OAuthClientInformationFull,
  type OAuthMetadata,
} from '@modelcontextprotocol/server';
import { mcpAuthMetadataRouter } from '@modelcontextprotocol/express';
import { DEFAULT_CLIENT_SCOPE, McpOAuthProvider, type AuthorizationParams } from './mcp-oauth.js';

// OAuth 2.1 authorization-server endpoints over McpOAuthProvider. SDK v1
// shipped these as mcpAuthRouter; v2 only ships resource-server helpers, so
// the endpoint layer is ours. Paths match v1's defaults (/authorize, /token,
// /register, /revoke) so clients that discovered the old metadata keep
// working. 2026-07-28 hardening handled here: PKCE S256 is mandatory, the
// authorization response carries `iss` (RFC 9207, emitted by the provider),
// and Dynamic Client Registration stores `application_type`.

export type OAuthEndpointOptions = {
  provider: McpOAuthProvider;
  baseUrl: URL;
  mcpResourceUrl: URL;
  resourceName?: string;
};

export function buildOAuthMetadata(baseUrl: URL): OAuthMetadata {
  const issuer = trimTrailingSlash(baseUrl.href);
  return {
    issuer,
    authorization_endpoint: `${issuer}/authorize`,
    token_endpoint: `${issuer}/token`,
    registration_endpoint: `${issuer}/register`,
    revocation_endpoint: `${issuer}/revoke`,
    scopes_supported: [DEFAULT_CLIENT_SCOPE],
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    token_endpoint_auth_methods_supported: ['none', 'client_secret_post', 'client_secret_basic'],
    code_challenge_methods_supported: ['S256'],
    authorization_response_iss_parameter_supported: true,
  } as OAuthMetadata;
}

export function oauthEndpointsRouter(options: OAuthEndpointOptions): Router {
  const { provider, baseUrl, mcpResourceUrl, resourceName } = options;
  const router = Router();
  const form = express.urlencoded({ extended: false });
  const json = express.json();
  const oauthMetadata = buildOAuthMetadata(baseUrl);

  router.use(mcpAuthMetadataRouter({
    oauthMetadata,
    resourceServerUrl: mcpResourceUrl,
    scopesSupported: [DEFAULT_CLIENT_SCOPE],
    resourceName,
  }));

  router.get('/authorize', async (req: Request, res: Response) => {
    const q = req.query;
    const clientId = str(q.client_id);
    if (!clientId) {
      return sendError(res, 400, OAuthErrorCode.InvalidRequest, 'client_id is required');
    }
    const client = provider.clientsStore.getClient(clientId);
    if (!client) {
      return sendError(res, 400, OAuthErrorCode.InvalidClient, 'Unknown client_id');
    }

    // The redirect_uri must be validated against the registration before any
    // error is delivered by redirect (RFC 6749 §3.1.2.4).
    let redirectUri = str(q.redirect_uri);
    if (!redirectUri) {
      if (client.redirect_uris.length !== 1) {
        return sendError(res, 400, OAuthErrorCode.InvalidRequest, 'redirect_uri is required');
      }
      redirectUri = client.redirect_uris[0];
    } else if (!client.redirect_uris.includes(redirectUri)) {
      return sendError(res, 400, OAuthErrorCode.InvalidRequest, 'Unregistered redirect_uri');
    }

    const state = str(q.state);
    const redirectError = (code: OAuthErrorCode, description: string) => {
      const target = new URL(redirectUri!);
      target.searchParams.set('error', code);
      target.searchParams.set('error_description', description);
      if (state !== undefined) target.searchParams.set('state', state);
      target.searchParams.set('iss', provider.issuer);
      res.redirect(302, target.href);
    };

    if (str(q.response_type) !== 'code') {
      return redirectError(OAuthErrorCode.UnsupportedResponseType, 'Only response_type=code is supported');
    }
    const codeChallenge = str(q.code_challenge);
    if (!codeChallenge) {
      return redirectError(OAuthErrorCode.InvalidRequest, 'code_challenge is required (PKCE)');
    }
    if (str(q.code_challenge_method) !== 'S256') {
      return redirectError(OAuthErrorCode.InvalidRequest, 'code_challenge_method must be S256');
    }

    const registeredScopes = (client.scope ?? DEFAULT_CLIENT_SCOPE).split(' ').filter(Boolean);
    const requestedScope = str(q.scope);
    const scopes = requestedScope === undefined
      ? registeredScopes
      : requestedScope.split(' ').filter(Boolean);
    const unknownScope = scopes.find(scope => !registeredScopes.includes(scope));
    if (unknownScope) {
      return redirectError(OAuthErrorCode.InvalidScope, `Client was not registered with scope ${unknownScope}`);
    }

    let resource: URL | undefined;
    const rawResource = str(q.resource);
    if (rawResource !== undefined) {
      try {
        resource = new URL(rawResource);
      } catch {
        return redirectError(OAuthErrorCode.InvalidRequest, 'resource must be a valid URL');
      }
    }

    const params: AuthorizationParams = { redirectUri, codeChallenge, scopes, state, resource };
    try {
      await provider.authorize(client, params, res);
    } catch (error) {
      if (error instanceof OAuthError) {
        return redirectError(asErrorCode(error.code), error.message);
      }
      return redirectError(OAuthErrorCode.ServerError, 'Authorization failed');
    }
  });

  router.post('/token', form, async (req: Request, res: Response) => {
    let client: OAuthClientInformationFull;
    try {
      client = authenticateClient(provider, req);
    } catch (error) {
      return sendOAuthError(res, error);
    }

    const grantType = str(req.body?.grant_type);
    try {
      if (grantType === 'authorization_code') {
        const code = str(req.body?.code);
        const codeVerifier = str(req.body?.code_verifier);
        if (!code) {
          throw new OAuthError(OAuthErrorCode.InvalidRequest, 'code is required');
        }
        if (!codeVerifier) {
          throw new OAuthError(OAuthErrorCode.InvalidRequest, 'code_verifier is required (PKCE)');
        }

        const expectedChallenge = await provider.challengeForAuthorizationCode(client, code);
        const actualChallenge = createHash('sha256').update(codeVerifier).digest('base64url');
        if (!constantTimeEquals(expectedChallenge, actualChallenge)) {
          throw new OAuthError(OAuthErrorCode.InvalidGrant, 'code_verifier does not match the challenge');
        }

        const tokens = await provider.exchangeAuthorizationCode(
          client,
          code,
          codeVerifier,
          str(req.body?.redirect_uri),
          parseResource(req.body?.resource),
        );
        return sendTokens(res, tokens);
      }

      if (grantType === 'refresh_token') {
        const refreshToken = str(req.body?.refresh_token);
        if (!refreshToken) {
          throw new OAuthError(OAuthErrorCode.InvalidRequest, 'refresh_token is required');
        }
        const scope = str(req.body?.scope);
        const tokens = await provider.exchangeRefreshToken(
          client,
          refreshToken,
          scope === undefined ? undefined : scope.split(' ').filter(Boolean),
          parseResource(req.body?.resource),
        );
        return sendTokens(res, tokens);
      }

      throw new OAuthError(
        OAuthErrorCode.UnsupportedGrantType,
        'grant_type must be authorization_code or refresh_token',
      );
    } catch (error) {
      return sendOAuthError(res, error);
    }
  });

  router.post('/register', json, (req: Request, res: Response) => {
    const body = req.body;
    if (!body || typeof body !== 'object') {
      return sendError(res, 400, 'invalid_client_metadata', 'Request body must be a JSON object');
    }

    const redirectUris = body.redirect_uris;
    if (!Array.isArray(redirectUris) || redirectUris.length === 0 ||
        !redirectUris.every((uri: unknown) => typeof uri === 'string' && isValidUrl(uri))) {
      return sendError(res, 400, 'invalid_redirect_uri', 'redirect_uris must be a non-empty array of valid URIs');
    }

    const authMethod = typeof body.token_endpoint_auth_method === 'string'
      ? body.token_endpoint_auth_method
      : 'none';
    if (!['none', 'client_secret_post', 'client_secret_basic'].includes(authMethod)) {
      return sendError(res, 400, 'invalid_client_metadata', `Unsupported token_endpoint_auth_method: ${authMethod}`);
    }

    const applicationType = typeof body.application_type === 'string' ? body.application_type : 'web';
    if (!['web', 'native'].includes(applicationType)) {
      return sendError(res, 400, 'invalid_client_metadata', `Unsupported application_type: ${applicationType}`);
    }

    const nowSeconds = Math.floor(Date.now() / 1000);
    const registration: Record<string, unknown> = {
      ...body,
      redirect_uris: redirectUris,
      token_endpoint_auth_method: authMethod,
      // 2026-07-28 authorization hardening: application_type is part of the
      // stored registration, not silently dropped.
      application_type: applicationType,
      grant_types: Array.isArray(body.grant_types) && body.grant_types.length > 0
        ? body.grant_types
        : ['authorization_code', 'refresh_token'],
      response_types: Array.isArray(body.response_types) && body.response_types.length > 0
        ? body.response_types
        : ['code'],
    };
    if (authMethod !== 'none') {
      registration.client_secret = randomBytes(32).toString('base64url');
      registration.client_secret_expires_at = 0;
    }

    const client = provider.clientsStore.registerClient(
      registration as Omit<OAuthClientInformationFull, 'client_id' | 'client_id_issued_at'>,
    );
    res.status(201).json(client);
  });

  router.post('/revoke', form, async (req: Request, res: Response) => {
    try {
      const client = authenticateClient(provider, req);
      const token = str(req.body?.token);
      if (!token) {
        throw new OAuthError(OAuthErrorCode.InvalidRequest, 'token is required');
      }
      await provider.revokeToken(client, {
        token,
        token_type_hint: str(req.body?.token_type_hint),
      });
      res.status(200).json({});
    } catch (error) {
      return sendOAuthError(res, error);
    }
  });

  return router;
}

function authenticateClient(provider: McpOAuthProvider, req: Request): OAuthClientInformationFull {
  let clientId = str(req.body?.client_id);
  let clientSecret = str(req.body?.client_secret);

  const authHeader = req.get('authorization');
  if (authHeader?.toLowerCase().startsWith('basic ')) {
    const decoded = Buffer.from(authHeader.slice('basic '.length), 'base64').toString('utf8');
    const separator = decoded.indexOf(':');
    if (separator >= 0) {
      clientId = decodeURIComponent(decoded.slice(0, separator));
      clientSecret = decodeURIComponent(decoded.slice(separator + 1));
    }
  }

  if (!clientId) {
    throw new OAuthError(OAuthErrorCode.InvalidClient, 'client_id is required');
  }
  const client = provider.clientsStore.getClient(clientId);
  if (!client) {
    throw new OAuthError(OAuthErrorCode.InvalidClient, 'Unknown client_id');
  }

  const authMethod = client.token_endpoint_auth_method ?? 'none';
  if (authMethod !== 'none') {
    if (!clientSecret || !client.client_secret || !constantTimeEquals(client.client_secret, clientSecret)) {
      throw new OAuthError(OAuthErrorCode.InvalidClient, 'Invalid client credentials');
    }
  }
  return client;
}

function sendTokens(res: Response, tokens: unknown): void {
  res.set('Cache-Control', 'no-store').set('Pragma', 'no-cache').status(200).json(tokens);
}

function sendOAuthError(res: Response, error: unknown): void {
  if (error instanceof OAuthError) {
    const status = error.code === OAuthErrorCode.InvalidClient ? 401
      : error.code === OAuthErrorCode.ServerError ? 500
      : 400;
    return sendError(res, status, error.code, error.message);
  }
  return sendError(res, 500, OAuthErrorCode.ServerError, 'Internal server error');
}

function sendError(res: Response, status: number, code: string, description: string): void {
  res.status(status).json({ error: code, error_description: description });
}

function asErrorCode(code: OAuthErrorCode | string): OAuthErrorCode {
  return Object.values(OAuthErrorCode).includes(code as OAuthErrorCode)
    ? (code as OAuthErrorCode)
    : OAuthErrorCode.ServerError;
}

function constantTimeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

function parseResource(raw: unknown): URL | undefined {
  const value = typeof raw === 'string' ? raw : undefined;
  if (value === undefined) return undefined;
  try {
    return new URL(value);
  } catch {
    throw new OAuthError(OAuthErrorCode.InvalidRequest, 'resource must be a valid URL');
  }
}

function isValidUrl(value: string): boolean {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function trimTrailingSlash(href: string): string {
  return href.endsWith('/') ? href.slice(0, -1) : href;
}
