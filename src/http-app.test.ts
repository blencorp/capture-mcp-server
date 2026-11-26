import test from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import type { Server as HttpServer } from 'node:http';

import { createHttpApp, httpAuthFromEnv, listenHost, type HttpAuth } from './http-app.js';
import { McpOAuthProvider } from './auth/mcp-oauth.js';
import { resolveRequestKeys } from './auth/request-keys.js';
import { ApiClient } from './utils/api-client.js';
import { PAYLOAD, sealToken } from './auth/__fixtures__/sealed-token.js';

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
    const body: any = await res.json();
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
  const client: any = {
    client_id: 'test-client',
    client_secret: 'secret',
    client_id_issued_at: 1,
    client_secret_expires_at: 0,
    redirect_uris: ['https://client.example.test/callback'],
    token_endpoint_auth_method: 'client_secret_post',
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    scope: 'mcp:tools',
  };
  await provider.clientsStore.registerClient?.(client);
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
  }).then(r => r.json() as Promise<any>);
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
