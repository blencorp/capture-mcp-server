import test from 'node:test';
import assert from 'node:assert/strict';
import { initializeTools, callTool, validateToolArgs } from './index.js';
import { ApiClient } from '../utils/api-client.js';

const CONFIG = {
  hasSamApiKey: false,
  hasTangoApiKey: true,
  hasHigherGovApiKey: true,
};

test('unknown parameters are rejected with the accepted list, not silently ignored', async () => {
  await initializeTools(CONFIG);
  const out: any = await callTool('search_tango_contracts', { award_minimum: 1000000 });
  assert.equal(out.error.code, 'bad_request');
  assert.match(out.error.message, /Unknown parameter\(s\).*award_minimum/);
  assert.match(out.error.message, /award_amount_min/);
});

test('missing required parameters are rejected', async () => {
  await initializeTools(CONFIG);
  const out: any = await callTool('get_highergov_contract', {});
  assert.equal(out.error.code, 'bad_request');
  assert.match(out.error.message, /Missing required parameter\(s\).*id/);
});

test('type mismatches are rejected', async () => {
  await initializeTools(CONFIG);
  const out: any = await callTool('search_tango_contracts', { limit: 'ten' });
  assert.equal(out.error.code, 'bad_request');
  assert.match(out.error.message, /"limit".*must be a number/);
});

test('valid args flow through to the tool (with header key injection)', async () => {
  await initializeTools(CONFIG);
  const original = ApiClient.tangoGet;
  let seenKey: string | undefined;
  (ApiClient as any).tangoGet = async (_e: string, _p: any, apiKey: string) => {
    seenKey = apiKey;
    return { success: true, data: { count: 0, next: null, results: [] } };
  };
  try {
    const out: any = await callTool('search_tango_contracts', { agency: '3600' }, { tangoKey: 'header-key' });
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
  const tools = await initializeTools({ hasSamApiKey: true, hasTangoApiKey: true, hasHigherGovApiKey: true });
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
