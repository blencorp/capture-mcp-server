# Security Policy

## Reporting a vulnerability

Please **do not file public GitHub issues for security reports**. Instead, open a private GitHub
Security Advisory:

> <https://github.com/blencorp/capture-mcp-server/security/advisories/new>

If that is not available, write to **opensource@blencorp.com**.

We try to respond within **3 business days**. A typical timeline for a confirmed report:

1. Initial acknowledgement and severity triage within 3 business days.
2. Coordinated fix in a private branch within 14 days for critical and 30 for high-severity issues.
3. Patched release with a credit line (unless you ask not to be credited).
4. Public advisory and CVE filing once users have had reasonable upgrade time.

## Scope

In scope:

- **Auth bypass.** Any request to `/mcp` in OAuth mode that reaches a tool handler without a valid
  bearer token, or a Lambda request that does so without a valid access key.
- **Key exposure.** Any way for a result, a log or an error to reveal a provider API key, for the
  operator's environment keys to serve a remote caller, or for one caller's key to serve another's.
- **Token forgery or replay.** Forging or modifying a sealed access or refresh token, or using one
  for a client, resource or scope it was not issued for.
- **OAuth flow flaws.** Open redirects, a missing PKCE check, or an authorization code that can be
  used twice.
- **DNS rebinding or request forgery** against the loopback-only single-user HTTP mode.
- **Argument handling.** A tool argument that changes which upstream host, path or method a call
  uses.

Out of scope (please file a normal issue instead):

- Provider rate limits and quotas, which belong to SAM.gov, Tango and HigherGov.
- Denial of service through lawful but expensive queries. The server adds no limit to `/mcp`, so
  put a rate-limiting proxy in front of a hosted deployment.
- Issues that only occur with `MCP_ALLOW_INSECURE_HTTP=true`, which is documented as single-user and
  loopback-only.

## Design notes

- **Fails closed.** HTTP mode refuses to start without OAuth (`MCP_REQUIRE_OAUTH=true` with
  `OAUTH_TOKEN_SECRET` and `MCP_PUBLIC_BASE_URL`) or the explicit loopback opt-in, which refuses
  other addresses and other Host headers. The Lambda function answers `503` on `/mcp` until its key
  bucket is configured.
- **Keys are the caller's own.** A remote caller's keys come from its OAuth token (sealed with
  AES-256-GCM under `OAUTH_TOKEN_SECRET`) and then from its `X-*-Api-Key` headers. They never come
  from the server's environment, and a header never authenticates a caller.
- **Nothing is stored.** The server has no database. Registered OAuth clients, pending
  authorizations and revoked token IDs live in process memory.
- **Tools are read-only,** with strict argument schemas that refuse unknown arguments.
- A key reaches only the source it belongs to. SAM.gov and HigherGov take it as a URL query
  parameter, and Tango as a header.

## Dependencies

CI fails on any known advisory (`pnpm audit --audit-level moderate`, for the server and for the
documentation site), a scheduled workflow audits the lockfiles daily, and Dependabot proposes updates
weekly. For an advisory that affects this server, expect a patch release within the timeline above.
