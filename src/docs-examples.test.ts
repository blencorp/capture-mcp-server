import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { ToolCatalog, validateToolArgs } from './tools/index.js';

// examples/*.json are the tool calls the documentation site shows on its "Example questions" page:
// { "tool": "<name>", "arguments": { ... } }. Each is checked against that tool's input schema with
// the validation the server applies to every call, so an example the server would refuse fails here.
const dir = new URL('../examples/', import.meta.url);
const files = readdirSync(dir).filter(name => name.endsWith('.json'));
const read = (name: string): { tool: string; arguments: Record<string, unknown> } =>
  JSON.parse(readFileSync(new URL(name, dir), 'utf8'));

const catalog = await ToolCatalog.create({ hasSamApiKey: true, hasTangoApiKey: true, hasHigherGovApiKey: true });

test('the examples folder holds a spread of example calls', () => {
  assert.ok(files.length >= 10, 'at least ten example calls');
});

for (const name of files) {
  test(`example ${name} names a tool, and its arguments pass that tool's input schema`, () => {
    const example = read(name);
    assert.deepEqual(Object.keys(example).sort(), ['arguments', 'tool']);
    const tool = catalog.tools.find(candidate => candidate.name === example.tool);
    assert.ok(tool, `${example.tool} is a tool in the catalog`);
    assert.equal(validateToolArgs(tool, example.arguments), null);
  });
}

test('the validation the examples use refuses what the server refuses', () => {
  const tool = catalog.tools.find(candidate => candidate.name === 'get_sam_opportunities')!;
  assert.match(validateToolArgs(tool, { posted_from: '11/01/2026' }) ?? '', /Missing required/);
  assert.match(validateToolArgs(tool, { posted_from: 'a', posted_to: 'b', unknown: 1 }) ?? '', /Unknown parameter/);
});
