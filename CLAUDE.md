# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Development Commands

Run everything from the repository root (`pnpm@12.21.0`, pinned in `packageManager`; Node 24 or 26).

```bash
pnpm install --frozen-lockfile
pnpm typecheck       # tsc --noEmit for src and scripts, web/, web/e2e (the correctness gate)
pnpm lint            # eslint: @eslint/js + typescript-eslint, type-aware promise rules and stderr-only console in src/, react-hooks in web/
pnpm build           # tsc -p tsconfig.build.json (src to dist/) then Vite (web to dist/web)
pnpm test            # builds, then tsx --test "src/**/*.test.ts" (node:test); includes the official-client suite and the v1-to-v2 characterization
pnpm test:web        # builds web and site, then Playwright + axe (web/e2e); needs Chromium once
pnpm kit:check       # the shared portal kit matches web/portal-kit.json
pnpm docs:reference  # regenerates docs/sdk-reference.md from the tool definitions
pnpm dev             # tsx src/server.ts (stdio); MCP_TRANSPORT=http for HTTP
```

- **TypeScript 7 runs beside TS 6**: `devDependencies.typescript` is the `@typescript/typescript6` alias
  (the API typescript-eslint imports) and `@typescript/native` is TS 7, which provides the `tsc`
  binary. Do not "simplify" the aliases away.
- `tsconfig.json` checks sources, tests and scripts and never emits; `tsconfig.build.json` emits
  `src/` to `dist/` without tests or fixtures.
- `pnpm-workspace.yaml` holds `allowBuilds` and, when `pnpm audit` needs one, an `overrides:` entry that pins a
  patched transitive version (none now). Remove an override once its parent ships the fix.
- ESM everywhere: relative imports use the `.js` extension even in `.ts` sources. Logs go to stderr
  only (stdout is the stdio JSON-RPC stream).
- `.github/workflows/ci.yml` runs audit (root and `site/`), typecheck, lint, build and test on
  Node 24 and 26, an accessibility job (`pnpm test:web`) and a Docker job. `release.yml` runs the same
  gates, then builds the npm tarball (`@blen/capture-mcp-server`) and the Claude Desktop bundle
  (`scripts/mcpb-prepare.mjs`, staged in `mcpb-build/`, which has its own `node_modules`) and publishes
  both; `scripts/stdio-smoke.mjs` runs either over stdio in CI. `manifest.json` carries the version and is
  kept in step with `package.json` by `src/manifest.test.ts`. Railway builds `main` from GitHub (`.railway/railway.ts`), including the release commit, so
  `/health` reports the released `version` and `commit`. Actions are pinned to commit SHAs.
- The server and the `Dockerfile` target Node 26; the Docker base image is pinned by digest.
- `src/tools/` and `src/utils/` have `no-explicit-any` switched off in `eslint.config.mjs`
  (temporary: the upstream payloads are untyped).

## Architecture Overview

This is a Model Context Protocol (MCP) server that captures federal procurement and spending data through 34 specialized tools. The architecture follows a modular tool-based design:

### Core Components

**Server (`src/server.ts`)**
- MCP SDK 2 (`@modelcontextprotocol/server` 2.4.0, `/node` 2.1.2; the client is a dev dependency for tests). The server speaks 2026-07-28 and, through the SDK's stateless legacy leg, older clients.
- `src/mcp-server.ts` builds one `McpServer` per request from that request's keys (`buildMcpServer`): each tool is registered with a title, annotations and an `outputSchema` (`src/tools/tool-metadata.ts`). A result with a top-level `error`, a thrown error or a non-object result is `isError`. Argument validation stays in `ToolCatalog.call` (structured `bad_request`), so the SDK's input validation is a pass-through; output schemas are converted once per tool (the SDK caches compiled schemas without evicting).
- stdio by default (`serveStdio`); `MCP_TRANSPORT=http` serves `src/http-app.ts` (Express), where `/mcp` is `createMcpHandler` (`legacy: 'stateless'`, 1 MiB body, `maxSubscriptions: 0`) behind the budget and bearer gate. There is no session state.
- A request's `AbortSignal` reaches the upstream call through `src/utils/request-signal.ts` (an `AsyncLocalStorage` that `ApiClient` reads); tool modules do not see it.

**Tool Architecture (`src/tools/`)**
- Modular tool system with six categories:
  - `reference-tools.ts` - 1 static FPDS reference tool (`lookup_reference_code`; no key, no network)
  - `sam-tools.ts` - 4 SAM.gov API tools (entities, opportunities, details, exclusions)
  - `usaspending-tools.ts` - 6 USASpending.gov API tools (awards, spending, budgets, recipient search, `get_award_detail` verification, `aggregate_contracts` grouping)
  - `tango-tools.ts` - 12 Tango API tools (contracts, grants, vendor profiles, opportunities, spending summaries, GAO protests + detail, IDVs + child/task-order drill-down, vehicle catalog, OTAs, entity time-series metrics). Set-aside filtering is exact on FPDS codes; cursor pagination via the Tango `next` URL.
  - `highergov-tools.ts` - 9 HigherGov tools (forecast/opportunity/contract/people search, saved-search listing, opportunity documents, single-record lookups). Responses are normalized to lowercase agency/vehicle/set-aside slugs via `utils/highergov-slugs.ts`. `get_*` tools cache for 15 min in an in-process LRU.
  - `join-tools.ts` - 2 cross-API tools (entity+awards, opportunity+context)
- Response conventions (see `utils/envelope.ts`): every list tool echoes `filters.upstream` vs `filters.client_side`, nulls untrustworthy totals (`total_upstream_unfiltered` / `total_upstream_unverified` + warnings), labels `count_unit` and `date_field`, and returns one `next_cursor` shape. `tools/index.ts` rejects unknown/mistyped parameters with a structured bad_request. `utils/fpds-codes.ts` is the FPDS code table; `docs/upstream-api-notes.md` records which upstream params are verified to bind (run `pnpm capture-fixtures` with live keys to re-probe).
- Each tool module exports `getTools()` and `callTool()` methods
- `ToolCatalog` in `tools/index.ts` builds a per-request tool set and injects the request's key

**API Client (`src/utils/api-client.ts`)**
- Centralized HTTP client with rate limiting
- SAM.gov: 100ms delay between calls
- USASpending.gov: 3.6s delay (respects ~1000/hour limit)
- Tango API: 100ms delay between calls
- HigherGov: 200ms delay between calls
- Built-in error handling and input sanitization
- Supports both GET and POST requests with timeouts

### API Integration Patterns

**SAM.gov Tools**
- Require an API key (injected by `ToolCatalog` as `api_key`; locally from SAM_GOV_API_KEY)
- Use GET requests with query parameters
- Return filtered essential fields to minimize token usage

**USASpending.gov Tools**
- No API key required (public API)
- Mix of GET and POST requests
- POST used for complex filtering operations

**Tango API Tools**
- Require an API key (injected by `ToolCatalog` as `api_key`; locally from TANGO_API_KEY)
- Use GET and POST requests with API key in headers (X-API-Key)
- Unified API consolidating FPDS, USASpending, and SAM data
- Enhanced filtering and search capabilities
- Return comprehensive data with historical context

**Join Tools**
- Combine data from both APIs in single operations
- Handle cross-API data correlation (UEI linking, NAICS matching)
- Provide comprehensive business intelligence views

### Environment Setup

Optional environment variables (configure based on which tools you need):
- `SAM_GOV_API_KEY` - API key from sam.gov/data-services/API (enables SAM.gov + Join tools)
- `TANGO_API_KEY` - API key from tango.makegov.com (enables Tango tools)
- `HIGHERGOV_API_KEY` - API key from highergov.com (enables HigherGov tools)

**Tool Availability Based on API Keys** (Reference + USASpending, 7 tools, always available):
- 4 SAM + 2 Join when `SAM_GOV_API_KEY` is set
- 12 Tango when `TANGO_API_KEY` is set
- 9 HigherGov when `HIGHERGOV_API_KEY` is set
- All 34 tools when all three keys are set

Key sources (`src/auth/request-keys.ts`, `resolveRequestKeys`): stdio and `MCP_ALLOW_INSECURE_HTTP` (single user) use the
process env keys, overridable by `X-*-Api-Key` headers. Remote callers (OAuth HTTP) use ONLY their own keys —
OAuth-sealed, then their headers — never the process env. Tool modules never read `process.env` for keys; `ToolCatalog`
injects the request's key as `api_key`. No tool schema advertises `api_key` and a caller-supplied one is rejected as an unknown parameter.

The server automatically registers only the tools for which API keys are available.

### Remote Auth (HTTP mode)

`MCP_TRANSPORT=http` fails closed (`httpAuthFromEnv` in `src/http-app.ts`): it needs `MCP_REQUIRE_OAUTH=true` + `OAUTH_TOKEN_SECRET`,
or the explicit single-user `MCP_ALLOW_INSECURE_HTTP=true` (loopback only: a non-loopback `HOST` is a startup error, `listenHost`).
- `src/auth/oauth-server.ts` is the OAuth 2.1 endpoint layer (`/authorize`, `/token`, `/register`, `/revoke`, the two `/.well-known` documents), kept in this repo because SDK 2 dropped its server-side OAuth helpers; `src/auth/mcp-oauth.ts` is the provider behind it, with PKCE, dynamic client registration, and AES-256-GCM sealed access/refresh tokens (16-byte tag and a valid envelope required). Each token carries a `keys: { sam?, tango?, highergov? }` map sealed against `OAUTH_TOKEN_SECRET`.
- Stateless revocation: access tokens last 1 hour (`OAUTH_ACCESS_TOKEN_TTL_SECONDS`, at most 1 day); refresh tokens keep their original 90-day expiry however often they are used. `OAUTH_TOKEN_SECRET` is a key ring: new tokens are sealed with it, and `OAUTH_TOKEN_SECRET_PREVIOUS` (comma-separated, at most 3) still opens old ones. Rotating the secret without listing the old one revokes every token; `revokeToken` is best-effort (in memory, per instance).
- Client registrations are stateless: `src/auth/client-registrations.ts` seals the registration (valid 180 days, so a retired secret must stay in `OAUTH_TOKEN_SECRET_PREVIOUS` for 180 days after its last use; every token's expiry is clamped to it, so a token never outlives its client) into the `client_id` (and derives the client secret from it) with `src/auth/key-ring.ts`, the same AES-GCM key ring as tokens, so restarts and rotation behave like tokens. Remaining in-memory OAuth state (`src/auth/expiring-map.ts`: pending authorizations, codes, revocations) has an expiry and a size ceiling that evicts the oldest entry.
- `GET/POST /oauth/authorize` renders a multi-provider authorization page (CSP by hash, `no-store`); users pick checkboxes per provider and supply only the keys they have.
- `POST /mcp` always requires a verified bearer token with the `mcp:tools` scope, after a per-address request budget (`src/rate-limit.ts`, `MCP_IP_RPS`/`MCP_IP_BURST`, 429 with `Retry-After`). Client address (`src/client-ip.ts`, ported from uspto): `MCP_CLIENT_IP_HEADER` (Railway: `x-real-ip`) or the TCP peer, IPv6 per /64; the OAuth endpoint limiters use the same key. There is no `trust proxy`. Provider-key headers never authenticate a caller; they only add the caller's own key for a provider.
- Per-request precedence: OAuth-sealed key → caller header. Never the server's env.
- The Railway-hosted HTTP server is the only hosted runtime; the AWS Lambda deployment was retired.
- Tools are registered per request in a `ToolCatalog` (`src/tools/index.ts`); there is no module-level registry, so concurrent requests cannot see each other's tool sets.

### Web pages and docs

- `src/http-app.ts` also serves the public, static pages, before the OAuth and MCP routes: `/` (landing), `/privacy-policy` and `/terms` (prerendered, from `legal/*.md`), unknown browser paths (the not-found page, status 404), `/assets`, and `/docs` (`src/docs.ts`: the built `site/`, its own CSP with inline scripts allowed only by hash). There are no accounts (`accounts: false` in `web/src/brand.tsx`), so the shared header has no sign-in link and no session check. The pages need `dist/web` (`pnpm build:web`) and `docs-site/` (the Dockerfile builds `site/` into it).
- `web/` is the landing page (React, Vite, Tailwind). `web/src/components/kit/`, `components/ui/`, `index.css`, `lib/utils.ts` and the BLEN logo are a **kit shared byte for byte** with BLEN's other MCP servers, hashed in `web/portal-kit.json` (`pnpm kit:check`). Product text lives in `web/src/brand.tsx`; `pages/home.tsx` is Capture's own landing page (the kit's `Landing` offers account sign-in unless `accounts` is false). `web/prerender.ts` and `web/third-party-notices.ts` are shared too, but not in the manifest.
- `site/` is the documentation site (Astro Starlight, base `/docs`, its own pnpm root and lockfile; `pnpm --dir site build`). Product values are in `site/product.mjs`. Its Tool reference page is `docs/sdk-reference.md`, which `scripts/gen-tool-reference.ts` writes from the tool definitions (`src/tool-reference.test.ts` fails when it is stale), and its example questions are `examples/*.json` (`src/docs-examples.test.ts` validates each against the tool's schema).
- `docs/accessibility.md` says what the browser tests cover. The OAuth authorization page (`renderAuthorizationPage`) is server-rendered HTML and is not covered.
- `legal/privacy-policy.md` and `legal/terms.md` describe the hosted service; update them when auth or storage changes.

### MCP Integration

Server designed for Claude Desktop integration via MCP configuration:

**Example with all tools enabled**:
```json
{
  "mcpServers": {
    "capture-mcp-server": {
      "command": "node",
      "args": ["/path/to/capture-mcp-server/dist/server.js"],
      "env": {
        "SAM_GOV_API_KEY": "your-sam-api-key",
        "TANGO_API_KEY": "your-tango-api-key",
        "HIGHERGOV_API_KEY": "your-highergov-api-key"
      }
    }
  }
}
```

**Example with only USASpending.gov tools (no API keys needed)**:
```json
{
  "mcpServers": {
    "capture-mcp-server": {
      "command": "node",
      "args": ["/path/to/capture-mcp-server/dist/server.js"]
    }
  }
}
```

## Security invariants

Each line names the file that enforces the rule and the test that pins it.

- AES-GCM envelopes require a 16-byte tag and a valid envelope (sealed tokens and client registrations): `src/auth/key-ring.ts` (used by `src/auth/mcp-oauth.ts` and `src/auth/client-registrations.ts`); `src/auth/mcp-oauth.test.ts` ("a truncated tag is rejected...", "an oversized tag is rejected"; these cover tokens).
- The client address comes only from the configured trusted header (`MCP_CLIENT_IP_HEADER`): a literal IP, no zone id, rightmost entry of a list, else the TCP peer; IPv6 is counted per /64 and IPv4-mapped addresses are unmapped; there is no `trust proxy`: `src/client-ip.ts`, `src/http-app.ts`; `src/client-ip.test.ts`, `src/http-app.test.ts` ("the budget counts the address in the configured proxy header...").
- In OAuth mode (the hosted server), every `POST /mcp` spends the per-address budget before the token is checked; single-user HTTP (`MCP_ALLOW_INSECURE_HTTP`, loopback only) has neither: `src/rate-limit.ts`, `src/http-app.ts`; `src/rate-limit.test.ts`, `src/http-app.test.ts` ("oauth mode: /mcp has a request budget per client address, spent before a token is checked").
- Remote callers never use the operator's keys: a caller's key comes from its sealed token or its own header, never the server environment: `src/auth/request-keys.ts`; `src/http-app.test.ts` ("resolveRequestKeys: remote callers never get the operator environment keys").
- Never Origin-allowlist the bearer `/mcp` (hosted connectors send their own `Origin`): `src/http-app.ts`; `src/official-client.test.ts` ("a request shaped like production (public Host, a browser Origin, a bearer) is served...").
- Sensitive responses are `no-store` (the authorize page, token responses, docs errors): `src/http-app.ts`, `src/auth/oauth-server.ts`, `src/docs.ts`; `src/characterization.test.ts`, `src/docs.test.ts`.

A change to any of these is a security change: port it to the sibling servers (uspto, fedreg, datagov, samgov, clinicaltrials) or record why it does not apply.
