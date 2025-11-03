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

## Publishing and Release Management

### Package Distribution

This server is published to both NPM and the MCP Registry for maximum accessibility:

**NPM Package**: `@blen/capture-mcp-server`
- Scoped under the `@blen` organization
- Installable via `npm install -g @blen/capture-mcp-server`
- Can be run via `npx @blen/capture-mcp-server`

**MCP Registry**: `io.github.blencorp/capture-mcp-server`
- Uses GitHub namespace authentication
- Discoverable through MCP-compatible clients
- Automatically synced with NPM releases

### Publishing Configuration Files

**package.json**:
- Name: `@blen/capture-mcp-server`
- Contains `mcpName` field for NPM registry validation: `"io.github.blencorp/capture-mcp-server"`
- Public access configured via `publishConfig.access: "public"`

**server.json** (MCP Registry Schema):
- Schema version: `2025-10-17`
- Defines all 15 tools with descriptions
- Specifies NPM package deployment with stdio transport
- Documents optional environment variables (SAM_GOV_API_KEY, TANGO_API_KEY)
- Validated against official MCP schema before publishing

### Automated Publishing Workflow

Publishing is **fully automated** using [semantic-release](https://github.com/semantic-release/semantic-release) and GitHub Actions:

**Primary Workflow** (`.github/workflows/release.yml`):
- **Trigger**: Push to `main` branch
- **Purpose**: Analyze commits, determine version, publish to NPM, create releases
- **Automation**: Completely hands-off after merge

**Secondary Workflow** (`.github/workflows/publish-mcp.yml`):
- **Trigger**: Version tags matching `v*` (created by semantic-release)
- **Purpose**: Publish to MCP Registry only (NPM handled by semantic-release)
- **Automation**: Triggered automatically by tags created in primary workflow

**Release Workflow Steps** (`.github/workflows/release.yml`):
1. Checkout code with full git history
2. Install dependencies and build TypeScript
3. Run semantic-release which:
   - Analyzes commits using Conventional Commits
   - Determines version bump (major/minor/patch)
   - Updates package.json and server.json versions
   - Generates/updates CHANGELOG.md
   - Publishes to NPM
   - Creates GitHub Release with notes
   - Creates and pushes version tag (e.g., `v1.0.1`)
4. Tag creation triggers MCP Registry publishing workflow

**GitHub Secrets Required**:
- `NPM_TOKEN` - NPM access token with publish permissions (create at npmjs.com)
- `GITHUB_TOKEN` - Automatically provided by GitHub Actions

### Creating a New Release

Releases are **fully automated** - no manual tagging required!

**Process**:
1. **Develop and merge PR to main**:
   ```bash
   git checkout -b feature/my-feature
   # Make changes
   git add .
   git commit -m "feat: add new search filter"
   git push origin feature/my-feature
   # Create PR and merge to main
   ```

2. **Semantic-release automatically**:
   - Analyzes your commit messages
   - Determines version bump
   - Updates all version files
   - Publishes to NPM
   - Creates GitHub Release
   - Creates version tag
   - Updates CHANGELOG.md

3. **Tag triggers MCP Registry publishing**:
   - Version tag automatically triggers publish-mcp.yml
   - Publishes to MCP Registry

**That's it!** No manual tagging, no manual version updates.

### Commit Message Format (Conventional Commits)

Semantic-release uses commit messages to determine version bumps:

**Format**: `<type>(<scope>): <description>`

**Types and their effects**:
- `feat:` - New feature → **Minor version bump** (1.0.0 → 1.1.0)
- `fix:` - Bug fix → **Patch version bump** (1.0.0 → 1.0.1)
- `docs:` - Documentation only → No version bump
- `chore:` - Maintenance tasks → No version bump
- `refactor:` - Code refactoring → No version bump
- `test:` - Test changes → No version bump
- `perf:` - Performance improvements → **Patch version bump**
- `BREAKING CHANGE:` or `feat!:` → **Major version bump** (1.0.0 → 2.0.0)

**Examples**:
```bash
# Minor version bump (new feature)
git commit -m "feat: add pagination to entity search"

# Patch version bump (bug fix)
git commit -m "fix: correct timeout handling in API client"

# Major version bump (breaking change)
git commit -m "feat!: redesign tool parameter structure

BREAKING CHANGE: Tool parameters now use camelCase instead of snake_case"

# No version bump (documentation)
git commit -m "docs: update API key setup instructions"

# No version bump (maintenance)
git commit -m "chore: update dependencies"
```

**Best Practices**:
- Use conventional commits for all merges to main
- Squash commits when merging PRs for cleaner history
- Be explicit about breaking changes
- Write clear, descriptive commit messages

### Semantic-Release Configuration

Configuration is defined in `.releaserc.json`:

**Plugins**:
1. `@semantic-release/commit-analyzer` - Analyzes commits for version bumps
2. `@semantic-release/release-notes-generator` - Generates release notes
3. `@semantic-release/changelog` - Updates CHANGELOG.md
4. `@semantic-release/exec` - Updates server.json version
5. `@semantic-release/npm` - Publishes to NPM
6. `@semantic-release/github` - Creates GitHub releases
7. `@semantic-release/git` - Commits updated files back to repo

**Assets Committed Back to Repo**:
- `package.json` - Updated version
- `package-lock.json` - Updated lockfile
- `server.json` - Updated version fields
- `CHANGELOG.md` - Updated with new release notes

All commits made by semantic-release include `[skip ci]` to prevent infinite loops

### Manual Publishing (Emergency/Testing)

If automated publishing fails, you can publish manually:

**Option 1: Trigger semantic-release locally** (Recommended):
```bash
npm run build
npx semantic-release --no-ci
```
This runs the full semantic-release workflow locally (requires NPM_TOKEN and GITHUB_TOKEN env vars).

**Option 2: Manual NPM publishing**:
```bash
npm login  # Login with @blen organization credentials
npm run build

# Manually update versions first
npm version patch  # or minor, or major
node -e "const fs = require('fs'); const pkg = require('./package.json'); const server = JSON.parse(fs.readFileSync('server.json', 'utf8')); server.version = pkg.version; server.packages[0].version = pkg.version; fs.writeFileSync('server.json', JSON.stringify(server, null, 2) + '\n');"

npm publish
```

**Option 3: Manual MCP Registry publishing**:
```bash
# Install mcp-publisher CLI (macOS/Linux)
brew tap modelcontextprotocol/tap
brew install mcp-publisher

# Authenticate with GitHub
mcp-publisher login github

# Publish to registry
mcp-publisher publish
```

**Note**: Manual publishing should only be used for testing or emergency situations. The automated workflow ensures consistency and prevents errors.

### Version Synchronization

The workflow ensures version consistency across:
- Git tag (e.g., `v1.0.1`)
- package.json `version` field
- server.json `version` field
- server.json `packages[0].version` field

All versions are automatically synced from the git tag during publishing.

### Schema Validation

Before publishing, validate server.json against the MCP schema:

```bash
# Download schema and validate
curl -s -o /tmp/server.schema.json https://static.modelcontextprotocol.io/schemas/2025-10-17/server.schema.json
npx ajv-cli validate -s /tmp/server.schema.json -d server.json --strict=false
```

This validation is recommended but not currently automated in CI/CD.

### NPM Organization Access

Publishing to `@blen/capture-mcp-server` requires:
1. NPM account with access to the `@blen` organization
2. Organization owner must grant publish permissions
3. NPM access token with "Automation" or "Publish" scope
4. Token stored as `NPM_TOKEN` in GitHub repository secrets

### Troubleshooting Publishing

**Semantic-release doesn't create a release**:
- Check commit messages follow Conventional Commits format
- Ensure commits include releasable types (`feat:`, `fix:`, `perf:`, or breaking changes)
- Commits with only `docs:`, `chore:`, `refactor:`, `test:` won't trigger releases
- Check GitHub Actions logs for semantic-release output
- Verify main branch has commits since last release

**NPM publish fails with 403 Forbidden**:
- Verify you have publish access to @blen organization
- Check NPM_TOKEN secret is correctly set in GitHub
- Ensure token hasn't expired
- Confirm token has "Automation" or "Publish" scope

**MCP Registry publish fails**:
- Verify server.json passes schema validation
- Check GitHub OIDC authentication succeeded
- Ensure repository is public (required for MCP registry)
- Confirm namespace `io.github.blencorp` matches repository owner

**Version conflicts or unexpected versions**:
- Semantic-release automatically determines versions based on commits
- Don't manually edit package.json version field (semantic-release manages it)
- If version seems wrong, review commit messages since last release
- Use `git log --oneline v1.0.0..HEAD` to see commits that will be analyzed

**"No release published" but commits exist**:
- All commits since last release might be non-releasable types
- Add a `feat:` or `fix:` commit to trigger a release
- Check if commits are properly formatted as Conventional Commits

**Duplicate NPM publishes or race conditions**:
- Ensure only release.yml publishes to NPM (publish-mcp.yml should NOT)
- Check that `[skip ci]` is in semantic-release commit messages
- Verify workflows don't have conflicting triggers