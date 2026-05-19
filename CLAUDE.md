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

This is a Model Context Protocol (MCP) server that captures federal procurement and spending data through 21 specialized tools. The architecture follows a modular tool-based design:

### Core Components

**Server (`src/server.ts`)**
- MCP server using `@modelcontextprotocol/sdk`
- Uses stdio transport for Claude Desktop integration
- Handles tool registration and execution through centralized registry

**Tool Architecture (`src/tools/`)**
- Modular tool system with five categories:
  - `sam-tools.ts` - 4 SAM.gov API tools (entities, opportunities, details, exclusions)
  - `usaspending-tools.ts` - 4 USASpending.gov API tools (awards, spending, budgets, recipient search)
  - `tango-tools.ts` - 5 Tango API tools (contracts, grants, vendor profiles, opportunities, spending summaries)
  - `highergov-tools.ts` - 6 HigherGov tools (forecast search, opportunity/contract/person lookups, contract/people search). Responses are normalized to lowercase agency/vehicle/set-aside slugs via `utils/highergov-slugs.ts`. `get_*` tools cache for 15 min in an in-process LRU.
  - `join-tools.ts` - 2 cross-API tools (entity+awards, opportunity+context)
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

**Tool Availability Based on API Keys** (USASpending is always available):
- 4 SAM + 2 Join when `SAM_GOV_API_KEY` is set
- 5 Tango when `TANGO_API_KEY` is set
- 6 HigherGov when `HIGHERGOV_API_KEY` is set
- All 21 tools when all three keys are set

HTTP header overrides (precedence over env vars) — used by remote MCP clients:
`X-Sam-Api-Key`, `X-Tango-Api-Key`, `X-Highergov-Api-Key`.

The server automatically registers only the tools for which API keys are available.

### Remote Auth (HTTP mode)

When `MCP_TRANSPORT=http` and `MCP_REQUIRE_OAUTH=true`:
- `src/auth/mcp-oauth.ts` implements an OAuth 2.1 server with PKCE, dynamic client registration, and AES-256-GCM sealed access/refresh tokens. Each token carries a `keys: { sam?, tango?, highergov? }` map sealed against `OAUTH_TOKEN_SECRET`.
- `GET/POST /oauth/authorize` renders a multi-provider authorization page; users pick checkboxes per provider and supply only the keys they have.
- `POST /mcp` is gated by `requireBearerAuth` UNLESS the caller presents an `X-Sam-Api-Key` / `X-Tango-Api-Key` / `X-Highergov-Api-Key` header. Header presence bypasses OAuth for programmatic clients — the key itself is the trust anchor.
- Precedence per request: OAuth-sealed key → header → env var.

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
        "TANGO_API_KEY": "your-tango-api-key"
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