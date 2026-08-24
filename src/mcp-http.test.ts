import test from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import type { Server as HttpServer } from 'node:http';
import express from 'express';
import { createCaptureMcpHandler, type CaptureMcpHandlerOptions } from './mcp-http.js';

const PROTOCOL_VERSION = '2026-07-28';

type Harness = {
  endpoint: string;
  errors: Error[];
  closeHandler(): Promise<void>;
  close(): Promise<void>;
};

async function startHarness(options: CaptureMcpHandlerOptions = {}): Promise<Harness> {
  const app = express();
  app.use(express.json());
  const errors: Error[] = [];
  const handle = createCaptureMcpHandler({
    ...options,
    onerror(error) {
      errors.push(error);
      options.onerror?.(error);
    },
  });
  app.post('/mcp', (req, res) => void handle(req, res));

  const server: HttpServer = await new Promise(resolve => {
    const candidate = app.listen(0, '127.0.0.1', () => resolve(candidate));
  });
  const port = (server.address() as AddressInfo).port;

  return {
    endpoint: `http://127.0.0.1:${port}/mcp`,
    errors,
    closeHandler: () => handle.close(),
    close: async () => {
      await handle.close();
      await new Promise<void>(resolve => {
        server.closeAllConnections();
        server.close(() => resolve());
      });
    },
  };
}

function modernRequest(id: string | number, method: string, params: Record<string, unknown> = {}) {
  return {
    jsonrpc: '2.0',
    id,
    method,
    params: {
      ...params,
      _meta: {
        'io.modelcontextprotocol/protocolVersion': PROTOCOL_VERSION,
        'io.modelcontextprotocol/clientCapabilities': {},
        'io.modelcontextprotocol/clientInfo': { name: 'capture-http-test', version: '1.0.0' },
      },
    },
  };
}

async function post(endpoint: string, body: unknown, headers: Record<string, string> = {}): Promise<Response> {
  return fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

function modernHeaders(method: string, name?: string): Record<string, string> {
  return {
    'MCP-Protocol-Version': PROTOCOL_VERSION,
    'Mcp-Method': method,
    ...(name ? { 'Mcp-Name': name } : {}),
  };
}

test('modern tools/list is stateless and isolates concurrent request header keys', async () => {
  const h = await startHarness();
  try {
    const [samResponse, tangoResponse, publicResponse] = await Promise.all([
      post(h.endpoint, modernRequest('sam', 'tools/list'), {
        ...modernHeaders('tools/list'),
        'X-Sam-Api-Key': 'sam-request-key',
      }),
      post(h.endpoint, modernRequest('tango', 'tools/list'), {
        ...modernHeaders('tools/list'),
        'X-Tango-Api-Key': 'tango-request-key',
      }),
      post(h.endpoint, modernRequest('public', 'tools/list'), modernHeaders('tools/list')),
    ]);

    for (const response of [samResponse, tangoResponse, publicResponse]) {
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('mcp-session-id'), null);
      assert.match(response.headers.get('content-type') ?? '', /^application\/json/);
    }

    const sam = await samResponse.json() as any;
    const tango = await tangoResponse.json() as any;
    const publicOnly = await publicResponse.json() as any;
    const names = (value: any) => new Set(value.result.tools.map((tool: any) => tool.name));

    assert.ok(names(sam).has('search_sam_entities'));
    assert.ok(!names(sam).has('search_tango_contracts'));
    assert.ok(names(tango).has('search_tango_contracts'));
    assert.ok(!names(tango).has('search_sam_entities'));
    assert.ok(!names(publicOnly).has('search_sam_entities'));
    assert.ok(!names(publicOnly).has('search_tango_contracts'));
    assert.equal(sam.result.resultType, 'complete');
    assert.equal(typeof sam.result.ttlMs, 'number');
    assert.equal(typeof sam.result.cacheScope, 'string');
    assert.equal(sam.result._meta['io.modelcontextprotocol/serverInfo'].name, 'Capture MCP Server');
  } finally {
    await h.close();
  }
});

test('modern server/discover reports per-request capabilities and stamped server identity', async () => {
  const h = await startHarness();
  try {
    const response = await post(
      h.endpoint,
      modernRequest('discover', 'server/discover'),
      modernHeaders('server/discover'),
    );
    assert.equal(response.status, 200);
    const payload = await response.json() as any;
    assert.ok(payload.result.capabilities.tools);
    assert.equal(payload.result.serverInfo, undefined, 'final spec carries identity in result _meta');
    assert.equal(
      payload.result._meta['io.modelcontextprotocol/serverInfo'].name,
      'Capture MCP Server',
    );
  } finally {
    await h.close();
  }
});

test('modern request headers are enforced, including Mcp-Name on tools/call', async () => {
  const h = await startHarness();
  try {
    const missingMethod = await post(h.endpoint, modernRequest(1, 'tools/list'), {
      'MCP-Protocol-Version': PROTOCOL_VERSION,
    });
    assert.equal(missingMethod.status, 400);

    const wrongName = await post(
      h.endpoint,
      modernRequest(2, 'tools/call', {
        name: 'lookup_reference_code',
        arguments: { domain: 'set_aside', code: '8AN' },
      }),
      modernHeaders('tools/call', 'wrong_tool'),
    );
    assert.equal(wrongName.status, 400);

    const call = await post(
      h.endpoint,
      modernRequest(3, 'tools/call', {
        name: 'lookup_reference_code',
        arguments: { domain: 'set_aside', code: '8AN' },
      }),
      modernHeaders('tools/call', 'lookup_reference_code'),
    );
    assert.equal(call.status, 200);
    const payload = await call.json() as any;
    assert.equal(payload.result.isError, undefined);
    assert.equal(payload.result.structuredContent.code, '8AN');
  } finally {
    await h.close();
  }
});

test('legacy initialize remains a stateless JSON compatibility path', async () => {
  const h = await startHarness();
  try {
    const response = await post(h.endpoint, {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'legacy-http-test', version: '1.0.0' },
      },
    }, { accept: 'application/json, text/event-stream' });

    assert.equal(response.status, 200);
    assert.equal(response.headers.get('mcp-session-id'), null);
    assert.match(response.headers.get('content-type') ?? '', /^application\/json/);
    const payload = await response.json() as any;
    assert.equal(payload.result.protocolVersion, '2025-06-18');
    assert.equal(payload.result.serverInfo.name, 'Capture MCP Server');
  } finally {
    await h.close();
  }
});

test('legacy tools/list remains usable after stateless initialization', async () => {
  const h = await startHarness();
  try {
    const response = await post(h.endpoint, {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list',
      params: {},
    }, {
      accept: 'application/json, text/event-stream',
      'MCP-Protocol-Version': '2025-06-18',
      'X-Sam-Api-Key': 'legacy-sam-request-key',
    });

    assert.equal(response.status, 200);
    assert.equal(response.headers.get('mcp-session-id'), null);
    assert.match(response.headers.get('content-type') ?? '', /^application\/json/);
    const payload = await response.json() as any;
    const names = new Set(payload.result.tools.map((tool: any) => tool.name));
    assert.ok(names.has('search_sam_entities'));
    assert.ok(!names.has('search_tango_contracts'));
  } finally {
    await h.close();
  }
});

test('request/response-only hosts reject subscriptions/listen without opening SSE', async () => {
  const h = await startHarness({ maxSubscriptions: 0 });
  try {
    const response = await post(
      h.endpoint,
      modernRequest(9, 'subscriptions/listen', { notifications: { toolsListChanged: true } }),
      modernHeaders('subscriptions/listen'),
    );
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') ?? '', /^application\/json/);
    const payload = await response.json() as any;
    assert.equal(payload.error.code, -32603);
    assert.equal(payload.error.message, 'Subscription limit reached');
  } finally {
    await h.close();
  }
});

test('streaming hosts close active subscriptions gracefully during shutdown', async () => {
  const h = await startHarness();
  try {
    const response = await post(
      h.endpoint,
      modernRequest(10, 'subscriptions/listen', { notifications: { toolsListChanged: true } }),
      modernHeaders('subscriptions/listen'),
    );
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') ?? '', /^text\/event-stream/);
    assert.ok(response.body);
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    const first = await reader.read();
    assert.match(decoder.decode(first.value), /notifications\/subscriptions\/acknowledged/);

    await h.closeHandler();
    let tail = '';
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      tail += decoder.decode(chunk.value, { stream: true });
    }
    assert.match(tail, /"resultType":"complete"/);
  } finally {
    await h.close();
  }
});

test('non-JSON content is rejected before protocol classification', async () => {
  const h = await startHarness();
  try {
    const response = await fetch(h.endpoint, {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: '{}',
    });
    assert.equal(response.status, 415);
    const payload = await response.json() as any;
    assert.equal(payload.error.code, -32600);
  } finally {
    await h.close();
  }
});
