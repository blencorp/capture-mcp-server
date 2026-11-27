// What every tool returns, as top-level keys, when the upstream answers with an empty page and when
// it fails. The wire layer wraps these results (structuredContent, isError), so this pins the part
// the SDK port must not change: the tool result shapes themselves.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { fromJsonSchema, type JsonSchemaType } from '@modelcontextprotocol/server';

import { ToolCatalog } from './index.js';
import { isToolFailure } from './tool-metadata.js';
import { ApiClient } from '../utils/api-client.js';

type Tool = { name: string; inputSchema: { required?: string[]; properties: Record<string, { type?: string; enum?: string[] }> } };
const TOOLS: Tool[] = JSON.parse(readFileSync(new URL('../__fixtures__/tool-list.json', import.meta.url), 'utf8'));

const EMPTY_PAGE = {
  success: true,
  data: { results: [], count: 0, next: null, entityData: [], totalRecords: 0, opportunitiesData: [], page_metadata: { hasNext: false }, data: [], total_obligations: 0 },
};
const FAILURE = { success: false, data: null, error: 'upstream failed' };
const UPSTREAM_CALLS = ['samGet', 'usaspendingPost', 'usaspendingGet', 'tangoGet', 'tangoPost', 'highergovGet'] as const;

/** Minimal valid arguments: every required parameter filled from its schema. */
function minimalArgs(tool: Tool): Record<string, unknown> {
  const args: Record<string, unknown> = {};
  for (const key of tool.inputSchema.required ?? []) {
    const property = tool.inputSchema.properties[key]!;
    args[key] = property.enum?.[0] ?? (/date|posted/.test(key) ? '2024-01-01' : 'X1');
  }
  return args;
}

/** What each tool returns (or the message it throws) with every upstream call answered by `upstream`. */
async function results(upstream: typeof EMPTY_PAGE | typeof FAILURE): Promise<Map<string, { result?: Record<string, any>; throws?: string }>> {
  const originals = UPSTREAM_CALLS.map(name => [name, ApiClient[name]] as const);
  for (const name of UPSTREAM_CALLS) (ApiClient as any)[name] = async () => upstream;
  try {
    const catalog = await ToolCatalog.create({ hasSamApiKey: true, hasTangoApiKey: true, hasHigherGovApiKey: true });
    const keys = { samKey: 's', tangoKey: 't', higherGovKey: 'h' };
    const out = new Map<string, { result?: Record<string, any>; throws?: string }>();
    for (const tool of TOOLS) {
      out.set(tool.name, await catalog.call(tool.name, minimalArgs(tool), keys).then(result => ({ result }), (error: Error) => ({ throws: error.message })));
    }
    return out;
  } finally {
    for (const [name, original] of originals) (ApiClient as any)[name] = original;
  }
}

async function shapes(upstream: typeof EMPTY_PAGE | typeof FAILURE): Promise<Record<string, unknown>> {
  return Object.fromEntries(
    [...(await results(upstream))].map(([name, { result, throws }]) => [
      name,
      result === undefined
        ? { throws }
        : result.error === undefined
          ? { keys: Object.keys(result) }
          : { error: typeof result.error === 'string' ? 'string' : Object.keys(result.error), keys: Object.keys(result) },
    ]),
  );
}

test('every tool keeps its result shape for an empty upstream page and for an upstream failure', async () => {
  const expected = JSON.parse(readFileSync(new URL('../__fixtures__/tool-result-shapes.json', import.meta.url), 'utf8'));
  assert.deepEqual({ empty_page: await shapes(EMPTY_PAGE), upstream_failure: await shapes(FAILURE) }, expected);
});

test('every successful result conforms to its tool\'s outputSchema; failures carry an error', async () => {
  const catalog = await ToolCatalog.create({ hasSamApiKey: true, hasTangoApiKey: true, hasHigherGovApiKey: true });
  const outputSchemas = new Map(catalog.tools.map(tool => [tool.name, fromJsonSchema(tool.outputSchema as JsonSchemaType)]));
  let checked = 0;
  for (const [name, { result }] of [...(await results(EMPTY_PAGE)), ...(await results(FAILURE))]) {
    if (result === undefined || isToolFailure(result)) continue;
    const verdict = await outputSchemas.get(name)!['~standard'].validate(result);
    assert.equal(verdict.issues, undefined, `${name}: ${JSON.stringify(verdict.issues)}`);
    checked += 1;
  }
  assert.ok(checked > 20, `only ${checked} results were checked`);
  for (const [, { result }] of await results(FAILURE)) {
    if (result !== undefined && result.error === undefined) assert.ok(Object.keys(result).some(key => key.endsWith('_error')), JSON.stringify(result));
  }
});

test('the list tools declare their whole envelope as required', async () => {
  const catalog = await ToolCatalog.create({ hasSamApiKey: true, hasTangoApiKey: true, hasHigherGovApiKey: true });
  const required = (name: string) => catalog.tools.find(tool => tool.name === name)!.outputSchema?.required;
  assert.deepEqual(required('search_tango_contracts'), ['contracts', 'total', 'count_unit', 'filters', 'next_cursor']);
  assert.equal(required('get_tango_vendor_profile'), undefined);
});
