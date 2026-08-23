# Upstream API parameter contract

Working notes on what each upstream API actually honors. Both Tango and
HigherGov **silently ignore unknown query parameters**, which is the root cause
behind most of the P0 bugs (see docs/fix-plan.md) — a guessed parameter name
fails invisibly. Every parameter a tool sends must have a row here.

Statuses: **verified** (observed live), **unverified** (best documented guess —
tool must post-verify or warn), **does-not-bind** (observed ignored).

Run `npm run capture-fixtures` with live keys to refresh raw payload fixtures
in `fixtures/raw/` and re-run the binding probes; update this file with the
verdicts.

## Tango `GET /api/contracts/`

| Param | Status | Notes |
| --- | --- | --- |
Documentation source: tango.makegov.com/docs (indexed via Context7,
`/websites/tango_makegov` — quick-start, api-reference/contracts,
data-dictionary/contracts). "documented" below means confirmed there.

| Param | Status | Notes |
| --- | --- | --- |
| `limit`, `page`, `ordering` | documented | Page size ≤100 observed; `page` and `ordering` (e.g. `-award_date`) are documented. |
| `shape` | documented | Field selection incl. nested expansions, e.g. `recipient(display_name,uei)`, `set_aside(code,description)`. **The default list response is a subset of fields that omits set_aside** — this was the root cause of unreadable per-row codes. The tool always sends a shape and falls back to unshaped on a 400. |
| `awarding_agency` (code) | verified + documented | Binds (`2100` → Army, 2026-08-23). Docs say codes, names, and abbreviations with best-effort matching. |
| `awarding_agency` (name) | rejected by us | Despite the docs, `"Army"` hung upstream past our 30s timeout twice (2026-08-23). The tool requires codes. `/api/organizations/?fpds_code=` exists for resolution. |
| `award_date_gte` / `award_date_lte` | verified + documented | Documented; **which FPDS date field it compares is still undocumented** — `action_date` vs `date_signed` produced 1,928 vs 2,847 on the same window. Responses label `date_field`. |
| `set_aside` | verified (loose) + documented | Documented param; docs also document OR syntax (`a|b`) which the tool uses for multi-code filters. Matching semantics are not documented and were observed loose live (`8A` (1,450) ⊇ `8AN` (1,331), 2026-08-23), so exact matching stays client-side against the shaped `set_aside.code`. |
| `obligated_gte` / `obligated_lte` | documented | Server-side amount bounds in USD (obligated dollars). `award_amount_min/max` map to these, with client-side verification kept as a tripwire. |
| `search`, `uei`, `recipient`, `naics`, `psc`, `piid`, `fiscal_year` | documented | `uei` exact, `recipient` partial, `piid` case-insensitive, `naics`/`psc` support OR syntax. |
| `award_type` | documented | Award type code filter. |
| pagination | verified + documented | DRF envelope `{count, next, previous, results}`; the `next` URL is used verbatim as `next_cursor` and validated against the Tango origin on the way back in. |

Open items:
- `count` is documented as "the total number of contracts matching the query" (award-level); whether modifications/transactions ever roll up separately is unverified.
- Unscoped totals diverge from agency-scoped sums (unscoped 8AN = 1,331 vs Army alone = 510 + GSA 107, while USAspending grand total = 1,928). Reported per P0-4; until resolved, set-aside-filtered totals are surfaced as `total_upstream_unverified`.
- Contract detail endpoint `GET /api/contracts/{key}/` is documented (transactions + subawards_summary) — a candidate backend for future mod-history work.

## HigherGov `GET /api-external/contract/`

Documentation source: Context7 indexes the HigherGov API docs
(`/websites/highergov_api-external`), but the site is a Swagger UI whose
parameter/field tables render client-side, so the index only carries endpoint
stubs. It does confirm the endpoint roster (`/contract/`, `/opportunity/`,
`/awardee/`, `/people/`, `/vehicle/`, `/document/`). Field-level schema still
requires a live `capture-fixtures` run or the "Try It Out" button in the OAS
docs at highergov.com/api-external/docs/.

| Param | Status | Notes |
| --- | --- | --- |
| `api_key` | verified | Query param. |
| `page_size`, `page_number` | verified | Page pagination. |
| `award_id`, `parent_award_id` | verified | Lookup params used by `get_highergov_contract` (fixed in e2ddba9). Implies the record field is `award_id`. |
| `naics_code`, `psc_code` | verified | Bound in live probe (rows matched requested NAICS, 2026-08-23). |
| `agency_name` | does-not-bind | VA query returned Commerce/Interior/DOJ PIIDs (2026-08-23). The tool now post-verifies agency on the returned rows, filters client-side, and warns. Probe `agency_key` / `awarding_agency_key` with a live key. |
| `pop_end_after/before`, `min_value`, `max_value` | unverified | Guessed the same way `agency_name` was; treat results as unfiltered until verified. |
| `search_id`, `last_modified_date`, `captured_date`, `source_type` | documented | Per HigherGov's public API overview. |

Record field names: the previous normalizer guessed names (`piid`, `title`,
`recipient_name`, …) that don't exist — only `naics_code`, `psc_code`, `path`
matched, which is why every record came back hollow (P0-5). The normalizer now
probes FPDS/USAspending-style names (`award_id`, `award_description`, nested
`awarding_agency`/`awardee`, `period_of_performance_current_end_date`,
`current_total_value_of_award`, …) with the legacy names as fallbacks, and
raises a structured warning listing the raw record's actual keys whenever the
mapping fails to populate core fields — mapping drift can no longer be silent.
Capture `fixtures/raw/highergov-contract-page.json` to lock the real names in.

Pagination: the `next` token was not found at `payload.next` in live responses
(next_cursor came back null on page 1 of a large set). `highergovNextCursor()`
now probes `next`, `links.next`, `pagination.next`, `meta.next`,
`result_set.next` and falls back to page math. Verify against a captured
fixture.

## HigherGov `GET /api-external/opportunity/`, `/people/`

- `opp_key`, `source_id`, `search_id`, `modified_since`, `page_size`,
  `page_number`: in use; lookups verified by e2ddba9.
- Opportunity search filters (`naics_code`, `psc_code`, posted-date):
  unverified — `search_highergov_opportunities` sends best-guess upstream
  params and always applies verifiable client-side filtering with an explicit
  filter echo.

## USASpending (api.usaspending.gov/api/v2)

Public, stable, documented; no key. Endpoints in use: `/agency/{code}/awards/`,
`/agency/{code}/obligations_by_award_category/`,
`/agency/{code}/budgetary_resources/`, `/search/spending_by_award/`,
`/awards/{generated_unique_award_id}/`, `/search/spending_by_category/{category}/`,
`/search/spending_over_time/`, `/search/spending_by_award_count/`.
`time_period` accepts explicit `date_type` (`action_date` | `date_signed` |
`new_awards_only`); tools default to `action_date` and label it.
