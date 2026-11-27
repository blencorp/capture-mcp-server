# Support

This is an independent open-source project. It is not affiliated with or endorsed by SAM.gov,
USAspending.gov, Tango, HigherGov or the U.S. government. Help is given on a best-effort basis by
the maintainers.

## Before you ask

- **Documentation:** <https://capture.mcp.blencorp.com/docs/> has connect guides, key setup,
  example questions and the tool reference.
- **Tool reference:** [`docs/sdk-reference.md`](./docs/sdk-reference.md) lists every tool, its
  arguments, the result shape and the errors.
- **Examples:** [`examples/`](./examples/) holds example tool calls.
- **Existing issues:** search the
  [issue tracker](https://github.com/blen-labs/capture-mcp-server/issues?q=is%3Aissue), open and
  closed.

## Where to go

| You have | Go to |
|---|---|
| A bug, or behaviour that differs from the docs | [Open a bug report](https://github.com/blen-labs/capture-mcp-server/issues/new?template=bug_report.md) |
| An idea for a new tool, argument or setting | [Open a feature request](https://github.com/blen-labs/capture-mcp-server/issues/new?template=feature_request.md) |
| A question about using or hosting the server | [Ask a question](https://github.com/blen-labs/capture-mcp-server/issues/new?template=question.md) |
| A security vulnerability (auth bypass, key leak) | A [private security advisory](https://github.com/blen-labs/capture-mcp-server/security/advisories/new). See [`SECURITY.md`](./SECURITY.md). Never a public issue. |
| A problem with a SAM.gov, Tango or HigherGov account or key | That provider. This project cannot see or change your account. |
| A question about the BLEN-hosted service, its terms or your data | **opensource@blencorp.com**. See the [Terms of Service](./legal/terms.md) and [Privacy Policy](./legal/privacy-policy.md). |
| A Code of Conduct concern | **conduct@blenlabs.com**. See the [Code of Conduct](./CODE_OF_CONDUCT.md). |

## What to include

A report we can act on has:

- the server version (the version your MCP client shows, or your git SHA), the transport (stdio or
  HTTP), your Node version and your MCP client;
- the tool name and the arguments of the call, with any key removed;
- the full result or error text;
- server log lines, if you have them.

**Never paste an API key.** The server does not add a key to a result, but a client configuration
file or a shell history holds one. Remove names and addresses from captured provider responses too.

## What we cannot do

- Give legal or contracting advice, or interpret a solicitation or an award for you.
- Speed up, repair or explain an outage or a quota of a provider's API. When an endpoint changes
  upstream, a bug report with the request and the response status is the fastest way to get the
  tool updated.
- Share an API key. Keys are personal; every user needs their own.

## Contributing

To fix something yourself, start with [`CONTRIBUTING.md`](./CONTRIBUTING.md).
