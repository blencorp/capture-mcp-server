# Capture MCP Server

An MIT-licensed, AI-native Model Context Protocol (MCP) server that integrates SAM.gov, USASpending.gov, and Tango APIs to capture and analyze federal procurement and spending data through natural language queries. Responses include both human-readable text and structured JSON so MCP-compatible clients can consume the data programmatically.

## Overview

Capture MCP empowers users to capture and query federal entity, opportunity, and spending data through LLM applications like Claude Desktop. It provides 15 specialized tools that can search, analyze, and join data from multiple government APIs.

**Compatible with**: Claude Desktop, ChatGPT Desktop (Pro+), and any MCP-compatible client

## Table of Contents
- [Features](#features)
- [Tool Availability Matrix](#tool-availability-matrix)
- [Quick Start](#quick-start)
- [Installation Methods](#installation-methods)
  - [Method 1: One-Click Installation (Claude Desktop)](#method-1-one-click-installation-claude-desktop)
  - [Method 2: Standard MCP Configuration](#method-2-standard-mcp-configuration-recommended)
- [API Keys](#api-keys)
- [Testing & Verification](#testing--verification)
- [Troubleshooting](#troubleshooting)
- [Example Queries](#example-queries)
- [API Documentation](#api-documentation)
- [Development](#development)
- [Contributing](#contributing)
- [License](#license)
- [Support](#support)

## Features

- **Structured outputs** – Every tool call returns JSON alongside descriptive text for best-in-class client compatibility.
- **Safe rate limiting** – Queue-based throttling prevents accidental quota overruns on SAM.gov, USASpending.gov, and Tango APIs.
- **Input hygiene** – Argument sanitization strips control characters while keeping meaningful punctuation intact.

### USASpending.gov Integration (4 tools - No API key required)
- `get_usaspending_awards` - Agency award summaries
- `get_usaspending_spending_by_category` - Spending breakdowns
- `get_usaspending_budgetary_resources` - Budget information
- `search_usaspending_awards_by_recipient` - Find awards by company

### SAM.gov Integration (4 tools - Requires SAM.gov API key)
- `search_sam_entities` - Find federal contractors and businesses
- `get_sam_opportunities` - Discover contract opportunities
- **`get_sam_entity_details`** - Get comprehensive company profiles
- `check_sam_exclusions` - Verify contractor eligibility

### Data Joining (2 tools - Requires SAM.gov API key)
- `get_entity_and_awards` - Combine SAM entity data with spending history
- `get_opportunity_spending_context` - Link opportunities with market context

### Tango API Integration (5 tools - Requires Tango API key)
- `search_tango_contracts` - Search federal contracts through unified API
- `search_tango_grants` - Search federal grants and financial assistance
- `get_tango_vendor_profile` - Get comprehensive vendor profiles with history
- `search_tango_opportunities` - Search contract opportunities with forecasts
- `get_tango_spending_summary` - Get spending summaries and analytics

## Tool Availability Matrix

The server automatically enables tools based on which API keys you provide:

| API Keys Provided | Tool Sets Enabled | Total Tools |
| --- | --- | --- |
| **None** (works out of the box) | USASpending.gov | **4 tools** |
| `SAM_GOV_API_KEY` only | SAM.gov + USASpending.gov + Join tools | **10 tools** |
| `TANGO_API_KEY` only | Tango API + USASpending.gov | **9 tools** |
| **Both keys** | All tool sets | **15 tools** |

## Quick Start

### Prerequisites
- **Node.js 18+** (included with Claude Desktop for .mcpb installation)
- **Claude Desktop** or **ChatGPT Desktop** (Pro/Plus/Business/Enterprise/Education)
- **API Keys** (Optional - see [API Keys](#api-keys) section):
  - None required: 4 USASpending.gov tools work immediately
  - SAM.gov API key: Adds 6 more tools (10 total)
  - Tango API key: Adds 5 more tools (9 total)
  - Both keys: All 15 tools

### Choose Your Installation Method

**For Claude Desktop users**: Use [Method 1: One-Click Installation](#method-1-one-click-installation-claude-desktop) for the easiest setup with a graphical API key configuration interface.

**For ChatGPT Desktop or other MCP clients**: Use [Method 2: Standard MCP Configuration](#method-2-standard-mcp-configuration-recommended) which works universally across all MCP-compatible applications.

## Installation Methods

### Method 1: One-Click Installation (Claude Desktop)

**Desktop Extensions** (`.mcpb` files) provide the easiest installation experience for Claude Desktop users. No terminal, no configuration files, no dependency conflicts.

#### What is a Desktop Extension?

A `.mcpb` file is a bundled MCP server package (similar to a Chrome extension or VS Code extension) that contains:
- The complete MCP server code
- All dependencies pre-installed
- Configuration metadata and branding
- Installation prompts for API keys

#### Installation Steps

**Step 1: Build the Extension Package**

```bash
# Clone the repository
git clone https://github.com/blencorp/capture-mcp-server.git
cd capture-mcp-server

# Install dependencies
npm install

# Create the .mcpb package
npm run package
```

This creates `capture-mcp-server.mcpb` (~4.2MB) in the current directory.

**Step 2: Install in Claude Desktop**

**Option A: Double-click Installation**
1. Locate the `capture-mcp-server.mcpb` file
2. Double-click the file to open with Claude Desktop
3. Click "Install" in the installation dialog

**Option B: Settings Installation**
1. Open Claude Desktop
2. Go to **Settings** → **Extensions** (or **Developer** → **Edit Config**)
3. Click "Install Extension..." or drag the `.mcpb` file into the settings window
4. Click "Install" when prompted

**Step 3: Configure API Keys (Optional)**

During or after installation, Claude Desktop will prompt you to configure API keys:

- **Skip all keys**: Click "Continue" without entering keys → 4 USASpending.gov tools available immediately
- **Enter one key**: Provide either SAM.gov or Tango key → 9-10 tools available
- **Enter both keys**: Provide both keys → All 15 tools available

You can add or update API keys later via **Settings** → **Extensions** → **Capture MCP Server** → **Configure**.

**Step 4: Verify Installation**

1. Restart Claude Desktop
2. Open Settings → Extensions (or Developer → MCP Servers)
3. Verify "Capture MCP Server" shows as "Connected"
4. Start a new conversation and ask: *"What tools are available from Capture MCP Server?"*

#### Important Notes for .mcpb Installation

**Compatibility Warning**: The `.mcpb` format requires Claude Desktop v1.0.0 or later. If you see errors like "This extension requires an update to Claude Desktop" or "Unrecognized key(s)", please:
1. Update Claude Desktop to the latest version, OR
2. Use [Method 2: Standard MCP Configuration](#method-2-standard-mcp-configuration-recommended) instead

**Why Node.js?** This server is built in Node.js because Claude Desktop bundles Node.js on macOS and Windows, meaning the extension works immediately without requiring users to install Python or other runtimes.

### Method 2: Standard MCP Configuration (Recommended)

Standard MCP configuration is the most reliable method and works universally across all MCP clients including Claude Desktop, ChatGPT Desktop, and custom implementations.

#### Step 1: Clone and Build

```bash
# Clone the repository
git clone https://github.com/blencorp/capture-mcp-server.git
cd capture-mcp-server

# Install dependencies
npm install

# Build TypeScript to JavaScript
npm run build
```

This creates compiled JavaScript files in the `dist/` directory.

#### Step 2: Locate Your MCP Configuration File

**Claude Desktop (macOS)**:
```
~/Library/Application Support/Claude/claude_desktop_config.json
```

**Claude Desktop (Windows)**:
```
%APPDATA%\Claude\claude_desktop_config.json
```

**ChatGPT Desktop (macOS)**:
```
~/Library/Application Support/ChatGPT/mcp_config.json
```

**ChatGPT Desktop (Windows)**:
```
%APPDATA%\ChatGPT\mcp_config.json
```

**Note**: For ChatGPT Desktop, you need a Pro, Plus, Business, Enterprise, or Education subscription. Check Settings → Beta Features → Developer Mode to enable MCP support.

#### Step 3: Add Server Configuration

Open your MCP configuration file and add the Capture MCP Server configuration. Choose the appropriate configuration based on which API keys you have:

**Configuration A: No API Keys (4 USASpending.gov tools)**

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

**Configuration B: SAM.gov API Key Only (10 tools)**

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

**Configuration C: Tango API Key Only (9 tools)**

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

**Configuration D: Both API Keys (All 15 tools)**

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

**Critical**: Replace `/ABSOLUTE/PATH/TO/capture-mcp-server` with the actual absolute path to where you cloned the repository.

Examples:
- macOS: `/Users/yourname/projects/capture-mcp-server`
- Windows: `C:\Users\yourname\projects\capture-mcp-server`

#### Step 4: Restart Your MCP Client

- **Claude Desktop**: Quit completely (Cmd+Q on macOS) and reopen
- **ChatGPT Desktop**: Quit completely and reopen

#### Step 5: Verify Installation

**In Claude Desktop**:
1. Open Settings → Developer → MCP Servers
2. Look for "capture-mcp-server" with status "Connected"

**In ChatGPT Desktop**:
1. Open Settings → Beta Features → Developer Mode
2. Check MCP Servers section shows "capture-mcp-server" as "Connected"

**Test the connection**:
Ask in a new conversation: *"List all available tools from the Capture MCP Server"*

You should see 4-15 tools listed depending on your API key configuration.

## API Keys

### Why Are API Keys Optional?

This server is designed with flexibility in mind:
- **USASpending.gov** provides a public API that requires no authentication
- **SAM.gov** and **Tango** require API keys for access to their data

You can start using the server immediately with 4 USASpending.gov tools, then add API keys later to unlock additional capabilities.

### How to Get API Keys

#### SAM.gov API Key (Enables 6 additional tools)

**Time to obtain**: ~24 hours for activation

1. **Create SAM.gov Account**:
   - Visit https://sam.gov/content/home
   - Click "Sign In" → "Create Account"
   - Complete registration and email verification

2. **Request API Access**:
   - Log in to SAM.gov
   - Navigate to https://sam.gov/data-services/API
   - Click "Request Public API Key"
   - Accept terms and conditions

3. **Retrieve Your API Key**:
   - API key will be sent to your registered email
   - Key may take up to 24 hours to activate
   - Key is linked to your SAM.gov account

4. **API Key Details**:
   - **Format**: 64-character alphanumeric string
   - **Rate Limits**: Varies by endpoint (typically 1,000-10,000 requests/day)
   - **Cost**: Free
   - **Documentation**: https://open.gsa.gov/api/entity-api/

**Enables these tools**:
- 4 SAM.gov tools (entities, opportunities, details, exclusions)
- 2 Join tools (entity+awards, opportunity+context)

#### Tango API Key (Enables 5 additional tools)

**Time to obtain**: Immediate upon approval

1. **Visit Tango Website**:
   - Go to https://tango.makegov.com

2. **Request Access**:
   - Click "Get API Access" or "Sign Up"
   - Fill out the request form
   - Provide use case details

3. **Receive API Key**:
   - API key provided after account approval
   - Typically immediate for approved users

4. **API Key Details**:
   - **Format**: Variable-length string
   - **Rate Limits**: Check your account dashboard
   - **Cost**: Check pricing at https://tango.makegov.com/pricing
   - **Documentation**: https://tango.makegov.com/docs/

**Enables these tools**:
- 5 Tango tools (contracts, grants, vendor profiles, opportunities, spending summaries)

### Managing API Keys

#### Standard MCP Configuration
Edit your MCP config file and update the `env` section with your keys. Restart your client after updating.

#### Desktop Extension (.mcpb)
1. Open Claude Desktop → Settings → Extensions
2. Click on "Capture MCP Server"
3. Click "Configure"
4. Update API key fields
5. Click "Save"
6. Claude Desktop will automatically restart the server

**Security Note**: Both methods store API keys securely:
- Standard config: Stored in your local config file (accessible only to you)
- Desktop extension: Stored in OS keychain (macOS/Windows credential manager)

## Testing & Verification

### Quick Test Queries

After installation, test that your server is working by asking these questions:

#### Test Without API Keys (USASpending.gov tools)
```
Using the Capture MCP Server, get the spending breakdown by category
for agency code 075 (Department of Health and Human Services) for
fiscal year 2024
```

#### Test SAM.gov Tools (Requires SAM_GOV_API_KEY)
```
Using the SAM tools, search for entities in California that work
in NAICS code 541512 (computer systems design services)
```

#### Test Tango Tools (Requires TANGO_API_KEY)
```
Using Tango, search for recent federal grants in renewable energy
```

#### Test Join Tools (Requires SAM_GOV_API_KEY)
```
Using the join tools, get both SAM entity details and award history
for UEI: KAR6JDB1HJ16
```

### Using MCP Inspector

The [MCP Inspector](https://github.com/modelcontextprotocol/inspector) provides a web-based debugging interface for testing tools without Claude Desktop or ChatGPT.

**Step 1: Install MCP Inspector**

```bash
npm install -g @modelcontextprotocol/inspector
```

**Step 2: Start Server with Inspector**

```bash
npx @modelcontextprotocol/inspector node dist/server.js
```

**Step 3: Open Web Interface**

Navigate to http://localhost:5173 in your browser.

**Step 4: Configure API Keys (Optional)**

1. Click the "Environment" tab
2. Add environment variables:
   - `SAM_GOV_API_KEY`: your-key-here
   - `TANGO_API_KEY`: your-key-here
3. Restart the inspector

**Step 5: Test Tools**

1. View available tools (4-15 depending on API keys)
2. Click a tool to see its schema
3. Fill in parameters and click "Execute"
4. View responses and debug any issues

The Inspector is especially useful for:
- Testing new tool implementations
- Debugging API integration issues
- Understanding tool parameters and responses
- Demonstrating capabilities without Claude Desktop

## Troubleshooting

### Server Won't Start

**Symptom**: Server doesn't appear in client or shows as "Disconnected"

**Solutions**:

1. **Verify Build**:
   ```bash
   cd /path/to/capture-mcp-server
   npm run build
   ```
   Ensure build completes without errors.

2. **Check Node.js Version**:
   ```bash
   node --version
   ```
   Must be ≥18.0.0. Update Node.js if needed.

3. **Verify Absolute Path**:
   - Open your MCP config file
   - Ensure the path starts with `/` (macOS/Linux) or `C:\` (Windows)
   - Path should NOT use `~` or environment variables
   - Path should NOT be relative (e.g., `./dist/server.js`)

4. **Check for Typos**:
   - Verify `dist/server.js` exists at the specified path
   - Check JSON syntax (no trailing commas, matching braces)

5. **Restart Client Completely**:
   - Quit the application entirely (not just close window)
   - Reopen and check connection status

6. **Check Client Logs**:
   - **Claude Desktop**: Settings → Developer → View Logs
   - **ChatGPT Desktop**: Check application logs
   - Look for error messages related to "capture-mcp-server"

### No Tools Appearing

**Symptom**: Server connects but no tools are visible

**Solutions**:

1. **Verify API Keys** (if using them):
   - Check for typos in API key values
   - Ensure no extra spaces or quotes
   - Verify keys are active (SAM.gov keys take 24 hours to activate)

2. **Confirm Minimum Tool Set**:
   - Without ANY keys, you should see 4 USASpending.gov tools
   - If you see 0 tools, the server isn't loading correctly

3. **Test with Inspector**:
   ```bash
   npx @modelcontextprotocol/inspector node dist/server.js
   ```
   This will show exactly which tools are loading and any errors.

4. **Enable Debug Mode**:
   Add to your env configuration:
   ```json
   "env": {
     "DEBUG": "true"
   }
   ```
   Check logs for detailed error messages.

### Desktop Extension (.mcpb) Installation Issues

**Symptom**: "This extension requires an update to Claude Desktop" or "Unrecognized key(s)"

**Explanation**: The `.mcpb` format specification has evolved. Some versions of Claude Desktop may support different manifest versions.

**Solutions**:

1. **Update Claude Desktop** (Recommended):
   - Check for updates: Settings → About
   - Update to the latest version
   - Try installing the .mcpb again

2. **Use Standard MCP Configuration** (Always Works):
   - Skip the .mcpb installation
   - Use [Method 2: Standard MCP Configuration](#method-2-standard-mcp-configuration-recommended)
   - Standard configuration is more reliable and works with all clients

3. **Verify Manifest Version**:
   If you're building from source, check `manifest.json`:
   ```json
   "manifest_version": "0.2"
   ```
   Some Claude Desktop versions require `"0.2"` instead of `"0.3"`

4. **Rebuild Package**:
   ```bash
   npm run build
   npm run package
   ```
   Try installing the freshly built .mcpb file.

5. **Check Icon File**:
   Ensure `icon.png` exists in the root directory (not in subdirectories).

### API Key Issues

**Symptom**: Tools requiring API keys return errors like "Unauthorized" or "Invalid API key"

**Solutions**:

1. **Verify Key Validity**:
   Test your SAM.gov API key:
   ```bash
   curl "https://api.sam.gov/entity-information/v3/entities?api_key=YOUR_KEY&limit=1"
   ```
   Should return JSON data, not an error.

2. **Check SAM.gov Key Activation**:
   - SAM.gov keys can take up to 24 hours to activate after creation
   - Wait and try again later if key is newly created

3. **Remove Extra Characters**:
   - API keys should have no spaces, quotes, or newlines
   - Copy key carefully from source
   - In JSON config, key should be inside quotes: `"SAM_GOV_API_KEY": "abc123..."`

4. **Verify Key Permissions**:
   - Log in to SAM.gov to check API key status
   - Ensure key has necessary permissions enabled

5. **Test with MCP Inspector**:
   - Use Inspector to test API calls directly
   - View exact error messages from API

### ChatGPT Desktop Issues

**Symptom**: "MCP not available" in ChatGPT Desktop

**Solutions**:

1. **Verify Subscription**:
   - Requires Pro, Plus, Business, Enterprise, or Education subscription
   - Free tier does NOT support MCP

2. **Enable Developer Mode**:
   - Settings → Beta Features
   - Toggle on "Developer Mode"

3. **Check ChatGPT Version**:
   - Requires ChatGPT Desktop ≥1.2025.x (September 2025+)
   - Update if needed: Help → Check for Updates

4. **Use Correct Config File**:
   - Must be `mcp_config.json` (NOT `claude_desktop_config.json`)
   - Location: `~/Library/Application Support/ChatGPT/mcp_config.json`

5. **Verify JSON Structure**:
   ChatGPT uses the same MCP config format as Claude Desktop:
   ```json
   {
     "mcpServers": {
       "capture-mcp-server": { ... }
     }
   }
   ```

### Rate Limiting Issues

**Symptom**: Tools return errors like "Too Many Requests" or "Rate limit exceeded"

**Solutions**:

1. **Built-in Rate Limiting**:
   This server includes automatic rate limiting:
   - SAM.gov: 100ms delay between requests
   - USASpending.gov: 3.6s delay (respects ~1000/hour limit)
   - Tango: 100ms delay between requests

2. **Reduce Query Frequency**:
   - Avoid rapid-fire queries
   - Use `limit` parameters to reduce result sizes
   - Combine queries where possible

3. **Check API Quotas**:
   - SAM.gov: Check your key's daily limit
   - Tango: Check your account dashboard

4. **Wait and Retry**:
   - Rate limits typically reset hourly or daily
   - Wait 1 hour and try again

## Example Queries

Once installed, you can ask natural language questions. The LLM will automatically select and use the appropriate tools.

### General Business Intelligence

```
Find janitorial service contracts awarded to service-disabled
veteran-owned businesses in the past 6 months
```

```
What's the total federal spending on cybersecurity contracts
in fiscal year 2023?
```

```
List all 8(a) set-aside opportunities from federal agencies
posted in the last 30 days
```

### Agency-Specific Queries

```
What was the total obligated spending by HHS (Department of Health
and Human Services) on cloud computing last fiscal year?
```

```
Show me recent contract awards for 'penetration testing'
under $250,000 by the Department of Defense
```

### Contractor Research

```
Find the complete profile and award history for contractor with
UEI: ZQGGHJH74DW7
```

```
Search for all IT consulting companies registered in Virginia,
then analyze their federal contract history
```

### Market Analysis

```
What are the active landscaping maintenance contracts in Florida?
```

```
Show me building maintenance and repair contracts over $100,000
awarded this year across all agencies
```

### Multi-Tool Queries

The LLM can chain multiple tools together automatically:

```
Find all small business contractors in NAICS 541330 (engineering
services) in Texas, then get their spending history for 2023,
and identify the top 5 by total contract value
```

```
Search for HVAC maintenance opportunities posted this month,
then analyze historical spending patterns for those agencies
to identify the most active buyers
```

## API Documentation

### Tool Reference

For complete API documentation including all parameters, schemas, and examples, see the full tool descriptions:

#### USASpending.gov Tools (No API key required)

- **get_usaspending_awards** - Get federal awards data for specific agencies
- **get_usaspending_spending_by_category** - Spending breakdowns by category
- **get_usaspending_budgetary_resources** - Budget/obligation information
- **search_usaspending_awards_by_recipient** - Find awards by recipient name

#### SAM.gov Tools (Requires SAM_GOV_API_KEY)

- **search_sam_entities** - Search for registered federal contractors
- **get_sam_opportunities** - Find contract opportunities
- **get_sam_entity_details** - Get comprehensive entity profiles
- **check_sam_exclusions** - Verify contractor eligibility status

#### Join Tools (Requires SAM_GOV_API_KEY)

- **get_entity_and_awards** - Combine SAM entity with USASpending history
- **get_opportunity_spending_context** - Link opportunities with spending data

#### Tango API Tools (Requires TANGO_API_KEY)

- **search_tango_contracts** - Search federal contracts (unified API)
- **search_tango_grants** - Search federal grants
- **get_tango_vendor_profile** - Get vendor profiles with full history
- **search_tango_opportunities** - Search opportunities with forecasts
- **get_tango_spending_summary** - Get spending analytics

### Rate Limits

This server implements automatic rate limiting to respect API quotas:

| API | Delay Between Requests | Daily Limit | Notes |
|-----|----------------------|-------------|-------|
| **USASpending.gov** | 3.6 seconds | ~1000 requests/hour | Public API |
| **SAM.gov** | 100ms | Varies by key | Check SAM.gov dashboard |
| **Tango** | 100ms | Varies by plan | Check Tango dashboard |

### Error Handling

All tools return structured error responses:

```json
{
  "error": "Error message description",
  "details": "Additional context if available"
}
```

Common error types:
- **Authentication errors**: Invalid or missing API key
- **Rate limit errors**: Too many requests
- **Validation errors**: Invalid parameters
- **Not found errors**: Resource doesn't exist
- **Server errors**: API temporarily unavailable

## Development

### Development Setup

```bash
# Install dependencies
npm install

# Development mode with auto-reload (uses ts-node)
npm run dev

# Build TypeScript to JavaScript
npm run build

# Run the built server
npm start
```

`dist/` contains the compiled JavaScript output and is generated by the build step. It is intentionally gitignored—delete it before committing or packaging (`rm -rf dist` or rebuild) to keep the repository clean.

### Building Desktop Extensions

```bash
# Build .dxt (lightweight - no node_modules, for dev/testing)
npm run package:dxt

# Build .mcpb (full bundle - includes node_modules, for distribution)
npm run package
```

**File sizes**:
- `.dxt`: ~19KB (just code and manifest)
- `.mcpb`: ~4.2MB (includes all dependencies)

### Testing Tools

```bash
# Test with MCP Inspector
npm install -g @modelcontextprotocol/inspector
npx @modelcontextprotocol/inspector node dist/server.js
```

### Project Structure

```
capture-mcp-server/
├── src/
│   ├── server.ts              # MCP server entry point
│   ├── tools/
│   │   ├── index.ts           # Tool registry (conditional loading)
│   │   ├── sam-tools.ts       # SAM.gov integration (4 tools)
│   │   ├── usaspending-tools.ts # USASpending integration (4 tools)
│   │   ├── tango-tools.ts     # Tango API integration (5 tools)
│   │   └── join-tools.ts      # Cross-API tools (2 tools)
│   └── utils/
│       └── api-client.ts      # HTTP client with rate limiting
├── dist/                      # Compiled JavaScript (generated, gitignored)
├── manifest.json              # Desktop Extension metadata
├── icon.png                   # Extension icon
├── package.json
└── tsconfig.json
```

### Architecture

**Server Core** (`src/server.ts`):
- Uses `@modelcontextprotocol/sdk` for MCP protocol
- Stdio transport for desktop integration
- Centralized tool registration and routing

**Tool Registry** (`src/tools/index.ts`):
- Dynamically loads tool sets based on available API keys
- Enables graceful degradation when keys are missing
- Provides 4-15 tools depending on configuration

**API Client** (`src/utils/api-client.ts`):
- Centralized HTTP client with rate limiting
- Input sanitization and validation
- Consistent error handling across all APIs
- Supports GET and POST with timeouts

### Contributing

Contributions are welcome! Please follow these steps:

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/my-feature`
3. Make your changes
4. Test thoroughly with MCP Inspector
5. Update documentation if needed
6. Submit a pull request

**Development guidelines**:
- Follow existing code style (TypeScript, ES modules)
- Add JSDoc comments for new functions
- Test all tools with Inspector before submitting
- Update README for new features
- Keep dependencies minimal

## License

This project is open source under the MIT License.

Copyright (c) 2024 BLEN, Inc.

See `LICENSE` file for full license text.

## Support

### Get Help

- **Issues**: https://github.com/blencorp/capture-mcp-server/issues
- **Discussions**: https://github.com/blencorp/capture-mcp-server/discussions
- **Email**: Contact via https://www.blencorp.com

### Useful Resources

- **MCP Documentation**: https://modelcontextprotocol.io/
- **Claude Desktop**: https://claude.ai/download
- **SAM.gov API**: https://open.gsa.gov/api/entity-api/
- **USASpending.gov API**: https://api.usaspending.gov/
- **Tango API**: https://tango.makegov.com/docs/

---

Built with ❤️ by [BLEN, Inc](https://www.blencorp.com).

## About BLEN

BLEN, Inc is a digital services company that provides Emerging Technology (ML/AI, RPA), Digital Modernization (Legacy to Cloud), and Human-Centered Web/Mobile Design and Development.

*Happy hunting!* 🎯
