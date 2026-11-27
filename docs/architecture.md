# capture-mcp-server architecture

## Overview

```text
Transport (stdio | Streamable HTTP, single user or OAuth)
    ↓
buildMcpServer  (one McpServer per request, built from that request's keys)
    ↓
ToolCatalog  (the tools the request's keys unlock; validates arguments; injects the key)
    ↓
Tool modules  (reference, USAspending, SAM.gov, join, Tango, HigherGov)
    ↓
ApiClient  (per-source pacing, 30 second timeout, error truncation and redaction)
    ↓
SAM.gov · USAspending · Tango · HigherGov
```

The server exposes 34 narrow, read-only tools (see the [tool reference](./sdk-reference.md)). It
runs no model and no model-written code: the assistant picks a tool and fills in its arguments.

## Transport

- stdio is the default (`serveStdio`). `MCP_TRANSPORT=http` serves the Express app in
  `src/http-app.ts`, where `/mcp` is the SDK's `createMcpHandler` in stateless mode (1 MiB body
  limit, no subscriptions). There is no session state: the server speaks MCP 2026-07-28 and answers
  older clients statelessly.
- HTTP mode fails closed. It starts only with `MCP_REQUIRE_OAUTH=true` (with `OAUTH_TOKEN_SECRET` and
  `MCP_PUBLIC_BASE_URL`) or with the single-user `MCP_ALLOW_INSECURE_HTTP=true`, which binds loopback
  only.
- The same app serves the landing page, the policy pages, `/health` and the documentation site at
  `/docs`. The landing page needs `dist/web` (`pnpm build:web`) and the documentation site needs
  `docs-site/`, which the `Dockerfile` builds from `site/`.

## Tools

- `src/mcp-server.ts` registers each tool with a title, annotations (all read-only) and an
  `outputSchema` (`src/tools/tool-metadata.ts`). A result with a top-level `error`, a thrown error
  or a non-object result is returned with `isError: true`.
- `ToolCatalog` (`src/tools/index.ts`) is built for each request. It lists a source's tools only when
  the request has that key, rejects an unknown, missing or mistyped argument with a structured
  `bad_request`, and injects the key as `api_key`. No tool schema advertises `api_key`, so a caller
  cannot supply one. There is no module-level registry, so concurrent requests never see each other's
  tool sets.
- The search tools listed in the SDK reference (`docs/sdk-reference.md`) share one list envelope
  (`src/utils/envelope.ts`): `filters.upstream` against `filters.client_side`, a `total` that is
  `null` when it cannot be trusted, `count_unit`, `date_field` and one `next_cursor` shape. Other
  tools that return records keep their own shapes; the SDK reference lists them.
  `docs/upstream-api-notes.md` records which upstream parameters are verified to bind.

## Keys and authentication

- Key sources (`src/auth/request-keys.ts`): stdio and single-user HTTP use the process environment,
  and a client's `X-*-Api-Key` headers override it. A remote caller uses only its own keys: the keys
  sealed in its token, then its headers. The server's environment keys never answer a remote caller.
- OAuth (`src/auth/oauth-server.ts`, `src/auth/mcp-oauth.ts`) is OAuth 2.1 with PKCE and dynamic
  client registration. Access and refresh tokens are AES-256-GCM envelopes that carry the caller's
  keys, sealed with `OAUTH_TOKEN_SECRET` (`src/auth/key-ring.ts`, which also opens tokens sealed with
  `OAUTH_TOKEN_SECRET_PREVIOUS`). A client registration is sealed into its `client_id` and lasts 180
  days. There is no database and no account.
- Access tokens last 1 hour by default and refresh tokens 90 days; a refresh never extends the 90
  days. Revocation is in memory, per instance, and so best-effort. Rotate the secret to revoke
  every token (see "Rotating the secret" in the Self-host guide).
- In OAuth mode (the hosted server), `POST /mcp` needs a verified bearer token with the
  `mcp:tools` scope, after a per-address request budget (`src/rate-limit.ts`). The client address
  comes from `MCP_CLIENT_IP_HEADER` or the connection (`src/client-ip.ts`), and IPv6 counts per /64.
  Single-user HTTP (`MCP_ALLOW_INSECURE_HTTP=true`) has neither the bearer check nor the budget: it
  is protected only by binding to loopback, and any local caller can use the operator's keys.

## Calling the sources

`ApiClient` (`src/utils/api-client.ts`) keeps one pacing queue for each source for the whole process:
0.1 seconds between SAM.gov calls, 0.1 for Tango, 0.2 for HigherGov and 3.6 for USAspending. It
times a request out after 30 seconds, does not retry, cancels the request when the MCP client
cancels, and truncates an error body to 500 characters with the call's key replaced by `[REDACTED]`.
The three `get_highergov_*` lookups cache a result for 15 minutes (500 entries) per key.

Because the pacing queues, the cache, the request budgets and the revocation list are in memory,
run one replica.
