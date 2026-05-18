import test from 'node:test';
import assert from 'node:assert/strict';
import type { Response } from 'express';
import type { OAuthClientInformationFull } from '@modelcontextprotocol/sdk/shared/auth.js';
import type { AuthorizationParams } from '@modelcontextprotocol/sdk/server/auth/provider.js';
import {
  McpOAuthProvider,
  getProviderKeysFromAuth,
} from './mcp-oauth.js';

function makeClient(): OAuthClientInformationFull {
  return {
    client_id: 'claude-test-client',
    client_secret: 'client-secret',
    client_id_issued_at: 1,
    client_secret_expires_at: 0,
    client_name: 'Claude Test',
    redirect_uris: ['https://claude.ai/api/mcp/auth_callback'],
    token_endpoint_auth_method: 'client_secret_post',
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    scope: 'mcp:tools',
  };
}

function makeAuthorizationParams(): AuthorizationParams {
  return {
    state: 'state-123',
    scopes: ['mcp:tools'],
    codeChallenge: 'challenge-123',
    redirectUri: 'https://claude.ai/api/mcp/auth_callback',
    resource: new URL('https://capture.mcp.blencorp.com/mcp'),
  };
}

function makeRedirectCapture(): { response: Response; redirects: string[] } {
  const redirects: string[] = [];
  const response = {
    redirect(first: number | string, second?: string) {
      redirects.push(typeof first === 'number' ? String(second) : first);
      return this;
    },
  } as unknown as Response;

  return { response, redirects };
}

async function runFullFlow(
  provider: McpOAuthProvider,
  client: OAuthClientInformationFull,
  keys: Record<string, string>
) {
  const { response, redirects } = makeRedirectCapture();
  await provider.authorize(client, makeAuthorizationParams(), response);
  const requestId = new URL(redirects[0]).searchParams.get('request_id');
  assert.ok(requestId);

  const finalRedirect = await provider.completeAuthorization(requestId, keys);
  const code = new URL(finalRedirect).searchParams.get('code');
  assert.ok(code);

  return provider.exchangeAuthorizationCode(
    client,
    code,
    undefined,
    'https://claude.ai/api/mcp/auth_callback',
    new URL('https://capture.mcp.blencorp.com/mcp')
  );
}

test('OAuth flow issues a bearer token that carries all provider keys', async () => {
  const provider = new McpOAuthProvider({
    baseUrl: new URL('https://capture.mcp.blencorp.com'),
    tokenSecret: 'test-secret',
    accessTokenTtlSeconds: 3600,
    refreshTokenTtlSeconds: 7200,
  });
  const client = makeClient();
  await provider.clientsStore.registerClient?.(client);

  const { response, redirects } = makeRedirectCapture();
  await provider.authorize(client, makeAuthorizationParams(), response);

  assert.equal(redirects.length, 1);
  const credentialPageUrl = new URL(redirects[0]);
  assert.equal(credentialPageUrl.pathname, '/oauth/authorize');
  const requestId = credentialPageUrl.searchParams.get('request_id');
  assert.ok(requestId);

  const finalRedirect = await provider.completeAuthorization(requestId, {
    sam: 'sam_user_key',
    tango: 'tango_user_key',
    highergov: 'hg_user_key',
  });
  const callbackUrl = new URL(finalRedirect);
  assert.equal(callbackUrl.origin + callbackUrl.pathname, 'https://claude.ai/api/mcp/auth_callback');
  assert.equal(callbackUrl.searchParams.get('state'), 'state-123');
  const code = callbackUrl.searchParams.get('code');
  assert.ok(code);

  const tokens = await provider.exchangeAuthorizationCode(
    client,
    code,
    undefined,
    'https://claude.ai/api/mcp/auth_callback',
    new URL('https://capture.mcp.blencorp.com/mcp')
  );

  assert.equal(tokens.token_type, 'bearer');
  assert.ok(tokens.access_token);
  assert.ok(tokens.refresh_token);

  const authInfo = await provider.verifyAccessToken(tokens.access_token);
  assert.deepEqual(getProviderKeysFromAuth(authInfo), {
    sam: 'sam_user_key',
    tango: 'tango_user_key',
    highergov: 'hg_user_key',
  });
});

test('partial provider selection only seals the chosen keys', async () => {
  const provider = new McpOAuthProvider({
    baseUrl: new URL('https://capture.mcp.blencorp.com'),
    tokenSecret: 'test-secret',
  });
  const client = makeClient();
  await provider.clientsStore.registerClient?.(client);

  const tokens = await runFullFlow(provider, client, { highergov: 'hg_only' });
  const authInfo = await provider.verifyAccessToken(tokens.access_token);
  assert.deepEqual(getProviderKeysFromAuth(authInfo), { highergov: 'hg_only' });
});

test('refresh token preserves the original provider keys', async () => {
  const provider = new McpOAuthProvider({
    baseUrl: new URL('https://capture.mcp.blencorp.com'),
    tokenSecret: 'test-secret',
  });
  const client = makeClient();
  await provider.clientsStore.registerClient?.(client);

  const tokens = await runFullFlow(provider, client, { sam: 'sam_key', tango: 'tango_key' });
  assert.ok(tokens.refresh_token);
  const refreshed = await provider.exchangeRefreshToken(client, tokens.refresh_token!);
  const authInfo = await provider.verifyAccessToken(refreshed.access_token);
  assert.deepEqual(getProviderKeysFromAuth(authInfo), { sam: 'sam_key', tango: 'tango_key' });
});

test('sealed access tokens cannot be verified with a different token secret', async () => {
  const provider = new McpOAuthProvider({
    baseUrl: new URL('https://capture.mcp.blencorp.com'),
    tokenSecret: 'first-secret',
  });
  const otherProvider = new McpOAuthProvider({
    baseUrl: new URL('https://capture.mcp.blencorp.com'),
    tokenSecret: 'second-secret',
  });
  const client = makeClient();
  await provider.clientsStore.registerClient?.(client);

  const tokens = await runFullFlow(provider, client, { highergov: 'hg_key' });

  await assert.rejects(
    async () => otherProvider.verifyAccessToken(tokens.access_token),
    /Invalid access token/
  );
});

test('completeAuthorization rejects an empty key set', async () => {
  const provider = new McpOAuthProvider({
    baseUrl: new URL('https://capture.mcp.blencorp.com'),
    tokenSecret: 'test-secret',
  });
  const client = makeClient();
  await provider.clientsStore.registerClient?.(client);

  const { response, redirects } = makeRedirectCapture();
  await provider.authorize(client, makeAuthorizationParams(), response);
  const requestId = new URL(redirects[0]).searchParams.get('request_id');
  assert.ok(requestId);

  await assert.rejects(
    async () => provider.completeAuthorization(requestId, {}),
    /at least one provider API key/
  );
});

test('completeAuthorization trims whitespace-only keys and rejects if none remain', async () => {
  const provider = new McpOAuthProvider({
    baseUrl: new URL('https://capture.mcp.blencorp.com'),
    tokenSecret: 'test-secret',
  });
  const client = makeClient();
  await provider.clientsStore.registerClient?.(client);

  const { response, redirects } = makeRedirectCapture();
  await provider.authorize(client, makeAuthorizationParams(), response);
  const requestId = new URL(redirects[0]).searchParams.get('request_id');
  assert.ok(requestId);

  await assert.rejects(
    async () => provider.completeAuthorization(requestId, { sam: '   ', highergov: '' }),
    /at least one provider API key/
  );
});

test('getProviderKeysFromAuth returns empty object for missing/invalid extras', () => {
  assert.deepEqual(getProviderKeysFromAuth(undefined), {});
  assert.deepEqual(getProviderKeysFromAuth({ token: 't', clientId: 'c', scopes: [], extra: { providerKeys: 'not-an-object' } } as any), {});
  assert.deepEqual(
    getProviderKeysFromAuth({ token: 't', clientId: 'c', scopes: [], extra: { providerKeys: { sam: '  ', highergov: 'x' } } } as any),
    { highergov: 'x' }
  );
});
