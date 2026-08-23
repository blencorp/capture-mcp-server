import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { Server as HttpServer } from 'node:http';
import express from 'express';
import { McpOAuthProvider } from './mcp-oauth.js';
import { buildOAuthMetadata, oauthEndpointsRouter } from './oauth-endpoints.js';

// Drives the in-repo OAuth 2.1 authorization-server endpoints over real HTTP.
// These endpoints replaced SDK v1's mcpAuthRouter when the SDK dropped its
// authorization server in v2, so the protocol behavior is pinned here:
// PKCE S256 is mandatory, authorization responses carry `iss` (RFC 9207), and
// Dynamic Client Registration persists `application_type`.

type Harness = {
  base: string;
  provider: McpOAuthProvider;
  close: () => Promise<void>;
};

async function startHarness(): Promise<Harness> {
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));

  const server: HttpServer = await new Promise(resolve => {
    const s = app.listen(0, () => resolve(s));
  });
  const port = (server.address() as AddressInfo).port;
  const baseUrl = new URL(`http://localhost:${port}`);

  const provider = new McpOAuthProvider({ baseUrl, tokenSecret: 'endpoint-test-secret' });
  app.use(oauthEndpointsRouter({
    provider,
    baseUrl,
    mcpResourceUrl: new URL('/mcp', baseUrl),
    resourceName: 'Endpoint Test',
  }));

  return {
    base: baseUrl.href.slice(0, -1),
    provider,
    close: () => new Promise(resolve => server.close(() => resolve())),
  };
}

async function registerClient(base: string, extra: Record<string, unknown> = {}): Promise<any> {
  const res = await fetch(`${base}/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      client_name: 'endpoint-test',
      redirect_uris: ['http://localhost:9999/callback'],
      token_endpoint_auth_method: 'none',
      ...extra,
    }),
  });
  assert.equal(res.status, 201);
  return res.json();
}

test('discovery documents advertise the hardened metadata', async () => {
  const h = await startHarness();
  try {
    const asMeta = await (await fetch(`${h.base}/.well-known/oauth-authorization-server`)).json();
    assert.equal(asMeta.issuer, h.base);
    assert.equal(asMeta.authorization_endpoint, `${h.base}/authorize`);
    assert.equal(asMeta.token_endpoint, `${h.base}/token`);
    assert.equal(asMeta.registration_endpoint, `${h.base}/register`);
    assert.deepEqual(asMeta.code_challenge_methods_supported, ['S256']);
    assert.equal(asMeta.authorization_response_iss_parameter_supported, true);

    const prm = await (await fetch(`${h.base}/.well-known/oauth-protected-resource/mcp`)).json();
    assert.equal(prm.resource, `${h.base}/mcp`);
  } finally {
    await h.close();
  }
});

test('buildOAuthMetadata trims the trailing slash off the issuer', () => {
  const metadata = buildOAuthMetadata(new URL('https://example.com/'));
  assert.equal(metadata.issuer, 'https://example.com');
  assert.equal(metadata.token_endpoint, 'https://example.com/token');
});

test('dynamic client registration stores application_type and rejects bad metadata', async () => {
  const h = await startHarness();
  try {
    const client = await registerClient(h.base, { application_type: 'native' });
    assert.equal(client.application_type, 'native');
    assert.equal(client.token_endpoint_auth_method, 'none');
    assert.equal(client.scope, 'mcp:tools');
    assert.ok(client.client_id);
    assert.equal(client.client_secret, undefined, 'public clients get no secret');

    const secretClient = await registerClient(h.base, { token_endpoint_auth_method: 'client_secret_post' });
    assert.ok(secretClient.client_secret, 'confidential clients get a generated secret');

    const missingUris = await fetch(`${h.base}/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ client_name: 'no-uris' }),
    });
    assert.equal(missingUris.status, 400);
    assert.equal((await missingUris.json()).error, 'invalid_redirect_uri');

    const badType = await fetch(`${h.base}/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ redirect_uris: ['http://localhost:9999/callback'], application_type: 'hologram' }),
    });
    assert.equal(badType.status, 400);
  } finally {
    await h.close();
  }
});

test('authorize enforces PKCE S256 and delivers errors by redirect with iss', async () => {
  const h = await startHarness();
  try {
    const client = await registerClient(h.base);

    const noChallenge = new URL(`${h.base}/authorize`);
    noChallenge.searchParams.set('response_type', 'code');
    noChallenge.searchParams.set('client_id', client.client_id);
    noChallenge.searchParams.set('redirect_uri', 'http://localhost:9999/callback');
    noChallenge.searchParams.set('state', 'abc');
    const res = await fetch(noChallenge, { redirect: 'manual' });
    assert.equal(res.status, 302);
    const target = new URL(res.headers.get('location')!);
    assert.equal(target.origin, 'http://localhost:9999');
    assert.equal(target.searchParams.get('error'), 'invalid_request');
    assert.equal(target.searchParams.get('state'), 'abc');
    assert.equal(target.searchParams.get('iss'), h.base, 'RFC 9207 iss on error responses');

    const unknownClient = new URL(noChallenge);
    unknownClient.searchParams.set('client_id', 'nope');
    const unknownRes = await fetch(unknownClient, { redirect: 'manual' });
    assert.equal(unknownRes.status, 400, 'unknown client cannot be answered by redirect');

    const badRedirect = new URL(noChallenge);
    badRedirect.searchParams.set('redirect_uri', 'http://evil.example/steal');
    const badRedirectRes = await fetch(badRedirect, { redirect: 'manual' });
    assert.equal(badRedirectRes.status, 400, 'unregistered redirect_uri is refused, not redirected');
  } finally {
    await h.close();
  }
});

test('full code flow: PKCE verification gates the token endpoint, success carries iss', async () => {
  const h = await startHarness();
  try {
    const client = await registerClient(h.base);
    const verifier = randomBytes(32).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');

    const authUrl = new URL(`${h.base}/authorize`);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('client_id', client.client_id);
    authUrl.searchParams.set('redirect_uri', 'http://localhost:9999/callback');
    authUrl.searchParams.set('code_challenge', challenge);
    authUrl.searchParams.set('code_challenge_method', 'S256');
    authUrl.searchParams.set('state', 'flow-state');
    const authRes = await fetch(authUrl, { redirect: 'manual' });
    assert.equal(authRes.status, 302);
    const requestId = new URL(authRes.headers.get('location')!).searchParams.get('request_id')!;

    // The credential page is served by server.ts; complete the pending
    // authorization directly on the provider, as that handler does.
    const finalRedirect = await h.provider.completeAuthorization(requestId, { tango: 'sealed-key' });
    const cb = new URL(finalRedirect);
    const code = cb.searchParams.get('code')!;
    assert.ok(code);
    assert.equal(cb.searchParams.get('state'), 'flow-state');
    assert.equal(cb.searchParams.get('iss'), h.base, 'RFC 9207 iss on success responses');

    const wrongVerifier = await fetch(`${h.base}/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: client.client_id,
        code,
        code_verifier: 'not-the-right-verifier-not-the-right-verifier',
      }),
    });
    assert.equal(wrongVerifier.status, 400);
    assert.equal((await wrongVerifier.json()).error, 'invalid_grant');

    const tokenRes = await fetch(`${h.base}/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: client.client_id,
        code,
        code_verifier: verifier,
        redirect_uri: 'http://localhost:9999/callback',
      }),
    });
    assert.equal(tokenRes.status, 200);
    const tokens = await tokenRes.json();
    assert.equal(tokens.token_type, 'bearer');
    assert.ok(tokens.access_token);
    assert.ok(tokens.refresh_token);

    const authInfo = await h.provider.verifyAccessToken(tokens.access_token);
    assert.deepEqual(authInfo.extra?.providerKeys, { tango: 'sealed-key' });

    const refreshRes = await fetch(`${h.base}/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: client.client_id,
        refresh_token: tokens.refresh_token,
      }),
    });
    assert.equal(refreshRes.status, 200);

    const revokeRes = await fetch(`${h.base}/revoke`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: client.client_id, token: tokens.access_token }),
    });
    assert.equal(revokeRes.status, 200);
    await assert.rejects(() => h.provider.verifyAccessToken(tokens.access_token));
  } finally {
    await h.close();
  }
});

test('token endpoint rejects unknown clients and grant types', async () => {
  const h = await startHarness();
  try {
    const unknown = await fetch(`${h.base}/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'authorization_code', client_id: 'ghost', code: 'x', code_verifier: 'y' }),
    });
    assert.equal(unknown.status, 401);
    assert.equal((await unknown.json()).error, 'invalid_client');

    const client = await registerClient(h.base);
    const badGrant = await fetch(`${h.base}/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'password', client_id: client.client_id }),
    });
    assert.equal(badGrant.status, 400);
    assert.equal((await badGrant.json()).error, 'unsupported_grant_type');
  } finally {
    await h.close();
  }
});
