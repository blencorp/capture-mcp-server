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
  binding to issuer identity, `.well-known` discovery clarifications. Client
  ID Metadata Documents (CIMD) are now preferred; Dynamic Client Registration
  remains available for compatibility but is deprecated.

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

`createCaptureMcpHandler` composes a strict v2 `createMcpHandler` modern leg
with an explicitly hand-wired `NodeStreamableHTTPServerTransport` legacy leg.
It:

- serves **2026-07-28 clients** on the modern per-request envelope path, and
- classifies and serves **2025-era clients** through a stateless JSON legacy
  transport: each request gets a fresh instance. GET/DELETE answer 405, as
  today.

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

Railway keeps the SDK's adaptive `responseMode: 'auto'`: ordinary calls return
one JSON body, while a call that actually emits related notifications can
upgrade to SSE. API Gateway + Lambda use `responseMode: 'json'` because the
current `serverless-express` integration is buffered. That setting does **not**
disable the new `subscriptions/listen` method, which the SDK always serves as
SSE, so Lambda also sets `maxSubscriptions: 0` and returns the SDK's bounded
JSON-RPC `-32603` subscription-limit response instead of opening a stream.
Railway keeps subscriptions enabled. The server advertises no list-change
capability, so current tool consumers lose no advertised behavior on Lambda.

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
the deploy only when they already carry the canonical `/mcp` resource.** A
legacy token issued without an RFC 8707 audience is rejected and that client
must authorize once more; accepting an audience-less token would violate the
current MCP authorization contract.

What changes operationally: OAuth protocol state is no longer process-local.
`OAuthStateStore` has an in-memory implementation for local/tests and a Redis
implementation for production. DCR registrations, pending authorization
requests, single-use authorization codes, and token revocations are shared
across replicas with TTLs and atomic `GETDEL` consumption. Production startup
fails closed unless `OAUTH_REDIS_URL` (or `REDIS_URL`) points to Redis 6.2+.
The AES token secret remains the trust root and must remain stable across
deploys.

What moves in-repo (new `src/auth/oauth-endpoints.ts`), since SDK v2 no
longer ships an authorization server:

- `GET /authorize` — validates `response_type=code`, `client_id`,
  `redirect_uri`, PKCE `code_challenge` (+`method=S256`), `scope`, `state`,
  and the required canonical `resource`; hands off to the provider's
  pending-authorization flow.
- `POST /token` — `authorization_code` grant with **PKCE S256 verification**
  and `refresh_token` grant. Both require the same canonical RFC 8707 resource,
  and bearer verification rejects tokens minted for another resource.
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

This release intentionally retains Dynamic Client Registration because it is
the registration mechanism used by the currently deployed clients. It does
**not** implement Client ID Metadata Documents yet. CIMD-capable clients must
continue to use DCR with this server until that follow-up lands; this is a
known compatibility gap, not a claim of complete adoption of every optional
2026-07-28 authorization feature.

## 6. Deployment implications (hosted)

### Railway (`railway.toml`)

- Build/start commands, `/health`, and `/mcp` stay the same. The required
  runtime changes are Node 24 and a linked Redis 6.2+ service exposed as
  `OAUTH_REDIS_URL` or `REDIS_URL`.
- `railway.toml` moves from the legacy Nixpacks builder to Railpack. Railpack
  resolves the explicit Node 24 engine; the published Nixpacks Node provider
  does not list Node 24 among its supported majors.
- Rolling deploys and multiple replicas are safe only after Redis is linked:
  MCP tool requests are request-local/stateless, while the deliberately
  multi-request OAuth flow uses shared durable state. Authorization codes and
  pending authorizations are atomically consumed.
- Existing sealed access/refresh tokens with the canonical resource continue
  to verify if `OAUTH_TOKEN_SECRET` is unchanged. Tokens without that audience,
  and dynamic registrations held only in the old release's memory, require a
  one-time authorization/registration after the major rollout; new records
  persist.

### AWS Lambda / CDK (`infrastructure/`)

- The handler entry (`lambda-handler.handler`), API Gateway routes, and S3
  API-key middleware stay the same. The runtime moves to `NODEJS_24_X` because
  Node 20 reached end-of-life on 2026-04-30; Node 24 is supported by Lambda
  through April 2028 and exceeds v2's `node >= 20` minimum.
- `npm run build:lambda` (`npm ci --omit=dev` inside `dist/`) picks up the
  lockfile-pinned v2 and Redis clients. Bundle size is measured locally before
  release rather than assumed.
- Powertools remains a lockfile-pinned production dependency inside the Lambda
  artifact. The redundant hard-coded Powertools layer is removed, avoiding a
  layer/runtime/region compatibility dependency during the Node 24 rollout.
- Ordinary calls are JSON-only. `subscriptions/listen` is explicitly refused
  as described above; full subscription support would require a streaming
  Lambda/API Gateway architecture and is not implied by this release.
- CORS permits `MCP-Protocol-Version`, `Mcp-Method`, `Mcp-Name`,
  `Authorization`, `X-Api-Key`, and all three provider headers, including
  `X-Highergov-Api-Key`.

### Rollout / rollback

1. Provision/link Redis and set the production variables before merging. Back
   up the current Railway variable set and record the last good deployment.
2. Merge with a `feat!:` conventional commit. The release workflow computes
   2.0.0, writes package/lock/manifests, reruns the suite with real Redis,
   commits and tags without rebasing any untested newer commit, then publishes
   the GitHub release.
3. A dependent release job checks out that immutable tag, deploys it to
   Railway, and runs `verify:deployment`. The gate checks health body version
   and protocol—not just HTTP 200—then exercises modern `tools/list`, legacy
   initialization, and absence of session IDs.
4. Manually complete one OAuth browser flow and prove registration/code/token
   continuity across a service restart or second replica before increasing
   traffic. Replay a pre-upgrade sealed token if one is available.
5. Build/synthesize and deploy Lambda, then run the same verifier with a valid
   `--server-api-key`; also assert `subscriptions/listen` returns the bounded
   JSON error rather than an SSE response.
6. Rollback by redeploying the prior immutable tag while retaining Redis and
   the unchanged `OAUTH_TOKEN_SECRET`. There is no MCP session/data migration;
   Redis records are backward-neutral to the prior code, which ignores them.

## 7. Testing

- Existing unit tests (tools, envelope, pagination, slugs) are
  transport-agnostic and unaffected.
- `mcp-oauth.test.ts` updates to v2 types plus new coverage: PKCE S256
  verification (negative + positive), `iss` on the redirect, DCR
  `application_type` persistence, token-endpoint error mapping.
- New `oauth-endpoints` tests drive the Express router with `node:test` and
  a fake provider.
- `mcp-http.test.ts` drives real HTTP and proves modern routing headers,
  concurrent request-local tool isolation, legacy initialization and
  `tools/list`, 415, no session header, and Lambda's bounded subscription
  response.
- `stdio.test.ts` starts the built server as a child process and proves both a
  modern claim-bearing request without initialization and a pinned legacy
  initialized connection.
- OAuth tests run an end-to-end flow across two independent providers and two
  Redis clients, including single-use code replay rejection, refresh, and
  cross-instance revocation. CI starts Redis 7 so this gate cannot silently
  skip.
- `scripts/run-tests.sh` prunes `dist/node_modules`; tests still run correctly
  after `build:lambda` installs a production dependency tree inside `dist`.
- `npm run verify:deployment` is both the automated post-deploy gate and the
  bounded manual hosted check; it exercises modern and legacy `tools/list`,
  not only health and negotiation. `npm run smoke` remains the optional live
  upstream-provider test.

## 8. Risks and mitigations

| Risk | Mitigation |
|---|---|
| A legacy client depends on session semantics (GET SSE stream, `Mcp-Session-Id`) | Hosted mode never issued session IDs (stateless since day one); GET was already 405. No observable change. |
| Hand-rolled AS endpoints regress vs. the SDK router | Endpoints are a thin HTTP shim over the already-tested `McpOAuthProvider`; new unit tests cover PKCE, grants, DCR, revocation, metadata. |
| A client requires Client ID Metadata Documents and will not fall back to DCR | CIMD is a documented follow-up; retain and test DCR compatibility during this rollout rather than silently representing it as implemented. |
| OAuth flow crosses a restart or replica | Redis-backed store with TTLs and atomic consume; production refuses to boot with only process memory; real-Redis cross-instance test is mandatory in CI. |
| A Lambda client opens `subscriptions/listen` | Lambda sets `maxSubscriptions: 0` and returns a bounded JSON-RPC error; Railway remains the streaming-capable hosted target. |
| Release and deploy workflows race different SHAs | Release refuses a non-fast-forward push, tags only tested/versioned content, and deploys that immutable tag in the same workflow. |
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
- **Client ID Metadata Documents** — the final specification prefers CIMD and
  deprecates DCR, but the deployed client path currently depends on DCR. Add
  CIMD as a separately tested compatibility feature before removing DCR.
- **Streaming Lambda subscriptions** — requires a different deployment
  integration; the current Lambda surface explicitly reports the limitation.
