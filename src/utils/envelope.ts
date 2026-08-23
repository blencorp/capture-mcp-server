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
