import test from 'node:test';
import assert from 'node:assert/strict';
import type { Response } from 'express';
import type { OAuthClientInformationFull } from '@modelcontextprotocol/sdk/shared/auth.js';
import type { AuthorizationParams } from '@modelcontextprotocol/sdk/server/auth/provider.js';
import {
  AUTHORIZATION_PAGE_CSP,
  DEFAULT_CLIENT_SCOPE,
  McpOAuthProvider,
  getProviderKeysFromAuth,
  renderAuthorizationPage,
} from './mcp-oauth.js';
import { createHash } from 'node:crypto';
import { PAYLOAD, sealToken } from './__fixtures__/sealed-token.js';
import { KeyRing } from './key-ring.js';
import { SealedClientsStore } from './client-registrations.js';

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

// ---- Sealed token envelope (AES-GCM) ----------------------------------------------------------

const BASE_URL = new URL('https://capture.mcp.blencorp.com');
const NOW_MS = PAYLOAD.iat * 1000 + 10_000;
const providerAt = (tokenSecret: string, extra: Partial<ConstructorParameters<typeof McpOAuthProvider>[0]> = {}) =>
  new McpOAuthProvider({ baseUrl: BASE_URL, tokenSecret, now: () => NOW_MS, ...extra });

const parts = (token: string) => token.split('.');
const rejectsToken = (provider: McpOAuthProvider, token: string) =>
  assert.rejects(() => provider.verifyAccessToken(token), /Invalid access token/);

test('a token sealed before the envelope checks still opens (16-byte tag, 12-byte IV)', async () => {
  // Produced by the previous implementation (AES-256-GCM, no explicit tag length).
  const legacy =
    'capmcp.v1.-cAq7hhakBg7Wi_1.fkjz5JfKpXHXCmjCJIMJEnblTdwk6o03NXGJrpruFBJatCXqCMjCQZM6Dpv7Ir9K1Oyyct3ma2EUFT4osGXP8d8Ge6zecj2Pbf8GGd6G0jLk7D-kV000Lk33ALv73pobV1mmNWE6LlOT0YVLg9aUou4oi6T4fpuyb1zbyeNWEJgVo6EEDUd3_ZjnFvPSdmHNGyslOBDKcGeA8JGxFv9WYGhVjhebltyqggdkhf2rLUVo3X0oRMfIxr0v2m0_eg.eD4w34dN0JSq4odYmxHG4A';
  const authInfo = await providerAt('legacy-test-secret').verifyAccessToken(legacy);
  assert.equal(authInfo.clientId, 'legacy-client');
  assert.deepEqual(getProviderKeysFromAuth(authInfo), { sam: 'legacy-sam-key' });
});

test('a token built the way the server builds it verifies (so the rejection tests below mean something)', async () => {
  const authInfo = await providerAt('secret').verifyAccessToken(sealToken('secret'));
  assert.equal(authInfo.clientId, PAYLOAD.clientId);
});

test('a truncated tag is rejected, even one that is a true prefix of the real tag', async () => {
  const provider = providerAt('secret');
  for (const tagBytes of [1, 4, 8, 12, 15]) {
    await rejectsToken(provider, sealToken('secret', PAYLOAD, { tagBytes }));
  }
});

test('an oversized tag is rejected', async () => {
  const token = sealToken('secret');
  const [prefix, version, iv, data, tag] = parts(token);
  const longer = Buffer.concat([Buffer.from(tag!, 'base64url'), Buffer.alloc(1)]).toString('base64url');
  await rejectsToken(providerAt('secret'), [prefix, version, iv, data, longer].join('.'));
});

test('a different key or different AAD is rejected', async () => {
  await rejectsToken(providerAt('other-secret'), sealToken('secret'));
  await rejectsToken(providerAt('secret'), sealToken('secret', PAYLOAD, { aad: 'another-purpose' }));
});

test('modified ciphertext is rejected', async () => {
  const [prefix, version, iv, data, tag] = parts(sealToken('secret'));
  const bytes = Buffer.from(data!, 'base64url');
  bytes[0] = bytes[0]! ^ 1;
  await rejectsToken(providerAt('secret'), [prefix, version, iv, bytes.toString('base64url'), tag].join('.'));
});

test('a malformed envelope is rejected: wrong IV size, extra or missing parts, non-canonical encoding', async () => {
  const provider = providerAt('secret');
  await rejectsToken(provider, sealToken('secret', PAYLOAD, { ivBytes: 16 }));
  await rejectsToken(provider, sealToken('secret', PAYLOAD, { ivBytes: 8 }));
  const good = sealToken('secret');
  await rejectsToken(provider, `${good}.extra`);
  await rejectsToken(provider, parts(good).slice(0, 4).join('.'));
  await rejectsToken(provider, good.replace('capmcp.v1', 'capmcp.v2'));
  await rejectsToken(provider, `${good}=`); // padded base64url is a second spelling of the same tag
  await rejectsToken(provider, [...parts(good).slice(0, 3), ''].join('.'));
  await rejectsToken(provider, 'not-a-token');
});

test('a payload of the wrong shape is rejected even when it authenticates', async () => {
  await rejectsToken(providerAt('secret'), sealToken('secret', { ...PAYLOAD, keys: 'a string' }));
});

// ---- Lifetimes, secret rotation and revocation ------------------------------------------------

async function flow(provider: McpOAuthProvider, client = makeClient(), keys: Record<string, string> = { sam: 'sam_key' }) {
  await provider.clientsStore.registerClient?.(client);
  return { client, tokens: await runFullFlow(provider, client, keys) };
}

test('access tokens last an hour by default and expire on time', async () => {
  let now = 1_800_000_000_000;
  const provider = new McpOAuthProvider({ baseUrl: BASE_URL, tokenSecret: 'secret', now: () => now });
  const { tokens } = await flow(provider);
  assert.equal(tokens.expires_in, 3600);
  await provider.verifyAccessToken(tokens.access_token);
  now += 3599_000;
  await provider.verifyAccessToken(tokens.access_token);
  now += 2_000;
  await assert.rejects(() => provider.verifyAccessToken(tokens.access_token), /expired/);
});

test('an access token sealed under a longer lifetime is also capped at the current one', async () => {
  const longLived = sealToken('secret', { ...PAYLOAD, iat: 1_700_000_000, exp: 1_700_000_000 + 30 * 86_400 });
  // Two hours after it was issued, with the default 1 hour lifetime.
  const provider = providerAt('secret', { now: () => (1_700_000_000 + 7_200) * 1000 });
  await assert.rejects(() => provider.verifyAccessToken(longLived), /expired/);
});

test('lifetimes beyond the ceilings are refused at startup', () => {
  assert.throws(() => providerAt('secret', { accessTokenTtlSeconds: 86_401 }), /accessTokenTtlSeconds/);
  assert.throws(() => providerAt('secret', { refreshTokenTtlSeconds: 90 * 86_400 + 1 }), /refreshTokenTtlSeconds/);
  assert.throws(() => providerAt('secret', { accessTokenTtlSeconds: 0 }), /accessTokenTtlSeconds/);
  assert.throws(() => providerAt('secret', { accessTokenTtlSeconds: 1.5 }), /accessTokenTtlSeconds/);
});

test('refreshing renews the access token but never extends the refresh token\'s original expiry', async () => {
  let now = 1_800_000_000_000;
  const provider = new McpOAuthProvider({ baseUrl: BASE_URL, tokenSecret: 'secret', now: () => now });
  const { client, tokens } = await flow(provider);
  const firstRefreshExp = Math.floor(now / 1000) + 90 * 86_400;

  now += 89 * 86_400_000;
  const second = await provider.exchangeRefreshToken(client, tokens.refresh_token!);
  // The new refresh token ends when the first one would have, a day from now.
  now += 86_400_000 - 1_000;
  const third = await provider.exchangeRefreshToken(client, second.refresh_token!);
  assert.ok(third.expires_in! <= 1, 'the access token is capped at the refresh token\'s expiry');
  assert.ok(Math.floor(now / 1000) < firstRefreshExp);

  now += 2_000;
  await assert.rejects(() => provider.exchangeRefreshToken(client, third.refresh_token!), /expired/);
});

test('a refresh token is not accepted as an access token, nor the reverse', async () => {
  const provider = providerAt('secret');
  const { tokens } = await flow(provider);
  await rejectsToken(provider, tokens.refresh_token!);
  await assert.rejects(() => provider.exchangeRefreshToken(makeClient(), tokens.access_token), /Invalid refresh token/);
});

test('key ring: tokens sealed with a retired secret open while it is listed, new tokens use the current one', async () => {
  const oldProvider = providerAt('old-secret');
  const { client, tokens: oldTokens } = await flow(oldProvider);

  const rotated = providerAt('new-secret', { previousTokenSecrets: ['old-secret'] });
  await rotated.clientsStore.registerClient?.(client);
  await rotated.verifyAccessToken(oldTokens.access_token);

  // A refresh re-seals under the current secret: the old secret no longer opens what it issues.
  const refreshed = await rotated.exchangeRefreshToken(client, oldTokens.refresh_token!);
  await rotated.verifyAccessToken(refreshed.access_token);
  await rejectsToken(oldProvider, refreshed.access_token);
  await providerAt('new-secret').verifyAccessToken(refreshed.access_token);
});

test('key ring: dropping a retired secret revokes every token it sealed (emergency revocation)', async () => {
  const { tokens } = await flow(providerAt('leaked-secret'));
  await rejectsToken(providerAt('new-secret'), tokens.access_token);
});

test('key ring: the list is trimmed and de-duplicated, and has a ceiling', async () => {
  const token = sealToken('second');
  const ring = providerAt('current', { previousTokenSecrets: [' first ', 'second', 'second', '', 'current'] });
  await ring.verifyAccessToken(token);
  assert.throws(() => providerAt('current', { previousTokenSecrets: ['a', 'b', 'c', 'd'] }), /At most 3/);
});

test('revoking a token rejects it on that instance, and only for the client it was issued to', async () => {
  const provider = providerAt('secret');
  const { client, tokens } = await flow(provider);

  const stranger = { ...makeClient(), client_id: 'someone-else' };
  await provider.revokeToken(stranger, { token: tokens.access_token });
  await provider.verifyAccessToken(tokens.access_token);

  await provider.revokeToken(client, { token: tokens.access_token });
  await assert.rejects(() => provider.verifyAccessToken(tokens.access_token), /revoked/);
  await provider.revokeToken(client, { token: 'garbage' }); // unknown tokens succeed silently (RFC 7009)
});

// ---- Scopes ---------------------------------------------------------------------------------

test('authorize refuses a scope the server does not grant, and defaults to mcp:tools when none is asked for', async () => {
  const provider = providerAt('secret');
  const client = { ...makeClient(), scope: 'mcp:tools admin' };
  await provider.clientsStore.registerClient?.(client);

  await assert.rejects(
    () => provider.authorize(client, { ...makeAuthorizationParams(), scopes: ['admin'] }, makeRedirectCapture().response),
    /Unsupported scope admin/,
  );

  const { response, redirects } = makeRedirectCapture();
  await provider.authorize(client, { ...makeAuthorizationParams(), scopes: undefined }, response);
  const code = new URL(
    await provider.completeAuthorization(new URL(redirects[0]!).searchParams.get('request_id')!, { sam: 'k' }),
  ).searchParams.get('code')!;
  const tokens = await provider.exchangeAuthorizationCode(client, code);
  assert.equal(tokens.scope, DEFAULT_CLIENT_SCOPE);
  assert.deepEqual((await provider.verifyAccessToken(tokens.access_token)).scopes, [DEFAULT_CLIENT_SCOPE]);
});

test('a token issued before scopes were enforced (none sealed) is treated as holding the default scope', async () => {
  const provider = providerAt('secret');
  const legacy = sealToken('secret', { ...PAYLOAD, scopes: [] });
  assert.deepEqual((await provider.verifyAccessToken(legacy)).scopes, [DEFAULT_CLIENT_SCOPE]);

  const refresh = sealToken('secret', { ...PAYLOAD, kind: 'refresh', scopes: [], clientId: 'claude-test-client' });
  const refreshed = await provider.exchangeRefreshToken(makeClient(), refresh);
  assert.equal(refreshed.scope, DEFAULT_CLIENT_SCOPE);
});

test('a refresh cannot widen the scopes the token was granted', async () => {
  const provider = providerAt('secret');
  const refresh = sealToken('secret', { ...PAYLOAD, kind: 'refresh', clientId: 'claude-test-client' });
  await assert.rejects(() => provider.exchangeRefreshToken(makeClient(), refresh, ['mcp:tools', 'admin']), /not granted scope admin/);
});

// ---- Bounded in-memory state ------------------------------------------------------------------

test('pending authorizations expire', async () => {
  let now = 1_800_000_000_000;
  const provider = new McpOAuthProvider({ baseUrl: BASE_URL, tokenSecret: 'secret', now: () => now });
  const client = makeClient();
  await provider.clientsStore.registerClient?.(client);
  const { response, redirects } = makeRedirectCapture();
  await provider.authorize(client, makeAuthorizationParams(), response);
  const requestId = new URL(redirects[0]!).searchParams.get('request_id')!;
  now += 11 * 60_000;
  await assert.rejects(() => provider.completeAuthorization(requestId, { sam: 'k' }), /expired or was not found/);
});

// ---- Credential page --------------------------------------------------------------------------

test('the credential page policy allows exactly the page\'s own inline style and script', () => {
  const html = renderAuthorizationPage('request-1');
  const hash = (source: string) => `'sha256-${createHash('sha256').update(source).digest('base64')}'`;
  const style = /<style>([\s\S]*?)<\/style>/.exec(html)![1]!;
  const script = /<script>([\s\S]*?)<\/script>/.exec(html)![1]!;
  assert.match(AUTHORIZATION_PAGE_CSP, new RegExp(`style-src ${hash(style)}(;|$)`.replace(/[+/]/g, '\\$&')));
  assert.match(AUTHORIZATION_PAGE_CSP, new RegExp(`script-src ${hash(script)}(;|$)`.replace(/[+/]/g, '\\$&')));
  assert.match(AUTHORIZATION_PAGE_CSP, /default-src 'none'/);
  assert.match(AUTHORIZATION_PAGE_CSP, /frame-ancestors 'none'/);
  assert.ok(!AUTHORIZATION_PAGE_CSP.includes('unsafe-inline'));
  // Nothing else inline: no handlers or style attributes the policy would block.
  assert.ok(!/\son[a-z]+=|\sstyle=/i.test(html));
});

// ---- Stateless client registrations -----------------------------------------------------------

const REGISTRATION = {
  redirect_uris: ['https://claude.ai/api/mcp/auth_callback'],
  token_endpoint_auth_method: 'client_secret_post',
  grant_types: ['authorization_code', 'refresh_token'],
  response_types: ['code'],
  client_name: 'Claude',
  client_secret: 'sdk-generated-and-ignored',
};
const storeFor = (secret: string, previous: string[] = [], now = () => NOW_MS) =>
  new SealedClientsStore(new KeyRing(secret, previous), now);

test('a registration is readable from its client id alone, by any store with the same secret', () => {
  const registered = storeFor('secret').registerClient(REGISTRATION);
  assert.equal(registered.scope, DEFAULT_CLIENT_SCOPE, 'a missing scope defaults to mcp:tools');
  assert.match(registered.client_id, /^capcli\.v1\./);
  assert.notEqual(registered.client_secret, 'sdk-generated-and-ignored');

  const restarted = storeFor('secret').getClient(registered.client_id);
  assert.deepEqual(restarted, registered);
  assert.deepEqual(restarted?.redirect_uris, REGISTRATION.redirect_uris);
});

test('registerClient keeps an explicit scope, defaults a blank one, and gives public clients no secret', () => {
  const store = storeFor('secret');
  assert.equal(store.registerClient({ ...REGISTRATION, scope: 'custom:scope' }).scope, 'custom:scope');
  assert.equal(store.registerClient({ ...REGISTRATION, scope: '   ' }).scope, DEFAULT_CLIENT_SCOPE);
  const publicClient = store.registerClient({ ...REGISTRATION, token_endpoint_auth_method: 'none' });
  assert.equal(publicClient.client_secret, undefined);
  assert.equal(store.getClient(publicClient.client_id)?.client_secret, undefined);
});

test('the client secret is derived from the client id, stable, and different per client', () => {
  const store = storeFor('secret');
  const a = store.registerClient(REGISTRATION);
  const b = store.registerClient(REGISTRATION);
  assert.equal(store.getClient(a.client_id)?.client_secret, a.client_secret);
  assert.notEqual(a.client_secret, b.client_secret);
  assert.notEqual(storeFor('other', ['secret']).getClient(a.client_id)?.client_secret, undefined);
});

test('a tampered, foreign or oversized client id is not a client', () => {
  const store = storeFor('secret');
  const { client_id } = store.registerClient(REGISTRATION);
  const [prefix, version, iv, data, tag] = client_id.split('.');
  const bytes = Buffer.from(data!, 'base64url');
  bytes[0] = bytes[0]! ^ 1;
  assert.equal(store.getClient([prefix, version, iv, bytes.toString('base64url'), tag].join('.')), undefined);
  assert.equal(store.getClient(`${client_id}x`), undefined);
  assert.equal(store.getClient('3f2c1d9e-1111-4222-8333-444455556666'), undefined);
  assert.equal(store.getClient(''), undefined);
  assert.equal(store.getClient('a'.repeat(5000)), undefined);
  // An access token is not a client id, and a client id is not an access token.
  assert.equal(store.getClient(sealToken('secret')), undefined);
  return rejectsToken(providerAt('secret'), client_id);
});

test('a registration expires after 90 days', () => {
  let now = NOW_MS;
  const store = storeFor('secret', [], () => now);
  const { client_id, client_secret_expires_at } = store.registerClient(REGISTRATION);
  assert.equal(client_secret_expires_at, Math.floor(NOW_MS / 1000) + 90 * 86_400);
  now += 90 * 86_400_000 - 1_000;
  assert.ok(store.getClient(client_id));
  now += 2_000;
  assert.equal(store.getClient(client_id), undefined);
});

test('registrations follow the key ring: kept through a rotation, invalid once the secret is dropped', () => {
  const registered = storeFor('old-secret').registerClient(REGISTRATION);

  const rotated = storeFor('new-secret', ['old-secret']).getClient(registered.client_id);
  assert.equal(rotated?.client_id, registered.client_id);
  assert.equal(rotated?.client_secret, registered.client_secret, 'the secret is derived under the key that opened the id');

  assert.equal(storeFor('new-secret').getClient(registered.client_id), undefined);
});

test('a registration that is too large to carry in a client id is refused', () => {
  const redirect_uris = Array.from({ length: 40 }, (_, i) => `https://client.example.test/callback/${i}/${'x'.repeat(40)}`);
  assert.throws(() => storeFor('secret').registerClient({ ...REGISTRATION, redirect_uris }), /too large/);
});
