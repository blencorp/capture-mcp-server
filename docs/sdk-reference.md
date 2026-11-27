# Tool reference

The server has 34 narrow tools over five sources. Every tool is read-only. There is no code to
write and no sandbox: your assistant fills in a tool's arguments, and the server runs the call. This
page is generated from the tool definitions in `src/tools`, so it matches what the server accepts.

## Results and errors

A result is JSON, returned as text and as structured content. Records from SAM.gov, Tango, HigherGov
and USAspending are third-party text: they can contain words that look like instructions.

These tools return a list envelope: the records (under a key named for them), `total`,
`count_unit`, `filters`, `next_cursor`, and sometimes `date_field` and `warnings`:
`search_tango_contracts`, `search_tango_grants`, `search_tango_opportunities`,
`search_highergov_contracts`, `search_highergov_people`, `search_highergov_opportunities` and
`search_usaspending_awards_by_recipient` (which adds its own summary fields).
`search_highergov_forecasts` returns the same keys, built without the client-side check on `total`.
`filters.upstream` is what the source applied and `filters.client_side` is what the server applied to
the page it got. When any client-side filter ran, `total` is `null` because the source's total does
not reflect it; the source's own number is then in `total_upstream_unfiltered`, with a warning. Pass
`next_cursor` back as `cursor` for the next page. It is `null` on the last page.

Other tools that return records keep their own shapes. They carry no `filters` split or `count_unit`,
and most have no cursor. A missing `total` becomes `0` rather than `null`, except in the saved-search
list, which has no `total`:

| Tool | Result |
| --- | --- |
| `search_sam_entities` | `{ total, entities, page, limit }` |
| `get_sam_opportunities` | `{ total, opportunities, dateRange, limit }` |
| `check_sam_exclusions` | `{ total, excluded, exclusions, searchCriteria }` |
| `search_tango_protests` | `{ total, protests, filters, limit }` |
| `search_tango_idvs` | `{ total, idvs, filters, limit }` |
| `search_tango_vehicles` | `{ total, vehicles, filters, limit }` |
| `search_tango_otas` | `{ total, otas, filters, limit }` |
| `list_highergov_saved_searches` | `{ results, source_endpoint, next_cursor }` |

Here `filters` is the plain list of parameters sent, not an `upstream` and `client_side` pair. Tools that
return one record or a summary (for example `get_tango_spending_summary`) have shapes of their own.

Every tool declares a title, annotations (all are read-only) and an output schema. A successful call
returns `structuredContent` that matches the schema, and the same JSON as indented text for
assistants that read only text. The list tools' schemas require their whole envelope; the other tools'
describe only what their results share, because the fields of the records come from the sources.

A call can fail in three ways. Which one you see depends on the tool. All three are results marked
`isError: true`, with the error in `structuredContent` and, as text, in the content.

- **A structured error.** `{ "error": { "code": "…", "message": "…" } }`, and for the HigherGov
  tools also `retry_after_seconds`. The codes are `bad_request` (an argument the tool refuses,
  including an unknown, missing or mistyped argument), `not_found`, and `ambiguous_award_id`. The
  HigherGov tools add `auth_failed` (the source refused the key), `rate_limited` (with a wait) and
  `upstream_error`.
- **A plain error text.** `{ "error": "API Error 401: …" }`. The source answered with an error
  status, or the call could not reach it (`Network error: …`). The text carries the status and the
  body the source sent, cut to 500 characters, with your key and any `api_key=` value replaced by
  `[REDACTED]`. Successful responses are not redacted, except that the HigherGov tools drop the URLs
  in which HigherGov embeds the key.
- **A thrown error.** A tool that throws returns `{ "error": "message" }`.

When your client cancels a call, the server cancels its request to the source.

A call to a tool name the connection does not have, for example one whose key it lacks, is not a tool
result but a JSON-RPC error: code `-32602`, `Tool … not found`.

Results that carry `*_error` fields beside data (`get_tango_idv_children`, when one of its two
lookups fails) are partial results, not failures: they are not marked `isError`.

## Which tools a connection has

| Source | Tools | Needs |
| --- | --- | --- |
| Reference codes | 1 | nothing |
| USAspending | 6 | nothing |
| SAM.gov | 4 | a SAM.gov key |
| SAM.gov and USAspending together | 2 | a SAM.gov key |
| Tango | 12 | a Tango key |
| HigherGov | 9 | a HigherGov key |

The server lists only the tools whose key the connection has. With no keys, that is the 7
reference and USAspending tools. The two tools that join SAM.gov with USAspending need the SAM.gov
key. On the hosted server, the keys are the ones you entered when you connected. On your own
computer, they are the ones in the server's environment.

## Keys are not arguments

No tool takes an API key as an argument, and a call that includes one is rejected. The server adds the
connection's key for the tool's source itself, so a key never passes through your assistant or its
client.

## Tools

### Reference codes

A static table of official FPDS code descriptions. It uses no key and makes no network request, so it always works.

#### `lookup_reference_code(args)`

Look up the official FPDS description for a procurement reference code, or list a whole domain. Domains: set_aside, extent_competed, award_type, solicitation_procedure, competition. Use this BEFORE filtering or reporting on any code — e.g. set_aside 8A is '8(a) Competed' while 8AN is '8(a) Sole Source'. Static lookup: no API key, no network. Needs no key.

| Parameter | Type | Required | Notes |
| --- | --- | --- | --- |
| `domain` | string | yes | Code domain: one of set_aside, extent_competed, award_type, solicitation_procedure, competition |
| `code` | string | no | The code to look up (e.g. '8AN'). Omit to list every code in the domain. |

### USAspending

The public USAspending.gov API. It needs no key. Every USAspending call waits its turn behind one pacing queue (see [Limits](#limits)).

#### `get_usaspending_awards(args)`

Get federal awards data for a specific agency and fiscal year. Returns award counts, obligations, and top awards. Needs no key.

| Parameter | Type | Required | Notes |
| --- | --- | --- | --- |
| `agency_code` | string | yes | 3-digit agency code (e.g., '075' for HHS, '097' for DOD) |
| `fiscal_year` | number | no | Fiscal year (default: 2024) |
| `limit` | number | no | Number of top awards to return (default: 10) |

#### `get_usaspending_spending_by_category(args)`

Get spending breakdown by award category (contracts, grants, loans, etc.) for an agency and fiscal year. Needs no key.

| Parameter | Type | Required | Notes |
| --- | --- | --- | --- |
| `agency_code` | string | yes | 3-digit agency code (e.g., '075' for HHS) |
| `fiscal_year` | number | no | Fiscal year (default: 2024) |

#### `get_usaspending_budgetary_resources(args)`

Get budgetary resources and obligations for an agency in a fiscal year. Needs no key.

| Parameter | Type | Required | Notes |
| --- | --- | --- | --- |
| `agency_code` | string | yes | 3-digit agency code (e.g., '075' for HHS) |
| `fiscal_year` | number | no | Fiscal year (default: 2024) |

#### `search_usaspending_awards_by_recipient(args)`

Search for federal awards by recipient name, with optional filters for time period and amount ranges. Great for investigating specific companies or organizations. Needs no key.

| Parameter | Type | Required | Notes |
| --- | --- | --- | --- |
| `recipient_name` | string | yes | Name of recipient to search (e.g., 'Boeing', 'Johns Hopkins') |
| `fiscal_year` | number | no | Fiscal year to search by award action date (e.g., 2024) |
| `min_amount` | number | no | Minimum award amount filter |
| `max_amount` | number | no | Maximum award amount filter |
| `award_types` | array of string | no | Award type codes from one USASpending group only (default ['A','B','C','D'] for contract prime awards). Search contracts, IDVs, grants, loans, and other assistance groups separately. |
| `limit` | number | no | Number of results (default: 10, max: 100) |
| `cursor` | string | no | Page number from the prior response's next_cursor. Reuse the same filters and limit when paging. |

#### `get_award_detail(args)`

Get the full FPDS record for a single procurement award from USASpending — the verification primitive: type_set_aside with description, extent_competed, number_of_offers_received, other_than_full_and_open competition authority, and current vs ultimate completion dates. Use it to confirm that a filtered search actually returned what it claimed before a number goes in a memo. Accepts a procurement generated award ID (CONT_AWD_... or CONT_IDV_...) or a bare PIID (resolved via award search first). Assistance IDs (ASST_...) are rejected because they do not carry FPDS competition fields. Needs no key.

| Parameter | Type | Required | Notes |
| --- | --- | --- | --- |
| `award_id` | string | yes | USASpending procurement generated_unique_award_id (e.g. 'CONT_AWD_36C10B26F0223_3600_47QRCA24DV006_4732') or a bare PIID (e.g. '36C10B26F0223') |

#### `aggregate_contracts(args)`

Aggregate federal contract awards from USASpending without pulling rows: group by awarding_agency, awarding_subagency, recipient, naics, psc, month, or set_aside, with metric 'obligations' (dollars) or 'count' (prime awards). This is the tool for questions like 'how many 8(a) sole source awards per agency in Aug-Sep 2025'. Counts state their unit and the date filter states its date_type. group_by=set_aside issues one upstream query per code (~4s each due to rate pacing); metric 'count' is supported for group_by set_aside only (USASpending exposes counts per filter, not per category). Needs no key.

| Parameter | Type | Required | Notes |
| --- | --- | --- | --- |
| `group_by` | string | yes | One of: awarding_agency, awarding_subagency, recipient, naics, psc, month, set_aside |
| `metric` | string | no | 'obligations' (default; aggregated dollars) or 'count' (prime award count; only with group_by=set_aside) |
| `date_from` | string | yes | Start date YYYY-MM-DD (required) |
| `date_to` | string | yes | End date YYYY-MM-DD (required) |
| `date_type` | string | no | Which award date the window filters on: 'action_date' (default), 'date_signed', or 'new_awards_only'. Different choices produce materially different totals — the response echoes this as date_field. |
| `agency` | string | no | Awarding toptier agency NAME as USASpending knows it (e.g. 'Department of Veterans Affairs') |
| `sub_agency` | string | no | Awarding subtier agency name (requires agency) |
| `naics` | array of string | no | NAICS codes |
| `psc` | array of string | no | PSC codes |
| `set_aside` | value | no | FPDS set-aside code(s), validated (e.g. ['8AN','SDVOSBS']). Required when group_by=set_aside. |
| `recipient_search` | string | no | Recipient name or UEI text filter |
| `award_type_codes` | array of string | no | Award type codes (default ['A','B','C','D'] = contract prime awards; see lookup_reference_code domain award_type) |
| `limit` | number | no | Max groups to return for category group_bys (default 25, max 100) |

### SAM.gov

The SAM.gov APIs. These tools need your SAM.gov key.

#### `search_sam_entities(args)`

Search for federal entities/businesses registered in SAM.gov by name, location, or business codes. Useful for finding companies that do business with the government. Needs your SAM.gov key.

| Parameter | Type | Required | Notes |
| --- | --- | --- | --- |
| `query` | string | no | Entity name to search (e.g., 'Boeing', 'Acme Corp') |
| `state` | string | no | State/province filter (e.g., 'VA', 'CA') |
| `naics` | string | no | NAICS industry code filter |
| `uei` | string | no | Unique Entity Identifier to search for specific entity |
| `limit` | number | no | Number of results to return (default: 10, max: 50) |

#### `get_sam_opportunities(args)`

Fetch federal contract opportunities from SAM.gov by date range, keywords, or set-aside types. Perfect for finding new business opportunities. Needs your SAM.gov key.

| Parameter | Type | Required | Notes |
| --- | --- | --- | --- |
| `posted_from` | string | yes | Start date for opportunities (MM/dd/yyyy format, required) |
| `posted_to` | string | yes | End date for opportunities (MM/dd/yyyy format, required) |
| `keyword` | string | no | Keyword to search in opportunity titles/descriptions |
| `set_aside` | string | no | Set-aside type filter (e.g., 'WOSB', 'SDVOSB', 'SBA') |
| `state` | string | no | State filter for opportunity location |
| `limit` | number | no | Number of results (default: 10, max: 50) |

#### `get_sam_entity_details(args)`

Get comprehensive details for a specific entity using their UEI. Returns registration info, business types, certifications, and contact details. Needs your SAM.gov key.

| Parameter | Type | Required | Notes |
| --- | --- | --- | --- |
| `uei` | string | yes | Unique Entity Identifier (required) |

#### `check_sam_exclusions(args)`

Check if an entity is excluded from federal contracting. Critical for due diligence before doing business with government contractors. Needs your SAM.gov key.

| Parameter | Type | Required | Notes |
| --- | --- | --- | --- |
| `uei` | string | no | Unique Entity Identifier to check |
| `entity_name` | string | no | Entity name to check for exclusions |

### SAM.gov and USAspending together

These tools join SAM.gov records with USAspending data. They need your SAM.gov key.

#### `get_entity_and_awards(args)`

Join SAM.gov entity details with their USASpending.gov award history. Perfect for comprehensive analysis of a company's government business profile. Needs your SAM.gov key.

| Parameter | Type | Required | Notes |
| --- | --- | --- | --- |
| `uei` | string | yes | Unique Entity Identifier (required) |
| `fiscal_year` | number | no | Fiscal year for awards (default: 2024) |
| `award_limit` | number | no | Max number of awards to return (default: 10) |

#### `get_opportunity_spending_context(args)`

Join SAM.gov opportunity details with spending context from similar NAICS codes. Helps assess market size and typical award amounts for similar work. Needs your SAM.gov key.

| Parameter | Type | Required | Notes |
| --- | --- | --- | --- |
| `opportunity_id` | string | no | SAM.gov opportunity/notice ID |
| `solicitation_number` | string | no | Solicitation number (alternative to opportunity_id) |
| `fiscal_year` | number | no | Fiscal year for spending context (default: 2024) |

### Tango

Tango's unified API (tango.makegov.com). These tools need your Tango key.

#### `search_tango_contracts(args)`

Search federal contracts through Tango's unified API (FPDS-derived). Set-aside filtering is EXACT on FPDS codes (e.g. 8A = 8(a) Competed vs 8AN = 8(a) Sole Source) and every response echoes which filters ran upstream vs client-side — read `warnings` before trusting counts. Paginate with `cursor` to enumerate result sets past one page. Needs your Tango key.

| Parameter | Type | Required | Notes |
| --- | --- | --- | --- |
| `query` | string | no | Search query for contract description or title |
| `vendor_name` | string | no | Vendor/contractor name filter (verified client-side against returned records) |
| `vendor_uei` | string | no | Vendor Unique Entity Identifier (UEI) |
| `agency` | string | no | Awarding agency FPDS code (e.g. 3600=VA, 2100=Army, 1700=Navy, 5700=Air Force, 9700=DoD other, 4732=GSA/FAS, 7000=DHS, 7500=HHS, 1400=Interior, 1500=DOJ). Agency names are rejected: they hang the upstream. |
| `naics_code` | string | no | NAICS industry classification code |
| `psc_code` | string | no | Product/Service Code (PSC) |
| `award_amount_min` | number | no | Minimum contract award amount (USD), sent to Tango as obligated_gte. The server also checks the page it gets, and says so under filters.client_side if Tango did not honor the bound. |
| `award_amount_max` | number | no | Maximum contract award amount (USD), sent to Tango as obligated_lte. The server also checks the page it gets, and says so under filters.client_side if Tango did not honor the bound. |
| `date_from` | string | no | Start date for contract awards (YYYY-MM-DD). See date_field in the response for which underlying date this compares. |
| `date_to` | string | no | End date for contract awards (YYYY-MM-DD) |
| `set_aside` | value | no | FPDS set-aside code(s), matched EXACTLY — e.g. ["8AN", "SDVOSBS", "HZS"]. Unknown codes are rejected with the valid list. Use lookup_reference_code to check a code's meaning first. |
| `limit` | number | no | Number of results per page (default: 10, max: 100) |
| `cursor` | string | no | Opaque next_cursor from a previous response. Replays the same query for the next page; do not combine with other filters. |

#### `search_tango_grants(args)`

Search federal grants and financial assistance awards through Tango's unified API. Recipient and amount filters are verified client-side and echoed as such. Paginate with `cursor`. Needs your Tango key.

| Parameter | Type | Required | Notes |
| --- | --- | --- | --- |
| `query` | string | no | Search query for grant description or title |
| `recipient_name` | string | no | Grant recipient organization name (verified client-side) |
| `recipient_uei` | string | no | Recipient Unique Entity Identifier (UEI) (verified client-side) |
| `agency` | string | no | Awarding agency name or code |
| `cfda_number` | string | no | Catalog of Federal Domestic Assistance (CFDA) number |
| `award_amount_min` | number | no | Minimum grant award amount (USD). Applied client-side per page. |
| `award_amount_max` | number | no | Maximum grant award amount (USD). Applied client-side per page. |
| `date_from` | string | no | Start date for grant awards (YYYY-MM-DD format) |
| `date_to` | string | no | End date for grant awards (YYYY-MM-DD format) |
| `limit` | number | no | Number of results per page (default: 10, max: 100) |
| `cursor` | string | no | Opaque next_cursor from a previous response |

#### `get_tango_vendor_profile(args)`

Get comprehensive vendor/entity profile from Tango's consolidated database. Provides unified view of entity data from SAM.gov with contract history. Needs your Tango key.

| Parameter | Type | Required | Notes |
| --- | --- | --- | --- |
| `uei` | string | yes | Unique Entity Identifier (UEI) - required |
| `include_contracts` | boolean | no | Include recent contract history (default: false) |
| `include_grants` | boolean | no | Include recent subawards (the entity's five most recent, newest fiscal year first; default: false) |

#### `search_tango_opportunities(args)`

Search federal contract opportunities through Tango's unified API. Enhanced opportunity search with forecasts and solicitation notices. Paginate with `cursor`. Needs your Tango key.

| Parameter | Type | Required | Notes |
| --- | --- | --- | --- |
| `query` | string | no | Search query for opportunity title or description |
| `agency` | string | no | Agency name or code |
| `naics_code` | string | no | NAICS industry classification code |
| `set_aside` | string | no | Set-aside type filter |
| `posted_from` | string | no | Start date for opportunities (YYYY-MM-DD format) |
| `posted_to` | string | no | End date for opportunities (YYYY-MM-DD format) |
| `response_deadline_from` | string | no | Minimum response deadline (YYYY-MM-DD format) |
| `status` | string | no | Opportunity status (e.g., 'active', 'closed', 'forecasted') |
| `limit` | number | no | Number of results per page (default: 10, max: 100) |
| `cursor` | string | no | Opaque next_cursor from a previous response |

#### `search_tango_protests(args)`

Search GAO bid protest records through Tango. Filter by agency, protester, outcome (Sustained/Denied/Dismissed/Withdrawn), case type, and date ranges. Useful for pre-bid risk scoring and identifying repeat protesters. Needs your Tango key.

| Parameter | Type | Required | Notes |
| --- | --- | --- | --- |
| `query` | string | no | Full-text search across title, protester, agency, solicitation, and case number |
| `agency` | string | no | Agency identifier (name, abbreviation, CGAC/FPDS code). Use '\|' for multi-value OR. |
| `protester` | string | no | Protester / petitioner name (vector search) |
| `outcome` | string | no | Protest outcome: 'Sustained', 'Denied', 'Dismissed', or 'Withdrawn' |
| `source_system` | string | no | Source system filter (e.g., 'gao', 'cofc') |
| `case_type` | string | no | Case type substring (e.g., 'Bid Protest', 'Cost Claim') |
| `case_number` | string | no | Exact base case number (e.g., 'b-423274') |
| `solicitation_number` | string | no | Exact solicitation number |
| `filed_date_from` | string | no | Filed on or after (YYYY-MM-DD) |
| `filed_date_to` | string | no | Filed on or before (YYYY-MM-DD) |
| `decision_date_from` | string | no | Decision on or after (YYYY-MM-DD) |
| `decision_date_to` | string | no | Decision on or before (YYYY-MM-DD) |
| `limit` | number | no | Number of results to return (default: 10, max: 100) |

#### `get_tango_protest(args)`

Get the full record for a single bid protest by case number (e.g., 'b-422670'). Returns the same fields as search_tango_protests plus docket URLs and decision URLs. Needs your Tango key.

| Parameter | Type | Required | Notes |
| --- | --- | --- | --- |
| `case_number` | string | yes | Protest case number (the `case_number` field returned by search_tango_protests, e.g., 'b-422670') |

#### `search_tango_idvs(args)`

Search federal Indefinite Delivery Vehicles (IDIQs, BPAs, FSS) through Tango. Returns vehicle-level contracts that issue task/delivery orders. Same filter shape as search_tango_contracts, plus idv_type and last_date_to_order (expiry). Needs your Tango key.

| Parameter | Type | Required | Notes |
| --- | --- | --- | --- |
| `query` | string | no | Search query (description, title, PIID) |
| `vendor_name` | string | no | Vendor / contractor name (recipient) |
| `vendor_uei` | string | no | Vendor UEI |
| `piid` | string | no | Exact PIID |
| `agency` | string | no | Awarding agency name or code |
| `funding_agency` | string | no | Funding agency name or code |
| `naics_code` | string | no | NAICS code |
| `psc_code` | string | no | Product/Service Code (PSC) |
| `set_aside` | string | no | Set-aside code(s); use '\|' for OR |
| `idv_type` | string | no | IDV type code: 'A'=GWAC, 'B'=IDC, 'C'=FSS, 'D'=BOA, 'E'=BPA. Accepts the descriptive name too (e.g., 'GWAC'). |
| `award_date_from` | string | no | Award date on or after (YYYY-MM-DD) |
| `award_date_to` | string | no | Award date on or before (YYYY-MM-DD) |
| `expiring_from` | string | no | Last date to order on or after (YYYY-MM-DD) — find IDVs still accepting orders |
| `expiring_to` | string | no | Last date to order on or before (YYYY-MM-DD) — find IDVs about to close to orders |
| `limit` | number | no | Number of results to return (default: 10, max: 100) |

#### `get_tango_idv_children(args)`

Get the awards issued under a single IDV (its child IDVs, task/delivery orders, and transactions). Use this after search_tango_idvs to drill into a specific vehicle's ordering activity. Needs your Tango key.

| Parameter | Type | Required | Notes |
| --- | --- | --- | --- |
| `idv_key` | string | yes | Tango IDV key (from the `idv_key` field of a search_tango_idvs result) — required |
| `include_child_idvs` | boolean | no | Include child IDVs (sub-IDIQs under this parent). Default: true |
| `include_task_orders` | boolean | no | Include task/delivery order awards issued against this IDV. Default: true |
| `include_transactions` | boolean | no | Include obligation transactions (lower-level, may be large). Default: false |
| `limit_per_section` | number | no | Max rows per section (default: 20, max: 100) |

#### `search_tango_vehicles(args)`

Search the federal contract-vehicle catalog (BPAs, GWACs, GSA MAS Schedules, agency-wide IDIQs) through Tango. Vehicles aggregate the holders, scope, and obligations of a procurement instrument. Distinct from /idvs/ which lists raw IDV awards. Needs your Tango key.

| Parameter | Type | Required | Notes |
| --- | --- | --- | --- |
| `query` | string | no | Search query (vehicle name, program acronym, description) |
| `vehicle_type` | string | no | Vehicle (IDV) type code; use '\|' for OR (e.g., 'GWAC\|BPA') |
| `type_of_idc` | string | no | Type of IDC code; use '\|' for OR |
| `contract_type` | string | no | Contract type code; use '\|' for OR |
| `set_aside` | string | no | Set-aside code(s); use '\|' for OR |
| `naics_code` | string | no | NAICS code (exact) |
| `psc_code` | string | no | PSC / Product Service Code |
| `program_acronym` | string | no | Program acronym (e.g., 'SEWP', 'OASIS', 'CIO-SP3') |
| `who_can_use` | string | no | Who-can-use code (e.g., 'gov-wide', agency-restricted) |
| `agency` | string | no | Awarding agency / department / sub-agency |
| `organization_id` | string | no | Awarding organization UUID (exact) |
| `total_obligated_min` | number | no | Minimum total obligated across the vehicle (USD) |
| `total_obligated_max` | number | no | Maximum total obligated across the vehicle (USD) |
| `limit` | number | no | Number of results to return (default: 10, max: 100) |

#### `search_tango_otas(args)`

Search federal Other Transaction Authority (OTA) awards through Tango. OTAs are flexible R&D / prototype agreements outside the FAR. Note: OTAs have no NAICS or set-aside fields by design. Needs your Tango key.

| Parameter | Type | Required | Notes |
| --- | --- | --- | --- |
| `query` | string | no | Search query (description, title, PIID) |
| `vendor_name` | string | no | Vendor / recipient name |
| `vendor_uei` | string | no | Vendor UEI |
| `piid` | string | no | Exact PIID |
| `agency` | string | no | Awarding agency name or code |
| `funding_agency` | string | no | Funding agency name or code |
| `award_date_from` | string | no | Award date on or after (YYYY-MM-DD) |
| `award_date_to` | string | no | Award date on or before (YYYY-MM-DD) |
| `fiscal_year` | number | no | Fiscal year of award |
| `limit` | number | no | Number of results to return (default: 10, max: 100) |

#### `get_tango_entity_metrics(args)`

Get a time-series of obligations for a single entity (by UEI), bucketed by month/quarter/year over a lookback window. Use this after get_tango_vendor_profile to see spending trends, not just totals. Needs your Tango key.

| Parameter | Type | Required | Notes |
| --- | --- | --- | --- |
| `uei` | string | yes | Unique Entity Identifier (UEI) — required |
| `months` | number | no | Lookback window in months (e.g., 12, 36, 60). Default: 36 |
| `period_grouping` | string | no | Bucket size: 'month', 'quarter', or 'year'. Default: 'quarter' |
| `group_by` | string | no | Optional secondary slice: 'agency' or 'department' |

#### `get_tango_spending_summary(args)`

Get spending summaries and analytics from Tango's unified platform, aggregated over the fetched page of contracts. WARNING: aggregates at most one page (100 records) — the response says when the underlying result set is larger. For reliable full-population aggregation use aggregate_contracts (USASpending). Needs your Tango key.

| Parameter | Type | Required | Notes |
| --- | --- | --- | --- |
| `agency` | string | no | Awarding agency FPDS code (e.g. 3600=VA, 2100=Army, 1700=Navy, 5700=Air Force, 9700=DoD other, 4732=GSA/FAS, 7000=DHS, 7500=HHS, 1400=Interior, 1500=DOJ) |
| `vendor_uei` | string | no | Vendor UEI for spending summary |
| `fiscal_year` | number | no | Fiscal year for summary (e.g., 2024) |
| `group_by` | string | no | Group spending by dimension: 'agency' (default), 'vendor', 'naics', 'psc', 'month' |
| `award_type` | string | no | Filter by award type: 'contracts', 'grants', 'all' (default: 'all') |

### HigherGov

HigherGov's API. These tools need your HigherGov key.

#### `search_highergov_forecasts(args)`

Pull forecasts matching a HigherGov saved search. Returns the paginated list of new or updated forecasts since `since` (default: last 24 hours). Use `next_cursor` to page. Saved-search IDs come from list_highergov_saved_searches or the HigherGov UI. Needs your HigherGov key.

| Parameter | Type | Required | Notes |
| --- | --- | --- | --- |
| `saved_search_id` | string | yes | HigherGov saved-search ID (required) |
| `since` | string | no | ISO-8601 datetime; defaults to last 24h |
| `limit` | number | no | Number of results (default 50, max 200; HigherGov documents a page-size maximum of 100) |
| `cursor` | string | no | Page number from prior next_cursor |

#### `get_highergov_opportunity(args)`

Get one opportunity by HigherGov ID, SAM notice ID, or URL. Returns the full record including agency, NAICS, vehicle, set-aside, value, dates, and description. The HigherGov opportunity record has no attachments: use get_opportunity_documents for the solicitation files. If `incumbent_contract_id` is present, follow up with get_highergov_contract to enrich. Needs your HigherGov key.

| Parameter | Type | Required | Notes |
| --- | --- | --- | --- |
| `id` | string | yes | HigherGov opportunity ID, SAM notice ID, or HigherGov URL |

#### `search_highergov_contracts(args)`

Search awarded federal contracts by agency, NAICS, PSC, set-aside, period-of-performance end-date range, and value bounds. Use to find recompete candidates 12–18 months ahead of PoP end. At least one of agency, agency_key, awardee_uei, naics, or psc is required. Every response echoes which filters ran upstream vs client-side and warns when a filter could not be verified — read `warnings` before trusting counts. Needs your HigherGov key.

| Parameter | Type | Required | Notes |
| --- | --- | --- | --- |
| `agency` | string | no | Agency name or slug. The upstream API only filters by numeric key (see agency_key), so names are enforced client-side against returned records — see warnings. |
| `agency_key` | number | no | HigherGov awarding agency key (numeric). The only agency filter the upstream API honors (awarding_agency_key). Find it on the agency page URL in the HigherGov UI or via /api-external/agency/. |
| `awardee_uei` | string | no | Awardee UEI (server-side filter) |
| `naics` | array of string | no | NAICS codes (server-side filter; comma-joined, which HigherGov does not document as OR syntax) |
| `psc` | array of string | no | PSC codes (server-side filter; comma-joined, which HigherGov does not document as OR syntax) |
| `set_aside` | array of string | no | Set-aside slugs or FPDS codes (e.g. ['sdvosb','8a'] or ['SDVOSBS','8AN']). Applied client-side against normalized records. |
| `pop_end_after` | string | no | ISO-8601 date; period-of-performance end on/after this date (applied client-side; upstream has no PoP filter) |
| `pop_end_before` | string | no | ISO-8601 date; period-of-performance end on/before this date (applied client-side) |
| `min_value` | number | no | USD (applied client-side; upstream has no value filter) |
| `max_value` | number | no | USD (applied client-side) |
| `limit` | number | no | Default 50, max 200 (HigherGov documents a page-size maximum of 100) |
| `cursor` | string | no | Page number from prior next_cursor |

#### `get_highergov_contract(args)`

Get full record for one contract by award ID (PIID). Returns incumbent, dates, values, set-aside, vehicle, competition details (extent competed, offers received), pricing type, place of performance, and contracting-office contacts. Needs your HigherGov key.

| Parameter | Type | Required | Notes |
| --- | --- | --- | --- |
| `id` | string | yes | HigherGov contract ID or PIID |

#### `search_highergov_people(args)`

Search federal POCs. The upstream API only filters by contact email; agency and role keywords are applied client-side against returned pages — page with next_cursor to cover more. `email` may be null — if absent, do not draft outreach. Needs your HigherGov key.

| Parameter | Type | Required | Notes |
| --- | --- | --- | --- |
| `agency` | string | no | Agency slug or name (applied client-side; see warnings) |
| `email` | string | no | Exact contact email (the only server-side filter the upstream API supports) |
| `role_keywords` | array of string | no | Matched client-side against contact titles |
| `limit` | number | no | Default 20, max 100 |
| `cursor` | string | no | Page number from prior next_cursor |

#### `get_highergov_person(args)`

Get the full profile for one POC by contact email (the only lookup the upstream API supports), including phone and agency. If `email` is null on a search result, there is nothing to look up — do not draft outreach. Needs your HigherGov key.

| Parameter | Type | Required | Notes |
| --- | --- | --- | --- |
| `id` | string | yes | Contact email address (person_id from search_highergov_people when it is an email) |

#### `search_highergov_opportunities(args)`

Search active contract opportunities without a saved search. The upstream API requires posted_after (served by walking its single-day posted_date filter, one request per day, resumable via next_cursor) and/or agency_key; set-aside bundle, NAICS, PSC, agency name, and deadline filters are applied client-side — read the filter echo and warnings. Returns Notice IDs for dedup. Needs your HigherGov key.

| Parameter | Type | Required | Notes |
| --- | --- | --- | --- |
| `set_aside` | array of string | no | Set-aside slugs or FPDS codes (e.g. ['8a','sdvosb','hubzone'] or ['8AN','SDVOSBS']); applied client-side |
| `naics` | array of string | no | NAICS code prefixes (e.g. ["5415"] matches 541511); applied client-side |
| `psc` | array of string | no | PSC code prefixes; applied client-side |
| `agency` | string | no | Agency slug or name (applied client-side; agency_key is the server-side filter) |
| `agency_key` | number | no | HigherGov agency key (numeric; server-side filter) |
| `posted_after` | string | no | ISO-8601 date; opportunities posted on/after (max 45 days back; walked upstream one day per request) |
| `response_due_before` | string | no | ISO-8601 date; response deadline on/before |
| `response_due_after` | string | no | ISO-8601 date; response deadline on/after (defaults to now — drops already-closed notices; pass an earlier date to include them) |
| `limit` | number | no | Default 50, max 200; HigherGov returns at most 100 rows per request |
| `cursor` | string | no | The next_cursor from the prior response: a page number, or YYYY-MM-DD\|page when posted_after is set |

#### `list_highergov_saved_searches(args)`

List the saved searches on the HigherGov account behind the API key, so search_highergov_forecasts can be called without hunting for a magic ID. If the upstream API does not expose saved searches, returns guidance on where to find the ID in the HigherGov UI. Needs your HigherGov key.

It takes no arguments.

#### `get_opportunity_documents(args)`

List the solicitation documents (RFP, attachments, amendments) for one opportunity, with fetchable URLs, so an agent can read the solicitation without a manual download/upload cycle. Pass the same ID accepted by get_highergov_opportunity. Needs your HigherGov key.

| Parameter | Type | Required | Notes |
| --- | --- | --- | --- |
| `id` | string | yes | HigherGov opportunity ID, SAM notice ID, or HigherGov URL |

## Limits

The server paces its calls to each source, one queue for each source for the whole process:

| Source | Minimum gap between calls |
| --- | --- |
| SAM.gov | 0.1 seconds |
| Tango | 0.1 seconds |
| HigherGov | 0.2 seconds |
| USAspending | 3.6 seconds |

Calls wait their turn in order. Each request to a source times out after 30 seconds. The server does
not retry. A source's own limits and daily allowances apply to your key on top of this. A call that hits one
fails with the error the source sent (the HigherGov tools answer a `429` with `rate_limited` and a
fixed `retry_after_seconds` of 60). Only `get_highergov_opportunity`, `get_highergov_contract` and
`get_highergov_person` cache, for 15 minutes, up to 500 entries, for the key that asked.
