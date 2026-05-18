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
      message: message.slice(0, 200),
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

function shouldTryLookupFallback(err: string | undefined): boolean {
  const status = upstreamStatus(err);
  return status === 400 || status === 404;
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

// ---- Normalizers (response shaping) ----

function normalizeForecast(raw: any) {
  return {
    forecast_id: String(raw.forecast_id ?? raw.id ?? raw.opportunity_key ?? ''),
    title: String(raw.title ?? raw.name ?? ''),
    agency: normalizeAgency(raw.agency_name ?? raw.agency ?? raw.awarding_agency_name),
    sub_agency: normalizeAgency(raw.sub_agency_name ?? raw.sub_agency ?? null),
    naics: asStringArray(raw.naics_code ?? raw.naics),
    psc: asStringArray(raw.psc_code ?? raw.psc),
    set_aside: normalizeSetAside(raw.set_aside ?? raw.type_of_set_aside ?? null),
    vehicle: normalizeVehicle(raw.contract_vehicle ?? raw.vehicle ?? null),
    estimated_value: toUsdInteger(raw.estimated_value ?? raw.estimated_contract_value),
    estimated_solicitation_date: toIsoOrNull(raw.estimated_solicitation_date ?? raw.solicitation_date),
    estimated_award_date: toIsoOrNull(raw.estimated_award_date ?? raw.award_date),
    description: truncate(String(raw.description ?? raw.summary ?? ''), 2000),
    source_url: String(raw.source_url ?? raw.path ?? raw.url ?? ''),
  };
}

function normalizeOpportunity(raw: any) {
  return {
    opportunity_id: String(raw.opportunity_key ?? raw.opportunity_id ?? raw.id ?? ''),
    sam_notice_id: raw.sam_notice_id ?? raw.notice_id ?? null,
    type: String(raw.opportunity_type ?? raw.notice_type ?? raw.type ?? '').toLowerCase() || 'solicitation',
    title: String(raw.title ?? ''),
    agency: normalizeAgency(raw.agency_name ?? raw.agency),
    sub_agency: normalizeAgency(raw.sub_agency_name ?? raw.sub_agency ?? null),
    office: raw.office_name ?? raw.office ?? null,
    naics: asStringArray(raw.naics_code ?? raw.naics),
    psc: asStringArray(raw.psc_code ?? raw.psc),
    set_aside: normalizeSetAside(raw.set_aside ?? null),
    vehicle: normalizeVehicle(raw.contract_vehicle ?? raw.vehicle ?? null),
    estimated_value: toUsdInteger(raw.estimated_value ?? raw.award_amount),
    posted_date: toIsoOrNull(raw.posted_date ?? raw.published_date),
    response_deadline: toIsoOrNull(raw.response_date ?? raw.response_deadline),
    estimated_award_date: toIsoOrNull(raw.estimated_award_date ?? raw.award_date),
    description: String(raw.description ?? raw.summary ?? ''),
    attachments: Array.isArray(raw.attachments)
      ? raw.attachments.map((a: any) => ({
          name: String(a.name ?? a.filename ?? ''),
          url: String(a.url ?? a.download_url ?? ''),
          mime_type: a.mime_type ?? a.content_type ?? null,
          size_bytes: typeof a.size === 'number' ? a.size : a.size_bytes ?? null,
        }))
      : [],
    incumbent_contract_id: raw.incumbent_contract_id ?? raw.related_contract_key ?? null,
    source_url: String(raw.source_url ?? raw.path ?? raw.url ?? ''),
  };
}

function normalizeContractSummary(raw: any) {
  return {
    contract_id: String(raw.contract_id ?? raw.key ?? raw.id ?? ''),
    piid: String(raw.piid ?? raw.award_id_piid ?? ''),
    title: String(raw.title ?? raw.description ?? ''),
    incumbent_name: String(raw.recipient_name ?? raw.vendor_name ?? raw.recipient?.name ?? ''),
    incumbent_uei: raw.recipient_uei ?? raw.recipient?.uei ?? null,
    agency: normalizeAgency(raw.awarding_agency_name ?? raw.agency_name ?? raw.agency),
    sub_agency: normalizeAgency(raw.awarding_sub_agency_name ?? raw.sub_agency_name ?? null),
    naics: asStringArray(raw.naics_code ?? raw.naics),
    psc: asStringArray(raw.psc_code ?? raw.psc),
    set_aside: normalizeSetAside(raw.set_aside ?? null),
    vehicle: normalizeVehicle(raw.contract_vehicle ?? raw.vehicle ?? null),
    value: toUsdInteger(raw.total_contract_value ?? raw.value ?? raw.obligated) ?? 0,
    pop_start: toIsoOrNull(raw.period_of_performance_start ?? raw.pop_start),
    pop_end: toIsoOrNull(raw.period_of_performance_end ?? raw.pop_end),
    source_url: String(raw.source_url ?? raw.path ?? raw.url ?? ''),
  };
}

function normalizeContractFull(raw: any) {
  const base = normalizeContractSummary(raw);
  return {
    ...base,
    description: raw.description ?? null,
    incumbent_size: raw.recipient_business_size ?? raw.recipient_size ?? null,
    office: raw.office_name ?? null,
    obligated_value: toUsdInteger(raw.obligated_value ?? raw.obligated),
    option_periods: Array.isArray(raw.option_periods)
      ? raw.option_periods.map((p: any) => ({
          label: String(p.label ?? p.name ?? ''),
          exercised: Boolean(p.exercised),
          start: toIsoOrNull(p.start ?? p.start_date),
          end: toIsoOrNull(p.end ?? p.end_date),
        }))
      : [],
    modifications: Number(raw.modification_count ?? raw.modifications ?? 0),
    cpars_score: raw.cpars_rating ?? raw.cpars_score ?? null,
    protests: Number(raw.protest_count ?? raw.protests ?? 0),
  };
}

function normalizePersonSummary(raw: any) {
  return {
    person_id: String(raw.person_id ?? raw.id ?? raw.key ?? ''),
    name: String(raw.name ?? raw.full_name ?? ''),
    title: String(raw.title ?? raw.position ?? ''),
    agency: normalizeAgency(raw.agency_name ?? raw.agency),
    sub_agency: normalizeAgency(raw.sub_agency_name ?? null),
    office: raw.office_name ?? raw.office ?? null,
    verified_email: raw.verified_email ?? raw.email_verified ?? null,
    source_url: String(raw.source_url ?? raw.path ?? raw.url ?? ''),
  };
}

function normalizePersonFull(raw: any) {
  return {
    ...normalizePersonSummary(raw),
    phone: raw.phone ?? null,
    bio: truncate(raw.bio ?? raw.biography ?? '', 1000) || null,
    recent_activity: Array.isArray(raw.recent_activity)
      ? raw.recent_activity.slice(0, 10).map((a: any) => ({
          date: toIsoOrNull(a.date ?? a.activity_date) ?? '',
          kind: String(a.kind ?? a.activity_type ?? ''),
          summary: String(a.summary ?? a.description ?? ''),
          url: a.url ?? null,
        }))
      : [],
  };
}

function resultArray(raw: any): any[] {
  const list = raw?.results ?? raw?.data ?? [];
  return Array.isArray(list) ? list : [];
}

function pageNumberFromCursor(cursor: unknown): string | null {
  if (cursor === null || cursor === undefined) return null;
  const text = String(cursor).trim();
  if (!text) return null;

  try {
    const url = new URL(text, 'https://www.highergov.com');
    return url.searchParams.get('page_number') ?? url.searchParams.get('page') ?? text;
  } catch {
    return text;
  }
}

function applyPageCursor(params: Record<string, any>, cursor: unknown): void {
  const pageNumber = pageNumberFromCursor(cursor);
  if (pageNumber) params.page_number = pageNumber;
}

// HigherGov endpoints return a `next` URL with page_number. Surface only that token.
function nextCursor(raw: any): string | null {
  return pageNumberFromCursor(raw?.next ?? raw?.next_cursor ?? null);
}

// ---- Tool surface ----

export const highergovTools = {
  async getTools(): Promise<Tool[]> {
    return [
      {
        name: 'search_highergov_forecasts',
        description:
          'Pull forecasts matching a HigherGov saved search. Returns the paginated list of new or updated forecasts since `since` (default: last 24 hours). Use `next_cursor` to page.',
        inputSchema: {
          type: 'object',
          properties: {
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
            id: { type: 'string', description: 'HigherGov opportunity ID, SAM notice ID, or HigherGov URL' },
          },
          required: ['id'],
        },
      },
      {
        name: 'search_highergov_contracts',
        description:
          'Search awarded federal contracts by agency, NAICS, PSC, period-of-performance end-date range, and value bounds. Use to find recompete candidates 12–18 months ahead of PoP end. At least one of agency/naics/psc is required.',
        inputSchema: {
          type: 'object',
          properties: {
            agency: { type: 'string', description: 'Agency slug or name' },
            naics: { type: 'array', items: { type: 'string' } },
            psc: { type: 'array', items: { type: 'string' } },
            pop_end_after: { type: 'string', description: 'ISO-8601 date' },
            pop_end_before: { type: 'string', description: 'ISO-8601 date' },
            min_value: { type: 'number', description: 'USD' },
            max_value: { type: 'number', description: 'USD' },
            limit: { type: 'number', description: 'Default 50, max 200' },
            cursor: { type: 'string', description: 'Page number from prior next_cursor' },
          },
          required: [],
        },
      },
      {
        name: 'get_highergov_contract',
        description:
          'Get full record for one contract by HigherGov contract ID or PIID. Returns incumbent, dates, value, set-aside, vehicle, option-period status, CPARS, and protest count.',
        inputSchema: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'HigherGov contract ID or PIID' },
          },
          required: ['id'],
        },
      },
      {
        name: 'search_highergov_people',
        description:
          'Search federal POCs by agency and optional role keywords. Use to find named individuals for outreach. `verified_email` may be null — if absent, do not draft outreach.',
        inputSchema: {
          type: 'object',
          properties: {
            agency: { type: 'string', description: 'Agency slug or name (required)' },
            sub_agency: { type: 'string' },
            role_keywords: { type: 'array', items: { type: 'string' } },
            limit: { type: 'number', description: 'Default 20, max 100' },
            cursor: { type: 'string', description: 'Page number from prior next_cursor' },
          },
          required: ['agency'],
        },
      },
      {
        name: 'get_highergov_person',
        description:
          'Get the full profile for one POC, including verified email and recent activity (forecasts, awards, speaking engagements). Use as the source for the opening hook in cold outreach. If `verified_email` is null, refuse to draft.',
        inputSchema: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'HigherGov person ID' },
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

    const params: Record<string, any> = {
      search_id: args.saved_search_id,
      modified_since: since,
      page_size: limit,
    };
    applyPageCursor(params, args.cursor);

    const res: ApiResponse = await ApiClient.highergovGet('/opportunity/', params, apiKey);
    if (!res.success) return classifyUpstreamError(res.error);

    const list = resultArray(res.data);
    return {
      results: list.map(normalizeForecast),
      next_cursor: nextCursor(res.data),
    };
  },

  async getOpportunity(args: any) {
    const apiKey = getApiKey(args);
    if (!args.id) return errorResponse('bad_request', 'id is required');

    const id = extractId(String(args.id));
    const cacheKey = buildCacheKey('opportunity', id, apiKey);
    const cached = cacheGet(cacheKey);
    if (cached) return cached;

    // Try as HigherGov opportunity_key first; if that fails, try as source/SAM notice id.
    let res = await ApiClient.highergovGet(`/opportunity/${encodeURIComponent(id)}/`, {}, apiKey);
    if (!res.success) {
      if (!shouldTryLookupFallback(res.error)) {
        return classifyUpstreamError(res.error);
      }

      const fallback = await ApiClient.highergovGet('/opportunity/', { source_id: id, page_size: 1 }, apiKey);
      if (!fallback.success) return classifyUpstreamError(fallback.error);

      const fallbackList = resultArray(fallback.data);
      if (fallbackList.length > 0) {
        const result = normalizeOpportunity(fallbackList[0]);
        cacheSet(cacheKey, result);
        return result;
      }

      return errorResponse('not_found', 'Resource not found');
    }

    const result = normalizeOpportunity(res.data?.result ?? res.data);
    cacheSet(cacheKey, result);
    return result;
  },

  async searchContracts(args: any) {
    const apiKey = getApiKey(args);

    const naics = asStringArray(args.naics);
    const psc = asStringArray(args.psc);
    if (!args.agency && naics.length === 0 && psc.length === 0) {
      return errorResponse('bad_request', 'At least one of agency, naics, or psc is required');
    }

    const limit = Math.min(Math.max(Number(args.limit) || 50, 1), 200);
    const params: Record<string, any> = { page_size: limit };
    if (args.agency) params.agency_name = args.agency;
    if (naics.length) params.naics_code = naics.join(',');
    if (psc.length) params.psc_code = psc.join(',');
    if (args.pop_end_after) params.pop_end_after = args.pop_end_after;
    if (args.pop_end_before) params.pop_end_before = args.pop_end_before;
    if (args.min_value !== undefined) params.min_value = args.min_value;
    if (args.max_value !== undefined) params.max_value = args.max_value;
    applyPageCursor(params, args.cursor);

    const res = await ApiClient.highergovGet('/contract/', params, apiKey);
    if (!res.success) return classifyUpstreamError(res.error);

    const list = resultArray(res.data);
    return {
      results: list.map(normalizeContractSummary),
      next_cursor: nextCursor(res.data),
    };
  },

  async getContract(args: any) {
    const apiKey = getApiKey(args);
    if (!args.id) return errorResponse('bad_request', 'id is required');

    const id = extractId(String(args.id));
    const cacheKey = buildCacheKey('contract', id, apiKey);
    const cached = cacheGet(cacheKey);
    if (cached) return cached;

    let res = await ApiClient.highergovGet(`/contract/${encodeURIComponent(id)}/`, {}, apiKey);
    if (!res.success) {
      if (!shouldTryLookupFallback(res.error)) {
        return classifyUpstreamError(res.error);
      }

      const fallback = await ApiClient.highergovGet('/contract/', { award_id: id, page_size: 1 }, apiKey);
      if (!fallback.success) return classifyUpstreamError(fallback.error);

      const fallbackList = resultArray(fallback.data);
      if (fallbackList.length > 0) {
        const result = normalizeContractFull(fallbackList[0]);
        cacheSet(cacheKey, result);
        return result;
      }

      return errorResponse('not_found', 'Resource not found');
    }

    const result = normalizeContractFull(res.data?.result ?? res.data);
    cacheSet(cacheKey, result);
    return result;
  },

  async searchPeople(args: any) {
    const apiKey = getApiKey(args);
    if (!args.agency) return errorResponse('bad_request', 'agency is required');

    const limit = Math.min(Math.max(Number(args.limit) || 20, 1), 100);
    const params: Record<string, any> = { agency_name: args.agency, page_size: limit };
    if (args.sub_agency) params.sub_agency_name = args.sub_agency;
    const roleKeywords = asStringArray(args.role_keywords);
    if (roleKeywords.length) params.search = roleKeywords.join(' ');
    applyPageCursor(params, args.cursor);

    const res = await ApiClient.highergovGet('/people/', params, apiKey);
    if (!res.success) return classifyUpstreamError(res.error);

    const list = resultArray(res.data);
    return {
      results: list.map(normalizePersonSummary),
      next_cursor: nextCursor(res.data),
    };
  },

  async getPerson(args: any) {
    const apiKey = getApiKey(args);
    if (!args.id) return errorResponse('bad_request', 'id is required');

    const id = extractId(String(args.id));
    const cacheKey = buildCacheKey('person', id, apiKey);
    const cached = cacheGet(cacheKey);
    if (cached) return cached;

    const res = await ApiClient.highergovGet(`/people/${encodeURIComponent(id)}/`, {}, apiKey);
    if (!res.success) return classifyUpstreamError(res.error);

    const result = normalizePersonFull(res.data?.result ?? res.data);
    cacheSet(cacheKey, result);
    return result;
  },
};
