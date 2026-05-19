// Slug normalization for HigherGov responses.
// HigherGov returns inconsistent casing/long names; BD-Brain expects stable lowercase slugs.
// Unknown values pass through normalized (lowercased, hyphenated) and a warning is logged.

const AGENCY_MAP: Record<string, string> = {
  'department of veterans affairs': 'va',
  'veterans affairs': 'va',
  'veterans health administration': 'vha',
  'u.s. patent and trademark office': 'uspto',
  'patent and trademark office': 'uspto',
  'department of agriculture': 'usda',
  'department of health and human services': 'hhs',
  'health and human services': 'hhs',
  'general services administration': 'gsa',
  'department of the interior': 'doi',
  'department of defense': 'dod',
  'department of homeland security': 'dhs',
  'department of justice': 'doj',
  'department of state': 'dos',
  'department of the treasury': 'treasury',
  'department of energy': 'doe',
  'department of education': 'ed',
  'department of labor': 'dol',
  'department of transportation': 'dot',
  'department of commerce': 'doc',
  'social security administration': 'ssa',
  'national aeronautics and space administration': 'nasa',
  'environmental protection agency': 'epa',
  'small business administration': 'sba',
};

const VEHICLE_MAP: Record<string, string> = {
  'seaport nxg': 'seaport-nxg',
  'seaport-nxg': 'seaport-nxg',
  't4ng': 't4ng',
  'oasis+': 'oasis-plus',
  'oasis plus': 'oasis-plus',
  'gsa mas': 'gsa-mas',
  'gsa multiple award schedule': 'gsa-mas',
  'multiple award schedule': 'gsa-mas',
  'cio-sp3': 'cio-sp3',
  'cio-sp4': 'cio-sp4',
  'alliant 2': 'alliant-2',
};

const SET_ASIDE_MAP: Record<string, string> = {
  'service-disabled veteran-owned small business': 'sdvosb',
  'sdvosb': 'sdvosb',
  'sdvosbc': 'sdvosb',
  '8(a)': '8a',
  '8a': '8a',
  '8(a) competitive': '8a',
  '8a competitive': '8a',
  '8(a) sole source': '8a',
  '8a sole source': '8a',
  'hubzone': 'hubzone',
  'historically underutilized business zone': 'hubzone',
  'woman-owned small business': 'wosb',
  'wosb': 'wosb',
  'economically disadvantaged woman-owned small business': 'edwosb',
  'edwosb': 'edwosb',
  'small business set-aside': 'small-business',
  'total small business': 'small-business',
  'total small business set-aside': 'small-business',
  'small business': 'small-business',
  'full and open': 'full_and_open',
  'unrestricted': 'full_and_open',
};

function warnUnknown(kind: string, value: string): void {
  if (process.env.DEBUG) {
    console.error(`[highergov-slugs] unknown ${kind}: "${value}" — add to map`);
  }
}

function fallbackSlug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// HigherGov sometimes returns these as nested objects ({name: 'DoD', code: '9700'}),
// numbers, or other non-string truthy shapes. coerce here so the normalizers don't
// call .trim() on a non-string and blow up the whole response.
function coerceToString(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'string') return raw;
  if (typeof raw === 'number') return Number.isFinite(raw) ? String(raw) : null;
  if (typeof raw === 'boolean') return null;
  if (Array.isArray(raw)) {
    const first = raw.find(v => typeof v === 'string' && v.trim());
    return typeof first === 'string' ? first : null;
  }
  if (typeof raw === 'object') {
    const obj = raw as Record<string, unknown>;
    for (const key of ['name', 'label', 'display_name', 'value', 'agency_name', 'agency']) {
      const v = obj[key];
      if (typeof v === 'string' && v.trim()) return v;
    }
  }
  return null;
}

// Null means the source field was absent. Non-empty unknown values intentionally
// return a fallback slug so consumers keep a stable, display-safe value.
export function normalizeAgency(raw: string): string;
export function normalizeAgency(raw?: unknown): string | null;
export function normalizeAgency(raw?: unknown): string | null {
  const s = coerceToString(raw);
  if (!s) return null;
  const key = s.trim().toLowerCase();
  if (!key) return null;
  if (AGENCY_MAP[key]) return AGENCY_MAP[key];
  warnUnknown('agency', s);
  return fallbackSlug(s);
}

export function normalizeVehicle(raw: string): string;
export function normalizeVehicle(raw?: unknown): string | null;
export function normalizeVehicle(raw?: unknown): string | null {
  const s = coerceToString(raw);
  if (!s) return null;
  const key = s.trim().toLowerCase();
  if (!key) return null;
  if (VEHICLE_MAP[key]) return VEHICLE_MAP[key];
  warnUnknown('vehicle', s);
  return fallbackSlug(s);
}

export function normalizeSetAside(raw: string): string;
export function normalizeSetAside(raw?: unknown): string | null;
export function normalizeSetAside(raw?: unknown): string | null {
  const s = coerceToString(raw);
  if (!s) return null;
  const key = s.trim().toLowerCase();
  if (!key) return null;
  if (SET_ASIDE_MAP[key]) return SET_ASIDE_MAP[key];
  warnUnknown('set_aside', s);
  return fallbackSlug(s);
}

export function toIsoOrNull(raw?: string | null): string | null {
  if (!raw) return null;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

export function toUsdInteger(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === '') return null;
  const n = typeof raw === 'number' ? raw : Number(String(raw).replace(/[$,]/g, ''));
  if (!Number.isFinite(n)) return null;
  return Math.round(n);
}

export function truncate(text: string | null | undefined, max: number): string {
  if (!text) return '';
  return text.length > max ? text.slice(0, max - 1) + '…' : text;
}

// HigherGov returns codes as either bare strings, comma-separated strings,
// arrays of either, or objects like {naics_code: '238220'} / {psc_code: 'X'}.
// Coalesce all those shapes into a clean string[].
export function asStringArray(raw: unknown): string[] {
  if (raw === null || raw === undefined || raw === '') return [];
  if (Array.isArray(raw)) {
    return raw.flatMap(v => asStringArray(v));
  }
  if (typeof raw === 'object') {
    const obj = raw as Record<string, unknown>;
    for (const key of ['naics_code', 'psc_code', 'code', 'value', 'name']) {
      const v = obj[key];
      if (typeof v === 'string' && v.trim()) return [v.trim()];
      if (typeof v === 'number') return [String(v)];
    }
    return [];
  }
  return String(raw).split(/[,;\s]+/).map(s => s.trim()).filter(Boolean);
}
