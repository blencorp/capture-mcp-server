import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { ApiClient } from '../utils/api-client.js';
import { tangoNextCursor, parseTangoCursor } from '../utils/pagination.js';
import { listEnvelope, enforceClientBound } from '../utils/envelope.js';
import { describeSetAside, isKnownSetAsideCode, validateSetAsideCodes } from '../utils/fpds-codes.js';

// Semantics caveats surfaced on every response (docs/upstream-api-notes.md):
// Tango documents `count` as "the total number of contracts matching the
// query" (contract-award level); which FPDS date field award_date compares is
// still undocumented, and set_aside matching was observed loose live even
// though the docs don't specify its semantics.
const CONTRACT_COUNT_UNIT =
  'contract awards matching the query (per Tango docs; transaction-level rollup semantics unverified)';
const GRANT_COUNT_UNIT = 'grant awards (Tango /grants/ count; unit unverified)';
const OPPORTUNITY_COUNT_UNIT = 'opportunity notices (Tango /opportunities/ count)';
const AWARD_DATE_FIELD =
  'award_date (Tango award_date_gte/lte; whether this is FPDS action_date or date_signed is undocumented)';
const LOOSE_SET_ASIDE_WARNING =
  "Tango's set_aside filter matches loosely (e.g. '8A' also matches 8AN records; observed live), so the upstream total may include other codes and is reported as total_upstream_unverified.";

// Tango's list endpoint returns only "a subset of commonly-used fields" unless
// `shape` names the fields — set_aside in particular is an expansion that the
// default subset omits (which is why per-row codes were unreadable before).
// Every field here is documented in Tango's data dictionary or was observed in
// live responses; if the shaped request is rejected we retry unshaped.
const CONTRACT_LIST_SHAPE = [
  'key',
  'piid',
  'description',
  'award_date',
  'obligated',
  'total_contract_value',
  'base_and_exercised_options_value',
  'naics_code',
  'psc_code',
  'recipient(display_name,uei)',
  'awarding_office(agency_name,agency_code,office_name)',
  'set_aside(code,description)',
  'award_type(code,description)',
  'place_of_performance(city_name,state_name,country_name)',
].join(',');

function bad(message: string) {
  return { error: { code: 'bad_request', message } };
}

// Tango's awarding_agency binds on FPDS agency codes; agency *names* have been
// observed to hang upstream past our 30s timeout (2026-08-23). Reject names
// with actionable guidance instead of letting the request die silently.
const COMMON_AGENCY_CODES =
  '3600=VA, 2100=Army, 1700=Navy, 5700=Air Force, 9700=DoD other, 4732=GSA/FAS, 7000=DHS, 7500=HHS, 1400=Interior, 1500=DOJ';

function resolveAgencyCode(agency: unknown): { code?: string; error?: string } {
  const text = String(agency ?? '').trim();
  if (!text) return {};
  if (/^\d{2,4}$/.test(text)) return { code: text };
  return {
    error:
      `agency must be an FPDS agency code. Tango's docs describe best-effort name matching, ` +
      `but agency-name queries were observed to hang upstream past our 30s timeout, so codes are required. ` +
      `Common codes: ${COMMON_AGENCY_CODES}. The code for any award appears in results under agency.code.`,
  };
}

// Set-aside input: single code or array, validated against the FPDS table so a
// typo'd or misremembered code fails loudly with the full valid list.
function parseSetAsideArg(value: unknown): string[] {
  if (value === undefined || value === null || value === '') return [];
  const list = Array.isArray(value) ? value : [value];
  return validateSetAsideCodes(list.map(v => String(v)));
}

// Extract a per-row FPDS set-aside code wherever Tango put it. Exact-match
// filtering depends on this being readable; when it is not, the tools warn
// instead of filtering blind.
function rowSetAsideCode(contract: any): string | null {
  const candidates = [
    contract?.set_aside?.code,
    contract?.set_aside_code,
    contract?.type_of_set_aside_code,
    contract?.type_of_set_aside,
    typeof contract?.set_aside === 'string' ? contract.set_aside : null,
  ];
  for (const candidate of candidates) {
    if (typeof candidate !== 'string') continue;
    const code = candidate.trim().toUpperCase();
    if (code && isKnownSetAsideCode(code)) return code;
  }
  return null;
}

function rowSetAside(contract: any): { code: string; description: string | null } | string | null {
  const code = rowSetAsideCode(contract);
  if (code) return describeSetAside(code);
  const raw = contract?.set_aside?.description ?? contract?.type_of_set_aside ?? contract?.set_aside;
  return typeof raw === 'string' && raw.trim() ? raw : null;
}

function upstreamTotal(data: any): number | null {
  const candidates = [data?.total, data?.count];
  for (const c of candidates) {
    const n = Number(c);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

// Resolve the request for a list call: a cursor replays the exact next-page
// URL from the previous response (validated against the Tango origin); fresh
// calls build params. Passing other filters alongside a cursor is an error —
// the cursor already encodes the query.
function resolveListRequest(
  endpoint: string,
  params: Record<string, any>,
  cursor: unknown
): { endpoint: string; params: Record<string, any> } {
  if (cursor === undefined || cursor === null || cursor === '') return { endpoint, params };
  const parsed = parseTangoCursor(String(cursor));
  if (parsed.endpoint !== endpoint) {
    throw new Error(`Invalid cursor: it belongs to ${parsed.endpoint}, not ${endpoint}`);
  }
  return { endpoint: parsed.endpoint, params: parsed.params };
}

export const tangoTools = {
  async getTools(): Promise<Tool[]> {
    return [
      {
        name: "search_tango_contracts",
        description:
          "Search federal contracts through Tango's unified API (FPDS-derived). Set-aside filtering is EXACT on FPDS codes (e.g. 8A = 8(a) Competed vs 8AN = 8(a) Sole Source) and every response echoes which filters ran upstream vs client-side — read `warnings` before trusting counts. Paginate with `cursor` to enumerate result sets past one page.",
        inputSchema: {
          type: "object",
          properties: {
            api_key: {
              type: "string",
              description: "Tango API key (optional if TANGO_API_KEY env var is set)"
            },
            query: {
              type: "string",
              description: "Search query for contract description or title"
            },
            vendor_name: {
              type: "string",
              description: "Vendor/contractor name filter (verified client-side against returned records)"
            },
            vendor_uei: {
              type: "string",
              description: "Vendor Unique Entity Identifier (UEI)"
            },
            agency: {
              type: "string",
              description: `Awarding agency FPDS code (e.g. ${COMMON_AGENCY_CODES}). Agency names are rejected: they hang the upstream.`
            },
            naics_code: {
              type: "string",
              description: "NAICS industry classification code"
            },
            psc_code: {
              type: "string",
              description: "Product/Service Code (PSC)"
            },
            award_amount_min: {
              type: "number",
              description: "Minimum contract award amount (USD). Applied client-side per page — the response says so and nulls the total."
            },
            award_amount_max: {
              type: "number",
              description: "Maximum contract award amount (USD). Applied client-side per page."
            },
            date_from: {
              type: "string",
              description: "Start date for contract awards (YYYY-MM-DD). See date_field in the response for which underlying date this compares."
            },
            date_to: {
              type: "string",
              description: "End date for contract awards (YYYY-MM-DD)"
            },
            set_aside: {
              anyOf: [
                { type: "string" },
                { type: "array", items: { type: "string" } }
              ],
              description: "FPDS set-aside code(s), matched EXACTLY — e.g. [\"8AN\", \"SDVOSBS\", \"HZS\"]. Unknown codes are rejected with the valid list. Use lookup_reference_code to check a code's meaning first."
            },
            limit: {
              type: "number",
              description: "Number of results per page (default: 10, max: 100)"
            },
            cursor: {
              type: "string",
              description: "Opaque next_cursor from a previous response. Replays the same query for the next page; do not combine with other filters."
            }
          },
          required: []
        }
      },
      {
        name: "search_tango_grants",
        description: "Search federal grants and financial assistance awards through Tango's unified API. Recipient and amount filters are verified client-side and echoed as such. Paginate with `cursor`.",
        inputSchema: {
          type: "object",
          properties: {
            api_key: {
              type: "string",
              description: "Tango API key (optional if TANGO_API_KEY env var is set)"
            },
            query: {
              type: "string",
              description: "Search query for grant description or title"
            },
            recipient_name: {
              type: "string",
              description: "Grant recipient organization name (verified client-side)"
            },
            recipient_uei: {
              type: "string",
              description: "Recipient Unique Entity Identifier (UEI) (verified client-side)"
            },
            agency: {
              type: "string",
              description: "Awarding agency name or code"
            },
            cfda_number: {
              type: "string",
              description: "Catalog of Federal Domestic Assistance (CFDA) number"
            },
            award_amount_min: {
              type: "number",
              description: "Minimum grant award amount (USD). Applied client-side per page."
            },
            award_amount_max: {
              type: "number",
              description: "Maximum grant award amount (USD). Applied client-side per page."
            },
            date_from: {
              type: "string",
              description: "Start date for grant awards (YYYY-MM-DD format)"
            },
            date_to: {
              type: "string",
              description: "End date for grant awards (YYYY-MM-DD format)"
            },
            limit: {
              type: "number",
              description: "Number of results per page (default: 10, max: 100)"
            },
            cursor: {
              type: "string",
              description: "Opaque next_cursor from a previous response"
            }
          },
          required: []
        }
      },
      {
        name: "get_tango_vendor_profile",
        description: "Get comprehensive vendor/entity profile from Tango's consolidated database. Provides unified view of entity data from SAM.gov with contract history.",
        inputSchema: {
          type: "object",
          properties: {
            api_key: {
              type: "string",
              description: "Tango API key (optional if TANGO_API_KEY env var is set)"
            },
            uei: {
              type: "string",
              description: "Unique Entity Identifier (UEI) - required"
            },
            include_contracts: {
              type: "boolean",
              description: "Include recent contract history (default: false)"
            },
            include_grants: {
              type: "boolean",
              description: "Include recent grant history (default: false)"
            }
          },
          required: ["uei"]
        }
      },
      {
        name: "search_tango_opportunities",
        description: "Search federal contract opportunities through Tango's unified API. Enhanced opportunity search with forecasts and solicitation notices. Paginate with `cursor`.",
        inputSchema: {
          type: "object",
          properties: {
            api_key: {
              type: "string",
              description: "Tango API key (optional if TANGO_API_KEY env var is set)"
            },
            query: {
              type: "string",
              description: "Search query for opportunity title or description"
            },
            agency: {
              type: "string",
              description: "Agency name or code"
            },
            naics_code: {
              type: "string",
              description: "NAICS industry classification code"
            },
            set_aside: {
              type: "string",
              description: "Set-aside type filter"
            },
            posted_from: {
              type: "string",
              description: "Start date for opportunities (YYYY-MM-DD format)"
            },
            posted_to: {
              type: "string",
              description: "End date for opportunities (YYYY-MM-DD format)"
            },
            response_deadline_from: {
              type: "string",
              description: "Minimum response deadline (YYYY-MM-DD format)"
            },
            status: {
              type: "string",
              description: "Opportunity status (e.g., 'active', 'closed', 'forecasted')"
            },
            limit: {
              type: "number",
              description: "Number of results per page (default: 10, max: 100)"
            },
            cursor: {
              type: "string",
              description: "Opaque next_cursor from a previous response"
            }
          },
          required: []
        }
      },
      {
        name: "search_tango_protests",
        description: "Search GAO bid protest records through Tango. Filter by agency, protester, outcome (Sustained/Denied/Dismissed/Withdrawn), case type, and date ranges. Useful for pre-bid risk scoring and identifying repeat protesters.",
        inputSchema: {
          type: "object",
          properties: {
            api_key: { type: "string", description: "Tango API key (optional if TANGO_API_KEY env var is set)" },
            query: { type: "string", description: "Full-text search across title, protester, agency, solicitation, and case number" },
            agency: { type: "string", description: "Agency identifier (name, abbreviation, CGAC/FPDS code). Use '|' for multi-value OR." },
            protester: { type: "string", description: "Protester / petitioner name (vector search)" },
            outcome: { type: "string", description: "Protest outcome: 'Sustained', 'Denied', 'Dismissed', or 'Withdrawn'" },
            source_system: { type: "string", description: "Source system filter (e.g., 'gao', 'cofc')" },
            case_type: { type: "string", description: "Case type substring (e.g., 'Bid Protest', 'Cost Claim')" },
            case_number: { type: "string", description: "Exact base case number (e.g., 'b-423274')" },
            solicitation_number: { type: "string", description: "Exact solicitation number" },
            filed_date_from: { type: "string", description: "Filed on or after (YYYY-MM-DD)" },
            filed_date_to: { type: "string", description: "Filed on or before (YYYY-MM-DD)" },
            decision_date_from: { type: "string", description: "Decision on or after (YYYY-MM-DD)" },
            decision_date_to: { type: "string", description: "Decision on or before (YYYY-MM-DD)" },
            limit: { type: "number", description: "Number of results to return (default: 10, max: 100)" }
          },
          required: []
        }
      },
      {
        name: "get_tango_protest",
        description: "Get the full record for a single bid protest by case number (e.g., 'b-422670'). Returns the same fields as search_tango_protests plus docket URLs and decision URLs.",
        inputSchema: {
          type: "object",
          properties: {
            api_key: { type: "string", description: "Tango API key (optional if TANGO_API_KEY env var is set)" },
            case_number: { type: "string", description: "Protest case number (the `case_number` field returned by search_tango_protests, e.g., 'b-422670')" }
          },
          required: ["case_number"]
        }
      },
      {
        name: "search_tango_idvs",
        description: "Search federal Indefinite Delivery Vehicles (IDIQs, BPAs, FSS) through Tango. Returns vehicle-level contracts that issue task/delivery orders. Same filter shape as search_tango_contracts, plus idv_type and last_date_to_order (expiry).",
        inputSchema: {
          type: "object",
          properties: {
            api_key: { type: "string", description: "Tango API key (optional if TANGO_API_KEY env var is set)" },
            query: { type: "string", description: "Search query (description, title, PIID)" },
            vendor_name: { type: "string", description: "Vendor / contractor name (recipient)" },
            vendor_uei: { type: "string", description: "Vendor UEI" },
            piid: { type: "string", description: "Exact PIID" },
            agency: { type: "string", description: "Awarding agency name or code" },
            funding_agency: { type: "string", description: "Funding agency name or code" },
            naics_code: { type: "string", description: "NAICS code" },
            psc_code: { type: "string", description: "Product/Service Code (PSC)" },
            set_aside: { type: "string", description: "Set-aside code(s); use '|' for OR" },
            idv_type: { type: "string", description: "IDV type code: 'A'=GWAC, 'B'=IDC, 'C'=FSS, 'D'=BOA, 'E'=BPA. Accepts the descriptive name too (e.g., 'GWAC')." },
            award_date_from: { type: "string", description: "Award date on or after (YYYY-MM-DD)" },
            award_date_to: { type: "string", description: "Award date on or before (YYYY-MM-DD)" },
            expiring_from: { type: "string", description: "Last date to order on or after (YYYY-MM-DD) — find IDVs still accepting orders" },
            expiring_to: { type: "string", description: "Last date to order on or before (YYYY-MM-DD) — find IDVs about to close to orders" },
            limit: { type: "number", description: "Number of results to return (default: 10, max: 100)" }
          },
          required: []
        }
      },
      {
        name: "get_tango_idv_children",
        description: "Get the awards issued under a single IDV (its child IDVs, task/delivery orders, and transactions). Use this after search_tango_idvs to drill into a specific vehicle's ordering activity.",
        inputSchema: {
          type: "object",
          properties: {
            api_key: { type: "string", description: "Tango API key (optional if TANGO_API_KEY env var is set)" },
            idv_key: { type: "string", description: "Tango IDV key (from the `key` field of a search_tango_idvs result) — required" },
            include_child_idvs: { type: "boolean", description: "Include child IDVs (sub-IDIQs under this parent). Default: true" },
            include_task_orders: { type: "boolean", description: "Include task/delivery order awards issued against this IDV. Default: true" },
            include_transactions: { type: "boolean", description: "Include obligation transactions (lower-level, may be large). Default: false" },
            limit_per_section: { type: "number", description: "Max rows per section (default: 20, max: 100)" }
          },
          required: ["idv_key"]
        }
      },
      {
        name: "search_tango_vehicles",
        description: "Search the federal contract-vehicle catalog (BPAs, GWACs, GSA MAS Schedules, agency-wide IDIQs) through Tango. Vehicles aggregate the holders, scope, and obligations of a procurement instrument. Distinct from /idvs/ which lists raw IDV awards.",
        inputSchema: {
          type: "object",
          properties: {
            api_key: { type: "string", description: "Tango API key (optional if TANGO_API_KEY env var is set)" },
            query: { type: "string", description: "Search query (vehicle name, program acronym, description)" },
            vehicle_type: { type: "string", description: "Vehicle (IDV) type code; use '|' for OR (e.g., 'GWAC|BPA')" },
            type_of_idc: { type: "string", description: "Type of IDC code; use '|' for OR" },
            contract_type: { type: "string", description: "Contract type code; use '|' for OR" },
            set_aside: { type: "string", description: "Set-aside code(s); use '|' for OR" },
            naics_code: { type: "string", description: "NAICS code (exact)" },
            psc_code: { type: "string", description: "PSC / Product Service Code" },
            program_acronym: { type: "string", description: "Program acronym (e.g., 'SEWP', 'OASIS', 'CIO-SP3')" },
            who_can_use: { type: "string", description: "Who-can-use code (e.g., 'gov-wide', agency-restricted)" },
            agency: { type: "string", description: "Awarding agency / department / sub-agency" },
            organization_id: { type: "string", description: "Awarding organization UUID (exact)" },
            total_obligated_min: { type: "number", description: "Minimum total obligated across the vehicle (USD)" },
            total_obligated_max: { type: "number", description: "Maximum total obligated across the vehicle (USD)" },
            limit: { type: "number", description: "Number of results to return (default: 10, max: 100)" }
          },
          required: []
        }
      },
      {
        name: "search_tango_otas",
        description: "Search federal Other Transaction Authority (OTA) awards through Tango. OTAs are flexible R&D / prototype agreements outside the FAR. Note: OTAs have no NAICS or set-aside fields by design.",
        inputSchema: {
          type: "object",
          properties: {
            api_key: { type: "string", description: "Tango API key (optional if TANGO_API_KEY env var is set)" },
            query: { type: "string", description: "Search query (description, title, PIID)" },
            vendor_name: { type: "string", description: "Vendor / recipient name" },
            vendor_uei: { type: "string", description: "Vendor UEI" },
            piid: { type: "string", description: "Exact PIID" },
            agency: { type: "string", description: "Awarding agency name or code" },
            funding_agency: { type: "string", description: "Funding agency name or code" },
            award_date_from: { type: "string", description: "Award date on or after (YYYY-MM-DD)" },
            award_date_to: { type: "string", description: "Award date on or before (YYYY-MM-DD)" },
            fiscal_year: { type: "number", description: "Fiscal year of award" },
            limit: { type: "number", description: "Number of results to return (default: 10, max: 100)" }
          },
          required: []
        }
      },
      {
        name: "get_tango_entity_metrics",
        description: "Get a time-series of obligations for a single entity (by UEI), bucketed by month/quarter/year over a lookback window. Use this after get_tango_vendor_profile to see spending trends, not just totals.",
        inputSchema: {
          type: "object",
          properties: {
            api_key: { type: "string", description: "Tango API key (optional if TANGO_API_KEY env var is set)" },
            uei: { type: "string", description: "Unique Entity Identifier (UEI) — required" },
            months: { type: "number", description: "Lookback window in months (e.g., 12, 36, 60). Default: 36" },
            period_grouping: { type: "string", description: "Bucket size: 'month', 'quarter', or 'year'. Default: 'quarter'" },
            group_by: { type: "string", description: "Optional secondary slice: 'agency' or 'department'" }
          },
          required: ["uei"]
        }
      },
      {
        name: "get_tango_spending_summary",
        description: "Get spending summaries and analytics from Tango's unified platform, aggregated over the fetched page of contracts. WARNING: aggregates at most one page (100 records) — the response says when the underlying result set is larger. For reliable full-population aggregation use aggregate_contracts (USASpending).",
        inputSchema: {
          type: "object",
          properties: {
            api_key: {
              type: "string",
              description: "Tango API key (optional if TANGO_API_KEY env var is set)"
            },
            agency: {
              type: "string",
              description: `Awarding agency FPDS code (e.g. ${COMMON_AGENCY_CODES})`
            },
            vendor_uei: {
              type: "string",
              description: "Vendor UEI for spending summary"
            },
            fiscal_year: {
              type: "number",
              description: "Fiscal year for summary (e.g., 2024)"
            },
            group_by: {
              type: "string",
              description: "Group spending by dimension: 'agency', 'vendor', 'naics', 'psc', 'month'"
            },
            award_type: {
              type: "string",
              description: "Filter by award type: 'contracts', 'grants', 'all' (default: 'all')"
            }
          },
          required: []
        }
      }
    ];
  },

  async callTool(name: string, args: any): Promise<any> {
    const sanitizedArgs = ApiClient.sanitizeInput(args);

    switch(name) {
      case "search_tango_contracts":
        return await this.searchContracts(sanitizedArgs);
      case "search_tango_grants":
        return await this.searchGrants(sanitizedArgs);
      case "get_tango_vendor_profile":
        return await this.getVendorProfile(sanitizedArgs);
      case "search_tango_opportunities":
        return await this.searchOpportunities(sanitizedArgs);
      case "get_tango_spending_summary":
        return await this.getSpendingSummary(sanitizedArgs);
      case "search_tango_protests":
        return await this.searchProtests(sanitizedArgs);
      case "get_tango_protest":
        return await this.getProtest(sanitizedArgs);
      case "search_tango_idvs":
        return await this.searchIdvs(sanitizedArgs);
      case "get_tango_idv_children":
        return await this.getIdvChildren(sanitizedArgs);
      case "search_tango_vehicles":
        return await this.searchVehicles(sanitizedArgs);
      case "search_tango_otas":
        return await this.searchOtas(sanitizedArgs);
      case "get_tango_entity_metrics":
        return await this.getEntityMetrics(sanitizedArgs);
      default:
        throw new Error(`Unknown Tango tool: ${name}`);
    }
  },

  requireKey(api_key: any): string {
    const key = api_key || process.env.TANGO_API_KEY;
    if (!key) {
      throw new Error("Tango API key is required. Please provide it as a parameter or set TANGO_API_KEY environment variable");
    }
    return key;
  },

  async searchContracts(args: any): Promise<any> {
    const {
      api_key,
      query,
      vendor_name,
      vendor_uei,
      agency,
      naics_code,
      psc_code,
      award_amount_min,
      award_amount_max,
      date_from,
      date_to,
      set_aside,
      limit = 10,
      cursor
    } = args;

    const tangoApiKey = api_key || process.env.TANGO_API_KEY;

    if (!tangoApiKey) {
      throw new Error("Tango API key is required. Please provide it as a parameter or set TANGO_API_KEY environment variable");
    }

    let setAsideCodes: string[];
    try {
      setAsideCodes = parseSetAsideArg(set_aside);
    } catch (err) {
      return bad(err instanceof Error ? err.message : String(err));
    }

    const agencyResolved = resolveAgencyCode(agency);
    if (agencyResolved.error) return bad(agencyResolved.error);

    const params: Record<string, any> = {
      limit: Math.min(Number(limit) || 10, 100)
    };

    if (query) params.search = query;
    if (vendor_name) params.recipient = vendor_name;
    if (vendor_uei) params.uei = vendor_uei;
    if (agencyResolved.code) params.awarding_agency = agencyResolved.code;
    if (naics_code) params.naics = naics_code;
    if (psc_code) params.psc = psc_code;
    if (date_from) params.award_date_gte = date_from;
    if (date_to) params.award_date_lte = date_to;
    // Documented server-side amount bounds (obligated dollars).
    if (award_amount_min !== undefined) params.obligated_gte = award_amount_min;
    if (award_amount_max !== undefined) params.obligated_lte = award_amount_max;
    // Documented OR syntax for filter values (a|b). Upstream narrowing still
    // matches loosely (observed live), so exact enforcement below stays.
    if (setAsideCodes.length > 0) params.set_aside = setAsideCodes.join('|');
    params.shape = CONTRACT_LIST_SHAPE;

    let request;
    try {
      request = resolveListRequest('/contracts/', params, cursor);
    } catch (err) {
      return bad(err instanceof Error ? err.message : String(err));
    }

    let response = await ApiClient.tangoGet(request.endpoint, request.params, tangoApiKey);
    let shapeFallback = false;
    if (!response.success && request.params.shape && /API Error 400/.test(response.error ?? '')) {
      // A field name in the shape the upstream doesn't recognize — degrade to
      // the default subset rather than failing the whole search.
      const { shape: _unused, ...unshaped } = request.params;
      response = await ApiClient.tangoGet(request.endpoint, unshaped, tangoApiKey);
      shapeFallback = true;
    }

    if (!response.success) {
      return { error: response.error };
    }

    const rawContracts: any[] = response.data.results || response.data.contracts || [];
    const warnings: string[] = [];
    const clientSide: Record<string, unknown> = {};
    if (shapeFallback) {
      warnings.push(
        'Upstream rejected the field-shape request; the default field subset was returned instead, so some fields (notably per-row set_aside) may be missing.'
      );
    }

    // Map to essential fields first so all client-side verification runs
    // against the same normalized rows the caller sees.
    let contracts = rawContracts.map((contract: any) => ({
      contract_id: contract.key || contract.piid || contract.contract_id,
      title: contract.description || contract.title,
      vendor: {
        name: contract.recipient?.display_name || contract.recipient_name || contract.vendor_name,
        uei: contract.recipient?.uei || contract.vendor_uei,
        duns: contract.vendor_duns
      },
      agency: {
        name: contract.awarding_office?.agency_name || contract.agency_name,
        code: contract.awarding_office?.agency_code || contract.agency_code,
        office: contract.awarding_office?.office_name || contract.office_name
      },
      award_amount: contract.obligated ?? contract.total_contract_value ?? contract.base_and_exercised_options_value ?? contract.award_amount ?? null,
      obligated: contract.obligated ?? null,
      award_date: contract.award_date || contract.date_signed,
      naics_code: contract.naics_code,
      naics_description: contract.naics_description,
      psc_code: contract.psc_code,
      psc_description: contract.psc_description,
      set_aside: rowSetAside(contract),
      set_aside_exact_code: rowSetAsideCode(contract),
      place_of_performance: {
        city: contract.place_of_performance?.city_name || contract.pop_city,
        state: contract.place_of_performance?.state_name || contract.pop_state_code,
        country: contract.place_of_performance?.country_name || contract.pop_country_code
      },
      status: contract.contract_status || contract.status
    }));

    // P0-1: exact set-aside matching. Upstream matching is loose, so exact
    // enforcement happens here against each row's FPDS code — and when rows
    // don't carry a readable code, we say the filter could NOT be applied
    // rather than silently returning the loose superset as exact.
    let looseOnly = false;
    if (setAsideCodes.length > 0) {
      const readable = contracts.filter(c => c.set_aside_exact_code !== null).length;
      if (readable === 0 && contracts.length > 0) {
        looseOnly = true;
        warnings.push(
          'Records on this page carry no readable FPDS set-aside code, so EXACT set-aside matching could not be applied — these are the upstream LOOSE matches. ' +
          'Verify individual awards with get_award_detail before using counts. ' +
          'If this persists, run "npm run capture-fixtures" — the field mapping may be out of date.'
        );
      } else {
        clientSide.set_aside_exact = setAsideCodes;
        contracts = contracts.filter(c => c.set_aside_exact_code && setAsideCodes.includes(c.set_aside_exact_code));
      }
    }

    // P0-2: amount bounds run upstream via the documented obligated_gte/lte
    // params; this pass verifies the upstream actually honored them (a
    // violation gets filtered and flagged, never returned silently).
    contracts = enforceClientBound(contracts, 'award_amount_min', award_amount_min, c => c.obligated ?? c.award_amount, (v, b) => Number(v) >= Number(b), clientSide, warnings);
    contracts = enforceClientBound(contracts, 'award_amount_max', award_amount_max, c => c.obligated ?? c.award_amount, (v, b) => Number(v) <= Number(b), clientSide, warnings);
    if (vendor_name) {
      const needle = String(vendor_name).toLowerCase();
      contracts = enforceClientBound(contracts, 'vendor_name', vendor_name, c => c.vendor.name ?? null, v => String(v).toLowerCase().includes(needle), clientSide, warnings);
    }

    return listEnvelope({
      resourceKey: 'contracts',
      rows: contracts,
      upstreamTotal: upstreamTotal(response.data),
      countUnit: CONTRACT_COUNT_UNIT,
      dateField: date_from || date_to ? AWARD_DATE_FIELD : undefined,
      filters: { upstream: request.params, client_side: clientSide },
      warnings,
      nextCursor: tangoNextCursor(response.data),
      // A set-aside-filtered upstream total is a loose-match count (P0-1) and,
      // per P0-4, unscoped set-aside totals have not reconciled with
      // agency-scoped sums — never present one as trustworthy when the exact
      // filter could not be applied to the rows.
      distrustUpstreamTotal: looseOnly ? LOOSE_SET_ASIDE_WARNING : undefined,
    });
  },

  async searchGrants(args: any): Promise<any> {
    const {
      api_key,
      query,
      recipient_name,
      recipient_uei,
      agency,
      cfda_number,
      award_amount_min,
      award_amount_max,
      date_from,
      date_to,
      limit = 10,
      cursor
    } = args;

    const tangoApiKey = api_key || process.env.TANGO_API_KEY;

    if (!tangoApiKey) {
      throw new Error("Tango API key is required. Please provide it as a parameter or set TANGO_API_KEY environment variable");
    }

    const params: Record<string, any> = {
      limit: Math.min(Number(limit) || 10, 100)
    };

    if (query) params.search = query;
    if (agency) params.agency = agency;
    if (cfda_number) params.cfda_number = cfda_number;
    if (date_from) params.posted_date_after = date_from;
    if (date_to) params.posted_date_before = date_to;

    let request;
    try {
      request = resolveListRequest('/grants/', params, cursor);
    } catch (err) {
      return bad(err instanceof Error ? err.message : String(err));
    }

    const response = await ApiClient.tangoGet(request.endpoint, request.params, tangoApiKey);

    if (!response.success) {
      return { error: response.error };
    }

    const rawGrants: any[] = response.data.results || [];
    const warnings: string[] = [];
    const clientSide: Record<string, unknown> = {};

    // Filter response to essential grant fields
    let grants = rawGrants.map((grant: any) => ({
      grant_id: grant.fain || grant.grant_id,
      title: grant.description || grant.title || grant.project_title,
      recipient: {
        name: grant.recipient?.name || grant.recipient_name,
        uei: grant.recipient?.uei || grant.recipient_uei,
        duns: grant.recipient?.duns || grant.recipient_duns,
        type: grant.recipient?.type || grant.recipient_type
      },
      agency: {
        name: grant.agency_name,
        code: grant.agency_code,
        office: grant.office_name
      },
      award_amount: grant.award_amount ?? grant.total_funding_amount ?? null,
      award_date: grant.award_date || grant.date_signed,
      cfda: {
        number: grant.cfda_number,
        title: grant.cfda_title
      },
      place_of_performance: {
        city: grant.pop_city,
        state: grant.pop_state_code,
        country: grant.pop_country_code
      },
      status: grant.grant_status || grant.status,
      period_of_performance: {
        start: grant.period_start_date,
        end: grant.period_end_date
      }
    }));

    if (recipient_name) {
      const needle = String(recipient_name).toLowerCase();
      grants = enforceClientBound(grants, 'recipient_name', recipient_name, g => g.recipient.name ?? null, v => String(v).toLowerCase().includes(needle), clientSide, warnings);
    }
    if (recipient_uei) {
      grants = enforceClientBound(grants, 'recipient_uei', recipient_uei, g => g.recipient.uei ?? null, (v, b) => String(v) === String(b), clientSide, warnings);
    }
    grants = enforceClientBound(grants, 'award_amount_min', award_amount_min, g => g.award_amount, (v, b) => Number(v) >= Number(b), clientSide, warnings);
    grants = enforceClientBound(grants, 'award_amount_max', award_amount_max, g => g.award_amount, (v, b) => Number(v) <= Number(b), clientSide, warnings);

    return listEnvelope({
      resourceKey: 'grants',
      rows: grants,
      upstreamTotal: upstreamTotal(response.data),
      countUnit: GRANT_COUNT_UNIT,
      dateField: date_from || date_to ? 'posted_date (Tango posted_date_after/before)' : undefined,
      filters: { upstream: request.params, client_side: clientSide },
      warnings,
      nextCursor: tangoNextCursor(response.data),
    });
  },

  async getVendorProfile(args: any): Promise<any> {
    const { api_key, uei, include_contracts = false, include_grants = false } = args;

    const tangoApiKey = api_key || process.env.TANGO_API_KEY;

    if (!tangoApiKey) {
      throw new Error("Tango API key is required. Please provide it as a parameter or set TANGO_API_KEY environment variable");
    }

    if (!uei) {
      throw new Error("UEI is required");
    }

    const response = await ApiClient.tangoGet(`/entities/${uei}/`, {}, tangoApiKey);

    if (!response.success) {
      return { error: response.error };
    }

    const vendor = response.data;
    let recentContracts: any[] | undefined;
    let recentGrants: any[] | undefined;

    if (include_contracts) {
      const contractsResponse = await ApiClient.tangoGet(
        `/entities/${uei}/contracts/`,
        { limit: 5, ordering: '-award_date' },
        tangoApiKey
      );

      if (contractsResponse.success) {
        recentContracts = (contractsResponse.data.results || []).map((contract: any) => ({
          contract_id: contract.key || contract.piid,
          title: contract.description || contract.title,
          award_date: contract.award_date,
          obligated: contract.obligated ?? contract.total_contract_value ?? contract.base_and_exercised_options_value ?? 0,
          agency: contract.awarding_office?.agency_name || contract.agency_name
        }));
      }
    }

    if (include_grants) {
      const subawardsResponse = await ApiClient.tangoGet(
        `/entities/${uei}/subawards/`,
        { limit: 5, ordering: '-fiscal_year' },
        tangoApiKey
      );

      if (subawardsResponse.success) {
        recentGrants = (subawardsResponse.data.results || []).map((subaward: any) => ({
          subaward_id: subaward.fsrs_subaward_id || subaward.key,
          description: subaward.description,
          amount: subaward.amount || subaward.total_funding_amount,
          fiscal_year: subaward.fiscal_year,
          prime_recipient: subaward.prime_recipient?.display_name || subaward.prime_recipient?.name,
          awarding_agency: subaward.awarding_agency?.name
        }));
      }
    }

    // Return comprehensive vendor profile
    return {
      uei: vendor.uei,
      legal_business_name: vendor.legal_business_name || vendor.name,
      duns: vendor.duns,
      cage_code: vendor.cage_code,
      registration: {
        status: vendor.registration_status,
        activation_date: vendor.activation_date,
        expiration_date: vendor.expiration_date
      },
      business_types: vendor.business_types || vendor.business_type_list,
      address: {
        physical: vendor.physical_address,
        mailing: vendor.mailing_address
      },
      contacts: vendor.points_of_contact || vendor.contacts,
      naics_codes: vendor.naics_codes,
      psc_codes: vendor.psc_codes,
      certifications: vendor.certifications,
      performance_summary: {
        total_contracts: vendor.total_contracts || 0,
        total_contract_value: vendor.total_contract_value || 0,
        total_grants: vendor.total_grants || 0,
        total_grant_value: vendor.total_grant_value || 0
      },
      recent_contracts: recentContracts,
      recent_grants: recentGrants
    };
  },

  async searchOpportunities(args: any): Promise<any> {
    const {
      api_key,
      query,
      agency,
      naics_code,
      set_aside,
      posted_from,
      posted_to,
      response_deadline_from,
      status,
      limit = 10,
      cursor
    } = args;

    const tangoApiKey = api_key || process.env.TANGO_API_KEY;

    if (!tangoApiKey) {
      throw new Error("Tango API key is required. Please provide it as a parameter or set TANGO_API_KEY environment variable");
    }

    const params: Record<string, any> = {
      limit: Math.min(Number(limit) || 10, 100)
    };

    if (query) params.search = query;
    if (agency) params.agency = agency;
    if (naics_code) params.naics = naics_code;
    if (set_aside) params.set_aside = set_aside;
    if (posted_from) {
      params.posted_date_after = posted_from;
      params.first_notice_date_after = posted_from;
    }
    if (posted_to) {
      params.posted_date_before = posted_to;
      params.first_notice_date_before = posted_to;
    }
    if (response_deadline_from) params.response_deadline_after = response_deadline_from;
    if (status) {
      const normalizedStatus = String(status).toLowerCase();
      if (normalizedStatus === 'active') {
        params.active = true;
      } else if (['inactive', 'closed'].includes(normalizedStatus)) {
        params.active = false;
      } else if (normalizedStatus === 'forecasted') {
        params.notice_type = 'f';
      }
    }

    let request;
    try {
      request = resolveListRequest('/opportunities/', params, cursor);
    } catch (err) {
      return bad(err instanceof Error ? err.message : String(err));
    }

    const response = await ApiClient.tangoGet(request.endpoint, request.params, tangoApiKey);

    if (!response.success) {
      return { error: response.error };
    }

    // Filter to essential opportunity fields
    const opportunities = (response.data.results || []).map((opp: any) => ({
      opportunity_id: opp.opportunity_id || opp.notice_id,
      solicitation_number: opp.solicitation_number,
      title: opp.title,
      type: opp.meta?.notice_type?.type || opp.opportunity_type || opp.type,
      status: typeof opp.active === 'boolean' ? (opp.active ? 'active' : 'inactive') : opp.status,
      agency: {
        name: opp.office?.agency_name || opp.agency_name,
        code: opp.office?.agency_code || opp.agency_code,
        office: opp.office?.office_name || opp.office_name
      },
      posted_date: opp.posted_date || opp.first_notice_date || opp.date_posted,
      response_deadline: opp.response_deadline || opp.due_date,
      naics_code: opp.naics_code,
      set_aside: opp.set_aside?.code || opp.set_aside_type || opp.set_aside,
      place_of_performance: {
        city: opp.place_of_performance?.city || opp.pop_city,
        state: opp.place_of_performance?.state || opp.pop_state,
        zip: opp.place_of_performance?.zip || opp.pop_zip,
        country: opp.place_of_performance?.country || opp.pop_country
      },
      description: (opp.summary || opp.description || '').substring(0, 500),
      link: opp.sam_url || opp.url || opp.link
    }));

    return listEnvelope({
      resourceKey: 'opportunities',
      rows: opportunities,
      upstreamTotal: upstreamTotal(response.data),
      countUnit: OPPORTUNITY_COUNT_UNIT,
      dateField: posted_from || posted_to ? 'posted_date / first_notice_date' : undefined,
      filters: { upstream: request.params, client_side: {} },
      warnings: [],
      nextCursor: tangoNextCursor(response.data),
    });
  },

  async getSpendingSummary(args: any): Promise<any> {
    const {
      api_key,
      agency,
      vendor_uei,
      fiscal_year,
      group_by = 'agency',
      award_type = 'all'
    } = args;

    const tangoApiKey = api_key || process.env.TANGO_API_KEY;

    if (!tangoApiKey) {
      throw new Error("Tango API key is required. Please provide it as a parameter or set TANGO_API_KEY environment variable");
    }

    const agencyResolved = resolveAgencyCode(agency);
    if (agencyResolved.error) return bad(agencyResolved.error);

    const params: Record<string, any> = {
      limit: 100
    };

    if (agencyResolved.code) params.awarding_agency = agencyResolved.code;
    if (vendor_uei) params.uei = vendor_uei;
    if (fiscal_year) params.fiscal_year = fiscal_year;
    if (award_type && award_type !== 'all') params.award_type = award_type;

    const response = await ApiClient.tangoGet('/contracts/', params, tangoApiKey);

    if (!response.success) {
      return { error: response.error };
    }

    const contracts: any[] = response.data.results || [];

    const normalized = contracts.map((contract: any) => {
      const obligated = Number(contract.obligated ?? contract.total_contract_value ?? contract.base_and_exercised_options_value ?? 0);
      const awardDate = contract.award_date || contract.date_signed;
      const awardingAgencyName = contract.awarding_office?.agency_name || contract.agency_name;
      const awardingAgencyCode = contract.awarding_office?.agency_code || contract.agency_code;
      const recipientName = contract.recipient?.display_name || contract.vendor_name;
      const recipientUei = contract.recipient?.uei || contract.vendor_uei;
      const naics = contract.naics_code || contract.naics;
      const psc = contract.psc_code || contract.psc;

      return {
        key: contract.key || contract.piid || contract.contract_id,
        obligated: Number.isFinite(obligated) ? obligated : 0,
        awardDate,
        awardingAgencyName,
        awardingAgencyCode,
        recipientName,
        recipientUei,
        naics,
        psc
      };
    });

    const totalObligated = normalized.reduce((sum, contract) => sum + (contract.obligated || 0), 0);

    const groups = new Map<string, { key: string; label: string; totalObligated: number; contractCount: number }>();

    const upsertGroup = (key: string, label: string, amount: number) => {
      if (!groups.has(key)) {
        groups.set(key, { key, label, totalObligated: 0, contractCount: 0 });
      }
      const group = groups.get(key)!;
      group.totalObligated += amount;
      group.contractCount += 1;
    };

    const safeLabel = (value: string | undefined, fallback: string) => value?.trim() || fallback;

    const formatMonth = (input?: string) => {
      if (!input) return 'Unknown';
      const dt = new Date(input);
      if (Number.isNaN(dt.getTime())) return 'Unknown';
      return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}`;
    };

    switch (group_by) {
      case 'agency':
        normalized.forEach(contract => {
          const code = safeLabel(contract.awardingAgencyCode, 'UNK');
          const name = safeLabel(contract.awardingAgencyName, 'Unknown agency');
          const key = `${code}`;
          const label = code && code !== 'UNK' ? `${name} (${code})` : name;
          upsertGroup(key, label, contract.obligated);
        });
        break;
      case 'vendor':
        normalized.forEach(contract => {
          const ueiValue = safeLabel(contract.recipientUei, 'UNKNOWN');
          const name = safeLabel(contract.recipientName, 'Unknown recipient');
          const key = ueiValue || name;
          const label = ueiValue && ueiValue !== 'UNKNOWN' ? `${name} (${ueiValue})` : name;
          upsertGroup(key, label, contract.obligated);
        });
        break;
      case 'naics':
        normalized.forEach(contract => {
          const code = safeLabel(contract.naics, 'Unspecified NAICS');
          upsertGroup(code, code, contract.obligated);
        });
        break;
      case 'psc':
        normalized.forEach(contract => {
          const code = safeLabel(contract.psc, 'Unspecified PSC');
          upsertGroup(code, code, contract.obligated);
        });
        break;
      case 'month':
        normalized.forEach(contract => {
          const monthKey = formatMonth(contract.awardDate);
          upsertGroup(monthKey, monthKey, contract.obligated);
        });
        break;
      default:
        upsertGroup('overall', 'Overall total', totalObligated);
        break;
    }

    const breakdown = Array.from(groups.values())
      .sort((a, b) => b.totalObligated - a.totalObligated)
      .map((entry, index) => ({
        rank: index + 1,
        key: entry.key,
        label: entry.label,
        total_obligated: Number(entry.totalObligated.toFixed(2)),
        contract_count: entry.contractCount
      }));

    const totalAvailable = response.data.count ?? null;
    const warnings: string[] = [];
    if (typeof totalAvailable === 'number' && totalAvailable > normalized.length) {
      warnings.push(
        `PARTIAL AGGREGATION: only the first ${normalized.length} of ${totalAvailable} matching contracts were aggregated. ` +
        'Do not treat these totals as population figures — use aggregate_contracts (USASpending) for full-population aggregation.'
      );
    }

    return {
      total_contracts: normalized.length,
      total_obligated: Number(totalObligated.toFixed(2)),
      count_unit: 'contracts on the fetched page only (max 100)',
      breakdown,
      group_by,
      award_type,
      fiscal_year,
      filters: {
        upstream: params,
        client_side: {}
      },
      ...(warnings.length ? { warnings } : {}),
      page_info: {
        limit: params.limit,
        total_available: totalAvailable,
        next_cursor: tangoNextCursor(response.data)
      }
    };
  },

  async searchProtests(args: any): Promise<any> {
    const {
      api_key, query, agency, protester, outcome, source_system, case_type,
      case_number, solicitation_number, filed_date_from, filed_date_to,
      decision_date_from, decision_date_to, limit = 10
    } = args;

    const tangoApiKey = this.requireKey(api_key);

    const params: Record<string, any> = { limit: Math.min(limit, 100) };
    if (query) params.search = query;
    if (agency) params.agency = agency;
    if (protester) params.protester = protester;
    if (outcome) params.outcome = outcome;
    if (source_system) params.source_system = source_system;
    if (case_type) params.case_type = case_type;
    if (case_number) params.case_number = case_number;
    if (solicitation_number) params.solicitation_number = solicitation_number;
    if (filed_date_from) params.filed_date_after = filed_date_from;
    if (filed_date_to) params.filed_date_before = filed_date_to;
    if (decision_date_from) params.decision_date_after = decision_date_from;
    if (decision_date_to) params.decision_date_before = decision_date_to;

    const response = await ApiClient.tangoGet('/protests/', params, tangoApiKey);
    if (!response.success) return { error: response.error };

    const protests = (response.data.results || []).map((p: any) => ({
      case_number: p.case_number || p.base_case_number,
      title: p.title || p.case_title,
      protester: p.protester,
      agency: p.agency,
      outcome: p.outcome,
      source_system: p.source_system,
      case_type: p.case_type,
      solicitation_number: p.solicitation_number,
      filed_date: p.filed_date,
      decision_date: p.decision_date,
      url: p.url || p.source_url
    }));

    return {
      total: response.data.total || response.data.count || 0,
      protests,
      filters: params,
      limit
    };
  },

  async getProtest(args: any): Promise<any> {
    const { api_key, case_number } = args;
    const tangoApiKey = this.requireKey(api_key);
    if (!case_number) throw new Error("case_number is required");

    // Tango's /protests/{uuid}/ detail endpoint requires a UUID that the list
    // serializer doesn't expose. Filter the list endpoint by case_number and
    // return the single match instead.
    const response = await ApiClient.tangoGet('/protests/', { case_number, limit: 1 }, tangoApiKey);
    if (!response.success) return { error: response.error };
    const results = response.data.results || [];
    if (results.length === 0) {
      return { error: `No protest found with case_number '${case_number}'` };
    }
    return results[0];
  },

  async searchIdvs(args: any): Promise<any> {
    const {
      api_key, query, vendor_name, vendor_uei, piid, agency, funding_agency,
      naics_code, psc_code, set_aside, idv_type,
      award_date_from, award_date_to, expiring_from, expiring_to, limit = 10
    } = args;

    const tangoApiKey = this.requireKey(api_key);

    const params: Record<string, any> = { limit: Math.min(limit, 100) };
    if (query) params.search = query;
    if (vendor_name) params.recipient = vendor_name;
    if (vendor_uei) params.uei = vendor_uei;
    if (piid) params.piid = piid;
    if (agency) params.awarding_agency = agency;
    if (funding_agency) params.funding_agency = funding_agency;
    if (naics_code) params.naics = naics_code;
    if (psc_code) params.psc = psc_code;
    if (set_aside) params.set_aside = set_aside;
    if (idv_type) {
      const IDV_TYPE_BY_NAME: Record<string, string> = {
        GWAC: 'A', IDC: 'B', FSS: 'C', BOA: 'D', BPA: 'E'
      };
      const upper = String(idv_type).toUpperCase();
      params.idv_type = IDV_TYPE_BY_NAME[upper] || upper;
    }
    if (award_date_from) params.award_date_gte = award_date_from;
    if (award_date_to) params.award_date_lte = award_date_to;
    if (expiring_from) params.last_date_to_order_gte = expiring_from;
    if (expiring_to) params.last_date_to_order_lte = expiring_to;

    const response = await ApiClient.tangoGet('/idvs/', params, tangoApiKey);
    if (!response.success) return { error: response.error };

    const idvs = (response.data.results || []).map((idv: any) => ({
      idv_key: idv.key || idv.piid,
      piid: idv.piid,
      title: idv.description || idv.title,
      vendor: {
        name: idv.recipient?.display_name || idv.vendor_name,
        uei: idv.recipient?.uei || idv.vendor_uei
      },
      agency: {
        name: idv.awarding_office?.agency_name || idv.agency_name,
        code: idv.awarding_office?.agency_code || idv.agency_code,
        office: idv.awarding_office?.office_name || idv.office_name
      },
      idv_type: idv.idv_type,
      award_date: idv.award_date || idv.date_signed,
      last_date_to_order: idv.last_date_to_order,
      naics_code: idv.naics_code,
      psc_code: idv.psc_code,
      set_aside: idv.set_aside?.code || idv.type_of_set_aside,
      total_obligated: idv.obligated ?? idv.total_contract_value
    }));

    return {
      total: response.data.total || response.data.count || 0,
      idvs,
      filters: params,
      limit
    };
  },

  async getIdvChildren(args: any): Promise<any> {
    const {
      api_key, idv_key,
      include_child_idvs = true, include_task_orders = true, include_transactions = false,
      limit_per_section = 20
    } = args;

    const tangoApiKey = this.requireKey(api_key);
    if (!idv_key) throw new Error("idv_key is required");

    const perSection = Math.min(limit_per_section, 100);
    const result: any = { idv_key };

    if (include_child_idvs) {
      const r = await ApiClient.tangoGet(`/idvs/${idv_key}/idvs/`, { limit: perSection }, tangoApiKey);
      if (r.success) {
        result.child_idvs = (r.data.results || []).map((c: any) => ({
          idv_key: c.key || c.piid,
          piid: c.piid,
          title: c.description || c.title,
          vendor_name: c.recipient?.display_name || c.vendor_name,
          award_date: c.award_date,
          last_date_to_order: c.last_date_to_order,
          obligated: c.obligated ?? c.total_contract_value
        }));
        result.child_idvs_total = r.data.count ?? null;
      } else {
        result.child_idvs_error = r.error;
      }
    }

    if (include_task_orders) {
      const r = await ApiClient.tangoGet(`/idvs/${idv_key}/awards/`, { limit: perSection, ordering: '-award_date' }, tangoApiKey);
      if (r.success) {
        result.task_orders = (r.data.results || []).map((c: any) => ({
          award_key: c.key || c.piid,
          piid: c.piid,
          title: c.description || c.title,
          vendor_name: c.recipient?.display_name || c.vendor_name,
          award_date: c.award_date,
          obligated: c.obligated ?? c.total_contract_value,
          agency: c.awarding_office?.agency_name || c.agency_name
        }));
        result.task_orders_total = r.data.count ?? null;
      } else {
        result.task_orders_error = r.error;
      }
    }

    if (include_transactions) {
      const r = await ApiClient.tangoGet(`/idvs/${idv_key}/transactions/`, { limit: perSection, ordering: '-action_date' }, tangoApiKey);
      if (r.success) {
        result.transactions = (r.data.results || []).map((t: any) => ({
          action_date: t.action_date,
          obligated_change: t.federal_action_obligation ?? t.obligated_amount ?? t.amount,
          modification_number: t.modification_number,
          description: t.transaction_description || t.description
        }));
        result.transactions_total = r.data.count ?? null;
      } else {
        result.transactions_error = r.error;
      }
    }

    return result;
  },

  async searchVehicles(args: any): Promise<any> {
    const {
      api_key, query, vehicle_type, type_of_idc, contract_type, set_aside,
      naics_code, psc_code, program_acronym, who_can_use, agency, organization_id,
      total_obligated_min, total_obligated_max, limit = 10
    } = args;

    const tangoApiKey = this.requireKey(api_key);

    const params: Record<string, any> = { limit: Math.min(limit, 100) };
    if (query) params.search = query;
    if (vehicle_type) params.vehicle_type = vehicle_type;
    if (type_of_idc) params.type_of_idc = type_of_idc;
    if (contract_type) params.contract_type = contract_type;
    if (set_aside) params.set_aside = set_aside;
    if (naics_code) params.naics_code = naics_code;
    if (psc_code) params.psc_code = psc_code;
    if (program_acronym) params.program_acronym = program_acronym;
    if (who_can_use) params.who_can_use = who_can_use;
    if (agency) params.agency = agency;
    if (organization_id) params.organization_id = organization_id;
    if (typeof total_obligated_min === 'number') params.total_obligated_min = total_obligated_min;
    if (typeof total_obligated_max === 'number') params.total_obligated_max = total_obligated_max;

    const response = await ApiClient.tangoGet('/vehicles/', params, tangoApiKey);
    if (!response.success) return { error: response.error };

    const vehicles = (response.data.results || []).map((v: any) => ({
      vehicle_uuid: v.uuid || v.id,
      name: v.name || v.title || v.description,
      program_acronym: v.program_acronym,
      vehicle_type: v.vehicle_type,
      type_of_idc: v.type_of_idc,
      contract_type: v.contract_type,
      set_aside: v.set_aside,
      who_can_use: v.who_can_use,
      naics_code: v.naics_code,
      psc_code: v.psc_code,
      awarding_agency: v.awarding_agency_name || v.agency_name,
      total_obligated: v.total_obligated,
      awardee_count: v.awardee_count,
      latest_award_date: v.latest_award_date
    }));

    return {
      total: response.data.total || response.data.count || 0,
      vehicles,
      filters: params,
      limit
    };
  },

  async searchOtas(args: any): Promise<any> {
    const {
      api_key, query, vendor_name, vendor_uei, piid, agency, funding_agency,
      award_date_from, award_date_to, fiscal_year, limit = 10
    } = args;

    const tangoApiKey = this.requireKey(api_key);

    const params: Record<string, any> = { limit: Math.min(limit, 100) };
    if (query) params.search = query;
    if (vendor_name) params.recipient = vendor_name;
    if (vendor_uei) params.uei = vendor_uei;
    if (piid) params.piid = piid;
    if (agency) params.awarding_agency = agency;
    if (funding_agency) params.funding_agency = funding_agency;
    if (award_date_from) params.award_date_gte = award_date_from;
    if (award_date_to) params.award_date_lte = award_date_to;
    if (fiscal_year) params.fiscal_year = fiscal_year;

    const response = await ApiClient.tangoGet('/otas/', params, tangoApiKey);
    if (!response.success) return { error: response.error };

    const otas = (response.data.results || []).map((o: any) => ({
      ota_key: o.key || o.piid,
      piid: o.piid,
      title: o.description || o.title,
      vendor: {
        name: o.recipient?.display_name || o.vendor_name,
        uei: o.recipient?.uei || o.vendor_uei
      },
      agency: {
        name: o.awarding_office?.agency_name || o.agency_name,
        code: o.awarding_office?.agency_code || o.agency_code,
        office: o.awarding_office?.office_name || o.office_name
      },
      award_date: o.award_date || o.date_signed,
      fiscal_year: o.fiscal_year,
      total_obligated: o.obligated ?? o.total_contract_value
    }));

    return {
      total: response.data.total || response.data.count || 0,
      otas,
      filters: params,
      limit
    };
  },

  async getEntityMetrics(args: any): Promise<any> {
    const { api_key, uei, months = 36, period_grouping = 'quarter', group_by } = args;

    const tangoApiKey = this.requireKey(api_key);
    if (!uei) throw new Error("uei is required");

    const validGrouping = ['month', 'quarter', 'year'];
    if (!validGrouping.includes(period_grouping)) {
      throw new Error(`period_grouping must be one of: ${validGrouping.join(', ')}`);
    }

    const params: Record<string, any> = {};
    if (group_by) params.group_by = group_by;

    const response = await ApiClient.tangoGet(
      `/entities/${uei}/metrics/${months}/${period_grouping}/`,
      params,
      tangoApiKey
    );
    if (!response.success) return { error: response.error };

    return {
      uei,
      months,
      period_grouping,
      group_by: group_by || null,
      metrics: response.data
    };
  }
};
