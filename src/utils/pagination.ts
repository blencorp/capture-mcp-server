// Shared cursor pagination helpers — one cursor shape for every list endpoint.
//
// Two upstream styles are handled:
//  - HigherGov: page-number pagination; the payload carries a `next` URL (or a
//    bare page number). The cursor we surface is the page number token.
//  - Tango: DRF-style `next` URL carrying the full query for the next page. The
//    cursor we surface is that URL, and on the way back in it is validated
//    against the Tango API origin before being followed.

export function pageNumberFromCursor(cursor: unknown): string | null {
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

export function applyPageCursor(params: Record<string, any>, cursor: unknown): void {
  const pageNumber = pageNumberFromCursor(cursor);
  if (pageNumber) params.page_number = pageNumber;
}

// Extract the next-page token from a HigherGov payload. HigherGov responses
// have carried the next link in more than one place across versions, so probe
// the known locations; page math is the last resort when only counts are given.
export function highergovNextCursor(raw: any): string | null {
  const candidates = [
    raw?.next,
    raw?.next_cursor,
    raw?.links?.next,
    raw?.pagination?.next,
    raw?.meta?.next,
    raw?.result_set?.next,
  ];
  for (const candidate of candidates) {
    const token = pageNumberFromCursor(candidate);
    if (token) return token;
  }

  // Page math fallback: {page_number, total_pages} or {count, page_size, page_number}.
  const container = raw?.pagination ?? raw?.meta ?? raw;
  const page = Number(container?.page_number ?? container?.page);
  const totalPages = Number(container?.total_pages ?? container?.num_pages);
  if (Number.isFinite(page) && Number.isFinite(totalPages) && page >= 1 && page < totalPages) {
    return String(page + 1);
  }
  return null;
}

export interface TangoCursorRequest {
  endpoint: string;
  params: Record<string, string>;
}

const TANGO_ORIGIN = 'https://tango.makegov.com';
const TANGO_API_PREFIX = '/api';

// Tango's `next` URL is used verbatim as the opaque cursor.
export function tangoNextCursor(raw: any): string | null {
  const next = raw?.next ?? raw?.links?.next ?? null;
  if (typeof next !== 'string' || !next.trim()) return null;
  return next.trim();
}

// Parse a cursor back into an endpoint + params, refusing anything that does
// not point at the Tango API (a cursor is caller-supplied input — never follow
// it to an arbitrary host).
export function parseTangoCursor(cursor: string): TangoCursorRequest {
  let url: URL;
  try {
    url = new URL(cursor);
  } catch {
    throw new Error('Invalid cursor: expected the next_cursor value returned by a previous call');
  }
  if (url.origin !== TANGO_ORIGIN || !url.pathname.startsWith(`${TANGO_API_PREFIX}/`)) {
    throw new Error('Invalid cursor: does not reference the Tango API');
  }
  const params: Record<string, string> = {};
  url.searchParams.forEach((value, key) => {
    params[key] = value;
  });
  return { endpoint: url.pathname.slice(TANGO_API_PREFIX.length), params };
}
