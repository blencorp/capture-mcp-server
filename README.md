# Capture MCP Server

An MIT-licensed, AI-native Model Context Protocol (MCP) server that integrates SAM.gov, USASpending.gov, and Tango APIs to capture and analyze federal procurement and spending data through natural language queries.

## Overview

Capture MCP empowers non-technical users to capture and query federal entity, opportunity, and spending data through LLM applications like Claude Desktop. It provides 15 specialized tools that can search, analyze, and join data from multiple government APIs.

**Compatible with**: Claude Desktop, ChatGPT Desktop (Pro+), and any MCP-compatible client

## Table of Contents
- [Overview](#overview)
- [Features](#features)
- [Tool Availability Matrix](#tool-availability-matrix)
- [Quick Start](#quick-start)
- [Installation & Setup](#installation--setup)
  - [Standard MCP Configuration](#recommended-standard-mcp-configuration)
  - [Desktop Extension](#alternative-desktop-extension-mcpb-bundle---experimental)
- [Testing & Verification](#testing--verification)
- [Troubleshooting](#troubleshooting)
- [Example Queries](#example-queries)
- [Architecture Overview](#architecture-overview)
- [API Documentation](#api-documentation)
- [Development](#development)
- [Error Handling](#error-handling)
- [Performance](#performance)
- [Contributing](#contributing)
- [License](#license)
- [Support](#support)

## Features

### 🏢 SAM.gov Integration (4 tools)
- **search_sam_entities** - Find federal contractors and businesses
- **get_sam_opportunities** - Discover contract opportunities
- **get_sam_entity_details** - Get comprehensive company profiles
- **check_sam_exclusions** - Verify contractor eligibility

### 💰 USASpending.gov Integration (4 tools)
- **get_usaspending_awards** - Agency award summaries
- **get_usaspending_spending_by_category** - Spending breakdowns
- **get_usaspending_budgetary_resources** - Budget information
- **search_usaspending_awards_by_recipient** - Find awards by company

### 🔗 Data Joining (2 tools)
- **get_entity_and_awards** - Combine SAM entity data with spending history
- **get_opportunity_spending_context** - Link opportunities with market context

### 🎯 Tango API Integration (5 tools)
- **search_tango_contracts** - Search federal contracts through unified API
- **search_tango_grants** - Search federal grants and financial assistance
- **get_tango_vendor_profile** - Get comprehensive vendor profiles with history
- **search_tango_opportunities** - Search contract opportunities with forecasts
- **get_tango_spending_summary** - Get spending summaries and analytics

## Tool Availability Matrix

| API Keys Provided | Tool Sets Enabled | Total Tools |
| --- | --- | --- |
| None | USASpending.gov | 4 |
| `SAM_GOV_API_KEY` | SAM.gov, USASpending.gov, Join tools | 10 |
| `TANGO_API_KEY` | Tango API, USASpending.gov | 9 |
| Both keys | SAM.gov, USASpending.gov, Join tools, Tango API | 15 |

## Quick Start

**Fastest path**: Follow the [Installation & Setup](#installation--setup) section below to configure with Claude Desktop or ChatGPT using standard MCP configuration.

### Prerequisites
- Node.js 18+
- Claude Desktop or ChatGPT Desktop (Pro/Plus/Business/Enterprise/Education)
- **API Keys (Optional - configure based on which tools you need)**:
  - **SAM.gov API key** - Required for SAM.gov tools (4 tools) and Join tools (2 tools) ([Get one here](https://sam.gov/data-services/API))
  - **Tango API key** - Required for Tango tools (5 tools) ([Get one here](https://tango.makegov.com/docs/))
  - **USASpending.gov** - Always available (4 tools, no API key required - public API)

**Note**: The server will automatically enable tools based on which API keys you provide. At minimum, USASpending.gov tools are always available without any API key.

### Installation

1. Clone and install:
```bash
git clone https://github.com/blencorp/capture-mcp-server.git
cd capture-mcp-server
npm install
```

2. Build:
```bash
npm run build
```

3. **Configure with your MCP client** - See [Installation & Setup](#installation--setup) section below for detailed configuration instructions for Claude Desktop or ChatGPT.

## Installation & Setup

This MCP server works with **Claude Desktop**, **ChatGPT Desktop**, and any MCP-compatible client.

### Recommended: Standard MCP Configuration

The standard MCP configuration is the most reliable method and works universally across all MCP clients.

#### Step 1: Build the Server

```bash
npm run build
```

#### Step 2: Configure Your MCP Client

Add the server configuration to your MCP client's config file:

**Claude Desktop** (macOS):
- Config file: `~/Library/Application Support/Claude/claude_desktop_config.json`

**Claude Desktop** (Windows):
- Config file: `%APPDATA%\Claude\claude_desktop_config.json`

**ChatGPT Desktop** (macOS):
- Config file: `~/Library/Application Support/ChatGPT/mcp_config.json`
- Requires: Pro, Plus, Business, Enterprise, or Education subscription

**ChatGPT Desktop** (Windows):
- Config file: `%APPDATA%\ChatGPT\mcp_config.json`
- Requires: Pro, Plus, Business, Enterprise, or Education subscription

#### Step 3: Add Configuration JSON

Add this configuration to your client's config file:

**With all API keys (all 15 tools)**:
```json
{
  "mcpServers": {
    "capture-mcp-server": {
      "command": "node",
      "args": ["/ABSOLUTE/PATH/TO/capture-mcp-server/dist/server.js"],
      "env": {
        "SAM_GOV_API_KEY": "your-sam-api-key-here",
        "TANGO_API_KEY": "your-tango-api-key-here"
      }
    }
  }
}
```

**With only SAM.gov API key (10 tools)**:
```json
{
  "mcpServers": {
    "capture-mcp-server": {
      "command": "node",
      "args": ["/ABSOLUTE/PATH/TO/capture-mcp-server/dist/server.js"],
      "env": {
        "SAM_GOV_API_KEY": "your-sam-api-key-here"
      }
    }
  }
}
```

**With only Tango API key (9 tools)**:
```json
{
  "mcpServers": {
    "capture-mcp-server": {
      "command": "node",
      "args": ["/ABSOLUTE/PATH/TO/capture-mcp-server/dist/server.js"],
      "env": {
        "TANGO_API_KEY": "your-tango-api-key-here"
      }
    }
  }
}
```

**Without API keys (4 USASpending tools only)**:
```json
{
  "mcpServers": {
    "capture-mcp-server": {
      "command": "node",
      "args": ["/ABSOLUTE/PATH/TO/capture-mcp-server/dist/server.js"]
    }
  }
}
```

**Important**: Replace `/ABSOLUTE/PATH/TO/capture-mcp-server` with the actual absolute path to your installation directory.

#### Step 4: Restart Your MCP Client

- **Claude Desktop**: Restart the application
- **ChatGPT Desktop**: Restart the application

Your server should now be available! The tools will appear in the client's tool list.

### Alternative: Desktop Extension (.mcpb Bundle) - Experimental

**Note**: The .mcpb extension format is experimental. If you encounter installation issues, use the standard MCP configuration above instead (which is more reliable).

For one-click installation in Claude Desktop only:

1. **Create the extension package**:
```bash
npm run package:mcpb
```

2. **Install the .mcpb file** in Claude Desktop by dragging the `capture-mcp-server.mcpb` file to the MCP connectors section

The Desktop Extension format provides:
- One-click installation (no manual config editing)
- Custom display name and branding
- Graphical API key configuration
- Bundled dependencies

**Troubleshooting**: If the extension shows "requires update" warnings or won't install, use the standard MCP configuration method above instead. The standard method is more reliable and works with both Claude and ChatGPT.

## Testing & Verification

### Quick Test

After installation, test that your server is working:

**In Claude Desktop or ChatGPT**, try asking:
- *"List the available tools from the Capture MCP Server"*
- *"Search for federal contractors in Virginia"* (tests SAM.gov tools if API key configured)
- *"What was the total spending by agency code 075?"* (tests USASpending tools - works without API keys)

### Using MCP Inspector

For detailed testing without a client:

```bash
# Install MCP Inspector globally
npm install -g @modelcontextprotocol/inspector

# Start the server with Inspector
npx @modelcontextprotocol/inspector node dist/server.js

# Open browser to http://localhost:5173
```

The Inspector provides:
- Visual tool browser
- Interactive tool testing
- Request/response logging
- Environment variable configuration

### Verify Installation

**Check if server is loaded:**

1. **Claude Desktop**:
   - Open Settings → Developer → MCP Servers
   - Look for "capture-mcp-server" in the list
   - Status should show "Connected"

2. **ChatGPT Desktop**:
   - Open Settings → Beta Features → Developer Mode
   - Check MCP Servers section
   - Server should appear as "Connected"

**Check available tools:**

Both clients will show tools in their interface when you start a new conversation. The number of tools visible depends on which API keys you configured (4-15 tools).

## Troubleshooting

### Server Won't Start

**Problem**: Server doesn't appear in client or shows as "Disconnected"

**Solutions**:
1. Verify absolute path in config is correct
2. Ensure `npm run build` completed successfully
3. Check Node.js version: `node --version` (must be ≥18.0.0)
4. Restart the MCP client completely
5. Check client logs for error messages

### No Tools Appearing

**Problem**: Server connects but no tools visible

**Solutions**:
1. Verify API keys are correctly set in the config file
2. At minimum, you should see 4 USASpending tools (no API key required)
3. Check DEBUG mode: Set `"DEBUG": "true"` in env and check logs
4. Try the MCP Inspector to test server directly

### ChatGPT-Specific Issues

**Problem**: ChatGPT says "MCP not available"

**Solutions**:
1. Verify you have a Pro/Plus/Business/Enterprise/Education subscription
2. Ensure ChatGPT Desktop is version ≥1.2025.x (September 2025 or later)
3. Check Settings → Beta Features → Developer Mode is enabled
4. Config file must be named `mcp_config.json` (not `claude_desktop_config.json`)

### Claude Desktop Extension Issues

**Problem**: .mcpb extension shows "requires update" or won't install

**Solutions**:
1. **Recommended**: Use standard MCP configuration instead (see above)
2. Ensure Claude Desktop is fully updated
3. Try removing any partial installation first
4. Clear extension cache: Restart Claude Desktop
5. Use `mcpb validate manifest.json` to check for issues

### API Key Issues

**Problem**: Tools requiring API keys return errors

**Solutions**:
1. Verify API keys are valid and active
2. Check API key permissions on SAM.gov or Tango portals
3. Ensure no extra spaces in the config JSON
4. For SAM.gov: May take 24 hours after creation for key to activate
5. Test API keys directly with curl before using in MCP

### Path Issues

**Problem**: "Cannot find module" or "ENOENT" errors

**Solutions**:
1. Use absolute paths (starting with `/` on macOS/Linux or `C:\` on Windows)
2. Avoid `~` or environment variables in paths
3. Escape spaces in paths with quotes: `"/path/with spaces/dist/server.js"`
4. Verify `dist/` directory exists and contains `server.js`

## Example Queries

### General Queries (Works in Claude & ChatGPT)

Once integrated, you can ask natural language questions like:

- *"Find janitorial service contracts awarded to service-disabled veteran-owned businesses in the past 6 months"*
- *"What's the total federal spending on cybersecurity contracts in fiscal year 2023?"*
- *"List all 8(a) set-aside opportunities from federal agencies posted in the last 30 days"*
- *"What was the total obligated spending by HHS on cloud computing last fiscal year?"*
- *"Show me recent contract awards for 'penetration testing' under $250,000"*
- *"Find food service and catering contracts awarded to small businesses"*
- *"What are the active landscaping maintenance contracts in Florida?"*
- *"Show me building maintenance and repair contracts over $100,000 awarded this year"*

### ChatGPT-Specific Testing

If you're using ChatGPT Desktop, here are specific queries to test each tool category:

**Test USASpending Tools (No API key required)**:
```
Using the Capture MCP Server, get the spending breakdown
by category for agency code 075 (HHS) for fiscal year 2024
```

**Test SAM.gov Tools (Requires SAM_GOV_API_KEY)**:
```
Using the SAM tools, search for entities in California
that work in NAICS code 541512 (computer systems design)
```

**Test Tango Tools (Requires TANGO_API_KEY)**:
```
Using Tango, search for recent federal grants in the
field of renewable energy
```

**Test Join Tools (Requires SAM_GOV_API_KEY)**:
```
Using the join tools, get both the SAM entity details
and award history for UEI: [insert-uei-here]
```

### Working with Multiple Tools

Both Claude and ChatGPT can chain tool calls together. Try complex queries like:

```
Find all IT consulting companies registered in Virginia using SAM,
then check their federal contract history for the past year using
USASpending, and summarize the results
```

This will automatically use multiple tools in sequence to gather comprehensive data.

## Architecture Overview

### Deployment Modes

The Capture MCP Server can be deployed in two ways:

**1. Standard MCP Server** (Recommended for most users)
- Works with any MCP-compatible client (Claude Desktop, ChatGPT, etc.)
- Uses standard JSON configuration files
- Requires manual setup but offers maximum flexibility
- Supports all API keys via environment variables

**2. Desktop Extension (.mcpb Bundle)**
- One-click installation for Claude Desktop
- Graphical UI for API key configuration
- Bundles all dependencies
- Enhanced branding and metadata
- Currently Claude Desktop only (ChatGPT uses standard MCP config)

### Technical Architecture

Capture MCP Server follows a modular tool architecture designed for clarity and extensibility:

- **Server core (`src/server.ts`)** handles MCP transport, tool registration, and request routing.
- **Tool registry (`src/tools/index.ts`)** dynamically enables tool sets based on available API keys.
- **Tool modules (`src/tools/*.ts`)** encapsulate domain-specific logic for SAM.gov, USASpending.gov, Tango, and cross-API joins.
- **Shared utilities (`src/utils/api-client.ts`)** provide rate-limited HTTP access with consistent error handling.
- **Desktop extension assets (`manifest.json`, `assets/`)** deliver a polished Claude Desktop experience with branding and metadata.

## API Documentation

### SAM.gov Tools

#### search_sam_entities
Search for federal contractors and businesses.
- **Required**: `api_key`
- **Optional**: `query`, `state`, `naics`, `uei`, `limit`

#### get_sam_opportunities  
Find federal contract opportunities.
- **Required**: `api_key`, `posted_from`, `posted_to`
- **Optional**: `keyword`, `set_aside`, `state`, `limit`

#### get_sam_entity_details
Get comprehensive details for a specific entity.
- **Required**: `api_key`, `uei`

#### check_sam_exclusions
Check if an entity is excluded from federal contracting.
- **Required**: `api_key`
- **Optional**: `uei`, `entity_name`

### USASpending.gov Tools

#### get_usaspending_awards
Get agency award summaries.
- **Required**: `agency_code`
- **Optional**: `fiscal_year`, `limit`

#### get_usaspending_spending_by_category
Get spending breakdown by category.
- **Required**: `agency_code`
- **Optional**: `fiscal_year`

#### get_usaspending_budgetary_resources
Get agency budget information.
- **Required**: `agency_code`
- **Optional**: `fiscal_year`

#### search_usaspending_awards_by_recipient
Search awards by recipient name.
- **Required**: `recipient_name`
- **Optional**: `fiscal_year`, `min_amount`, `max_amount`, `award_types`, `limit`

### Join Tools

#### get_entity_and_awards
Combine SAM entity data with USASpending award history.
- **Required**: `api_key`, `uei`
- **Optional**: `fiscal_year`, `award_limit`

#### get_opportunity_spending_context
Link opportunities with historical spending context.
- **Required**: `api_key`
- **Required One Of**: `opportunity_id` OR `solicitation_number`
- **Optional**: `fiscal_year`

### Tango API Tools

#### search_tango_contracts
Search federal contracts through Tango's unified API.
- **Required**: `api_key`
- **Optional**: `query`, `vendor_name`, `vendor_uei`, `agency`, `naics_code`, `psc_code`, `award_amount_min`, `award_amount_max`, `date_from`, `date_to`, `set_aside`, `limit`

#### search_tango_grants
Search federal grants and financial assistance.
- **Required**: `api_key`
- **Optional**: `query`, `recipient_name`, `recipient_uei`, `agency`, `cfda_number`, `award_amount_min`, `award_amount_max`, `date_from`, `date_to`, `limit`

#### get_tango_vendor_profile
Get comprehensive vendor/entity profile with history.
- **Required**: `api_key`, `uei`
- **Optional**: `include_contracts`, `include_grants`

#### search_tango_opportunities
Search federal contract opportunities with forecasts.
- **Required**: `api_key`
- **Optional**: `query`, `agency`, `naics_code`, `set_aside`, `posted_from`, `posted_to`, `response_deadline_from`, `status`, `limit`

#### get_tango_spending_summary
Get spending summaries and analytics.
- **Required**: `api_key`
- **Optional**: `agency`, `vendor_uei`, `fiscal_year`, `group_by`, `award_type`

## Development

```bash
# Development mode with auto-reload
npm run dev

# Build TypeScript
npm run build

# Run built server
npm start

# Package as .dxt (legacy format for backwards compatibility)
npm run package

# Package as .mcpb (recommended Desktop Extension format with bundled dependencies)
npm run package:mcpb
```

**Note**: The `.mcpb` format includes node_modules and follows the official Anthropic Desktop Extensions specification v0.3. Use this for Claude Desktop installations. For ChatGPT or other MCP clients, use the standard MCP server configuration instead.

### Testing with MCP Inspector

The [MCP Inspector](https://github.com/modelcontextprotocol/inspector) is a powerful debugging tool for MCP servers. It provides a web-based interface to test your tools without needing Claude Desktop.

#### Running with Inspector

1. **Install MCP Inspector globally**:
```bash
npm install -g @modelcontextprotocol/inspector
```

2. **Start the MCP server with Inspector**:
```bash
npx @modelcontextprotocol/inspector node dist/server.js
```

3. **Open the Inspector interface**:
   - Navigate to http://localhost:5173 in your browser
   - The Inspector will automatically connect to your MCP server

4. **Configure environment variables** (optional):
   - Click on the "Environment" tab in the Inspector
   - Add your `SAM_GOV_API_KEY` and/or `TANGO_API_KEY` environment variables as needed
   - Without API keys, you'll have access to 4 USASpending.gov tools

#### Using the Inspector

The MCP Inspector allows you to:
- **View available tools**: See available tools (4-15 depending on API keys configured)
- **Test tool calls**: Execute tools directly with a user-friendly form interface
- **Inspect responses**: View formatted JSON responses and error messages
- **Debug issues**: See detailed request/response logs for troubleshooting

Example workflow:
1. Select a tool like `search_sam_entities` from the tools list
2. Fill in the required parameters (e.g., `api_key`, `query`)
3. Click "Execute" to run the tool
4. View the response in the output panel

This is especially useful for:
- Testing new tool implementations
- Debugging API integration issues
- Understanding tool schemas and responses
- Demonstrating capabilities to stakeholders

## Error Handling

The server implements comprehensive error handling:
- **Rate limiting** for both APIs
- **Input sanitization** and validation
- **Structured JSON error responses**
- **Graceful degradation** when APIs are unavailable

## Performance

- **Token optimized**: Responses filtered to essential fields
- **Rate limited**: Respects API limits (SAM: key-dependent, USASpending: ~1000/hr)
- **Async operations**: All API calls are non-blocking
- **Pagination**: Default limits prevent oversized responses

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## License

This project is open source under the MIT License. See `LICENSE` for the full text.

## Support

For issues, questions, or contributions, please visit our [GitHub repository](https://github.com/blencorp/capture-mcp-server).

---

Built with ❤️ by [BLEN](https://www.blencorp.com).

## About BLEN

BLEN, Inc is a digital services company that provides Emerging Technology (ML/AI, RPA), Digital Modernization (Legacy to Cloud) and Human-Centered Web/Mobile Design and Development.

*Happy hunting!* 🎯
