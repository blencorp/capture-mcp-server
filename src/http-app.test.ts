import test from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import type { Server as HttpServer } from 'node:http';

import { createHttpApp, httpAuthFromEnv, type HttpAuth } from './http-app.js';
import { resolveRequestKeys } from './auth/request-keys.js';

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
  assert.equal(httpAuthFromEnv({ MCP_REQUIRE_OAUTH: 'true', OAUTH_TOKEN_SECRET: 's' }, 3000).mode, 'oauth');
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
