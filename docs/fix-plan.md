# Capture MCP Server — Bug Fix & Hardening Plan

**Scope.** Capture MCP is a Model Context Protocol server exposing federal procurement and
spending data (SAM.gov, USASpending.gov, Tango, HigherGov) as 21 typed tools so a BD agent
can run capture workflows without raw HTTP. This plan fixes the reported P0 bugs in the
shipped tools, adopts the server-wide design conventions the bug reports trace back to, and
sequences the spec's highest-leverage follow-on tools. It does not change what the server
is: no new backends, no new product surface beyond the capability spec.

**Verification status.** Every P0 below was re-verified live against the deployed server on
2026-08-23 before this plan was written. Reproduction details are included per item so the
fixes can be regression-tested against the same probes.

---

## Phase 0 — Groundwork (do first; every P0 fix depends on it)

The root cause behind most of the P0s is the same: **both Tango and HigherGov silently
ignore query parameters they don't recognize**, and our tool layer passes parameters
through on faith without ever checking that they bound. We currently have no record of
what either upstream actually accepts or returns.

### 0.1 Capture raw upstream fixtures

Add `scripts/capture-fixtures.ts` (gated on the API-key env vars, never run in CI) that
saves raw JSON payloads to `src/tools/__fixtures__/`:

- Tango `GET /contracts/` — unfiltered page, agency-filtered page, and one detail record.
- HigherGov `GET /contract/` — one page with `naics_code` filter (the P0-5 repro query).
- HigherGov `GET /opportunity/` and `/people/` pages for regression coverage.

These fixtures become the source of truth for field mapping (P0-5) and the inputs to unit
tests. The `npm test` harness (`node --test` over `dist/**/*.test.js`) already exists;
new tests plug into it.

### 0.2 Establish the upstream parameter contract

For each query parameter we send, probe the live API and record in
`docs/upstream-api-notes.md` whether it (a) binds, (b) is ignored, or (c) errors:

- **Tango `/contracts/`**: `set_aside` (match semantics — probe `8A` vs `8AN`),
  `awarding_agency` (code vs name — verified 2026-08-23: code `2100` binds; the name
  `"Army"` **times out** upstream at our 30s axios limit, twice), `award_date_gte/lte`
  (which FPDS date field this compares — `action_date` vs `date_signed` produced
  1,928 vs 2,847 in the originating session), any server-side amount params
  (`obligated_gte`?, `total_contract_value_gte`?), and pagination (`next` URL shape,
  `offset`/`page` params).
- **HigherGov `/contract/`**: the real filter names (our `agency_name` does not bind —
  see P0-6), the real record field names (see P0-5), and where the pagination token
  actually lives (see P0-5b).

Deliverable: the notes file plus a decision per parameter — pass through, translate, or
reject. This is one focused session with both API keys; everything in Phase 1 then has a
verified target instead of guessed parameter names.

---

## Phase 1 — P0 bug fixes

Order within the phase: P0-5/P0-6 (HigherGov, self-contained, fixture-driven), then
P0-2/P0-3 (Tango request layer), then P0-1 (needs the reference table), then P0-4
(investigation that builds on all of the above).

### P0-5 — `search_highergov_contracts` returns hollow records

**Repro (live).** VA + NAICS 541511 returns rows where only `naics`, `psc`, and
`source_url` populate; `contract_id`, `piid`, `title`, `incumbent_name`, `agency`,
`set_aside`, `value`, `pop_start`, `pop_end` are empty/null on every row — even though the
contract ID is plainly visible inside `source_url`
(e.g. `https://www.highergov.com/contract/140F0920P0015/`).

**Root cause.** `normalizeContractSummary()` (`src/tools/highergov-tools.ts:187-205`) maps
field names that don't exist in the real `/contract/` payload (`raw.piid`, `raw.title`,
`raw.recipient_name`, `raw.period_of_performance_start`, …). The three fields that work
are the three whose guessed names happen to match (`naics_code`, `psc_code`, `path`).
Commit `e2ddba9` fixed this same class of bug for opportunities/forecasts but never touched
the contract normalizer.

**Fix.**
1. Using the Phase 0 fixture, rewrite `normalizeContractSummary`/`normalizeContractFull`
   against the actual payload field names (expect names in the family of `award_id`,
   `award_description`, nested `awarding_agency{agency_name}`, `recipient{...}`,
   `current_total_value`, PoP date fields — confirm from the fixture, don't guess again).
2. Add a unit test that runs the normalizer over the captured fixture and asserts **every
   declared output field is non-empty** for a record known to have the data. This is the
   test that would have caught both `e2ddba9`'s bug and this one.
3. As a safety net, derive `contract_id` from `source_url` when the payload field is
   absent, so the record is never unusable.

**Also fix (P0-5b):** the live probe returned `next_cursor: null` on page 1 of a result
set that is certainly larger than 3. `nextCursor()` (`highergov-tools.ts:282-284`) reads
`raw.next` — verify against the fixture where HigherGov actually puts the next-page token
and fix the extraction. Without this, HigherGov pagination is broken in exactly the silent
way P0-3 describes for Tango.

**Acceptance.** The P0-5 repro query returns fully populated records and a working
`next_cursor`; fixture test locks the mapping.

### P0-6 — `search_highergov_contracts.agency` doesn't bind

**Repro (live).** `agency: "Department of Veterans Affairs"` returned PIIDs `1333LB…`
(Commerce), `140F09…` (Interior), `15F067…` (DOJ).

**Root cause.** `searchContracts()` sends `agency_name` (`highergov-tools.ts:471`), which
the `/contract/` endpoint does not recognize, and HigherGov ignores unknown params — so the
query silently ran unfiltered.

**Fix.**
1. From Phase 0.2, use the parameter `/contract/` actually documents (likely an agency
   *key/slug*, not a free-text name — the same pattern as `award_id` vs path lookup that
   bit `getContract` before). If the API wants a key, resolve name → key first (HigherGov
   `/agency/` endpoint), and cache resolutions.
2. **Post-verify binding**: after the response, check that returned rows' agency matches
   the requested one (now possible because P0-5 makes `agency` populate). If they don't
   match, return the standard `bad_request` error naming the parameter instead of
   returning unfiltered rows. A wrong answer must never look like a right one.
3. Audit the sibling params in the same call (`pop_end_after/before`, `min_value`,
   `max_value` at `highergov-tools.ts:474-477`) with the same probe-and-verify treatment —
   they were guessed the same way and there is no evidence any of them bind.

**Acceptance.** VA query returns only VA awards; an unresolvable agency string returns
`bad_request`, not the full corpus.

### P0-2 — `award_amount_min`/`award_amount_max` silently dropped

**Repro (live).** `set_aside: 8AN` + `award_amount_min: 1000000` → `total: 1331`
(unchanged), `contracts: []`, and the echoed `filters` object contains no amount key.

**Root cause.** `searchContracts()` (`src/tools/tango-tools.ts:300-311`) applies the
amount bounds **client-side to the single fetched page** (here: 5 rows, none ≥ $1M →
empty array), while `total` (`tango-tools.ts:351`) is the upstream unfiltered count and
the `filters` echo is just the upstream `params` object, which never had the amounts.
All three symptoms are one design flaw: filtering after the fact and reporting as if it
happened upstream. The same flaw exists in `searchGrants` (amounts, `recipient_name`,
`recipient_uei` — `tango-tools.ts:397-423`) and in `searchContracts`' `vendor_name`
post-filter (`tango-tools.ts:313-319`).

**Fix.**
1. If Phase 0.2 finds server-side amount params on Tango, translate to them and delete the
   client-side filter. This is the preferred outcome.
2. If Tango has no server-side amount filter, do **not** fake it: either reject the
   parameter with a clear error ("amount filtering is not supported by the Tango backend"),
   or — only if we decide page-local filtering is worth keeping — report honestly:
   `total: null`, plus `filters.client_side: {award_amount_min: …}` and a
   `warnings: ["award_amount bounds applied client-side to this page only; total reflects the unfiltered query"]`.
3. Apply the same treatment to every other client-side post-filter in the Tango tools.
   No filter may ever be absent from the echo while influencing (or failing to influence)
   the results.

**Acceptance.** Re-running the repro either returns amount-filtered results with the
filter echoed, or an explicit error/warning — never an empty page with an unchanged total.

### P0-3 — No pagination on `search_tango_contracts`

**Root cause.** `limit` caps at 100 (`tango-tools.ts:279`) and no offset/cursor param
exists, so result sets >100 are unenumerable. Tango demonstrably returns a `next` URL —
`getSpendingSummary` already surfaces it (`tango-tools.ts:789`).

**Fix.**
1. Add `cursor` to the input schema of `search_tango_contracts`, `search_tango_grants`,
   and `search_tango_opportunities`.
2. Reuse the cursor pattern the HigherGov tools already have
   (`pageNumberFromCursor`/`applyPageCursor`, `highergov-tools.ts:263-284`): extract the
   page/offset token from Tango's `next` URL, accept it back, and return `next_cursor` in
   every list response. Move those helpers into a shared `utils/pagination.ts` so both
   backends use one shape (design convention #3).
3. Note the interaction with P0-2: client-side post-filters compose badly with pagination
   (a filtered-out page still consumes a cursor step). One more reason to push filters
   upstream or reject them.

**Acceptance.** A >100-row result set (e.g. the 8AN Aug–Sep window) can be fully
enumerated by walking `next_cursor` until null, and page N+1 never repeats page N.

### P0-1 — `set_aside` does substring matching

**Repro (live).** Aug–Sep 2025: `set_aside: "8A"` → `total: 1450`, and the returned rows
are visibly not 8(a) awards (roofing, flooring, fire-detection micro-purchases across
random agencies); `set_aside: "8AN"` → `total: 1331`. Exact `8A` should be ~119. Worse:
**the returned rows don't even carry a `set_aside` field** — the mapping
`contract.set_aside?.code || contract.type_of_set_aside` (`tango-tools.ts:341`) resolves
undefined against the real payload, so an agent cannot even self-check what it got.

**Root cause.** We pass `set_aside` straight through (`tango-tools.ts:290`) and Tango
matches it as a substring/`icontains` (`"8A"` ⊇ `8AN`, and apparently worse). The broken
per-row field mapping is a second, independent bug hiding the first.

**Fix.**
1. From Phase 0.2, determine whether Tango supports exact-match set-aside filtering
   (an `__exact`-style param or a code-list param). Use it if it exists.
2. Change the schema to accept `set_aside: string[]` (e.g. `["8AN","SDVOSBS","HZS"]`)
   as the spec asks; a single string stays accepted for compatibility and is treated as a
   one-element array.
3. **Validate codes against a bundled FPDS reference table** (see Phase 3.1 — built here,
   reused there): unknown codes are rejected with the list of valid ones, and every
   echoed/returned code comes back as `{code, description}` (design convention #4). This
   is what kills the `8A`-vs-`8AN` inversion class of error permanently.
4. If exact matching cannot be had upstream: keep the upstream filter to narrow, apply an
   exact client-side match on the (now correctly mapped) per-row set-aside code, and
   report per the P0-2 honesty rules (`total: null` + warning) — never an upstream
   substring count presented as an exact one.
5. Fix the per-row `set_aside` mapping from the Phase 0 fixture and add it to the
   fixture-mapping test.

**Acceptance.** `set_aside: ["8A"]` returns only extent-competed 8(a) *competed* awards
with `{code: "8A", description: "8(a) Competed"}` on every row and a total consistent with
row-level codes; `["8AN"]` and `["8A"]` return disjoint sets.

### P0-4 — Unfiltered `total` doesn't reconcile with agency-scoped totals

**Repro (live).** Unscoped 8AN Aug–Sep total: 1,331. Army (`2100`) alone: 510. Spec adds
GSA at 107, while USAspending puts Army+GSA at 623 and the grand total at 1,928. The
agency-scoped numbers track USAspending closely; the unscoped total is ~600 short and
nothing explains where they went.

**Plan.** This is an investigation, not a code change, and it must run *after* P0-1/P0-3
so the instruments aren't lying:
1. With exact set-aside matching and working pagination, enumerate the full unscoped 8AN
   window from Tango and bucket by agency client-side. Compare per-agency buckets with
   per-agency scoped queries — this localizes whether rows are missing from the unscoped
   query or double-counted in scoped ones.
2. Pin down what Tango's `total`/`count` counts (awards vs transactions vs IDV orders) and
   which date field `award_date_gte/lte` compares, using individual award records from
   USASpending as ground truth. Label both in the response: every list/count response
   gains `count_unit` and `date_field` fields (design conventions #6/#7).
3. If the divergence is upstream (likely), report it to Tango with the reproduction, and
   **until it's resolved, suppress or annotate the unscoped total** — per the spec, a
   wrong number is worse than a missing one. Concretely: when no agency filter is set and
   the discrepancy condition is unresolved, return the total under
   `total_upstream_unverified` with a warning, not as `total`.

**Acceptance.** Either the unscoped total reconciles (sum of agency buckets ± documented
tolerance) or the response stops presenting it as trustworthy.

---

## Phase 2 — Server-wide conventions (the spec's design section)

The P0s are instances of missing conventions. Implement these once, centrally, so the next
tool can't reintroduce them:

1. **Shared response envelope** (`utils/response.ts`): `{results, total|null, count_unit,
   date_field?, filters: {upstream, client_side}, warnings[], next_cursor}` for every list
   tool; adopt in Tango and HigherGov tools in this pass, SAM/USASpending/join tools as
   they're next touched.
2. **Reject unknown parameters.** `callTool` in `src/tools/index.ts:106` dispatches raw
   args with no schema validation. Add a validation step there that checks incoming args
   against the tool's declared `inputSchema` (Ajv or a small hand-rolled checker —
   schemas are simple) and returns `bad_request` naming the unknown key. This closes the
   accept-and-ignore hole at the MCP boundary, mirroring the upstream-parameter honesty
   work from Phase 0.2.
3. **One cursor shape everywhere** — done via Phase 1 (P0-3, P0-5b) and the shared helper.
4. **Codes with descriptions** — done via the FPDS reference table (P0-1 / Phase 3.1).
5. **Zero results vs failed filter** — falls out of #1 + #2: a filter is either bound
   upstream, declared client-side, or rejected; an empty `results` with a coherent `total`
   is then unambiguous.
6. **Date semantics documented** on every date filter's schema description (which FPDS
   field, resolved in Phase 0.2/P0-4).
7. **Count units labeled** via `count_unit` in the envelope.

Also in this phase: run `npm test` in CI (the Railway deploy workflow currently deploys on
push to main without running the test suite), so the new fixture tests actually gate.

---

## Phase 3 — Follow-on tools (spec's build order, after all P0s)

Per the spec's own ordering; none of these start while a P0 is open. Each returns the
Phase 2 envelope from day one.

1. **`lookup_reference_code(domain, code)`** — bundled static FPDS reference table
   (set-aside, extent-competed, award-type, solicitation-procedure, competition). Built
   as part of P0-1; exposing it as a tool is a small step. No API key, no network.
2. **`get_award_detail(award_id)`** — USASpending `GET /awards/{id}/` (public, no key),
   returning `type_set_aside` + description, `extent_competed`,
   `number_of_offers_received`, `other_than_full_and_open_competition`. This is the
   verification primitive that catches any future filter lying.
3. **`aggregate_contracts(filters, group_by[], metric)`** — USASpending
   `/search/spending_by_category/` + `/search/spending_by_award_count/` backed; group_by
   agency, sub_agency, set_aside, naics, psc, month, recipient; metric count|obligations.
   The spec calls this the highest-leverage missing tool; it also removes the
   pull-and-count-client-side pattern that pagination limits break.
4. **`search_highergov_opportunities(...)` + `list_highergov_saved_searches()`** — takes
   the `highergov-setaside-export` skill off browser automation. Field mappings come from
   Phase 0 fixtures, params get the P0-6 probe-and-verify treatment before shipping.
5. **`get_opportunity_documents(opportunity_id)`** (+ amendments) — attachment retrieval
   so `bd-assistant` can read solicitations without manual upload. The HigherGov
   opportunity normalizer already surfaces `attachments[]` with URLs; this tool fetches
   the content.
6. **`get_sba_goaling_report(fiscal_year)`** — the only non-FPDS ground truth on the list.

The remaining P1 items (reconcile_sources, resolve_entity, get_sam_entity, subawards,
protests, IDV orders, SAM notices, vehicle ceilings, source freshness) and all P2 items
stay in the backlog in spec order — deliberately not scheduled here so the P0/convention
work doesn't dilute.

---

## Test & verification strategy

- **Fixture unit tests** (no network, run in CI): normalizer mapping completeness per
  backend, cursor extraction, envelope shape, unknown-param rejection, set-aside code
  validation.
- **Live smoke script** (`scripts/smoke.ts`, key-gated, run manually pre-release): replays
  the exact repro probes from this document — 8A vs 8AN totals and row codes, amount
  filter honesty, VA agency binding, populated HigherGov records, cursor walk >100 rows —
  and fails loudly on any regression.
- **Acceptance gates**: each P0 closes only when its repro probe passes and its fixture
  test exists.

## Risks / open questions

- **Tango upstream behavior** (substring matching, unscoped-total divergence, agency-name
  timeouts) may not be fixable on our side; the plan's mitigations are exactness
  client-side + honest labeling + an upstream bug report. If Tango exposes better params
  than we find in Phase 0.2, several fixes shrink.
- **HigherGov plan limits**: probe volume in Phase 0 should respect the 200ms pacing and
  documented plan ceiling; fixtures mean we probe once, not per-test.
- **Schema changes** (`set_aside` string→array, added `cursor`) are backward-compatible as
  specified (string still accepted), but clients that parsed the old `filters` echo shape
  will see the new `{upstream, client_side}` split — release-note it.
