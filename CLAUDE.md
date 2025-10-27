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

This is a Model Context Protocol (MCP) server that captures federal procurement and spending data through 15 specialized tools. The architecture follows a modular tool-based design:

### Core Components

**Server (`src/server.ts`)**
- MCP server using `@modelcontextprotocol/sdk`
- Uses stdio transport for Claude Desktop integration
- Handles tool registration and execution through centralized registry

**Tool Architecture (`src/tools/`)**
- Modular tool system with four categories:
  - `sam-tools.ts` - 4 SAM.gov API tools (entities, opportunities, details, exclusions)
  - `usaspending-tools.ts` - 4 USASpending.gov API tools (awards, spending, budgets, recipient search)
  - `tango-tools.ts` - 5 Tango API tools (contracts, grants, vendor profiles, opportunities, spending summaries)
  - `join-tools.ts` - 2 cross-API tools (entity+awards, opportunity+context)
- Each tool module exports `getTools()` and `callTool()` methods
- Central registry in `tools/index.ts` manages all tool registration

**API Client (`src/utils/api-client.ts`)**
- Centralized HTTP client with rate limiting
- SAM.gov: 100ms delay between calls
- USASpending.gov: 3.6s delay (respects ~1000/hour limit)
- Tango API: 100ms delay between calls
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

**Tool Availability Based on API Keys**:
- **No keys**: 4 USASpending.gov tools (public API)
- **SAM_GOV_API_KEY only**: 10 tools (4 SAM + 4 USASpending + 2 Join)
- **TANGO_API_KEY only**: 9 tools (5 Tango + 4 USASpending)
- **Both keys**: All 15 tools

The server automatically registers only the tools for which API keys are available.

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