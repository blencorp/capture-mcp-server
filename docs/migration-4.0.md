# Migrating from 3.x to 4.0

4.0 moves the server to MCP SDK 2 and the 2026-07-28 protocol revision. Tools, their names, their
arguments and the OAuth flow (sealed `capcli.v1` client ids, AES-GCM key ring, 1 hour access tokens,
the `mcp:tools` scope, the `/mcp` budget, `MCP_CLIENT_IP_HEADER`) behave as before. What a client
can observe changes in the places below. The characterization suite in `src/characterization.test.ts`
was written against 3.0 and pins everything that did not change; the tests that carry a `D` tag below
are the ones whose expectation changed.

Nothing needs to change in a deployment: no new environment variable, no renamed one.

## For people who use a hosted or self-hosted server

Nothing. Assistants that speak the 2026-07-28 revision use it, and older ones are served as before,
without a session. If an assistant reports that a call failed where it used to show a result, that
call did fail: see D2.

## For clients and scripts that call `/mcp` directly

| | 3.x | 4.0 |
| --- | --- | --- |
| Protocol | 2025 revisions, stateless `POST`s | 2026-07-28, and the 2025 revisions through the SDK's stateless legacy leg. There are still no sessions; `GET` and `DELETE /mcp` are `405`. |
| **D2** A tool-level failure | A normal result: `{ "error": ... }`, no `isError`, unless the tool threw | `isError: true`. The error is in `structuredContent` and, as indented JSON, in the text. This covers a structured error (`bad_request`, `not_found`, ...), a plain error text (`API Error 401: ...`), a thrown error and a refused argument (unknown, missing or mistyped). |
| **D1** An unknown tool, or one whose key the connection lacks | An `isError` result, `{ "error": "Tool \"x\" not found" }` | A JSON-RPC error, code `-32602`, message `Tool x not found`. The tool is not listed either. |
| `tools/list` | `name`, `description`, `inputSchema` | The same three, unchanged, plus `title`, `annotations` (`readOnlyHint`, `destructiveHint: false`, `idempotentHint`, `openWorldHint`) and `outputSchema`. |
| `structuredContent` | Present when the result was an object | Present on every tool result, and validated against the tool's `outputSchema` on success. The text content is unchanged: the same JSON, indented. A result the SDK itself refuses to deliver (output that fails its schema) is an `isError` with text only. |
| **D3** Response to a request without `MCP-Protocol-Version` | A JSON body | One SSE `message` event (`text/event-stream`). Clients that send `Accept: application/json, text/event-stream`, as the MCP transport requires, handle both. |
| Capabilities | `{ "tools": {} }` | `{ "tools": { "listChanged": false } }`: the tool list is fixed within a request, and the SDK would otherwise advertise `true` |
| **D4** A malformed, oversized (over 1 MiB) or wrong-content-type `/mcp` body | An HTML error page (`400`) | A JSON-RPC error: `400` parse error, `413`, `415`. |
| Cancellation | The upstream request ran to its end | A client that cancels by dropping its connection (the 2026-07-28 way) cancels the request to SAM.gov, USAspending, Tango or HigherGov. A 2025-era client's `notifications/cancelled` message cannot reach a stateless server's running request; only a dropped connection cancels. |

An `outputSchema` describes a successful result. List tools (`search_tango_contracts`, ...) require
their envelope (`total`, `count_unit`, `filters`, `next_cursor` and the records); the other tools
declare only what their results share, because the fields of the records come from the sources and
change with them. An `isError` result is not validated against it.

## For people who build on the code

- `@modelcontextprotocol/sdk` is gone. The server depends on `@modelcontextprotocol/server` 2.4.0 and
  `@modelcontextprotocol/node` 2.1.2, plus `zod` 4, `cors` and `express-rate-limit`.
- SDK 2 removed the server-side OAuth helpers. `src/auth/oauth-server.ts` serves the same endpoints
  with the same paths, request windows, CORS, `Allow` headers and error bodies, and `McpOAuthProvider`
  keeps its interface. Secrets and PKCE verifiers are now compared in constant time.
- `src/mcp-handlers.ts` and `createMcpServer` are replaced by `buildMcpServer` in `src/mcp-server.ts`.
- stdio uses `serveStdio`.
- The v1 SDK read `MCP_DANGEROUSLY_ALLOW_INSECURE_ISSUER_URL` to accept an `http` issuer. It is gone: `MCP_PUBLIC_BASE_URL` must be `https`, except for `localhost` and `127.0.0.1`, as the CI image check uses.
- `ToolCatalog.call` still validates arguments and still returns `{ error: { code: 'bad_request', ... } }`;
  the wire layer turns that into `isError`.
