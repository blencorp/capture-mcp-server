# Capture MCP Server

An AI-native Model Context Protocol (MCP) server that integrates SAM.gov, USASpending.gov, and Tango APIs to capture and analyze federal procurement and spending data through natural language queries.

## Overview

Capture MCP empowers non-technical users to capture and query federal entity, opportunity, and spending data through LLM applications like Claude Desktop. It provides 15 specialized tools that can search, analyze, and join data from multiple government APIs.

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

## Quick Start

### Prerequisites
- Node.js 18+
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

2. Configure environment (optional):
```bash
cp .env.example .env
# Edit .env and add your API keys (one, both, or neither)
# - SAM_GOV_API_KEY: Enables SAM.gov and Join tools
# - TANGO_API_KEY: Enables Tango API tools
# - No keys: Only USASpending.gov tools available (4 tools)
```

3. Build and start:
```bash
npm run build
npm start
```

### Claude Desktop Integration

#### Option 1: Standard MCP Server
Add to your Claude Desktop MCP settings:

**With all API keys (all 15 tools)**:
```json
{
  "mcpServers": {
    "capture-mcp-server": {
      "command": "node",
      "args": ["/path/to/capture-mcp-server/dist/server.js"],
      "env": {
        "SAM_GOV_API_KEY": "your-sam-api-key-here",
        "TANGO_API_KEY": "your-tango-api-key-here"
      }
    }
  }
}
```

**With only SAM.gov API key (10 tools: SAM + USASpending + Join)**:
```json
{
  "mcpServers": {
    "capture-mcp-server": {
      "command": "node",
      "args": ["/path/to/capture-mcp-server/dist/server.js"],
      "env": {
        "SAM_GOV_API_KEY": "your-sam-api-key-here"
      }
    }
  }
}
```

**With only Tango API key (9 tools: Tango + USASpending)**:
```json
{
  "mcpServers": {
    "capture-mcp-server": {
      "command": "node",
      "args": ["/path/to/capture-mcp-server/dist/server.js"],
      "env": {
        "TANGO_API_KEY": "your-tango-api-key-here"
      }
    }
  }
}
```

**Without API keys (4 tools: USASpending only)**:
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

#### Option 2: Desktop Extension (Recommended)
For enhanced branding with custom logo and display name:

1. **Create the extension package**:
```bash
npm run build
zip -r capture-mcp-server.dxt dist/ manifest.json assets/
```

2. **Install the .dxt file** in Claude Desktop by dragging the `capture-mcp-server.dxt` file to the MCP connectors section

The Desktop Extension format provides:
- Custom display name: "Capture MCP Server"
- Professional logo and branding
- Rich metadata and descriptions
- Enhanced user experience

## Example Queries

Once integrated with Claude Desktop, you can ask natural language questions like:

- *"Find janitorial service contracts awarded to service-disabled veteran-owned businesses in the past 6 months"*
- *"What's the total federal spending on cybersecurity contracts in fiscal year 2023?"*
- *"List all 8(a) set-aside opportunities from federal agencies posted in the last 30 days"*
- *"What was the total obligated spending by HHS on cloud computing last fiscal year?"* 
- *"Show me recent contract awards for 'penetration testing' under $250,000"*
- *"Find food service and catering contracts awarded to small businesses"*
- *"What are the active landscaping maintenance contracts in Florida?"*
- *"Show me building maintenance and repair contracts over $100,000 awarded this year"*

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
```

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

MIT License - see LICENSE file for details.

## Support

For issues, questions, or contributions, please visit our [GitHub repository](https://github.com/blencorp/capture-mcp-server).

---

Built with ❤️ by [BLEN](https://www.blencorp.com).

## About BLEN

BLEN, Inc is a digital services company that provides Emerging Technology (ML/AI, RPA), Digital Modernization (Legacy to Cloud) and Human-Centered Web/Mobile Design and Development.

*Happy hunting!* 🎯