// Characterization of the wire behaviour a client sees, written against the SDK v1 server and kept
// passing through the SDK v2 port except where docs/migration-4.0.md lists a difference (tests of
// those carry a `D<n>` tag). It speaks plain HTTP and JSON-RPC, so it does not depend on the SDK.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import type { AddressInfo } from 'node:net';
import type { Server as HttpServer } from 'node:http';

import { createHttpApp, type HttpAuth } from './http-app.js';
import { PAYLOAD, sealToken } from './auth/__fixtures__/sealed-token.js';
import { rpcMessage } from './__fixtures__/rpc-message.js';
import { ApiClient } from './utils/api-client.js';
import { SERVER_VERSION } from './version.js';

const ENV = { SAM_GOV_API_KEY: 'sam', TANGO_API_KEY: 'tango', HIGHERGOV_API_KEY: 'highergov' } as NodeJS.ProcessEnv;
const BASE = new URL('https://capture.example.test');

async function listen(auth: HttpAuth): Promise<{ url: string; close(): Promise<void> }> {
  const app = createHttpApp({ auth, env: ENV });
  const server: HttpServer = await new Promise(resolve => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}`, close: () => new Promise(resolve => server.close(() => resolve())) };
}

const rpc = (url: string, method: string, params: unknown, headers: Record<string, string> = {}) =>
  fetch(`${url}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });

const call = async (url: string, name: string, args: unknown): Promise<any> => (await rpcMessage(await rpc(url, 'tools/call', { name, arguments: args }))).result;

const form = (fields: Record<string, string>) => ({
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams(fields),
});

/** Runs `body` against a single-user server with all three provider keys. */
async function withServer(auth: HttpAuth, body: (url: string) => Promise<void>): Promise<void> {
  const server = await listen(auth);
  try {
    await body(server.url);
  } finally {
    await server.close();
  }
}

const insecure = (body: (url: string) => Promise<void>) => withServer({ mode: 'insecure' }, body);
const oauth = (body: (url: string) => Promise<void>) => withServer({ mode: 'oauth', publicBaseUrl: BASE, tokenSecret: 'characterization-secret' }, body);

// ---- tools/list ---------------------------------------------------------------------------------

const listedTools = async (url: string): Promise<Array<Record<string, unknown>>> => (await rpcMessage(await rpc(url, 'tools/list', {}))).result.tools;

test('tools/list: every tool keeps its name, description and input schema', async () => {
  await insecure(async url => {
    const pinned = (await listedTools(url)).map(({ name, description, inputSchema }) => ({ name, description, inputSchema }));
    const expected = JSON.parse(readFileSync(new URL('./__fixtures__/tool-list.json', import.meta.url), 'utf8'));
    assert.deepEqual(pinned, expected);
  });
});

test('tools/list: with no provider keys only the reference and USASpending tools are listed', async () => {
  const app = createHttpApp({ auth: { mode: 'insecure' }, env: {} as NodeJS.ProcessEnv });
  const server: HttpServer = await new Promise(resolve => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  try {
    const names = (await listedTools(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)).map(tool => tool.name);
    assert.deepEqual(names, [
      'lookup_reference_code',
      'get_usaspending_awards',
      'get_usaspending_spending_by_category',
      'get_usaspending_budgetary_resources',
      'search_usaspending_awards_by_recipient',
      'get_award_detail',
      'aggregate_contracts',
    ]);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});

// ---- tools/call ---------------------------------------------------------------------------------

test('tools/call success: text is the pretty-printed structured result', async () => {
  await insecure(async url => {
    const result = await call(url, 'lookup_reference_code', { domain: 'set_aside', code: '8AN' });
    assert.deepEqual(result.structuredContent, { domain: 'set_aside', code: '8AN', description: '8(a) Sole Source (FAR 19.8)' });
    assert.equal(result.content.length, 1);
    assert.equal(result.content[0].type, 'text');
    assert.deepEqual(JSON.parse(result.content[0].text), result.structuredContent);
  });
});

test('tools/call D2: a tool-level failure is an {error} envelope marked isError', async () => {
  await insecure(async url => {
    const result = await call(url, 'lookup_reference_code', { domain: 'nope' });
    assert.equal(result.structuredContent.error.code, 'bad_request');
    assert.match(result.structuredContent.error.message, /Unknown domain "nope"/);
    assert.deepEqual(JSON.parse(result.content[0].text), result.structuredContent);
    assert.equal(result.isError, true);
  });
});

test('tools/call: unknown, missing and mistyped arguments are rejected with a bad_request that says why', async () => {
  await insecure(async url => {
    const unknown = await call(url, 'lookup_reference_code', { domain: 'set_aside', extra: 1 });
    assert.match(unknown.structuredContent.error.message, /Unknown parameter\(s\) for lookup_reference_code: extra\. Accepted parameters: domain, code\./);
    const missing = await call(url, 'lookup_reference_code', {});
    assert.equal(missing.structuredContent.error.message, 'Missing required parameter(s) for lookup_reference_code: domain');
    const mistyped = await call(url, 'lookup_reference_code', { domain: 5 });
    assert.equal(mistyped.structuredContent.error.message, 'Parameter "domain" of lookup_reference_code must be a string');
    for (const result of [unknown, missing, mistyped]) {
      assert.equal(result.structuredContent.error.code, 'bad_request');
      assert.equal(result.isError, true); // D2
    }
  });
});

test('tools/call D1: an unknown tool is a JSON-RPC invalid-params error', async () => {
  await insecure(async url => {
    const { result, error } = await rpcMessage(await rpc(url, 'tools/call', { name: 'no_such_tool', arguments: {} }));
    assert.equal(result, undefined);
    assert.deepEqual(error, { code: -32602, message: 'Tool no_such_tool not found' });
  });
});

test('tools/call D2: an upstream error and a thrown one are both {error: <message>} marked isError', async () => {
  const original = ApiClient.tangoGet;
  await insecure(async url => {
    (ApiClient as any).tangoGet = async () => ({ success: false, data: null, error: 'Tango API error: 500' });
    const failed = await call(url, 'search_tango_contracts', { agency: '3600' });
    assert.deepEqual(failed.structuredContent, { error: 'Tango API error: 500' });
    assert.equal(failed.isError, true);

    (ApiClient as any).tangoGet = async () => {
      throw new Error('boom');
    };
    const thrown = await call(url, 'search_tango_contracts', { agency: '3600' });
    assert.deepEqual(thrown.structuredContent, { error: 'boom' });
    assert.equal(thrown.isError, true);
  }).finally(() => {
    (ApiClient as any).tangoGet = original;
  });
});

// ---- /mcp access --------------------------------------------------------------------------------

test('/mcp: no token and a bad token get a 401 with the OAuth challenge', async () => {
  await oauth(async url => {
    const resource = 'resource_metadata="https://capture.example.test/.well-known/oauth-protected-resource/mcp"';
    const missing = await rpc(url, 'tools/list', {});
    assert.equal(missing.status, 401);
    assert.equal(missing.headers.get('www-authenticate'), `Bearer error="invalid_token", error_description="Missing Authorization header", scope="mcp:tools", ${resource}`);
    assert.deepEqual(await missing.json(), { error: 'invalid_token', error_description: 'Missing Authorization header' });

    const bad = await rpc(url, 'tools/list', {}, { authorization: 'Bearer nope' });
    assert.equal(bad.status, 401);
    assert.equal(bad.headers.get('www-authenticate'), `Bearer error="invalid_token", error_description="Invalid access token", scope="mcp:tools", ${resource}`);
    assert.deepEqual(await bad.json(), { error: 'invalid_token', error_description: 'Invalid access token' });
  });
});

test('/mcp: GET and DELETE are 405 with a JSON-RPC error body', async () => {
  await insecure(async url => {
    for (const method of ['GET', 'DELETE']) {
      const res = await fetch(`${url}/mcp`, { method });
      assert.equal(res.status, 405);
      assert.deepEqual(await res.json(), {
        jsonrpc: '2.0',
        error: { code: -32601, message: 'Method not allowed. Use POST for MCP requests.' },
        id: null,
      });
    }
  });
});

// ---- OAuth endpoints ----------------------------------------------------------------------------

test('OAuth discovery: authorization server and protected resource metadata', async () => {
  await oauth(async url => {
    const server = await fetch(`${url}/.well-known/oauth-authorization-server`);
    assert.equal(server.status, 200);
    assert.equal(server.headers.get('access-control-allow-origin'), '*');
    assert.deepEqual(await server.json(), {
      issuer: 'https://capture.example.test/',
      authorization_endpoint: 'https://capture.example.test/authorize',
      response_types_supported: ['code'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint: 'https://capture.example.test/token',
      token_endpoint_auth_methods_supported: ['client_secret_post', 'none'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      scopes_supported: ['mcp:tools'],
      revocation_endpoint: 'https://capture.example.test/revoke',
      revocation_endpoint_auth_methods_supported: ['client_secret_post'],
      registration_endpoint: 'https://capture.example.test/register',
    });

    const resource = await fetch(`${url}/.well-known/oauth-protected-resource/mcp`);
    assert.equal(resource.status, 200);
    assert.equal(resource.headers.get('access-control-allow-origin'), '*');
    assert.deepEqual(await resource.json(), {
      resource: 'https://capture.example.test/mcp',
      authorization_servers: ['https://capture.example.test/'],
      scopes_supported: ['mcp:tools'],
      resource_name: 'GovCon Capture',
    });
  });
});

test('OAuth registration: a valid request is sealed into the client id; unsafe redirect URIs are refused', async () => {
  await oauth(async url => {
    const ok = await fetch(`${url}/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ redirect_uris: ['https://c.test/cb'], token_endpoint_auth_method: 'none', client_name: 'c' }),
    });
    assert.equal(ok.status, 201);
    assert.equal(ok.headers.get('cache-control'), 'no-store');
    assert.equal(ok.headers.get('access-control-allow-origin'), '*');
    const client: any = await ok.json();
    assert.match(client.client_id, /^capcli\.v1\./);
    const { client_id: _id, client_id_issued_at: _issued, ...metadata } = client;
    assert.equal(typeof client.client_id_issued_at, 'number');
    assert.deepEqual(metadata, {
      redirect_uris: ['https://c.test/cb'],
      token_endpoint_auth_method: 'none',
      client_name: 'c',
      scope: 'mcp:tools',
    });

    const unsafe = await fetch(`${url}/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ redirect_uris: [`${'java'}script:alert(1)`] }),
    });
    assert.equal(unsafe.status, 400);
    assert.equal(((await unsafe.json()) as any).error, 'invalid_client_metadata');
  });
});

test('OAuth errors: token, authorize and revoke answer with RFC 6749 error bodies', async () => {
  await oauth(async url => {
    const getToken = await fetch(`${url}/token`);
    assert.equal(getToken.status, 405);
    assert.equal(getToken.headers.get('allow'), 'POST');
    assert.deepEqual(await getToken.json(), { error: 'method_not_allowed', error_description: 'The method GET is not allowed for this endpoint' });

    const token = await fetch(`${url}/token`, form({ grant_type: 'authorization_code', client_id: 'nope' }));
    assert.equal(token.status, 400);
    assert.deepEqual(await token.json(), { error: 'invalid_client', error_description: 'Invalid client_id' });

    const authorize = await fetch(`${url}/authorize?client_id=nope`, { redirect: 'manual' });
    assert.equal(authorize.status, 400);
    assert.equal(authorize.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await authorize.json(), { error: 'invalid_client', error_description: 'Invalid client_id' });

    const missing = await fetch(`${url}/authorize`, { redirect: 'manual' });
    assert.equal(missing.status, 400);
    assert.equal(((await missing.json()) as any).error, 'invalid_request');

    const revoke = await fetch(`${url}/revoke`, form({ token: 'a', client_id: 'nope' }));
    assert.equal(revoke.status, 400);
    assert.deepEqual(await revoke.json(), { error: 'invalid_client', error_description: 'Invalid client_id' });
  });
});

test('OAuth: the token endpoint answers browser preflights for any origin', async () => {
  await oauth(async url => {
    const res = await fetch(`${url}/token`, { method: 'OPTIONS', headers: { origin: 'https://app.example.test', 'access-control-request-method': 'POST' } });
    assert.equal(res.status, 204);
    assert.equal(res.headers.get('access-control-allow-origin'), '*');
  });
});

// ---- Handshake: clients that do not send an MCP-Protocol-Version header ------------------------------

test('handshake: initialize, initialized, ping and an unknown method on a bare POST', async () => {
  await insecure(async url => {
    const init = await rpc(url, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'characterization', version: '1' } });
    assert.equal(init.status, 200);
    // D3: the SDK's stateless leg answers with one SSE `message` event where v1 answered with JSON.
    assert.match(init.headers.get('content-type') ?? '', /^text\/event-stream/);
    assert.deepEqual(await rpcMessage(init), {
      result: { protocolVersion: '2025-06-18', capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'Capture MCP Server', version: SERVER_VERSION } },
      jsonrpc: '2.0',
      id: 1,
    });

    const initialized = await fetch(`${url}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
    });
    assert.equal(initialized.status, 202);

    assert.deepEqual(await rpcMessage(await rpc(url, 'ping', {})), { result: {}, jsonrpc: '2.0', id: 1 });
    assert.deepEqual(await rpcMessage(await rpc(url, 'no/such/method', {})), { jsonrpc: '2.0', id: 1, error: { code: -32601, message: 'Method not found' } });
  });
});

// ---- stdio ----------------------------------------------------------------------------------------

test('stdio: initialize, tools/list and a tool call over the entry point', async () => {
  const child = spawn(process.execPath, ['--import', 'tsx', 'src/server.ts'], {
    env: { ...process.env, MCP_TRANSPORT: 'stdio', SAM_GOV_API_KEY: '', TANGO_API_KEY: '', HIGHERGOV_API_KEY: '' },
    stdio: ['pipe', 'pipe', 'ignore'],
  });
  const lines = createInterface({ input: child.stdout })[Symbol.asyncIterator]();
  const send = async (message: Record<string, unknown>): Promise<any> => {
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`);
    if (message.id === undefined) return undefined;
    return JSON.parse((await lines.next()).value as string);
  };
  try {
    const init = await send({ id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'characterization', version: '1' } } });
    assert.equal(init.result.serverInfo.name, 'Capture MCP Server');
    assert.deepEqual(init.result.capabilities, { tools: { listChanged: false } });
    await send({ method: 'notifications/initialized' });
    const listed = await send({ id: 2, method: 'tools/list', params: {} });
    assert.equal(listed.result.tools[0].name, 'lookup_reference_code');
    const called = await send({ id: 3, method: 'tools/call', params: { name: 'lookup_reference_code', arguments: { domain: 'set_aside', code: '8AN' } } });
    assert.equal(called.result.structuredContent.description, '8(a) Sole Source (FAR 19.8)');
  } finally {
    child.kill();
  }
});

// ---- OAuth bodies the port re-implements ------------------------------------------------------------

const CALLBACK = 'https://client.example.test/callback';

test('OAuth: a full code flow, refresh, and a revocation that answers 200 with an empty object', async () => {
  await oauth(async url => {
    const registered: any = await (
      await fetch(`${url}/register`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ redirect_uris: [CALLBACK], token_endpoint_auth_method: 'client_secret_post', grant_types: ['authorization_code', 'refresh_token'] }),
      })
    ).json();
    const verifier = 'v'.repeat(64);
    const authorize = await fetch(
      `${url}/authorize?${new URLSearchParams({ response_type: 'code', client_id: registered.client_id, redirect_uri: CALLBACK, code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256', state: 's1', scope: 'mcp:tools' })}`,
      { redirect: 'manual' },
    );
    assert.equal(authorize.status, 302);
    assert.equal(authorize.headers.get('cache-control'), 'no-store');
    const requestId = new URL(authorize.headers.get('location')!).searchParams.get('request_id')!;
    const approved = await fetch(`${url}/oauth/authorize`, { ...form({ request_id: requestId, 'enabled[]': 'sam', sam_api_key: 'sam-key' }), redirect: 'manual' });
    assert.equal(approved.status, 302);
    const redirect = new URL(approved.headers.get('location')!);
    assert.equal(redirect.origin + redirect.pathname, CALLBACK);
    assert.equal(redirect.searchParams.get('state'), 's1');

    const credentials = { client_id: registered.client_id, client_secret: registered.client_secret };
    const wrongVerifier = await fetch(`${url}/token`, form({ grant_type: 'authorization_code', code: redirect.searchParams.get('code')!, code_verifier: 'w'.repeat(64), redirect_uri: CALLBACK, ...credentials }));
    assert.equal(wrongVerifier.status, 400);
    assert.deepEqual(await wrongVerifier.json(), { error: 'invalid_grant', error_description: 'code_verifier does not match the challenge' });

    const issued = await fetch(`${url}/token`, form({ grant_type: 'authorization_code', code: redirect.searchParams.get('code')!, code_verifier: verifier, redirect_uri: CALLBACK, ...credentials }));
    assert.equal(issued.status, 200);
    assert.equal(issued.headers.get('cache-control'), 'no-store');
    const tokens: any = await issued.json();
    assert.equal(tokens.token_type, 'bearer');
    assert.equal(tokens.expires_in, 3600);
    assert.equal(tokens.scope, 'mcp:tools');
    assert.match(tokens.access_token, /^capmcp\.v1\./);

    const replay = await fetch(`${url}/token`, form({ grant_type: 'authorization_code', code: redirect.searchParams.get('code')!, code_verifier: verifier, redirect_uri: CALLBACK, ...credentials }));
    assert.equal(replay.status, 400);
    assert.deepEqual(await replay.json(), { error: 'invalid_grant', error_description: 'Invalid authorization code' });

    const listed = await rpc(url, 'tools/list', {}, { authorization: `Bearer ${tokens.access_token}` });
    assert.equal(listed.status, 200);

    const refreshed = await fetch(`${url}/token`, form({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token, ...credentials }));
    assert.equal(refreshed.status, 200);

    const unsupported = await fetch(`${url}/token`, form({ grant_type: 'client_credentials', ...credentials }));
    assert.equal(unsupported.status, 400);
    assert.deepEqual(await unsupported.json(), { error: 'unsupported_grant_type', error_description: 'The grant type is not supported by this authorization server.' });

    const revoked = await fetch(`${url}/revoke`, form({ token: tokens.access_token, ...credentials }));
    assert.equal(revoked.status, 200);
    assert.deepEqual(await revoked.json(), {});
    assert.equal((await rpc(url, 'tools/list', {}, { authorization: `Bearer ${tokens.access_token}` })).status, 401);
  });
});

test('/mcp: a token without the tools scope is a 403 insufficient_scope challenge', async () => {
  const now = Math.floor(Date.now() / 1000);
  await withServer({ mode: 'oauth', publicBaseUrl: BASE, tokenSecret: 'characterization-secret' }, async url => {
    const token = sealToken('characterization-secret', { ...PAYLOAD, scopes: ['other:scope'], iat: now, exp: now + 600 });
    const res = await rpc(url, 'tools/list', {}, { authorization: `Bearer ${token}` });
    assert.equal(res.status, 403);
    assert.equal(
      res.headers.get('www-authenticate'),
      'Bearer error="insufficient_scope", error_description="Insufficient scope", scope="mcp:tools", resource_metadata="https://capture.example.test/.well-known/oauth-protected-resource/mcp"',
    );
    assert.deepEqual(await res.json(), { error: 'insufficient_scope', error_description: 'Insufficient scope' });
  });
});

test('OAuth endpoints: a flooded client gets 429 with a too_many_requests body', async () => {
  await oauth(async url => {
    const register = () =>
      fetch(`${url}/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ redirect_uris: [CALLBACK] }) });
    for (let i = 0; i < 20; i++) assert.equal((await register()).status, 201);
    const limited = await register();
    assert.equal(limited.status, 429);
    assert.deepEqual(await limited.json(), { error: 'too_many_requests', error_description: 'You have exceeded the rate limit for client registration requests' });
  });
});

// ---- Request bodies -----------------------------------------------------------------------------

test('/mcp D4: a malformed, oversized or mistyped body is a JSON-RPC error, not an HTML page', async () => {
  await insecure(async url => {
    const post = (body: string, headers: Record<string, string> = { 'content-type': 'application/json' }) =>
      fetch(`${url}/mcp`, { method: 'POST', headers: { accept: 'application/json, text/event-stream', ...headers }, body });

    const malformed = await post('{nope');
    assert.equal(malformed.status, 400);
    assert.deepEqual(await malformed.json(), { jsonrpc: '2.0', error: { code: -32700, message: 'Parse error: Invalid JSON' }, id: null });

    const oversized = await post(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', padding: 'x'.repeat(1024 * 1024) }));
    assert.equal(oversized.status, 413);
    assert.equal(((await oversized.json()) as any).error.code, -32000);

    const mistyped = await post('{}', { 'content-type': 'text/plain' });
    assert.equal(mistyped.status, 415);
  });
});
