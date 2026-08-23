# MCP 2026-07-28 Upgrade Plan

Upgrade of capture-mcp-server from MCP spec 2025-06-18 (TypeScript SDK v1,
`@modelcontextprotocol/sdk@1.x`) to MCP spec **2026-07-28** (TypeScript SDK v2,
the `@modelcontextprotocol/server` package family). Reference:
[2026-07-28 release candidate announcement](https://blog.modelcontextprotocol.io/posts/2026-07-28-release-candidate/),
finalized 2026-07-28.

## 1. What changed in the protocol

The 2026-07-28 revision makes MCP stateless at the transport layer:

- **`initialize`/`initialized` handshake removed.** Client info and
  capabilities now travel in `_meta` on every request
  (`CLIENT_INFO_META_KEY`, `CLIENT_CAPABILITIES_META_KEY`); capability
  discovery is an on-demand `server/discover` request.
- **`Mcp-Session-Id` removed.** Any request can land on any server
  instance; sticky routing and shared session stores are no longer part of
  the protocol. Protocol version rides the `MCP-Protocol-Version` header,
  and `Mcp-Method` / `Mcp-Name` headers allow routing without body
  inspection.
- **Server-initiated requests** (elicitation) no longer ride an SSE session:
  a handler returns `input_required` and the client retries the call with
  `inputResponses`.
- **Error code change:** missing-resource errors move from `-32002` to
  `-32602`.
- **Tool schemas:** full JSON Schema 2020-12 (`oneOf`/`anyOf`/`allOf`,
  conditionals) in `inputSchema` (root stays `type: "object"`);
  `outputSchema` unrestricted; list/read results may carry `ttlMs` and
  `cacheScope` cache hints.
- **Deprecated (12-month window):** roots, sampling, logging subsystems
  (SEP-2577). Tasks became a first-class extension with a new lifecycle.
- **Authorization hardening:** RFC 9207 `iss` parameter on authorization
  responses, `application_type` in Dynamic Client Registration, credential
  binding to issuer identity, `.well-known` discovery clarifications.

## 2. Why this server is well-positioned

The hosted deployments already create a **fresh `Server` per POST with
`sessionIdGenerator: undefined`** — the stateless idiom the new spec
standardizes. There is no session store to dismantle and no sticky routing to
unwind. Tool responses already use the handle pattern (opaque `next_cursor`
values passed back as arguments), which is exactly how 2026-07-28 expects
state to flow.

The consequential work is (a) the SDK package swap, and (b) OAuth: SDK v2
dropped the built-in OAuth *authorization server* (`mcpAuthRouter`), keeping
only resource-server helpers, while this project deliberately acts as its own
authorization server (the token seals user-supplied provider API keys). Those
endpoints move in-repo.

## 3. SDK migration map

The monolithic `@modelcontextprotocol/sdk` v1 is replaced by scoped v2
packages (all `2.0.0`, Node >= 20, ESM + CJS):

| v1 (removed) | v2 replacement |
|---|---|
| `sdk/server/index.js` → `Server` | `@modelcontextprotocol/server` → `Server` (low-level API retained) |
| `sdk/server/stdio.js` → `StdioServerTransport` | `@modelcontextprotocol/server/stdio` → `serveStdio(factory)` |
| `sdk/server/streamableHttp.js` → `StreamableHTTPServerTransport` | `@modelcontextprotocol/server` → `createMcpHandler(factory, opts)` + `@modelcontextprotocol/node` → `toNodeHandler` |
| `sdk/types.js` → `Tool`, request schemas | `@modelcontextprotocol/server` → `Tool` type; handlers register by method string (`'tools/list'`, `'tools/call'`) |
| `sdk/server/auth/router.js` → `mcpAuthRouter` | **Gone.** Metadata: `mcpAuthMetadataRouter` (`@modelcontextprotocol/express`); AS endpoints: implemented in-repo (`src/auth/oauth-endpoints.ts`) |
| `sdk/server/auth/middleware/bearerAuth.js` → `requireBearerAuth` | `@modelcontextprotocol/express` → `requireBearerAuth` (sets `req.auth`) |
| `sdk/server/auth/errors.js` → `InvalidTokenError` etc. | `@modelcontextprotocol/server` → single `OAuthError` + `OAuthErrorCode` enum |
| `sdk/shared/auth.js` → OAuth types | `@modelcontextprotocol/server` → same type names |

The 34 tool definitions are static wire-format JSON Schema objects; v2's
`Tool` type keeps that shape, so **tool modules change only their import
line**. Keeping the low-level `Server` + method-string handlers avoids
rewriting 34 tools against `registerTool`/zod.

New dependency footprint: `@modelcontextprotocol/server` (+ `core`, `zod@4`
transitively), `@modelcontextprotocol/express`, `@modelcontextprotocol/node`
(+ `hono`, `@hono/node-server` — the official Node adapter internals).
`@modelcontextprotocol/sdk` is removed.

## 4. Serving architecture

### HTTP (Railway + Lambda)

`createMcpHandler(factory, { legacy: 'stateless', responseMode: 'json' })`
returns a fetch-shaped handler that:

- serves **2026-07-28 clients** on the modern per-request envelope path, and
- serves **2025-era clients** through the built-in *stateless legacy
  fallback*: each legacy request gets a fresh instance, exactly the idiom we
  hand-wired in v1. GET/DELETE answer 405, as today.

This is the backward-compatibility keystone: **existing remote clients
(Claude connector, `mcp-remote` users, curl scripts) keep working without
changes**, and new clients negotiate 2026-07-28.

The factory runs per request and receives `{ era, authInfo, requestInfo }`,
which replaces the manual per-request wiring: provider keys are resolved
inside the factory (OAuth-sealed key → `X-*-Api-Key` header → env var, same
precedence as before) and only the matching tools are registered.
`toNodeHandler` (from `@modelcontextprotocol/node`) adapts the handler to
Express `(req, res, parsedBody)` and forwards `req.auth` (set by
`requireBearerAuth`) as `authInfo`.

`responseMode: 'json'` pins single-JSON-body responses — required behind
API Gateway + `@codegenie/serverless-express`, which cannot stream SSE, and
matches v1's `enableJsonResponse: true`.

### stdio (Claude Desktop, `.mcpb`)

`serveStdio(factory)` with default `legacy: 'serve'`: a connection opening
with the 2025 `initialize` handshake is pinned to a legacy-era instance;
modern stdio clients negotiate 2026-07-28. Desktop installs (old and new)
keep working.

### Behavior changes to publish in release notes

- POST bodies must be `application/json`; other media types now get **415**
  (v1 was lenient).
- 2026-07-28 clients see `-32602` for missing resources/prompts (was
  `-32002`); legacy-era responses are unchanged.
- Roots/sampling/logging were never used by this server — no impact.

## 5. OAuth (Railway hosted mode, `MCP_REQUIRE_OAUTH=true`)

What stays: `McpOAuthProvider`'s AES-256-GCM sealed-token design, the
multi-provider credential page, the header-bypass gate, and the token wire
format (`capmcp.v1.` prefix). **Existing user tokens keep verifying after
the deploy** — no re-authorization wave.

What moves in-repo (new `src/auth/oauth-endpoints.ts`), since SDK v2 no
longer ships an authorization server:

- `GET /authorize` — validates `response_type=code`, `client_id`,
  `redirect_uri`, PKCE `code_challenge` (+`method=S256`), `scope`, `state`,
  `resource`; hands off to the provider's pending-authorization flow.
- `POST /token` — `authorization_code` grant with **PKCE S256 verification**
  and `refresh_token` grant.
- `POST /register` — RFC 7591 Dynamic Client Registration, now accepting and
  storing **`application_type`** per the 2026-07-28 hardening.
- `POST /revoke` — RFC 7009.
- Discovery documents via `mcpAuthMetadataRouter`
  (`/.well-known/oauth-authorization-server`,
  `/.well-known/oauth-protected-resource`), advertising
  `code_challenge_methods_supported: ["S256"]` and
  `authorization_response_iss_parameter_supported: true`.
- **RFC 9207:** the authorization response redirect now carries `iss`.

The bearer gate uses v2 `requireBearerAuth` with the provider as
`OAuthTokenVerifier`; provider errors are v2 `OAuthError`s so 401 challenges
render the correct `WWW-Authenticate` + `resource_metadata` URL.

## 6. Deployment implications (hosted)

### Railway (`railway.toml`)

- **No config change.** Same build/start commands, same `/health`, same
  `/mcp`, same env vars (`MCP_TRANSPORT=http`, `MCP_REQUIRE_OAUTH`,
  `OAUTH_TOKEN_SECRET`, `MCP_PUBLIC_BASE_URL`, provider keys).
- Rolling deploys are safe: both protocol eras are served statelessly, so
  in-flight clients on the old instance and new clients on the new instance
  never share state. In-memory DCR registrations and pending authorization
  requests are lost on restart — a pre-existing property, unchanged; clients
  simply re-register/re-authorize.

### AWS Lambda / CDK (`infrastructure/`)

- **No infrastructure diff.** Same handler entry (`lambda-handler.handler`),
  same API Gateway routes, same S3 API-key middleware. Runtime
  `NODEJS_20_X` satisfies v2's `node >= 20` engines requirement.
- `npm run build:lambda` (`npm ci --omit=dev` inside `dist/`) picks up the
  new dependency set from the refreshed `package-lock.json`; bundle grows by
  roughly the size of `zod@4` + `hono` (~2 MB unpacked) — negligible against
  the 250 MB Lambda limit, cold-start impact minimal.
- `responseMode: 'json'` guarantees no SSE through
  API Gateway/serverless-express.

### Rollout / rollback

1. Merge with a `feat!:` conventional commit — the release workflow bumps
   the package to 2.0.0 and tags on merge to main.
2. Deploy Railway first (it hosts the OAuth surface), verify:
   `/health`; a **2025-style probe** (`initialize` POST → expect a normal
   InitializeResult from the legacy fallback); a **2026-style probe**
   (`tools/list` POST with `MCP-Protocol-Version: 2026-07-28` and `_meta`
   client info); an OAuth round-trip (register → authorize → token → tools
   call) plus an existing sealed token replay.
3. `npm run cdk:deploy` for Lambda; probe with an `X-Api-Key` +
   `X-Tango-Api-Key` request in both styles.
4. Rollback is redeploy-previous-build: no data migration, no session
   state, token format unchanged in both directions.

## 7. Testing

- Existing unit tests (tools, envelope, pagination, slugs) are
  transport-agnostic and unaffected.
- `mcp-oauth.test.ts` updates to v2 types plus new coverage: PKCE S256
  verification (negative + positive), `iss` on the redirect, DCR
  `application_type` persistence, token-endpoint error mapping.
- New `oauth-endpoints` tests drive the Express router with `node:test` and
  a fake provider.
- Manual: `npm run smoke` (live keys) unchanged; the two protocol probes in
  §6 against a local `MCP_TRANSPORT=http` run.

## 8. Risks and mitigations

| Risk | Mitigation |
|---|---|
| A legacy client depends on session semantics (GET SSE stream, `Mcp-Session-Id`) | Hosted mode never issued session IDs (stateless since day one); GET was already 405. No observable change. |
| Hand-rolled AS endpoints regress vs. the SDK router | Endpoints are a thin HTTP shim over the already-tested `McpOAuthProvider`; new unit tests cover PKCE, grants, DCR, revocation, metadata. |
| Strict 415 Content-Type rejects a lax client | Release note; error is explicit and self-diagnosing. |
| `zod@4`/`hono` transitive additions bloat or conflict | No direct zod usage in-repo (tools stay JSON Schema); lockfile pins; Lambda bundle size checked in CI build. |
| v2 validates `tools/call` results server-side | Our results are `{ content: [text], structuredContent?, isError? }` — spec-conformant; compile + tests confirm. |
| Desktop users on old Claude versions | `serveStdio` legacy era serves the 2025 handshake indefinitely (SDK deprecation window ≥ 12 months). |

## 9. Out of scope (deliberate)

- **Tasks extension** — all tools are fast request/response; no long-running
  work to task-ify.
- **MCP Apps** (server-rendered UI) — not applicable.
- **`ttlMs`/`cacheScope` cache hints** — worthwhile follow-up for
  `lookup_reference_code` (static data), not required for the upgrade.
- **Replacing the in-repo AS with an external IdP** — the sealed-provider-key
  design is a product feature, not incidental architecture.
