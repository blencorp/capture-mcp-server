import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { DOC_PATH, renderToolReference } from '../scripts/gen-tool-reference.js';
import { ToolCatalog } from './tools/index.js';

test('docs/sdk-reference.md is current: run `pnpm docs:reference` after changing a tool', async () => {
  assert.equal(readFileSync(DOC_PATH, 'utf8'), await renderToolReference());
});

test('each tool has one heading in the format the documentation site reads', async () => {
  const headings = [...readFileSync(DOC_PATH, 'utf8').matchAll(/^#### `([^`]+)`$/gm)].map(m => m[1]);
  const catalog = await ToolCatalog.create({ hasSamApiKey: true, hasTangoApiKey: true, hasHigherGovApiKey: true });
  assert.deepEqual(headings.sort(), catalog.tools.map(tool => `${tool.name}(args)`).sort());
});
