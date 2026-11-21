# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

### Building and Running
- `npm run build` - Compiles TypeScript to dist/ directory
- `npm start` - Runs the compiled server (requires build first)
- `npm run dev` - Development mode with ts-node (auto-reload with nodemon)

### Project Configuration
- Uses ES modules (`"type": "module"` in package.json)
- TypeScript compilation target: ES2020
- Output directory: `dist/`
- Source directory: `src/`

## Architecture Overview

This is a Model Context Protocol (MCP) server that captures federal procurement and spending data through 34 specialized tools. The architecture follows a modular tool-based design:

### Core Components

**Server (`src/server.ts`)**
- MCP server using `@modelcontextprotocol/sdk`
- Uses stdio transport for Claude Desktop integration
- Handles tool registration and execution through centralized registry

**Tool Architecture (`src/tools/`)**
- Modular tool system with six categories:
  - `reference-tools.ts` - 1 static FPDS reference tool (`lookup_reference_code`; no key, no network)
  - `sam-tools.ts` - 4 SAM.gov API tools (entities, opportunities, details, exclusions)
  - `usaspending-tools.ts` - 6 USASpending.gov API tools (awards, spending, budgets, recipient search, `get_award_detail` verification, `aggregate_contracts` grouping)
  - `tango-tools.ts` - 12 Tango API tools (contracts, grants, vendor profiles, opportunities, spending summaries, GAO protests + detail, IDVs + child/task-order drill-down, vehicle catalog, OTAs, entity time-series metrics). Set-aside filtering is exact on FPDS codes; cursor pagination via the Tango `next` URL.
  - `highergov-tools.ts` - 9 HigherGov tools (forecast/opportunity/contract/people search, saved-search listing, opportunity documents, single-record lookups). Responses are normalized to lowercase agency/vehicle/set-aside slugs via `utils/highergov-slugs.ts`. `get_*` tools cache for 15 min in an in-process LRU.
  - `join-tools.ts` - 2 cross-API tools (entity+awards, opportunity+context)
- Response conventions (see `utils/envelope.ts` and docs/fix-plan.md): every list tool echoes `filters.upstream` vs `filters.client_side`, nulls untrustworthy totals (`total_upstream_unfiltered` / `total_upstream_unverified` + warnings), labels `count_unit` and `date_field`, and returns one `next_cursor` shape. `tools/index.ts` rejects unknown/mistyped parameters with a structured bad_request. `utils/fpds-codes.ts` is the FPDS code table; `docs/upstream-api-notes.md` records which upstream params are verified to bind (run `npm run capture-fixtures` with live keys to re-probe).
- Each tool module exports `getTools()` and `callTool()` methods
- Central registry in `tools/index.ts` manages all tool registration

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
- Require API key (from args or SAM_GOV_API_KEY env var)
- Use GET requests with query parameters
- Return filtered essential fields to minimize token usage

**USASpending.gov Tools**
- No API key required (public API)
- Mix of GET and POST requests
- POST used for complex filtering operations

**Tango API Tools**
- Require API key (from args or TANGO_API_KEY env var)
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
process env keys, overridable by `X-*-Api-Key` headers. Remote callers (OAuth HTTP, Lambda) use ONLY their own keys —
OAuth-sealed, then their headers — never the process env. Tool modules never read `process.env` for keys; `ToolCatalog`
injects the request's key as `api_key`.

The server automatically registers only the tools for which API keys are available.

### Remote Auth (HTTP mode)

`MCP_TRANSPORT=http` fails closed (`httpAuthFromEnv` in `src/http-app.ts`): it needs `MCP_REQUIRE_OAUTH=true` + `OAUTH_TOKEN_SECRET`,
or the explicit single-user `MCP_ALLOW_INSECURE_HTTP=true` (binds 127.0.0.1 unless `HOST` is set).
- `src/auth/mcp-oauth.ts` implements an OAuth 2.1 server with PKCE, dynamic client registration, and AES-256-GCM sealed access/refresh tokens. Each token carries a `keys: { sam?, tango?, highergov? }` map sealed against `OAUTH_TOKEN_SECRET`.
- `GET/POST /oauth/authorize` renders a multi-provider authorization page; users pick checkboxes per provider and supply only the keys they have.
- `POST /mcp` always requires a verified bearer token. Provider-key headers never authenticate a caller; they only add the caller's own key for a provider.
- Per-request precedence: OAuth-sealed key → caller header. Never the server's env.
- The Lambda handler (`src/lambda-handler.ts`) answers 503 on `/mcp` unless `API_KEY_BUCKET` (S3 API-key auth) is configured, and uses only the caller's header keys.
- Tools are registered per request in a `ToolCatalog` (`src/tools/index.ts`); there is no module-level registry, so concurrent requests cannot see each other's tool sets.

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