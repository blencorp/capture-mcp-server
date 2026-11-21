import test from 'node:test';
import assert from 'node:assert/strict';
import { ToolCatalog, validateToolArgs } from './index.js';
import { ApiClient } from '../utils/api-client.js';

const CONFIG = {
  hasSamApiKey: false,
  hasTangoApiKey: true,
  hasHigherGovApiKey: true,
};

test('unknown parameters are rejected with the accepted list, not silently ignored', async () => {
  const catalog = await ToolCatalog.create(CONFIG);
  const out: any = await catalog.call('search_tango_contracts', { award_minimum: 1000000 });
  assert.equal(out.error.code, 'bad_request');
  assert.match(out.error.message, /Unknown parameter\(s\).*award_minimum/);
  assert.match(out.error.message, /award_amount_min/);
});

test('missing required parameters are rejected', async () => {
  const catalog = await ToolCatalog.create(CONFIG);
  const out: any = await catalog.call('get_highergov_contract', {});
  assert.equal(out.error.code, 'bad_request');
  assert.match(out.error.message, /Missing required parameter\(s\).*id/);
});

test('type mismatches are rejected', async () => {
  const catalog = await ToolCatalog.create(CONFIG);
  const out: any = await catalog.call('search_tango_contracts', { limit: 'ten' });
  assert.equal(out.error.code, 'bad_request');
  assert.match(out.error.message, /"limit".*must be a number/);
});

test('valid args flow through to the tool (with header key injection)', async () => {
  const catalog = await ToolCatalog.create(CONFIG);
  const original = ApiClient.tangoGet;
  let seenKey: string | undefined;
  (ApiClient as any).tangoGet = async (_e: string, _p: any, apiKey: string) => {
    seenKey = apiKey;
    return { success: true, data: { count: 0, next: null, results: [] } };
  };
  try {
    const out: any = await catalog.call('search_tango_contracts', { agency: '3600' }, { tangoKey: 'header-key' });
    assert.equal(out.error, undefined);
    assert.equal(seenKey, 'header-key');
    assert.equal(out.total, 0);
  } finally {
    (ApiClient as any).tangoGet = original;
  }
});

test('validateToolArgs allows api_key even when the schema omits it, and union-typed props', () => {
  const tool: any = {
    name: 'x',
    inputSchema: {
      type: 'object',
      properties: {
        set_aside: { anyOf: [{ type: 'string' }, { type: 'array' }] },
      },
      required: [],
    },
  };
  assert.equal(validateToolArgs(tool, { api_key: 'k', set_aside: ['8AN'] }), null);
  assert.equal(validateToolArgs(tool, { api_key: 'k', set_aside: '8AN' }), null);
  assert.match(validateToolArgs(tool, { nope: 1 })!, /Unknown parameter/);
});

test('every registered tool has a well-formed schema for the validator', async () => {
  const { tools } = await ToolCatalog.create({ hasSamApiKey: true, hasTangoApiKey: true, hasHigherGovApiKey: true });
  assert.ok(tools.length >= 21, `expected at least 21 tools, got ${tools.length}`);
  for (const tool of tools) {
    const schema: any = tool.inputSchema;
    assert.equal(schema.type, 'object', `${tool.name} schema must be an object schema`);
    assert.ok(schema.properties, `${tool.name} schema must declare properties`);
    // required keys must exist in properties, or the validator would reject every call
    for (const req of schema.required ?? []) {
      assert.ok(schema.properties[req], `${tool.name} requires undeclared property ${req}`);
    }
  }
});

test('catalogs are request-local: building one never changes another', async () => {
  const withTango = await ToolCatalog.create({ hasSamApiKey: false, hasTangoApiKey: true, hasHigherGovApiKey: false });
  const publicOnly = await ToolCatalog.create({ hasSamApiKey: false, hasTangoApiKey: false, hasHigherGovApiKey: false });
  assert.ok(withTango.tools.some(tool => tool.name === 'search_tango_contracts'));
  assert.ok(!publicOnly.tools.some(tool => tool.name === 'search_tango_contracts'));
  // The older module-level registry was cleared by the second build, breaking the first caller.
  const out: any = await withTango.call('search_tango_contracts', { limit: 'ten' });
  assert.equal(out.error.code, 'bad_request');
  await assert.rejects(publicOnly.call('search_tango_contracts', {}), /not found/);
});

test('a tool only receives the key for its own provider', async () => {
  const catalog = await ToolCatalog.create({ hasSamApiKey: false, hasTangoApiKey: true, hasHigherGovApiKey: true });
  const original = ApiClient.tangoGet;
  let seenKey: string | undefined;
  (ApiClient as any).tangoGet = async (_e: string, _p: any, apiKey: string) => {
    seenKey = apiKey;
    return { success: true, data: { count: 0, next: null, results: [] } };
  };
  try {
    process.env.TANGO_API_KEY = 'operator-tango';
    await assert.rejects(
      catalog.call('search_tango_contracts', { agency: '3600' }, { higherGovKey: 'hg-key' }),
      /Tango API key is required/,
    );
    assert.equal(seenKey, undefined, 'neither the HigherGov key nor the environment key may reach Tango');
  } finally {
    (ApiClient as any).tangoGet = original;
    delete process.env.TANGO_API_KEY;
  }
});
