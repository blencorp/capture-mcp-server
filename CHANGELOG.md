# Changelog

All notable changes to this project are documented here. Releases are cut from `main` by the
Release workflow, which tags the version; this file is written by hand.

## [Unreleased]

### Security
- Hosted HTTP requires a verified bearer token on every `/mcp` request, and remote callers use only
  their own keys: sealed in their OAuth token, then their `X-*-Api-Key` headers, never the server's
  environment. `MCP_TRANSPORT=http` refuses to start without `MCP_REQUIRE_OAUTH=true` (with
  `OAUTH_TOKEN_SECRET` and `MCP_PUBLIC_BASE_URL`) or the loopback-only `MCP_ALLOW_INSECURE_HTTP=true`,
  and the Lambda function answers `503` on `/mcp` without `API_KEY_BUCKET`. **Breaking** for
  deployments that relied on header-only access or on the server's own keys.
- Update vulnerable production dependencies (MCP SDK 1.32.2, axios, express, body-parser,
  fast-xml-parser, ajv).

### Added
- A landing page, prerendered privacy policy and terms pages, and a not-found page, from the shared
  BLEN portal kit.
- A documentation site at `/docs` (connect guides, key setup, example questions, tool reference).
- A root `Dockerfile` for the hosted service, which builds the pages and the docs.
- Continuous integration on Node 24 and 26: audit, typecheck, lint, build, tests, a browser
  accessibility job and an image check; a scheduled dependency audit; Dependabot.

### Changed
- The project is licensed under Apache-2.0 (it was MIT); `NOTICE` keeps the MIT notices for
  contributions made under that license.
- pnpm 12, Node `^24.11.0 || ^26.0.0`, TypeScript 6 and 7, ESLint 10 and `tsx --test`.
- Removed HigherGov's OpenAPI spec from the fixtures, and replaced the federal contacts in the
  HigherGov captures with synthetic ones.

## [1.0.2] - 2026-08-27

### Fixed
- Resolve bare PIIDs by award group in `get_award_detail` and `aggregate_contracts` (USAspending).

## [1.0.1] - 2026-08-24

### Fixed
- Expose the HigherGov API key in the package manifest, so Claude Desktop asks for it.

## [1.0.0] - 2026-08-23

### Added
- 34 tools: a static FPDS reference lookup (`lookup_reference_code`), 6 USAspending tools
  (including `get_award_detail` and `aggregate_contracts`), 4 SAM.gov tools, 2 join tools,
  12 Tango tools and 9 HigherGov tools.
- A response contract for list tools: `filters.upstream` and `filters.client_side`, honest totals,
  `count_unit`, `date_field`, one `next_cursor`, and rejection of unknown parameters.
- OAuth 2.1 with PKCE and dynamic client registration, with per-user SAM.gov, Tango and HigherGov
  keys sealed in the token, and `X-*-Api-Key` header keys alongside it.
- An AWS Lambda deployment with CDK and S3-backed access keys, and Railway deployment.
- Automatic release tagging and release notes on merge to `main`.

### Fixed
- Tango set-aside filtering is exact on FPDS codes, with honest filter echoes and cursor paging.
- HigherGov contract, opportunity, document and forecast lookups now match the real API.
- The default OAuth client-registration scope is `mcp:tools`.

[Unreleased]: https://github.com/blencorp/capture-mcp-server/compare/v1.0.2...HEAD
[1.0.2]: https://github.com/blencorp/capture-mcp-server/compare/v1.0.1...v1.0.2
[1.0.1]: https://github.com/blencorp/capture-mcp-server/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/blencorp/capture-mcp-server/releases/tag/v1.0.0
