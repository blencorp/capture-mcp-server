# Terms of Service — Capture MCP (by BLEN)

_Last updated: 2026-11-21_

## 1. Acceptance and scope

By accessing or using the BLEN-hosted **Capture MCP** at
`https://capture.mcp.blencorp.com` (the "Service", operated by BLEN, Inc.), you
agree to these terms. If you do not agree, do not use the Service. If you use it
on behalf of an organization, you represent that you are authorized to accept
these terms for that organization.

The underlying `capture-mcp-server` software is separately licensed under
[Apache-2.0](../LICENSE). These hosted-service terms do not replace that license
or restrict rights it grants. A self-hosted deployment is operated under its
operator's terms and policies.

## 2. Independent service and data sources

The Service is an independent, read-only client for SAM.gov, USAspending.gov,
Tango and HigherGov, with a static reference lookup for procurement codes.
SAM.gov, Tango and HigherGov require API keys. On the hosted Service you connect
with your own keys, entered during the OAuth authorization step. There are no
user accounts, and the Service never uses anyone's key but the caller's own.

**Each provider's terms apply to your use.** You are responsible for the keys you
enter and for complying with each provider's terms, rate limits, and quotas for
them. Enter only your own key. Do not use a key you are not authorized to use.

BLEN is not affiliated with, sponsored by, or endorsed by the U.S. government,
SAM.gov, USAspending.gov, Tango or HigherGov. Third-party content remains subject
to any applicable rights and source notices. These terms grant no rights to
government seals, trademarks, or third-party material beyond those otherwise
available to you.

## 3. Informational use and accuracy

The Service is for informational and research purposes. It does not provide legal
advice, bid or no-bid recommendations, or compliance determinations, and it does
not replace official records or the judgment of a contracting professional or
attorney.

Upstream data can contain errors, omissions, or delays. Totals can be unknown,
results can be filtered by the Service after retrieval (the response says which
filters ran where), and an AI client may filter, calculate, or summarize results
incorrectly. A solicitation, deadline, registration or award shown by the Service
may since have changed. Verify opportunities, dates, registrations and awards
against the official systems (SAM.gov, USAspending.gov and the agency's own
notice) before relying on an answer or taking action.

## 4. Acceptable use

You agree not to:

- Bypass or attempt to bypass rate limits, authentication, or other access
  controls.
- Send queries intended to extract secrets, access host internals, target
  unsupported systems, or cause excessive load.
- Send passwords, confidential records, or sensitive personal information
  through the connector, or paste API keys into tool arguments (enter them on the
  authorization page instead).
- Use the Service unlawfully, infringe others' rights, or harass or target
  individuals using public records, including the contact details some sources
  return.
- Misrepresent Service outputs as government action, approval, or an official
  determination.

We may limit, suspend, or block access to address violations, abuse, security
incidents, or threats to service availability.

## 5. Limits and source availability

The Service paces and queues calls to each provider, so a busy provider can make
a call wait or fail with a retry hint. Calls made with your key count against that
provider's quota for it. Limits depend on the deployment configuration and may
change. A provider may impose additional limits or become unavailable.

The Service does not make filings, submit proposals, pay fees, or perform other
mutative actions at any provider.

## 6. Privacy

The [Privacy Policy](./privacy-policy.md) describes tool arguments, network
metadata, API keys, upstream disclosures, caching, and operational logging.
Your MCP client and any self-hosted operator have separate practices and terms.

## 7. Availability and warranty

The Service is provided **"as is"** and **"as available"**. To the maximum extent
permitted by law, BLEN disclaims warranties, including merchantability, fitness
for a particular purpose, and non-infringement. We do not guarantee accuracy,
uninterrupted availability, compatibility with every MCP client, or continued
free access. We may change or discontinue the hosted Service.

## 8. Liability

To the maximum extent permitted by law, BLEN, Inc. disclaims liability for
direct, indirect, incidental, special, or consequential damages arising from use
of or inability to use the Service. Nothing in these terms excludes liability
that cannot lawfully be excluded.

## 9. Changes

We may update these terms. Material changes will be noted in the repository
changelog at least 14 days before taking effect for the hosted Service. If you do
not agree to revised terms, stop using the Service.

## 10. Governing law

These terms are governed by the laws of Delaware, USA, subject to applicable
mandatory law.

## 11. Contact

Questions about these terms: **opensource@blencorp.com**. General support is also
available through [BLEN's contact page](https://www.blencorp.com/connect).
Report security vulnerabilities privately as described in
[SECURITY.md](../SECURITY.md).
