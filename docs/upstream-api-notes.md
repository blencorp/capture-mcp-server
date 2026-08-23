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
- **Daily rate limit**: the 2026-08-23 capture run hit `429 Rate limit
  exceeded for daily` after a handful of calls (reset ~6h) — the account's
  daily ceiling is small; budget probes accordingly. The captured page
  (`fixtures/raw/tango-contracts-page.json`) shows the current default list
  response DOES include `set_aside` per row.
- `count` is documented as "the total number of contracts matching the query" (award-level); whether modifications/transactions ever roll up separately is unverified.
- Unscoped totals diverge from agency-scoped sums (unscoped 8AN = 1,331 vs Army alone = 510 + GSA 107, while USAspending grand total = 1,928). Reported per P0-4; until resolved, set-aside-filtered totals are surfaced as `total_upstream_unverified`.
- Contract detail endpoint `GET /api/contracts/{key}/` is documented (transactions + subawards_summary) — a candidate backend for future mod-history work.

## HigherGov (all `/api-external/` endpoints)

Documentation source: **the official OpenAPI 3.0.3 spec (v1.2), retrieved
2026-08-23** from `https://www.highergov.com/api-external/schema/?format=json`
(the URL the Swagger UI at `/api-external/docs/` loads) and committed as
`fixtures/raw/highergov-openapi.json`. "spec" below means confirmed there.
The spec is authoritative for which parameters and record fields *exist*;
"spec + verified" additionally means observed live — a full live
`capture-fixtures` run was completed 2026-08-23 with a real key
(`fixtures/raw/highergov-*-page.json`; api_key redacted from all saved
payloads, which matters because HigherGov embeds it in `links.*` and
`document_path` URLs). Note: HigherGov silently ignores unknown query params,
so a spec-absent param is a no-op — EXCEPT on `/opportunity/`, which returns
400 when no binding param at all is present (see below).

Endpoint roster per the spec: `/agency/`, `/awardee/`, `/awardee-mp/`,
`/awardee-partnership/`, `/contract/`, `/document/`, `/grant/`,
`/grant-program/`, `/idv/`, `/naics/`, `/nsn/`, `/opportunity/`, `/people/`,
`/psc/`, `/pursuit/`, `/sl-contract/`, `/subcontract/`, `/subgrant/`,
`/vehicle/`. All are GET list endpoints — there are **no detail routes**;
lookups go through list query params.

**Pagination envelope (spec, all endpoints):**
`{results: [...], meta: {pagination: {page, pages, count}}, links: {first,
last, next, prev}}`. The next-page URL is `links.next` (this is why the old
`payload.next` probe returned null — P0-5b); the total is
`meta.pagination.count`. `highergovNextCursor()`/`highergovTotal()` read these
locations first, with the legacy probes kept as fallbacks.

## HigherGov `GET /api-external/contract/`

Complete query-parameter list per the spec — anything not listed here does not
exist upstream:

| Param | Status | Notes |
| --- | --- | --- |
| `api_key` | spec + verified | Required query param. |
| `page_size`, `page_number`, `ordering` | spec + verified | `page_size` max 100. `ordering` field names are not enumerated in the spec — unverified which values bind. |
| `award_id`, `parent_award_id` | spec + verified | Lookup params used by `get_highergov_contract` (fixed in e2ddba9); `award_id` is also the record field. |
| `naics_code`, `psc_code` | spec + verified | Bound in live probe (rows matched requested NAICS, 2026-08-23). Multi-code/OR syntax is **not** documented — the tools still send comma-joined lists as best effort. |
| `awarding_agency_key` | spec + verified | Binds: probe with key `318` (Census) returned only rows whose `awarding_agency.agency_key === 318` (2026-08-23). Integer HigherGov agency keys are the only agency filters that exist; exposed as `agency_key` on `search_highergov_contracts`. `/agency/` itself is only filterable by `agency_key`, so a *name* cannot be resolved server-side. |
| `funding_agency_key` | spec | Same shape as `awarding_agency_key`; not live-probed. |
| `awardee_key`, `awardee_key_parent`, `awardee_uei`, `awardee_uei_parent` | spec | `awardee_uei` exposed on `search_highergov_contracts`. |
| `captured_date`, `last_modified_date` | spec | `last_modified_date` "filter (format: YYYY-MM-DD)"; `captured_date` is the date HigherGov captured the last amendment (may lag `last_modified_date` by 1–90 days per the spec). |
| `search_id`, `vehicle_key` | spec | Saved-search and vehicle-key filters. |
| `agency_name` | does-not-exist | Confirmed absent from the spec; live probe had already shown it not binding (VA query returned Commerce/Interior/DOJ PIIDs, 2026-08-23). The tool no longer sends it; agency names are enforced client-side. |
| `pop_end_after/before`, `min_value`, `max_value` | do-not-exist | Confirmed absent from the spec. Never sent upstream; the tool applies them client-side only and echoes them under `filters.client_side`. |

**Record fields (spec, `Federal Contract` schema)** — the normalizer maps these
exactly; the fixture in `src/tools/__fixtures__/highergov-contract.fixture.ts`
mirrors this shape: `award_id`, `parent_award_id`, `latest_transaction_key`,
`last_modified_date`, `latest_action_date(_fiscal_year)`, `awardee` /
`awardee_parent` (AwardeeSimple: `awardee_key`, `clean_name`, `uei`,
`cage_code`, `path`), `awarding_agency` / `funding_agency` (AgencySimple:
`agency_key`, `agency_name`, `agency_abbreviation`, `agency_type`, `path` — **no
sub-agency field exists**), `vehicle` (VehicleSimple: `vehicle_key`,
`vehicle_name`, …), `period_of_performance_start_date` /
`_current_end_date` / `_potential_end_date`, `total_dollars_obligated`,
`current_total_value_of_award`, `potential_total_value_of_award`, `award_type`,
`award_description_original`, `alt_description`, `solicitation_identifier`,
`related_opportunity_title`, `psc_code` / `naics_code` (nested code objects),
`primary_place_of_performance_{zip,county_name,city_name,state_code,state_name,country_name}`,
`type_of_contract_pricing_description`, `type_of_set_aside`,
`number_of_offers_received`, `extent_competed`, `solicitation_procedures`,
`evaluated_preference`, `fair_opportunity_limited_sources`,
`other_than_full_and_open_competition`, `created_by` / `last_modified_by` /
`approved_by` (PeopleSimple contact objects), `path`. The previously guessed
`piid`, `title`, `recipient_name`, `contract_award_unique_key`,
`award_description`, `contract_vehicle`, `type_of_set_aside_code`, CPARS /
protest / option-period / modification-count fields **do not exist** — the
normalizer and the `get_highergov_contract` output no longer claim them.

Live confirmations (2026-08-23 capture, `highergov-contract-page.json`):
record keys and nesting match the spec exactly; the envelope is
`results`/`meta`/`links` as documented. `type_of_set_aside` carries a
**description with the FPDS code in trailing parens** (e.g.
`"8(A) Sole Source  (8AN)"`, `"Small Business Set Aside - Total (SBA)"`,
null when unrestricted) — `setAsideCodePair`/`normalizeSetAside` parse the
parenthesized code. One caveat: an all-time NAICS query reported
`meta.pagination.count = 100000` with `pages = 33334` — **the count appears
capped at 100,000**; the tool warns when the total is exactly 100,000.

## HigherGov `GET /api-external/opportunity/`, `/people/`, `/document/`

`/opportunity/` params per the spec (complete list): `api_key`, `agency_key`,
`captured_date` (date added to HigherGov), `posted_date` (date posted by the
agency, YYYY-MM-DD), `opp_key`, `version_key`, `source_id`, `source_type`
(`sam`, `dibbs`, `sbir`, `grant`, `sled`), `search_id`, `ordering`,
`page_number`, `page_size`.

- **A binding param is required** (verified live 2026-08-23): a query with
  only `page_size`/`source_type` returns
  `400 ["At least one of the following parameters must be included:
  search_id, captured_date, posted_date, source_id, agency_key, or
  version_key"]`. `search_highergov_opportunities` therefore requires
  `posted_after` and/or `agency_key`.
- **`posted_date` is a single-day exact match** (verified live:
  `posted_date=2026-08-20` returned only rows posted that day, count 2,086) —
  not a range bound. `search_highergov_opportunities` serves `posted_after` by
  walking the window one day per request with a resumable
  `"YYYY-MM-DD|page"` cursor (≤8 requests per call, window capped at 45
  days); `total` is null during a walk.
- **`naics_code` / `psc_code` do not exist on `/opportunity/`** — the tool no
  longer sends them; NAICS/PSC/set-aside/agency-name filtering is client-side
  (the spec's own filtering mechanism for these is a saved search: the
  `search_id` description enumerates supported search fields including NAICS,
  PSC, Set Aside, Agency, Date Posted, Date Due, Value Range).
- `last_modified_date` appears in HigherGov help-guide examples but **not** in
  the spec for `/opportunity/` (unlike `/contract/`, where it is documented).
  `search_highergov_forecasts` still sends it as best-effort narrowing and now
  warns that it may not bind; records carry no last-modified field to verify
  against (record dates are `captured_date` / `posted_date` / `due_date`).
- `opp_key`, `source_id`: lookup params, spec + verified live (e2ddba9).
- Opportunity record fields (spec `Opportunity` schema, live-confirmed
  2026-08-23 — `highergov-opportunity-page.json`): `opp_cat`, `title`,
  `description_text`, `ai_summary`, `source_id(_version)`, `captured_date`,
  `posted_date`, `due_date`, `agency` (AgencySimple), `naics_code`/`psc_code`
  (nested single-code objects), `opp_type.description`, `vehicle` (string),
  `primary_contact_email`/`secondary_contact_email` (PeopleSimple),
  `set_aside` (string), `nsn`, `val_est_low`/`val_est_high`, `pop_country`/
  `pop_state`/`pop_city`/`pop_zip`, `opp_key`, `version_key`, `source_type`,
  `sole_source_flag`, `path`, `source_path`, `document_path`. There is **no
  `attachments` field** — documents come from `/document/`. `set_aside`
  carries **bare FPDS codes** live (`SBA`, `8AN`, `SDVOSBC`; null when
  unrestricted) — unlike contracts, no description. `document_path` is a
  ready-made `/document/` URL **embedding the caller's api_key** — never
  surface it; the tools parse only its `related_key`.

`/people/` params per the spec: `api_key`, `contact_email`, `ordering`,
`page_number`, `page_size` — **`contact_email` is the only filter and the only
lookup key; there is no person ID or detail route.** The previously sent
`agency_name` / `sub_agency_name` / `search` params do not exist and were
ignored (results were unfiltered). `search_highergov_people` now binds `email`
upstream and applies agency / role keywords client-side with warnings;
`get_highergov_person` requires an email. Record fields (live-confirmed
2026-08-23 — `highergov-people-page.json`): `contact_first_name`,
`contact_last_name`, `contact_name`, `contact_title`, `contact_email`,
`contact_phone`, `contact_ext`, `contact_fax`, `agency` (AgencySimple),
`contact_type`, `last_seen`, `path`. The previously mapped `verified_email`,
`bio`, `recent_activity` fields do not exist.

`/document/` params per the spec: `api_key`, `related_key` (**required**,
described only as "Document Key"), `ordering`, `page_number`, `page_size`.
The previously sent `opp_key` param does not exist. **The correct
`related_key` is the hex key embedded in the opportunity record's own
`document_path` URL** (verified live 2026-08-23): querying with the raw
`opp_key` returns 200 with zero rows (silent miss), and the document_path key
is not always the `source_id` (for one solicitation, `source_id` was
`36C26027R0007` while the related key was a hex ID; that key returned 1
document). `get_opportunity_documents` parses `related_key` from
`document_path`, falling back to `source_id`. Record fields (`FileTracker`,
live-confirmed — `highergov-document-page.json`): `file_name`, `file_type`
(e.g. `.pdf`), `file_size` (bytes), `posted_date` (full ISO timestamp),
`text_extract`, `summary`, `download_url`.

## USASpending (api.usaspending.gov/api/v2)

Public, stable, documented; no key. Endpoints in use: `/agency/{code}/awards/`,
`/agency/{code}/obligations_by_award_category/`,
`/agency/{code}/budgetary_resources/`, `/search/spending_by_award/`,
`/awards/{generated_unique_award_id}/`, `/search/spending_by_category/{category}/`,
`/search/spending_over_time/`, `/search/spending_by_award_count/`.
`time_period` accepts explicit `date_type` (`action_date` | `date_signed` |
`new_awards_only`); tools default to `action_date` and label it.
