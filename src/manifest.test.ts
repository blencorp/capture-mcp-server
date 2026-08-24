import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { initializeTools } from './tools/index.js';

function readJson(url: URL): any {
  return JSON.parse(readFileSync(url, 'utf8'));
}

test('package, desktop manifest, Node runtime, and complete tool catalog stay aligned', async () => {
  const packageJson = readJson(new URL('./package.json', import.meta.url));
  const manifest = readJson(new URL('../manifest.json', import.meta.url));
  const registry = await initializeTools({
    hasSamApiKey: true,
    hasTangoApiKey: true,
    hasHigherGovApiKey: true,
  });

  assert.equal(packageJson.engines.node, '>=24');
  assert.equal(manifest.compatibility.runtimes.node, '>=24.0.0');
  assert.equal(manifest.version, packageJson.version);

  const runtimeNames = registry.tools.map(tool => tool.name).sort();
  const manifestNames = manifest.tools.map((tool: any) => tool.name).sort();
  assert.equal(new Set(runtimeNames).size, runtimeNames.length, 'runtime tool names must be unique');
  assert.equal(new Set(manifestNames).size, manifestNames.length, 'manifest tool names must be unique');
  assert.equal(runtimeNames.length, 34);
  assert.deepEqual(manifestNames, runtimeNames);
});
