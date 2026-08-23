// Standard list-response envelope (design conventions from docs/fix-plan.md):
//  - every applied filter is echoed, split into upstream vs client_side;
//  - `total` is only populated when it is trustworthy: any client-side filter
//    nulls it (the upstream total does not reflect the filtering) and the raw
//    number moves to total_upstream_unfiltered with a warning;
//  - counts state their unit, date filters state their date field;
//  - one cursor shape: next_cursor, null when the last page is reached.

export interface FilterEcho {
  upstream: Record<string, unknown>;
  client_side: Record<string, unknown>;
}

export interface ListEnvelopeInput {
  resourceKey: string;
  rows: unknown[];
  upstreamTotal: number | null | undefined;
  countUnit: string;
  dateField?: string;
  filters: FilterEcho;
  warnings?: string[];
  nextCursor: string | null;
  // Set when the upstream total is known-untrustworthy even without
  // client-side filtering (e.g. loose upstream matching). Forces total to null
  // and surfaces the raw number under total_upstream_unverified.
  distrustUpstreamTotal?: string;
}

// Client-side enforcement of a bound the upstream is not known to honor:
// drop rows that verifiably violate it, keep rows that cannot be verified
// (warning either way). Returns the surviving rows.
export function enforceClientBound(
  rows: any[],
  label: string,
  bound: unknown,
  getter: (row: any) => number | string | null,
  ok: (value: any, bound: any) => boolean,
  clientSide: Record<string, unknown>,
  warnings: string[]
): any[] {
  if (bound === undefined || bound === null || bound === '') return rows;
  const violating = rows.filter(r => {
    const v = getter(r);
    return v !== null && v !== undefined && v !== '' && !ok(v, bound);
  });
  const unverifiable = rows.filter(r => {
    const v = getter(r);
    return v === null || v === undefined || v === '';
  }).length;
  if (violating.length > 0) {
    clientSide[label] = bound;
    warnings.push(
      `Upstream did not honor ${label} (${violating.length} of ${rows.length} record(s) on this page violated it); it was applied client-side.`
    );
  }
  if (unverifiable > 0) {
    warnings.push(`${label}: ${unverifiable} record(s) lack the field needed to verify this filter and were kept.`);
  }
  return rows.filter(r => {
    const v = getter(r);
    return v === null || v === undefined || v === '' || ok(v, bound);
  });
}

export function listEnvelope(input: ListEnvelopeInput): Record<string, any> {
  const warnings = [...(input.warnings ?? [])];
  const clientFiltered = Object.keys(input.filters.client_side).length > 0;
  const upstreamTotal = input.upstreamTotal ?? null;

  const out: Record<string, any> = {
    [input.resourceKey]: input.rows,
    total: upstreamTotal,
    count_unit: input.countUnit,
    filters: input.filters,
    next_cursor: input.nextCursor,
  };
  if (input.dateField) out.date_field = input.dateField;

  if (input.distrustUpstreamTotal) {
    out.total = null;
    out.total_upstream_unverified = upstreamTotal;
    warnings.push(input.distrustUpstreamTotal);
  } else if (clientFiltered) {
    out.total = null;
    out.total_upstream_unfiltered = upstreamTotal;
    warnings.push(
      'Client-side filters were applied to this page only, so `total` is null: the upstream total does not reflect them. Page through next_cursor to enumerate matches.'
    );
  }

  if (warnings.length) out.warnings = [...new Set(warnings)];
  return out;
}
