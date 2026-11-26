# Privacy Policy — Capture MCP (by BLEN)

_Last updated: 2026-11-21_

This policy describes how **Capture MCP**, powered by `capture-mcp-server`
(the "Service", operated by BLEN, Inc.), handles data when accessed from an MCP
client such as Claude, ChatGPT, or Cursor.

The Service provides read-only access to federal procurement data from SAM.gov
(`api.sam.gov`), USAspending.gov (`api.usaspending.gov`), Tango
(`tango.makegov.com`) and HigherGov (`www.highergov.com`), plus a static
reference lookup for procurement codes. SAM.gov, Tango and HigherGov require API
keys, which those providers issue to you. The BLEN-hosted endpoint is
`https://capture.mcp.blencorp.com/mcp`. It has no user accounts: you connect your
MCP client, and the server asks for your own provider keys during the OAuth
authorization step (see "Your API keys" below).

## What the Service receives

- **Tool arguments and results:** search terms, identifiers and filters you or
  your assistant submit to a tool, and the data returned to answer the call. The
  connector receives tool requests, not an automatic copy of your whole
  conversation. Your MCP client determines what it sends.
- **Provider API keys:** the keys you enter on the authorization page, and any
  key your client sends in a request header (see below).
- **Network metadata:** our hosting provider, Railway, handles connection
  metadata and request headers. The application uses the client address only for
  in-memory rate limiting of its OAuth endpoints and of `/mcp`, and does not
  record it.
- **Support communications:** information you voluntarily provide when
  contacting BLEN for assistance.

Tool arguments or support messages can contain personal information if you or
your client include it. Do not submit passwords, confidential records, or
sensitive personal information in tool arguments, and never paste API keys into
a conversation: enter them on the authorization page.

## Your API keys

When you connect, the server shows a page where you choose which sources you use
and paste your own key for each. The server does not check the keys at that
point. It seals them, with AES-256-GCM, into the access and refresh tokens it
issues to your client; the sealing secret is configured on the server and is not
in any database. **The server does not store your keys, and it has no database
or user accounts.** Your MCP client keeps the tokens, and the keys inside them
come back to the server with each of your requests, where it opens the token,
uses the key for the one source a tool needs, and discards it when the request
ends. Access tokens last 1 hour and refresh tokens 90 days, unless the operator
sets shorter lifetimes.

The server never uses a key you did not supply for anyone's request, and it does
not use anyone's key for another person. A client that has authenticated may also send
its own keys in `X-Sam-Api-Key`, `X-Tango-Api-Key` or `X-Highergov-Api-Key` headers
alongside its token; a key sealed in the token takes precedence, and the header
keys are used the same way.

The server keeps a short-lived record in process memory while you connect: the
client's registration, your pending authorization (10 minutes) and the one-time
authorization code. These are not written to disk and are lost when the process
restarts. Your access token keeps working, but your client can no longer refresh
it, so it has to connect again once the access token expires. Token revocation is
also tracked in memory, so it is best-effort: another instance or a restart
forgets it. To stop a leaked token from being used, rotate the key with its
provider; the operator can also invalidate every token at once by changing the
server's token secret.

## What is sent to other services

Each tool call sends the query terms, identifiers and filters it needs to the
one source it queries. A SAM.gov call goes to `api.sam.gov`, a USAspending call
to `api.usaspending.gov`, a Tango call to `tango.makegov.com` and a HigherGov
call to `www.highergov.com`. A tool uses only the key for its own source.
SAM.gov and HigherGov take the key as a URL query parameter, so the key is part
of the request URL that provider receives; Tango receives it in a request header.
USAspending needs no key. The reference lookup sends nothing anywhere.

The application does not intentionally forward your inbound IP address,
authorization header, or MCP-client identity to these providers. Outbound
connections use the hosting provider's network address and the server's
User-Agent. A provider associates activity with the key's holder under its own
terms; when you use your own key, the provider can attribute those requests to
your account with it.

Results return to your MCP client. That client's storage, AI processing, and
privacy practices are governed by its own policies. Hosting and the data
providers also process requests under their applicable policies. We may disclose
information where required by law or necessary to address abuse or protect the
Service.

## Storage and retention

- **Tool calls:** the application has no feature for saving conversation
  histories or tool results. This does not mean every request fragment is
  excluded from operational logs.
- **Response cache:** HigherGov lookups by identifier are cached in process
  memory for up to 15 minutes, with a maximum of 500 entries. Entries are
  separated by key (by a hash of it), are not persisted to disk, and may remain
  in memory until evicted or the process exits.
- **Rate-limit state:** pacing queues for calls to each provider, and per-address
  counters for the OAuth endpoints and `/mcp`, are held in process memory.
- **Operational logs:** the application writes startup and error messages to
  stderr. It does not log request bodies, tokens or keys, but an error message
  can include a fragment of a provider's reply. Hosting infrastructure may collect additional network and service
  logs. Log retention depends on the provider and its configured settings; this
  policy does not promise a fixed deletion period.
- **Support records:** information provided to support is handled to respond
  to the request and address related operational or legal needs. Contact us
  about retention or deletion of a particular support record.

## Uses and limits

We use information to operate the Service, return requested data, diagnose
failures, and respond to support requests. We do not sell personal information,
build advertising profiles from connector usage, or train AI models on queries
or results. The Service does not set cookies or embed browser analytics beacons.
These statements do not govern the separate MCP client or websites you choose to
use.

## Self-hosted deployments

Operators who self-host this software control their deployment, API keys,
authentication, logging, and retention. Their privacy policies apply to their
services. A server run over stdio or on a loopback address uses the operator's
own keys for that one operator.

## Your controls

Disconnect the connector in your MCP client to stop future calls, and revoke or
rotate your keys with each provider at any time. Consult your client's controls
for conversation history and client-side retention. For questions, access
requests, or deletion requests concerning information held by BLEN, contact
**opensource@blencorp.com**. Provide enough context to locate the relevant
interaction, but do not send credentials. Self-hosted users should contact their
deployment operator.

## Security

The hosted endpoint uses HTTPS. Application safeguards include sealed tokens,
per-address limits on the OAuth endpoints, and time limits on upstream requests. No
safeguard is a guarantee against every security incident.

## Changes and contact

Updates will be published here with a revised date. Privacy questions and
requests: **opensource@blencorp.com**. Report vulnerabilities privately using
the process in [SECURITY.md](../SECURITY.md).
