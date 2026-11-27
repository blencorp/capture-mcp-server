# Capture MCP

[![CI](https://github.com/blencorp/capture-mcp-server/actions/workflows/ci.yml/badge.svg)](https://github.com/blencorp/capture-mcp-server/actions/workflows/ci.yml)
[![license: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](./LICENSE)
[![Node](https://img.shields.io/badge/node-24%20%7C%2026-339933.svg)](https://nodejs.org/)

**Ask your AI assistant real questions about federal contracts, grants and spending, and get answers grounded in SAM.gov, USAspending, Tango and HigherGov.**

**Documentation:** [capture.mcp.blencorp.com/docs](https://capture.mcp.blencorp.com/docs/) has connect guides, key setup, example questions and the tool reference.

This is a [Model Context Protocol](https://modelcontextprotocol.io) server with 34 narrow, read-only tools over five sources. Your assistant picks a tool and fills in its arguments, and the server calls the source with **your own key**.

> Independent open-source project. It calls the public APIs of SAM.gov, USAspending.gov, Tango and HigherGov and is not affiliated with or endorsed by them or by the U.S. government.

## Connect to the hosted server

BLEN hosts the server at:

```text
https://capture.mcp.blencorp.com/mcp
```

Add it as a custom connector (a remote MCP server) in Claude, ChatGPT, Cursor, VS Code or another assistant; [the docs](https://capture.mcp.blencorp.com/docs/connect/) have a guide for each. Your assistant then opens a page from the server. Tick the sources you use and paste your own key for each. There is no account to create: the server seals your keys inside the OAuth token it gives your assistant and stores nothing. See the [privacy policy](./legal/privacy-policy.md) and [terms](./legal/terms.md).

## What's covered

| Source | Tools | Key |
|---|---|---|
| Reference codes (FPDS set-aside, competition, award-type descriptions) | 1 | none |
| [USAspending.gov](https://api.usaspending.gov) (awards, spending by category, budgetary resources, grouping) | 6 | none |
| [SAM.gov](https://sam.gov) (opportunities, entities, exclusions) and two tools that join them with USAspending | 4 + 2 | SAM.gov |
| [Tango](https://tango.makegov.com) (contracts, grants, vendors, protests, IDVs, vehicles, OTAs, metrics) | 12 | Tango |
| [HigherGov](https://www.highergov.com) (forecasts, opportunities, contracts, contacts, documents) | 9 | HigherGov |

The server lists only the tools whose key the connection has. On your own computer with no keys the 7 reference and USAspending tools work; the hosted connection requires at least one key, so you cannot connect to it for the keyless tools alone. The main search tools (Tango contracts, grants and opportunities; HigherGov contracts, people, opportunities and forecasts; USAspending awards by recipient) echo which filters the source applied and which the server applied itself, say what their `total` counts, and return `null` when a total cannot be trusted. The other list tools (SAM.gov, and Tango protests, IDVs, vehicles and OTAs) return a plain `{ total, records, … }` shape. [`docs/sdk-reference.md`](./docs/sdk-reference.md) lists every tool and argument, and [`examples/`](./examples/) holds example calls.

## API keys

| Source | Where to get the key | Env var (own computer) | Header |
|---|---|---|---|
| SAM.gov | The Public API Key in your [SAM.gov account details](https://sam.gov/workspace/profile/account-details) | `SAM_GOV_API_KEY` | `X-Sam-Api-Key` |
| Tango | [tango.makegov.com](https://tango.makegov.com/docs/) | `TANGO_API_KEY` | `X-Tango-Api-Key` |
| HigherGov | [highergov.com](https://www.highergov.com/api-external/docs/) | `HIGHERGOV_API_KEY` | `X-Highergov-Api-Key` |

Keys are personal. The server never uses a key from its own environment to answer a remote caller, and never gives one caller's key to another. [Get your keys](https://capture.mcp.blencorp.com/docs/keys/) has the steps.

## Run it on your own computer

Easiest: download `capture-mcp-server.mcpb` from the [latest release](https://github.com/blencorp/capture-mcp-server/releases/latest) and open it in Claude Desktop. It asks for your keys when you install it.

Or run the npm package ([`@blen/capture-mcp-server`](https://www.npmjs.com/package/@blen/capture-mcp-server), Node.js 24.11 or later, or 26) by adding it to your assistant's MCP configuration, for example Claude Desktop's `claude_desktop_config.json` (**Settings → Developer → Edit Config**):

```json
{
  "mcpServers": {
    "capture": {
      "command": "npx",
      "args": ["-y", "@blen/capture-mcp-server"],
      "env": {
        "SAM_GOV_API_KEY": "your-sam-gov-key",
        "TANGO_API_KEY": "your-tango-key",
        "HIGHERGOV_API_KEY": "your-highergov-key"
      }
    }
  }
}
```

Every key is optional. To work on the server itself, clone the repository (pnpm 12), run `pnpm install --frozen-lockfile && pnpm build`, and point `command`/`args` at `node` and `/ABSOLUTE/PATH/TO/capture-mcp-server/dist/server.js`; `pnpm dev` runs it from source. `pnpm mcpb:prepare && pnpm mcpb:pack` builds the desktop bundle the way a release does.

## Self-hosting (remote HTTP)

```bash
# Local, single user, no sign-in (binds 127.0.0.1 and refuses any other HOST):
MCP_TRANSPORT=http MCP_ALLOW_INSECURE_HTTP=true PORT=8080 SAM_GOV_API_KEY=... node dist/server.js

# Your own hosted server: OAuth, where each person enters their own keys.
MCP_TRANSPORT=http MCP_REQUIRE_OAUTH=true \
  OAUTH_TOKEN_SECRET="$(openssl rand -base64 48)" \
  MCP_PUBLIC_BASE_URL=https://capture.example.com \
  node dist/server.js
```

The server speaks MCP [2026-07-28](https://modelcontextprotocol.io) over HTTP and stdio, and answers clients that only know the 2025 revisions statelessly: there are no sessions. Every tool declares an `outputSchema`, and a failed call is a result marked `isError`. Upgrading from 3.x? See [`docs/migration-4.0.md`](./docs/migration-4.0.md).

HTTP mode fails closed: it refuses to start without `MCP_REQUIRE_OAUTH=true` or the loopback opt-in. The root `Dockerfile` builds the hosted image (Railway builds it too) and puts the landing page, the policy pages and the documentation site at `/`, `/privacy-policy`, `/terms` and `/docs`. [Self-host](https://capture.mcp.blencorp.com/docs/self-host/) describes every mode.

### Configuration

| Variable | Purpose |
|---|---|
| `MCP_TRANSPORT` | `stdio` (default) or `http`. |
| `MCP_REQUIRE_OAUTH`, `OAUTH_TOKEN_SECRET`, `MCP_PUBLIC_BASE_URL` | Hosted HTTP; all three are required together. |
| `OAUTH_TOKEN_SECRET_PREVIOUS` | Comma-separated retired secrets (at most three) that still open tokens while you rotate `OAUTH_TOKEN_SECRET`. |
| `OAUTH_ACCESS_TOKEN_TTL_SECONDS`, `OAUTH_REFRESH_TOKEN_TTL_SECONDS` | Token lifetimes; the defaults are 1 hour and 90 days, and neither may exceed 1 day and 90 days. |
| `MCP_IP_RPS`, `MCP_IP_BURST` | The `/mcp` request budget for each client address: sustained requests per second (default 5) and burst (default 20). |
| `MCP_CLIENT_IP_HEADER` | Behind a proxy, the header it overwrites with the client address (Railway: `x-real-ip`). Set `x-real-ip` on Railway. Unset, the limiters count the connection's address, which behind a proxy is the proxy. Applies to `/mcp` and the OAuth endpoints. |
| `MCP_ALLOW_INSECURE_HTTP` | `true` for single-user HTTP on loopback. |
| `PORT`, `HOST` | The listening port and address. |
| `RAILWAY_GIT_COMMIT_SHA` | Set by Railway on deployments built from GitHub; `/health` reports it as `commit`, or `null` when unset or not a full SHA. Do not set it yourself. |
| `SAM_GOV_API_KEY`, `TANGO_API_KEY`, `HIGHERGOV_API_KEY` | Keys for stdio and single-user HTTP only. |

## Development

```bash
pnpm install --frozen-lockfile
pnpm typecheck      # tsc --noEmit (src, scripts, web, web/e2e)
pnpm lint           # eslint: correctness and security rules, zero warnings
pnpm test           # builds, then tsx --test over src/**/*.test.ts
pnpm test:web       # Playwright + axe over the landing, policy and docs pages
pnpm kit:check      # the shared portal kit matches web/portal-kit.json
pnpm docs:reference # regenerate docs/sdk-reference.md from the tool definitions
```

[`CONTRIBUTING.md`](./CONTRIBUTING.md) describes the workflow (including the one-time `pnpm --dir site install --frozen-lockfile` and `pnpm exec playwright install chromium` that `pnpm test:web` needs), [`docs/architecture.md`](./docs/architecture.md) and [`CLAUDE.md`](./CLAUDE.md) describe the code.

## Security

Report vulnerabilities privately; see [`SECURITY.md`](./SECURITY.md).

## Contributing

See [`CONTRIBUTING.md`](./CONTRIBUTING.md) and the [Code of Conduct](./CODE_OF_CONDUCT.md). Support is described in [`SUPPORT.md`](./SUPPORT.md).

## License

[Apache-2.0](./LICENSE). Releases up to v1.0.2 were MIT, and [`NOTICE`](./NOTICE) keeps the notices for contributions made under that license. Changes are listed in [`CHANGELOG.md`](./CHANGELOG.md).

## Hosted service policies

The BLEN-hosted service is governed by the [Privacy Policy](./legal/privacy-policy.md) and the [Terms of Service](./legal/terms.md), also served at `/privacy-policy` and `/terms`.

## For teams

Want an MCP server for your team's or agency's data, or help running this one? [Talk to BLEN](https://www.blencorp.com/mcp).

---

Built with ❤️ by [BLEN](https://www.blencorp.com).
