import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Response } from 'express';
import type { OAuthClientInformationFull } from '@modelcontextprotocol/server';
import {
  DEFAULT_CLIENT_SCOPE,
  McpOAuthProvider,
  getProviderKeysFromAuth,
  type AuthorizationParams,
} from './mcp-oauth.js';
import {
  InMemoryOAuthStateStore,
  RedisOAuthStateStore,
  type OAuthStateStore,
} from './oauth-state-store.js';

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

async function proveCrossInstanceFlow(
  firstStore: OAuthStateStore,
  secondStore: OAuthStateStore,
): Promise<void> {
  const options = {
    baseUrl: new URL('https://capture.mcp.blencorp.com'),
    tokenSecret: 'shared-deployment-secret',
  };
  const first = new McpOAuthProvider({ ...options, stateStore: firstStore });
  const second = new McpOAuthProvider({ ...options, stateStore: secondStore });
  const client = await first.registerClient(makeClient());
  assert.equal((await second.getClient(client.client_id))?.client_name, client.client_name);

  const { response, redirects } = makeRedirectCapture();
  await first.authorize(client, makeAuthorizationParams(), response);
  const requestId = new URL(redirects[0]).searchParams.get('request_id');
  assert.ok(requestId);

  const redirect = await second.completeAuthorization(requestId, { sam: 'shared-sam-key' });
  const code = new URL(redirect).searchParams.get('code');
  assert.ok(code);
  assert.equal(await first.challengeForAuthorizationCode(client, code), 'challenge-123');

  const tokens = await second.exchangeAuthorizationCode(
    client,
    code,
    undefined,
    'https://claude.ai/api/mcp/auth_callback',
    new URL('https://capture.mcp.blencorp.com/mcp'),
  );
  await assert.rejects(
    () => first.exchangeAuthorizationCode(client, code),
    /Invalid authorization code/,
    'authorization codes are atomically single-use across instances',
  );

  assert.ok(tokens.refresh_token);
  const refreshed = await first.exchangeRefreshToken(
    client,
    tokens.refresh_token!,
    undefined,
    new URL('https://capture.mcp.blencorp.com/mcp'),
  );
  const authInfo = await second.verifyAccessToken(refreshed.access_token);
  assert.deepEqual(getProviderKeysFromAuth(authInfo), { sam: 'shared-sam-key' });

  await first.revokeToken(client, { token: refreshed.access_token });
  await assert.rejects(
    () => second.verifyAccessToken(refreshed.access_token),
    /Token has been revoked/,
    'revocation is shared across instances',
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
  await provider.registerClient(client);

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
  await provider.registerClient(client);

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
  await provider.registerClient(client);

  const tokens = await runFullFlow(provider, client, { sam: 'sam_key', tango: 'tango_key' });
  assert.ok(tokens.refresh_token);
  const refreshed = await provider.exchangeRefreshToken(
    client,
    tokens.refresh_token!,
    undefined,
    new URL('https://capture.mcp.blencorp.com/mcp'),
  );
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
  await provider.registerClient(client);

  const tokens = await runFullFlow(provider, client, { highergov: 'hg_key' });

  await assert.rejects(
    async () => otherProvider.verifyAccessToken(tokens.access_token),
    /Invalid access token/
  );
});

test('authorization and tokens are bound to the canonical MCP resource', async () => {
  const provider = new McpOAuthProvider({
    baseUrl: new URL('https://capture.mcp.blencorp.com'),
    tokenSecret: 'resource-test-secret',
  });
  const client = makeClient();
  await provider.registerClient(client);
  const { response } = makeRedirectCapture();

  await assert.rejects(
    () => provider.authorize(client, { ...makeAuthorizationParams(), resource: undefined }, response),
    /resource must identify this MCP server/,
  );
  await assert.rejects(
    () => provider.authorize(
      client,
      { ...makeAuthorizationParams(), resource: new URL('https://other.example/mcp') },
      response,
    ),
    /resource must identify this MCP server/,
  );

  const tokens = await runFullFlow(provider, client, { sam: 'resource-bound-key' });
  assert.ok(tokens.refresh_token);
  await assert.rejects(
    () => provider.exchangeRefreshToken(client, tokens.refresh_token!),
    /resource does not match/,
  );
  await assert.rejects(
    () => provider.exchangeRefreshToken(
      client,
      tokens.refresh_token!,
      undefined,
      new URL('https://other.example/mcp'),
    ),
    /resource does not match/,
  );
});

test('completeAuthorization rejects an empty key set', async () => {
  const provider = new McpOAuthProvider({
    baseUrl: new URL('https://capture.mcp.blencorp.com'),
    tokenSecret: 'test-secret',
  });
  const client = makeClient();
  await provider.registerClient(client);

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
  await provider.registerClient(client);

  const { response, redirects } = makeRedirectCapture();
  await provider.authorize(client, makeAuthorizationParams(), response);
  const requestId = new URL(redirects[0]).searchParams.get('request_id');
  assert.ok(requestId);

  await assert.rejects(
    async () => provider.completeAuthorization(requestId, { sam: '   ', highergov: '' }),
    /at least one provider API key/
  );
});

test('registerClient defaults a missing scope to mcp:tools', async () => {
  const provider = new McpOAuthProvider({
    baseUrl: new URL('https://capture.mcp.blencorp.com'),
    tokenSecret: 'test-secret',
  });
  const { scope: _omitted, client_id: _id, client_id_issued_at: _issuedAt, ...metadata } = makeClient();

  const registered = await provider.registerClient(metadata);
  assert.equal(registered.scope, DEFAULT_CLIENT_SCOPE);
  assert.equal((await provider.getClient(registered.client_id))?.scope, DEFAULT_CLIENT_SCOPE);
});

test('registerClient defaults a blank scope to mcp:tools', async () => {
  const provider = new McpOAuthProvider({
    baseUrl: new URL('https://capture.mcp.blencorp.com'),
    tokenSecret: 'test-secret',
  });
  const registered = await provider.registerClient({ ...makeClient(), scope: '   ' });
  assert.equal(registered.scope, DEFAULT_CLIENT_SCOPE);
});

test('registerClient preserves an explicitly requested scope', async () => {
  const provider = new McpOAuthProvider({
    baseUrl: new URL('https://capture.mcp.blencorp.com'),
    tokenSecret: 'test-secret',
  });
  const registered = await provider.registerClient({ ...makeClient(), scope: 'custom:scope' });
  assert.equal(registered.scope, 'custom:scope');
});

test('getProviderKeysFromAuth returns empty object for missing/invalid extras', () => {
  assert.deepEqual(getProviderKeysFromAuth(undefined), {});
  assert.deepEqual(getProviderKeysFromAuth({ token: 't', clientId: 'c', scopes: [], extra: { providerKeys: 'not-an-object' } } as any), {});
  assert.deepEqual(
    getProviderKeysFromAuth({ token: 't', clientId: 'c', scopes: [], extra: { providerKeys: { sam: '  ', highergov: 'x' } } } as any),
    { highergov: 'x' }
  );
});

test('OAuth transactions and refresh survive provider recreation through a shared store', async () => {
  const store = new InMemoryOAuthStateStore();
  await proveCrossInstanceFlow(store, store);
});

test(
  'Redis OAuth state survives independent provider and store instances',
  { skip: process.env.TEST_REDIS_URL ? false : 'TEST_REDIS_URL is not configured' },
  async () => {
    const prefix = `capture-mcp:test:${randomUUID()}`;
    const firstStore = await RedisOAuthStateStore.connect(process.env.TEST_REDIS_URL!, prefix);
    const secondStore = await RedisOAuthStateStore.connect(process.env.TEST_REDIS_URL!, prefix);
    try {
      await proveCrossInstanceFlow(firstStore, secondStore);
    } finally {
      await Promise.all([firstStore.close(), secondStore.close()]);
    }
  },
);
