import test from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';

test('lambda app refuses MCP requests when API_KEY_BUCKET is not configured', async () => {
  delete process.env.API_KEY_BUCKET;
  process.env.SAM_GOV_API_KEY = 'operator-sam';
  const { app } = await import('./lambda-handler.js');
  const server = await new Promise<import('node:http').Server>(resolve => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  try {
    const { port } = server.address() as AddressInfo;
    const res = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
    });
    assert.equal(res.status, 503);
    const health: any = await (await fetch(`http://127.0.0.1:${port}/health`)).json();
    assert.equal(health.authMode, 'unconfigured');
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    delete process.env.SAM_GOV_API_KEY;
  }
});
