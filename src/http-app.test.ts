import test from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import type { Server as HttpServer } from 'node:http';
import { createHash } from 'node:crypto';

import { createHttpApp, httpAuthFromEnv, listenHost, type HttpAuth } from './http-app.js';
import { McpOAuthProvider } from './auth/mcp-oauth.js';
import { resolveRequestKeys } from './auth/request-keys.js';
import { ApiClient } from './utils/api-client.js';
import { PAYLOAD, sealToken } from './auth/__fixtures__/sealed-token.js';
import { rpcMessage } from './__fixtures__/rpc-message.js';

const OPERATOR_ENV = {
  SAM_GOV_API_KEY: 'operator-sam',
  TANGO_API_KEY: 'operator-tango',
  HIGHERGOV_API_KEY: 'operator-highergov',
} as NodeJS.ProcessEnv;

async function listen(auth: HttpAuth, env: NodeJS.ProcessEnv = OPERATOR_ENV): Promise<{ url: string; close(): Promise<void> }> {
  const app = createHttpApp({ auth, env });
  const server: HttpServer = await new Promise(resolve => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise(resolve => server.close(() => resolve())),
  };
}

function listTools(url: string, headers: Record<string, string> = {}): Promise<Response> {
  return fetch(`${url}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
  });
}

test('resolveRequestKeys: remote callers never get the operator environment keys', () => {
  const { config, keys } = resolveRequestKeys({ kind: 'caller', headers: { tango: 'caller-tango' } });
  assert.deepEqual(keys, { samKey: undefined, tangoKey: 'caller-tango', higherGovKey: undefined });
  assert.deepEqual(config, { hasSamApiKey: false, hasTangoApiKey: true, hasHigherGovApiKey: false });
});

test('resolveRequestKeys: sealed token keys win over headers; blank values are absent', () => {
  const { keys } = resolveRequestKeys({
    kind: 'caller',
    sealed: { sam: 'sealed-sam', tango: '  ' },
    headers: { sam: 'header-sam', tango: 'header-tango' },
  });
  assert.equal(keys.samKey, 'sealed-sam');
  assert.equal(keys.tangoKey, 'header-tango');
});

test('resolveRequestKeys: a single-user operator process uses its environment keys', () => {
  const { keys } = resolveRequestKeys({ kind: 'operator', env: OPERATOR_ENV, headers: { sam: 'header-sam' } });
  assert.deepEqual(keys, { samKey: 'header-sam', tangoKey: 'operator-tango', higherGovKey: 'operator-highergov' });
});

test('httpAuthFromEnv: HTTP refuses to start without authentication or an explicit insecure opt-in', () => {
  assert.throws(() => httpAuthFromEnv({}, 3000), /needs authentication/);
  assert.throws(() => httpAuthFromEnv({ MCP_REQUIRE_OAUTH: 'true' }, 3000), /OAUTH_TOKEN_SECRET/);
  assert.equal(httpAuthFromEnv({ MCP_ALLOW_INSECURE_HTTP: 'true' }, 3000).mode, 'insecure');
  assert.throws(() => httpAuthFromEnv({ MCP_REQUIRE_OAUTH: 'true', OAUTH_TOKEN_SECRET: 's' }, 3000), /MCP_PUBLIC_BASE_URL/);
  const oauth = httpAuthFromEnv(
    { MCP_REQUIRE_OAUTH: 'true', OAUTH_TOKEN_SECRET: 's', MCP_PUBLIC_BASE_URL: 'https://capture.example.test/mcp' },
    3000,
  );
  assert.equal(oauth.mode, 'oauth');
  assert.equal(oauth.mode === 'oauth' && oauth.publicBaseUrl.href, 'https://capture.example.test/');
});

test('httpAuthFromEnv: key ring, budget and proxy-header settings', () => {
  const base = { MCP_REQUIRE_OAUTH: 'true', OAUTH_TOKEN_SECRET: 'current', MCP_PUBLIC_BASE_URL: 'https://capture.example.test' };
  const plain = httpAuthFromEnv(base, 3000);
  assert.ok(plain.mode === 'oauth');
  assert.equal(plain.previousTokenSecrets, undefined);
  assert.equal(plain.clientIpHeader, undefined);

  const rotating = httpAuthFromEnv(
    { ...base, OAUTH_TOKEN_SECRET_PREVIOUS: ' old-1 , old-2,, ', MCP_IP_RPS: '7', MCP_IP_BURST: '30', MCP_CLIENT_IP_HEADER: 'X-Real-IP' },
    3000,
  );
  assert.ok(rotating.mode === 'oauth');
  assert.deepEqual(rotating.previousTokenSecrets, ['old-1', 'old-2']);
  assert.equal(rotating.requestsPerSecond, 7);
  assert.equal(rotating.requestBurst, 30);
  assert.equal(rotating.clientIpHeader, 'x-real-ip');

  assert.throws(() => httpAuthFromEnv({ ...base, MCP_CLIENT_IP_HEADER: 'x real ip' }, 3000), /MCP_CLIENT_IP_HEADER/);
  // A mistyped number is a startup error, not a silent fall back to the default.
  for (const bad of ['0.5', 'abc', '0', '-3']) {
    assert.throws(() => httpAuthFromEnv({ ...base, MCP_IP_RPS: bad }, 3000), /MCP_IP_RPS/, bad);
  }
});

test('oauth mode: tokens sealed with a retired secret work while it is listed, and stop when it is dropped', async () => {
  const token = sealToken('retired-secret', { ...PAYLOAD, clientId: 'test-client', iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 600 });
  const rotating = await listen({ mode: 'oauth', publicBaseUrl: BASE, tokenSecret: SECRET, previousTokenSecrets: ['retired-secret'] });
  const rotated = await listen({ mode: 'oauth', publicBaseUrl: BASE, tokenSecret: SECRET });
  try {
    assert.equal((await listTools(rotating.url, { authorization: `Bearer ${token}` })).status, 200);
    assert.equal((await listTools(rotated.url, { authorization: `Bearer ${token}` })).status, 401);
  } finally {
    await rotating.close();
    await rotated.close();
  }
});

test('oauth mode: a token without the mcp:tools scope is refused', async () => {
  const now = Math.floor(Date.now() / 1000);
  const wrongScope = sealToken(SECRET, { ...PAYLOAD, scopes: ['other:scope'], iat: now, exp: now + 600 });
  const server = await listen({ mode: 'oauth', publicBaseUrl: BASE, tokenSecret: SECRET });
  try {
    const res = await listTools(server.url, { authorization: `Bearer ${wrongScope}` });
    assert.equal(res.status, 403);
    assert.match(res.headers.get('www-authenticate') ?? '', /insufficient_scope/);
    const ok = sealToken(SECRET, { ...PAYLOAD, iat: now, exp: now + 600 });
    assert.equal((await listTools(server.url, { authorization: `Bearer ${ok}` })).status, 200);
  } finally {
    await server.close();
  }
});

test('oauth mode: /mcp has a request budget per client address, spent before a token is checked', async () => {
  const server = await listen({ mode: 'oauth', publicBaseUrl: BASE, tokenSecret: SECRET, requestsPerSecond: 1, requestBurst: 2 });
  try {
    const statuses: number[] = [];
    for (let i = 0; i < 3; i++) statuses.push((await listTools(server.url, { authorization: 'Bearer bogus' })).status);
    assert.deepEqual(statuses, [401, 401, 429]);
    const limited = await listTools(server.url, { authorization: 'Bearer bogus' });
    assert.equal(limited.status, 429);
    assert.ok(Number(limited.headers.get('retry-after')) >= 1);
    assert.equal(((await limited.json()) as any).error.message.includes('Too many requests'), true);
  } finally {
    await server.close();
  }
});

test('oauth mode: the budget counts the address in the configured proxy header, not the shared peer', async () => {
  const server = await listen({
    mode: 'oauth', publicBaseUrl: BASE, tokenSecret: SECRET, requestsPerSecond: 1, requestBurst: 1, clientIpHeader: 'x-real-ip',
  });
  const as = (ip: string) => listTools(server.url, { authorization: 'Bearer bogus', 'x-real-ip': ip }).then(r => r.status);
  try {
    assert.equal(await as('203.0.113.1'), 401);
    assert.equal(await as('203.0.113.1'), 429);
    assert.equal(await as('203.0.113.2'), 401, 'another client has its own budget');
    // Only the last entry of a list is trusted: it is the one the nearest proxy added.
    assert.equal(await as('198.51.100.9, 203.0.113.2'), 429);
  } finally {
    await server.close();
  }
});

test('oauth mode: the budget counts IPv6 per /64 and IPv4-mapped IPv6 as IPv4', async () => {
  const server = await listen({
    mode: 'oauth', publicBaseUrl: BASE, tokenSecret: SECRET, requestsPerSecond: 1, requestBurst: 1, clientIpHeader: 'x-real-ip',
  });
  const as = (ip: string) => listTools(server.url, { authorization: 'Bearer bogus', 'x-real-ip': ip }).then(r => r.status);
  try {
    assert.equal(await as('2001:db8:1:2::1'), 401);
    assert.equal(await as('2001:db8:1:2:ffff:eeee:dddd:cccc'), 429, 'the same /64 is one client');
    assert.equal(await as('2001:db8:1:3::1'), 401, 'another /64 is another client');
    assert.equal(await as('203.0.113.5'), 401);
    assert.equal(await as('::ffff:203.0.113.5'), 429, 'a mapped IPv4 address is the IPv4 client');
  } finally {
    await server.close();
  }
});

test('oauth mode: the SDK OAuth endpoints are limited per client address too, not per shared proxy address', async () => {
  const server = await listen({ mode: 'oauth', publicBaseUrl: BASE, tokenSecret: SECRET, clientIpHeader: 'x-real-ip' });
  const register = (ip: string) =>
    fetch(`${server.url}/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-real-ip': ip, 'x-forwarded-for': '10.0.0.1, 10.0.0.2' },
      body: JSON.stringify({ redirect_uris: ['https://client.example.test/callback'] }),
    }).then(r => r.status);
  try {
    // The SDK allows 20 registrations an hour per client.
    for (let i = 0; i < 20; i++) assert.equal(await register('203.0.113.1'), 201);
    assert.equal(await register('203.0.113.1'), 429);
    assert.equal(await register('203.0.113.2'), 201, 'another client is unaffected');
    for (let i = 0; i < 20; i++) assert.equal(await register(`2001:db8:9:9::${i + 1}`), 201);
    assert.equal(await register('2001:db8:9:9:ffff::1'), 429, 'twenty addresses of one /64 are one client');
  } finally {
    await server.close();
  }
});

// ---- Registrations survive a restart ----------------------------------------------------------

const CALLBACK = 'https://client.example.test/callback';
const form = (fields: Record<string, string>) => ({
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams(fields),
  redirect: 'manual' as const,
});

/** Registers a client, authorizes it with PKCE, and exchanges the code, against `url`. */
async function connect(url: string) {
  const registered: any = await (
    await fetch(`${url}/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ redirect_uris: [CALLBACK], token_endpoint_auth_method: 'client_secret_post', grant_types: ['authorization_code', 'refresh_token'] }),
    })
  ).json();
  const verifier = 'v'.repeat(64);
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const authorize = await fetch(
    `${url}/authorize?${new URLSearchParams({ response_type: 'code', client_id: registered.client_id, redirect_uri: CALLBACK, code_challenge: challenge, code_challenge_method: 'S256', state: 's', scope: 'mcp:tools' })}`,
    { redirect: 'manual' },
  );
  assert.equal(authorize.status, 302);
  const requestId = new URL(authorize.headers.get('location')!).searchParams.get('request_id')!;
  const approved = await fetch(`${url}/oauth/authorize`, form({ request_id: requestId, 'enabled[]': 'sam', sam_api_key: 'sam-key' }));
  assert.equal(approved.status, 302);
  const code = new URL(approved.headers.get('location')!).searchParams.get('code')!;
  const tokens: any = await (
    await fetch(`${url}/token`, form({ grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: CALLBACK, client_id: registered.client_id, client_secret: registered.client_secret }))
  ).json();
  assert.ok(tokens.refresh_token, JSON.stringify(tokens));
  return { client: registered, tokens };
}

const refresh = (url: string, client: { client_id: string; client_secret: string }, refreshToken: string) =>
  fetch(`${url}/token`, form({ grant_type: 'refresh_token', refresh_token: refreshToken, client_id: client.client_id, client_secret: client.client_secret }));

test('oauth mode: a restart keeps registered clients, so refresh keeps working; rotation follows the key ring', async () => {
  const before = await listen({ mode: 'oauth', publicBaseUrl: BASE, tokenSecret: 'restart-secret' });
  let session: Awaited<ReturnType<typeof connect>>;
  try {
    session = await connect(before.url);
  } finally {
    await before.close();
  }
  const { client, tokens } = session;

  // A new instance with the same secret: no memory of the registration, yet refresh works.
  const restarted = await listen({ mode: 'oauth', publicBaseUrl: BASE, tokenSecret: 'restart-secret' });
  try {
    const res = await refresh(restarted.url, client, tokens.refresh_token);
    assert.equal(res.status, 200);
    const renewed: any = await res.json();
    assert.equal((await listTools(restarted.url, { authorization: `Bearer ${renewed.access_token}` })).status, 200);

    // A tampered client id, and a wrong secret, are refused.
    const tampered = `${client.client_id.slice(0, -1)}${client.client_id.endsWith('A') ? 'B' : 'A'}`;
    assert.equal((await refresh(restarted.url, { ...client, client_id: tampered }, tokens.refresh_token)).status, 400);
    assert.equal((await refresh(restarted.url, { ...client, client_secret: 'wrong' }, tokens.refresh_token)).status, 400);
  } finally {
    await restarted.close();
  }

  // Rotation with the old secret kept: still works. Dropped: client and tokens are invalid.
  const rotating = await listen({ mode: 'oauth', publicBaseUrl: BASE, tokenSecret: 'next-secret', previousTokenSecrets: ['restart-secret'] });
  const revoked = await listen({ mode: 'oauth', publicBaseUrl: BASE, tokenSecret: 'next-secret' });
  try {
    assert.equal((await refresh(rotating.url, client, tokens.refresh_token)).status, 200);
    const gone = await refresh(revoked.url, client, tokens.refresh_token);
    assert.equal(gone.status, 400);
    assert.equal(((await gone.json()) as any).error, 'invalid_client');
  } finally {
    await rotating.close();
    await revoked.close();
  }
});

test('oauth mode: an old-key registration holding a new-key refresh token keeps refreshing while the old key is kept', async () => {
  const before = await listen({ mode: 'oauth', publicBaseUrl: BASE, tokenSecret: 'key-1' });
  let session: Awaited<ReturnType<typeof connect>>;
  try {
    session = await connect(before.url);
  } finally {
    await before.close();
  }
  const { client } = session;

  // After the rotation the client id is still sealed under key-1, but a refresh issues key-2 tokens.
  const rotating = await listen({ mode: 'oauth', publicBaseUrl: BASE, tokenSecret: 'key-2', previousTokenSecrets: ['key-1'] });
  const dropped = await listen({ mode: 'oauth', publicBaseUrl: BASE, tokenSecret: 'key-2' });
  try {
    const first: any = await (await refresh(rotating.url, client, session.tokens.refresh_token)).json();
    assert.ok(first.refresh_token);
    const again = await refresh(rotating.url, client, first.refresh_token);
    assert.equal(again.status, 200, 'the new-key token keeps refreshing for an old-key client');

    // Dropping key-1 before the client's registration has expired strands it, whatever key the token has.
    const stranded = await refresh(dropped.url, client, first.refresh_token);
    assert.equal(stranded.status, 400);
    assert.equal(((await stranded.json()) as any).error, 'invalid_client');
  } finally {
    await rotating.close();
    await dropped.close();
  }
});

test('oauth mode: the credential page carries a content security policy and is not cached', async () => {
  const server = await listen({ mode: 'oauth', publicBaseUrl: BASE, tokenSecret: SECRET });
  const expectLockedDown = (res: Response) => {
    const csp = res.headers.get('content-security-policy') ?? '';
    assert.match(csp, /default-src 'none'/);
    assert.match(csp, /script-src 'sha256-/);
    assert.match(csp, /frame-ancestors 'none'/);
    assert.equal(res.headers.get('cache-control'), 'no-store');
  };
  try {
    const page = await fetch(`${server.url}/oauth/authorize?request_id=abc`);
    assert.equal(page.status, 200);
    expectLockedDown(page);
    const missing = await fetch(`${server.url}/oauth/authorize`);
    assert.equal(missing.status, 400);
    expectLockedDown(missing);
    const rejected = await fetch(`${server.url}/oauth/authorize`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ request_id: 'unknown', 'enabled[]': 'sam', sam_api_key: 'k' }),
    });
    assert.equal(rejected.status, 400);
    expectLockedDown(rejected);
  } finally {
    await server.close();
  }
});

test('oauth mode: /authorize only redirects to a registered URI and echoes state on errors', async () => {
  const server = await listen({ mode: 'oauth', publicBaseUrl: BASE, tokenSecret: SECRET });
  try {
    const loopback = 'http://localhost:3000/cb';
    const registered: any = await (
      await fetch(`${server.url}/register`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ redirect_uris: [loopback] }),
      })
    ).json();
    const challenge = createHash('sha256').update('v'.repeat(64)).digest('base64url');
    const authorize = (params: Record<string, string>) =>
      fetch(`${server.url}/authorize?${new URLSearchParams({ response_type: 'code', client_id: registered.client_id, code_challenge: challenge, code_challenge_method: 'S256', scope: 'mcp:tools', ...params })}`, { redirect: 'manual' });
    // A loopback URI on another port was never registered: answered here, never redirected to.
    const otherPort = await authorize({ redirect_uri: 'http://localhost:54321/cb', state: 's0' });
    assert.equal(otherPort.status, 400);
    assert.equal(otherPort.headers.get('location'), null);
    assert.equal(((await otherPort.json()) as any).error, 'invalid_request');
    // Invalid request parameters go back to the registered URI with the client's state.
    const plain = await authorize({ redirect_uri: loopback, code_challenge_method: 'plain', state: 's1' });
    assert.equal(plain.status, 302);
    const location = new URL(plain.headers.get('location')!);
    assert.equal(`${location.origin}${location.pathname}`, loopback);
    assert.equal(location.searchParams.get('error'), 'invalid_request');
    assert.equal(location.searchParams.get('state'), 's1');
  } finally {
    await server.close();
  }
});

test('oauth mode: unreadable OAuth bodies get OAuth JSON errors, and an empty credential form is a 400 page', async () => {
  const server = await listen({ mode: 'oauth', publicBaseUrl: BASE, tokenSecret: SECRET });
  try {
    const malformed = await fetch(`${server.url}/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{bad' });
    assert.equal(malformed.status, 400);
    assert.match(malformed.headers.get('content-type') ?? '', /application\/json/);
    const body: any = await malformed.json();
    assert.equal(body.error, 'invalid_request');
    assert.doesNotMatch(JSON.stringify(body), /SyntaxError|at /);
    const empty = await fetch(`${server.url}/oauth/authorize`, { method: 'POST' });
    assert.equal(empty.status, 400);
    assert.match(empty.headers.get('content-type') ?? '', /text\/html/);
  } finally {
    await server.close();
  }
});

test('oauth mode: a provider-key header does not stand in for a bearer token', async () => {
  const server = await listen({ mode: 'oauth', publicBaseUrl: new URL('http://127.0.0.1:1/'), tokenSecret: 'test-secret' });
  try {
    const withHeader = await listTools(server.url, { 'x-sam-api-key': 'bogus' });
    assert.equal(withHeader.status, 401);
    const anonymous = await listTools(server.url);
    assert.equal(anonymous.status, 401);
    const badToken = await listTools(server.url, { authorization: 'Bearer not-a-token', 'x-tango-api-key': 'bogus' });
    assert.equal(badToken.status, 401);
  } finally {
    await server.close();
  }
});

test('insecure (single-user) mode serves the operator keys tool set', async () => {
  const server = await listen({ mode: 'insecure' });
  try {
    const res = await listTools(server.url);
    assert.equal(res.status, 200);
    const body: any = await rpcMessage(res);
    const names = body.result.tools.map((tool: any) => tool.name);
    assert.ok(names.includes('search_tango_contracts'));
    assert.ok(names.includes('search_sam_entities') || names.some((n: string) => n.includes('sam')));
  } finally {
    await server.close();
  }
});

// ---- Authenticated end-to-end: which key reaches the upstream ---------------------------------

const BASE = new URL('https://capture.example.test');
const SECRET = 'test-secret';

async function tokenFor(keys: Record<string, string>): Promise<string> {
  const provider = new McpOAuthProvider({ baseUrl: BASE, tokenSecret: SECRET });
  const client: any = provider.clientsStore.registerClient({
    redirect_uris: ['https://client.example.test/callback'],
    token_endpoint_auth_method: 'client_secret_post',
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    scope: 'mcp:tools',
  } as any);
  const redirects: string[] = [];
  const res: any = { redirect: (a: number | string, b?: string) => redirects.push(typeof a === 'number' ? String(b) : a) };
  await provider.authorize(
    client,
    {
      state: 's',
      scopes: ['mcp:tools'],
      codeChallenge: 'c',
      redirectUri: 'https://client.example.test/callback',
      resource: new URL('/mcp', BASE),
    },
    res,
  );
  const requestId = new URL(redirects[0]!).searchParams.get('request_id')!;
  const code = new URL(await provider.completeAuthorization(requestId, keys)).searchParams.get('code')!;
  const tokens = await provider.exchangeAuthorizationCode(client, code, undefined, 'https://client.example.test/callback', new URL('/mcp', BASE));
  return tokens.access_token;
}

function callTool(url: string, token: string, name: string, args: Record<string, unknown>, extra: Record<string, string> = {}) {
  return fetch(`${url}/mcp`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      authorization: `Bearer ${token}`,
      ...extra,
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  }).then(rpcMessage);
}

test('oauth mode: tools use the caller\'s sealed key, never the operator env key', async () => {
  const server = await listen({ mode: 'oauth', publicBaseUrl: BASE, tokenSecret: SECRET });
  const originalTango = ApiClient.tangoGet;
  const seen: string[] = [];
  (ApiClient as any).tangoGet = async (_e: string, _p: any, apiKey: string) => {
    seen.push(apiKey);
    return { success: true, data: { count: 0, next: null, results: [] } };
  };
  try {
    const alice = await tokenFor({ tango: 'alice-tango' });
    const bob = await tokenFor({ tango: 'bob-tango' });
    // Concurrent callers with different keys each reach the upstream with their own key.
    const results = await Promise.all([
      callTool(server.url, alice, 'search_tango_contracts', { agency: '3600' }),
      callTool(server.url, bob, 'search_tango_contracts', { agency: '3600' }),
      callTool(server.url, alice, 'search_tango_contracts', { agency: '2100' }),
    ]);
    for (const r of results) assert.equal(r.result.isError, undefined, JSON.stringify(r));
    assert.deepEqual([...seen].sort(), ['alice-tango', 'alice-tango', 'bob-tango']);
    assert.ok(!seen.includes('operator-tango'));
  } finally {
    (ApiClient as any).tangoGet = originalTango;
    await server.close();
  }
});

test('oauth mode: a caller without a provider key cannot reach that provider, even with operator keys set', async () => {
  const server = await listen({ mode: 'oauth', publicBaseUrl: BASE, tokenSecret: SECRET });
  try {
    const hgOnly = await tokenFor({ highergov: 'caller-hg' });
    const out = await callTool(server.url, hgOnly, 'search_tango_contracts', { agency: '3600' });
    // Not registered for this caller: the SDK reports an unknown tool.
    assert.ok(out.error || out.result?.isError, JSON.stringify(out));
  } finally {
    await server.close();
  }
});

test('oauth mode: a caller header adds their own key and join tools get the SAM key', async () => {
  const server = await listen({ mode: 'oauth', publicBaseUrl: BASE, tokenSecret: SECRET });
  const originalSam = ApiClient.samGet;
  const originalSpend = ApiClient.usaspendingPost;
  const samKeys: string[] = [];
  (ApiClient as any).samGet = async (_e: string, params: any) => {
    samKeys.push(params.api_key);
    return { success: true, data: { entityData: [] } };
  };
  (ApiClient as any).usaspendingPost = async () => ({ success: true, data: { results: [] } });
  try {
    const token = await tokenFor({ highergov: 'caller-hg' });
    await callTool(server.url, token, 'get_entity_and_awards', { uei: 'ABCDEFGHIJK1' }, { 'x-sam-api-key': 'caller-sam' });
    assert.deepEqual(samKeys, ['caller-sam']);
  } finally {
    (ApiClient as any).samGet = originalSam;
    (ApiClient as any).usaspendingPost = originalSpend;
    await server.close();
  }
});

test('listenHost: single-user HTTP refuses non-loopback addresses', () => {
  assert.equal(listenHost({ mode: 'insecure' }, {}), '127.0.0.1');
  assert.equal(listenHost({ mode: 'insecure' }, { HOST: '::1' }), '::1');
  assert.throws(() => listenHost({ mode: 'insecure' }, { HOST: '0.0.0.0' }), /loopback only/);
  assert.equal(listenHost({ mode: 'oauth', publicBaseUrl: BASE, tokenSecret: SECRET }, {}), undefined);
});
