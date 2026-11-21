import test from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import type express from 'express';
import { ApiClient } from './utils/api-client.js';

// Operator keys in the function's environment must never reach a caller.
process.env.SAM_GOV_API_KEY = 'operator-sam';
process.env.TANGO_API_KEY = 'operator-tango';
delete process.env.API_KEY_BUCKET;
const { createApp } = await import('./lambda-handler.js');

async function serve(app: express.Application): Promise<{ url: string; close(): Promise<void> }> {
  const server: Server = await new Promise(resolve => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}`, close: () => new Promise(r => server.close(() => r())) };
}

function post(url: string, body: unknown, headers: Record<string, string> = {}) {
  return fetch(`${url}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers },
    body: JSON.stringify(body),
  });
}

test('lambda app refuses MCP requests when no authenticator is configured', async () => {
  const server = await serve(createApp());
  try {
    const res = await post(server.url, { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} });
    assert.equal(res.status, 503);
    const health: any = await (await fetch(`${server.url}/health`)).json();
    assert.equal(health.authMode, 'unconfigured');
  } finally {
    await server.close();
  }
});

test('lambda app: authenticated callers use only their own header keys', async () => {
  const authenticate: express.RequestHandler = (req, res, next) =>
    req.get('x-api-key') === 'issued-key' ? next() : void res.status(401).json({ error: 'unauthorized' });
  const server = await serve(createApp({ authenticate }));
  const original = ApiClient.tangoGet;
  const seen: string[] = [];
  (ApiClient as any).tangoGet = async (_e: string, _p: any, apiKey: string) => {
    seen.push(apiKey);
    return { success: true, data: { count: 0, next: null, results: [] } };
  };
  try {
    const unauthenticated = await post(server.url, { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }, { 'x-tango-api-key': 'x' });
    assert.equal(unauthenticated.status, 401);

    const list: any = await (
      await post(server.url, { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }, { 'x-api-key': 'issued-key' })
    ).json();
    const names = list.result.tools.map((t: any) => t.name);
    assert.ok(!names.includes('search_tango_contracts'), 'operator env keys must not enable tools');

    const call: any = await (
      await post(
        server.url,
        { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'search_tango_contracts', arguments: { agency: '3600' } } },
        { 'x-api-key': 'issued-key', 'x-tango-api-key': 'caller-tango' },
      )
    ).json();
    assert.equal(call.result.isError, undefined, JSON.stringify(call));
    assert.deepEqual(seen, ['caller-tango']);
  } finally {
    (ApiClient as any).tangoGet = original;
    await server.close();
  }
});
