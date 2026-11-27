// Drives the server with the official MCP client SDK rather than hand-built requests. The client
// builds the 2026-07-28 request envelope and its routing headers itself, validates `structuredContent`
// against each tool's `outputSchema`, and negotiates the protocol revision, so this catches mistakes
// a hand-written request would encode the same way on both sides.
import test from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { request as httpRequest, type Server as HttpServer } from 'node:http';
import { Client, StreamableHTTPClientTransport, type VersionNegotiationOptions } from '@modelcontextprotocol/client';

import { PAYLOAD, sealToken } from './auth/__fixtures__/sealed-token.js';
import { createHttpApp, type HttpAuth } from './http-app.js';
import { MCP_PROTOCOL_VERSION } from './mcp-server.js';
import { ApiClient } from './utils/api-client.js';
import { requestSignal } from './utils/request-signal.js';

const ENV = { SAM_GOV_API_KEY: 'sam', TANGO_API_KEY: 'tango', HIGHERGOV_API_KEY: 'highergov' } as NodeJS.ProcessEnv;
const SECRET = 'official-client-secret';
const BASE = new URL('https://capture.example.test');

async function serve(auth: HttpAuth): Promise<{ url: URL; close(): Promise<void> }> {
  const server: HttpServer = await new Promise(resolve => {
    const s = createHttpApp({ auth, env: ENV }).listen(0, '127.0.0.1', () => resolve(s));
  });
  return { url: new URL(`http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`), close: () => new Promise(resolve => {
      server.close(() => resolve());
      server.closeAllConnections(); // a client that gave up leaves its connection open
    }),
  };
}

async function connect(url: URL, versionNegotiation: VersionNegotiationOptions, headers: Record<string, string> = {}): Promise<Client> {
  const client = new Client({ name: 'capture-conformance-probe', version: '1.0.0' }, { versionNegotiation });
  await client.connect(new StreamableHTTPClientTransport(url, { requestInit: { headers } }));
  return client;
}

const NEGOTIATIONS: Array<[string, VersionNegotiationOptions]> = [
  ['auto (2026-07-28)', { mode: 'auto' }],
  ['pinned to 2026-07-28', { mode: { pin: MCP_PROTOCOL_VERSION } }],
  ['legacy (initialize handshake)', { mode: 'legacy' }],
];

/** Stubs the Tango upstream with `reply`, for the duration of `body`. */
async function withTango<T>(reply: () => Promise<unknown>, body: () => Promise<T>): Promise<T> {
  const original = ApiClient.tangoGet;
  (ApiClient as any).tangoGet = reply;
  try {
    return await body();
  } finally {
    (ApiClient as any).tangoGet = original;
  }
}

for (const [label, negotiation] of NEGOTIATIONS) {
  test(`official client, ${label}: every tool declares a title, annotations and an object outputSchema`, async () => {
    const server = await serve({ mode: 'insecure' });
    const client = await connect(server.url, negotiation);
    try {
      const { tools } = await client.listTools();
      assert.equal(tools.length, 34);
      for (const tool of tools) {
        assert.ok(tool.title, tool.name);
        assert.deepEqual(tool.annotations, {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: tool.name !== 'lookup_reference_code',
        });
        assert.equal(tool.inputSchema.type, 'object', tool.name);
        assert.equal(tool.outputSchema?.type, 'object', tool.name);
        assert.ok(!('api_key' in (tool.inputSchema.properties ?? {})), `${tool.name} advertises api_key`);
      }
    } finally {
      await client.close();
      await server.close();
    }
  });

  test(`official client, ${label}: a success carries structuredContent the client validates against the outputSchema`, async () => {
    const server = await serve({ mode: 'insecure' });
    const client = await connect(server.url, negotiation);
    try {
      const reference = await client.callTool({ name: 'lookup_reference_code', arguments: { domain: 'set_aside', code: '8AN' } });
      assert.equal(reference.isError, undefined);
      assert.deepEqual(reference.structuredContent, { domain: 'set_aside', code: '8AN', description: '8(a) Sole Source (FAR 19.8)' });
      assert.deepEqual(JSON.parse((reference.content as Array<{ text: string }>)[0]!.text), reference.structuredContent);

      // A list tool, whose outputSchema requires the whole envelope: the client checks it.
      const listed = await withTango(
        async () => ({ success: true, data: { count: 1, next: null, results: [{ key: 'C1', piid: 'P-1' }] } }),
        () => client.callTool({ name: 'search_tango_contracts', arguments: { agency: '3600' } }),
      );
      assert.equal(listed.isError, undefined, JSON.stringify(listed));
      const structured = listed.structuredContent as Record<string, unknown>;
      assert.equal(typeof structured.count_unit, 'string');
      assert.equal(structured.next_cursor, null);
      assert.ok(Array.isArray(structured.contracts));
    } finally {
      await client.close();
      await server.close();
    }
  });

  test(`official client, ${label}: failures are isError results with the error in structuredContent, not protocol errors`, async () => {
    const server = await serve({ mode: 'insecure' });
    const client = await connect(server.url, negotiation);
    try {
      const badRequest = await client.callTool({ name: 'lookup_reference_code', arguments: { domain: 'nope' } });
      assert.equal(badRequest.isError, true);
      assert.equal((badRequest.structuredContent as any).error.code, 'bad_request');

      const unknownParameter = await client.callTool({ name: 'lookup_reference_code', arguments: { domain: 'set_aside', extra: 1 } });
      assert.equal(unknownParameter.isError, true);
      assert.match((unknownParameter.structuredContent as any).error.message, /Unknown parameter\(s\)/);

      const upstream = await withTango(
        async () => ({ success: false, data: null, error: 'API Error 503: unavailable' }),
        () => client.callTool({ name: 'search_tango_contracts', arguments: { agency: '3600' } }),
      );
      assert.equal(upstream.isError, true);
      assert.deepEqual(upstream.structuredContent, { error: 'API Error 503: unavailable' });
      assert.match((upstream.content as Array<{ text: string }>)[0]!.text, /API Error 503/);

      const thrown = await withTango(
        async () => {
          throw new Error('boom');
        },
        () => client.callTool({ name: 'search_tango_contracts', arguments: { agency: '3600' } }),
      );
      assert.equal(thrown.isError, true);
      assert.deepEqual(thrown.structuredContent, { error: 'boom' });
    } finally {
      await client.close();
      await server.close();
    }
  });

  test(`official client, ${label}: a bearer token reaches the tools, and its sealed key reaches the upstream`, async () => {
    const server = await serve({ mode: 'oauth', publicBaseUrl: BASE, tokenSecret: SECRET });
    const now = Math.floor(Date.now() / 1000);
    const token = sealToken(SECRET, { ...PAYLOAD, keys: { tango: 'sealed-tango' }, iat: now, exp: now + 600 });
    const client = await connect(server.url, negotiation, { authorization: `Bearer ${token}` });
    try {
      const names = (await client.listTools()).tools.map(tool => tool.name);
      assert.ok(names.includes('search_tango_contracts'));
      assert.ok(!names.includes('search_sam_entities'), 'a key the token does not hold unlocks nothing');

      const seen: unknown[] = [];
      await withTango(
        async (..._args: unknown[]) => {
          seen.push(_args[2]);
          return { success: true, data: { count: 0, next: null, results: [] } };
        },
        () => client.callTool({ name: 'search_tango_contracts', arguments: { agency: '3600' } }),
      );
      assert.deepEqual(seen, ['sealed-tango']);
    } finally {
      await client.close();
      await server.close();
    }
  });
}

test('official client: without a bearer token the connection is refused', async () => {
  const server = await serve({ mode: 'oauth', publicBaseUrl: BASE, tokenSecret: SECRET });
  try {
    await assert.rejects(() => connect(server.url, { mode: 'auto' }), /401|Unauthorized|invalid_token/i);
  } finally {
    await server.close();
  }
});

// A 2025-era client cancels with a `notifications/cancelled` message, which a stateless server cannot
// route to the request it names; the raw-connection test below covers that leg.
for (const [label, negotiation] of NEGOTIATIONS.filter(([, options]) => options.mode !== 'legacy')) {
  test(`official client, ${label}: cancelling a call aborts the upstream request it was waiting on`, async () => {
    const server = await serve({ mode: 'insecure' });
    const client = await connect(server.url, negotiation);
    let aborted: () => boolean = () => false;
    let started: () => void = () => {};
    const upstreamStarted = new Promise<void>(resolve => (started = resolve));
    try {
      const controller = new AbortController();
      const outcome = withTango(
        // The signal the server holds for this request, as ApiClient passes it to axios.
        () =>
          new Promise((_resolve, reject) => {
            const signal = requestSignal()!;
            aborted = () => signal.aborted;
            signal.addEventListener('abort', () => reject(new Error('Request cancelled')));
            started();
          }),
        async () => {
          const call = client.callTool({ name: 'search_tango_contracts', arguments: { agency: '3600' } }, { signal: controller.signal });
          await upstreamStarted;
          assert.equal(aborted(), false);
          controller.abort();
          await assert.rejects(call);
          // The server notices the client gave up and cancels the upstream call.
          for (let i = 0; i < 50 && !aborted(); i++) await new Promise(resolve => setTimeout(resolve, 20));
          return aborted();
        },
      );
      assert.equal(await outcome, true);
    } finally {
      await client.close();
      await server.close();
    }
  });
}

test('a request shaped like production (public Host, a browser Origin, a bearer) is served, bare and through the client', async () => {
  const publicBase = new URL('https://capture.mcp.blencorp.com');
  const server = await serve({ mode: 'oauth', publicBaseUrl: publicBase, tokenSecret: SECRET });
  const now = Math.floor(Date.now() / 1000);
  const token = sealToken(SECRET, { ...PAYLOAD, iat: now, exp: now + 600 });
  try {
    // fetch sets Host from the URL, so the bare request goes through node:http.
    const status = await new Promise<number>((resolve, reject) => {
      const request = httpRequest(
        { host: '127.0.0.1', port: server.url.port, path: '/mcp', method: 'POST', headers: { host: publicBase.host, origin: 'https://claude.ai', authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' } },
        response => {
          response.resume();
          resolve(response.statusCode ?? 0);
        },
      );
      request.on('error', reject);
      request.end(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }));
    });
    assert.equal(status, 200);

    for (const [label, negotiation] of NEGOTIATIONS) {
      const client = await connect(server.url, negotiation, { authorization: `Bearer ${token}`, origin: 'https://claude.ai' });
      try {
        assert.ok((await client.listTools()).tools.length > 0, label);
      } finally {
        await client.close();
      }
    }
  } finally {
    await server.close();
  }
});

test('official client: a provider key sent as a header unlocks that provider for the caller, on the modern leg too', async () => {
  const server = await serve({ mode: 'oauth', publicBaseUrl: BASE, tokenSecret: SECRET });
  const now = Math.floor(Date.now() / 1000);
  const token = sealToken(SECRET, { ...PAYLOAD, keys: { sam: 'sealed-sam' }, iat: now, exp: now + 600 });
  const client = await connect(server.url, { mode: 'auto' }, { authorization: `Bearer ${token}`, 'x-tango-api-key': 'header-tango' });
  try {
    assert.ok((await client.listTools()).tools.some(tool => tool.name === 'search_tango_contracts'));
    const seen: unknown[] = [];
    await withTango(
      async (..._args: unknown[]) => {
        seen.push(_args[2]);
        return { success: true, data: { count: 0, next: null, results: [] } };
      },
      () => client.callTool({ name: 'search_tango_contracts', arguments: { agency: '3600' } }),
    );
    assert.deepEqual(seen, ['header-tango']);
  } finally {
    await client.close();
    await server.close();
  }
});

test('official client: subscriptions/listen is refused, and the connection keeps serving tools', async () => {
  const server = await serve({ mode: 'insecure' });
  const client = await connect(server.url, { mode: 'auto' });
  try {
    await assert.rejects(() => client.listen({ toolsListChanged: true } as never), /Subscription limit reached/);
    assert.ok((await client.listTools()).tools.length > 0);
  } finally {
    await client.close();
    await server.close();
  }
});

test('a request whose connection is dropped, as a legacy client does on cancelling, aborts the upstream request', async () => {
  const server = await serve({ mode: 'insecure' });
  let aborted: () => boolean = () => false;
  let started: () => void = () => {};
  const upstreamStarted = new Promise<void>(resolve => (started = resolve));
  try {
    await withTango(
      () =>
        new Promise((_resolve, reject) => {
          const signal = requestSignal()!;
          aborted = () => signal.aborted;
          signal.addEventListener('abort', () => reject(new Error('Request cancelled')));
          started();
        }),
      async () => {
        const controller = new AbortController();
        const response = fetch(server.url, {
          method: 'POST',
          headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'search_tango_contracts', arguments: { agency: '3600' } } }),
          signal: controller.signal,
        });
        await upstreamStarted;
        assert.equal(aborted(), false);
        controller.abort();
        await assert.rejects(response);
        for (let i = 0; i < 50 && !aborted(); i++) await new Promise(resolve => setTimeout(resolve, 20));
        assert.equal(aborted(), true);
      },
    );
  } finally {
    await server.close();
  }
});
