import type { Tool, ToolAnnotations } from '@modelcontextprotocol/server';

// What every tool declares beyond its name and input schema: a title, annotations and the shape of
// its result. The catalog applies it, so the tool modules only define behaviour.

type JsonObjectSchema = NonNullable<Tool['outputSchema']>;

const WORDS: Record<string, string> = {
  sam: 'SAM.gov',
  usaspending: 'USASpending',
  tango: 'Tango',
  highergov: 'HigherGov',
  idv: 'IDV',
  idvs: 'IDVs',
  otas: 'OTAs',
  uei: 'UEI',
  fpds: 'FPDS',
};

/** `search_tango_contracts` becomes "Search Tango Contracts". */
export function toolTitle(name: string): string {
  return name
    .split('_')
    .map(word => WORDS[word] ?? word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * Every tool only reads: it queries a public or key-gated API and changes nothing. All but the static
 * reference lookup reach out to a third party.
 */
export function toolAnnotations(name: string): ToolAnnotations {
  return { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: name !== 'lookup_reference_code' };
}

const ERROR_ENVELOPE = {
  description:
    'Present when the tool could not do what was asked: a message, or an object with a stable `code` ' +
    '(bad_request, not_found, upstream_error, ...) and a `message`. The call is then marked isError.',
  oneOf: [
    { type: 'string' },
    {
      type: 'object',
      properties: { code: { type: 'string' }, message: { type: 'string' } },
      required: ['code', 'message'],
      additionalProperties: true,
    },
  ],
} as const;

const WARNINGS = {
  type: 'array',
  items: { type: 'string' },
  description: 'Caveats about this result, for example a filter the upstream did not honor.',
} as const;

/** The list tools that build their result with `listEnvelope` (utils/envelope.ts), and the key holding their rows. */
const LIST_RESULT_KEY: Record<string, string> = {
  search_usaspending_awards_by_recipient: 'awards',
  search_tango_contracts: 'contracts',
  search_tango_grants: 'grants',
  search_tango_opportunities: 'opportunities',
  search_highergov_forecasts: 'results',
  search_highergov_contracts: 'results',
  search_highergov_people: 'results',
  search_highergov_opportunities: 'results',
};

/**
 * The result of a successful call. Rows and nested records are not described: their fields come
 * from the upstream APIs and change with them. The envelope around them is stable, so list tools
 * require it and the other tools describe only what every result shares.
 */
export function outputSchemaFor(name: string): JsonObjectSchema {
  const rows = LIST_RESULT_KEY[name];
  if (!rows) {
    return {
      type: 'object',
      properties: { error: ERROR_ENVELOPE, warnings: WARNINGS },
      additionalProperties: true,
    };
  }
  return {
    type: 'object',
    properties: {
      [rows]: { type: 'array', description: 'This page of records, as the upstream returned them.' },
      total: { type: ['number', 'null'], description: 'The upstream total, or null when it is not trustworthy for this query (see warnings).' },
      count_unit: { type: 'string', description: 'What `total` and the page size count.' },
      filters: {
        type: 'object',
        description: 'The filters applied, split into those the upstream applied and those applied here, on this page only.',
        properties: { upstream: { type: 'object' }, client_side: { type: 'object' } },
        required: ['upstream', 'client_side'],
      },
      next_cursor: { type: ['string', 'null'], description: 'Pass as `cursor` for the next page; null on the last page.' },
      date_field: { type: 'string', description: 'The date the date filters apply to.' },
      warnings: WARNINGS,
      error: ERROR_ENVELOPE,
    },
    required: [rows, 'total', 'count_unit', 'filters', 'next_cursor'],
    additionalProperties: true,
  };
}

/**
 * Tools report failure in the result as a top-level `error` (a message or `{code, message}`), not by
 * throwing. Partial results, which carry `*_error` fields beside data, are not failures.
 */
export function isToolFailure(result: Record<string, unknown>): boolean {
  return result.error !== undefined && result.error !== null;
}

export function withMetadata(tool: Tool): Tool {
  return { ...tool, title: toolTitle(tool.name), annotations: toolAnnotations(tool.name), outputSchema: outputSchemaFor(tool.name) };
}
