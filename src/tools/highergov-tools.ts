import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { createHash } from 'node:crypto';
import { ApiClient, ApiResponse } from '../utils/api-client.js';
import {
  normalizeAgency,
  normalizeVehicle,
  normalizeSetAside,
  toIsoOrNull,
  toUsdInteger,
  truncate,
  asStringArray,
} from '../utils/highergov-slugs.js';
import { applyPageCursor, highergovNextCursor } from '../utils/pagination.js';
import { listEnvelope, enforceClientBound } from '../utils/envelope.js';
import { describeSetAside, isKnownSetAsideCode } from '../utils/fpds-codes.js';

// ---- Cache (in-process LRU + TTL) ----
// Per spec §3.3: cache the three get_* lookups for 15 minutes by input ID.
// search_* is intentionally not cached — agents want fresh forecasts/recompete candidates.
const CACHE_TTL_MS = 15 * 60 * 1000;
const CACHE_MAX_ENTRIES = 500;

type CacheEntry = { value: any; expiresAt: number };
const cache = new Map<string, CacheEntry>();

function cloneCacheValue<T>(value: T): T {
  if (value === null || value === undefined) return value;
  return JSON.parse(JSON.stringify(value)) as T;
}

function apiKeyScope(apiKey: string): string {
  return createHash('sha256').update(apiKey).digest('hex').slice(0, 16);
}

function buildCacheKey(kind: string, id: string, apiKey: string): string {
  return `${kind}:${apiKeyScope(apiKey)}:${id}`;
}

function cacheGet(key: string): any | undefined {
  const hit = cache.get(key);
  if (!hit) return undefined;
  if (Date.now() > hit.expiresAt) {
    cache.delete(key);
    return undefined;
  }
  // LRU touch
  cache.delete(key);
  cache.set(key, hit);
  return cloneCacheValue(hit.value);
}

function cacheSet(key: string, value: any): void {
  if (cache.size >= CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
  cache.set(key, { value: cloneCacheValue(value), expiresAt: Date.now() + CACHE_TTL_MS });
}

// ---- Standard error shape (spec §3.4) ----
type ErrorCode = 'not_found' | 'bad_request' | 'upstream_error' | 'rate_limited' | 'auth_failed';

class MissingHigherGovApiKeyError extends Error {
  constructor() {
    super('HigherGov API key required. Authorize the remote MCP connector or configure HIGHERGOV_API_KEY.');
    this.name = 'MissingHigherGovApiKeyError';
  }
}

function errorResponse(code: ErrorCode, message: string, retryAfterSeconds: number | null = null) {
  return {
    error: {
      code,
      message: message.slice(0, 400),
      retry_after_seconds: retryAfterSeconds,
    },
  };
}

function upstreamStatus(err: string | undefined): number {
  const text = err || '';
  const statusMatch = text.match(/API Error (\d+)/);
  return statusMatch ? Number(statusMatch[1]) : 0;
}

function classifyUpstreamError(err: string | undefined): ReturnType<typeof errorResponse> {
  const text = err || 'Unknown upstream error';
  const status = upstreamStatus(err);

  if (status === 401 || status === 403) {
    // Don't leak that the server-side HigherGov key is the problem.
    return errorResponse('auth_failed', 'Upstream authentication failed');
  }
  if (status === 404) return errorResponse('not_found', 'Resource not found');
  if (status === 400 || status === 422) return errorResponse('bad_request', text);
  if (status === 429) return errorResponse('rate_limited', 'Upstream rate limit hit', 60);
  return errorResponse('upstream_error', text);
}

function getApiKey(args: any): string {
  const key = args?.api_key || process.env.HIGHERGOV_API_KEY;
  if (!key) {
    throw new MissingHigherGovApiKeyError();
  }
  return key;
}

// Some inputs accept a HigherGov URL; extract the trailing ID segment.
function extractId(idOrUrl: string): string {
  const trimmed = idOrUrl.trim();
  if (!trimmed.includes('://')) return trimmed;
  try {
    const u = new URL(trimmed);
    const segments = u.pathname.split('/').filter(Boolean);
    return segments[segments.length - 1] || trimmed;
  } catch {
    return trimmed;
  }
}

// ---- Field extraction ----

// Probe a list of dot-paths and return the first non-empty value. The
// HigherGov payload has bitten us twice with field names that differ from our
// guesses (see docs/upstream-api-notes.md), so every mapped field lists its
// candidates from most- to least-likely and mapping drift is detected at
// runtime by coreFieldsHollow() below.
function pick(raw: any, paths: string[]): unknown {
  for (const path of paths) {
    let value: any = raw;
    for (const segment of path.split('.')) {
      if (value === null || value === undefined) break;
      value = value[segment];
    }
    if (value !== null && value !== undefined && value !== '') return value;
  }
  return null;
}

// String coercion that never yields "[object Object]".
function str(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return '';
}

function idFromSourceUrl(sourceUrl: string): string {
  try {
    const u = new URL(sourceUrl, 'https://www.highergov.com');
    const segments = u.pathname.split('/').filter(Boolean);
    return segments[segments.length - 1] || '';
  } catch {
    return '';
  }
}

// FPDS {code, description} for a raw set-aside value when it looks like a code.
function setAsideCodePair(rawValue: unknown): { code: string; description: string | null } | null {
  let s = '';
  if (typeof rawValue === 'string') {
    s = rawValue;
  } else if (rawValue && typeof rawValue === 'object') {
    const obj = rawValue as Record<string, unknown>;
    s = str(obj.code ?? obj.set_aside_code ?? '');
  }
  s = s.trim().toUpperCase();
  if (!s || !/^[0-9A-Z]{1,10}$/.test(s)) return null;
  if (!isKnownSetAsideCode(s)) return null;
  return describeSetAside(s);
}

// Parse a caller-supplied date bound; a garbled date must be a clear
// bad_request, not a filter that silently never matches.
function isoBound(value: unknown, label: string): string {
  const d = new Date(String(value));
  if (Number.isNaN(d.getTime())) {
    throw new Error(`${label} must be an ISO-8601 date (got "${value}")`);
  }
  return d.toISOString();
}

// ---- Normalizers (response shaping) ----

// HigherGov returns nested {agency_name: ...} objects for agency fields; the
// slug normalizers handle that via coerceToString. Use opp_key as the canonical
// HigherGov opportunity ID (hex slug), since it's what /opportunity/?opp_key=
// lookups require — and the agent calls get_highergov_opportunity with this value.
function normalizeForecast(raw: any) {
  const setAside = raw.set_aside ?? raw.type_of_set_aside ?? null;
  return {
    forecast_id: String(raw.opp_key ?? raw.forecast_id ?? raw.id ?? ''),
    title: String(raw.title ?? raw.name ?? ''),
    agency: normalizeAgency(raw.agency ?? raw.agency_name ?? raw.awarding_agency),
    sub_agency: normalizeAgency(raw.sub_agency ?? raw.sub_agency_name ?? null),
    naics: asStringArray(raw.naics_code ?? raw.naics),
    psc: asStringArray(raw.psc_code ?? raw.psc),
    set_aside: normalizeSetAside(setAside),
    vehicle: normalizeVehicle(raw.vehicle ?? raw.contract_vehicle ?? null),
    estimated_value: toUsdInteger(
      raw.estimated_value ?? raw.estimated_contract_value ?? raw.val_est_high ?? raw.val_est_low
    ),
    estimated_solicitation_date: toIsoOrNull(
      raw.estimated_solicitation_date ?? raw.solicitation_date ?? raw.posted_date
    ),
    estimated_award_date: toIsoOrNull(raw.estimated_award_date ?? raw.award_date ?? raw.due_date),
    description: truncate(
      String(raw.description_text ?? raw.description ?? raw.ai_summary ?? raw.summary ?? ''),
      2000
    ),
    source_url: String(raw.path ?? raw.source_url ?? raw.source_path ?? raw.url ?? ''),
  };
}

function normalizeOpportunity(raw: any) {
  const oppType = raw.opp_type;
  const typeStr = typeof oppType === 'object' && oppType
    ? String(oppType.description ?? oppType.name ?? '')
    : String(raw.opportunity_type ?? raw.notice_type ?? raw.type ?? '');
  return {
    opportunity_id: String(raw.opp_key ?? raw.opportunity_key ?? raw.opportunity_id ?? raw.id ?? ''),
    sam_notice_id: raw.source_id || raw.sam_notice_id || raw.notice_id || null,
    type: typeStr.toLowerCase() || 'solicitation',
    title: String(raw.title ?? ''),
    agency: normalizeAgency(raw.agency ?? raw.agency_name ?? raw.awarding_agency),
    sub_agency: normalizeAgency(raw.sub_agency ?? raw.sub_agency_name ?? null),
    office: raw.office_name ?? raw.office ?? null,
    naics: asStringArray(raw.naics_code ?? raw.naics),
    psc: asStringArray(raw.psc_code ?? raw.psc),
    set_aside: normalizeSetAside(raw.set_aside ?? null),
    vehicle: normalizeVehicle(raw.vehicle ?? raw.contract_vehicle ?? null),
    estimated_value: toUsdInteger(
      raw.estimated_value ?? raw.award_amount ?? raw.val_est_high ?? raw.val_est_low
    ),
    posted_date: toIsoOrNull(raw.posted_date ?? raw.published_date ?? raw.captured_date),
    response_deadline: toIsoOrNull(raw.due_date ?? raw.response_date ?? raw.response_deadline),
    estimated_award_date: toIsoOrNull(raw.estimated_award_date ?? raw.award_date),
    description: String(raw.description_text ?? raw.description ?? raw.ai_summary ?? raw.summary ?? ''),
    attachments: Array.isArray(raw.attachments)
      ? raw.attachments.map((a: any) => ({
          name: String(a.name ?? a.filename ?? ''),
          url: String(a.url ?? a.download_url ?? ''),
          mime_type: a.mime_type ?? a.content_type ?? null,
          size_bytes: typeof a.size === 'number' ? a.size : a.size_bytes ?? null,
        }))
      : [],
    incumbent_contract_id: raw.incumbent_contract_id ?? raw.related_contract_key ?? null,
    source_url: String(raw.path ?? raw.source_url ?? raw.source_path ?? raw.url ?? ''),
  };
}

// Field names below are the `Federal Contract` schema from the HigherGov
// OpenAPI spec (fixtures/raw/highergov-openapi.json, v1.2, retrieved
// 2026-08-23). Nested shapes: awardee → AwardeeSimple {awardee_key,
// clean_name, uei, cage_code, path}; awarding_agency/funding_agency →
// AgencySimple {agency_key, agency_name, agency_abbreviation, agency_type,
// path}; vehicle → VehicleSimple {vehicle_key, vehicle_name, ...};
// naics_code → {naics_code, naics_description}; psc_code → {psc_code, ...}.
export function normalizeContractSummary(raw: any) {
  const sourceUrl = str(pick(raw, ['path']));
  const awardId = str(pick(raw, ['award_id'])) || idFromSourceUrl(sourceUrl);
  const rawSetAside = pick(raw, ['type_of_set_aside']);
  return {
    // The spec exposes no separate surrogate key; award_id is the record ID
    // and the lookup param for get_highergov_contract.
    contract_id: awardId,
    piid: awardId,
    title: str(pick(raw, ['award_description_original', 'alt_description', 'related_opportunity_title'])),
    incumbent_name: str(pick(raw, ['awardee.clean_name'])),
    incumbent_uei: (pick(raw, ['awardee.uei']) as string | null),
    agency: normalizeAgency(pick(raw, ['awarding_agency.agency_name'])),
    // The spec has no sub-agency on contracts; funding_agency is the second
    // agency dimension it does carry.
    funding_agency: normalizeAgency(pick(raw, ['funding_agency.agency_name'])),
    naics: asStringArray(raw.naics_code ?? raw.naics),
    psc: asStringArray(raw.psc_code ?? raw.psc),
    set_aside: normalizeSetAside(rawSetAside),
    set_aside_code: setAsideCodePair(rawSetAside),
    vehicle: normalizeVehicle(pick(raw, ['vehicle.vehicle_name', 'vehicle'])),
    value: toUsdInteger(pick(raw, ['current_total_value_of_award', 'potential_total_value_of_award'])) ?? 0,
    pop_start: toIsoOrNull(str(pick(raw, ['period_of_performance_start_date'])) || null),
    pop_end: toIsoOrNull(str(pick(raw, ['period_of_performance_current_end_date'])) || null),
    pop_potential_end: toIsoOrNull(str(pick(raw, ['period_of_performance_potential_end_date'])) || null),
    source_url: sourceUrl,
  };
}

function normalizeContact(raw: any, role: string) {
  if (!raw || typeof raw !== 'object') return null;
  const name = str(pick(raw, ['contact_name']));
  const email = str(pick(raw, ['contact_email']));
  if (!name && !email) return null;
  return {
    role,
    name: name || null,
    title: str(pick(raw, ['contact_title'])) || null,
    email: email || null,
    phone: str(pick(raw, ['contact_phone'])) || null,
  };
}

export function normalizeContractFull(raw: any) {
  const base = normalizeContractSummary(raw);
  const contacts = [
    normalizeContact(raw.created_by, 'created_by'),
    normalizeContact(raw.last_modified_by, 'last_modified_by'),
    normalizeContact(raw.approved_by, 'approved_by'),
  ].filter((c): c is NonNullable<typeof c> => c !== null);
  return {
    ...base,
    description: str(pick(raw, ['award_description_original', 'alt_description'])) || null,
    obligated_value: toUsdInteger(pick(raw, ['total_dollars_obligated'])),
    potential_value: toUsdInteger(pick(raw, ['potential_total_value_of_award'])),
    award_type: str(pick(raw, ['award_type'])) || null,
    parent_award_id: str(pick(raw, ['parent_award_id'])) || null,
    solicitation_id: str(pick(raw, ['solicitation_identifier'])) || null,
    pricing_type: str(pick(raw, ['type_of_contract_pricing_description'])) || null,
    extent_competed: str(pick(raw, ['extent_competed'])) || null,
    number_of_offers_received: str(pick(raw, ['number_of_offers_received'])) || null,
    latest_action_date: toIsoOrNull(str(pick(raw, ['latest_action_date'])) || null),
    last_modified_date: toIsoOrNull(str(pick(raw, ['last_modified_date'])) || null),
    place_of_performance: {
      city: str(pick(raw, ['primary_place_of_performance_city_name'])) || null,
      state: str(pick(raw, ['primary_place_of_performance_state_code'])) || null,
      zip: str(pick(raw, ['primary_place_of_performance_zip'])) || null,
      country: str(pick(raw, ['primary_place_of_performance_country_name'])) || null,
    },
    contracting_contacts: contacts,
  };
}

// Runtime tripwire for mapping drift (this is what P0-5 lacked): if every
// record on a non-empty page has essentially no core fields populated, the
// upstream field names have moved out from under the normalizer. Say so, and
// show the raw keys so the fix is one capture away — never return hollow
// records as if they were data.
const CORE_CONTRACT_FIELDS = ['piid', 'title', 'incumbent_name', 'agency', 'value', 'pop_end'] as const;

export function contractMappingDriftWarning(mapped: any[], rawList: any[]): string | null {
  if (rawList.length === 0 || mapped.length === 0) return null;
  const allHollow = mapped.every(row => {
    const populated = CORE_CONTRACT_FIELDS.filter(field => {
      const v = row[field];
      return v !== null && v !== undefined && v !== '' && v !== 0;
    }).length;
    return populated <= 1;
  });
  if (!allHollow) return null;
  const keys = Object.keys(rawList[0] ?? {}).slice(0, 40);
  return (
    `Field mapping appears OUT OF DATE: core fields (${CORE_CONTRACT_FIELDS.join(', ')}) are empty on every ` +
    `record even though upstream returned data. Raw record keys: ${keys.join(', ')}. ` +
    `Run "npm run capture-fixtures" and update normalizeContractSummary in src/tools/highergov-tools.ts.`
  );
}

// `People` schema per the OpenAPI spec: contact_first_name, contact_last_name,
// contact_name, contact_title, contact_email, contact_phone, contact_ext,
// contact_fax, agency (AgencySimple), contact_type, last_seen, path. There is
// no numeric person ID; contact_email is the only lookup param the API
// documents, so it doubles as person_id when present.
function normalizePersonSummary(raw: any) {
  const email = str(pick(raw, ['contact_email']));
  const sourceUrl = str(pick(raw, ['path']));
  const name =
    str(pick(raw, ['contact_name'])) ||
    [str(pick(raw, ['contact_first_name'])), str(pick(raw, ['contact_last_name']))].filter(Boolean).join(' ');
  return {
    person_id: email || idFromSourceUrl(sourceUrl),
    name,
    title: str(pick(raw, ['contact_title'])),
    agency: normalizeAgency(raw.agency),
    contact_type: str(pick(raw, ['contact_type'])) || null,
    email: email || null,
    last_seen: toIsoOrNull(str(pick(raw, ['last_seen'])) || null),
    source_url: sourceUrl,
  };
}

function normalizePersonFull(raw: any) {
  return {
    ...normalizePersonSummary(raw),
    phone: str(pick(raw, ['contact_phone'])) || null,
    phone_ext: str(pick(raw, ['contact_ext'])) || null,
  };
}

function resultArray(raw: any): any[] {
  const list = raw?.results ?? raw?.data ?? [];
  return Array.isArray(list) ? list : [];
}

// Total count from a HigherGov payload. The OpenAPI spec puts it at
// meta.pagination.count; the rest are fallbacks for older payload shapes.
function highergovTotal(raw: any): number | null {
  const candidates = [
    raw?.meta?.pagination?.count,
    raw?.count,
    raw?.total_count,
    raw?.num_results,
    raw?.result_count,
    raw?.meta?.count,
    raw?.pagination?.count,
  ];
  for (const c of candidates) {
    const n = Number(c);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

// ---- Tool surface ----

export const highergovTools = {
  async getTools(): Promise<Tool[]> {
    return [
      {
        name: 'search_highergov_forecasts',
        description:
          'Pull forecasts matching a HigherGov saved search. Returns the paginated list of new or updated forecasts since `since` (default: last 24 hours). Use `next_cursor` to page. Saved-search IDs come from list_highergov_saved_searches or the HigherGov UI.',
        inputSchema: {
          type: 'object',
          properties: {
            api_key: { type: 'string', description: 'HigherGov API key (optional if HIGHERGOV_API_KEY env var is set)' },
            saved_search_id: { type: 'string', description: 'HigherGov saved-search ID (required)' },
            since: { type: 'string', description: 'ISO-8601 datetime; defaults to last 24h' },
            limit: { type: 'number', description: 'Number of results (default 50, max 200)' },
            cursor: { type: 'string', description: 'Page number from prior next_cursor' },
          },
          required: ['saved_search_id'],
        },
      },
      {
        name: 'get_highergov_opportunity',
        description:
          'Get one opportunity by HigherGov ID, SAM notice ID, or URL. Returns the full record including agency, NAICS, vehicle, set-aside, value, dates, description, and attachments. If `incumbent_contract_id` is present, follow up with get_highergov_contract to enrich.',
        inputSchema: {
          type: 'object',
          properties: {
            api_key: { type: 'string', description: 'HigherGov API key (optional if HIGHERGOV_API_KEY env var is set)' },
            id: { type: 'string', description: 'HigherGov opportunity ID, SAM notice ID, or HigherGov URL' },
          },
          required: ['id'],
        },
      },
      {
        name: 'search_highergov_contracts',
        description:
          'Search awarded federal contracts by agency, NAICS, PSC, set-aside, period-of-performance end-date range, and value bounds. Use to find recompete candidates 12–18 months ahead of PoP end. At least one of agency/naics/psc is required. Every response echoes which filters ran upstream vs client-side and warns when a filter could not be verified — read `warnings` before trusting counts.',
        inputSchema: {
          type: 'object',
          properties: {
            api_key: { type: 'string', description: 'HigherGov API key (optional if HIGHERGOV_API_KEY env var is set)' },
            agency: { type: 'string', description: 'Agency name or slug. The upstream API only filters by numeric key (see agency_key), so names are enforced client-side against returned records — see warnings.' },
            agency_key: {
              type: 'number',
              description: 'HigherGov awarding agency key (numeric). The only agency filter the upstream API honors (awarding_agency_key). Find it on the agency page URL in the HigherGov UI or via /api-external/agency/.',
            },
            awardee_uei: { type: 'string', description: 'Awardee UEI (server-side filter)' },
            naics: { type: 'array', items: { type: 'string' } },
            psc: { type: 'array', items: { type: 'string' } },
            set_aside: {
              type: 'array',
              items: { type: 'string' },
              description: "Set-aside slugs or FPDS codes (e.g. ['sdvosb','8a'] or ['SDVOSBS','8AN']). Applied client-side against normalized records.",
            },
            pop_end_after: { type: 'string', description: 'ISO-8601 date; period-of-performance end on/after this date (applied client-side; upstream has no PoP filter)' },
            pop_end_before: { type: 'string', description: 'ISO-8601 date; period-of-performance end on/before this date (applied client-side)' },
            min_value: { type: 'number', description: 'USD (applied client-side; upstream has no value filter)' },
            max_value: { type: 'number', description: 'USD (applied client-side)' },
            limit: { type: 'number', description: 'Default 50, max 200' },
            cursor: { type: 'string', description: 'Page number from prior next_cursor' },
          },
          required: [],
        },
      },
      {
        name: 'get_highergov_contract',
        description:
          'Get full record for one contract by award ID (PIID). Returns incumbent, dates, values, set-aside, vehicle, competition details (extent competed, offers received), pricing type, place of performance, and contracting-office contacts.',
        inputSchema: {
          type: 'object',
          properties: {
            api_key: { type: 'string', description: 'HigherGov API key (optional if HIGHERGOV_API_KEY env var is set)' },
            id: { type: 'string', description: 'HigherGov contract ID or PIID' },
          },
          required: ['id'],
        },
      },
      {
        name: 'search_highergov_people',
        description:
          'Search federal POCs. The upstream API only filters by contact email; agency and role keywords are applied client-side against returned pages — page with next_cursor to cover more. `email` may be null — if absent, do not draft outreach.',
        inputSchema: {
          type: 'object',
          properties: {
            api_key: { type: 'string', description: 'HigherGov API key (optional if HIGHERGOV_API_KEY env var is set)' },
            agency: { type: 'string', description: 'Agency slug or name (applied client-side; see warnings)' },
            email: { type: 'string', description: 'Exact contact email (the only server-side filter the upstream API supports)' },
            role_keywords: { type: 'array', items: { type: 'string' }, description: 'Matched client-side against contact titles' },
            limit: { type: 'number', description: 'Default 20, max 100' },
            cursor: { type: 'string', description: 'Page number from prior next_cursor' },
          },
          required: [],
        },
      },
      {
        name: 'get_highergov_person',
        description:
          'Get the full profile for one POC by contact email (the only lookup the upstream API supports), including phone and agency. If `email` is null on a search result, there is nothing to look up — do not draft outreach.',
        inputSchema: {
          type: 'object',
          properties: {
            api_key: { type: 'string', description: 'HigherGov API key (optional if HIGHERGOV_API_KEY env var is set)' },
            id: { type: 'string', description: 'Contact email address (person_id from search_highergov_people when it is an email)' },
          },
          required: ['id'],
        },
      },
      {
        name: 'search_highergov_opportunities',
        description:
          'Search active contract opportunities without a saved search: filter by set-aside bundle, NAICS, PSC, agency, posted date, and response deadline. Returns Notice IDs for dedup. Upstream filter binding is limited, so filters are also verified and applied client-side against normalized records — read the filter echo and warnings. At least one filter is required.',
        inputSchema: {
          type: 'object',
          properties: {
            api_key: { type: 'string', description: 'HigherGov API key (optional if HIGHERGOV_API_KEY env var is set)' },
            set_aside: {
              type: 'array',
              items: { type: 'string' },
              description: "Set-aside slugs or FPDS codes (e.g. ['8a','sdvosb','hubzone'] or ['8AN','SDVOSBS'])",
            },
            naics: { type: 'array', items: { type: 'string' }, description: 'NAICS code prefixes (e.g. ["5415"] matches 541511)' },
            psc: { type: 'array', items: { type: 'string' }, description: 'PSC code prefixes' },
            agency: { type: 'string', description: 'Agency slug or name (post-verified client-side)' },
            posted_after: { type: 'string', description: 'ISO-8601 date; opportunities posted on/after' },
            response_due_before: { type: 'string', description: 'ISO-8601 date; response deadline on/before' },
            response_due_after: { type: 'string', description: 'ISO-8601 date; response deadline on/after (defaults to now — drops already-closed notices; pass an earlier date to include them)' },
            limit: { type: 'number', description: 'Default 50, max 200' },
            cursor: { type: 'string', description: 'Page number from prior next_cursor' },
          },
          required: [],
        },
      },
      {
        name: 'list_highergov_saved_searches',
        description:
          'List the saved searches on the HigherGov account behind the API key, so search_highergov_forecasts can be called without hunting for a magic ID. If the upstream API does not expose saved searches, returns guidance on where to find the ID in the HigherGov UI.',
        inputSchema: {
          type: 'object',
          properties: {
            api_key: { type: 'string', description: 'HigherGov API key (optional if HIGHERGOV_API_KEY env var is set)' },
          },
          required: [],
        },
      },
      {
        name: 'get_opportunity_documents',
        description:
          'List the solicitation documents (RFP, attachments, amendments) for one opportunity, with fetchable URLs, so an agent can read the solicitation without a manual download/upload cycle. Pass the same ID accepted by get_highergov_opportunity.',
        inputSchema: {
          type: 'object',
          properties: {
            api_key: { type: 'string', description: 'HigherGov API key (optional if HIGHERGOV_API_KEY env var is set)' },
            id: { type: 'string', description: 'HigherGov opportunity ID, SAM notice ID, or HigherGov URL' },
          },
          required: ['id'],
        },
      },
    ];
  },

  async callTool(name: string, args: any): Promise<any> {
    const sanitized = ApiClient.sanitizeInput(args);
    try {
      switch (name) {
        case 'search_highergov_forecasts':
          return await this.searchForecasts(sanitized);
        case 'get_highergov_opportunity':
          return await this.getOpportunity(sanitized);
        case 'search_highergov_contracts':
          return await this.searchContracts(sanitized);
        case 'get_highergov_contract':
          return await this.getContract(sanitized);
        case 'search_highergov_people':
          return await this.searchPeople(sanitized);
        case 'get_highergov_person':
          return await this.getPerson(sanitized);
        case 'search_highergov_opportunities':
          return await this.searchOpportunities(sanitized);
        case 'list_highergov_saved_searches':
          return await this.listSavedSearches(sanitized);
        case 'get_opportunity_documents':
          return await this.getOpportunityDocuments(sanitized);
        default:
          throw new Error(`Unknown HigherGov tool: ${name}`);
      }
    } catch (err) {
      if (err instanceof MissingHigherGovApiKeyError) {
        return errorResponse('auth_failed', err.message);
      }
      const message = err instanceof Error ? err.message : String(err);
      return errorResponse('bad_request', message);
    }
  },

  async searchForecasts(args: any) {
    const apiKey = getApiKey(args);
    if (!args.saved_search_id) return errorResponse('bad_request', 'saved_search_id is required');

    const limit = Math.min(Math.max(Number(args.limit) || 50, 1), 200);
    const since = args.since ?? new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    // HigherGov's help-guide examples document last_modified_date (day
    // granularity, e.g. 2023-07-06) for since-style pulls, but the OpenAPI
    // spec for /opportunity/ lists only captured_date and posted_date (both
    // single-day matches). Send last_modified_date as best-effort narrowing
    // and say so — records carry no last-modified field to verify against.
    const params: Record<string, any> = {
      search_id: args.saved_search_id,
      last_modified_date: String(since).slice(0, 10),
      page_size: limit,
    };
    applyPageCursor(params, args.cursor);

    const res: ApiResponse = await ApiClient.highergovGet('/opportunity/', params, apiKey);
    if (!res.success) return classifyUpstreamError(res.error);

    const list = resultArray(res.data);
    return {
      results: list.map(normalizeForecast),
      total: highergovTotal(res.data),
      count_unit: 'forecast opportunities (HigherGov records)',
      filters: { upstream: params, client_side: {} },
      warnings: [
        'last_modified_date comes from HigherGov help-guide examples but is absent from the /opportunity/ OpenAPI spec; if ignored upstream, results may include records older than `since`.',
      ],
      next_cursor: highergovNextCursor(res.data),
    };
  },

  async getOpportunity(args: any) {
    const apiKey = getApiKey(args);
    if (!args.id) return errorResponse('bad_request', 'id is required');

    const id = extractId(String(args.id));
    const cacheKey = buildCacheKey('opportunity', id, apiKey);
    const cached = cacheGet(cacheKey);
    if (cached) return cached;

    // HigherGov's /opportunity/ endpoint requires a query param — path-based
    // lookups return 400. Try opp_key (HigherGov's hex slug) first, then
    // source_id (SAM notice id) as a fallback.
    const tried: string[] = [];
    for (const param of ['opp_key', 'source_id'] as const) {
      tried.push(param);
      const res = await ApiClient.highergovGet('/opportunity/', { [param]: id, page_size: 1 }, apiKey);
      if (!res.success) return classifyUpstreamError(res.error);
      const list = resultArray(res.data);
      if (list.length > 0) {
        const result = normalizeOpportunity(list[0]);
        cacheSet(cacheKey, result);
        return result;
      }
    }
    return errorResponse('not_found', `No opportunity found for id "${id}". Tried lookups: ${tried.join(', ')}.`);
  },

  async searchContracts(args: any) {
    const apiKey = getApiKey(args);

    const naics = asStringArray(args.naics);
    const psc = asStringArray(args.psc);
    if (!args.agency && args.agency_key === undefined && !args.awardee_uei && naics.length === 0 && psc.length === 0) {
      return errorResponse('bad_request', 'At least one of agency, agency_key, awardee_uei, naics, or psc is required');
    }

    const limit = Math.min(Math.max(Number(args.limit) || 50, 1), 200);
    // Upstream params are exactly the ones the OpenAPI spec documents for
    // /contract/ (docs/upstream-api-notes.md). Agency *names* have no upstream
    // param — only awarding_agency_key binds — and there is no PoP-date or
    // value filter, so those stay client-side below.
    const upstream: Record<string, any> = { page_size: limit };
    if (args.agency_key !== undefined) {
      const key = Number(args.agency_key);
      if (!Number.isInteger(key) || key <= 0) {
        return errorResponse('bad_request', `agency_key must be a positive integer HigherGov agency key (got "${args.agency_key}")`);
      }
      upstream.awarding_agency_key = key;
    }
    if (args.awardee_uei) upstream.awardee_uei = args.awardee_uei;
    if (naics.length) upstream.naics_code = naics.join(',');
    if (psc.length) upstream.psc_code = psc.join(',');
    applyPageCursor(upstream, args.cursor);

    const res = await ApiClient.highergovGet('/contract/', upstream, apiKey);
    if (!res.success) return classifyUpstreamError(res.error);

    const rawList = resultArray(res.data);
    let rows = rawList.map(normalizeContractSummary);
    const warnings: string[] = [];
    const clientSide: Record<string, unknown> = {};

    const drift = contractMappingDriftWarning(rows, rawList);
    if (drift) warnings.push(drift);

    // P0-6: the upstream API has no agency-*name* filter (the OpenAPI spec
    // only documents awarding_agency_key), so a requested agency name is
    // enforced client-side against the returned records. Never return other
    // agencies' awards as if the filter had run.
    if (args.agency) {
      const want = normalizeAgency(String(args.agency));
      const verifiable = rows.filter(r => r.agency || r.funding_agency);
      if (verifiable.length === 0 && rows.length > 0) {
        warnings.push(
          'The agency filter could not be verified: returned records carry no readable agency. Treat these results as UNFILTERED by agency.'
        );
      } else {
        const matching = rows.filter(r => r.agency === want || r.funding_agency === want);
        if (matching.length !== rows.length) {
          clientSide.agency = args.agency;
          warnings.push(
            `The upstream API has no agency-name filter (only the numeric agency_key binds server-side); "${args.agency}" was applied client-side and removed ${rows.length - matching.length} of ${rows.length} records on this page. Page through next_cursor to enumerate, or pass agency_key to filter server-side.`
          );
          rows = matching;
        }
      }
    }

    // Set-aside bundle filter (client-side by design; rows expose normalized slugs).
    const setAsides = asStringArray(args.set_aside).map(s => normalizeSetAside(s)).filter(Boolean) as string[];
    if (setAsides.length > 0) {
      const readable = rows.filter(r => r.set_aside).length;
      if (readable === 0 && rows.length > 0) {
        warnings.push(
          'set_aside filter requested but no record on this page carries a readable set-aside; the filter was NOT applied. Results are unfiltered by set-aside.'
        );
      } else {
        clientSide.set_aside = setAsides;
        rows = rows.filter(r => r.set_aside && setAsides.includes(r.set_aside));
      }
    }

    // Bounds the upstream is not known to honor: verify and enforce client-side.
    const popEndAfter = args.pop_end_after ? isoBound(args.pop_end_after, 'pop_end_after') : undefined;
    const popEndBefore = args.pop_end_before ? isoBound(args.pop_end_before, 'pop_end_before') : undefined;
    rows = enforceClientBound(rows, 'min_value', args.min_value, r => (r.value === 0 ? null : r.value), (v, b) => v >= Number(b), clientSide, warnings);
    rows = enforceClientBound(rows, 'max_value', args.max_value, r => (r.value === 0 ? null : r.value), (v, b) => v <= Number(b), clientSide, warnings);
    rows = enforceClientBound(rows, 'pop_end_after', popEndAfter, r => r.pop_end, (v, b) => String(v) >= String(b), clientSide, warnings);
    rows = enforceClientBound(rows, 'pop_end_before', popEndBefore, r => r.pop_end, (v, b) => String(v) <= String(b), clientSide, warnings);

    return listEnvelope({
      resourceKey: 'results',
      rows,
      upstreamTotal: highergovTotal(res.data),
      countUnit: 'contract award records (HigherGov; award vs IDV level unverified)',
      dateField:
        args.pop_end_after || args.pop_end_before
          ? 'period_of_performance_current_end_date (client-verified)'
          : undefined,
      filters: { upstream, client_side: clientSide },
      warnings,
      nextCursor: highergovNextCursor(res.data),
    });
  },

  async getContract(args: any) {
    const apiKey = getApiKey(args);
    if (!args.id) return errorResponse('bad_request', 'id is required');

    const id = extractId(String(args.id));
    const cacheKey = buildCacheKey('contract', id, apiKey);
    const cached = cacheGet(cacheKey);
    if (cached) return cached;

    // HigherGov's /contract/ endpoint requires a query param — path-based
    // lookups return 400. award_id covers both full PIIDs and parent IDs.
    const tried: string[] = [];
    for (const param of ['award_id', 'parent_award_id'] as const) {
      tried.push(param);
      const res = await ApiClient.highergovGet('/contract/', { [param]: id, page_size: 1 }, apiKey);
      if (!res.success) return classifyUpstreamError(res.error);
      const list = resultArray(res.data);
      if (list.length > 0) {
        const result: any = normalizeContractFull(list[0]);
        const drift = contractMappingDriftWarning([result], list);
        if (drift) result.warnings = [drift];
        cacheSet(cacheKey, result);
        return result;
      }
    }
    return errorResponse('not_found', `No contract found for id "${id}". Tried lookups: ${tried.join(', ')}.`);
  },

  async searchPeople(args: any) {
    const apiKey = getApiKey(args);
    if (!args.agency && !args.email) {
      return errorResponse('bad_request', 'At least one of agency or email is required');
    }

    const limit = Math.min(Math.max(Number(args.limit) || 20, 1), 100);
    // Per the OpenAPI spec, /people/ filters only by contact_email; agency and
    // role keywords have no upstream param and are enforced client-side.
    const params: Record<string, any> = { page_size: limit };
    if (args.email) params.contact_email = args.email;
    applyPageCursor(params, args.cursor);

    const res = await ApiClient.highergovGet('/people/', params, apiKey);
    if (!res.success) return classifyUpstreamError(res.error);

    const list = resultArray(res.data);
    let rows = list.map(normalizePersonSummary);
    const warnings: string[] = [];
    const clientSide: Record<string, unknown> = {};

    if (args.agency) {
      const want = normalizeAgency(String(args.agency));
      const before = rows.length;
      rows = rows.filter(r => r.agency === want);
      clientSide.agency = args.agency;
      if (before > 0) {
        warnings.push(
          `The upstream /people/ API filters only by contact email; the agency filter was applied client-side (${before - rows.length} of ${before} records on this page removed). Page through next_cursor to cover more.`
        );
      }
    }
    const roleKeywords = asStringArray(args.role_keywords).map(k => k.toLowerCase());
    if (roleKeywords.length) {
      clientSide.role_keywords = roleKeywords;
      rows = rows.filter(r => {
        const title = (r.title || '').toLowerCase();
        return roleKeywords.some(k => title.includes(k));
      });
    }

    return listEnvelope({
      resourceKey: 'results',
      rows,
      upstreamTotal: highergovTotal(res.data),
      countUnit: 'people records (HigherGov)',
      filters: { upstream: params, client_side: clientSide },
      warnings,
      nextCursor: highergovNextCursor(res.data),
    });
  },

  async getPerson(args: any) {
    const apiKey = getApiKey(args);
    if (!args.id) return errorResponse('bad_request', 'id is required');

    const id = extractId(String(args.id));
    // The OpenAPI spec exposes /people/ as a list endpoint whose only lookup
    // param is contact_email — there is no detail route and no person key.
    if (!id.includes('@')) {
      return errorResponse(
        'bad_request',
        `The HigherGov API looks up people by contact email only (got "${id}"). Use the person_id/email from search_highergov_people when it is an email address.`
      );
    }
    const cacheKey = buildCacheKey('person', id, apiKey);
    const cached = cacheGet(cacheKey);
    if (cached) return cached;

    const res = await ApiClient.highergovGet('/people/', { contact_email: id, page_size: 1 }, apiKey);
    if (!res.success) return classifyUpstreamError(res.error);

    const list = resultArray(res.data);
    if (list.length === 0) {
      return errorResponse('not_found', `No person found for contact email "${id}".`);
    }
    const result = normalizePersonFull(list[0]);
    cacheSet(cacheKey, result);
    return result;
  },

  // Opportunity search without a saved search (spec: takes the daily set-aside
  // pull off browser automation). Upstream binding for these filters is
  // unverified, so upstream params are sent as best-effort narrowing and every
  // filter is then applied client-side against the normalized records — the
  // agent pages with next_cursor and the filter echo says exactly what ran where.
  async searchOpportunities(args: any) {
    const apiKey = getApiKey(args);

    const setAsides = asStringArray(args.set_aside).map(s => normalizeSetAside(s)).filter(Boolean) as string[];
    const naics = asStringArray(args.naics);
    const psc = asStringArray(args.psc);
    if (!setAsides.length && !naics.length && !psc.length && !args.agency && !args.posted_after) {
      return errorResponse(
        'bad_request',
        'At least one filter is required: set_aside, naics, psc, agency, or posted_after'
      );
    }

    const limit = Math.min(Math.max(Number(args.limit) || 50, 1), 200);
    // Per the OpenAPI spec, /opportunity/ has no naics/psc/set-aside params and
    // its date params (captured_date, posted_date) are single-day matches, not
    // range bounds — so every filter below runs client-side; upstream narrowing
    // is limited to source_type. Saved searches (search_id) are the upstream's
    // own filtering mechanism — see search_highergov_forecasts.
    const upstream: Record<string, any> = { page_size: limit, source_type: 'sam' };
    applyPageCursor(upstream, args.cursor);

    const res = await ApiClient.highergovGet('/opportunity/', upstream, apiKey);
    if (!res.success) return classifyUpstreamError(res.error);

    const rawList = resultArray(res.data);
    let rows = rawList.map(normalizeOpportunity);
    const warnings: string[] = [];
    const clientSide: Record<string, unknown> = {};

    if (setAsides.length > 0) {
      const readable = rows.filter(r => r.set_aside).length;
      if (readable === 0 && rows.length > 0) {
        warnings.push(
          'set_aside filter requested but no record on this page carries a readable set-aside; the filter was NOT applied on this page.'
        );
      } else {
        clientSide.set_aside = setAsides;
        rows = rows.filter(r => r.set_aside && setAsides.includes(r.set_aside));
      }
    }
    if (naics.length > 0) {
      clientSide.naics = naics;
      rows = rows.filter(r => r.naics.length === 0 || r.naics.some(code => naics.some(want => code.startsWith(want))));
    }
    if (psc.length > 0) {
      clientSide.psc = psc;
      rows = rows.filter(r => r.psc.length === 0 || r.psc.some(code => psc.some(want => code.startsWith(want))));
    }
    if (args.agency) {
      const want = normalizeAgency(String(args.agency));
      clientSide.agency = args.agency;
      rows = rows.filter(r => !r.agency || r.agency === want || r.sub_agency === want);
    }
    const postedAfter = args.posted_after ? isoBound(args.posted_after, 'posted_after') : undefined;
    const dueBefore = args.response_due_before ? isoBound(args.response_due_before, 'response_due_before') : undefined;
    const dueAfter = isoBound(args.response_due_after ?? new Date().toISOString(), 'response_due_after');
    rows = enforceClientBound(rows, 'posted_after', postedAfter, r => r.posted_date, (v, b) => String(v) >= String(b), clientSide, warnings);
    rows = enforceClientBound(rows, 'response_due_before', dueBefore, r => r.response_deadline, (v, b) => String(v) <= String(b), clientSide, warnings);
    rows = enforceClientBound(rows, 'response_due_after', dueAfter, r => r.response_deadline, (v, b) => String(v) >= String(b), clientSide, warnings);

    return listEnvelope({
      resourceKey: 'results',
      rows,
      upstreamTotal: highergovTotal(res.data),
      countUnit: 'contract opportunity notices (HigherGov; dedup on sam_notice_id)',
      dateField: 'posted_date / response_deadline (client-verified)',
      filters: { upstream, client_side: clientSide },
      warnings,
      nextCursor: highergovNextCursor(res.data),
    });
  },

  async listSavedSearches(args: any) {
    const apiKey = getApiKey(args);

    // The saved-search listing endpoint is not in HigherGov's public API
    // overview; probe the plausible paths and fall back to UI guidance instead
    // of failing opaquely.
    for (const endpoint of ['/savedsearch/', '/saved-search/', '/search/']) {
      const res = await ApiClient.highergovGet(endpoint, { page_size: 100 }, apiKey);
      if (res.success) {
        const list = resultArray(res.data);
        if (list.length > 0 || endpoint !== '/search/') {
          return {
            results: list.map((s: any) => ({
              saved_search_id: String(s.search_id ?? s.saved_search_id ?? s.id ?? s.key ?? ''),
              name: String(s.name ?? s.title ?? s.search_name ?? ''),
              type: s.search_type ?? s.type ?? null,
            })),
            source_endpoint: endpoint,
            next_cursor: highergovNextCursor(res.data),
          };
        }
      } else if (upstreamStatus(res.error) === 401 || upstreamStatus(res.error) === 403) {
        return classifyUpstreamError(res.error);
      }
    }
    return errorResponse(
      'not_found',
      'The HigherGov API does not expose a saved-search listing for this account. Find the ID in the HigherGov UI: Saved Searches → open a search → the search_id is in the URL. Pass it to search_highergov_forecasts.'
    );
  },

  async getOpportunityDocuments(args: any) {
    const apiKey = getApiKey(args);
    if (!args.id) return errorResponse('bad_request', 'id is required');

    const opportunity: any = await this.getOpportunity(args);
    if (opportunity?.error) return opportunity;

    const documents: any[] = (opportunity.attachments ?? []).map((a: any) => ({ ...a, source: 'opportunity' }));
    const warnings: string[] = [];

    // Enrich from the document endpoint (HigherGov indexes RFP documents
    // separately from the notice record). Per the OpenAPI spec, /document/
    // takes a required `related_key` ("Document Key") and returns FileTracker
    // records {file_name, file_type, file_size, posted_date, summary,
    // download_url}. The opportunity's opp_key is the best-guess related key;
    // whether it is accepted is unverified against a live response.
    const relatedKey = String(opportunity.opportunity_id || extractId(String(args.id)));
    const res = await ApiClient.highergovGet(
      '/document/',
      { related_key: relatedKey, page_size: 100 },
      apiKey
    );
    if (res.success) {
      for (const doc of resultArray(res.data)) {
        const url = String(doc.download_url ?? doc.url ?? '');
        if (url && !documents.some(d => d.url === url)) {
          documents.push({
            name: String(doc.file_name ?? doc.name ?? ''),
            url,
            mime_type: doc.file_type ?? doc.mime_type ?? null,
            size_bytes: typeof doc.file_size === 'number' ? doc.file_size : null,
            posted_date: toIsoOrNull(doc.posted_date ?? null),
            summary: doc.summary ?? null,
            source: 'document_index',
          });
        }
      }
    } else {
      warnings.push('Document-index lookup failed; listing only the attachments on the notice itself.');
    }

    return {
      opportunity_id: opportunity.opportunity_id,
      sam_notice_id: opportunity.sam_notice_id,
      title: opportunity.title,
      documents,
      ...(warnings.length ? { warnings } : {}),
    };
  },
};
