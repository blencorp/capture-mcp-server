import test from 'node:test';
import assert from 'node:assert/strict';
import type { Response } from 'express';
import type { OAuthClientInformationFull } from '@modelcontextprotocol/sdk/shared/auth.js';
import type { AuthorizationParams } from '@modelcontextprotocol/sdk/server/auth/provider.js';
import {
  HigherGovOAuthProvider,
  getHigherGovApiKeyFromAuth,
} from './highergov-oauth.js';

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

test('OAuth flow issues a bearer token that carries the user HigherGov key', async () => {
  const provider = new HigherGovOAuthProvider({
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
  assert.equal(credentialPageUrl.pathname, '/oauth/highergov/authorize');
  const requestId = credentialPageUrl.searchParams.get('request_id');
  assert.ok(requestId);

  const finalRedirect = await provider.completeAuthorization(requestId, 'hg_user_test_key');
  const callbackUrl = new URL(finalRedirect);
  assert.equal(callbackUrl.origin + callbackUrl.pathname, 'https://claude.ai/api/mcp/auth_callback');
  assert.equal(callbackUrl.searchParams.get('state'), 'state-123');
  const code = callbackUrl.searchParams.get('code');
  assert.ok(code);

  await assert.doesNotReject(async () => {
    const challenge = await provider.challengeForAuthorizationCode(client, code);
    assert.equal(challenge, 'challenge-123');
  });

  const tokens = await provider.exchangeAuthorizationCode(
    client,
    code,
    undefined,
    'https://claude.ai/api/mcp/auth_callback',
    new URL('https://capture.mcp.blencorp.com/mcp')
  );

  assert.equal(tokens.token_type, 'bearer');
  assert.equal(tokens.expires_in, 3600);
  assert.ok(tokens.access_token);
  assert.ok(tokens.refresh_token);

  const authInfo = await provider.verifyAccessToken(tokens.access_token);
  assert.equal(authInfo.clientId, 'claude-test-client');
  assert.deepEqual(authInfo.scopes, ['mcp:tools']);
  assert.equal(getHigherGovApiKeyFromAuth(authInfo), 'hg_user_test_key');
});

test('sealed access tokens cannot be verified with a different token secret', async () => {
  const provider = new HigherGovOAuthProvider({
    baseUrl: new URL('https://capture.mcp.blencorp.com'),
    tokenSecret: 'first-secret',
  });
  const otherProvider = new HigherGovOAuthProvider({
    baseUrl: new URL('https://capture.mcp.blencorp.com'),
    tokenSecret: 'second-secret',
  });
  const client = makeClient();
  await provider.clientsStore.registerClient?.(client);

  const { response, redirects } = makeRedirectCapture();
  await provider.authorize(client, makeAuthorizationParams(), response);
  const requestId = new URL(redirects[0]).searchParams.get('request_id');
  assert.ok(requestId);
  const finalRedirect = await provider.completeAuthorization(requestId, 'hg_user_test_key');
  const code = new URL(finalRedirect).searchParams.get('code');
  assert.ok(code);
  const tokens = await provider.exchangeAuthorizationCode(client, code);

  await assert.rejects(
    async () => otherProvider.verifyAccessToken(tokens.access_token),
    /Invalid access token/
  );
});

test('completing authorization requires a non-empty HigherGov API key', async () => {
  const provider = new HigherGovOAuthProvider({
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
    async () => provider.completeAuthorization(requestId, '   '),
    /HigherGov API key is required/
  );
});
