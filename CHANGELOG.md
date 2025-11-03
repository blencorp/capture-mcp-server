# Changelog

All notable changes to this project will be documented in this file.

This project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - Initial Release

### Features

- **SAM.gov Integration** - 4 tools for searching federal entities, opportunities, entity details, and exclusions
- **USASpending.gov Integration** - 4 tools for awards data, spending breakdowns, budgetary resources, and recipient search
- **Tango API Integration** - 5 tools for contracts, grants, vendor profiles, opportunities, and spending summaries
- **Data Joining** - 2 tools that combine data from multiple APIs for comprehensive business intelligence
- **Structured Outputs** - All tools return both human-readable text and structured JSON
- **Rate Limiting** - Built-in queue-based throttling to prevent API quota overruns
- **Input Sanitization** - Automatic argument sanitization for security
- **Flexible API Key Configuration** - Works out-of-the-box with 4 tools, expandable to 15 tools with optional API keys
- **Multiple Distribution Methods** - Available as npm package, .mcpb extension, or standard MCP configuration
- **Claude Desktop & ChatGPT Desktop Support** - Compatible with all major MCP clients

### Documentation

- Comprehensive README with installation methods and example queries
- CLAUDE.md for development guidance
- CONTRIBUTING.md, CODE_OF_CONDUCT.md, and SECURITY.md for community guidelines
- Full API documentation and troubleshooting guide

### Infrastructure

- TypeScript codebase with ES2020 target
- Modular tool architecture with centralized registry
- Automated publishing via GitHub Actions
- MIT License for maximum permissiveness
